import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('phase 1 graph exposes bilingual landmark nodes in the Bergpark bounds', async () => {
  const document = JSON.parse(await readFile(new URL('../data/nodes.json', import.meta.url)));
  const nodes = document.nodes;
  assert.ok(nodes.length >= 5);
  for (const node of nodes) {
    assert.ok(node.id);
    assert.ok(node.name?.de);
    assert.ok(node.name?.en);
    assert.ok(node.lat > 51.3 && node.lat < 51.33);
    assert.ok(node.lng > 9.38 && node.lng < 9.43);
  }
});

test('phase 1 graph contains the visitor-guide anchor landmarks', async () => {
  const document = JSON.parse(await readFile(new URL('../data/nodes.json', import.meta.url)));
  const ids = new Set(document.nodes.map(({ id }) => id));
  for (const id of ['herkules', 'schloss', 'loewenburg', 'grosse-fontaene', 'teufelsbruecke', 'aquaedukt']) {
    assert.ok(ids.has(id), `missing ${id}`);
  }
});
