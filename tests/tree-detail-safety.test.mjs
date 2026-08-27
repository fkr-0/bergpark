import assert from 'node:assert/strict';
import test from 'node:test';
import { firstPublicHttpUrl, publicHttpUrl, treeDetailModel } from '../src/tree-detail.js';

test('tree detail model preserves sourced fields without inventing missing measurements', () => {
  const complete = treeDetailModel({
    id: 'tree-358',
    catalog_ref: '358',
    species: { de: 'Riesenmammutbaum', en: 'Giant sequoia', scientific: 'Sequoiadendron giganteum' },
    location_description: 'am Südtor der Löwenburg',
    description: 'Katalogtext',
    elevation_m: 361,
    height_m: null,
    height_status: 'unknown_no_measurement_source',
    position_source: {
      provider: 'OpenStreetMap',
      element: 'node/5702751554',
      accuracy_status: 'not_reported_by_source',
    },
    elevation_source: {
      provider: 'Open-Meteo Elevation API',
      dataset: 'Copernicus DEM 2021 GLO-90',
      resolution_m: 90,
    },
  }, 'de');

  assert.equal(complete.catalogueRef, '358');
  assert.equal(complete.species, 'Riesenmammutbaum');
  assert.equal(complete.scientificName, 'Sequoiadendron giganteum');
  assert.equal(complete.elevationM, 361);
  assert.equal(complete.heightM, null);
  assert.equal(complete.heightStatus, 'unknown_no_measurement_source');
  assert.equal(complete.positionSource.accuracyStatus, 'not_reported_by_source');
  assert.equal(complete.elevationSource.resolutionM, 90);

  const partial = treeDetailModel({ id: 'tree-partial', species_de: 'Buche' }, 'de');
  assert.equal(partial.species, 'Buche');
  assert.equal(partial.catalogueRef, null);
  assert.equal(partial.location, null);
  assert.equal(partial.positionSource, null);
  assert.equal(partial.elevationSource, null);

  const missing = treeDetailModel({ id: 'tree-missing' }, 'en');
  assert.equal(missing.title, 'tree-missing');
  assert.equal(missing.catalogueRef, null);
  assert.equal(missing.heightM, null);
});

test('tree evidence links fail closed to absolute public HTTP(S) URLs', () => {
  assert.equal(publicHttpUrl('data/sources/osm-tree-nodes/chunk-00.xml'), null);
  assert.equal(publicHttpUrl('/data/sources/tree-elevation/points.json'), null);
  assert.equal(publicHttpUrl('javascript:alert(1)'), null);
  assert.equal(publicHttpUrl('https://commons.wikimedia.org/wiki/File:Tree.jpg'), 'https://commons.wikimedia.org/wiki/File:Tree.jpg');

  const source = firstPublicHttpUrl([
    'data/sources/osm-wiki-baumkataster.wiki',
    'data/sources/osm-tree-nodes/chunk-00.xml',
    'https://www.openstreetmap.org/node/5702751554',
    'data/sources/tree-elevation/points.json',
  ]);
  assert.equal(source, 'https://www.openstreetmap.org/node/5702751554');
});
