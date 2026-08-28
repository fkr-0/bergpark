import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildTerrainStyle,
  supplementalFeatureCollections,
  validateTerrainManifest,
} from '../src/maplibre-map.js';

const manifestUrl = new URL('../public/terrain/dgm1-terrarium/manifest.json', import.meta.url);

async function manifest() {
  return JSON.parse(await readFile(manifestUrl, 'utf8'));
}

test('MapLibre terrain style is bounded to the committed Terrarium derivative with 1x metre heights', async () => {
  const terrain = validateTerrainManifest(await manifest());
  const style = buildTerrainStyle(terrain, { baseUrl: 'https://example.test/bergpark/' });
  const dem = style.sources['terrain-dem'];

  assert.equal(style.terrain.source, 'terrain-dem');
  assert.equal(style.terrain.exaggeration, 1);
  assert.equal(dem.type, 'raster-dem');
  assert.equal(dem.encoding, 'terrarium');
  assert.equal(dem.tileSize, 256);
  assert.equal(dem.minzoom, 14);
  assert.equal(dem.maxzoom, 16);
  assert.deepEqual(dem.bounds, [9.385, 51.307, 9.425, 51.323]);
  assert.deepEqual(dem.tiles, ['https://example.test/bergpark/terrain/dgm1-terrarium/{z}/{x}/{y}.png']);
  assert.match(dem.attribution, /HVBG/);
  assert.match(dem.attribution, /dl-zero-de\/2\.0/);
});

test('renderer manifest rejects unbounded zoom, exaggerated units, inverted bounds and provenance drift', async () => {
  const terrain = await manifest();
  for (const mutation of [
    (value) => { value.zooms = [0, 16]; },
    (value) => { value.terrain_exaggeration = 2; },
    (value) => { value.renderer_bounds_wgs84 = [9.425, 51.307, 9.385, 51.323]; },
    (value) => { value.provenance.phase3_artifact.sha256 = '0'.repeat(64); },
  ]) {
    const copy = structuredClone(terrain);
    mutation(copy);
    assert.throws(() => validateTerrainManifest(copy));
  }
});

test('supplemental tree and visitor feature visibility remains controller-input driven', () => {
  const world = {
    trees: [
      { id: 'tree-a', kind: 'tree', position: { lng: 9.4, lat: 51.31 } },
      { id: 'tree-b', kind: 'tree', position: { lng: 9.41, lat: 51.32 } },
    ],
    visitorFeatures: [
      { id: 'bench-a', kind: 'visitor-feature', position: { lng: 9.405, lat: 51.315 }, presentation: { category: 'bench' } },
      { id: 'view-a', kind: 'visitor-feature', position: { lng: 9.406, lat: 51.316 }, presentation: { category: 'viewpoint' } },
    ],
  };
  const hidden = supplementalFeatureCollections(world);
  assert.equal(hidden.trees.features.length, 0);
  assert.equal(hidden.visitors.features.length, 0);

  const active = supplementalFeatureCollections(world, {
    treeVisible: true,
    treeFilterIds: ['tree-b'],
    visitorKinds: new Set(['bench']),
  });
  assert.deepEqual(active.trees.features.map(({ properties }) => properties.id), ['tree-b']);
  assert.deepEqual(active.visitors.features.map(({ properties }) => properties.id), ['bench-a']);
  assert.deepEqual(active.trees.features[0].geometry.coordinates, [9.41, 51.32]);
});

test('MapLibre Phase-4 adapter does not import Three or mutate graph/knowledge modules', async () => {
  const source = await readFile(new URL('../src/maplibre-map.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from ['"]three['"]/);
  assert.doesNotMatch(source, /model-viewer/);
  assert.doesNotMatch(source, /graph\.json|figures\.json|semantic\.json/);
  assert.match(source, /marker\.remove\(\)/);
  assert.match(source, /map\.remove\(\)/);
});
