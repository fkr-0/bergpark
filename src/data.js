import { normalizeSemanticData } from './semantic.js';
import { normalizeVisitorLayerData } from './visitor-layer-data.js';

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

function mergedList(de, en, key) {
  const deValues = Array.isArray(de?.[key]) ? de[key] : [];
  const enValues = Array.isArray(en?.[key]) ? en[key] : [];
  return [...new Set([...deValues, ...enValues])];
}

function enrichedContentFields(de, en, sourceRegistry) {
  return {
    shortName: localizedField(de, en, 'shortName'),
    summary: localizedField(de, en, 'shortDescription'),
    description: localizedField(de, en, 'longDescription'),
    history: localizedField(de, en, 'history'),
    architecture: localizedField(de, en, 'architecture'),
    significance: localizedField(de, en, 'culturalSignificance'),
    restorationHistory: localizedField(de, en, 'restorationHistory'),
    visitorContext: localizedField(de, en, 'visitorContext'),
    artworks: localizedField(de, en, 'artworks', { de: [], en: [] }),
    artworkContext: localizedField(de, en, 'artworkContext'),
    figures: mergedList(de, en, 'figures'),
    images: localizedField(de, en, 'images', { de: [], en: [] }),
    visitInfo: localizedField(de, en, 'visitInfo'),
    tags: mergedList(de, en, 'tags'),
    aliases: mergedList(de, en, 'aliases'),
    interpretation: localizedField(de, en, 'interpretation'),
    state: localizedField(de, en, 'state'),
    contentMeta: localizedField(de, en, 'contentMeta'),
    uncertainties: localizedField(de, en, 'uncertainties', { de: [], en: [] }),
    sources: resolveSources({ de, en }, sourceRegistry),
  };
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
    ...enrichedContentFields(de, en, sourceRegistry),
  };
}

export async function loadWalkingNetwork(baseUrl = import.meta.env.BASE_URL) {
  return loadOptionalJson(baseUrl, 'walking-network.json', null);
}

function assembleGraphData({
  nodesDoc,
  edgesDoc,
  treesDoc = { trees: [], status: 'loading' },
  deDoc = {},
  enDoc = {},
  sourceRegistry = { sources: {} },
  figuresDoc = { figures: [] },
  semanticDoc = { artworks: [], collections: [], semantic_edges: [] },
  benchesDoc = null,
  visitorPoisDoc = null,
}) {
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
      ...enrichedContentFields(de, en, sourceRegistry),
    });
  }

  const semantic = normalizeSemanticData(figuresDoc, semanticDoc);
  const visitorLayers = normalizeVisitorLayerData(benchesDoc, visitorPoisDoc);
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
    visitorLayers,
    visitorFeaturesById: new Map(visitorLayers.features.map((feature) => [feature.id, feature])),
    metadata: {
      nodeSchemaVersion: nodesDoc.schema_version ?? nodesDoc.schemaVersion ?? 1,
      edgeSchemaVersion: edgesDoc.schema_version ?? edgesDoc.schemaVersion ?? 1,
      treeStatus: treesDoc.status ?? 'ready',
      semanticStatus: semantic.status,
      benchStatus: visitorLayers.status.benches,
      visitorPoiStatus: visitorLayers.status.pois,
      contentLanguages: { de: Object.keys(deDoc ?? {}).length, en: Object.keys(enDoc ?? {}).length },
    },
  };
}

export async function loadInitialGraphData(baseUrl = import.meta.env.BASE_URL) {
  const [nodesDoc, edgesDoc] = await Promise.all([
    loadJson(baseUrl, 'nodes.json'),
    loadJson(baseUrl, 'edges.json'),
  ]);
  return {
    graph: assembleGraphData({ nodesDoc, edgesDoc }),
    coreDocuments: { nodesDoc, edgesDoc },
  };
}

export async function hydrateGraphData(coreDocuments, baseUrl = import.meta.env.BASE_URL) {
  const [treesDoc, deDoc, enDoc, sourceRegistry, figuresDoc, semanticDoc, benchesDoc, visitorPoisDoc] = await Promise.all([
    loadJson(baseUrl, 'trees.json'),
    loadOptionalJson(baseUrl, 'nodes.de.json', {}),
    loadOptionalJson(baseUrl, 'nodes.en.json', {}),
    loadOptionalJson(baseUrl, 'sources.json', { sources: {} }),
    loadOptionalJson(baseUrl, 'figures.json', { figures: [] }),
    loadOptionalJson(baseUrl, 'semantic.json', { artworks: [], collections: [], semantic_edges: [] }),
    loadOptionalJson(baseUrl, 'benches.json', null),
    loadOptionalJson(baseUrl, 'visitor_pois.json', null),
  ]);
  return assembleGraphData({
    ...coreDocuments,
    treesDoc,
    deDoc,
    enDoc,
    sourceRegistry,
    figuresDoc,
    semanticDoc,
    benchesDoc,
    visitorPoisDoc,
  });
}

export async function loadGraphData(baseUrl = import.meta.env.BASE_URL) {
  const [
    nodesDoc,
    edgesDoc,
    treesDoc,
    deDoc,
    enDoc,
    sourceRegistry,
    figuresDoc,
    semanticDoc,
    benchesDoc,
    visitorPoisDoc,
  ] = await Promise.all([
    ...REQUIRED_FILES.map((filename) => loadJson(baseUrl, filename)),
    loadOptionalJson(baseUrl, 'nodes.de.json', {}),
    loadOptionalJson(baseUrl, 'nodes.en.json', {}),
    loadOptionalJson(baseUrl, 'sources.json', { sources: {} }),
    loadOptionalJson(baseUrl, 'figures.json', { figures: [] }),
    loadOptionalJson(baseUrl, 'semantic.json', { artworks: [], collections: [], semantic_edges: [] }),
    loadOptionalJson(baseUrl, 'benches.json', null),
    loadOptionalJson(baseUrl, 'visitor_pois.json', null),
  ]);
  return assembleGraphData({
    nodesDoc,
    edgesDoc,
    treesDoc,
    deDoc,
    enDoc,
    sourceRegistry,
    figuresDoc,
    semanticDoc,
    benchesDoc,
    visitorPoisDoc,
  });
}

export function edgeBetween(graph, fromId, toId) {
  return graph.outgoing.get(fromId)?.find((edge) => edge.to === toId) ?? null;
}
