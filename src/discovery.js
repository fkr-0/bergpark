import { localized } from './i18n.js';
import { routeEvidence } from './routes.js';
import { terrainDirection } from './elevation/profile.js';

export const ROUTE_COMPARISON_LIMIT = 8;
export const NETWORK_RESULT_LIMIT = 40;

const ROUTE_SORTS = new Set(['time', 'distance', 'ascent', 'descent']);
export const MOUNTAIN_ROUTE_FILTERS = Object.freeze(['nearby', 'uphill', 'downhill', 'viewpoint', 'water-axis', 'heritage']);
const MOUNTAIN_ROUTE_FILTER_SET = new Set(MOUNTAIN_ROUTE_FILTERS);
const NETWORK_KINDS = new Set(['all', 'junction', 'steps', 'path']);
const NETWORK_KIND_ORDER = { junction: 0, steps: 1, path: 2 };

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function nullableMetric(value) {
  const number = finite(value);
  return number == null ? Number.POSITIVE_INFINITY : number;
}

function routeMetric(option, sort) {
  if (sort === 'distance') return nullableMetric(option.evidence.distanceM);
  if (sort === 'ascent') return nullableMetric(option.evidence.ascentM);
  if (sort === 'descent') return nullableMetric(option.evidence.descentM);
  return nullableMetric(option.evidence.walkingMin);
}

function targetHasWaterAxisEvidence(graph, targetId) {
  return (graph?.semanticEdges ?? []).some((relation) => {
    if (relation?.to !== targetId && relation?.from !== targetId) return false;
    const assertion = String(relation?.provenance?.assertion ?? '');
    return /(?:water|Wasser).*(?:axis|achse)|(?:axis|achse).*(?:water|Wasser)/i.test(assertion);
  });
}

function targetHasHeritageEvidence(target) {
  const historic = target?.osm_tags?.historic;
  return Boolean(historic && historic !== 'no');
}

function routeAffordances(graph, target, evidence) {
  const values = new Set(['nearby']);
  const direction = terrainDirection(evidence);
  if (direction === 'uphill' || direction === 'downhill') values.add(direction);
  if (target?.type === 'viewpoint' || target?.osm_tags?.tourism === 'viewpoint') values.add('viewpoint');
  if (targetHasWaterAxisEvidence(graph, target?.id)) values.add('water-axis');
  if (targetHasHeritageEvidence(target)) values.add('heritage');
  return Object.freeze([...values]);
}

/** Deterministic comparison of already-canonical direct walking edges. */
export function connectedRouteOptions(graph, fromId, language = 'de', {
  sort = 'time',
  limit = ROUTE_COMPARISON_LIMIT,
} = {}) {
  const normalizedSort = ROUTE_SORTS.has(sort) ? sort : 'time';
  const options = (graph?.outgoing?.get(fromId) ?? []).map((edge) => {
    const target = graph?.nodesById?.get(edge.to);
    if (!target) return null;
    return {
      id: edge.id ?? `${edge.from}--${edge.to}`,
      fromId: edge.from,
      toId: edge.to,
      title: localized(target.name, language, target.id),
      target,
      edge,
      evidence: routeEvidence(edge),
    };
  }).filter(Boolean);

  for (const option of options) option.affordances = routeAffordances(graph, option.target, option.evidence);

  options.sort((left, right) => {
    const metricDelta = routeMetric(left, normalizedSort) - routeMetric(right, normalizedSort);
    if (metricDelta) return metricDelta;
    const timeDelta = nullableMetric(left.evidence.walkingMin) - nullableMetric(right.evidence.walkingMin);
    if (timeDelta) return timeDelta;
    const distanceDelta = nullableMetric(left.evidence.distanceM) - nullableMetric(right.evidence.distanceM);
    if (distanceDelta) return distanceDelta;
    return left.id.localeCompare(right.id);
  });

  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : ROUTE_COMPARISON_LIMIT;
  return options.slice(0, safeLimit);
}

/**
 * Filter canonical direct routes by source-backed mountain semantics. This never
 * creates a new path or route identity; unsupported categories simply return none.
 */
export function discoverMountainRoutes(graph, fromId, language = 'de', {
  filter = 'nearby',
  sort = 'time',
  limit = ROUTE_COMPARISON_LIMIT,
} = {}) {
  const normalizedFilter = MOUNTAIN_ROUTE_FILTER_SET.has(filter) ? filter : 'nearby';
  return connectedRouteOptions(graph, fromId, language, { sort, limit: Number.MAX_SAFE_INTEGER })
    .filter((option) => option.affordances.includes(normalizedFilter))
    .slice(0, Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : ROUTE_COMPARISON_LIMIT);
}

export function routeTerrainSummary(evidence, language = 'de') {
  const direction = terrainDirection(evidence);
  const directionLabel = {
    de: { uphill: 'bergauf', downhill: 'bergab', level: 'nahezu höhengleich', unknown: 'Richtung unbekannt' },
    en: { uphill: 'uphill', downhill: 'downhill', level: 'nearly level', unknown: 'direction unknown' },
  }[language] ?? { uphill: 'uphill', downhill: 'downhill', level: 'nearly level', unknown: 'direction unknown' };
  const values = [directionLabel[direction] ?? directionLabel.unknown];
  if (evidence?.ascentM != null) values.push(`↑ ${Math.round(evidence.ascentM)} m`);
  if (evidence?.descentM != null) values.push(`↓ ${Math.round(evidence.descentM)} m`);
  if (evidence?.minElevationM != null && evidence?.maxElevationM != null) {
    values.push(`${Math.round(evidence.minElevationM)}–${Math.round(evidence.maxElevationM)} m`);
  }
  if (evidence?.netGradePct != null) {
    const sign = evidence.netGradePct > 0 ? '+' : '';
    values.push(`${language === 'de' ? 'netto' : 'net'} ${sign}${evidence.netGradePct.toFixed(1)}%`);
  }
  const steep = [];
  if (evidence?.maxUphillGradePct > 0) steep.push(`+${evidence.maxUphillGradePct.toFixed(1)}%`);
  if (evidence?.maxDownhillGradePct < 0) steep.push(`−${Math.abs(evidence.maxDownhillGradePct).toFixed(1)}%`);
  if (steep.length) {
    values.push(`${language === 'de' ? 'steilste Segmente' : 'steepest segments'} ${steep.join('/')}`);
  }
  if (evidence?.elevationStatus === 'dgm1') values.push('DGM1');
  else if (evidence?.elevationStatus === 'legacy') values.push(language === 'de' ? 'GLO-90 Fallback' : 'GLO-90 fallback');
  else values.push(language === 'de' ? 'Höhe unbekannt' : 'elevation unknown');
  return values.join(' · ');
}

export function routeAccessSummary(evidence, language = 'de') {
  if (evidence?.containsSteps) return language === 'de' ? 'Stufen kartiert' : 'Mapped steps';
  if (evidence?.mappedPathAccessibility === 'potentially_step_free_mapped_path') {
    return language === 'de' ? 'Kartierter Weg möglicherweise stufenfrei' : 'Mapped path may be step-free';
  }
  if (evidence?.mappedPathAccessibility === 'limited') {
    return language === 'de' ? 'Kartiert eingeschränkte Zugänglichkeit' : 'Mapped limited accessibility';
  }
  return language === 'de' ? 'Zugänglichkeit nicht vollständig belegt' : 'Accessibility not fully evidenced';
}

export function routeSurfaceSummary(evidence, language = 'de') {
  const surfaces = (evidence?.surfaces ?? []).slice(0, 3);
  return surfaces.length ? surfaces.join(' · ') : (language === 'de' ? 'Oberfläche unbekannt' : 'Surface unknown');
}

function segmentMidpoint(segment) {
  const coordinates = segment?.coordinates ?? [];
  if (!coordinates.length) return null;
  const middle = coordinates[Math.floor((coordinates.length - 1) / 2)];
  return middle && Number.isFinite(middle.lng) && Number.isFinite(middle.lat)
    ? Object.freeze({ lng: middle.lng, lat: middle.lat })
    : null;
}

/**
 * Build a searchable projection of the already-loaded path network. The projection keeps
 * canonical pathnode/pathseg IDs and source-backed properties; it does not create routes.
 */
export function createNetworkDiscoveryIndex(network, language = 'de') {
  if (!network) return [];
  const junctions = (network.nodes ?? [])
    .filter((node) => node.degree >= 3 && node.position)
    .map((node) => ({
      id: node.id,
      kind: 'junction',
      title: language === 'de' ? 'Wegkreuzung' : 'Path junction',
      context: `${node.degree} ${language === 'de' ? 'Verbindungen' : 'connections'}`,
      position: node.position,
      keywords: [node.id, 'junction', 'kreuzung'],
      source: node,
    }));
  const segments = (network.segments ?? []).map((segment) => {
    const kind = segment.steps ? 'steps' : 'path';
    const surface = segment.surface || (language === 'de' ? 'Oberfläche unbekannt' : 'surface unknown');
    const highway = segment.highway || (language === 'de' ? 'Weg' : 'path');
    return {
      id: segment.id,
      kind,
      title: kind === 'steps'
        ? (language === 'de' ? 'Kartierte Stufen' : 'Mapped steps')
        : (language === 'de' ? 'Kartierter Wegabschnitt' : 'Mapped path segment'),
      context: [highway, surface, finite(segment.distanceM) == null ? '' : `${Math.round(segment.distanceM)} m`].filter(Boolean).join(' · '),
      position: segmentMidpoint(segment),
      keywords: [segment.id, segment.fromId, segment.toId, segment.surface, segment.highway, segment.accessibilityStatus].filter(Boolean),
      source: segment,
    };
  }).filter(({ position }) => Boolean(position));
  return [...junctions, ...segments];
}

function networkMatches(result, query) {
  if (!query) return true;
  const haystack = [result.id, result.title, result.context, ...(result.keywords ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();
  return haystack.includes(query);
}

export function searchNetworkDiscovery(index, {
  query = '',
  kind = 'all',
  limit = NETWORK_RESULT_LIMIT,
} = {}) {
  const needle = String(query).trim().toLocaleLowerCase();
  const normalizedKind = NETWORK_KINDS.has(kind) ? kind : 'all';
  const matches = (index ?? []).filter((result) => (
    (normalizedKind === 'all' || result.kind === normalizedKind)
    && networkMatches(result, needle)
  ));
  matches.sort((left, right) => (
    (NETWORK_KIND_ORDER[left.kind] ?? 99) - (NETWORK_KIND_ORDER[right.kind] ?? 99)
    || left.id.localeCompare(right.id)
  ));
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : NETWORK_RESULT_LIMIT;
  return {
    total: matches.length,
    results: matches.slice(0, safeLimit),
    limited: matches.length > safeLimit,
  };
}
