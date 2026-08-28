import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  hydrateGraphData,
  loadGraphData,
  loadInitialGraphData,
  loadRuntimeManifest,
  RuntimeDataError,
} from '../src/data.js';

const CONTRACT = JSON.parse(await readFile(new URL('../runtime/runtime-data-manifest.json', import.meta.url), 'utf8'));
const PUBLISHED_MANIFEST = {
  ...CONTRACT,
  layers: CONTRACT.layers.map((layer) => ({ ...layer, available: true, bytes: 1, sha256: 'fixture' })),
};
const EXPECTED_RUNTIME_FILES = CONTRACT.layers
  .filter((layer) => layer.load_phase !== 'deferred')
  .map((layer) => layer.filename);

const FIXTURES = {
  'runtime-manifest.json': PUBLISHED_MANIFEST,
  'nodes.json': { schema_version: 2, nodes: [] },
  'edges.json': { schema_version: 1, edges: [] },
  'trees.json': { schema_version: 2, trees: [] },
  'nodes.de.json': {},
  'nodes.en.json': {},
  'sources.json': { schemaVersion: 1, sources: {} },
  'figures.json': { schema_version: 1, figures: [] },
  'semantic.json': { schema_version: 1, artworks: [], collections: [], semantic_edges: [] },
  'benches.json': { schema_version: 1, benches: [], status: 'ready' },
  'visitor_pois.json': { schema_version: 1, pois: [], status: 'ready' },
};

function jsonFixtureResponse(filename, fixture = FIXTURES[filename]) {
  return new Response(JSON.stringify(fixture), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('full graph hydration follows manifest authority and fans out runtime layers after manifest resolution', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const pending = [];

  globalThis.fetch = (url) => {
    const filename = new URL(url, 'https://bergpark.test/').pathname.split('/').pop();
    calls.push(filename);
    if (filename === 'runtime-manifest.json') return Promise.resolve(jsonFixtureResponse(filename));
    return new Promise((resolve) => {
      pending.push(() => resolve(jsonFixtureResponse(filename)));
    });
  };

  try {
    const loading = loadGraphData('/guide/');
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(calls[0], 'runtime-manifest.json');
    assert.deepEqual([...calls.slice(1)].sort(), [...EXPECTED_RUNTIME_FILES].sort());
    assert.equal(calls.length, EXPECTED_RUNTIME_FILES.length + 1);

    for (const resolve of pending) resolve();
    const graph = await loading;
    assert.equal(graph.nodes.length, 0);
    assert.equal(graph.entities.length, 0);
    assert.equal(graph.metadata.runtimeContractVersion, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('LCP-critical OSM tile origins are preconnected without eagerly loading Three.js', async () => {
  const [html, mapSource] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/map.js', import.meta.url), 'utf8'),
  ]);
  for (const subdomain of ['a', 'b', 'c']) {
    assert.match(html, new RegExp(`rel="preconnect" href="https://${subdomain}\\.tile\\.openstreetmap\\.org"`));
  }
  assert.doesNotMatch(html, /three\.module|GLTFLoader|OrbitControls/);
  assert.match(mapSource, /import\('\.\/model-viewer\.js'\)/);
});

test('production startup loads manifest plus map core before supplemental hydration and reuses contract/core documents', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const filename = new URL(url, 'https://bergpark.test/').pathname.split('/').pop();
    calls.push(filename);
    return jsonFixtureResponse(filename);
  };

  try {
    const initial = await loadInitialGraphData('/guide/');
    assert.deepEqual(calls, ['runtime-manifest.json', 'nodes.json', 'edges.json']);
    assert.equal(initial.graph.trees.length, 0);
    assert.equal(initial.graph.metadata.treeStatus, 'loading');

    calls.length = 0;
    const hydrated = await hydrateGraphData(initial.coreDocuments, '/guide/');
    assert.deepEqual(
      [...calls].sort(),
      EXPECTED_RUNTIME_FILES.filter((filename) => !['nodes.json', 'edges.json'].includes(filename)).sort(),
    );
    assert.equal(hydrated.metadata.treeStatus, 'ready');
    assert.equal(calls.includes('runtime-manifest.json'), false);
    assert.equal(calls.includes('nodes.json'), false);
    assert.equal(calls.includes('edges.json'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('supplemental schema incompatibility is explicit instead of silently becoming a ready empty layer', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const filename = new URL(url, 'https://bergpark.test/').pathname.split('/').pop();
    if (filename === 'semantic.json') return jsonFixtureResponse(filename, { schema_version: 99, artworks: [] });
    return jsonFixtureResponse(filename);
  };

  try {
    const initial = await loadInitialGraphData('/guide/');
    const hydrated = await hydrateGraphData(initial.coreDocuments, '/guide/');
    assert.equal(hydrated.metadata.semanticStatus, 'unavailable');
    assert.equal(hydrated.metadata.runtimeLayers.semantic.state, 'unavailable');
    assert.equal(hydrated.metadata.runtimeLayers.semantic.error.code, 'incompatible_layer_schema');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('runtime loader rejects HTML-as-JSON responses before parsing', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<!doctype html><title>fallback</title>', {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  });

  try {
    await assert.rejects(
      () => loadRuntimeManifest('/guide/'),
      (error) => error instanceof RuntimeDataError && error.code === 'invalid_content_type',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
