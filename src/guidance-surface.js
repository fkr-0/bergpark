import { distanceMetres } from './gps.js';

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validPoint(point) {
  return finite(point?.lat) != null && finite(point?.lng ?? point?.lon) != null;
}

function normalizePoint(point) {
  return { lat: Number(point.lat), lng: Number(point.lng ?? point.lon) };
}

function localOffsetMetres(origin, point) {
  const latRadians = origin.lat * Math.PI / 180;
  const metresPerDegreeLat = 111_132;
  const metresPerDegreeLng = 111_320 * Math.max(0.01, Math.cos(latRadians));
  return {
    x: (point.lng - origin.lng) * metresPerDegreeLng,
    y: (point.lat - origin.lat) * metresPerDegreeLat,
  };
}

export function projectPositionOnRoute(position, coordinates) {
  if (!validPoint(position) || !Array.isArray(coordinates)) return null;
  const route = coordinates.filter(validPoint).map(normalizePoint);
  if (route.length < 2) return null;
  const visitor = normalizePoint(position);
  const segmentLengths = [];
  let totalM = 0;
  for (let index = 0; index < route.length - 1; index += 1) {
    const lengthM = distanceMetres(route[index], route[index + 1]);
    segmentLengths.push(lengthM);
    totalM += lengthM;
  }
  if (!(totalM > 0)) return null;

  let best = null;
  let cumulativeM = 0;
  for (let index = 0; index < route.length - 1; index += 1) {
    const start = localOffsetMetres(visitor, route[index]);
    const end = localOffsetMetres(visitor, route[index + 1]);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared > 0
      ? Math.max(0, Math.min(1, -(start.x * dx + start.y * dy) / lengthSquared))
      : 0;
    const nearestX = start.x + dx * t;
    const nearestY = start.y + dy * t;
    const offRouteM = Math.hypot(nearestX, nearestY);
    const progressM = cumulativeM + segmentLengths[index] * t;
    if (!best || offRouteM < best.offRouteM) {
      best = { segmentIndex: index, t, offRouteM, progressM };
    }
    cumulativeM += segmentLengths[index];
  }

  if (!best) return null;
  return Object.freeze({
    ...best,
    totalM,
    remainingM: Math.max(0, totalM - best.progressM),
    progressFraction: Math.max(0, Math.min(1, best.progressM / totalM)),
  });
}

export function navigationSummary({
  position,
  coordinates,
  routeDistanceM = null,
  walkingMin = null,
  offRouteThresholdM = 30,
} = {}) {
  const projection = projectPositionOnRoute(position, coordinates);
  if (!projection) return null;
  const declaredDistanceM = finite(routeDistanceM);
  const scale = declaredDistanceM != null && projection.totalM > 0
    ? declaredDistanceM / projection.totalM
    : 1;
  const remainingM = Math.max(0, projection.remainingM * scale);
  const totalWalkingMin = finite(walkingMin);
  const remainingWalkingMin = totalWalkingMin == null
    ? null
    : Math.max(0, totalWalkingMin * (1 - projection.progressFraction));
  return Object.freeze({
    ...projection,
    remainingM,
    remainingWalkingMin,
    offRoute: projection.offRouteM > offRouteThresholdM,
  });
}
