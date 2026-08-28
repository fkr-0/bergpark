import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { hydrateGraphData, loadGraphData, loadInitialGraphData } from '../src/data.js';

const EXPECTED_RUNTIME_FILES = [
  'nodes.json',
  'edges.json',
  'trees.json',
  'nodes.de.json',
  'nodes.en.json',
  'sources.json',
  'figures.json',
  'semantic.json',
  'benches.json',
  'visitor_pois.json',
];

const FIXTURES = {
  'nodes.json': { nodes: [] },
  'edges.json': { edges: [] },
  'trees.json': { trees: [] },
  'nodes.de.json': {},
  'nodes.en.json': {},
  'sources.json': { sources: {} },
  'figures.json': { figures: [] },
  'semantic.json': { artworks: [], collections: [], semantic_edges: [] },
  'benches.json': { benches: [], status: 'ready' },
  'visitor_pois.json': { pois: [], status: 'ready' },
};

test('full graph hydration fans out every runtime-data request before awaiting responses', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const pending = [];

  globalThis.fetch = (url) => {
    const filename = new URL(url, 'https://bergpark.test/').pathname.split('/').pop();
    calls.push(filename);
    return new Promise((resolve) => {
      pending.push(() => resolve(new Response(JSON.stringify(FIXTURES[filename]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })));
    });
  };

  try {
    const loading = loadGraphData('/guide/');
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(calls.length, EXPECTED_RUNTIME_FILES.length);
    assert.deepEqual([...calls].sort(), [...EXPECTED_RUNTIME_FILES].sort());

    for (const resolve of pending) resolve();
    const graph = await loading;
    assert.equal(graph.nodes.length, 0);
    assert.equal(graph.entities.length, 0);
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

test('production startup loads only map core before supplemental hydration and reuses core documents', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const filename = new URL(url, 'https://bergpark.test/').pathname.split('/').pop();
    calls.push(filename);
    return new Response(JSON.stringify(FIXTURES[filename]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const initial = await loadInitialGraphData('/guide/');
    assert.deepEqual(calls, ['nodes.json', 'edges.json']);
    assert.equal(initial.graph.trees.length, 0);
    assert.equal(initial.graph.metadata.treeStatus, 'loading');

    calls.length = 0;
    const hydrated = await hydrateGraphData(initial.coreDocuments, '/guide/');
    assert.deepEqual([...calls].sort(), EXPECTED_RUNTIME_FILES.filter((filename) => !['nodes.json', 'edges.json'].includes(filename)).sort());
    assert.equal(hydrated.metadata.treeStatus, 'ready');
    assert.equal(calls.includes('nodes.json'), false);
    assert.equal(calls.includes('edges.json'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
