import 'leaflet/dist/leaflet.css';
import './styles/app.css';
import { loadGraphData, edgeBetween } from './data.js';
import { createI18n, localized } from './i18n.js';
import { createBergparkMap } from './map.js';
import { createGpsNavigator } from './gps.js';
import { renderNodeDetail, stopNarration } from './content.js';
import { renderGlossary } from './glossary.js';
import { renderTreeExplorer } from './trees.js';

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
};

let graph = null;
let mapController = null;
let gps = null;
let currentNodeId = null;
let currentView = 'map';

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

function setView(view) {
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
    requestAnimationFrame(() => mapController?.invalidateSize());
    return;
  }

  elements.detail.hidden = true;
  elements.panel.hidden = false;
  if (view === 'index') {
    renderGlossary(elements.panel, { nodes: graph.entities, i18n, onSelectNode: selectEntity });
  } else if (view === 'trees') {
    renderTreeExplorer(elements.panel, {
      trees: graph.trees,
      metadata: graph.metadata,
      i18n,
      onSelectTree: selectTree,
    });
  }
}

function showDetail(node) {
  renderNodeDetail(elements.detail, {
    node,
    graph,
    i18n,
    onNavigate: showRoute,
    onSelectNode: selectNode,
  });
}

function selectNode(id, { source = 'manual' } = {}) {
  const node = graph?.nodesById.get(id);
  if (!node) return;
  currentNodeId = id;
  setView('map');
  mapController.showNode(id, { popup: source === 'manual' });
  showDetail(node);
  if (source === 'gps') setStatus(i18n.t('nearPlace', localized(node.name, i18n.language, node.id)), true);
  history.replaceState(null, '', `#place=${encodeURIComponent(id)}`);
}

function selectEntity(id) {
  if (graph?.nodesById.has(id)) {
    selectNode(id);
    return;
  }
  const entity = graph?.entitiesById.get(id);
  if (!entity) return;
  currentNodeId = id;
  setView('map');
  showDetail(entity);
  history.replaceState(null, '', `#place=${encodeURIComponent(id)}`);
}

function selectTree(id) {
  const tree = graph?.trees.find((candidate) => candidate.id === id);
  if (!tree) return;
  setView('map');
  if (Number.isFinite(tree.lat) && Number.isFinite(tree.lng ?? tree.lon)) {
    mapController.map.flyTo([tree.lat, tree.lng ?? tree.lon], 18, { duration: 0.6 });
  }
}

function showRoute(fromId, toId) {
  const edge = edgeBetween(graph, fromId, toId);
  if (!edge || !mapController.showRoute(edge)) {
    setStatus(i18n.t('routeUnknown'), true);
    return;
  }
  setView('map');
  const target = graph.nodesById.get(toId);
  if (target) {
    setStatus(`${localized(target.name, i18n.language, target.id)} · ${Math.round(edge.distance_m)} ${i18n.t('metres')} · ${edge.walking_min} ${i18n.t('minutes')}`, true);
  }
}

function setupGps() {
  gps = createGpsNavigator({
    nodes: graph.nodes,
    radiusM: 30,
    onPosition(position) {
      mapController.showUserPosition(position);
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

function restoreDeepLink() {
  const match = location.hash.match(/^#place=([^&]+)/);
  if (!match) return;
  const id = decodeURIComponent(match[1]);
  if (graph.nodesById.has(id)) selectNode(id, { source: 'deeplink' });
  else if (graph.entitiesById.has(id)) selectEntity(id);
}

async function boot() {
  renderChrome();
  setStatus(i18n.t('loading'), true);
  graph = await loadGraphData();
  mapController = createBergparkMap(document.querySelector('#map'), graph, {
    language: i18n.language,
    onSelectNode: (id) => selectNode(id),
    onLocationError: () => setStatus(i18n.t('gpsUnavailable'), true),
  });
  setupGps();
  mapController.fitPark();
  setStatus(i18n.t('mapHint'));
  restoreDeepLink();
}

for (const button of elements.nav) button.addEventListener('click', () => graph && setView(button.dataset.view));

elements.language.addEventListener('click', () => i18n.toggle());
i18n.subscribe(() => {
  renderChrome();
  mapController?.updateLanguage(i18n.language);
  if (currentNodeId && !elements.detail.hidden) showDetail(graph.entitiesById.get(currentNodeId));
  if (currentView !== 'map' && graph) setView(currentView);
});

window.addEventListener('beforeunload', () => {
  gps?.stop();
  stopNarration();
});

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
