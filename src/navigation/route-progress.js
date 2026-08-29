import { distanceMetres } from '../gps.js';

export const ROUTE_PROGRESS_DEFAULTS = Object.freeze({
  enterRadiusM: 30,
  exitRadiusM: 45,
  maxAccuracyM: 50,
});

function finitePosition(position) {
  const latitude = Number(position?.coords?.latitude ?? position?.lat);
  const longitude = Number(position?.coords?.longitude ?? position?.lng);
  const accuracy = Number(position?.coords?.accuracy ?? position?.accuracy);
  return { latitude, longitude, accuracy };
}

function localXY(origin, point) {
  const latScale = 111_320;
  const lngScale = latScale * Math.cos((origin.lat * Math.PI) / 180);
  return {
    x: (point.lng - origin.lng) * lngScale,
    y: (point.lat - origin.lat) * latScale,
  };
}

function nearestProjection(position, coordinates) {
  const points = coordinates.map(([lat, lng]) => ({ lat: Number(lat), lng: Number(lng) }));
  if (points.length < 2 || points.some((point) => !Number.isFinite(point.lat) || !Number.isFinite(point.lng))) {
    return null;
  }
  const origin = { lat: position.latitude, lng: position.longitude };
  let walkedM = 0;
  let best = null;
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = localXY(origin, points[index]);
    const b = localXY(origin, points[index + 1]);
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const segmentM = Math.hypot(vx, vy);
    if (segmentM === 0) continue;
    const t = Math.max(0, Math.min(1, -(a.x * vx + a.y * vy) / (segmentM * segmentM)));
    const px = a.x + vx * t;
    const py = a.y + vy * t;
    const crossTrackM = Math.hypot(px, py);
    const alongM = walkedM + segmentM * t;
    if (!best || crossTrackM < best.crossTrackM) best = { crossTrackM, alongM, segmentIndex: index };
    walkedM += segmentM;
  }
  if (!best) return null;
  return { ...best, routeDistanceM: walkedM };
}

/**
 * Route progress consumes the same browser position fixes as createGpsNavigator;
 * it never starts another watchPosition. Entry/exit uses the exact GPS accuracy
 * circle + 30/45/50 m hysteresis contract already established in gps.js.
 */
export function evaluateRouteProgress(position, coordinates, {
  active = false,
  previousProgressM = null,
  enterRadiusM = ROUTE_PROGRESS_DEFAULTS.enterRadiusM,
  exitRadiusM = ROUTE_PROGRESS_DEFAULTS.exitRadiusM,
  maxAccuracyM = ROUTE_PROGRESS_DEFAULTS.maxAccuracyM,
} = {}) {
  const current = finitePosition(position);
  if (![current.latitude, current.longitude, current.accuracy].every(Number.isFinite)
    || current.accuracy < 0
    || current.accuracy > maxAccuracyM) {
    return { state: 'uncertain', active, progressM: previousProgressM, remainingM: null, accuracyM: current.accuracy };
  }
  const projection = nearestProjection(current, coordinates);
  if (!projection) return { state: 'unknown', active: false, progressM: null, remainingM: null, accuracyM: current.accuracy };

  const certainlyInside = projection.crossTrackM + current.accuracy <= enterRadiusM;
  const certainlyOutside = Math.max(0, projection.crossTrackM - current.accuracy) > exitRadiusM;
  const nextActive = active ? !certainlyOutside : certainlyInside;
  if (!nextActive) {
    return {
      state: certainlyOutside ? 'outside' : 'uncertain',
      active: false,
      progressM: previousProgressM,
      remainingM: null,
      crossTrackM: projection.crossTrackM,
      accuracyM: current.accuracy,
    };
  }
  const progressM = projection.alongM;
  return {
    state: certainlyInside ? 'on-route' : 'retained',
    active: true,
    progressM,
    remainingM: Math.max(0, projection.routeDistanceM - progressM),
    routeDistanceM: projection.routeDistanceM,
    crossTrackM: projection.crossTrackM,
    accuracyM: current.accuracy,
    segmentIndex: projection.segmentIndex,
    endDistanceM: distanceMetres(
      { lat: current.latitude, lng: current.longitude },
      { lat: Number(coordinates.at(-1)[0]), lng: Number(coordinates.at(-1)[1]) },
    ),
  };
}
