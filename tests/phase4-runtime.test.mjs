import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { deepLinkHash, parseDeepLink } from '../src/deep-link.js';
import { markerKeyboardActivation } from '../src/leaflet-keyboard.js';
import { firstAbsoluteHttpUrl } from '../src/public-url.js';
import { normalizeSemanticData, semanticRelationLabel } from '../src/semantic.js';

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
}

test('visitor evidence rejects internal research refs and selects the canonical public OSM URL', async () => {
  const benches = await readJson('../data/benches.json');
  const bench = benches.benches.find(({ id }) => id === 'bench-45387376');
  assert.ok(bench);
  assert.equal(bench.source_refs[0], 'data/sources/osm-map/ne.xml');
  assert.equal(firstAbsoluteHttpUrl(bench.source_refs), 'https://www.openstreetmap.org/node/45387376');
  assert.equal(firstAbsoluteHttpUrl(['data/sources/research.json', '/internal/path']), null);
});

test('displayed_at keeps relation qualification and resolves source IDs for visitor evidence', async () => {
  const semantic = await readJson('../data/semantic.json');
  const edge = semantic.semantic_edges.find(({ id }) => id === 'sem-segen-jakobs-displayed-at-schloss');
  assert.ok(edge);
  const normalized = normalizeSemanticData({ figures: [] }, semantic);
  const normalizedEdge = normalized.semanticEdges.find(({ id }) => id === edge.id);
  assert.equal(semanticRelationLabel(edge, 'de'), 'wird gezeigt in');
  assert.equal(semanticRelationLabel(edge, 'en'), 'is displayed at');
  assert.equal(normalizedEdge.provenance.qualification, 'This models the museum display/location relation and does not infer ownership or acquisition history.');
  assert.equal(normalizedEdge.sources[0].id, 'hkh-gemaeldegalerie-location');
  assert.equal(normalizedEdge.sources[0].title, 'Gemäldegalerie Alte Meister im Schloss Wilhelmshöhe');
});

test('deep-link parsing covers place/tree/feature and fails closed on malformed fragments', () => {
  assert.deepEqual(parseDeepLink('#place=schloss'), { kind: 'place', id: 'schloss' });
  assert.deepEqual(parseDeepLink('#tree=tree%2F358'), { kind: 'tree', id: 'tree/358' });
  assert.deepEqual(parseDeepLink('#feature=bench-45387376&ignored=1'), { kind: 'feature', id: 'bench-45387376' });
  assert.equal(parseDeepLink('#feature=%E0%A4%A'), null);
  assert.equal(parseDeepLink('#route=herkules'), null);
  assert.equal(deepLinkHash('feature', 'bench 1'), '#feature=bench%201');
});

test('shared marker keyboard helper activates Enter/Space only once and suppresses handled events', () => {
  let activations = 0;
  const events = [];
  const handler = markerKeyboardActivation(() => { activations += 1; });
  for (const key of ['Enter', ' ', 'Escape']) {
    const event = {
      key,
      repeat: false,
      preventDefault: () => events.push(`${key}:prevent`),
      stopPropagation: () => events.push(`${key}:stop`),
    };
    handler({ originalEvent: event });
  }
  handler({ originalEvent: { key: 'Enter', repeat: true } });
  assert.equal(activations, 2);
  assert.deepEqual(events, ['Enter:prevent', 'Enter:stop', ' :prevent', ' :stop']);
});
