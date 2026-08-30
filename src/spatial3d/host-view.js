export const SPATIAL3D_EARTH_RADIUS_M = 6_371_008.8;
export const SPATIAL3D_MAX_SURFACE_DISTANCE_M = Math.PI * SPATIAL3D_EARTH_RADIUS_M;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function coordinate(value) {
  const lng = finite(value?.lng ?? value?.[0]);
  const lat = finite(value?.lat ?? value?.[1]);
  if (lng == null || lat == null || lat < -90 || lat > 90) return null;
  return Object.freeze({ lng, lat });
}

function normalizeLongitude(value) {
  const number = finite(value);
  if (number == null) return null;
  return ((number + 180) % 360 + 360) % 360 - 180;
}

function longitudeDeltaDegrees(fromLng, toLng) {
  return ((toLng - fromLng + 540) % 360) - 180;
}

/** Deterministic great-circle distance bounded to one half Earth circumference. */
export function spatial3dSurfaceDistanceM(from, to) {
  const left = coordinate(from);
  const right = coordinate(to);
  if (!left || !right) return null;
  const radians = Math.PI / 180;
  const latitudeDelta = (right.lat - left.lat) * radians;
  const longitudeDelta = longitudeDeltaDegrees(left.lng, right.lng) * radians;
  const leftLatitude = left.lat * radians;
  const rightLatitude = right.lat * radians;
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  const centralAngle = 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, haversine))));
  return Math.min(SPATIAL3D_MAX_SURFACE_DISTANCE_M, centralAngle * SPATIAL3D_EARTH_RADIUS_M);
}

function readHostCenter(map) {
  if (typeof map?.getCenter !== 'function') return null;
  try {
    return coordinate(map.getCenter());
  } catch {
    return null;
  }
}

function projectedInHostViewport(map, position) {
  if (!position || typeof map?.project !== 'function' || typeof map?.getCanvas !== 'function') return null;
  try {
    const canvas = map.getCanvas();
    const width = finite(canvas?.clientWidth);
    const height = finite(canvas?.clientHeight);
    if (width == null || height == null || width <= 0 || height <= 0) return null;
    const point = map.project([position.lng, position.lat]);
    const x = finite(point?.x);
    const y = finite(point?.y);
    if (x == null || y == null) return null;
    return x >= 0 && x <= width && y >= 0 && y <= height;
  } catch {
    return null;
  }
}

function readHostBounds(map) {
  if (typeof map?.getBounds !== 'function') return null;
  try {
    const bounds = map.getBounds();
    const west = finite(bounds?.getWest?.());
    const east = finite(bounds?.getEast?.());
    const south = finite(bounds?.getSouth?.());
    const north = finite(bounds?.getNorth?.());
    if (west == null || east == null || south == null || north == null || south > north) return null;
    return Object.freeze({ west, east, south, north });
  } catch {
    return null;
  }
}

function longitudeInBounds(lng, west, east) {
  const span = east - west;
  if (Math.abs(span) >= 360) return true;
  const point = normalizeLongitude(lng);
  const normalizedWest = normalizeLongitude(west);
  const normalizedEast = normalizeLongitude(east);
  if (point == null || normalizedWest == null || normalizedEast == null) return true;
  if (normalizedWest <= normalizedEast && span >= 0) {
    return point >= normalizedWest && point <= normalizedEast;
  }
  return point >= normalizedWest || point <= normalizedEast;
}

function positionInHostView(map, position, bounds) {
  if (!position) return true;
  const projected = projectedInHostViewport(map, position);
  if (projected != null) return projected;
  if (!bounds) return true;
  if (position.lat < bounds.south || position.lat > bounds.north) return false;
  return longitudeInBounds(position.lng, bounds.west, bounds.east);
}

/**
 * Snapshot renderer-local distance and viewport membership from the MapLibre host.
 * Missing/throwing host view APIs fail open to distance-unavailable/in-view so the
 * adapter cannot hide canonical content merely because host state is incomplete.
 */
export function deriveSpatial3dHostView(map, descriptors = []) {
  const center = readHostCenter(map);
  const bounds = readHostBounds(map);
  const viewByEntityId = Object.create(null);
  for (const descriptor of descriptors) {
    const entityId = typeof descriptor?.entityId === 'string' && descriptor.entityId.length > 0
      ? descriptor.entityId
      : null;
    if (!entityId) continue;
    const position = coordinate(descriptor.position);
    viewByEntityId[entityId] = Object.freeze({
      distanceM: center && position ? spatial3dSurfaceDistanceM(center, position) : null,
      inView: positionInHostView(map, position, bounds),
    });
  }
  return Object.freeze(viewByEntityId);
}
