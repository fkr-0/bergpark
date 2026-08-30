import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createMapLibreHeritageSharedDepthLayer } from '../src/maplibre-heritage-layer.js';
import {
  normalizeSpatial3dRuntimeInputs,
  resolveSpatial3dRuntimePolicy,
} from '../src/spatial3d/runtime-policy.js';

function descriptor(entityId = 'aquaedukt') {
  return Object.freeze({
    entityId,
    lod: Object.freeze({ fullWithinM: 100, cueWithinM: 200, hideBeyondM: 300 }),
  });
}

function familyWorld() {
  const places = [
    ['aquaedukt', 9.408494, 51.3165378],
    ['herkules', 9.3932069, 51.3161018],
    ['schloss', 9.4159308, 51.3149835],
    ['loewenburg', 9.4087631, 51.3114009],
    ['grosse-fontaene', 9.4117938, 51.3151826],
  ].map(([id, lng, lat]) => Object.freeze({
    id,
    kind: 'place',
    position: Object.freeze({ lng, lat }),
    deepLink: Object.freeze({ kind: 'place', id }),
  }));
  return Object.freeze({
    places: Object.freeze(places),
    placesById: new Map(places.map((place) => [place.id, place])),
  });
}

function fakeMap(elevation = 330) {
  const listeners = new Map();
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
    queryTerrainElevation() {
      return elevation;
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
  assert.fail('spatial3d runtime fixture did not settle');
}

test('runtime policy resolves bounded full/cue/hidden thresholds with a hard interaction cap', () => {
  const subject = descriptor();
  assert.equal(resolveSpatial3dRuntimePolicy(subject, {
    viewByEntityId: { aquaedukt: { distanceM: 80 } },
  }).mode, 'full');
  assert.equal(resolveSpatial3dRuntimePolicy(subject, {
    viewByEntityId: { aquaedukt: { distanceM: 160 } },
  }).mode, 'cue');
  assert.equal(resolveSpatial3dRuntimePolicy(subject, {
    viewByEntityId: { aquaedukt: { distanceM: 240 } },
  }).mode, 'hidden');
  assert.equal(resolveSpatial3dRuntimePolicy(subject, {
    selectedEntityId: 'aquaedukt',
    viewByEntityId: { aquaedukt: { distanceM: 240 } },
  }).mode, 'cue');
  assert.equal(resolveSpatial3dRuntimePolicy(subject, {
    focusedEntityId: 'aquaedukt',
    viewByEntityId: { aquaedukt: { distanceM: 301 } },
  }).mode, 'hidden');
  assert.equal(resolveSpatial3dRuntimePolicy(subject, {
    focusedEntityId: 'aquaedukt',
    viewByEntityId: { aquaedukt: { distanceM: 50, inView: false } },
  }).reason, 'outside-view');
});

test('selected/focused semantics are canonical-ID-only and power hints only downgrade presentation', () => {
  const subject = descriptor();
  const both = resolveSpatial3dRuntimePolicy(subject, {
    selectedEntityId: 'aquaedukt',
    focusedEntityId: 'aquaedukt',
    viewByEntityId: { aquaedukt: { distanceM: 50 } },
  });
  assert.equal(both.highlight, 'selected-focused');
  assert.equal(both.selected, true);
  assert.equal(both.focused, true);
  assert.ok(both.scale > 1);

  const unrelated = resolveSpatial3dRuntimePolicy(subject, {
    selectedEntityId: 'other-id',
    focusedEntityId: 'other-id',
    viewByEntityId: { aquaedukt: { distanceM: 50 } },
  });
  assert.equal(unrelated.highlight, 'none');
  assert.equal(unrelated.scale, 1);

  const reduced = resolveSpatial3dRuntimePolicy(subject, {
    reducedMotion: true,
    viewByEntityId: { aquaedukt: { distanceM: 50 } },
  });
  const power = resolveSpatial3dRuntimePolicy(subject, {
    lowPower: true,
    viewByEntityId: { aquaedukt: { distanceM: 50 } },
  });
  assert.equal(reduced.mode, 'cue');
  assert.equal(power.mode, 'cue');
});

test('runtime input normalization and policy resolution never mutate canonical descriptor/input state', () => {
  const subject = descriptor();
  const mutableInputs = {
    selectedEntityId: 'aquaedukt',
    viewByEntityId: { aquaedukt: { distanceM: 120, inView: true } },
  };
  const beforeDescriptor = JSON.stringify(subject);
  const beforeInputs = JSON.stringify(mutableInputs);
  const normalized = normalizeSpatial3dRuntimeInputs(mutableInputs);
  const decision = resolveSpatial3dRuntimePolicy(subject, normalized);

  mutableInputs.viewByEntityId.aquaedukt.distanceM = 9999;
  assert.equal(JSON.stringify(subject), beforeDescriptor);
  assert.equal(beforeInputs, '{"selectedEntityId":"aquaedukt","viewByEntityId":{"aquaedukt":{"distanceM":120,"inView":true}}}');
  assert.equal(normalized.viewByEntityId.aquaedukt.distanceM, 120);
  assert.equal(decision.distanceM, 120);
  assert.equal(Object.isFrozen(decision), true);
  assert.equal(Object.isFrozen(decision.lod), true);
});

test('waiting-terrain interaction metadata updates stay repaint-silent', async () => {
  const states = [];
  const map = fakeMap();
  map.queryTerrainElevation = () => {
    throw new Error('terrain not ready');
  };
  let loadCount = 0;
  const world = familyWorld();
  const layer = createMapLibreHeritageSharedDepthLayer({
    node: { id: 'aquaedukt' },
    world,
    onStateChange: (event) => states.push(event),
    threeLoader: async () => THREE,
    modelLoader: async () => {
      loadCount += 1;
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

  layer.onAdd(map, { owner: 'maplibre-webgl2' });
  await settleUntil(() => states.some(({ state }) => state === 'waiting-terrain'));
  assert.equal(loadCount, 1);
  assert.equal(layer.debugState().hasPlacement, false);
  assert.equal(layer.debugState().visibleObjectCount, 0);
  const before = map.repaintCount;

  assert.equal(layer.setRuntimePolicyInputs({
    selectedEntityId: 'aquaedukt',
    focusedEntityId: 'aquaedukt',
  }), false);
  assert.equal(map.repaintCount, before);
  assert.equal(loadCount, 1, 'waiting-terrain interaction changes never reload the model');
  const aquaedukt = layer.debugState().objects.find(({ entityId }) => entityId === 'aquaedukt');
  assert.equal(aquaedukt.runtime.highlight, 'selected-focused');
  layer.dispose();
});

test('shared-depth family applies culling/highlight demand-driven without interaction asset reloads', async () => {
  const states = [];
  const loadedIds = [];
  const disposedIds = [];
  const map = fakeMap();
  const world = familyWorld();
  const nodes = world.places.map(({ id }) => ({ id }));
  const layer = createMapLibreHeritageSharedDepthLayer({
    node: { id: 'aquaedukt' },
    nodes,
    world,
    onStateChange: (event) => states.push(event),
    threeLoader: async () => THREE,
    objectLoader: async (_three, spatialDescriptor) => {
      loadedIds.push(spatialDescriptor.entityId);
      if (spatialDescriptor.entityId === 'loewenburg') throw new Error('isolated fixture failure');
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      const material = new THREE.MeshBasicMaterial();
      geometry.addEventListener('dispose', () => disposedIds.push(`geometry:${spatialDescriptor.entityId}`));
      material.addEventListener('dispose', () => disposedIds.push(`material:${spatialDescriptor.entityId}`));
      const object = new THREE.Group();
      object.add(new THREE.Mesh(geometry, material));
      return {
        object,
        source: spatialDescriptor.representation,
        triangles: 12,
        bytes: spatialDescriptor.representation === 'gltf' ? 3111 : 0,
        provenance: spatialDescriptor.provenance,
      };
    },
    rendererFactory: () => ({
      autoClear: true,
      resetState() {},
      render() {},
      dispose() {},
    }),
  });

  layer.onAdd(map, { owner: 'maplibre-webgl2' });
  await settleUntil(() => states.some(({ state }) => state === 'ready'));
  assert.equal(loadedIds.length, 5);
  assert.equal(layer.debugState().failureCount, 1);
  const initialRepaints = map.repaintCount;
  assert.equal(layer.setRuntimePolicyInputs({ selectedEntityId: 'loewenburg' }), false);
  assert.equal(map.repaintCount, initialRepaints, 'failed/no-object policy changes are repaint-silent');

  const distant = Object.fromEntries(nodes.map(({ id }) => [id, { distanceM: 10_000, inView: true }]));
  assert.equal(layer.setRuntimePolicyInputs({ viewByEntityId: distant }), true);
  assert.equal(map.repaintCount, initialRepaints + 1, 'one effective family transition requests one repaint');
  assert.equal(layer.debugState().visibleObjectCount, 0);
  assert.equal(layer.setRuntimePolicyInputs({ viewByEntityId: distant }), false);
  assert.equal(map.repaintCount, initialRepaints + 1, 'equivalent repeated policy input stays repaint-silent');
  assert.equal(layer.setRuntimePolicyInputs({
    selectedEntityId: 'aquaedukt',
    focusedEntityId: 'aquaedukt',
    viewByEntityId: distant,
  }), false);
  assert.equal(map.repaintCount, initialRepaints + 1, 'hidden interaction metadata stays repaint-silent');
  assert.equal(loadedIds.length, 5, 'hidden interaction changes never reload healthy assets');

  const selectedInputs = {
    selectedEntityId: 'aquaedukt',
    focusedEntityId: 'aquaedukt',
    viewByEntityId: {
      ...distant,
      aquaedukt: { distanceM: 1200, inView: true },
    },
  };
  assert.equal(layer.setRuntimePolicyInputs(selectedInputs), true);
  assert.equal(loadedIds.length, 5, 'selection/focus must not reload already healthy assets');
  const aquaedukt = layer.debugState().objects.find(({ entityId }) => entityId === 'aquaedukt');
  assert.equal(aquaedukt.runtime.mode, 'cue');
  assert.equal(aquaedukt.runtime.highlight, 'selected-focused');
  assert.equal(layer.debugState().visibleObjectCount, 1);

  layer.dispose();
  assert.equal(disposedIds.length, 8, 'all four healthy geometry/material pairs dispose exactly once');
  assert.equal(layer.debugState().disposed, true);
});
