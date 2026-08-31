export const WALKING_ROUTING_PROFILES = Object.freeze({
  shortest: Object.freeze({
    id: 'shortest',
    weight: 'distance_m',
    excludesMappedSteps: false,
  }),
  'avoid-mapped-steps': Object.freeze({
    id: 'avoid-mapped-steps',
    weight: 'distance_m',
    excludesMappedSteps: true,
  }),
});

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function heapCompare(left, right) {
  return left.cost - right.cost || left.nodeId.localeCompare(right.nodeId);
}

class MinHeap {
  constructor() {
    this.values = [];
  }

  push(value) {
    const values = this.values;
    values.push(value);
    let index = values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (heapCompare(values[parent], value) <= 0) break;
      values[index] = values[parent];
      index = parent;
    }
    values[index] = value;
  }

  pop() {
    const values = this.values;
    if (!values.length) return null;
    const first = values[0];
    const last = values.pop();
    if (!values.length) return first;
    let index = 0;
    while (true) {
      const leftIndex = index * 2 + 1;
      const rightIndex = leftIndex + 1;
      if (leftIndex >= values.length) break;
      let childIndex = leftIndex;
      if (rightIndex < values.length && heapCompare(values[rightIndex], values[leftIndex]) < 0) childIndex = rightIndex;
      if (heapCompare(values[childIndex], last) >= 0) break;
      values[index] = values[childIndex];
      index = childIndex;
    }
    values[index] = last;
    return first;
  }

  get size() {
    return this.values.length;
  }
}

function segmentAllowed(segment, profile) {
  if (segment?.routingEligible === false) return false;
  if (finite(segment?.distanceM) == null || segment.distanceM < 0) return false;
  if (profile.excludesMappedSteps && segment.steps === true) return false;
  return true;
}

function adjacencyFor(network, profile) {
  const adjacency = new Map();
  const add = (fromId, toId, segment, reverse = false) => {
    if (!fromId || !toId) return;
    const list = adjacency.get(fromId) ?? [];
    list.push({ fromId, toId, segment, reverse });
    adjacency.set(fromId, list);
  };
  for (const segment of network?.segments ?? []) {
    if (!segmentAllowed(segment, profile)) continue;
    add(segment.fromId, segment.toId, segment, false);
    if (segment.pedestrianOneway == null || segment.pedestrianOneway === 'both') {
      add(segment.toId, segment.fromId, segment, true);
    }
  }
  for (const list of adjacency.values()) {
    list.sort((left, right) => left.segment.id.localeCompare(right.segment.id) || left.toId.localeCompare(right.toId));
  }
  return adjacency;
}

function orientedCoordinates(leg) {
  const coordinates = leg.segment.coordinates ?? [];
  return leg.reverse ? [...coordinates].reverse() : [...coordinates];
}

function routeCoordinates(legs) {
  const coordinates = [];
  for (const leg of legs) {
    const segmentCoordinates = orientedCoordinates(leg);
    if (!segmentCoordinates.length) continue;
    if (!coordinates.length) coordinates.push(...segmentCoordinates);
    else coordinates.push(...segmentCoordinates.slice(1));
  }
  return Object.freeze(coordinates);
}

function routeEvidence(legs) {
  const surfaceDistanceM = {};
  let mappedStepSegments = 0;
  let mappedStepDistanceM = 0;
  let stepUnknownSegments = 0;
  let knownBarrierConstraintSegments = 0;
  let barrierUnverifiedSegments = 0;
  let endpointUnknownSegments = 0;
  let endpointUnknownDistanceM = 0;

  for (const { segment } of legs) {
    const distance = finite(segment.distanceM) ?? 0;
    const surface = segment.surface || 'unknown';
    surfaceDistanceM[surface] = (surfaceDistanceM[surface] ?? 0) + distance;
    if (segment.steps === true) {
      mappedStepSegments += 1;
      mappedStepDistanceM += distance;
    } else if (segment.steps == null) {
      stepUnknownSegments += 1;
    }
    if (segment.accessibilityStatus === 'known_barrier_mobility_constraint') knownBarrierConstraintSegments += 1;
    if (String(segment.accessibilityStatus ?? '').startsWith('unknown')) barrierUnverifiedSegments += 1;
    if (segment.accessibilityStatus === 'unknown_unmapped_connector') {
      endpointUnknownSegments += 1;
      endpointUnknownDistanceM += distance;
    }
  }

  return Object.freeze({
    surfaceDistanceM: Object.freeze(surfaceDistanceM),
    mappedStepSegments,
    mappedStepDistanceM,
    stepUnknownSegments,
    knownBarrierConstraintSegments,
    barrierUnverifiedSegments,
    endpointUnknownSegments,
    endpointUnknownDistanceM,
  });
}

function failure(reason, details = {}) {
  return Object.freeze({ ok: false, reason, ...details });
}

/**
 * Compute a deterministic visitor route over the already-published walking-network
 * projection. Profile weights are policy only; source segment metadata is never mutated.
 */
export function planWalkingRoute(network, fromPlaceId, toPlaceId, profileId = 'shortest') {
  if (!network) return failure('network-unavailable');
  const profile = WALKING_ROUTING_PROFILES[profileId];
  if (!profile) return failure('unknown-profile', { profileId });
  if (fromPlaceId === toPlaceId) return failure('same-place');
  const fromAnchor = network.placeAnchorsByPlaceId?.get(fromPlaceId);
  const toAnchor = network.placeAnchorsByPlaceId?.get(toPlaceId);
  if (!fromAnchor) return failure('unknown-source-anchor', { placeId: fromPlaceId });
  if (!toAnchor) return failure('unknown-destination-anchor', { placeId: toPlaceId });
  if (fromAnchor.componentId && toAnchor.componentId && fromAnchor.componentId !== toAnchor.componentId) {
    return failure('disconnected-components', { fromComponentId: fromAnchor.componentId, toComponentId: toAnchor.componentId });
  }

  const adjacency = adjacencyFor(network, profile);
  const distances = new Map([[fromAnchor.pathNodeId, 0]]);
  const previous = new Map();
  const queue = new MinHeap();
  queue.push({ nodeId: fromAnchor.pathNodeId, cost: 0 });

  while (queue.size) {
    const current = queue.pop();
    if (current.cost !== distances.get(current.nodeId)) continue;
    if (current.nodeId === toAnchor.pathNodeId) break;
    for (const leg of adjacency.get(current.nodeId) ?? []) {
      const nextCost = current.cost + leg.segment.distanceM;
      const knownCost = distances.get(leg.toId);
      if (knownCost != null && nextCost >= knownCost) continue;
      distances.set(leg.toId, nextCost);
      previous.set(leg.toId, leg);
      queue.push({ nodeId: leg.toId, cost: nextCost });
    }
  }

  if (!distances.has(toAnchor.pathNodeId)) return failure('no-route-for-profile', { profileId });

  const legs = [];
  let cursor = toAnchor.pathNodeId;
  while (cursor !== fromAnchor.pathNodeId) {
    const leg = previous.get(cursor);
    if (!leg) return failure('route-reconstruction-failed');
    legs.push(leg);
    cursor = leg.fromId;
  }
  legs.reverse();
  const distanceM = legs.reduce((sum, leg) => sum + (finite(leg.segment.distanceM) ?? 0), 0);

  return Object.freeze({
    ok: true,
    id: `walking-route:${fromPlaceId}:${toPlaceId}:${profileId}`,
    kind: 'walking-network-route',
    fromId: fromPlaceId,
    toId: toPlaceId,
    profileId,
    profile,
    distanceM,
    walkingMin: null,
    segments: Object.freeze(legs),
    coordinates: routeCoordinates(legs),
    evidence: routeEvidence(legs),
    coverage: network.coverage ?? null,
  });
}
