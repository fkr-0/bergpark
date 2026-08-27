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

export function createGpsNavigator({ nodes, radiusM = 30, onPosition, onEnter, onError }) {
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
    const hit = nearestNode(position, nodes, radiusM);
    if (!hit) {
      activeNodeId = null;
      return;
    }
    if (hit.node.id !== activeNodeId) {
      activeNodeId = hit.node.id;
      onEnter?.(hit.node, hit.distance, position);
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
