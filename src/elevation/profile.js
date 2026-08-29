import { ROUTE_ELEVATION_SOURCE, ROUTE_ELEVATION_SUMMARIES } from './generated-route-summaries.js';

export const ROUTE_ELEVATION_STATUS = Object.freeze({
  DGM1: 'dgm1',
  LEGACY: 'legacy',
  UNKNOWN: 'unknown',
});

export function routeElevationSummary(routeId) {
  return ROUTE_ELEVATION_SUMMARIES[routeId] ?? null;
}

export function routeElevationSource() {
  return ROUTE_ELEVATION_SOURCE;
}

export async function loadRouteElevationProfile(routeId) {
  const { ROUTE_ELEVATION_PROFILES } = await import('./generated-route-profiles.js');
  return ROUTE_ELEVATION_PROFILES[routeId] ?? null;
}

function finiteValues(values) {
  return Array.isArray(values) && values.length > 1 && values.every(Number.isFinite);
}

/**
 * Convert a distance-aware elevation profile into SVG points. Legacy arrays are
 * supported only as an explicit fallback and therefore use uniform index spacing.
 */
export function elevationProfilePolyline(profile, width = 240, height = 56) {
  const elevations = Array.isArray(profile) ? profile : profile?.elevationsM;
  if (!finiteValues(elevations)) return { points: '', min: null, max: null, distanceM: null };
  const distances = Array.isArray(profile)
    ? elevations.map((_, index) => index)
    : profile?.distancesM;
  if (!finiteValues(distances) || distances.length !== elevations.length) {
    return { points: '', min: null, max: null, distanceM: null };
  }
  const min = Math.min(...elevations);
  const max = Math.max(...elevations);
  const span = Math.max(1, max - min);
  const startDistance = distances[0];
  const distanceM = Math.max(0, distances.at(-1) - startDistance);
  const horizontalSpan = Math.max(1, distanceM);
  const points = elevations.map((value, index) => {
    const x = ((distances[index] - startDistance) / horizontalSpan) * width;
    const y = height - 5 - ((value - min) / span) * (height - 10);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return { points, min, max, distanceM };
}

export function elevationConfidenceLabel(language = 'de') {
  const accuracy = ROUTE_ELEVATION_SOURCE.heightAccuracyM95PctUpTo;
  if (language === 'de') {
    return accuracy == null
      ? 'DGM1-Quelle qualifiziert; kombinierte Routenunsicherheit nicht kalibriert.'
      : `DGM1-Quellgenauigkeit bis ${accuracy} m (95 %); kombinierte Routenunsicherheit nicht kalibriert.`;
  }
  return accuracy == null
    ? 'DGM1 source qualified; combined route uncertainty is not calibrated.'
    : `DGM1 source accuracy up to ${accuracy} m (95%); combined route uncertainty is not calibrated.`;
}

export function elevationUnknownsLabel(language = 'de') {
  return language === 'de'
    ? 'OSM-Wegegeometrie und Endpunkt-Zubringer haben keine kombinierte Höhengenauigkeit; Wetter, Oberfläche und individuelle Anstrengung werden nicht modelliert.'
    : 'OSM path geometry and endpoint connectors have no combined elevation accuracy; weather, surface and individual effort are not modelled.';
}

export function terrainDirection(summary, deadbandM = 2) {
  if (!summary || !Number.isFinite(summary.elevationDeltaM)) return 'unknown';
  if (summary.elevationDeltaM > deadbandM) return 'uphill';
  if (summary.elevationDeltaM < -deadbandM) return 'downhill';
  return 'level';
}
