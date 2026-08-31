import 'leaflet/dist/leaflet.css';
import './styles/app.css';
import './styles/phase2.css';
import './styles/phase3.css';
import './styles/phase6.css';
import { edgeBetween, hydrateGraphData, loadInitialGraphData, loadWalkingNetwork } from './data.js';
import { createI18n, localized } from './i18n.js';
import { createGpsNavigator } from './gps.js';
import { renderNodeDetail, stopNarration } from './content.js';
import { renderGlossary } from './glossary.js';
import { renderTreeExplorer } from './trees.js';
import { createTreeMapLayer } from './tree-map.js';
import { renderRouteDetail } from './routes.js';
import { renderWalkingRouteDetail } from './walking-route-detail.js';
import { renderTreeDetail } from './tree-detail.js';
import { createVisitorLayerController, renderVisitorFeatureDetail, renderVisitorLayerControl } from './visitor-layers.js';
import { deepLinkHash, parseDeepLink, routeDeepLinkHash } from './deep-link.js';
import { createBrowserSpatialController, LEAFLET_OVERLAY_COMPATIBILITY } from './spatial-controller.js';
import { createSpatialWorld, createWalkingNetworkDescriptor } from './spatial-world.js';
import { planWalkingRoute } from './walking-router.js';

const app = document.querySelector('#app');
const i18n = createI18n();

document.documentElement.lang = i18n.language;

app.innerHTML = `
  <main class="app-shell">
    <header class="topbar">
      <div class="brand-block">
        <p class="eyebrow" data-i18n="heritage"></p>
        <h1 data-i18n="appTitle"></h1>
      </div>
      <div class="topbar-actions">
        <button id="language" class="language-button" type="button" aria-label="Sprache wechseln">EN</button>
        <button id="locate" class="locate-button" type="button">
          <span aria-hidden="true">◎</span><span data-i18n="locate"></span>
        </button>
      </div>
    </header>
    <section class="map-stage" aria-label="Interaktive Karte des Bergparks">
      <div id="map" tabindex="0"></div>
      <div id="map-status" class="map-hint" aria-live="polite"></div>
      <details id="visitor-layer-control" class="visitor-layer-control"></details>
    </section>
    <aside id="panel-view" class="panel-overlay" hidden></aside>
    <aside id="detail-sheet" class="detail-sheet" aria-live="polite" hidden></aside>
    <nav class="bottom-nav" aria-label="Hauptnavigation">
      <button class="nav-item is-active" type="button" data-view="map" aria-current="page"><span aria-hidden="true">⌖</span><span data-i18n="map"></span></button>
      <button class="nav-item" type="button" data-view="index"><span aria-hidden="true">⌕</span><span data-i18n="index"></span></button>
      <button class="nav-item" type="button" data-view="trees"><span aria-hidden="true">♧</span><span data-i18n="trees"></span></button>
    </nav>
  </main>
`;

const elements = {
  language: document.querySelector('#language'),
  locate: document.querySelector('#locate'),
  status: document.querySelector('#map-status'),
  panel: document.querySelector('#panel-view'),
  detail: document.querySelector('#detail-sheet'),
  nav: [...document.querySelectorAll('[data-view]')],
  visitorLayers: document.querySelector('#visitor-layer-control'),
};

let graph = null;
let mapController = null;
let spatialWorld = null;
let gps = null;
let treeMapController = null;
let visitorLayerController = null;
let currentNodeId = null;
let currentTreeId = null;
let currentVisitorFeatureId = null;
let currentView = 'map';
let currentRoute = null;
let nodeReturnContext = null;
let treeReturnContext = null;
let visitorReturnContext = null;
let activeVisitorKinds = new Set();
let lastHandledFragment = null;
let coreDocuments = null;
let supplementalHydrationPromise = null;
let supplementalHydrationTimer = null;
let walkingNetworkDescriptor = null;
let walkingNetworkState = 'loading';
let walkingRouteError = null;

function syncDeepLink(kind, id, mode = 'push') {
  if (mode === 'none') return;
  const hash = deepLinkHash(kind, id);
  if (!hash) return;
  if (location.hash === hash) {
    lastHandledFragment = hash;
    return;
  }
  if (mode === 'replace') history.replaceState(null, '', hash);
  else history.pushState(null, '', hash);
  lastHandledFragment = hash;
}

function syncWalkingRouteDeepLink(fromId, toId, profileId, mode = 'push') {
  if (mode === 'none') return;
  const hash = routeDeepLinkHash(fromId, toId, profileId);
  if (!hash) return;
  if (location.hash === hash) {
    lastHandledFragment = hash;
    return;
  }
  if (mode === 'replace') history.replaceState(null, '', hash);
  else history.pushState(null, '', hash);
  lastHandledFragment = hash;
}

function walkingRouteErrorText(reason) {
  const language = i18n.language;
  const text = {
    de: {
      'network-unavailable': 'Das detaillierte Wegenetz ist derzeit nicht verfügbar.',
      'unknown-profile': 'Das gespeicherte Routenprofil wird nicht unterstützt.',
      'same-place': 'Bitte wähle ein anderes Ziel.',
      'unknown-source-anchor': 'Der Startort ist im veröffentlichten Wegenetz nicht verankert.',
      'unknown-destination-anchor': 'Der Zielort ist im veröffentlichten Wegenetz nicht verankert.',
      'disconnected-components': 'Start und Ziel liegen in getrennten Komponenten des veröffentlichten Wegenetzes.',
      'no-route-for-profile': 'Für dieses Profil wurde im veröffentlichten Wegenetz keine Route gefunden.',
      'route-reconstruction-failed': 'Die berechnete Route konnte nicht sicher rekonstruiert werden.',
      'route-render-failed': 'Die berechnete Route konnte auf der Karte nicht dargestellt werden.',
    },
    en: {
      'network-unavailable': 'The detailed walking network is currently unavailable.',
      'unknown-profile': 'The saved routing profile is not supported.',
      'same-place': 'Choose a different destination.',
      'unknown-source-anchor': 'The start place is not anchored in the published walking network.',
      'unknown-destination-anchor': 'The destination is not anchored in the published walking network.',
      'disconnected-components': 'Start and destination are in separate components of the published walking network.',
      'no-route-for-profile': 'No route was found for this profile in the published walking network.',
      'route-reconstruction-failed': 'The computed route could not be reconstructed safely.',
      'route-render-failed': 'The computed route could not be rendered on the map.',
    },
  };
  return text[language]?.[reason] ?? text.en[reason] ?? text.en['no-route-for-profile'];
}

function walkingRoutePlanner(nodeId) {
  if (!graph?.nodesById.has(nodeId)) return null;
  if (walkingNetworkState === 'loading') return { state: 'loading' };
  if (walkingNetworkState !== 'ready' || !walkingNetworkDescriptor) return { state: 'unavailable' };
  const destinations = graph.nodes
    .filter(({ id }) => id !== nodeId && walkingNetworkDescriptor.placeAnchorsByPlaceId.has(id))
    .map((node) => ({ id: node.id, title: localized(node.name, i18n.language, node.id) }))
    .sort((left, right) => left.title.localeCompare(right.title, i18n.language) || left.id.localeCompare(right.id));
  return {
    state: 'ready',
    destinations,
    errorText: walkingRouteError?.fromId === nodeId ? walkingRouteErrorText(walkingRouteError.reason) : null,
  };
}

function renderIndexView() {
  if (!graph) return;
  renderGlossary(elements.panel, {
    nodes: graph.entities,
    nodeIds: new Set(graph.nodes.map(({ id }) => id)),
    trees: graph.trees,
    visitorFeatures: graph.visitorLayers?.features ?? [],
    walkingNetwork: walkingNetworkDescriptor,
    i18n,
    onSelectNode: selectEntity,
    onSelectTree: selectTree,
    onSelectFeature: selectVisitorFeature,
    onSelectNetwork: focusNetworkItem,
  });
}

function focusNetworkItem(item) {
  if (!item?.position) return;
  setView('map');
  mapController?.focusPosition(item.position, { minZoom: 17, duration: 0.35 });
  setStatus(`${item.title} · ${item.id}`, true);
}

function runWhenIdle(callback, timeout = 1200) {
  if ('requestIdleCallback' in window) window.requestIdleCallback(callback, { timeout });
  else callback();
}

function scheduleWalkingNetworkHydration() {
  window.setTimeout(() => runWhenIdle(() => {
    loadWalkingNetwork()
      .then((walkingNetwork) => {
        if (!walkingNetwork) {
          walkingNetworkState = 'unavailable';
          if (currentNodeId && !currentRoute && !elements.detail.hidden) showDetail(graph.entitiesById.get(currentNodeId));
          if (parseDeepLink(location.hash)?.kind === 'route' && !currentRoute) restoreDeepLink({ force: true });
          return;
        }
        walkingNetworkDescriptor = createWalkingNetworkDescriptor(walkingNetwork);
        walkingNetworkState = 'ready';
        mapController?.setWalkingNetwork(walkingNetworkDescriptor);
        if (currentView === 'index' && !currentTreeId && !currentVisitorFeatureId) renderIndexView();
        if (currentNodeId && !currentRoute && !elements.detail.hidden) showDetail(graph.entitiesById.get(currentNodeId));
        if (parseDeepLink(location.hash)?.kind === 'route' && !currentRoute) restoreDeepLink({ force: true });
      })
      .catch((error) => {
        walkingNetworkState = 'unavailable';
        console.warn('Complete walking network unavailable:', error);
        if (currentNodeId && !currentRoute && !elements.detail.hidden) showDetail(graph.entitiesById.get(currentNodeId));
        if (parseDeepLink(location.hash)?.kind === 'route' && !currentRoute) restoreDeepLink({ force: true });
      });
  }), 1500);
}

function applySupplementalGraph(hydratedGraph) {
  graph = hydratedGraph;
  spatialWorld = createSpatialWorld(graph);
  treeMapController?.destroy();
  visitorLayerController?.destroy();
  mapController?.setWorld(spatialWorld);
  // Slice 0 keeps these viewport-driven Leaflet overlays behind one explicit,
  // temporary compatibility surface. MapLibre consumes the same SpatialWorld
  // through the controller instead; core orchestration never receives either map.
  const leafletCompatibility = mapController?.compatibilitySurface(LEAFLET_OVERLAY_COMPATIBILITY);
  if (leafletCompatibility?.map) {
    treeMapController = createTreeMapLayer(leafletCompatibility.map, graph.trees, {
      language: i18n.language,
      onSelectTree: selectTree,
    });
    visitorLayerController = createVisitorLayerController(leafletCompatibility.map, graph.visitorLayers, {
      language: i18n.language,
      onSelectFeature: selectVisitorFeature,
    });
  } else {
    treeMapController = {
      setVisible: (visible) => mapController?.setTreeVisibility(visible),
      setTrees: (trees) => mapController?.setTreeFilter((trees ?? []).map(({ id }) => id)),
      updateLanguage() {},
      destroy() {
        mapController?.setTreeVisibility(false);
        mapController?.setTreeFilter(null);
      },
    };
    visitorLayerController = {
      setActiveKinds: (kinds) => mapController?.setVisitorKinds(kinds),
      updateLanguage() {},
      destroy() { mapController?.setVisitorKinds([]); },
    };
  }
  renderVisitorLayersControl();
  document.querySelector('#map').dataset.supplementalData = 'ready';

  if (currentView !== 'map' && !currentTreeId && !currentVisitorFeatureId) setView(currentView);
  if (currentNodeId && !currentRoute && !elements.detail.hidden) showDetail(graph.entitiesById.get(currentNodeId));
  // Late supplemental hydration must not replay a stale place deep link after
  // the visitor has deliberately moved into Index/Trees or opened transient
  // route detail. A route is intentionally not encoded into location.hash, so
  // replaying the source-place fragment here would silently replace that route.
  if (currentView === 'map' && !currentRoute) restoreDeepLink({ force: true });
}

function ensureSupplementalData() {
  if (supplementalHydrationPromise || !coreDocuments) return supplementalHydrationPromise;
  if (supplementalHydrationTimer) {
    window.clearTimeout(supplementalHydrationTimer);
    supplementalHydrationTimer = null;
  }
  supplementalHydrationPromise = hydrateGraphData(coreDocuments)
    .then(applySupplementalGraph)
    .catch((error) => console.warn('Supplemental Bergpark data unavailable:', error));
  return supplementalHydrationPromise;
}

function scheduleSupplementalHydration() {
  supplementalHydrationTimer = window.setTimeout(() => {
    supplementalHydrationTimer = null;
    runWhenIdle(() => ensureSupplementalData());
  }, 800);
}

function renderChrome() {
  for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = i18n.t(element.dataset.i18n);
  document.querySelector('.skip-link').textContent = i18n.t('skipMap');
  document.querySelector('.map-stage').setAttribute('aria-label', i18n.t('mapRegion'));
  document.querySelector('.bottom-nav').setAttribute('aria-label', i18n.t('mainNavigation'));
  elements.language.textContent = i18n.language === 'de' ? 'EN' : 'DE';
  elements.language.setAttribute('aria-label', i18n.language === 'de' ? 'Switch to English' : 'Auf Deutsch wechseln');
  elements.locate.setAttribute('aria-label', i18n.t('locateLabel'));
  if (!elements.status.dataset.transient) elements.status.textContent = i18n.t('mapHint');
}

function setStatus(message, transient = false) {
  elements.status.textContent = message;
  if (transient) elements.status.dataset.transient = 'true';
  else delete elements.status.dataset.transient;
}

function renderVisitorLayersControl() {
  if (!graph?.visitorLayers) return;
  const wasOpen = elements.visitorLayers.open;
  renderVisitorLayerControl(elements.visitorLayers, {
    layerData: graph.visitorLayers,
    i18n,
    selectedKinds: activeVisitorKinds,
    onChange(kinds) {
      activeVisitorKinds = new Set(kinds);
      visitorLayerController?.setActiveKinds(kinds);
    },
  });
  elements.visitorLayers.open = wasOpen;
}

function selectionReturnSelector(kind, id, view) {
  const escapedId = CSS.escape(id);
  if (view === 'index') {
    const attribute = kind === 'tree' ? 'data-tree-id' : kind === 'feature' ? 'data-feature-id' : 'data-node-id';
    return `[data-destination-kind="${kind}"][${attribute}="${escapedId}"]`;
  }
  if (view === 'trees' && kind === 'tree') return `[data-tree-id="${escapedId}"]`;
  return null;
}

function captureSelectionReturn(kind, id, { enabled = true } = {}) {
  if (!enabled) return null;
  const active = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
    ? document.activeElement
    : null;
  return {
    view: currentView,
    element: active,
    selector: selectionReturnSelector(kind, id, currentView),
  };
}

function restoreSelectionFocus(context) {
  if (context?.view === 'index' || context?.view === 'trees') setView(context.view, { reusePanel: true });
  requestAnimationFrame(() => {
    const original = context?.element;
    if (original?.isConnected && !original.closest('[hidden]')) {
      original.focus();
      return;
    }
    const fallback = context?.selector ? document.querySelector(context.selector) : null;
    if (fallback instanceof HTMLElement && !fallback.closest('[hidden]')) {
      fallback.focus();
      return;
    }
    document.querySelector('#map')?.focus();
  });
}

function setView(view, { reusePanel = false } = {}) {
  currentView = view;
  stopNarration();
  for (const button of elements.nav) {
    const active = button.dataset.view === view;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }

  if (view === 'map') {
    elements.panel.hidden = true;
    requestAnimationFrame(() => mapController?.invalidate());
    return;
  }

  elements.detail.hidden = true;
  elements.panel.hidden = false;
  if (view === 'index') {
    treeMapController?.setVisible(false);
    if (reusePanel) return;
    renderIndexView();
  } else if (view === 'trees') {
    treeMapController?.setVisible(true);
    if (reusePanel) return;
    renderTreeExplorer(elements.panel, {
      trees: graph.trees,
      metadata: graph.metadata,
      i18n,
      onSelectTree: selectTree,
      onFilterChange: (trees) => treeMapController?.setTrees(trees),
    });
  }
}

function showDetail(node, { focusClose = false } = {}) {
  stopNarration();
  currentRoute = null;
  currentTreeId = null;
  currentVisitorFeatureId = null;
  renderNodeDetail(elements.detail, {
    node,
    graph,
    i18n,
    onNavigate: showRoute,
    onSelectNode: selectEntity,
    routePlanner: walkingRoutePlanner(node?.id),
    onPlanWalkingRoute: showWalkingRoute,
  });
  const close = elements.detail.querySelector('[data-action="close-detail"]');
  close?.addEventListener('click', closeNodeDetail);
  if (focusClose) close?.focus();
}

function closeNodeDetail() {
  elements.detail.hidden = true;
  const context = nodeReturnContext;
  nodeReturnContext = null;
  restoreSelectionFocus(context);
}

function selectNode(id, { source = 'manual', historyMode } = {}) {
  const node = graph?.nodesById.get(id);
  if (!node) return;
  walkingRouteError = null;
  nodeReturnContext = captureSelectionReturn('place', id, {
    enabled: historyMode !== 'none' && source !== 'gps' && source !== 'deeplink',
  });
  currentNodeId = id;
  setView('map');
  mapController.focusPlace(id, { popup: source === 'manual' && nodeReturnContext?.view === 'map' });
  showDetail(node, { focusClose: Boolean(nodeReturnContext) });
  if (source === 'gps') setStatus(i18n.t('nearPlace', localized(node.name, i18n.language, node.id)), true);
  syncDeepLink('place', id, historyMode ?? (source === 'gps' ? 'replace' : 'push'));
}

function selectEntity(id, { historyMode = 'push' } = {}) {
  if (graph?.nodesById.has(id)) {
    selectNode(id, { historyMode });
    return;
  }
  const entity = graph?.entitiesById.get(id);
  if (!entity) return;
  walkingRouteError = null;
  nodeReturnContext = captureSelectionReturn('place', id, { enabled: historyMode !== 'none' });
  currentNodeId = id;
  setView('map');
  showDetail(entity, { focusClose: Boolean(nodeReturnContext) });
  syncDeepLink('place', id, historyMode);
}

function selectTree(id, context = {}) {
  const tree = graph?.trees.find((candidate) => candidate.id === id);
  if (!tree) return;
  currentNodeId = null;
  currentRoute = null;
  currentVisitorFeatureId = null;
  currentTreeId = id;
  treeReturnContext = captureSelectionReturn('tree', id, { enabled: context.historyMode !== 'none' });
  elements.panel.hidden = true;
  const descriptor = spatialWorld?.treesById.get(id);
  if (descriptor) mapController.focusPosition(descriptor.position, { zoom: 18, duration: 0.6 });
  const label = localized(tree.name, i18n.language, tree.species?.[i18n.language] ?? tree.species?.scientific ?? tree.catalog_ref ?? tree.id);
  setStatus(label, true);
  renderTreeDetail(elements.detail, { tree, i18n, onClose: closeTreeDetail });
  syncDeepLink('tree', id, context.historyMode ?? 'push');
}

function closeTreeDetail() {
  elements.detail.hidden = true;
  const context = treeReturnContext;
  currentTreeId = null;
  treeReturnContext = null;
  restoreSelectionFocus(context);
}

function selectVisitorFeature(feature, { historyMode = 'push' } = {}) {
  if (!feature) return;
  visitorReturnContext = captureSelectionReturn('feature', feature.id, { enabled: historyMode !== 'none' });
  currentNodeId = null;
  currentTreeId = null;
  currentRoute = null;
  currentVisitorFeatureId = feature.id;
  elements.panel.hidden = true;
  const descriptor = spatialWorld?.visitorFeaturesById.get(feature.id);
  if (descriptor) mapController.focusPosition(descriptor.position, { minZoom: 17, duration: 0.35 });
  renderVisitorFeatureDetail(elements.detail, { feature, i18n, onClose: closeVisitorFeature });
  syncDeepLink('feature', feature.id, historyMode);
}

function closeVisitorFeature() {
  currentVisitorFeatureId = null;
  elements.detail.hidden = true;
  const context = visitorReturnContext;
  visitorReturnContext = null;
  restoreSelectionFocus(context);
}

function showRoute(fromId, toId) {
  const edge = edgeBetween(graph, fromId, toId);
  const routeDescriptor = edge?.id ? spatialWorld?.routesById.get(edge.id) : null;
  if (!edge || !routeDescriptor || !mapController.showRoute(routeDescriptor)) {
    setStatus(i18n.t('routeUnknown'), true);
    return;
  }
  setView('map');
  currentRoute = { kind: 'direct', edge, fromId, toId };
  const target = graph.nodesById.get(toId);
  const source = graph.nodesById.get(fromId);
  if (target) {
    setStatus(`${localized(target.name, i18n.language, target.id)} · ${Math.round(edge.distance_m)} ${i18n.t('metres')} · ${edge.walking_min} ${i18n.t('minutes')}`, true);
  }
  renderRouteDetail(elements.detail, {
    edge,
    from: source,
    to: target,
    i18n,
    onSelectNode: selectEntity,
    onClose: closeRouteDetail,
  });
}

function renderCurrentWalkingRoute() {
  if (currentRoute?.kind !== 'network') return;
  const { route } = currentRoute;
  renderWalkingRouteDetail(elements.detail, {
    route,
    from: graph.nodesById.get(route.fromId),
    to: graph.nodesById.get(route.toId),
    i18n,
    onSelectNode: selectEntity,
    onClose: closeRouteDetail,
  });
}

function showWalkingRoute(fromId, toId, profileId = 'shortest', { historyMode = 'push' } = {}) {
  const source = graph?.nodesById.get(fromId);
  const target = graph?.nodesById.get(toId);
  const route = planWalkingRoute(walkingNetworkDescriptor, fromId, toId, profileId);
  if (!route.ok) {
    walkingRouteError = { fromId, reason: route.reason };
    currentRoute = null;
    currentNodeId = source?.id ?? null;
    if (source) {
      setView('map');
      showDetail(source);
    }
    setStatus(walkingRouteErrorText(route.reason), true);
    return false;
  }
  const rendered = mapController?.showRoute({
    id: route.id,
    coordinates: route.coordinates,
    distanceM: route.distanceM,
    walkingMin: route.walkingMin,
  });
  if (!rendered) {
    walkingRouteError = { fromId, reason: 'route-render-failed' };
    currentRoute = null;
    currentNodeId = source?.id ?? null;
    if (source) {
      setView('map');
      showDetail(source);
    }
    setStatus(walkingRouteErrorText('route-render-failed'), true);
    return false;
  }
  walkingRouteError = null;
  currentNodeId = fromId;
  setView('map');
  currentRoute = { kind: 'network', route, fromId, toId, profileId };
  if (target) setStatus(`${localized(target.name, i18n.language, target.id)} · ${Math.round(route.distanceM)} ${i18n.t('metres')}`, true);
  renderCurrentWalkingRoute();
  syncWalkingRouteDeepLink(fromId, toId, profileId, historyMode);
  return true;
}

function closeRouteDetail() {
  const source = currentRoute ? graph.nodesById.get(currentRoute.fromId) : null;
  const routeKind = currentRoute?.kind;
  currentRoute = null;
  if (!source) return;
  if (routeKind === 'network') syncDeepLink('place', source.id, 'replace');
  showDetail(source);
  elements.detail.querySelector('[data-action="close-detail"]')?.focus();
}

function setupGps() {
  gps = createGpsNavigator({
    nodes: graph.nodes,
    radiusM: 30,
    onPosition(position) {
      mapController.setUserPosition(position);
    },
    onEnter(node) {
      selectNode(node.id, { source: 'gps' });
    },
    onError() {
      setStatus(i18n.t('gpsUnavailable'), true);
      elements.locate.classList.remove('is-active');
    },
  });

  elements.locate.addEventListener('click', () => {
    if (gps.active) {
      gps.stop();
      elements.locate.classList.remove('is-active');
      setStatus(i18n.t('mapHint'));
      return;
    }
    if (!gps.start()) {
      setStatus(i18n.t('gpsUnavailable'), true);
      return;
    }
    elements.locate.classList.add('is-active');
    setStatus(i18n.t('gpsWatching'), true);
  });
}

function restoreDeepLink({ force = false } = {}) {
  if (!graph) return false;
  const fragment = location.hash;
  if (!force && fragment === lastHandledFragment) return false;
  const deepLink = parseDeepLink(fragment);
  if (!deepLink) {
    lastHandledFragment = fragment;
    if (!elements.detail.hidden) {
      if (currentTreeId) closeTreeDetail();
      else if (currentVisitorFeatureId) closeVisitorFeature();
      else if (currentNodeId) closeNodeDetail();
    }
    return false;
  }

  let restored = false;
  if (deepLink.kind === 'route') {
    if (walkingNetworkState === 'loading') return false;
    restored = showWalkingRoute(deepLink.fromId, deepLink.toId, deepLink.profile, { historyMode: 'none' });
  } else if (deepLink.kind === 'place') {
    if (graph.nodesById.has(deepLink.id)) {
      selectNode(deepLink.id, { source: 'deeplink', historyMode: 'none' });
      restored = true;
    } else if (graph.entitiesById.has(deepLink.id)) {
      selectEntity(deepLink.id, { historyMode: 'none' });
      restored = true;
    }
  } else if (deepLink.kind === 'tree' && graph.trees.some(({ id }) => id === deepLink.id)) {
    selectTree(deepLink.id, { source: 'deeplink', historyMode: 'none' });
    restored = true;
  } else if (deepLink.kind === 'feature') {
    const feature = graph.visitorFeaturesById.get(deepLink.id);
    if (feature) {
      selectVisitorFeature(feature, { historyMode: 'none' });
      restored = true;
    }
  }
  lastHandledFragment = fragment;
  if (!restored && deepLink.kind !== 'route' && force && document.querySelector('#map')?.dataset.supplementalData === 'ready') {
    setStatus(i18n.t('savedLinkUnavailable'), true);
  }
  return restored;
}

async function boot() {
  renderChrome();
  setStatus(i18n.t('loading'), true);
  const initial = await loadInitialGraphData();
  graph = initial.graph;
  spatialWorld = createSpatialWorld(graph);
  coreDocuments = initial.coreDocuments;
  mapController = await createBrowserSpatialController({
    element: document.querySelector('#map'),
    graph,
    world: spatialWorld,
    language: i18n.language,
    onSelectPlace: (id) => selectNode(id),
    onSelectTree: (id) => selectTree(id, { source: 'map' }),
    onSelectFeature: (id) => {
      const feature = graph?.visitorFeaturesById.get(id);
      if (feature) selectVisitorFeature(feature);
    },
    onLocationError: () => setStatus(i18n.t('gpsUnavailable'), true),
  });
  setupGps();
  mapController.fitWorld();
  setStatus(i18n.t('mapHint'));
  restoreDeepLink({ force: true });
  scheduleSupplementalHydration();
  scheduleWalkingNetworkHydration();
}

for (const button of elements.nav) {
  button.addEventListener('click', () => {
    if (!graph) return;
    setView(button.dataset.view);
    if (button.dataset.view !== 'map') ensureSupplementalData();
  });
}

elements.language.addEventListener('click', () => i18n.toggle());
i18n.subscribe(() => {
  renderChrome();
  mapController?.setLanguage(i18n.language);
  treeMapController?.updateLanguage(i18n.language);
  visitorLayerController?.updateLanguage(i18n.language);
  renderVisitorLayersControl();
  if (currentRoute?.kind === 'network' && !elements.detail.hidden) {
    renderCurrentWalkingRoute();
  } else if (currentRoute && !elements.detail.hidden) {
    renderRouteDetail(elements.detail, {
      edge: currentRoute.edge,
      from: graph.nodesById.get(currentRoute.fromId),
      to: graph.nodesById.get(currentRoute.toId),
      i18n,
      onSelectNode: selectEntity,
      onClose: closeRouteDetail,
    });
  } else if (currentTreeId && !elements.detail.hidden) {
    renderTreeDetail(elements.detail, { tree: graph.trees.find(({ id }) => id === currentTreeId), i18n, onClose: closeTreeDetail });
  } else if (currentVisitorFeatureId && !elements.detail.hidden) {
    renderVisitorFeatureDetail(elements.detail, { feature: graph.visitorFeaturesById.get(currentVisitorFeatureId), i18n, onClose: closeVisitorFeature });
  } else if (currentNodeId && !elements.detail.hidden) showDetail(graph.entitiesById.get(currentNodeId));
  if (currentView !== 'map' && graph && !currentTreeId && !currentVisitorFeatureId) setView(currentView);
});

window.addEventListener('beforeunload', () => {
  gps?.stop();
  mapController?.destroy();
  stopNarration();
});

window.addEventListener('hashchange', () => restoreDeepLink());
window.addEventListener('popstate', () => restoreDeepLink());

boot().catch((error) => {
  console.error(error);
  renderChrome();
  setStatus(i18n.t('loadError'), true);
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error) => console.warn('Service worker registration failed', error));
  });
}
