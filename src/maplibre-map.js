import { Map as MapLibreMap, Marker, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { localized } from './i18n.js';
import { moveMapLibreCamera, prefersReducedMotion } from './motion-policy.js';

setWorkerUrl(mapLibreWorkerUrl);

const TERRAIN_PATH = 'terrain/dgm1-terrarium/';
const TERRAIN_SOURCE_ID = 'terrain-dem';
const HILLSHADE_SOURCE_ID = 'terrain-hillshade-dem';
const TERRAIN_VERIFY_INTERVAL_MS = 250;
const TERRAIN_VERIFY_MAX_ATTEMPTS = 48;
const TERRAIN_MIN_PLAUSIBLE_ELEVATION_M = 150;

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
  if (lowerM == null || upperM == null) return { ok: false, reason: 'pending', lowerM, upperM, riseM: null };
  if (lowerM < TERRAIN_MIN_PLAUSIBLE_ELEVATION_M || upperM < TERRAIN_MIN_PLAUSIBLE_ELEVATION_M) {
    return { ok: false, reason: 'pending', lowerM, upperM, riseM: upperM - lowerM };
  }
  const riseM = upperM - lowerM;
  if (riseM < minRiseM) return { ok: false, reason: riseM < 0 ? 'inverted' : 'flat', lowerM, upperM, riseM };
  return { ok: true, reason: 'cascades-rise', lowerM, upperM, riseM };
}

export function validateTerrainManifest(manifest) {
  if (!manifest || manifest.schema_version !== 1 || manifest.format !== 'maplibre-raster-dem-terrarium-v1') throw new Error('unsupported terrain manifest');
  if (manifest.encoding !== 'terrarium' || manifest.tile_size !== 256) throw new Error('terrain encoding/tile size drifted');
  if (JSON.stringify(manifest.zooms) !== JSON.stringify([13, 14, 15, 16])) throw new Error('terrain zoom pyramid is not the bounded z13-z16 authority');
  if (manifest.tile_count !== 60 || manifest.tile_bytes > manifest.max_derivative_bytes) throw new Error('terrain derivative exceeds bounded tile/size contract');
  if (manifest.vertical_units !== 'metres' || manifest.terrain_exaggeration !== 1) throw new Error('terrain unit/exaggeration contract drifted');
  const bounds = manifest.renderer_bounds_wgs84;
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite) || bounds[0] >= bounds[2] || bounds[1] >= bounds[3]) throw new Error('terrain bounds invalid');
  if (manifest.provenance?.phase3_artifact?.sha256 !== EXPECTED_PHASE3_ARTIFACT_SHA256) throw new Error('terrain derivative lost Phase-3 artifact authority');
  if (manifest.provenance?.phase3_source_manifest?.sha256 !== EXPECTED_PHASE3_SOURCE_MANIFEST_SHA256) throw new Error('terrain derivative lost Phase-3 source authority');
  const camera = manifest.camera ?? {};
  if (!(camera.min_zoom >= 12 && camera.max_zoom <= 19 && camera.min_zoom < camera.max_zoom)) throw new Error('terrain camera zoom limits are unsafe');
  if (!(camera.initial_pitch_deg >= 0 && camera.initial_pitch_deg <= camera.max_pitch_deg && camera.max_pitch_deg <= 70)) throw new Error('terrain camera pitch limits are unsafe');
  return manifest;
}

export function buildTerrainStyle(manifest, { baseUrl = import.meta.env.BASE_URL } = {}) {
  const terrain = validateTerrainManifest(manifest);
  const base = new URL(baseUrl, window.location.origin).href;
  const tileUrl = `${base}${terrain.tile_url_template}`;
  const [minzoom, , , maxzoom] = terrain.zooms;
  const attribution = `${terrain.attribution.provider} · ${terrain.attribution.dataset} · <a href="${terrain.attribution.license_url}" target="_blank" rel="noreferrer">${terrain.attribution.license}</a>`;
  const demSource = {
    type: 'raster-dem',
    tiles: [tileUrl],
    tileSize: terrain.tile_size,
    encoding: terrain.encoding,
    minzoom,
    maxzoom,
    bounds: terrain.renderer_bounds_wgs84,
    attribution,
  };
  return {
    version: 8,
    sources: {
      'osm-base': {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
      },
      [TERRAIN_SOURCE_ID]: { ...demSource },
      [HILLSHADE_SOURCE_ID]: { ...demSource },
    },
    terrain: {
      source: TERRAIN_SOURCE_ID,
      exaggeration: terrain.terrain_exaggeration,
    },
    layers: [
      { id: 'osm-base', type: 'raster', source: 'osm-base', minzoom: 0, maxzoom: 20 },
      {
        id: 'terrain-hillshade',
        type: 'hillshade',
        source: HILLSHADE_SOURCE_ID,
        paint: {
          'hillshade-exaggeration': 0.3,
          'hillshade-shadow-color': '#6b5d48',
          'hillshade-highlight-color': '#f5f1e6',
          'hillshade-accent-color': '#9a8b70',
        },
      },
    ],
  };
}

function featureCollection(features) {
  return { type: 'FeatureCollection', features };
}

function pointFeature(id, position, properties = {}) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [position.lng, position.lat] },
    properties: { id, ...properties },
  };
}

export function supplementalFeatureCollections(world, options = {}) {
  const treeFilterIds = new Set(options.treeFilterIds ?? []);
  const visitorKinds = options.visitorKinds instanceof Set ? options.visitorKinds : new Set(options.visitorKinds ?? []);
  const trees = options.treeVisible
    ? world.trees
      .filter((tree) => treeFilterIds.size === 0 || treeFilterIds.has(tree.id))
      .map((tree) => pointFeature(tree.id, tree.position))
    : [];
  const visitors = visitorKinds.size
    ? world.visitorFeatures
      .filter((feature) => visitorKinds.has(feature.presentation?.category))
      .map((feature) => pointFeature(feature.id, feature.position, { category: feature.presentation?.category }))
    : [];
  return { trees: featureCollection(trees), visitors: featureCollection(visitors) };
}

function addGeoJsonSource(map, id, data = EMPTY_FEATURE_COLLECTION) {
  if (map.getSource(id)) return;
  map.addSource(id, { type: 'geojson', data });
}

function addCircleLayer(map, id, source, paint) {
  if (map.getLayer(id)) return;
  map.addLayer({ id, type: 'circle', source, paint });
}

function markerElement(descriptor) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `bergpark-marker bergpark-marker--${descriptor.kind}`;
  button.dataset.nodeId = descriptor.id;
  button.setAttribute('aria-label', descriptor.title);
  button.title = descriptor.title;
  return button;
}

function normalizedPosition(value) {
  if (!value || typeof value !== 'object') return null;
  const lng = finite(value.lng);
  const lat = finite(value.lat);
  return lng == null || lat == null ? null : { lng, lat };
}

function markerDescriptor(entity, i18n) {
  const position = normalizedPosition(entity.position);
  if (!position) return null;
  return {
    id: entity.id,
    kind: entity.kind,
    title: localized(entity.name, i18n.language, entity.id),
    position,
  };
}

function updateMarker(marker, descriptor, selectedId) {
  const element = marker.getElement();
  element.classList.toggle('is-selected', descriptor.id === selectedId);
  element.setAttribute('aria-pressed', descriptor.id === selectedId ? 'true' : 'false');
}

function applySupplementalCollections(map, world, options) {
  const collections = supplementalFeatureCollections(world, options);
  map.getSource('supplemental-trees')?.setData(collections.trees);
  map.getSource('supplemental-visitors')?.setData(collections.visitors);
}

function terrainErrorText(i18n) {
  return i18n.language === 'de'
    ? '3D-Gelände konnte nicht geladen werden. Die flache Karte bleibt nutzbar.'
    : '3D terrain could not be loaded. The flat map remains usable.';
}

async function loadTerrainManifest({ baseUrl = import.meta.env.BASE_URL, fetchImpl = fetch } = {}) {
  const base = new URL(baseUrl, window.location.origin).href;
  const response = await fetchImpl(`${base}${TERRAIN_PATH}manifest.json`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`terrain manifest failed (${response.status})`);
  return validateTerrainManifest(await response.json());
}

function setTerrainReadyState(element, ready) {
  element.dataset.spatialTerrainReady = String(ready);
  element.dataset.spatialTerrainState = ready ? 'terrain' : 'flat';
  element.dataset.spatialTerrainActive = String(Boolean(ready));
}

function clearTerrainVerificationState(element) {
  for (const key of ['spatialTerrainVerified', 'spatialTerrainLowerM', 'spatialTerrainUpperM', 'spatialTerrainRiseM', 'spatialTerrainVerifyAttempts']) {
    delete element.dataset[key];
  }
}

function applyTerrainVerificationResult(element, sanity, attempts) {
  element.dataset.spatialTerrainVerifyAttempts = String(attempts);
  if (sanity.lowerM != null) element.dataset.spatialTerrainLowerM = String(sanity.lowerM);
  if (sanity.upperM != null) element.dataset.spatialTerrainUpperM = String(sanity.upperM);
  if (sanity.riseM != null) element.dataset.spatialTerrainRiseM = String(sanity.riseM);
  if (sanity.ok) element.dataset.spatialTerrainVerified = sanity.reason;
}

function markTerrainFailed(map, element, reason) {
  setTerrainReadyState(element, false);
  element.dataset.spatialTerrainReady = 'flat';
  element.dataset.spatialTerrainState = 'flat-fallback';
  element.dataset.spatialTerrainVerified = 'failed';
  element.dataset.spatialTerrainError = reason;
  try { map.setTerrain(null); } catch { /* best-effort terrain teardown */ }
  if (element.dataset.spatialHeritageState) {
    element.dataset.spatialHeritageState = 'terrain-unavailable';
    element.dataset.spatialHeritageError = reason;
  }
}

function terrainConfigured(map) {
  return map.getTerrain?.()?.source === TERRAIN_SOURCE_ID;
}

function verifyTerrainRise(map, element, attempts) {
  if (!terrainConfigured(map)) return { status: 'stopped' };
  const lower = map.queryTerrainElevation?.([CASCADES_TERRAIN_CONTROL.lower.lng, CASCADES_TERRAIN_CONTROL.lower.lat]);
  const upper = map.queryTerrainElevation?.([CASCADES_TERRAIN_CONTROL.upper.lng, CASCADES_TERRAIN_CONTROL.upper.lat]);
  const sanity = terrainRiseSanity(lower, upper);
  applyTerrainVerificationResult(element, sanity, attempts);
  if (sanity.ok) {
    element.dataset.spatialTerrainReady = 'true';
    element.dataset.spatialTerrainState = 'terrain';
    element.dataset.spatialTerrainActive = 'true';
    delete element.dataset.spatialTerrainError;
    return { status: 'ready', sanity };
  }
  if (sanity.reason !== 'pending') {
    markTerrainFailed(map, element, `terrain-${sanity.reason}`);
    return { status: 'failed', sanity };
  }
  if (attempts >= TERRAIN_VERIFY_MAX_ATTEMPTS) {
    markTerrainFailed(map, element, 'terrain-elevation-unavailable');
    return { status: 'failed', sanity };
  }
  return { status: 'pending', sanity };
}

function scheduleTerrainVerification(map, element) {
  let attempts = 0;
  let timer = null;
  let disposed = false;
  let checking = false;
  const cleanup = () => {
    if (timer != null) window.clearTimeout(timer);
    map.off('sourcedata', onSourceData);
  };
  const queue = () => {
    if (disposed || checking) return;
    if (timer != null) window.clearTimeout(timer);
    timer = window.setTimeout(check, TERRAIN_VERIFY_INTERVAL_MS);
  };
  const check = () => {
    timer = null;
    if (disposed || checking) return;
    checking = true;
    attempts += 1;
    const result = verifyTerrainRise(map, element, attempts);
    checking = false;
    if (result.status === 'pending') queue();
    else cleanup();
  };
  const onSourceData = (event) => {
    if (event.sourceId === TERRAIN_SOURCE_ID && event.isSourceLoaded) queue();
  };
  map.on('sourcedata', onSourceData);
  queue();
  return () => {
    disposed = true;
    cleanup();
  };
}

export class MapLibreTerrainMap {
  constructor(element, world, i18n, options = {}) {
    this.element = element;
    this.world = world;
    this.i18n = i18n;
    this.options = options;
    this.map = null;
    this.markers = new Map();
    this.selectedId = null;
    this.supplementalOptions = {};
    this._terrainVerificationCleanup = null;
    this._heritageLayer = null;
    this._heritageToken = 0;
  }

  async init() {
    const terrain = await loadTerrainManifest({ baseUrl: this.options.baseUrl, fetchImpl: this.options.fetchImpl });
    Object.assign(this.element.dataset, {
      spatialRenderer: 'terrain',
      terrainEncoding: terrain.encoding,
      terrainTileCount: String(terrain.tile_count),
      terrainTileBytes: String(terrain.tile_bytes),
      terrainZooms: terrain.zooms.join(','),
      terrainVerticalUnits: terrain.vertical_units,
      terrainExaggeration: String(terrain.terrain_exaggeration),
    });
    const bounds = terrain.renderer_bounds_wgs84;
    const center = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
    const camera = terrain.camera;
    this.map = new MapLibreMap({
      container: this.element,
      style: buildTerrainStyle(terrain, { baseUrl: this.options.baseUrl }),
      center,
      zoom: Math.min(camera.fit_max_zoom, camera.min_zoom + 0.75),
      minZoom: camera.min_zoom,
      maxZoom: camera.max_zoom,
      pitch: camera.initial_pitch_deg,
      maxPitch: camera.max_pitch_deg,
      bearing: camera.initial_bearing_deg,
      attributionControl: false,
    });
    this.map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    this.map.on('style.load', () => this.#configureTerrain(terrain));
    this.map.on('load', () => {
      this.#configureTerrain(terrain);
      this.#syncWorld();
      this.#syncSelection();
      this.#syncSupplemental();
      void this.#installHeritageLayer();
    });
    this.map.on('error', (event) => {
      const message = event.error?.message ?? 'terrain-error';
      const sourceId = event.sourceId ?? event.source?.id ?? event.error?.sourceId ?? '';
      if (sourceId === TERRAIN_SOURCE_ID || /terrain-dem|raster-dem|terrain\//i.test(message)) {
        this.#degradeTerrain(message);
      }
    });
    return this;
  }

  #configureTerrain(terrain) {
    if (!this.map) return;
    if (!terrainConfigured(this.map)) this.map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: terrain.terrain_exaggeration });
    clearTerrainVerificationState(this.element);
    this.element.dataset.spatialTerrainReady = 'pending';
    this.element.dataset.spatialTerrainState = 'terrain';
    this.element.dataset.spatialTerrainActive = 'true';
    delete this.element.dataset.spatialTerrainError;
    this._terrainVerificationCleanup?.();
    this._terrainVerificationCleanup = scheduleTerrainVerification(this.map, this.element);
  }

  async #installHeritageLayer() {
    if (!this.map) return;
    const token = ++this._heritageToken;
    try {
      const { createTerrainHeritageLayer } = await import('./maplibre-heritage-layer.js');
      if (!this.map || token !== this._heritageToken) return;
      const layer = createTerrainHeritageLayer({
        map: this.map,
        world: this.world,
        onActivate: (id) => this.options.onSelect?.(id),
        onState: (state) => this.#recordHeritageState(state),
      });
      this._heritageLayer = layer;
      this.map.addLayer(layer);
    } catch (error) {
      if (!this.map || token !== this._heritageToken) return;
      this.#recordHeritageState({
        id: 'aquaedukt',
        state: 'failed',
        depth: 'shared',
        animation: 'none',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  #recordHeritageState(state) {
    const detail = state ?? {};
    if (detail.id) this.element.dataset.spatialHeritageId = detail.id;
    if (detail.layerId) this.element.dataset.spatialHeritageLayer = detail.layerId;
    if (detail.depth) this.element.dataset.spatialHeritageDepth = detail.depth;
    if (detail.animation) this.element.dataset.spatialHeritageAnimation = detail.animation;
    if (detail.state) this.element.dataset.spatialHeritageState = detail.state;
    if (detail.displayOffsetM != null) this.element.dataset.spatialHeritageDisplayOffsetM = String(detail.displayOffsetM);
    if (detail.modelMetresPerUnit != null) this.element.dataset.spatialHeritageModelMetresPerUnit = String(detail.modelMetresPerUnit);
    if (detail.visible != null) this.element.dataset.spatialHeritageRendered = String(Boolean(detail.visible));
    if (detail.modelSource) this.element.dataset.spatialHeritageModelSource = detail.modelSource;
    if (detail.modelBytes != null) this.element.dataset.spatialHeritageModelBytes = String(detail.modelBytes);
    if (detail.modelTriangles != null) this.element.dataset.spatialHeritageModelTriangles = String(detail.modelTriangles);
    if (detail.error) this.element.dataset.spatialHeritageError = detail.error;
    else delete this.element.dataset.spatialHeritageError;
  }

  #degradeTerrain(message) {
    if (!this.map) return;
    markTerrainFailed(this.map, this.element, message);
  }

  #syncWorld() {
    if (!this.map) return;
    const descriptors = [
      ...this.world.landmarks,
      ...this.world.heritage,
    ].map((entity) => markerDescriptor(entity, this.i18n)).filter(Boolean);
    const live = new Set(descriptors.map(({ id }) => id));
    for (const [id, marker] of this.markers) {
      if (!live.has(id)) {
        marker.remove();
        this.markers.delete(id);
      }
    }
    for (const descriptor of descriptors) {
      let marker = this.markers.get(descriptor.id);
      if (!marker) {
        const element = markerElement(descriptor);
        element.addEventListener('click', () => this.options.onSelect?.(descriptor.id));
        marker = new Marker({ element, anchor: 'bottom' })
          .setLngLat([descriptor.position.lng, descriptor.position.lat])
          .addTo(this.map);
        this.markers.set(descriptor.id, marker);
      }
      updateMarker(marker, descriptor, this.selectedId);
    }
    addGeoJsonSource(this.map, 'supplemental-trees');
    addGeoJsonSource(this.map, 'supplemental-visitors');
    addCircleLayer(this.map, 'supplemental-trees', 'supplemental-trees', {
      'circle-radius': 4,
      'circle-color': '#235c3a',
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1,
      'circle-opacity': 0.72,
    });
    addCircleLayer(this.map, 'supplemental-visitors', 'supplemental-visitors', {
      'circle-radius': 5,
      'circle-color': '#7d4c26',
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1,
      'circle-opacity': 0.78,
    });
  }

  #syncSelection() {
    for (const [id, marker] of this.markers) {
      updateMarker(marker, { id }, this.selectedId);
    }
  }

  #syncSupplemental() {
    if (!this.map) return;
    applySupplementalCollections(this.map, this.world, this.supplementalOptions);
  }

  setSelection(id) {
    this.selectedId = id ?? null;
    this.#syncSelection();
  }

  setSupplementalOptions(options = {}) {
    this.supplementalOptions = options;
    this.#syncSupplemental();
  }

  focus(position, { zoom = 16 } = {}) {
    if (!this.map) return;
    moveMapLibreCamera(this.map, { center: [position.lng, position.lat], zoom }, { reducedMotion: prefersReducedMotion() });
  }

  fitRoute(route) {
    if (!this.map || !route?.geometry?.coordinates?.length) return;
    const coordinates = route.geometry.coordinates;
    const lngs = coordinates.map(([lng]) => lng);
    const lats = coordinates.map(([, lat]) => lat);
    const bounds = [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
    this.map.fitBounds(bounds, { padding: 48, maxZoom: 17, duration: prefersReducedMotion() ? 0 : 700 });
  }

  destroy() {
    this._terrainVerificationCleanup?.();
    this._terrainVerificationCleanup = null;
    this._heritageToken += 1;
    this._heritageLayer?.dispose?.();
    this._heritageLayer = null;
    for (const marker of this.markers.values()) marker.remove();
    this.markers.clear();
    this.map?.remove();
    this.map = null;
    this.element.replaceChildren();
  }
}
