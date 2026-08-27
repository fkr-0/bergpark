import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('phase 1 landmark data is bilingual and coordinate-aligned', async () => {
  const de = JSON.parse(await readFile(new URL('../data/nodes.de.json', import.meta.url)));
  const en = JSON.parse(await readFile(new URL('../data/nodes.en.json', import.meta.url)));
  assert.ok(de.length >= 5);
  assert.equal(de.length, en.length);
  assert.deepEqual(de.map(({ id }) => id), en.map(({ id }) => id));
  for (let index = 0; index < de.length; index += 1) {
    assert.equal(de[index].lat, en[index].lat);
    assert.equal(de[index].lon, en[index].lon);
    assert.ok(de[index].lat > 51.3 && de[index].lat < 51.33);
    assert.ok(de[index].lon > 9.38 && de[index].lon < 9.43);
  }
});
