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

export function detectSpatialCapabilities({ documentRef = globalThis.document, navigatorRef = globalThis.navigator } = {}) {
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
    terrain: false,
    webgl2,
    reducedPower,
  });
}

export function selectSpatialRenderer({ preference = 'auto', capabilities = {} } = {}) {
  const requested = normalizeSpatialPreference(preference);
  if (requested === 'leaflet') return Object.freeze({ renderer: 'leaflet', requested, fallbackReason: null });
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
    setLanguage: requireAdapterMethod(adapter, 'setLanguage'),
    invalidate: requireAdapterMethod(adapter, 'invalidate'),
    destroy: requireAdapterMethod(adapter, 'destroy'),
    compatibilitySurface(name) {
      if (name !== LEAFLET_OVERLAY_COMPATIBILITY) return null;
      return adapter.compatibilitySurface?.(name) ?? null;
    },
  });
}

export async function createBrowserSpatialController({ element, graph, world, language, onSelectPlace, onLocationError }) {
  let storage = null;
  try {
    storage = globalThis.localStorage;
  } catch {
    storage = null;
  }
  const preference = readSpatialPreference({ search: globalThis.location?.search ?? '', storage });
  const capabilities = detectSpatialCapabilities();
  const selection = selectSpatialRenderer({ preference, capabilities });

  // Slice 0 intentionally has exactly one production renderer. Keeping the
  // choice here prevents orchestration from importing Leaflet or renderer handles.
  const { createLeafletSpatialAdapter } = await import('./map.js');
  const adapter = createLeafletSpatialAdapter(element, graph, world, {
    language,
    onSelectPlace,
    onLocationError,
  });
  element.dataset.spatialRenderer = selection.renderer;
  element.dataset.spatialPreference = selection.requested;
  if (selection.fallbackReason) element.dataset.spatialFallbackReason = selection.fallbackReason;
  else delete element.dataset.spatialFallbackReason;
  return createSpatialController(adapter, selection, capabilities);
}

export { LEAFLET_OVERLAY_COMPATIBILITY };
