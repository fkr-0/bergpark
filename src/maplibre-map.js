import { Map as MapLibreMap, Marker, NavigationControl } from 'maplibre-gl';
import { localized } from './i18n.js';
import { moveMapLibreCamera, prefersReducedMotion } from './motion-policy.js';

const TERRAIN_PATH = 'terrain/dgm1-terrarium/';
const TERRAIN_SOURCE_ID = 'terrain-dem';
const HILLSHADE_SOURCE_ID = 'terrain-hillshade-dem';

// Side-on cascades acceptance control derived from the user-visible regression
// evidence: Neptunbassin is the lower/eastern end; Herkules is upper/western.
export const CASCADES_TERRAIN_CONTROL = Object.freeze({
  lower: Object.freeze({ id: 'neptunbassin', lng: 9.397959, lat: 51.315852 }),
  upper: Object.freeze({ id: 'herkules', lng: 9.3932069, lat: 51.3161018 }),
  minRiseM: 60,
});
const EXPECTED_PHASE3_ARTIFACT_SHA256 = 'cdff4e9d51f8bb1679b6a0e4f9ca6c1aeaa603488644faedafe3685e74989b4b';
const EXPECTED_PHASE3_SOURCE_MANIFEST_SHA256 = 'aa6d1ed921fc51321180c1367d42975fe86e8b906e1dacce54b781c45fc9946e';
const EMPTY_FEATURE_COLLECTION = Object.freeze({ type: 'FeatureCollection', features: [] });

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function terrainRiseSanity(lowerElevation, upperElevation, minRiseM = CASCADES_TERRAIN_CONTROL.minRiseM) {
  const lowerM = lowerElevation == null ? null : finite(lowerElevation);
  const upperM = upperElevation == null ? null : finite(upperElevation);
  const riseM = lowerM == null || upperM == null ? null : upperM - lowerM;
  return {
    ok: riseM != null && riseM >= minRiseM,
    lowerM,
    upperM,
    riseM,
    minRiseM,
  };
}

function assetBaseUrl(baseUrl = null) {
  if (baseUrl) return new URL(baseUrl, globalThis.document?.baseURI ?? 'http://localhost/').href;
  const documentBase = globalThis.document?.baseURI ?? globalThis.location?.href ?? 'http://localhost/';
  const viteBase = import.meta.env?.BASE_URL ?? './';
  return new URL(viteBase, documentBase).href;
}

export function validateTerrainManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new TypeError('terrain manifest is missing');
  if (manifest.format !== 'maplibre-raster-dem-terrarium-v1') throw new Error('unsupported terrain derivative format');
  if (manifest.encoding !== 'terrarium' || manifest.tile_size !== 256) throw new Error('invalid terrain tile encoding');
  if (JSON.stringify(manifest.zooms) !== JSON.stringify([14, 15, 16])) throw new Error('terrain zoom pyramid is not the bounded z14-z16 authority');
  if (manifest.tile_count !== 56 || manifest.tile_bytes > manifest.max_derivative_bytes) throw new Error('terrain derivative exceeds bounded tile/size contract');
  if (manifest.vertical_units !== 'metres' || manifest.terrain_exaggeration !== 1) throw new Error('terrain unit/exaggeration contract drifted');
  const bounds = manifest.renderer_bounds_wgs84;
  if (!Array.isArray(bounds) || bounds.length !== 4 || bounds.some((value) => finite(value) == null)) throw new Error('terrain renderer bounds are invalid');
  if (!(bounds[0] < bounds[2] && bounds[1] < bounds[3])) throw new Error('terrain renderer bounds are inverted');
  if (manifest.provenance?.phase3_artifact?.sha256 !== EXPECTED_PHASE3_ARTIFACT_SHA256) throw new Error('terrain derivative lost Phase-3 artifact authority');
  if (manifest.provenance?.phase3_source_manifest?.sha256 !== EXPECTED_PHASE3_SOURCE_MANIFEST_SHA256) throw new Error('terrain derivative lost Phase-3 source authority');
  const camera = manifest.camera ?? {};
  if (!(camera.min_zoom >= 12 && camera.max_zoom <= 19 && camera.min_zoom < camera.max_zoom)) throw new Error('terrain camera zoom limits are unsafe');
  if (!(camera.initial_pitch_deg >= 0 && camera.initial_pitch_deg <= camera.max_pitch_deg && camera.max_pitch_deg <= 60)) throw new Error('terrain pitch limits are unsafe');
  return manifest;
}

export async function loadTerrainManifest({ fetchFn = globalThis.fetch?.bind(globalThis), baseUrl = null } = {}) {
  if (typeof fetchFn !== 'function') throw new Error('fetch unavailable for local terrain manifest');
  const url = `${assetBaseUrl(baseUrl)}${TERRAIN_PATH}manifest.json`;
  const response = await fetchFn(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`terrain manifest unavailable (${response.status})`);
  return validateTerrainManifest(await response.json());
}

function terrainAttribution(manifest) {
  const attribution = manifest.attribution ?? {};
  const productUrl = attribution.product_url || 'https://hvbg.hessen.de/landesvermessung/geotopographie/3d-daten/digitale-gelaendemodelle';
  const licenseUrl = attribution.license_url || 'https://www.govdata.de/dl-de/zero-2-0';
  return `Terrain: <a href="${productUrl}">HVBG ${attribution.dataset ?? 'ATKIS-DGM1'}</a> · <a href="${licenseUrl}">${attribution.license ?? 'dl-zero-de/2.0'}</a>`;
}

function emptyData() {
  return { type: 'FeatureCollection', features: [] };
}

export function buildTerrainStyle(manifest, { baseUrl = null } = {}) {
  validateTerrainManifest(manifest);
  const base = assetBaseUrl(baseUrl);
  const tileUrl = `${base}${manifest.tile_url_template}`;
  const [minzoom, , maxzoom] = manifest.zooms;
  return {
    version: 8,
    sources: {
      'osm-raster': {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
      // Terrain mesh and hillshade intentionally use independent raster-dem
      // source caches backed by the same immutable local DGM1 bytes. This follows
      // MapLibre's 3D-terrain pattern and prevents mesh/hillshade cache crosstalk.
      [TERRAIN_SOURCE_ID]: {
        type: 'raster-dem',
        tiles: [tileUrl],
        tileSize: manifest.tile_size,
        encoding: manifest.encoding,
        minzoom,
        maxzoom,
        bounds: manifest.renderer_bounds_wgs84,
        attribution: terrainAttribution(manifest),
      },
      [HILLSHADE_SOURCE_ID]: {
        type: 'raster-dem',
        tiles: [tileUrl],
        tileSize: manifest.tile_size,
        encoding: manifest.encoding,
        minzoom,
        maxzoom,
        bounds: manifest.renderer_bounds_wgs84,
      },
      'walking-network': { type: 'geojson', data: emptyData() },
      'active-route': { type: 'geojson', data: emptyData() },
      'terrain-trees': { type: 'geojson', data: emptyData() },
      'terrain-visitor-features': { type: 'geojson', data: emptyData() },
      'user-position': { type: 'geojson', data: emptyData() },
    },
    terrain: { source: TERRAIN_SOURCE_ID, exaggeration: manifest.terrain_exaggeration },
    layers: [
      { id: 'osm-raster', type: 'raster', source: 'osm-raster' },
      {
        id: 'terrain-hillshade',
        type: 'hillshade',
        source: HILLSHADE_SOURCE_ID,
        paint: { 'hillshade-exaggeration': 0.28, 'hillshade-shadow-color': '#294338', 'hillshade-highlight-color': '#f4f0df' },
      },
      {
        id: 'walking-network',
        type: 'line',
        source: 'walking-network',
        paint: { 'line-color': '#365b49', 'line-width': 2, 'line-opacity': 0.42 },
      },
      {
        id: 'active-route',
        type: 'line',
        source: 'active-route',
        paint: { 'line-color': '#d39b36', 'line-width': 6, 'line-opacity': 0.95 },
      },
      {
        id: 'terrain-trees',
        type: 'circle',
        source: 'terrain-trees',
        paint: { 'circle-radius': 4, 'circle-color': '#245f3f', 'circle-stroke-color': '#f7f2e5', 'circle-stroke-width': 1.5 },
      },
      {
        id: 'terrain-visitor-features',
        type: 'circle',
        source: 'terrain-visitor-features',
        paint: { 'circle-radius': 5, 'circle-color': '#765d2f', 'circle-stroke-color': '#fffdf7', 'circle-stroke-width': 1.5 },
      },
      {
        id: 'user-accuracy',
        type: 'fill',
        source: 'user-position',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': '#236dd1', 'fill-opacity': 0.1 },
      },
      {
        id: 'user-position',
        type: 'circle',
        source: 'user-position',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': 7, 'circle-color': '#236dd1', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 },
      },
    ],
  };
}

function pointFeature(descriptor) {
  const { lng, lat } = descriptor.position ?? {};
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return {
    type: 'Feature',
    properties: {
      id: descriptor.id,
      kind: descriptor.kind,
      category: descriptor.presentation?.category ?? '',
    },
    geometry: { type: 'Point', coordinates: [lng, lat] },
  };
}

function featureCollection(features) {
  return { type: 'FeatureCollection', features: features.filter(Boolean) };
}

export function supplementalFeatureCollections(world, {
  treeVisible = false,
  treeFilterIds = null,
  visitorKinds = new Set(),
} = {}) {
  const allowedTrees = treeFilterIds ? new Set(treeFilterIds) : null;
  const trees = treeVisible
    ? (world?.trees ?? []).filter(({ id }) => !allowedTrees || allowedTrees.has(id)).map(pointFeature)
    : [];
  const visitors = (world?.visitorFeatures ?? [])
    .filter((feature) => visitorKinds.has(feature.presentation?.category))
    .map(pointFeature);
  return {
    trees: featureCollection(trees),
    visitors: featureCollection(visitors),
  };
}

function routeData(route) {
  const coordinates = route?.coordinates?.map(({ lng, lat }) => [lng, lat]).filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat)) ?? [];
  if (coordinates.length < 2) return emptyData();
  return featureCollection([{
    type: 'Feature',
    properties: { id: route.id ?? '' },
    geometry: { type: 'LineString', coordinates },
  }]);
}

function walkingData(network) {
  const features = (network?.segments ?? []).map((segment, index) => ({
    type: 'Feature',
    properties: { id: `walking-${index}`, steps: segment.steps === true },
    geometry: {
      type: 'LineString',
      coordinates: segment.coordinates?.map(({ lng, lat }) => [lng, lat]) ?? [],
    },
  })).filter(({ geometry }) => geometry.coordinates.length >= 2);
  return featureCollection(features);
}

function accuracyPolygon(position) {
  const accuracy = Math.min(Math.max(finite(position?.accuracy) ?? 0, 0), 150);
  if (!accuracy) return null;
  const lat = finite(position.lat);
  const lng = finite(position.lng);
  if (lat == null || lng == null) return null;
  const earthRadius = 6_371_008.8;
  const latRadians = lat * Math.PI / 180;
  const points = [];
  for (let index = 0; index <= 32; index += 1) {
    const angle = index / 32 * Math.PI * 2;
    const dLat = Math.sin(angle) * accuracy / earthRadius * 180 / Math.PI;
    const dLng = Math.cos(angle) * accuracy / (earthRadius * Math.cos(latRadians)) * 180 / Math.PI;
    points.push([lng + dLng, lat + dLat]);
  }
  return {
    type: 'Feature',
    properties: { kind: 'accuracy' },
    geometry: { type: 'Polygon', coordinates: [points] },
  };
}

function userData(position) {
  const lat = finite(position?.lat);
  const lng = finite(position?.lng);
  if (lat == null || lng == null) return emptyData();
  const point = {
    type: 'Feature',
    properties: { kind: 'user' },
    geometry: { type: 'Point', coordinates: [lng, lat] },
  };
  return featureCollection([accuracyPolygon(position), point]);
}

function boundsFromCoordinates(coordinates) {
  if (!coordinates.length) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lng, lat] of coordinates) {
    west = Math.min(west, lng);
    south = Math.min(south, lat);
    east = Math.max(east, lng);
    north = Math.max(north, lat);
  }
  return [[west, south], [east, north]];
}

function cameraEnvelope(bounds) {
  const [west, south, east, north] = bounds;
  const padLng = Math.max(0.003, (east - west) * 0.18);
  const padLat = Math.max(0.002, (north - south) * 0.18);
  return [[west - padLng, south - padLat], [east + padLng, north + padLat]];
}

function sourceSetData(map, id, data) {
  const source = map.getSource(id);
  if (source && typeof source.setData === 'function') source.setData(data);
}

function isTerrainSourceError(event) {
  const sourceId = event?.sourceId ?? event?.source?.id ?? event?.source?.sourceId;
  if (sourceId === 'terrain-dem') return true;
  return String(event?.error?.message ?? '').includes('terrain-dem');
}

export async function createMapLibreTerrainSpatialAdapter(element, graph, initialWorld, {
  language = 'de',
  onSelectPlace,
  onSelectTree,
  onSelectFeature,
  fetchFn,
  baseUrl,
} = {}) {
  await import('maplibre-gl/dist/maplibre-gl.css');
  const manifest = await loadTerrainManifest({ fetchFn, baseUrl });
  const camera = manifest.camera;
  const rendererBounds = manifest.renderer_bounds_wgs84;
  const center = [
    (rendererBounds[0] + rendererBounds[2]) / 2,
    (rendererBounds[1] + rendererBounds[3]) / 2,
  ];
  const reducedMotion = prefersReducedMotion();
  const style = buildTerrainStyle(manifest, { baseUrl });
  let currentLanguage = language;
  let world = initialWorld;
  let treeVisible = false;
  let treeFilterIds = null;
  let visitorKinds = new Set();
  let walkingNetwork = null;
  let activeRoute = null;
  let userPosition = null;
  let terrainEnabled = true;
  let terrainVerified = false;
  let destroyed = false;
  let heritageLayer = null;
  let heritageInstallPromise = null;
  let heritageDisabled = false;
  let heritageContextLost = false;
  const placeMarkers = new globalThis.Map();
  const nodeLookup = graph.nodesById ?? new globalThis.Map((graph.nodes ?? []).map((node) => [node.id, node]));

  const map = new MapLibreMap({
    container: element,
    style,
    center,
    zoom: camera.min_zoom + 0.75,
    pitch: camera.initial_pitch_deg,
    bearing: camera.initial_bearing_deg,
    minZoom: camera.min_zoom,
    maxZoom: camera.max_zoom,
    maxPitch: camera.max_pitch_deg,
    maxBounds: cameraEnvelope(rendererBounds),
    renderWorldCopies: false,
    fadeDuration: reducedMotion ? 0 : 300,
    attributionControl: true,
  });
  // MapLibre begins source loading during construction. Register the terrain
  // failure boundary immediately so a fast DEM error cannot race ahead of the
  // later interaction/source wiring and leave the UI claiming terrain is live.
  map.on('error', (event) => {
    if (!terrainEnabled || !isTerrainSourceError(event)) return;
    terrainEnabled = false;
    try {
      map.setTerrain(null);
    } catch {
      // The flat MapLibre fallback remains usable even if style teardown raced.
    }
    element.dataset.spatialTerrainState = 'flat-fallback';
    element.dataset.spatialTerrainError = 'terrain-source-unavailable';
    heritageLayer?.setTerrainAvailable?.(false);
    disableHeritageLayer('terrain-unavailable', 'terrain-source-unavailable');
  });
  map.addControl(new NavigationControl({ showCompass: true, showZoom: true, visualizePitch: true }), 'bottom-right');

  function activateTerrain() {
    if (!terrainEnabled || destroyed) return false;
    try {
      map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: manifest.terrain_exaggeration });
      terrainVerified = false;
      element.dataset.spatialTerrainReady = 'pending';
      element.dataset.spatialTerrainVerified = 'pending';
      return true;
    } catch {
      return false;
    }
  }

  function verifyTerrainRise() {
    if (!terrainEnabled || terrainVerified || destroyed || typeof map.queryTerrainElevation !== 'function') return false;
    const lower = map.queryTerrainElevation(
      [CASCADES_TERRAIN_CONTROL.lower.lng, CASCADES_TERRAIN_CONTROL.lower.lat],
      { exaggerated: false },
    );
    const upper = map.queryTerrainElevation(
      [CASCADES_TERRAIN_CONTROL.upper.lng, CASCADES_TERRAIN_CONTROL.upper.lat],
      { exaggerated: false },
    );
    const sanity = terrainRiseSanity(lower, upper);
    // A control tile may not be resident yet. Stay pending instead of producing a
    // false failure; source errors still go through the existing fail-closed path.
    if (sanity.lowerM == null || sanity.upperM == null) return false;

    element.dataset.spatialTerrainLowerM = sanity.lowerM.toFixed(3);
    element.dataset.spatialTerrainUpperM = sanity.upperM.toFixed(3);
    element.dataset.spatialTerrainRiseM = sanity.riseM.toFixed(3);
    if (!sanity.ok) {
      terrainEnabled = false;
      try { map.setTerrain(null); } catch { /* flat fallback remains usable */ }
      element.dataset.spatialTerrainState = 'flat-fallback';
      element.dataset.spatialTerrainReady = 'flat';
      element.dataset.spatialTerrainVerified = 'failed';
      element.dataset.spatialTerrainError = 'terrain-elevation-direction-invalid';
      heritageLayer?.setTerrainAvailable?.(false);
      disableHeritageLayer('terrain-unavailable', 'terrain-elevation-direction-invalid');
      return false;
    }

    terrainVerified = true;
    element.dataset.spatialTerrainReady = 'true';
    element.dataset.spatialTerrainVerified = 'cascades-rise';
    delete element.dataset.spatialTerrainError;
    if (typeof map.setCenterElevation === 'function') {
      const centerElevation = map.queryTerrainElevation(map.getCenter(), { exaggerated: false });
      if (Number.isFinite(centerElevation)) map.setCenterElevation(centerElevation);
    }
    return true;
  }

  element.dataset.terrainEncoding = manifest.encoding;
  element.dataset.terrainTileCount = String(manifest.tile_count);
  element.dataset.terrainTileBytes = String(manifest.tile_bytes);
  element.dataset.terrainZooms = manifest.zooms.join(',');
  element.dataset.terrainVerticalUnits = manifest.vertical_units;
  element.dataset.terrainExaggeration = String(manifest.terrain_exaggeration);
  element.dataset.spatialTerrainState = 'terrain';
  element.dataset.spatialTerrainReady = 'pending';
  element.dataset.spatialTerrainVerified = 'pending';
  element.dataset.spatialHeritageId = 'aquaedukt';
  element.dataset.spatialHeritageLayer = 'terrain-heritage-aquaedukt';
  element.dataset.spatialHeritageDepth = 'shared';
  element.dataset.spatialHeritageAnimation = 'none';
  element.dataset.spatialHeritageState = 'pending';

  function removeHeritageLayer() {
    const layer = heritageLayer;
    heritageLayer = null;
    if (!layer) return;
    try {
      if (map.getLayer(layer.id)) map.removeLayer(layer.id);
    } catch {
      // Map/style teardown may already have removed the custom layer.
    }
    layer.dispose?.();
  }

  function disableHeritageLayer(state, reason = null) {
    heritageDisabled = true;
    element.dataset.spatialHeritageState = state;
    if (reason) element.dataset.spatialHeritageError = reason;
    removeHeritageLayer();
  }

  function applyHeritageState(event) {
    if (!event || destroyed) return;
    // MapLibre 6 destroys its style on WebGL loss and invokes custom-layer
    // onRemove before it emits webglcontextlost. Adapter authority therefore
    // owns the visible recovery state; transient style removal is not a user
    // failure and must not overwrite context-lost/restoring/fallback states.
    if (['removed', 'disposed'].includes(event.state)) return;
    element.dataset.spatialHeritageState = event.state;
    element.dataset.spatialHeritageId = event.nodeId;
    element.dataset.spatialHeritageLayer = event.layerId;
    element.dataset.spatialHeritageDepth = event.renderingMode === '3d' ? 'shared' : 'isolated';
    element.dataset.spatialHeritageAnimation = event.animation;
    element.dataset.spatialHeritageDisplayOffsetM = String(event.displayOffsetM);
    if (Number.isFinite(event.modelMetresPerUnit)) {
      element.dataset.spatialHeritageModelMetresPerUnit = String(event.modelMetresPerUnit);
    }
    if (event.modelSource) element.dataset.spatialHeritageModelSource = event.modelSource;
    if (Number.isFinite(event.modelBytes)) element.dataset.spatialHeritageModelBytes = String(event.modelBytes);
    if (Number.isFinite(event.modelTriangles)) element.dataset.spatialHeritageModelTriangles = String(event.modelTriangles);
    if (typeof event.rendered === 'boolean') element.dataset.spatialHeritageRendered = String(event.rendered);
    if (event.reason) element.dataset.spatialHeritageError = event.reason;
    else delete element.dataset.spatialHeritageError;
    if (event.state === 'unavailable') {
      const reason = event.reason ?? 'shared-depth-initialization-failed';
      queueMicrotask(() => {
        if (!destroyed) disableHeritageLayer('unavailable', reason);
      });
    }
  }

  async function ensureHeritageLayer() {
    if (destroyed || heritageDisabled || heritageContextLost) return heritageLayer;
    if (heritageLayer) {
      if (!map.getLayer(heritageLayer.id)) map.addLayer(heritageLayer);
      return heritageLayer;
    }
    if (heritageInstallPromise) return heritageInstallPromise;
    heritageInstallPromise = (async () => {
      const module = await import('./maplibre-heritage-layer.js');
      if (destroyed || heritageDisabled) return null;
      const node = nodeLookup.get(module.SHARED_DEPTH_HERITAGE_ID);
      const layer = module.createMapLibreHeritageSharedDepthLayer({
        node,
        world,
        onStateChange: applyHeritageState,
      });
      if (destroyed || heritageDisabled) {
        layer.dispose();
        return null;
      }
      heritageLayer = layer;
      if (!map.getLayer(layer.id)) map.addLayer(layer);
      return layer;
    })().catch((error) => {
      const reason = error instanceof Error ? error.message : String(error);
      if (!destroyed) disableHeritageLayer('unavailable', reason);
      return null;
    }).finally(() => {
      heritageInstallPromise = null;
    });
    return heritageInstallPromise;
  }

  function markerLabel(id) {
    const node = nodeLookup.get(id);
    return localized(node?.name, currentLanguage, node?.title ?? id);
  }

  function syncPlaceMarkers() {
    const nextIds = new Set((world?.places ?? []).map(({ id }) => id));
    for (const [id, record] of placeMarkers) {
      if (nextIds.has(id)) continue;
      record.marker.remove();
      placeMarkers.delete(id);
    }
    for (const place of world?.places ?? []) {
      const existing = placeMarkers.get(place.id);
      if (existing) {
        existing.button.setAttribute('aria-label', markerLabel(place.id));
        existing.button.title = markerLabel(place.id);
        existing.marker.setLngLat([place.position.lng, place.position.lat]);
        continue;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'maplibre-place-marker';
      button.dataset.placeId = place.id;
      button.setAttribute('aria-label', markerLabel(place.id));
      button.title = markerLabel(place.id);
      button.innerHTML = '<span aria-hidden="true">●</span>';
      button.addEventListener('click', () => onSelectPlace?.(place.id));
      const marker = new Marker({ element: button, anchor: 'bottom' })
        .setLngLat([place.position.lng, place.position.lat])
        .addTo(map);
      placeMarkers.set(place.id, { marker, button });
    }
  }

  function syncSupplementalSources() {
    const collections = supplementalFeatureCollections(world, { treeVisible, treeFilterIds, visitorKinds });
    sourceSetData(map, 'terrain-trees', collections.trees);
    sourceSetData(map, 'terrain-visitor-features', collections.visitors);
  }

  function syncSources() {
    if (destroyed) return;
    syncPlaceMarkers();
    syncSupplementalSources();
    sourceSetData(map, 'walking-network', walkingData(walkingNetwork));
    sourceSetData(map, 'active-route', routeData(activeRoute));
    sourceSetData(map, 'user-position', userData(userPosition));
  }

  const sourceLayers = ['terrain-trees', 'terrain-visitor-features'];
  for (const layer of sourceLayers) {
    map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
  }
  map.on('click', 'terrain-trees', (event) => {
    const id = event.features?.[0]?.properties?.id;
    if (id) onSelectTree?.(String(id));
  });
  map.on('click', 'terrain-visitor-features', (event) => {
    const id = event.features?.[0]?.properties?.id;
    if (id) onSelectFeature?.(String(id));
  });
  map.on('webglcontextlost', () => {
    if (destroyed || heritageDisabled) return;
    heritageContextLost = true;
    terrainVerified = false;
    element.dataset.spatialTerrainReady = 'pending';
    element.dataset.spatialTerrainVerified = 'pending';
    element.dataset.spatialHeritageState = 'context-lost';
    element.dataset.spatialHeritageRendered = 'false';
  });
  map.on('webglcontextrestored', () => {
    if (destroyed || heritageDisabled) return;
    heritageContextLost = false;
    terrainVerified = false;
    element.dataset.spatialHeritageState = 'restoring';
    element.dataset.spatialHeritageRendered = 'false';
    // MapLibre calls setStyle() before this event; its subsequent style.load
    // is the safe point at which a custom layer can be manually re-added.
  });
  map.on('style.load', () => {
    if (terrainEnabled) activateTerrain();
    syncSources();
    void ensureHeritageLayer();
  });
  map.on('load', () => {
    if (terrainEnabled) activateTerrain();
    syncSources();
    void ensureHeritageLayer();
  });
  map.on('idle', () => {
    if (!destroyed && terrainEnabled && !terrainVerified) verifyTerrainRise();
  });
  syncPlaceMarkers();

  return {
    fitWorld() {
      map.fitBounds([[rendererBounds[0], rendererBounds[1]], [rendererBounds[2], rendererBounds[3]]], {
        padding: 36,
        maxZoom: camera.fit_max_zoom,
        pitch: camera.initial_pitch_deg,
        bearing: camera.initial_bearing_deg,
        duration: 0,
      });
      return true;
    },
    focusPlace(id, { zoom = true } = {}) {
      const place = world?.placesById?.get(id);
      if (!place) return false;
      moveMapLibreCamera(map, {
        center: [place.position.lng, place.position.lat],
        zoom: zoom ? Math.max(map.getZoom(), 16) : map.getZoom(),
        pitch: camera.initial_pitch_deg,
        bearing: camera.initial_bearing_deg,
      }, { duration: 0.6 });
      return true;
    },
    focusPosition(position, { zoom = null, minZoom = null, duration = 0.35 } = {}) {
      if (!Number.isFinite(position?.lng) || !Number.isFinite(position?.lat)) return false;
      const targetZoom = Number.isFinite(zoom)
        ? zoom
        : Math.max(map.getZoom(), Number.isFinite(minZoom) ? minZoom : map.getZoom());
      moveMapLibreCamera(map, {
        center: [position.lng, position.lat],
        zoom: Math.min(camera.max_zoom, targetZoom),
        pitch: camera.initial_pitch_deg,
        bearing: camera.initial_bearing_deg,
      }, { duration });
      return true;
    },
    showRoute(routeDescriptor) {
      const coordinates = routeDescriptor?.coordinates?.map(({ lng, lat }) => [lng, lat]).filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat)) ?? [];
      if (coordinates.length < 2) return false;
      activeRoute = routeDescriptor;
      sourceSetData(map, 'active-route', routeData(activeRoute));
      const routeBounds = boundsFromCoordinates(coordinates);
      if (routeBounds) {
        map.fitBounds(routeBounds, {
          padding: { top: 130, right: 24, bottom: 110, left: 24 },
          maxZoom: 17,
          pitch: camera.initial_pitch_deg,
          bearing: camera.initial_bearing_deg,
          duration: reducedMotion ? 0 : 350,
        });
      }
      return true;
    },
    clearRoute() {
      activeRoute = null;
      sourceSetData(map, 'active-route', EMPTY_FEATURE_COLLECTION);
    },
    setWalkingNetwork(network) {
      walkingNetwork = network;
      sourceSetData(map, 'walking-network', walkingData(walkingNetwork));
      element.dataset.walkingNetworkSegments = String(network?.segments?.length ?? 0);
      element.dataset.walkingNetworkNodes = String(network?.counts?.path_nodes ?? '');
      element.dataset.walkingNetworkDirectedSegments = String(network?.counts?.directed_segments ?? '');
      return Boolean(network?.segments?.length);
    },
    setUserPosition(position) {
      userPosition = position;
      sourceSetData(map, 'user-position', userData(position));
    },
    setWorld(nextWorld) {
      world = nextWorld;
      syncSources();
      heritageLayer?.setWorld?.(world);
      return true;
    },
    setTreeVisibility(visible) {
      treeVisible = Boolean(visible);
      syncSupplementalSources();
    },
    setTreeFilter(ids) {
      treeFilterIds = ids == null ? null : new Set(ids);
      syncSupplementalSources();
    },
    setVisitorKinds(kinds) {
      visitorKinds = new Set(kinds ?? []);
      syncSupplementalSources();
    },
    setLanguage(nextLanguage) {
      currentLanguage = nextLanguage;
      syncPlaceMarkers();
    },
    invalidate() {
      map.resize();
    },
    compatibilitySurface() {
      return null;
    },
    destroy() {
      destroyed = true;
      heritageDisabled = true;
      removeHeritageLayer();
      for (const { marker } of placeMarkers.values()) marker.remove();
      placeMarkers.clear();
      map.remove();
    },
  };
}
