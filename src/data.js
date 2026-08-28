import { normalizeSemanticData } from './semantic.js';
import { normalizeVisitorLayerData } from './visitor-layer-data.js';

const RUNTIME_CONTRACT = 'bergpark-runtime-data';
const RUNTIME_CONTRACT_VERSION = 1;
const RUNTIME_MANIFEST_SCHEMA_VERSION = 1;
const CONTENT_ID_ALIASES = {
  schloss: 'schloss-wilhelmshoehe',
  eremitage: 'eremitage-des-sokrates',
};

const ASSEMBLY_LAYER_IDS = [
  'nodes',
  'edges',
  'trees',
  'content-de',
  'content-en',
  'sources',
  'figures',
  'semantic',
  'benches',
  'visitor-pois',
];

export class RuntimeDataError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RuntimeDataError';
    this.code = code;
    this.details = details;
  }
}

function assertJsonContentType(response, label) {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    throw new RuntimeDataError(
      'invalid_content_type',
      `${label} returned ${contentType || 'no content type'} instead of JSON`,
      { status: response.status, url: response.url, contentType },
    );
  }
}

async function fetchJsonDocument(url, label) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new RuntimeDataError('http_error', `${label} request failed: ${response.status}`, {
      status: response.status,
      url: response.url || String(url),
    });
  }
  assertJsonContentType(response, label);
  try {
    return await response.json();
  } catch (error) {
    throw new RuntimeDataError('invalid_json', `${label} did not contain valid JSON`, {
      url: response.url || String(url),
      cause: error.message,
    });
  }
}

function validateRuntimeManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new RuntimeDataError('invalid_manifest', 'Runtime data manifest must be a JSON object');
  }
  if (
    manifest.schema_version !== RUNTIME_MANIFEST_SCHEMA_VERSION
    || manifest.contract !== RUNTIME_CONTRACT
    || manifest.contract_version !== RUNTIME_CONTRACT_VERSION
  ) {
    throw new RuntimeDataError(
      'incompatible_manifest',
      `Unsupported runtime data contract ${String(manifest.contract)}@${String(manifest.contract_version)}`,
      { schemaVersion: manifest.schema_version },
    );
  }
  if (!Array.isArray(manifest.layers) || manifest.layers.length === 0) {
    throw new RuntimeDataError('invalid_manifest', 'Runtime data manifest has no layers');
  }
  const ids = new Set();
  const filenames = new Set();
  for (const layer of manifest.layers) {
    if (!layer?.id || !layer?.filename || ids.has(layer.id) || filenames.has(layer.filename)) {
      throw new RuntimeDataError('invalid_manifest', `Invalid or duplicate runtime layer ${String(layer?.id)}`);
    }
    ids.add(layer.id);
    filenames.add(layer.filename);
  }
  return manifest;
}

function layerById(manifest, id) {
  const layer = manifest.layers.find((candidate) => candidate.id === id);
  if (!layer) throw new RuntimeDataError('missing_contract_layer', `Runtime contract does not define layer ${id}`, { layerId: id });
  return layer;
}

function validateLayerDocument(layer, document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new RuntimeDataError('invalid_layer_shape', `Runtime layer ${layer.id} must contain a JSON object`, { layerId: layer.id });
  }
  if (layer.schema?.kind === 'record-map') return document;
  const schemaField = layer.schema?.field;
  const supported = layer.schema?.supported;
  if (!schemaField || !Array.isArray(supported) || !supported.includes(document[schemaField])) {
    throw new RuntimeDataError(
      'incompatible_layer_schema',
      `Runtime layer ${layer.id} has incompatible ${String(schemaField)}=${String(document[schemaField])}`,
      { layerId: layer.id, schemaField, supported, actual: document[schemaField] },
    );
  }
  return document;
}

export async function loadRuntimeManifest(baseUrl = import.meta.env.BASE_URL) {
  return validateRuntimeManifest(await fetchJsonDocument(`${baseUrl}data/runtime-manifest.json`, 'Runtime data manifest'));
}

async function loadRuntimeLayer(manifest, layerId, baseUrl) {
  const layer = layerById(manifest, layerId);
  if (layer.available === false) {
    throw new RuntimeDataError('layer_unavailable', `Runtime layer ${layerId} is unavailable in this release`, {
      layerId,
      reason: layer.unavailable_reason ?? null,
    });
  }
  const document = await fetchJsonDocument(`${baseUrl}data/${layer.filename}`, `Runtime layer ${layerId}`);
  return validateLayerDocument(layer, document);
}

function readyLayerState(layer) {
  return { state: 'ready', filename: layer.filename, schema: layer.schema ?? null };
}

function unavailableLayerState(layer, error) {
  return {
    state: 'unavailable',
    filename: layer.filename,
    schema: layer.schema ?? null,
    error: {
      code: error?.code ?? 'load_failed',
      message: error?.message ?? String(error),
    },
  };
}

async function loadLayerSet(manifest, layerIds, baseUrl, { tolerateNonBoot = true } = {}) {
  const results = await Promise.all(layerIds.map(async (layerId) => {
    const layer = layerById(manifest, layerId);
    try {
      return [layerId, await loadRuntimeLayer(manifest, layerId, baseUrl), readyLayerState(layer)];
    } catch (error) {
      if (layer.boot_required || !tolerateNonBoot) throw error;
      console.warn(`Bergpark runtime layer unavailable: ${layerId}`, error);
      return [layerId, null, unavailableLayerState(layer, error)];
    }
  }));
  return {
    documents: Object.fromEntries(results.map(([id, document]) => [id, document])),
    layerStatus: Object.fromEntries(results.map(([id, , status]) => [id, status])),
  };
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

function assemblyDocuments(documents) {
  const has = (id) => Object.hasOwn(documents, id);
  return {
    nodesDoc: documents.nodes,
    edgesDoc: documents.edges,
    treesDoc: has('trees')
      ? documents.trees ?? { trees: [], status: 'unavailable' }
      : { trees: [], status: 'loading' },
    deDoc: documents['content-de'] ?? {},
    enDoc: documents['content-en'] ?? {},
    sourceRegistry: documents.sources ?? { sources: {} },
    figuresDoc: documents.figures ?? { figures: [] },
    semanticDoc: has('semantic')
      ? documents.semantic ?? { artworks: [], collections: [], semantic_edges: [], status: 'unavailable' }
      : { artworks: [], collections: [], semantic_edges: [], status: 'loading' },
    benchesDoc: has('benches')
      ? documents.benches ?? { benches: [], status: 'unavailable' }
      : { benches: [], status: 'loading' },
    visitorPoisDoc: has('visitor-pois')
      ? documents['visitor-pois'] ?? { pois: [], status: 'unavailable' }
      : { pois: [], status: 'loading' },
  };
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
  runtimeManifest = null,
  runtimeLayerStatus = {},
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
      runtimeContractVersion: runtimeManifest?.contract_version ?? null,
      runtimeLayers: runtimeLayerStatus,
      nodeSchemaVersion: nodesDoc.schema_version ?? nodesDoc.schemaVersion ?? 1,
      edgeSchemaVersion: edgesDoc.schema_version ?? edgesDoc.schemaVersion ?? 1,
      treeStatus: runtimeLayerStatus.trees?.state === 'unavailable' ? 'unavailable' : treesDoc.status ?? 'ready',
      semanticStatus: runtimeLayerStatus.semantic?.state === 'unavailable' ? 'unavailable' : semantic.status,
      benchStatus: runtimeLayerStatus.benches?.state === 'unavailable' ? 'unavailable' : visitorLayers.status.benches,
      visitorPoiStatus: runtimeLayerStatus['visitor-pois']?.state === 'unavailable' ? 'unavailable' : visitorLayers.status.pois,
      contentLanguages: { de: Object.keys(deDoc ?? {}).length, en: Object.keys(enDoc ?? {}).length },
    },
  };
}

export async function loadInitialGraphData(baseUrl = import.meta.env.BASE_URL) {
  const runtimeManifest = await loadRuntimeManifest(baseUrl);
  const initialIds = runtimeManifest.layers.filter((layer) => layer.load_phase === 'initial').map((layer) => layer.id);
  const loaded = await loadLayerSet(runtimeManifest, initialIds, baseUrl, { tolerateNonBoot: false });
  const graph = assembleGraphData({
    ...assemblyDocuments(loaded.documents),
    runtimeManifest,
    runtimeLayerStatus: loaded.layerStatus,
  });
  return {
    graph,
    coreDocuments: {
      runtimeManifest,
      documents: loaded.documents,
      runtimeLayerStatus: loaded.layerStatus,
    },
  };
}

export async function hydrateGraphData(coreDocuments, baseUrl = import.meta.env.BASE_URL) {
  const runtimeManifest = coreDocuments.runtimeManifest ?? await loadRuntimeManifest(baseUrl);
  const hydrateIds = runtimeManifest.layers.filter((layer) => layer.load_phase === 'hydrate').map((layer) => layer.id);
  const loaded = await loadLayerSet(runtimeManifest, hydrateIds, baseUrl);
  const documents = { ...(coreDocuments.documents ?? {}), ...loaded.documents };
  const runtimeLayerStatus = { ...(coreDocuments.runtimeLayerStatus ?? {}), ...loaded.layerStatus };
  return assembleGraphData({
    ...assemblyDocuments(documents),
    runtimeManifest,
    runtimeLayerStatus,
  });
}

export async function loadGraphData(baseUrl = import.meta.env.BASE_URL) {
  const runtimeManifest = await loadRuntimeManifest(baseUrl);
  const layerIds = runtimeManifest.layers
    .filter((layer) => ASSEMBLY_LAYER_IDS.includes(layer.id))
    .map((layer) => layer.id);
  const loaded = await loadLayerSet(runtimeManifest, layerIds, baseUrl);
  return assembleGraphData({
    ...assemblyDocuments(loaded.documents),
    runtimeManifest,
    runtimeLayerStatus: loaded.layerStatus,
  });
}

export async function loadWalkingNetwork(baseUrl = import.meta.env.BASE_URL) {
  const runtimeManifest = await loadRuntimeManifest(baseUrl);
  const layer = layerById(runtimeManifest, 'walking-network');
  try {
    return await loadRuntimeLayer(runtimeManifest, layer.id, baseUrl);
  } catch (error) {
    console.warn('Bergpark walking network unavailable', error);
    return null;
  }
}

export function edgeBetween(graph, fromId, toId) {
  return graph.outgoing.get(fromId)?.find((edge) => edge.to === toId) ?? null;
}
