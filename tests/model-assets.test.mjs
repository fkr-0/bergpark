import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countModelTriangles,
  disposeModelObject,
  modelAssetBudgets,
  resolveSameOriginModelUrl,
} from '../src/model-assets.js';

test('shared model policy preserves the existing 5 MiB and 180k triangle ceilings', () => {
  assert.deepEqual(modelAssetBudgets, {
    maxBytes: 5 * 1024 * 1024,
    maxTriangles: 180_000,
  });
});

test('shared model policy rejects top-level network escape before loading', () => {
  const baseUrl = 'https://bergpark.example/guide/';
  assert.equal(
    resolveSameOriginModelUrl('./models/aquaedukt-schematic.gltf', { baseUrl }).href,
    'https://bergpark.example/guide/models/aquaedukt-schematic.gltf',
  );
  assert.throws(
    () => resolveSameOriginModelUrl('https://example.invalid/model.gltf', { baseUrl }),
    /served from the Bergpark origin/,
  );
});

test('triangle accounting and disposal cover geometries, materials and textures once', () => {
  let geometryDisposed = 0;
  let materialDisposed = 0;
  let textureDisposed = 0;
  const geometry = { index: { count: 36 }, dispose: () => { geometryDisposed += 1; } };
  const texture = { isTexture: true, dispose: () => { textureDisposed += 1; } };
  const material = { map: texture, dispose: () => { materialDisposed += 1; } };
  const object = {
    traverse(callback) {
      callback({ geometry, material });
      callback({ geometry: null, material });
    },
  };

  assert.equal(countModelTriangles(object), 12);
  disposeModelObject(object);
  assert.equal(geometryDisposed, 1);
  assert.equal(materialDisposed, 1);
  assert.equal(textureDisposed, 1);
});
