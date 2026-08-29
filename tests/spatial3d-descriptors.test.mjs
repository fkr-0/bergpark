import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSpatial3dDescriptor,
  createSpatial3dFamily,
  spatial3dCuratedIds,
  SPATIAL3D_DESCRIPTOR_VERSION,
} from '../src/spatial3d/descriptors.js';

function fixture(id, lng, lat, elevationM = null) {
  const position = { lng, lat };
  if (elevationM != null) position.elevationM = elevationM;
  return Object.freeze({
    id,
    kind: 'place',
    position: Object.freeze(position),
    deepLink: Object.freeze({ kind: 'place', id }),
  });
}

function worldFor(records) {
  return Object.freeze({
    places: Object.freeze(records),
    placesById: new Map(records.map((record) => [record.id, record])),
  });
}

test('curated spatial3d family stays bounded and keyed by canonical entity IDs', () => {
  assert.deepEqual(spatial3dCuratedIds(), [
    'aquaedukt',
    'herkules',
    'schloss',
    'loewenburg',
    'grosse-fontaene',
  ]);

  const records = [
    fixture('aquaedukt', 9.408494, 51.3165378, 352),
    fixture('herkules', 9.3932069, 51.3161018, 530),
    fixture('schloss', 9.4159308, 51.3149835, 286),
    fixture('loewenburg', 9.4087631, 51.3114009, 361),
    fixture('grosse-fontaene', 9.4117938, 51.3151826, 311),
    fixture('unrelated-tree', 9.4, 51.3, 300),
  ];
  const nodes = records.map(({ id }) => ({ id }));
  const family = createSpatial3dFamily(nodes, worldFor(records));

  assert.equal(family.length, 5);
  assert.deepEqual(family.map(({ entityId }) => entityId), [
    'aquaedukt',
    'herkules',
    'schloss',
    'loewenburg',
    'grosse-fontaene',
  ]);
  assert.ok(family.every(({ version }) => version === SPATIAL3D_DESCRIPTOR_VERSION));
});

test('Aquaedukt descriptor reuses the existing bounded glTF presentation and canonical position', () => {
  const canonical = fixture('aquaedukt', 9.408494, 51.3165378, 352);
  const descriptor = createSpatial3dDescriptor({ id: 'aquaedukt' }, worldFor([canonical]));

  assert.equal(descriptor.entityId, canonical.id);
  assert.equal(descriptor.representation, 'gltf');
  assert.equal(descriptor.assetId, 'aqueduct-gltf-v1');
  assert.equal(descriptor.modelUrl, './models/aquaedukt-schematic.gltf');
  assert.equal(descriptor.metresPerModelUnit, 1);
  assert.deepEqual(descriptor.position, canonical.position);
  assert.notEqual(descriptor.position, canonical.position, 'descriptor owns an immutable snapshot, not the domain object');
  assert.equal(descriptor.provenance.representationAccuracy, 'schematic-not-surveyed-reconstruction');
});

test('non-glTF family members are explicit abstract cues, never unsourced monument reconstructions', () => {
  const canonical = fixture('herkules', 9.3932069, 51.3161018, 530);
  const descriptor = createSpatial3dDescriptor({ id: 'herkules' }, worldFor([canonical]));

  assert.equal(descriptor.representation, 'procedural-cue');
  assert.equal(descriptor.cueKind, 'heritage');
  assert.equal(descriptor.provenance.kind, 'deterministic-spatial-cue');
  assert.equal(descriptor.provenance.representationAccuracy, 'abstract-location-cue-not-monument-reconstruction');
  assert.equal('object3d' in descriptor, false);
  assert.equal('renderer' in descriptor, false);
});

test('descriptor creation fails closed when canonical identity/position is absent', () => {
  const world = worldFor([]);
  assert.equal(createSpatial3dDescriptor({ id: 'herkules' }, world), null);
  assert.equal(createSpatial3dDescriptor({ id: 'not-curated' }, world), null);
});
