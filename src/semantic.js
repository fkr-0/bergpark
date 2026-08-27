import { localized } from './i18n.js';

const RELATION_LABELS = {
  commissioned: { de: 'beauftragte', en: 'commissioned' },
  initiated: { de: 'initiierte', en: 'initiated' },
  lead_designer_of: { de: 'leitete die Gestaltung von', en: 'led the design of' },
  designed: { de: 'entwarf', en: 'designed' },
  planned_landscape_setting_for: { de: 'plante das landschaftliche Umfeld von', en: 'planned the landscape setting for' },
  created: { de: 'schuf', en: 'created' },
  member_of_collection: { de: 'gehört zur Sammlung', en: 'belongs to the collection' },
  located_at: { de: 'befindet sich in', en: 'is located at' },
};

function sourceMap(semanticDoc) {
  return new Map((semanticDoc?.sources ?? []).map((source) => [source.id, source]));
}

function resolvedSources(entity, sources) {
  return (entity?.source_ids ?? []).map((id) => ({ id, ...(sources.get(id) ?? {}) }));
}

function normalizeEntity(entity, type, sources) {
  return {
    ...entity,
    type: entity.type ?? entity.kind ?? type,
    kind: entity.kind ?? type,
    sources: resolvedSources(entity, sources),
    searchTerms: [
      ...(entity.roles ?? []),
      entity.object_type,
      entity.creator_id,
      entity.current_place_id,
    ].filter(Boolean),
  };
}

export function normalizeSemanticData(figuresDoc = {}, semanticDoc = {}) {
  const sources = sourceMap(semanticDoc);
  const figures = (figuresDoc.figures ?? figuresDoc ?? []).map((entity) => normalizeEntity(entity, 'historical_figure', sources));
  const artworks = (semanticDoc.artworks ?? []).map((entity) => normalizeEntity(entity, 'artwork', sources));
  const collections = (semanticDoc.collections ?? []).map((entity) => normalizeEntity(entity, 'collection', sources));
  const entities = [...figures, ...artworks, ...collections];
  const semanticEdges = semanticDoc.semantic_edges ?? [];
  const relationsByEntity = new Map();

  for (const edge of semanticEdges) {
    for (const id of [edge.from, edge.to]) {
      const existing = relationsByEntity.get(id) ?? [];
      existing.push(edge);
      relationsByEntity.set(id, existing);
    }
  }

  return {
    entities,
    semanticEdges,
    relationsByEntity,
    status: semanticDoc.status ?? (entities.length || semanticEdges.length ? 'ready' : 'unavailable'),
  };
}

export function semanticRelationLabel(edge, language = 'de') {
  return localized(RELATION_LABELS[edge?.relation], language, edge?.relation?.replaceAll('_', ' ') ?? '');
}
