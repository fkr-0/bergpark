import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as THREE from 'three';
import {
  createMercatorModelMatrix,
  createMapLibreHeritageSharedDepthLayer,
  SHARED_DEPTH_ASSET_ID,
  SHARED_DEPTH_DISPLAY_OFFSET_M,
  SHARED_DEPTH_HERITAGE_ID,
  SHARED_DEPTH_LAYER_ID,
  SHARED_DEPTH_MODEL_METRES_PER_UNIT,
  sharedDepthHeritageSpec,
  terrainAwareHeritagePlacement,
} from '../src/maplibre-heritage-layer.js';

function worldAt(lng = 9.40849, lat = 51.31654) {
  const place = Object.freeze({
    id: SHARED_DEPTH_HERITAGE_ID,
    kind: 'place',
    position: Object.freeze({ lng, lat }),
    deepLink: Object.freeze({ kind: 'place', id: SHARED_DEPTH_HERITAGE_ID }),
  });
  return Object.freeze({
    places: Object.freeze([place]),
    placesById: new Map([[place.id, place]]),
  });
}

function fakeMap(elevation = 318.25) {
  const listeners = new Map();
  const map = {
    repaintCount: 0,
    terrainQueries: [],
    on(name, fn) {
      const values = listeners.get(name) ?? new Set();
      values.add(fn);
      listeners.set(name, values);
    },
    off(name, fn) {
      listeners.get(name)?.delete(fn);
    },
    emit(name, event = {}) {
      for (const fn of [...(listeners.get(name) ?? [])]) fn(event);
    },
    listenerCount(name) {
      return listeners.get(name)?.size ?? 0;
    },
    queryTerrainElevation(lngLat) {
      this.terrainQueries.push(lngLat);
      return elevation;
    },
    triggerRepaint() {
      this.repaintCount += 1;
    },
    getCanvas() {
      return { owner: 'maplibre' };
    },
  };
  return map;
}

async function settleUntil(predicate, attempts = 20) {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('async shared-depth layer state did not settle');
}

test('one-object contract is exact Aquaedukt identity plus existing bounded glTF presentation', () => {
  const spec = sharedDepthHeritageSpec({ id: SHARED_DEPTH_HERITAGE_ID });
  assert.equal(spec.nodeId, SHARED_DEPTH_HERITAGE_ID);
  assert.equal(spec.assetId, SHARED_DEPTH_ASSET_ID);
  assert.equal(spec.modelUrl, './models/aquaedukt-schematic.gltf');
  assert.equal(spec.displayOffsetM, SHARED_DEPTH_DISPLAY_OFFSET_M);
  assert.equal(spec.metresPerModelUnit, SHARED_DEPTH_MODEL_METRES_PER_UNIT);
  assert.equal(sharedDepthHeritageSpec({ id: 'herkules' }), null);
});

test('terrain placement reads canonical SpatialWorld coordinates without persisting renderer elevation', () => {
  const world = worldAt();
  const before = JSON.stringify(world.places[0]);
  const map = fakeMap(321.5);
  const placement = terrainAwareHeritagePlacement(world, map);

  assert.deepEqual(map.terrainQueries, [[9.40849, 51.31654]]);
  assert.equal(placement.altitudeM, 321.5 + SHARED_DEPTH_DISPLAY_OFFSET_M);
  assert.equal(placement.lng, world.placesById.get('aquaedukt').position.lng);
  assert.equal(placement.lat, world.placesById.get('aquaedukt').position.lat);
  assert.equal(JSON.stringify(world.places[0]), before);
  assert.equal('altitudeM' in world.placesById.get('aquaedukt').position, false);
});

test('model matrix keeps schematic units metre-based and model Y above terrain', () => {
  const placement = { lng: 9.40849, lat: 51.31654, altitudeM: 321.85 };
  const mercatorCoordinate = {
    fromLngLat(_lngLat, altitudeM) {
      return {
        x: 0.25,
        y: 0.5,
        z: altitudeM * 0.001,
        meterInMercatorCoordinateUnits: () => 0.001,
      };
    },
  };
  const matrix = createMercatorModelMatrix(THREE, placement, { mercatorCoordinate });
  const base = new THREE.Vector3(0, 0, 0).applyMatrix4(matrix);
  const oneMetreUp = new THREE.Vector3(0, 1, 0).applyMatrix4(matrix);

  assert.ok(Math.abs(base.z - 0.32185) < 1e-12);
  assert.ok(Math.abs(oneMetreUp.z - base.z - 0.001) < 1e-12);
  assert.ok(oneMetreUp.z > base.z, 'model Y must project above, not below, terrain');
});

test('shared custom layer uses MapLibre context/depth, repaints only on placement changes, and disposes on loss/remove', async () => {
  const states = [];
  const renderers = [];
  const disposedModels = [];
  const map = fakeMap();
  const sharedGl = { owner: 'maplibre-webgl2' };
  let loadCount = 0;

  const layer = createMapLibreHeritageSharedDepthLayer({
    node: { id: 'aquaedukt' },
    world: worldAt(),
    onStateChange: (event) => states.push(event),
    threeLoader: async () => THREE,
    modelLoader: async () => {
      loadCount += 1;
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      const material = new THREE.MeshBasicMaterial();
      geometry.addEventListener('dispose', () => disposedModels.push(`geometry-${loadCount}`));
      material.addEventListener('dispose', () => disposedModels.push(`material-${loadCount}`));
      const object = new THREE.Group();
      object.add(new THREE.Mesh(geometry, material));
      return { object, source: 'gltf', triangles: 12, bytes: 3111 };
    },
    rendererFactory: (_three, ownerMap, gl) => {
      const record = {
        canvas: ownerMap.getCanvas(),
        gl,
        renderCount: 0,
        resetCount: 0,
        disposed: false,
      };
      renderers.push(record);
      return {
        autoClear: true,
        resetState: () => { record.resetCount += 1; },
        render: () => { record.renderCount += 1; },
        dispose: () => { record.disposed = true; },
      };
    },
  });

  assert.equal(layer.id, SHARED_DEPTH_LAYER_ID);
  assert.equal(layer.type, 'custom');
  assert.equal(layer.renderingMode, '3d');
  layer.onAdd(map, sharedGl);
  await settleUntil(() => states.some(({ state }) => state === 'ready'));

  assert.equal(renderers[0].canvas.owner, 'maplibre');
  assert.equal(renderers[0].gl, sharedGl);
  assert.equal(map.repaintCount, 1);
  assert.equal(map.listenerCount('webglcontextlost'), 1);
  assert.equal(map.listenerCount('webglcontextrestored'), 1);
  assert.equal(states.at(-1).animation, 'none');
  assert.equal(states.at(-1).renderingMode, '3d');

  const projection = new THREE.Matrix4().identity().toArray();
  layer.render(sharedGl, { defaultProjectionData: { mainMatrix: projection } });
  assert.equal(renderers[0].renderCount, 1);
  assert.equal(renderers[0].resetCount, 2);
  assert.equal(states.at(-1).rendered, true);
  assert.equal(layer.debugState().hasRendered, true);
  assert.equal(map.repaintCount, 1, 'render must not create an idle repaint loop');

  layer.setWorld(worldAt(9.4085, 51.31655));
  assert.equal(map.repaintCount, 2, 'canonical placement change requests exactly one repaint');

  map.emit('webglcontextlost');
  assert.equal(states.at(-1).state, 'context-lost');
  assert.equal(renderers[0].disposed, true);
  assert.equal(layer.debugState().hasModel, false);
  assert.ok(disposedModels.length >= 2);

  map.emit('webglcontextrestored');
  await settleUntil(() => loadCount === 2 && states.at(-1).state === 'ready');
  assert.equal(renderers.length, 2);
  assert.equal(map.repaintCount, 3);

  layer.onRemove(map, sharedGl);
  assert.equal(renderers[1].disposed, true);
  assert.equal(layer.debugState().hasRenderer, false);
  assert.equal(layer.debugState().hasModel, false);
  assert.equal(map.listenerCount('webglcontextlost'), 0);
  assert.equal(map.listenerCount('webglcontextrestored'), 0);
  layer.dispose();
  assert.equal(layer.debugState().disposed, true);
});

test('shared-depth source has no independent animation/canvas/camera-navigation loop', async () => {
  const source = await readFile(new URL('../src/maplibre-heritage-layer.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /requestAnimationFrame|setAnimationLoop|OrbitControls|PerspectiveCamera/);
  assert.doesNotMatch(source, /document\.createElement\(['"]canvas/);
  assert.match(source, /context: gl/);
  assert.match(source, /renderingMode: '3d'/);
  assert.match(source, /defaultProjectionData\?\.mainMatrix/);
  assert.match(source, /renderer\.resetState/);
});
