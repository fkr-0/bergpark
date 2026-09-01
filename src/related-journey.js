import { localized } from './i18n.js';
import { discoverMountainRoutes } from './discovery.js';

export const RELATED_JOURNEY_LIMIT = 8;
const SEMANTIC_SOURCE_ORDER = new Map([
  ['created', 0],
  ['co_created', 0],
  ['designed', 1],
  ['co_designed', 1],
  ['lead_designer_of', 1],
  ['planned_landscape_setting_for', 1],
  ['developed_collection', 2],
  ['commissioned', 2],
  ['initiated', 2],
  ['member_of_collection', 3],
  ['displayed_at', 4],
  ['installed_at', 4],
  ['located_at', 4],
]);

const RELATION_LABELS = {
  created: { de: 'schuf', en: 'created' },
  co_created: { de: 'schuf mit', en: 'co-created' },
  designed: { de: 'entwarf', en: 'designed' },
  co_designed: { de: 'entwarf mit', en: 'co-designed' },
  lead_designer_of: { de: 'leitete die Gestaltung von', en: 'led the design of' },
  planned_landscape_setting_for: { de: 'plante das landschaftliche Umfeld von', en: 'planned the landscape setting for' },
  developed_collection: { de: 'entwickelte die Sammlung', en: 'developed the collection' },
  commissioned: { de: 'beauftragte', en: 'commissioned' },
  initiated: { de: 'initiierte', en: 'initiated' },
  member_of_collection: { de: 'gehört zur Sammlung', en: 'belongs to the collection' },
  displayed_at: { de: 'wird gezeigt in', en: 'is displayed at' },
  installed_at: { de: 'ist installiert bei', en: 'is installed at' },
  located_at: { de: 'befindet sich bei', en: 'is located at' },
};

function relationLabel(edge, language) {
  const known = RELATION_LABELS[edge?.relation];
  if (known) return localized(known, language, edge.relation);
  const raw = String(edge?.relation ?? '').replaceAll('_', ' ').trim();
  return raw || (language === 'de' ? 'Bezug' : 'Relation');
}

function entityFor(graph, id) {
  return graph?.entitiesById?.get(id) ?? graph?.nodesById?.get(id) ?? null;
}

function sourceIds(edge) {
  return [...new Set((edge?.source_ids ?? edge?.sourceIds ?? []).filter(Boolean))];
}

function sourceRefs(edge) {
  const refs = [
    ...(edge?.source_refs ?? edge?.sourceRefs ?? []),
    ...(edge?.sources ?? []).flatMap((source) => [source?.id, source?.url]),
  ].filter(Boolean);
  return [...new Set(refs)];
}

function semanticItems(graph, nodeId, language) {
  const relations = graph?.semanticRelationsByEntity?.get(nodeId) ?? [];
  return relations.map((edge, index) => {
    const otherId = edge.from === nodeId ? edge.to : edge.from;
    const other = entityFor(graph, otherId);
    if (!other || otherId === nodeId) return null;
    return {
      id: other.id,
      kind: 'semantic',
      routeKind: 'entity',
      source: 'semantic',
      relation: relationLabel(edge, language),
      relationKey: edge.relation ?? null,
      title: localized(other.name, language, other.title ?? other.id),
      context: relationLabel(edge, language),
      item: other,
      edge,
      provenance: edge.provenance ?? null,
      sourceIds: sourceIds(edge),
      sourceRefs: sourceRefs(edge),
      returnContext: Object.freeze({ kind: graph?.nodesById?.has(nodeId) ? 'place' : 'story', id: nodeId }),
      order: [SEMANTIC_SOURCE_ORDER.get(edge.relation) ?? 99, index, other.id],
    };
  }).filter(Boolean);
}

function nearbyItems(graph, nodeId, language) {
  return discoverMountainRoutes(graph, nodeId, language, { limit: RELATED_JOURNEY_LIMIT }).map((option, index) => ({
    id: option.toId,
    kind: 'nearby',
    routeKind: 'place',
    source: 'nearby',
    relation: language === 'de' ? 'direkter Weg' : 'direct walk',
    relationKey: 'nearby',
    title: option.title,
    context: option.evidence.walkingMin != null
      ? `${option.evidence.walkingMin} ${language === 'de' ? 'Min.' : 'min'}`
      : '',
    item: option.target,
    edge: option.edge,
    provenance: option.edge?.provenance ?? null,
    sourceIds: sourceIds(option.edge),
    sourceRefs: sourceRefs(option.edge),
    evidence: option.evidence,
    returnContext: Object.freeze({ kind: 'place', id: nodeId }),
    order: [100, index, option.id],
  }));
}

/** Project canonical semantic relations plus bounded direct walks into a visitor journey. */
export function buildRelatedJourney(graph, nodeId, language = 'de', {
  includeNearby = true,
  limit = RELATED_JOURNEY_LIMIT,
} = {}) {
  const semantic = semanticItems(graph, nodeId, language);
  const nearby = includeNearby ? nearbyItems(graph, nodeId, language) : [];
  const seen = new Set([nodeId]);
  const items = [];
  for (const item of [...semantic, ...nearby]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  items.sort((left, right) => (
    left.order[0] - right.order[0]
    || left.order[1] - right.order[1]
    || String(left.order[2]).localeCompare(String(right.order[2]))
  ));
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : RELATED_JOURNEY_LIMIT;
  return Object.freeze(items.slice(0, safeLimit).map((item) => Object.freeze(item)));
}

export function relatedJourneyBuckets(graph, nodeId, language = 'de', options = {}) {
  const journey = buildRelatedJourney(graph, nodeId, language, options);
  return Object.freeze({
    semantic: Object.freeze(journey.filter((item) => item.source === 'semantic')),
    nearby: Object.freeze(journey.filter((item) => item.source === 'nearby')),
  });
}
