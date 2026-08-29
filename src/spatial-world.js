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
  const nodeState = new Map();
  const touchNode = (id, position, neighborId) => {
    if (!id || !position) return;
    const state = nodeState.get(id) ?? { id, position, neighbors: new Set() };
    if (neighborId) state.neighbors.add(neighborId);
    nodeState.set(id, state);
  };
  const segments = (walkingNetwork.segments ?? []).map((segment) => {
    const coordinates = (segment.geometry ?? []).map(pathPosition).filter(Boolean);
    if (coordinates.length < 2 || typeof segment?.id !== 'string' || !segment.id) return null;
    const descriptor = {
      id: segment.id,
      kind: 'path-segment',
      fromId: segment.from ?? null,
      toId: segment.to ?? null,
      steps: segment.steps === true,
      coordinates: Object.freeze(coordinates),
    };
    if (segment.surface != null) descriptor.surface = segment.surface;
    if (segment.highway != null) descriptor.highway = segment.highway;
    if (segment.accessibility_status != null) descriptor.accessibilityStatus = segment.accessibility_status;
    if (segment.routing_eligible != null) descriptor.routingEligible = segment.routing_eligible === true;
    if (Number.isFinite(segment.distance_m)) descriptor.distanceM = segment.distance_m;
    touchNode(descriptor.fromId, coordinates[0], descriptor.toId);
    touchNode(descriptor.toId, coordinates[coordinates.length - 1], descriptor.fromId);
    return Object.freeze(descriptor);
  }).filter(Boolean);
  const nodes = [...nodeState.values()]
    .map(({ id, position, neighbors }) => Object.freeze({
      id,
      kind: 'path-node',
      position,
      degree: neighbors.size,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return Object.freeze({
    crs: COORDINATE_REFERENCE_SYSTEM,
    coordinateOrder: 'lng-lat',
    nodes: Object.freeze(nodes),
    segments: Object.freeze(segments.map(Object.freeze)),
    counts: Object.freeze({ ...(walkingNetwork.counts ?? {}) }),
    nodesById: indexById(nodes),
    segmentsById: indexById(segments),
  });
}
