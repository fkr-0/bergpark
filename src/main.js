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
import { navigationSummary } from './guidance-surface.js';

const app = document.querySelector('#app');
const i18n = createI18n();

document.documentElement.lang = i18n.language;

app.innerHTML = `
  <main class="app-shell">
    <header id="guide-surface" class="topbar" data-guide-mode="welcome">
      <div class="brand-block guide-copy">
        <p id="guide-kicker" class="eyebrow"></p>
        <h1 id="guide-title"></h1>
        <p id="guide-detail" class="guide-detail" hidden></p>
      </div>
      <div class="topbar-actions">
        <button id="renderer-switch" class="renderer-switch" type="button" aria-label="Geländemodus wechseln" aria-pressed="false">3D</button>
        <button id="language" class="language-button" type="button" aria-label="Sprache wechseln">EN</button>
        <button id="set-position" class="icon-button desktop-position-button" type="button" aria-pressed="false"><span aria-hidden="true">⌖</span><span class="sr-only" data-i18n="setPosition"></span></button>
        <button id="locate" class="locate-button" type="button">
          <span aria-hidden="true">◎</span><span data-i18n="locate"></span>
        </button>
        <button id="header-toggle" class="icon-button header-toggle" type="button" aria-expanded="true"><span aria-hidden="true">⌃</span></button>
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
  shell: document.querySelector('.app-shell'),
  topbar: document.querySelector('#guide-surface'),
  guideKicker: document.querySelector('#guide-kicker'),
  guideTitle: document.querySelector('#guide-title'),
  guideDetail: document.querySelector('#guide-detail'),
  headerToggle: document.querySelector('#header-toggle'),
  setPosition: document.querySelector('#set-position'),
  map: document.querySelector('#map'),
  rendererSwitch: document.querySelector('#renderer-switch'),
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
let latestUserPosition = null;
let spatialSwitchPromise = null;
let activeTreeFilterIds = null;
let walkingRouteError = null;
let positionSource = null;
let manualPositionPickActive = false;
let guideIntroAcknowledged = false;
let guideUserCollapsed = false;

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

function bindSpatialOverlays() {
  treeMapController?.destroy();
  visitorLayerController?.destroy();
  treeMapController = null;
  visitorLayerController = null;
  if (!graph?.trees || !graph?.visitorLayers) return;
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
}

function applySupplementalGraph(hydratedGraph) {
  graph = hydratedGraph;
  spatialWorld = createSpatialWorld(graph);
  mapController?.setWorld(spatialWorld);
  bindSpatialOverlays();
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

function readGuideIntroState() {
  try {
    return sessionStorage.getItem('bergpark.guide.introSeen') === '1';
  } catch {
    return false;
  }
}

function rememberGuideIntro() {
  guideIntroAcknowledged = true;
  try { sessionStorage.setItem('bergpark.guide.introSeen', '1'); } catch { /* session storage is optional */ }
}

function formatGuidanceDistance(distanceM) {
  if (!Number.isFinite(distanceM)) return null;
  if (distanceM < 1000) return `${Math.max(0, Math.round(distanceM / 10) * 10)} ${i18n.t('metres')}`;
  return `${(distanceM / 1000).toFixed(distanceM < 10_000 ? 1 : 0)} km`;
}

function currentTargetLabel() {
  const routeTargetId = currentRoute?.toId ?? currentRoute?.route?.toId ?? null;
  const nodeId = routeTargetId ?? currentNodeId;
  const node = nodeId ? graph?.entitiesById?.get(nodeId) ?? graph?.nodesById?.get(nodeId) : null;
  if (node) return localized(node.name, i18n.language, node.title ?? node.id);
  if (currentTreeId) {
    const tree = graph?.trees?.find(({ id }) => id === currentTreeId);
    if (tree) return localized(tree.name, i18n.language, tree.species?.[i18n.language] ?? tree.id);
  }
  if (currentVisitorFeatureId) {
    const feature = graph?.visitorFeaturesById?.get(currentVisitorFeatureId);
    if (feature) return localized(feature.name ?? feature.title, i18n.language, feature.id);
  }
  return null;
}

function currentRouteForGuidance() {
  if (currentRoute?.kind === 'network') {
    return {
      coordinates: currentRoute.route.coordinates,
      distanceM: currentRoute.route.distanceM,
      walkingMin: currentRoute.route.walkingMin,
    };
  }
  if (currentRoute?.kind === 'direct') {
    const descriptor = currentRoute.edge?.id ? spatialWorld?.routesById?.get(currentRoute.edge.id) : null;
    return descriptor ? {
      coordinates: descriptor.coordinates,
      distanceM: currentRoute.edge.distance_m,
      walkingMin: currentRoute.edge.walking_min,
    } : null;
  }
  return null;
}

function renderGuidanceSurface() {
  if (!elements.topbar) return;
  const route = currentRouteForGuidance();
  const targetLabel = currentTargetLabel();
  let mode = guideIntroAcknowledged ? 'compact' : 'welcome';
  let kicker = i18n.t('heritage');
  let title = i18n.t('appTitle');
  let detail = '';

  if (route) {
    const summary = latestUserPosition ? navigationSummary({
      position: latestUserPosition,
      coordinates: route.coordinates,
      routeDistanceM: route.distanceM,
      walkingMin: route.walkingMin,
    }) : null;
    if (summary) {
      mode = 'navigation';
      kicker = i18n.t('navigation');
      title = summary.offRoute ? i18n.t('returnToRoute') : i18n.t('followRoute');
      const parts = [];
      if (targetLabel) parts.push(targetLabel);
      const remaining = formatGuidanceDistance(summary.remainingM);
      if (remaining) parts.push(`${i18n.t('remaining')} ${remaining}`);
      if (Number.isFinite(summary.remainingWalkingMin)) parts.push(`ca. ${Math.max(1, Math.ceil(summary.remainingWalkingMin))} ${i18n.t('minutes')}`);
      if (summary.offRoute) parts.push(`${formatGuidanceDistance(summary.offRouteM)} ${i18n.language === 'de' ? 'von der Route' : 'from route'}`);
      detail = parts.join(' · ');
    } else {
      mode = 'route';
      kicker = i18n.t('route');
      title = targetLabel ?? i18n.t('route');
      const parts = [formatGuidanceDistance(route.distanceM), Number.isFinite(route.walkingMin) ? `${route.walkingMin} ${i18n.t('minutes')}` : null].filter(Boolean);
      detail = `${parts.join(' · ')}${parts.length ? ' · ' : ''}${i18n.t('locationForGuidance')}`;
    }
  } else if (targetLabel) {
    mode = 'target';
    kicker = i18n.t('destination');
    title = targetLabel;
  } else if (latestUserPosition) {
    mode = 'position';
    kicker = i18n.t(positionSource === 'simulated' ? 'positionSimulated' : 'positionGps');
    title = i18n.t(positionSource === 'simulated' ? 'positionSimulated' : 'positionGps');
    detail = i18n.t('mapHint');
  }

  elements.topbar.dataset.guideMode = mode;
  elements.topbar.classList.toggle('is-user-collapsed', guideUserCollapsed);
  elements.guideKicker.textContent = kicker;
  elements.guideTitle.textContent = title;
  elements.guideDetail.textContent = detail;
  elements.guideDetail.hidden = !detail;
  const visuallyCompact = mode === 'compact' || guideUserCollapsed;
  elements.shell?.style.setProperty('--guide-map-control-offset', visuallyCompact ? '68px' : '150px');
  elements.headerToggle.hidden = mode === 'compact';
  elements.headerToggle.setAttribute('aria-expanded', String(!visuallyCompact));
  elements.headerToggle.setAttribute('aria-label', i18n.t(visuallyCompact ? 'expandHeader' : 'collapseHeader'));
  elements.headerToggle.querySelector('[aria-hidden="true"]').textContent = visuallyCompact ? '⌄' : '⌃';
}

function acknowledgeGuideIntro() {
  if (!guideIntroAcknowledged) rememberGuideIntro();
  renderGuidanceSurface();
}

function setPositionPickActive(active) {
  manualPositionPickActive = Boolean(active);
  elements.map.dataset.positionPick = String(manualPositionPickActive);
  elements.setPosition.setAttribute('aria-pressed', String(manualPositionPickActive));
  elements.setPosition.classList.toggle('is-active', manualPositionPickActive);
}

function applyUserPosition(position, source = 'gps') {
  if (!Number.isFinite(position?.lat) || !Number.isFinite(position?.lng)) return false;
  latestUserPosition = { ...position, simulated: source === 'simulated' };
  positionSource = source;
  elements.map.dataset.positionSource = source;
  mapController?.setUserPosition(latestUserPosition);
  guideUserCollapsed = false;
  acknowledgeGuideIntro();
  return true;
}

function clearUserPosition() {
  latestUserPosition = null;
  positionSource = null;
  delete elements.map.dataset.positionSource;
  mapController?.setUserPosition(null);
  renderGuidanceSurface();
}

function handleMapPositionSelect(position) {
  acknowledgeGuideIntro();
  if (!manualPositionPickActive) return;
  setPositionPickActive(false);
  if (!applyUserPosition({ ...position, accuracy: 0 }, 'simulated')) return;
  mapController?.focusPosition(position, { minZoom: 16, duration: 0.25 });
  setStatus(i18n.t('setPositionDone'), true);
}

function renderChrome() {
  for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = i18n.t(element.dataset.i18n);
  document.querySelector('.skip-link').textContent = i18n.t('skipMap');
  document.querySelector('.map-stage').setAttribute('aria-label', i18n.t('mapRegion'));
  document.querySelector('.bottom-nav').setAttribute('aria-label', i18n.t('mainNavigation'));
  elements.language.textContent = i18n.language === 'de' ? 'EN' : 'DE';
  elements.language.setAttribute('aria-label', i18n.language === 'de' ? 'Switch to English' : 'Auf Deutsch wechseln');
  elements.locate.setAttribute('aria-label', i18n.t('locateLabel'));
  elements.setPosition.setAttribute('aria-label', i18n.t('setPositionLabel'));
  elements.setPosition.title = i18n.t('setPosition');
  if (!elements.status.dataset.transient) elements.status.textContent = i18n.t('mapHint');
  renderGuidanceSurface();
}

function setStatus(message, transient = false) {
  elements.status.textContent = message;
  if (transient) elements.status.dataset.transient = 'true';
  else delete elements.status.dataset.transient;
}

function spatialFallbackStatus(reason) {
  if (reason === 'webgl2-unavailable') return i18n.t('terrainWebgl2Unavailable');
  if (reason === 'reduced-power') return i18n.t('terrainReducedPower');
  return i18n.t('terrainUnavailable');
}

function reconcileSpatialFallback(preference) {
  if (preference !== 'terrain' || mapController?.renderer === 'terrain') return false;
  const reason = mapController?.fallbackReason ?? 'terrain-renderer-unavailable';
  syncSpatialPreference('auto');
  elements.rendererSwitch.dataset.fallbackReason = reason;
  setStatus(spatialFallbackStatus(reason), true);
  return true;
}

function spatialPreferenceUrl(preference) {
  const url = new URL(location.href);
  if (preference === 'auto') {
    url.searchParams.delete('renderer');
    url.searchParams.delete('spatialRenderer');
  } else {
    url.searchParams.set('renderer', preference);
    url.searchParams.delete('spatialRenderer');
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function syncSpatialPreference(preference) {
  const next = spatialPreferenceUrl(preference);
  if (next !== `${location.pathname}${location.search}${location.hash}`) history.replaceState(null, '', next);
}

function renderRendererSwitch() {
  const terrain = mapController?.renderer === 'terrain';
  elements.rendererSwitch.disabled = Boolean(spatialSwitchPromise);
  elements.rendererSwitch.setAttribute('aria-pressed', String(terrain));
  elements.rendererSwitch.setAttribute('aria-label', terrain
    ? (i18n.language === 'de' ? 'Zur 2D-Ansicht wechseln' : 'Switch to the 2D view')
    : (i18n.language === 'de' ? '3D-Geländemodus öffnen' : 'Open 3D terrain mode'));
  elements.rendererSwitch.dataset.renderer = terrain ? 'terrain' : 'leaflet';
  const fallbackReason = terrain ? null : mapController?.fallbackReason;
  if (fallbackReason) elements.rendererSwitch.dataset.fallbackReason = fallbackReason;
  else delete elements.rendererSwitch.dataset.fallbackReason;
  elements.rendererSwitch.textContent = terrain ? '2D' : '3D';
  elements.rendererSwitch.title = terrain
    ? (i18n.language === 'de' ? 'Zur normalen Karte wechseln' : 'Switch to the standard map')
    : fallbackReason
      ? spatialFallbackStatus(fallbackReason)
      : (i18n.language === 'de' ? 'Geländemodus öffnen' : 'Open terrain mode');
}

function restoreSpatialPresentation() {
  if (!mapController) return;
  mapController.setWorld(spatialWorld);
  if (walkingNetworkState === 'ready') mapController.setWalkingNetwork(walkingNetworkDescriptor);
  if (latestUserPosition) mapController.setUserPosition(latestUserPosition);
  treeMapController?.setVisible(currentView === 'trees');
  if (activeTreeFilterIds) {
    const filteredTrees = graph.trees.filter(({ id }) => activeTreeFilterIds.includes(id));
    treeMapController?.setTrees(filteredTrees);
  }
  visitorLayerController?.setActiveKinds([...activeVisitorKinds]);

  if (currentRoute?.kind === 'network') {
    const rendered = mapController.showRoute({
      id: currentRoute.route.id,
      coordinates: currentRoute.route.coordinates,
      distanceM: currentRoute.route.distanceM,
      walkingMin: currentRoute.route.walkingMin,
    });
    if (rendered) renderCurrentWalkingRoute();
    return;
  }
  if (currentRoute?.kind === 'direct') {
    const routeDescriptor = currentRoute.edge?.id ? spatialWorld?.routesById.get(currentRoute.edge.id) : null;
    if (routeDescriptor && mapController.showRoute(routeDescriptor)) {
      renderRouteDetail(elements.detail, {
        edge: currentRoute.edge,
        from: graph.nodesById.get(currentRoute.fromId),
        to: graph.nodesById.get(currentRoute.toId),
        i18n,
        onSelectNode: selectEntity,
        onClose: closeRouteDetail,
      });
    } else {
      currentRoute = null;
    }
    return;
  }
  if (currentNodeId) {
    mapController.focusPlace(currentNodeId, { popup: false });
  } else if (currentTreeId) {
    const descriptor = spatialWorld?.treesById.get(currentTreeId);
    if (descriptor) mapController.focusPosition(descriptor.position, { minZoom: 17, duration: 0 });
  } else if (currentVisitorFeatureId) {
    const descriptor = spatialWorld?.visitorFeaturesById.get(currentVisitorFeatureId);
    if (descriptor) mapController.focusPosition(descriptor.position, { minZoom: 17, duration: 0 });
  } else if (currentView === 'map') {
    mapController.fitWorld();
  }
}

async function switchSpatialRenderer(nextPreference) {
  const preference = nextPreference === 'terrain' ? 'terrain' : 'auto';
  const current = mapController;
  const expectedRenderer = preference === 'terrain' ? 'terrain' : 'leaflet';
  if (!graph || spatialSwitchPromise || (current?.requestedRenderer === preference && current?.renderer === expectedRenderer)) return;
  spatialSwitchPromise = (async () => {
    const wasVisibleDetail = !elements.detail.hidden;
    treeMapController?.destroy();
    visitorLayerController?.destroy();
    current?.destroy();
    mapController = null;
    try {
      mapController = await createBrowserSpatialController({
        element: document.querySelector('#map'),
        graph,
        world: spatialWorld,
        language: i18n.language,
        preference,
        onSelectPlace: (id) => selectNode(id),
        onSelectTree: (id) => selectTree(id, { source: 'map' }),
        onSelectFeature: (id) => {
          const feature = graph?.visitorFeaturesById.get(id);
          if (feature) selectVisitorFeature(feature);
        },
        onMapPositionSelect: handleMapPositionSelect,
        onLocationError: () => setStatus(i18n.t('gpsUnavailable'), true),
      });
      bindSpatialOverlays();
      elements.detail.hidden = !wasVisibleDetail;
      restoreSpatialPresentation();
      if (!reconcileSpatialFallback(preference)) syncSpatialPreference(preference);
    } catch (error) {
      console.warn('Spatial renderer switch failed:', error);
      mapController = await createBrowserSpatialController({
        element: document.querySelector('#map'),
        graph,
        world: spatialWorld,
        language: i18n.language,
        preference: 'auto',
        onSelectPlace: (id) => selectNode(id),
        onSelectTree: (id) => selectTree(id, { source: 'map' }),
        onSelectFeature: (id) => {
          const feature = graph?.visitorFeaturesById.get(id);
          if (feature) selectVisitorFeature(feature);
        },
        onMapPositionSelect: handleMapPositionSelect,
        onLocationError: () => setStatus(i18n.t('gpsUnavailable'), true),
      });
      bindSpatialOverlays();
      elements.detail.hidden = !wasVisibleDetail;
      restoreSpatialPresentation();
      syncSpatialPreference('auto');
      setStatus(i18n.t('loadError'), true);
    } finally {
      spatialSwitchPromise = null;
      renderRendererSwitch();
    }
  })();
  await spatialSwitchPromise;
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
      onFilterChange: (trees) => {
        activeTreeFilterIds = trees.map(({ id }) => id);
        treeMapController?.setTrees(trees);
      },
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
  guideUserCollapsed = false;
  acknowledgeGuideIntro();
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
  guideUserCollapsed = false;
  acknowledgeGuideIntro();
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
  guideUserCollapsed = false;
  acknowledgeGuideIntro();
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
  guideUserCollapsed = false;
  acknowledgeGuideIntro();
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
  guideUserCollapsed = false;
  acknowledgeGuideIntro();
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
      applyUserPosition(position, 'gps');
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
      clearUserPosition();
      setStatus(i18n.t('mapHint'));
      return;
    }
    setPositionPickActive(false);
    if (positionSource === 'simulated') clearUserPosition();
    if (!gps.start()) {
      setStatus(i18n.t('gpsUnavailable'), true);
      return;
    }
    acknowledgeGuideIntro();
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
  guideIntroAcknowledged = readGuideIntroState();
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
    onMapPositionSelect: handleMapPositionSelect,
    onLocationError: () => setStatus(i18n.t('gpsUnavailable'), true),
  });
  setupGps();
  mapController.fitWorld();
  renderRendererSwitch();
  if (!reconcileSpatialFallback(mapController.requestedRenderer)) setStatus(i18n.t('mapHint'));
  restoreDeepLink({ force: true });
  scheduleSupplementalHydration();
  scheduleWalkingNetworkHydration();
}

for (const button of elements.nav) {
  button.addEventListener('click', () => {
    if (!graph) return;
    acknowledgeGuideIntro();
    setView(button.dataset.view);
    if (button.dataset.view !== 'map') ensureSupplementalData();
  });
}

elements.rendererSwitch.addEventListener('click', () => {
  acknowledgeGuideIntro();
  void switchSpatialRenderer(mapController?.renderer === 'terrain' ? 'auto' : 'terrain');
});
elements.setPosition.addEventListener('click', () => {
  acknowledgeGuideIntro();
  if (gps?.active) {
    gps.stop();
    elements.locate.classList.remove('is-active');
  }
  const next = !manualPositionPickActive;
  setPositionPickActive(next);
  setStatus(next ? i18n.t('setPositionPrompt') : i18n.t('mapHint'), next);
});
elements.headerToggle.addEventListener('click', () => {
  if (elements.topbar.dataset.guideMode === 'welcome') {
    rememberGuideIntro();
    guideUserCollapsed = false;
  } else {
    guideUserCollapsed = !guideUserCollapsed;
  }
  renderGuidanceSurface();
});
elements.language.addEventListener('click', () => i18n.toggle());
i18n.subscribe(() => {
  renderChrome();
  mapController?.setLanguage(i18n.language);
  treeMapController?.updateLanguage(i18n.language);
  renderRendererSwitch();
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
  renderGuidanceSurface();
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
