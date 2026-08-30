import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { disposeModelObject, modelAssetBudgets } from '../src/model-assets.js';
import { createProceduralSpatialCue, loadSpatial3dObject } from '../src/spatial3d/procedural-models.js';

const PROCEDURAL_PROVENANCE = Object.freeze({
  kind: 'deterministic-spatial-cue',
  representationAccuracy: 'abstract-location-cue-not-monument-reconstruction',
});

test('procedural cue resolution stays deterministic, bounded and provenance-explicit', () => {
  const descriptor = Object.freeze({
    entityId: 'herkules',
    representation: 'procedural-cue',
    cueKind: 'heritage',
    provenance: PROCEDURAL_PROVENANCE,
  });
  const resolved = createProceduralSpatialCue(THREE, descriptor);

  assert.equal(resolved.object.name, 'spatial-cue:herkules');
  assert.equal(resolved.source, 'procedural-cue');
  assert.equal(resolved.bytes, 0);
  assert.ok(resolved.triangles > 0);
  assert.ok(resolved.triangles < modelAssetBudgets.maxTriangles);
  assert.equal(resolved.provenance, PROCEDURAL_PROVENANCE);
  disposeModelObject(resolved.object);
});

test('glTF descriptor resolution delegates to the shared hard-budget loader without weakening its policy', async () => {
  const descriptor = Object.freeze({
    entityId: 'aquaedukt',
    representation: 'gltf',
    modelUrl: './models/aquaedukt-schematic.gltf',
    provenance: Object.freeze({ kind: 'existing-bounded-asset' }),
  });
  const controller = new AbortController();
  const calls = [];
  const object = new THREE.Group();
  const result = await loadSpatial3dObject(THREE, descriptor, {
    signal: controller.signal,
    modelLoader: async (three, modelUrl, options) => {
      calls.push({ three, modelUrl, signal: options.signal });
      return { object, source: 'gltf', bytes: 3111, triangles: 12 };
    },
  });

  assert.equal(modelAssetBudgets.maxBytes, 5 * 1024 * 1024);
  assert.equal(modelAssetBudgets.maxTriangles, 180_000);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].three, THREE);
  assert.equal(calls[0].modelUrl, descriptor.modelUrl);
  assert.equal(calls[0].signal, controller.signal);
  assert.equal(result.object, object);
  assert.equal(result.provenance, descriptor.provenance);
});

test('descriptor resolution fails closed for aborts and unsupported representations', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    loadSpatial3dObject(THREE, { representation: 'procedural-cue', cueKind: 'heritage' }, { signal: controller.signal }),
    { name: 'AbortError' },
  );
  await assert.rejects(
    loadSpatial3dObject(THREE, { representation: 'remote-mesh' }),
    /Unsupported spatial3d representation/,
  );
});
