import { normalizeSemanticData } from './semantic.js';

const REQUIRED_FILES = ['nodes.json', 'edges.json', 'trees.json'];
const CONTENT_ID_ALIASES = {
  schloss: 'schloss-wilhelmshoehe',
  eremitage: 'eremitage-des-sokrates',
};

async function loadJson(baseUrl, filename) {
  const response = await fetch(`${baseUrl}data/${filename}`);
  if (!response.ok) throw new Error(`Failed to load ${filename}: ${response.status}`);
  return response.json();
}

async function loadOptionalJson(baseUrl, filename, fallback = null) {
  try {
    return await loadJson(baseUrl, filename);
  } catch (error) {
    if (/404/.test(error.message)) return fallback;
    console.warn(`Optional Bergpark data unavailable: ${filename}`, error);
    return fallback;
  }
}

function localizedField(de, en, key, fallback = undefined) {
  const deValue = de?.[key];
  const enValue = en?.[key];
  if (deValue === undefined && enValue === undefined) return fallback;
  return { de: deValue ?? enValue, en: enValue ?? deValue };
}

function resolveSources(content, sourceRegistry) {
  const ids = new Set([...(content.de?.sourceIds ?? []), ...(content.en?.sourceIds ?? [])]);
  return [...ids].map((id) => ({ id, ...(sourceRegistry?.sources?.[id] ?? {}) }));
}

function enrichNode(node, deDoc, enDoc, sourceRegistry) {
  const contentId = CONTENT_ID_ALIASES[node.id] ?? node.id;
  const de = deDoc?.[contentId];
  const en = enDoc?.[contentId];
  if (!de && !en) return node;

  return {
    ...node,
    content_id: contentId,
    name: {
      de: de?.name ?? node.name?.de ?? en?.name ?? node.id,
      en: en?.name ?? node.name?.en ?? de?.name ?? node.id,
    },
    shortName: localizedField(de, en, 'shortName'),
    summary: localizedField(de, en, 'shortDescription'),
    description: localizedField(de, en, 'longDescription'),
    history: localizedField(de, en, 'history'),
    architecture: localizedField(de, en, 'architecture'),
    significance: localizedField(de, en, 'culturalSignificance'),
    restorationHistory: localizedField(de, en, 'restorationHistory'),
    visitorContext: localizedField(de, en, 'visitorContext'),
    artworks: localizedField(de, en, 'artworks', { de: [], en: [] }),
    figures: [...new Set([...(de?.figures ?? []), ...(en?.figures ?? [])])],
    images: localizedField(de, en, 'images', { de: [], en: [] }),
    visitInfo: localizedField(de, en, 'visitInfo'),
    tags: [...new Set([...(de?.tags ?? []), ...(en?.tags ?? [])])],
    contentMeta: localizedField(de, en, 'contentMeta'),
    uncertainties: localizedField(de, en, 'uncertainties', { de: [], en: [] }),
    sources: resolveSources({ de, en }, sourceRegistry),
  };
}

export async function loadGraphData(baseUrl = import.meta.env.BASE_URL) {
  const [nodesDoc, edgesDoc, treesDoc] = await Promise.all(REQUIRED_FILES.map((filename) => loadJson(baseUrl, filename)));
  const [deDoc, enDoc, sourceRegistry] = await Promise.all([
    loadOptionalJson(baseUrl, 'nodes.de.json', {}),
    loadOptionalJson(baseUrl, 'nodes.en.json', {}),
    loadOptionalJson(baseUrl, 'sources.json', { sources: {} }),
  ]);
  const [figuresDoc, semanticDoc] = await Promise.all([
    loadOptionalJson(baseUrl, 'figures.json', { figures: [] }),
    loadOptionalJson(baseUrl, 'semantic.json', { artworks: [], collections: [], semantic_edges: [] }),
  ]);

  const rawNodes = nodesDoc.nodes ?? nodesDoc;
  const nodes = rawNodes.map((node) => enrichNode(node, deDoc, enDoc, sourceRegistry));
  const edges = edgesDoc.edges ?? edgesDoc;
  const trees = treesDoc.trees ?? treesDoc;
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));

  for (const edge of edges) {
    if (outgoing.has(edge.from)) outgoing.get(edge.from).push(edge);
  }

  const contentOnlyEntities = [];
  const graphContentIds = new Set(nodes.map((node) => node.content_id ?? node.id));
  for (const contentId of new Set([...Object.keys(deDoc ?? {}), ...Object.keys(enDoc ?? {})])) {
    if (graphContentIds.has(contentId)) continue;
    const de = deDoc?.[contentId];
    const en = enDoc?.[contentId];
    contentOnlyEntities.push({
      id: contentId,
      kind: 'entity',
      type: de?.type ?? en?.type ?? 'entity',
      name: { de: de?.name ?? en?.name ?? contentId, en: en?.name ?? de?.name ?? contentId },
      summary: localizedField(de, en, 'shortDescription'),
      description: localizedField(de, en, 'longDescription'),
      history: localizedField(de, en, 'history'),
      architecture: localizedField(de, en, 'architecture'),
      significance: localizedField(de, en, 'culturalSignificance'),
      sources: resolveSources({ de, en }, sourceRegistry),
    });
  }

  const semantic = normalizeSemanticData(figuresDoc, semanticDoc);
  const entities = [...nodes, ...contentOnlyEntities, ...semantic.entities];
  const entitiesById = new Map(entities.map((entity) => [entity.id, entity]));

  return {
    nodes,
    edges,
    trees,
    nodesById,
    outgoing,
    entities,
    entitiesById,
    semanticEdges: semantic.semanticEdges,
    semanticRelationsByEntity: semantic.relationsByEntity,
    metadata: {
      nodeSchemaVersion: nodesDoc.schema_version ?? nodesDoc.schemaVersion ?? 1,
      edgeSchemaVersion: edgesDoc.schema_version ?? edgesDoc.schemaVersion ?? 1,
      treeStatus: treesDoc.status ?? 'ready',
      semanticStatus: semantic.status,
      contentLanguages: { de: Object.keys(deDoc ?? {}).length, en: Object.keys(enDoc ?? {}).length },
    },
  };
}

export function edgeBetween(graph, fromId, toId) {
  return graph.outgoing.get(fromId)?.find((edge) => edge.to === toId) ?? null;
}
