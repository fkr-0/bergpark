import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createMapLibreHeritageSharedDepthLayer } from '../src/maplibre-heritage-layer.js';
import {
  deriveSpatial3dHostView,
  SPATIAL3D_MAX_SURFACE_DISTANCE_M,
  spatial3dSurfaceDistanceM,
} from '../src/spatial3d/host-view.js';

const AQUAEDUKT = Object.freeze({
  entityId: 'aquaedukt',
  position: Object.freeze({ lng: 9.408494, lat: 51.3165378 }),
});

function worldAt(lng = AQUAEDUKT.position.lng, lat = AQUAEDUKT.position.lat) {
  const place = Object.freeze({
    id: 'aquaedukt',
    kind: 'place',
    position: Object.freeze({ lng, lat }),
    deepLink: Object.freeze({ kind: 'place', id: 'aquaedukt' }),
  });
  return Object.freeze({
    places: Object.freeze([place]),
    placesById: new Map([[place.id, place]]),
  });
}

function hostMap({
  center = AQUAEDUKT.position,
  bounds = { west: 9.3, east: 9.5, south: 51.2, north: 51.4 },
  elevation = 330,
} = {}) {
  const listeners = new Map();
  let currentCenter = { ...center };
  let currentBounds = { ...bounds };
  let terrainElevation = elevation;
  return {
    repaintCount: 0,
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
    getCenter() {
      return { ...currentCenter };
    },
    getBounds() {
      return {
        getWest: () => currentBounds.west,
        getEast: () => currentBounds.east,
        getSouth: () => currentBounds.south,
        getNorth: () => currentBounds.north,
      };
    },
    setView(nextCenter, nextBounds = currentBounds) {
      currentCenter = { ...nextCenter };
      currentBounds = { ...nextBounds };
    },
    setTerrainElevation(nextElevation) {
      terrainElevation = nextElevation;
    },
    queryTerrainElevation() {
      if (terrainElevation instanceof Error) throw terrainElevation;
      return terrainElevation;
    },
    triggerRepaint() {
      this.repaintCount += 1;
    },
    getCanvas() {
      return { owner: 'maplibre' };
    },
  };
}

async function settleUntil(predicate, attempts = 20) {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('host-view fixture did not settle');
}

function layerFixture(map, { failLoad = false } = {}) {
  const states = [];
  let loadCount = 0;
  const layer = createMapLibreHeritageSharedDepthLayer({
    node: { id: 'aquaedukt' },
    world: worldAt(),
    onStateChange: (event) => states.push(event),
    threeLoader: async () => THREE,
    modelLoader: async () => {
      loadCount += 1;
      if (failLoad) throw new Error('fixture model unavailable');
      const object = new THREE.Group();
      object.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
      return { object, source: 'gltf', triangles: 12, bytes: 3111 };
    },
    rendererFactory: () => ({
      autoClear: true,
      resetState() {},
      render() {},
      dispose() {},
    }),
  });
  return { layer, states, loadCount: () => loadCount, map };
}

test('host-view distance is bounded, antimeridian-safe and canonical-input immutable', () => {
  assert.equal(spatial3dSurfaceDistanceM({ lng: 0, lat: 0 }, { lng: 0, lat: 0 }), 0);
  const antimeridian = spatial3dSurfaceDistanceM({ lng: 179.9, lat: 0 }, { lng: -179.9, lat: 0 });
  assert.ok(antimeridian > 22_000 && antimeridian < 22_300);
  assert.ok(spatial3dSurfaceDistanceM({ lng: 0, lat: 90 }, { lng: 180, lat: -90 })
    <= SPATIAL3D_MAX_SURFACE_DISTANCE_M);
  assert.equal(spatial3dSurfaceDistanceM({ lng: 0, lat: 91 }, { lng: 0, lat: 0 }), null);

  const descriptor = Object.freeze({
    entityId: 'edge',
    position: Object.freeze({ lng: 179.5, lat: 10 }),
  });
  const before = JSON.stringify(descriptor);
  const map = hostMap({
    center: { lng: -179.7, lat: 10 },
    bounds: { west: 170, east: -170, south: 0, north: 20 },
  });
  const view = deriveSpatial3dHostView(map, [descriptor]);
  assert.equal(view.edge.inView, true);
  assert.ok(view.edge.distanceM > 80_000 && view.edge.distanceM < 90_000);
  assert.equal(JSON.stringify(descriptor), before);
  assert.equal(Object.isFrozen(view), true);
  assert.equal(Object.isFrozen(view.edge), true);
});

test('host-view map-state failures fail open without hiding renderer content', () => {
  const throwingMap = {
    getCenter() {
      throw new Error('center unavailable');
    },
    getBounds() {
      throw new Error('bounds unavailable');
    },
  };
  assert.deepEqual({ ...deriveSpatial3dHostView(throwingMap, [AQUAEDUKT]).aquaedukt }, {
    distanceM: null,
    inView: true,
  });

  const outside = deriveSpatial3dHostView(hostMap({
    center: AQUAEDUKT.position,
    bounds: { west: 9.0, east: 9.1, south: 51.0, north: 51.1 },
  }), [AQUAEDUKT]);
  assert.equal(outside.aquaedukt.inView, false);

  const projectedOutside = deriveSpatial3dHostView({
    getCenter: () => AQUAEDUKT.position,
    getBounds: () => ({
      getWest: () => 9.3,
      getEast: () => 9.5,
      getSouth: () => 51.2,
      getNorth: () => 51.4,
    }),
    getCanvas: () => ({ clientWidth: 800, clientHeight: 600 }),
    project: () => ({ x: 900, y: 300 }),
  }, [AQUAEDUKT]);
  assert.equal(projectedOutside.aquaedukt.inView, false, 'host screen projection refines coarse bounds');
});

test('idle host-view refresh is idempotent, crosses thresholds once and never reloads healthy assets', async () => {
  const map = hostMap();
  const fixture = layerFixture(map);
  fixture.layer.onAdd(map, { owner: 'maplibre-webgl2' });
  await settleUntil(() => fixture.states.some(({ state }) => state === 'ready'));
  assert.equal(fixture.loadCount(), 1);
  assert.equal(fixture.layer.debugState().objects[0].runtime.mode, 'full');
  const initialRepaints = map.repaintCount;

  map.emit('idle');
  assert.equal(map.repaintCount, initialRepaints, 'equivalent host view stays repaint-silent');

  map.setView({ lng: AQUAEDUKT.position.lng, lat: AQUAEDUKT.position.lat + 0.01 });
  map.emit('idle');
  assert.equal(fixture.layer.debugState().objects[0].runtime.mode, 'cue');
  assert.equal(map.repaintCount, initialRepaints + 1, 'one threshold crossing requests one repaint');

  map.emit('idle');
  assert.equal(map.repaintCount, initialRepaints + 1, 'repeated equivalent cue view remains silent');

  map.setView({ lng: AQUAEDUKT.position.lng, lat: AQUAEDUKT.position.lat + 0.03 });
  map.emit('idle');
  assert.equal(fixture.layer.debugState().objects[0].runtime.mode, 'hidden');
  assert.equal(map.repaintCount, initialRepaints + 2);
  assert.equal(fixture.loadCount(), 1, 'pan/zoom-equivalent view changes never reload the model');
  fixture.layer.dispose();
});

test('selection/focus hints merge with latest automatic view without becoming selection authority', async () => {
  const map = hostMap();
  const fixture = layerFixture(map);
  fixture.layer.onAdd(map, { owner: 'maplibre-webgl2' });
  await settleUntil(() => fixture.states.some(({ state }) => state === 'ready'));

  map.setView({ lng: AQUAEDUKT.position.lng, lat: AQUAEDUKT.position.lat + 0.018 });
  map.emit('idle');
  const hiddenRepaints = map.repaintCount;
  assert.equal(fixture.layer.debugState().objects[0].runtime.mode, 'hidden');

  assert.equal(fixture.layer.setRuntimePolicyInputs({ selectedEntityId: 'aquaedukt' }), true);
  let runtime = fixture.layer.debugState().objects[0].runtime;
  assert.equal(runtime.mode, 'cue');
  assert.equal(runtime.highlight, 'selected');
  assert.equal(map.repaintCount, hiddenRepaints + 1);

  assert.equal(fixture.layer.setRuntimePolicyInputs({
    selectedEntityId: 'aquaedukt',
    focusedEntityId: 'aquaedukt',
  }), true);
  runtime = fixture.layer.debugState().objects[0].runtime;
  assert.equal(runtime.highlight, 'selected-focused');
  assert.equal(fixture.loadCount(), 1);

  const beforeEquivalentIdle = map.repaintCount;
  map.emit('idle');
  runtime = fixture.layer.debugState().objects[0].runtime;
  assert.equal(runtime.highlight, 'selected-focused', 'automatic view refresh preserves external ID hints');
  assert.equal(map.repaintCount, beforeEquivalentIdle);
  assert.equal(fixture.loadCount(), 1);
  fixture.layer.dispose();
});

test('waiting-terrain and hard-hidden automatic refreshes stay repaint-silent when presentation cannot change', async () => {
  const waitingMap = hostMap({ elevation: new Error('terrain not ready') });
  const waiting = layerFixture(waitingMap);
  waiting.layer.onAdd(waitingMap, { owner: 'maplibre-webgl2' });
  await settleUntil(() => waiting.states.some(({ state }) => state === 'waiting-terrain'));
  const waitingRepaints = waitingMap.repaintCount;
  waitingMap.setView({ lng: AQUAEDUKT.position.lng, lat: AQUAEDUKT.position.lat + 0.03 });
  waitingMap.emit('idle');
  waiting.layer.setRuntimePolicyInputs({ selectedEntityId: 'aquaedukt', focusedEntityId: 'aquaedukt' });
  assert.equal(waitingMap.repaintCount, waitingRepaints);
  assert.equal(waiting.loadCount(), 1);
  assert.equal(waiting.layer.debugState().hasPlacement, false);
  waiting.layer.dispose();

  const hiddenMap = hostMap({
    center: { lng: AQUAEDUKT.position.lng, lat: AQUAEDUKT.position.lat + 0.03 },
  });
  const hidden = layerFixture(hiddenMap);
  hidden.layer.onAdd(hiddenMap, { owner: 'maplibre-webgl2' });
  await settleUntil(() => hidden.states.some(({ state }) => state === 'ready'));
  assert.equal(hidden.layer.debugState().objects[0].runtime.mode, 'hidden');
  const hiddenRepaints = hiddenMap.repaintCount;
  assert.equal(hidden.layer.setRuntimePolicyInputs({
    selectedEntityId: 'aquaedukt',
    focusedEntityId: 'aquaedukt',
  }), false);
  assert.equal(hiddenMap.repaintCount, hiddenRepaints);
  assert.equal(hidden.loadCount(), 1);
  hidden.layer.dispose();
});

test('failed/no-object host refresh is silent and host listeners remain bounded through disposal', async () => {
  const map = hostMap();
  const fixture = layerFixture(map, { failLoad: true });
  fixture.layer.onAdd(map, { owner: 'maplibre-webgl2' });
  await settleUntil(() => fixture.states.at(-1)?.state === 'unavailable');
  assert.equal(map.listenerCount('idle'), 1);
  assert.equal(map.listenerCount('webglcontextlost'), 1);
  assert.equal(map.listenerCount('webglcontextrestored'), 1);
  const before = map.repaintCount;
  map.setView({ lng: AQUAEDUKT.position.lng, lat: AQUAEDUKT.position.lat + 0.03 });
  map.emit('idle');
  fixture.layer.setRuntimePolicyInputs({ selectedEntityId: 'aquaedukt' });
  assert.equal(map.repaintCount, before);
  assert.equal(fixture.loadCount(), 1);

  fixture.layer.onAdd(map, { owner: 'maplibre-webgl2' });
  assert.equal(map.listenerCount('idle'), 1, 'reattach replaces rather than multiplies the idle listener');
  assert.equal(map.listenerCount('webglcontextlost'), 1);
  assert.equal(map.listenerCount('webglcontextrestored'), 1);
  fixture.layer.dispose();
  assert.equal(map.listenerCount('idle'), 0);
  assert.equal(map.listenerCount('webglcontextlost'), 0);
  assert.equal(map.listenerCount('webglcontextrestored'), 0);
});
