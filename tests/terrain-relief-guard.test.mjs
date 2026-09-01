import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildTerrainStyle,
  CASCADES_TERRAIN_CONTROL,
  terrainRiseSanity,
} from '../src/maplibre-map.js';

const manifestUrl = new URL('../public/terrain/dgm1-terrarium/manifest.json', import.meta.url);

test('terrain mesh and hillshade have independent DEM source caches', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  const style = buildTerrainStyle(manifest, { baseUrl: 'https://example.test/' });
  const terrain = style.sources['terrain-dem'];
  const hillshade = style.sources['terrain-hillshade-dem'];
  assert.equal(style.terrain.source, 'terrain-dem');
  assert.equal(style.layers.find(({ id }) => id === 'terrain-hillshade').source, 'terrain-hillshade-dem');
  assert.notEqual(terrain, hillshade);
  assert.deepEqual(terrain.tiles, hillshade.tiles);
  assert.equal(terrain.encoding, 'terrarium');
  assert.equal(hillshade.encoding, 'terrarium');
});

test('side-view cascades control rejects flat or inverted terrain', () => {
  assert.deepEqual(CASCADES_TERRAIN_CONTROL.lower, { id: 'neptunbassin', lng: 9.397959, lat: 51.315852 });
  assert.deepEqual(CASCADES_TERRAIN_CONTROL.upper, { id: 'herkules', lng: 9.3932069, lat: 51.3161018 });
  assert.equal(CASCADES_TERRAIN_CONTROL.minRiseM, 60);
  assert.equal(terrainRiseSanity(405, 510).ok, true);
  assert.equal(terrainRiseSanity(405, 450).ok, false);
  assert.equal(terrainRiseSanity(510, 405).ok, false);
  assert.equal(terrainRiseSanity(null, 510).ok, false);
});
