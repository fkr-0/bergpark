import {
  createDestinationIndex,
  destinationCategory,
  searchDestinationIndex,
} from './destination-search.js';
import { createNetworkDiscoveryIndex } from './discovery.js';

export const COMPANION_ALMANAC_CATEGORIES = Object.freeze([
  'all',
  'place',
  'story',
  'tree',
  'feature',
  'walk',
]);

const TEXTUAL_RUNTIME_LAYERS = Object.freeze([
  'nodes',
  'content-de',
  'content-en',
  'sources',
  'figures',
  'semantic',
  'trees',
  'benches',
  'visitor-pois',
  'walking-network',
]);

function manifestLayers(runtimeManifest) {
  return new Map((runtimeManifest?.layers ?? []).map((layer) => [layer.id, layer]));
}

function runtimeLayerIds(entry) {
  if (entry.sourceKind === 'network') return ['walking-network'];
  if (entry.sourceKind === 'tree') return ['trees'];
  if (entry.sourceKind === 'feature') {
    return [entry.item?.layerKind === 'bench' ? 'benches' : 'visitor-pois'];
  }
  if (entry.sourceKind === 'semantic') {
    return entry.item?.type === 'historical_figure' || entry.item?.kind === 'historical_figure'
      ? ['figures', 'semantic']
      : ['semantic'];
  }
  if (entry.sourceKind === 'content') return ['content-de', 'content-en', 'sources'];
  return ['nodes', 'content-de', 'content-en', 'sources'];
}

function runtimeEvidence(entry, runtimeManifest) {
  const layers = manifestLayers(runtimeManifest);
  return Object.freeze(runtimeLayerIds(entry).map((id) => {
    const layer = layers.get(id);
    return Object.freeze({
      id,
      declared: Boolean(layer),
      available: Boolean(layer) && layer.available !== false,
      precache: layer?.precache === true,
      loadPhase: layer?.load_phase ?? null,
      sha256: layer?.sha256 ?? null,
    });
  }));
}

function sourceReferences(item) {
  const refs = [
    ...(item?.source_refs ?? item?.sourceRefs ?? []),
    ...(item?.source_ids ?? item?.sourceIds ?? []),
    ...(item?.sources ?? []).flatMap((source) => [source?.id, source?.url]),
  ].filter(Boolean);
  return Object.freeze([...new Set(refs)]);
}

function decorateEntry(entry, runtimeManifest) {
  return Object.freeze({
    ...entry,
    canonicalId: entry.id,
    category: destinationCategory(entry),
    runtimeEvidence: runtimeEvidence(entry, runtimeManifest),
    sourceReferences: sourceReferences(entry.item),
  });
}

function networkEntry(result, language) {
  const coordinate = result.position
    ? Object.freeze({ lat: result.position.lat, lng: result.position.lng })
    : null;
  const kindLabel = result.kind === 'steps'
    ? (language === 'de' ? 'Kartierte Stufen' : 'Mapped steps')
    : result.kind === 'junction'
      ? (language === 'de' ? 'Wegkreuzung' : 'Path junction')
      : (language === 'de' ? 'Wegabschnitt' : 'Path segment');
  return {
    id: result.id,
    routeKind: 'network',
    sourceKind: 'network',
    title: result.title,
    kindLabel,
    context: result.context,
    coordinate,
    spatial: Boolean(coordinate),
    item: result.source,
    networkKind: result.kind,
    facets: [{ values: [result.kind, kindLabel], label: kindLabel }],
    keywords: [result.id, ...(result.keywords ?? [])].filter(Boolean),
    body: [],
  };
}

/**
 * Build a unified, read-only visitor almanac projection. Passing walkingNetwork is
 * explicit because constructing the path index is intentionally deferred by the app.
 */
export function createCompanionAlmanac({
  entities = [],
  nodeIds = new Set(),
  trees = [],
  visitorFeatures = [],
  walkingNetwork = null,
  runtimeManifest = null,
  language = 'de',
} = {}) {
  const destinations = createDestinationIndex({ entities, nodeIds, trees, visitorFeatures, language })
    .map((entry) => decorateEntry(entry, runtimeManifest));
  const network = walkingNetwork
    ? createNetworkDiscoveryIndex(walkingNetwork, language)
      .map((entry) => decorateEntry(networkEntry(entry, language), runtimeManifest))
    : [];
  const entries = Object.freeze([...destinations, ...network]);
  const counts = Object.freeze(Object.fromEntries(
    COMPANION_ALMANAC_CATEGORIES
      .filter((category) => category !== 'all')
      .map((category) => [category, entries.filter((entry) => entry.category === category).length]),
  ));
  return Object.freeze({
    language,
    entries,
    destinations: Object.freeze(destinations),
    network: Object.freeze(network),
    counts,
    offline: companionOfflineReadiness(runtimeManifest),
  });
}

export function searchCompanionAlmanac(almanac, query = '', language = almanac?.language ?? 'de', options = {}) {
  return searchDestinationIndex(almanac?.entries ?? [], query, language, options);
}

/**
 * Describe what the release manifest promises for warmed-offline companion text.
 * This never claims that a specific browser cache is currently warm.
 */
export function companionOfflineReadiness(runtimeManifest) {
  if (!runtimeManifest?.layers) {
    return Object.freeze({ state: 'unavailable', basis: 'runtime-manifest', layers: Object.freeze([]) });
  }
  const layers = manifestLayers(runtimeManifest);
  const evidence = TEXTUAL_RUNTIME_LAYERS.map((id) => {
    const layer = layers.get(id);
    return Object.freeze({
      id,
      declared: Boolean(layer),
      available: Boolean(layer) && layer.available !== false,
      precache: layer?.precache === true,
      loadPhase: layer?.load_phase ?? null,
    });
  });
  const complete = evidence.every(({ declared, available, precache }) => declared && available && precache);
  return Object.freeze({
    state: complete ? 'ready-after-warm' : 'partial',
    basis: 'runtime-manifest-precache',
    layers: Object.freeze(evidence),
  });
}

function radians(value) {
  return value * Math.PI / 180;
}

function straightLineDistanceM(left, right) {
  const earthRadiusM = 6_371_008.8;
  const latDelta = radians(right.lat - left.lat);
  const lngDelta = radians(right.lng - left.lng);
  const leftLat = radians(left.lat);
  const rightLat = radians(right.lat);
  const a = Math.sin(latDelta / 2) ** 2
    + Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(lngDelta / 2) ** 2;
  return earthRadiusM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Bounded coordinate proximity only. This is discovery, not a walking route and not
 * evidence that an object is accessible or visible from the origin.
 */
export function nearbyCompanionEntries(almanacOrEntries, origin, {
  categories = ['place', 'tree', 'feature'],
  radiusM = 250,
  limit = 6,
  excludeId = null,
} = {}) {
  const entries = Array.isArray(almanacOrEntries) ? almanacOrEntries : almanacOrEntries?.entries ?? [];
  const originCoordinate = origin?.coordinate ?? origin;
  if (!Number.isFinite(originCoordinate?.lat) || !Number.isFinite(originCoordinate?.lng)) return Object.freeze([]);
  const categorySet = new Set(categories);
  const safeRadius = Number.isFinite(radiusM) ? Math.max(0, radiusM) : 250;
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 6;
  const matches = entries
    .filter((entry) => entry.id !== excludeId && categorySet.has(entry.category) && entry.coordinate)
    .map((entry) => ({ entry, distanceM: straightLineDistanceM(originCoordinate, entry.coordinate) }))
    .filter(({ distanceM }) => distanceM <= safeRadius)
    .sort((left, right) => left.distanceM - right.distanceM || left.entry.id.localeCompare(right.entry.id))
    .slice(0, safeLimit)
    .map(({ entry, distanceM }) => Object.freeze({
      ...entry,
      proximity: Object.freeze({
        distanceM,
        basis: 'published-coordinate-straight-line',
        routeClaim: false,
      }),
    }));
  return Object.freeze(matches);
}
