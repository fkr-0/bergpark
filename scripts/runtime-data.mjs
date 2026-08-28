import { createHash } from 'node:crypto';

const CONTRACT_SCHEMA_VERSION = 1;
const CONTRACT_VERSION = 1;
const LOAD_PHASES = new Set(['initial', 'hydrate', 'deferred']);
const PRODUCERS = new Set(['copy', 'walking-network']);

export function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function assertSafeRelativePath(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.startsWith('/') || value.includes('..')) {
    throw new Error(`Invalid ${label}: ${String(value)}`);
  }
}

export function validateRuntimeContract(contract) {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) throw new Error('Runtime data contract must be an object');
  if (contract.schema_version !== CONTRACT_SCHEMA_VERSION) {
    throw new Error(`Unsupported runtime manifest schema_version: ${String(contract.schema_version)}`);
  }
  if (contract.contract !== 'bergpark-runtime-data' || contract.contract_version !== CONTRACT_VERSION) {
    throw new Error(`Unsupported runtime data contract: ${String(contract.contract)}@${String(contract.contract_version)}`);
  }
  if (!Array.isArray(contract.layers) || contract.layers.length === 0) throw new Error('Runtime data contract has no layers');

  const ids = new Set();
  const filenames = new Set();
  for (const layer of contract.layers) {
    if (!layer || typeof layer !== 'object' || Array.isArray(layer)) throw new Error('Runtime layer must be an object');
    if (typeof layer.id !== 'string' || layer.id.length === 0 || ids.has(layer.id)) throw new Error(`Invalid or duplicate runtime layer id: ${String(layer.id)}`);
    ids.add(layer.id);
    assertSafeRelativePath(layer.filename, `filename for ${layer.id}`);
    if (filenames.has(layer.filename)) throw new Error(`Duplicate runtime filename: ${layer.filename}`);
    filenames.add(layer.filename);
    if (!LOAD_PHASES.has(layer.load_phase)) throw new Error(`Invalid load_phase for ${layer.id}: ${String(layer.load_phase)}`);
    if (!PRODUCERS.has(layer.producer)) throw new Error(`Invalid producer for ${layer.id}: ${String(layer.producer)}`);
    if (layer.producer === 'copy') assertSafeRelativePath(layer.source, `source for ${layer.id}`);
    if (layer.producer === 'walking-network') {
      if (!Array.isArray(layer.source_inputs) || layer.source_inputs.length !== 2) throw new Error('walking-network requires two source_inputs');
      for (const sourceInput of layer.source_inputs) assertSafeRelativePath(sourceInput, `source input for ${layer.id}`);
    }
    if (layer.boot_required === true && layer.load_phase !== 'initial') throw new Error(`Boot-required layer ${layer.id} must load during initial phase`);
    validateLayerSchemaDefinition(layer);
  }

  for (const [name, value] of Object.entries(contract.budgets ?? {})) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid runtime budget ${name}: ${String(value)}`);
  }
  return contract;
}

function validateLayerSchemaDefinition(layer) {
  const schema = layer.schema ?? {};
  if (schema.kind === 'record-map') return;
  if (typeof schema.field !== 'string' || !Array.isArray(schema.supported) || schema.supported.length === 0) {
    throw new Error(`Runtime layer ${layer.id} has no supported schema contract`);
  }
}

export function validateRuntimeLayerDocument(layer, document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error(`Runtime layer ${layer.id} must contain a JSON object`);
  }
  const schema = layer.schema ?? {};
  if (schema.kind === 'record-map') return document;
  const actual = document[schema.field];
  if (!schema.supported.includes(actual)) {
    throw new Error(`Runtime layer ${layer.id} has incompatible ${schema.field}=${String(actual)}; supported=${schema.supported.join(',')}`);
  }
  return document;
}

export function releaseMetadataFromEnv(env = process.env) {
  const rawEpoch = env.SOURCE_DATE_EPOCH;
  let sourceDateEpoch = null;
  let generatedAt = null;
  if (rawEpoch !== undefined && rawEpoch !== '') {
    if (!/^\d+$/.test(rawEpoch)) throw new Error(`Invalid SOURCE_DATE_EPOCH: ${rawEpoch}`);
    sourceDateEpoch = Number(rawEpoch);
    if (!Number.isSafeInteger(sourceDateEpoch)) throw new Error(`SOURCE_DATE_EPOCH is out of range: ${rawEpoch}`);
    generatedAt = new Date(sourceDateEpoch * 1000).toISOString();
  }
  return {
    source_revision: env.BERGPARK_SOURCE_REVISION || null,
    source_date_epoch: sourceDateEpoch,
    generated_at: generatedAt,
  };
}

function graphCounts(graph = {}) {
  const keys = [
    'nodes',
    'edges',
    'trees',
    'benches',
    'path_nodes',
    'path_segments',
    'visitor_pois',
    'figures',
    'artworks',
    'collections',
    'semantic_edges',
  ];
  return Object.fromEntries(keys.map((key) => [key, Array.isArray(graph[key]) ? graph[key].length : 0]));
}

export function projectWalkingNetwork(pathTopology = {}, graph = {}, hashes = {}) {
  const seenPairs = new Set();
  const segments = [];

  for (const segment of pathTopology.directed_segments ?? []) {
    if (!Array.isArray(segment.geometry) || segment.geometry.length < 2) continue;
    const pairKey = [segment.from, segment.to].sort().join('|');
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);
    segments.push({
      id: segment.id,
      from: segment.from,
      to: segment.to,
      geometry: segment.geometry,
      distance_m: Number.isFinite(segment.distance_m) ? segment.distance_m : null,
      surface: segment.surface ?? null,
      highway: segment.highway ?? null,
      steps: segment.steps === true,
      routing_eligible: segment.routing_eligible !== false,
      pedestrian_oneway: segment.pedestrian_oneway ?? null,
      accessibility_status: segment.accessibility_status ?? 'unknown',
    });
  }

  return {
    schema_version: 1,
    generated_from: {
      path_topology: {
        schema_version: pathTopology.schema_version ?? null,
        generated_at: pathTopology.generated_at ?? null,
        sha256: hashes.pathTopologySha256 ?? null,
      },
      graph: {
        schema_version: graph.schema_version ?? null,
        generated_at: graph.generated_at ?? null,
        sha256: hashes.graphSha256 ?? null,
        counts: graphCounts(graph),
      },
    },
    status: pathTopology.status ?? 'unknown',
    counts: {
      path_nodes: pathTopology.path_node_count ?? pathTopology.path_nodes?.length ?? 0,
      directed_segments: pathTopology.directed_segment_count ?? pathTopology.directed_segments?.length ?? 0,
      rendered_segments: segments.length,
      connected_components: pathTopology.connected_components?.length ?? 0,
    },
    coverage: pathTopology.coverage ?? null,
    segments,
  };
}
