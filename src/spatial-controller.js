const VALID_PREFERENCES = new Set(['auto', 'leaflet', 'terrain']);
const LEAFLET_OVERLAY_COMPATIBILITY = 'leaflet-overlays-v1';

export function normalizeSpatialPreference(value) {
  return VALID_PREFERENCES.has(value) ? value : 'auto';
}

export function readSpatialPreference({ search = '', storage = null } = {}) {
  const params = new URLSearchParams(search);
  const query = params.get('renderer') ?? params.get('spatialRenderer');
  if (VALID_PREFERENCES.has(query)) return query;
  try {
    return normalizeSpatialPreference(storage?.getItem?.('bergpark.spatial.renderer'));
  } catch {
    return 'auto';
  }
}

export function detectSpatialCapabilities({
  documentRef = globalThis.document,
  navigatorRef = globalThis.navigator,
  terrainAvailable = true,
} = {}) {
  let webgl2 = false;
  try {
    const canvas = documentRef?.createElement?.('canvas');
    webgl2 = Boolean(canvas?.getContext?.('webgl2'));
  } catch {
    webgl2 = false;
  }
  const reducedPower = navigatorRef?.connection?.saveData === true
    || (Number.isFinite(navigatorRef?.deviceMemory) && navigatorRef.deviceMemory <= 2);
  return Object.freeze({
    leaflet: true,
    terrain: terrainAvailable === true,
    webgl2,
    reducedPower,
  });
}

export function selectSpatialRenderer({ preference = 'auto', capabilities = {} } = {}) {
  const requested = normalizeSpatialPreference(preference);
  // Leaflet remains the production/default renderer. Terrain is intentionally
  // opt-in until its interaction and performance parity are independently proven.
  if (requested !== 'terrain') return Object.freeze({ renderer: 'leaflet', requested, fallbackReason: null });
  if (capabilities.reducedPower) {
    return Object.freeze({ renderer: 'leaflet', requested, fallbackReason: 'reduced-power' });
  }
  if (!capabilities.webgl2) {
    return Object.freeze({ renderer: 'leaflet', requested, fallbackReason: 'webgl2-unavailable' });
  }
  if (!capabilities.terrain) {
    return Object.freeze({ renderer: 'leaflet', requested, fallbackReason: 'terrain-renderer-unavailable' });
  }
  return Object.freeze({ renderer: 'terrain', requested, fallbackReason: null });
}

function requireAdapterMethod(adapter, name) {
  if (typeof adapter?.[name] !== 'function') throw new TypeError(`Spatial adapter is missing ${name}()`);
  return (...args) => adapter[name](...args);
}

export function createSpatialController(adapter, selection, capabilities = {}) {
  return Object.freeze({
    renderer: selection.renderer,
    requestedRenderer: selection.requested,
    fallbackReason: selection.fallbackReason,
    capabilities: Object.freeze({ ...capabilities }),
    fitWorld: requireAdapterMethod(adapter, 'fitWorld'),
    focusPlace: requireAdapterMethod(adapter, 'focusPlace'),
    focusPosition: requireAdapterMethod(adapter, 'focusPosition'),
    showRoute: requireAdapterMethod(adapter, 'showRoute'),
    clearRoute: requireAdapterMethod(adapter, 'clearRoute'),
    setUserPosition: requireAdapterMethod(adapter, 'setUserPosition'),
    setWalkingNetwork: requireAdapterMethod(adapter, 'setWalkingNetwork'),
    setWorld: requireAdapterMethod(adapter, 'setWorld'),
    setTreeVisibility: requireAdapterMethod(adapter, 'setTreeVisibility'),
    setTreeFilter: requireAdapterMethod(adapter, 'setTreeFilter'),
    setVisitorKinds: requireAdapterMethod(adapter, 'setVisitorKinds'),
    setLanguage: requireAdapterMethod(adapter, 'setLanguage'),
    invalidate: requireAdapterMethod(adapter, 'invalidate'),
    destroy: requireAdapterMethod(adapter, 'destroy'),
    compatibilitySurface(name) {
      if (name !== LEAFLET_OVERLAY_COMPATIBILITY) return null;
      return adapter.compatibilitySurface?.(name) ?? null;
    },
  });
}

export async function createBrowserSpatialController({
  element,
  graph,
  world,
  language,
  onSelectPlace,
  onSelectTree,
  onSelectFeature,
  onLocationError,
  preference = null,
}) {
  let storage = null;
  try {
    storage = globalThis.localStorage;
  } catch {
    storage = null;
  }
  const requestedPreference = preference == null
    ? readSpatialPreference({ search: globalThis.location?.search ?? '', storage })
    : normalizeSpatialPreference(preference);
  const capabilities = detectSpatialCapabilities();
  const requestedSelection = selectSpatialRenderer({ preference: requestedPreference, capabilities });
  let selection = requestedSelection;
  let adapter = null;

  if (requestedSelection.renderer === 'terrain') {
    try {
      const { createMapLibreTerrainSpatialAdapter } = await import('./maplibre-map.js');
      adapter = await createMapLibreTerrainSpatialAdapter(element, graph, world, {
        language,
        onSelectPlace,
        onSelectTree,
        onSelectFeature,
      });
    } catch (error) {
      console.warn('MapLibre terrain unavailable; falling back to Leaflet:', error);
      selection = Object.freeze({
        renderer: 'leaflet',
        requested: requestedSelection.requested,
        fallbackReason: 'terrain-initialization-failed',
      });
      element.replaceChildren();
      element.removeAttribute('class');
    }
  }

  if (!adapter) {
    const { createLeafletSpatialAdapter } = await import('./map.js');
    adapter = createLeafletSpatialAdapter(element, graph, world, {
      language,
      onSelectPlace,
      onLocationError,
    });
  }

  element.dataset.spatialRenderer = selection.renderer;
  element.dataset.spatialPreference = selection.requested;
  if (selection.fallbackReason) element.dataset.spatialFallbackReason = selection.fallbackReason;
  else delete element.dataset.spatialFallbackReason;
  return createSpatialController(adapter, selection, capabilities);
}

export { LEAFLET_OVERLAY_COMPATIBILITY };
