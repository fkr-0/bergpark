import { localized } from './i18n.js';
import { routeEvidence } from './routes.js';

export const ROUTE_COMPARISON_LIMIT = 8;
export const NETWORK_RESULT_LIMIT = 40;

const ROUTE_SORTS = new Set(['time', 'distance', 'ascent']);
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
  return nullableMetric(option.evidence.walkingMin);
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
