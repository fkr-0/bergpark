const EARTH_RADIUS_M = 6_371_008.8;

export function distanceMetres(a, b) {
  const rad = Math.PI / 180;
  const lat1 = a.lat * rad;
  const lat2 = b.lat * rad;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = ((b.lng ?? b.lon) - (a.lng ?? a.lon)) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.asin(Math.sqrt(h));
}

export function nearestNode(position, nodes, radiusM = 30) {
  let nearest = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    const candidate = distanceMetres(position, node);
    if (candidate < distance) {
      nearest = node;
      distance = candidate;
    }
  }
  return nearest && distance <= radiusM ? { node: nearest, distance } : null;
}

function validAccuracy(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function referenceType(node) {
  return node?.position_source?.position_type ?? 'unknown';
}

/**
 * Classify one GPS fix against the canonical place references.
 *
 * Geolocation accuracy is a radius, so a fix only enters a proximity zone when
 * its complete uncertainty circle fits inside the entry radius. Once active,
 * the place remains active until that circle is wholly beyond the wider exit
 * radius. This intentionally favors a quiet field experience over optimistic
 * arrival notifications from noisy fixes.
 */
export function evaluateProximity(position, nodes, {
  activeNodeId = null,
  enterRadiusM = 30,
  exitRadiusM = 45,
  maxAccuracyM = 50,
} = {}) {
  const accuracyM = validAccuracy(position?.accuracy);
  const activeNode = activeNodeId ? nodes.find(({ id }) => id === activeNodeId) ?? null : null;

  if (accuracyM == null || accuracyM > maxAccuracyM) {
    return {
      status: 'uncertain',
      node: activeNode,
      distance: activeNode ? distanceMetres(position, activeNode) : null,
      accuracyM,
      referenceType: referenceType(activeNode),
      exitedNodeId: null,
    };
  }

  let exitedNodeId = null;
  if (activeNode) {
    const distance = distanceMetres(position, activeNode);
    const nearestPossibleDistance = Math.max(0, distance - accuracyM);
    if (nearestPossibleDistance <= exitRadiusM) {
      return {
        status: 'retained',
        node: activeNode,
        distance,
        accuracyM,
        referenceType: referenceType(activeNode),
        exitedNodeId: null,
      };
    }
    exitedNodeId = activeNode.id;
  }

  let nearest = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    const candidate = distanceMetres(position, node);
    if (candidate < distance) {
      nearest = node;
      distance = candidate;
    }
  }

  if (nearest && distance + accuracyM <= enterRadiusM) {
    return {
      status: 'entered',
      node: nearest,
      distance,
      accuracyM,
      referenceType: referenceType(nearest),
      exitedNodeId,
    };
  }

  return {
    status: 'outside',
    node: null,
    distance: Number.isFinite(distance) ? distance : null,
    accuracyM,
    referenceType: 'unknown',
    exitedNodeId,
  };
}

export function createGpsNavigator({
  nodes,
  radiusM = 30,
  exitRadiusM = Math.max(radiusM + 15, radiusM * 1.5),
  maxAccuracyM = 50,
  onPosition,
  onEnter,
  onExit,
  onError,
}) {
  let watchId = null;
  let activeNodeId = null;

  function handlePosition({ coords }) {
    const position = {
      lat: coords.latitude,
      lng: coords.longitude,
      accuracy: coords.accuracy,
      heading: coords.heading,
      speed: coords.speed,
    };
    onPosition?.(position);
    const proximity = evaluateProximity(position, nodes, {
      activeNodeId,
      enterRadiusM: radiusM,
      exitRadiusM,
      maxAccuracyM,
    });
    if (proximity.exitedNodeId) onExit?.(proximity.exitedNodeId, position, proximity);
    if (proximity.status === 'entered') {
      activeNodeId = proximity.node.id;
      onEnter?.(proximity.node, proximity.distance, position, proximity);
    } else if (proximity.status === 'outside') {
      activeNodeId = null;
    }
  }

  return {
    start() {
      if (!navigator.geolocation || watchId !== null) return false;
      watchId = navigator.geolocation.watchPosition(handlePosition, onError, {
        enableHighAccuracy: true,
        maximumAge: 4_000,
        timeout: 12_000,
      });
      return true;
    },
    stop() {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      watchId = null;
      activeNodeId = null;
    },
    get active() {
      return watchId !== null;
    },
  };
}
