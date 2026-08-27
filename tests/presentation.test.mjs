import test from 'node:test';
import assert from 'node:assert/strict';
import { hasInteractiveModel, markerPresentationClass, presentationRegistrySnapshot, resolveNodePresentation, structureGlyph } from '../src/presentation.js';
import { modelViewerBudgets, supportsInteractive3d } from '../src/model-viewer.js';

test('ordinary nodes retain the lightweight pin renderer', () => {
  const presentation = resolveNodePresentation({ id: 'ordinary-place' });
  assert.equal(presentation.map.kind, 'pin');
  assert.equal(presentation.detail.kind, 'standard');
  assert.equal(markerPresentationClass({ id: 'ordinary-place' }), 'bergpark-marker-presentation--pin');
});

test('selected landmark nodes can opt into structure markers without changing graph data', () => {
  const presentation = resolveNodePresentation({ id: 'herkules' });
  assert.equal(presentation.map.kind, 'structure');
  assert.equal(presentation.map.structure, 'hercules');
  assert.equal(presentation.detail.kind, 'model');
  assert.equal(presentation.detail.assetId, 'hercules');
  assert.equal(hasInteractiveModel({ id: 'herkules' }), true);
  assert.equal(structureGlyph(presentation.map.structure), '⚑');
});

test('runtime presentation metadata can override the UI registry and clamps scale', () => {
  const presentation = resolveNodePresentation({
    id: 'herkules',
    presentation: {
      map: { kind: 'model', modelUrl: './models/hercules.glb', scale: 99 },
      detail: { kind: 'model', modelUrl: './models/hercules.glb' },
    },
  });
  assert.equal(presentation.map.kind, 'model');
  assert.equal(presentation.map.modelUrl, './models/hercules.glb');
  assert.equal(presentation.map.scale, 1.6);
  assert.equal(presentation.detail.kind, 'model');
});

test('all initial rich landmarks expose actual interactive model assets', () => {
  const expected = new Map([
    ['herkules', 'hercules'],
    ['schloss', 'wilhelmshoehe-palace'],
    ['loewenburg', 'loewenburg'],
    ['grosse-fontaene', 'great-fountain'],
    ['aquaedukt', 'aqueduct-gltf-v1'],
  ]);
  for (const [id, assetId] of expected) {
    const presentation = resolveNodePresentation({ id });
    assert.equal(presentation.detail.kind, 'model');
    assert.equal(presentation.detail.assetId, assetId);
    assert.equal(hasInteractiveModel({ id }), true);
  }
  assert.equal(resolveNodePresentation({ id: 'aquaedukt' }).detail.modelUrl, './models/aquaedukt-schematic.gltf');
  assert.equal(structureGlyph('aqueduct'), '∩');
  assert.equal(hasInteractiveModel({ id: 'ordinary-place' }), false);
});

test('3D runtime has bounded external-asset budgets and fails closed without a browser', () => {
  assert.equal(modelViewerBudgets.maxBytes, 5 * 1024 * 1024);
  assert.equal(modelViewerBudgets.maxTriangles, 180_000);
  assert.equal(supportsInteractive3d(), false);
});

test('presentation registry remains an isolated browser concern', () => {
  const snapshot = presentationRegistrySnapshot();
  assert.equal(snapshot.herkules.map.structure, 'hercules');
  snapshot.herkules.map.structure = 'mutated';
  assert.equal(presentationRegistrySnapshot().herkules.map.structure, 'hercules');
});
