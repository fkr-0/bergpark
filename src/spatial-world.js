const COORDINATE_REFERENCE_SYSTEM = 'EPSG:4326';

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sourceSnapshot(record) {
  if (!record || typeof record !== 'object') return null;
  const snapshot = {};
  for (const key of [
    'provider',
    'dataset',
    'element',
    'license',
    'method',
    'position_type',
    'resolution_m',
    'horizontal_accuracy_m',
    'vertical_accuracy_m',
    'accuracy_status',
    'source_timestamp',
    'retrieved_at',
    'snapshot',
  ]) {
    if (record[key] != null) snapshot[key] = record[key];
  }
  return Object.keys(snapshot).length ? Object.freeze(snapshot) : null;
}

/**
 * Convert repository coordinates into the renderer-neutral spatial boundary.
 * External spatial descriptors always expose WGS84 longitude before latitude.
 */
export function spatialPosition(record) {
  const lat = finiteNumber(record?.lat);
  const lng = finiteNumber(record?.lng ?? record?.lon);
  if (lat == null || lng == null) return null;
  const elevationM = finiteNumber(record?.elevation_m);
  const position = { lng, lat };
  if (elevationM != null) position.elevationM = elevationM;
  const provenance = {
    position: sourceSnapshot(record?.position_source ?? record?.coordinate_source),
    elevation: elevationM == null ? null : sourceSnapshot(record?.elevation_source),
  };
  if (provenance.position || provenance.elevation) position.provenance = Object.freeze(provenance);
  return Object.freeze(position);
}

function pathPosition(point) {
  if (!Array.isArray(point) || point.length < 2) return null;
  const lat = finiteNumber(point[0]);
  const lng = finiteNumber(point[1]);
  if (lat == null || lng == null) return null;
  return Object.freeze({ lng, lat });
}

function pointDescriptor(record, kind, deepLinkKind) {
  const position = spatialPosition(record);
  if (!position || typeof record?.id !== 'string' || !record.id) return null;
  const descriptor = {
    id: record.id,
    kind,
    position,
    deepLink: Object.freeze({ kind: deepLinkKind, id: record.id }),
  };
  if (record.type ?? record.category ?? record.layerKind) {
    descriptor.presentation = Object.freeze({ category: record.type ?? record.category ?? record.layerKind });
  }
  return Object.freeze(descriptor);
}

function routeDescriptor(edge) {
  if (typeof edge?.id !== 'string' || !edge.id) return null;
  const coordinates = (edge.path_coordinates ?? []).map(pathPosition).filter(Boolean);
  if (coordinates.length < 2) return null;
  const descriptor = {
    id: edge.id,
    kind: 'route',
    fromId: edge.from,
    toId: edge.to,
    coordinates: Object.freeze(coordinates),
  };
  if (Number.isFinite(edge.distance_m)) descriptor.distanceM = edge.distance_m;
  if (Number.isFinite(edge.walking_min)) descriptor.walkingMin = edge.walking_min;
  if (Array.isArray(edge.elevation_profile_m)) {
    const profile = edge.elevation_profile_m.filter(Number.isFinite);
    if (profile.length) descriptor.elevationProfileM = Object.freeze([...profile]);
  }
  const elevationSource = sourceSnapshot(edge.elevation_source);
  if (elevationSource) descriptor.elevationProvenance = elevationSource;
  return Object.freeze(descriptor);
}

function indexById(records) {
  return new Map(records.map((record) => [record.id, record]));
}

/**
 * @typedef {object} SpatialWorld
 * @property {'EPSG:4326'} crs
 * @property {'lng-lat'} coordinateOrder
 * @property {readonly object[]} places
 * @property {readonly object[]} routes
 * @property {readonly object[]} trees
 * @property {readonly object[]} visitorFeatures
 */

/** Build a renderer-neutral snapshot from the current canonical/runtime graph. */
export function createSpatialWorld(graph = {}) {
  const places = (graph.nodes ?? []).map((record) => pointDescriptor(record, 'place', 'place')).filter(Boolean);
  const routes = (graph.edges ?? []).map(routeDescriptor).filter(Boolean);
  const trees = (graph.trees ?? []).map((record) => pointDescriptor(record, 'tree', 'tree')).filter(Boolean);
  const visitorFeatures = (graph.visitorLayers?.features ?? [])
    .map((record) => pointDescriptor(record, 'visitor-feature', 'feature'))
    .filter(Boolean);

  return Object.freeze({
    crs: COORDINATE_REFERENCE_SYSTEM,
    coordinateOrder: 'lng-lat',
    places: Object.freeze(places),
    routes: Object.freeze(routes),
    trees: Object.freeze(trees),
    visitorFeatures: Object.freeze(visitorFeatures),
    placesById: indexById(places),
    routesById: indexById(routes),
    treesById: indexById(trees),
    visitorFeaturesById: indexById(visitorFeatures),
  });
}

/** Convert the lazily loaded walking network into the same lng/lat boundary. */
export function createWalkingNetworkDescriptor(walkingNetwork) {
  if (!walkingNetwork) return null;
  const segments = (walkingNetwork.segments ?? []).map((segment) => ({
    steps: segment.steps === true,
    coordinates: Object.freeze((segment.geometry ?? []).map(pathPosition).filter(Boolean)),
  })).filter((segment) => segment.coordinates.length >= 2);
  return Object.freeze({
    crs: COORDINATE_REFERENCE_SYSTEM,
    coordinateOrder: 'lng-lat',
    segments: Object.freeze(segments.map(Object.freeze)),
    counts: Object.freeze({ ...(walkingNetwork.counts ?? {}) }),
  });
}
