import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  companionOfflineReadiness,
  createCompanionAlmanac,
  nearbyCompanionEntries,
  searchCompanionAlmanac,
} from '../src/companion-almanac.js';

const runtimeManifest = JSON.parse(await readFile(new URL('../public/data/runtime-manifest.json', import.meta.url), 'utf8'));

test('current runtime manifest explicitly supports warmed-offline companion text and discovery', () => {
  const readiness = companionOfflineReadiness(runtimeManifest);
  assert.equal(readiness.state, 'ready-after-warm');
  assert.equal(readiness.basis, 'runtime-manifest-precache');
  assert.ok(readiness.layers.every(({ declared, available, precache }) => declared && available && precache));
  assert.ok(readiness.layers.some(({ id }) => id === 'content-de'));
  assert.ok(readiness.layers.some(({ id }) => id === 'walking-network'));
});

test('unified companion almanac preserves canonical IDs and separates source evidence from proximity', () => {
  const place = { id: 'place-a', name: { de: 'Ort A', en: 'Place A' }, type: 'monument', lat: 51.316, lng: 9.4 };
  const story = { id: 'person-a', name: { de: 'Person A', en: 'Person A' }, type: 'historical_figure', roles: ['architect'] };
  const tree = { id: 'tree-a', name: { de: 'Baum A', en: 'Tree A' }, lat: 51.3163, lng: 9.4002, source_refs: ['tree-source'] };
  const bench = { id: 'bench-a', layerKind: 'bench', name: 'Bench A', lat: 51.3165, lng: 9.4003, source_refs: ['osm:bench-a'] };
  const walkingNetwork = {
    nodes: [
      { id: 'pathnode-a', degree: 3, position: { lat: 51.3161, lng: 9.4001 } },
      { id: 'pathnode-b', degree: 2, position: { lat: 51.3162, lng: 9.4002 } },
    ],
    segments: [{
      id: 'pathseg-a',
      fromId: 'pathnode-a',
      toId: 'pathnode-b',
      distanceM: 30,
      steps: true,
      surface: 'stone',
      highway: 'steps',
      accessibilityStatus: 'unknown',
      coordinates: [
        { lat: 51.3161, lng: 9.4001 },
        { lat: 51.3162, lng: 9.4002 },
      ],
    }],
  };
  const almanac = createCompanionAlmanac({
    entities: [place, story],
    nodeIds: new Set(['place-a']),
    trees: [tree],
    visitorFeatures: [bench],
    walkingNetwork,
    runtimeManifest,
    language: 'en',
  });

  assert.deepEqual(almanac.counts, { place: 1, story: 1, tree: 1, feature: 1, walk: 2 });
  const walk = searchCompanionAlmanac(almanac, 'steps', 'en', { category: 'walk' });
  assert.equal(walk.results[0].id, 'pathseg-a');
  assert.equal(walk.results[0].canonicalId, 'pathseg-a');
  assert.equal(walk.results[0].networkDiscovery.id, 'pathseg-a');
  assert.deepEqual(walk.results[0].networkDiscovery.position, { lat: 51.3161, lng: 9.4001 });
  assert.deepEqual(walk.results[0].runtimeEvidence.map(({ id }) => id), ['walking-network']);

  const nearby = nearbyCompanionEntries(almanac, place, { radiusM: 100, excludeId: place.id });
  assert.deepEqual(nearby.map(({ id }) => id), ['tree-a', 'bench-a']);
  assert.equal(nearby[0].proximity.routeClaim, false);
  assert.equal(nearby[0].proximity.basis, 'published-coordinate-straight-line');
  assert.deepEqual(nearby[0].sourceReferences, ['tree-source']);
});

test('offline readiness reports partial rather than inventing availability', () => {
  const partial = companionOfflineReadiness({
    layers: runtimeManifest.layers.filter(({ id }) => id !== 'semantic'),
  });
  assert.equal(partial.state, 'partial');
  assert.equal(partial.layers.find(({ id }) => id === 'semantic').declared, false);
});
