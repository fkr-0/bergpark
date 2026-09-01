import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceUrl = new URL('../src/maplibre-map.js', import.meta.url);

test('terrain lifecycle keeps the style-created mesh and retries qualification from DEM source events', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  assert.match(source, /map\.getTerrain(?:\?\.)?\(\)\?\.source === TERRAIN_SOURCE_ID/);
  assert.match(source, /if \(terrainIsActive\(\)\)/);
  assert.match(source, /map\.on\('sourcedata'/);
  assert.match(source, /TERRAIN_VERIFY_MAX_ATTEMPTS/);
  assert.match(source, /terrain-elevation-unavailable/);
  assert.match(source, /TERRAIN_MIN_PLAUSIBLE_ELEVATION_M/);
});
