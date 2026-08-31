import assert from 'node:assert/strict';
import test from 'node:test';
import { createNarrationDescriptor, createSpeechNarrator } from '../src/audio-guide.js';
import { createDestinationIndex, searchDestinationIndex } from '../src/destination-search.js';
import {
  NETWORK_RESULT_LIMIT,
  connectedRouteOptions,
  createNetworkDiscoveryIndex,
  routeAccessSummary,
  searchNetworkDiscovery,
} from '../src/discovery.js';
import { createWalkingNetworkDescriptor } from '../src/spatial-world.js';
import { planWalkingRoute, WALKING_ROUTING_PROFILES } from '../src/walking-router.js';

test('connected route comparison is deterministic and only projects existing route evidence', () => {
  const glo90 = { dataset: 'Copernicus DEM 2021 GLO-90', provider: 'Open-Meteo Elevation API' };
  const edges = [
    { id: 'a--slow', from: 'a', to: 'slow', distance_m: 120, walking_min: 4, ascent_m: 20, elevation_profile_m: [100, 120], elevation_source: glo90, surface_mix: ['gravel'], mapped_path_accessibility: 'unknown', contains_steps: false },
    { id: 'a--short', from: 'a', to: 'short', distance_m: 80, walking_min: 5, ascent_m: 2, elevation_profile_m: [100, 102], elevation_source: glo90, surface_mix: ['paved'], mapped_path_accessibility: 'potentially_step_free_mapped_path', contains_steps: false },
    { id: 'a--steps', from: 'a', to: 'steps', distance_m: 95, walking_min: 3, ascent_m: 9, elevation_profile_m: [100, 109], elevation_source: glo90, surface_mix: ['stone_steps'], mapped_path_accessibility: 'limited', contains_steps: true },
  ];
  const graph = {
    outgoing: new Map([['a', edges]]),
    nodesById: new Map([
      ['slow', { id: 'slow', name: { en: 'Slow climb' } }],
      ['short', { id: 'short', name: { en: 'Short climb' } }],
      ['steps', { id: 'steps', name: { en: 'Steps' } }],
    ]),
  };
  assert.deepEqual(connectedRouteOptions(graph, 'a', 'en').map(({ id }) => id), ['a--steps', 'a--slow', 'a--short']);
  assert.deepEqual(connectedRouteOptions(graph, 'a', 'en', { sort: 'distance' }).map(({ id }) => id), ['a--short', 'a--steps', 'a--slow']);
  assert.deepEqual(connectedRouteOptions(graph, 'a', 'en', { sort: 'ascent' }).map(({ id }) => id), ['a--short', 'a--steps', 'a--slow']);
  assert.equal(connectedRouteOptions(graph, 'a', 'en')[0].evidence.ascentM, 9);
  assert.equal(connectedRouteOptions(graph, 'a', 'en')[0].evidence.elevationSamplingM, null);
  assert.equal(routeAccessSummary(connectedRouteOptions(graph, 'a', 'en')[0].evidence, 'en'), 'Mapped steps');
});

test('multi-hop routing separates distance policy from segment facts and keeps unknown accessibility explicit', () => {
  const raw = {
    coverage: { physical_inventory_claim: false },
    place_anchors: {
      start: { path_node_id: 'a', component_id: 'main' },
      finish: { path_node_id: 'b', component_id: 'main' },
    },
    segments: [
      { id: 'direct-steps', from: 'a', to: 'b', geometry: [[51.31, 9.41], [51.312, 9.412]], distance_m: 5, surface: 'stone', steps: true, routing_eligible: true, pedestrian_oneway: 'both', accessibility_status: 'known_steps' },
      { id: 'detour-a-c', from: 'a', to: 'c', geometry: [[51.31, 9.41], [51.311, 9.411]], distance_m: 4, surface: null, steps: null, routing_eligible: true, pedestrian_oneway: 'both', accessibility_status: 'unknown_unmapped_connector', source_kind: 'representative_point_snap_connector' },
      { id: 'detour-c-b', from: 'c', to: 'b', geometry: [[51.311, 9.411], [51.312, 9.412]], distance_m: 4, surface: 'gravel', steps: false, routing_eligible: true, pedestrian_oneway: 'both', accessibility_status: 'unknown_not_field_verified' },
    ],
  };
  const network = createWalkingNetworkDescriptor(raw);
  const factsBefore = JSON.stringify(network.segments.map(({ id, distanceM, surface, steps, accessibilityStatus }) => ({ id, distanceM, surface, steps, accessibilityStatus })));
  const shortest = planWalkingRoute(network, 'start', 'finish', 'shortest');
  const avoidSteps = planWalkingRoute(network, 'start', 'finish', 'avoid-mapped-steps');

  assert.equal(WALKING_ROUTING_PROFILES.shortest.weight, 'distance_m');
  assert.equal(shortest.ok, true);
  assert.equal(shortest.distanceM, 5);
  assert.deepEqual(shortest.segments.map(({ segment }) => segment.id), ['direct-steps']);
  assert.equal(shortest.evidence.mappedStepSegments, 1);
  assert.equal(avoidSteps.ok, true);
  assert.equal(avoidSteps.distanceM, 8);
  assert.deepEqual(avoidSteps.segments.map(({ segment }) => segment.id), ['detour-a-c', 'detour-c-b']);
  assert.equal(avoidSteps.evidence.mappedStepSegments, 0);
  assert.equal(avoidSteps.evidence.stepUnknownSegments, 1, 'avoiding mapped steps must not upgrade unknown step evidence');
  assert.equal(avoidSteps.evidence.endpointUnknownSegments, 1);
  assert.equal(avoidSteps.evidence.surfaceDistanceM.unknown, 4);
  assert.equal(avoidSteps.coverage.physical_inventory_claim, false);
  assert.equal(JSON.stringify(network.segments.map(({ id, distanceM, surface, steps, accessibilityStatus }) => ({ id, distanceM, surface, steps, accessibilityStatus }))), factsBefore, 'routing policy must not mutate factual segment metadata');
});

test('multi-hop routing fails closed for unsupported profiles and disconnected anchors', () => {
  const network = createWalkingNetworkDescriptor({
    place_anchors: {
      a: { path_node_id: 'node-a', component_id: 'component-a' },
      b: { path_node_id: 'node-b', component_id: 'component-b' },
    },
    segments: [],
  });
  assert.deepEqual(planWalkingRoute(network, 'a', 'b', 'shortest'), {
    ok: false,
    reason: 'disconnected-components',
    fromComponentId: 'component-a',
    toComponentId: 'component-b',
  });
  assert.deepEqual(planWalkingRoute(network, 'a', 'b', 'wheelchair'), {
    ok: false,
    reason: 'unknown-profile',
    profileId: 'wheelchair',
  });
});

test('almanac category filter preserves stable canonical IDs across places, stories, trees and visitor features', () => {
  const index = createDestinationIndex({
    entities: [
      { id: 'place-a', name: { en: 'Place A' }, type: 'monument' },
      { id: 'person-a', name: { en: 'Person A' }, type: 'historical_figure', roles: ['architect'] },
    ],
    nodeIds: new Set(['place-a']),
    trees: [{ id: 'tree-a', species: { en: 'Oak' } }],
    visitorFeatures: [{ id: 'bench-a', layerKind: 'bench' }],
    language: 'en',
  });
  assert.deepEqual(searchDestinationIndex(index, '', 'en', { category: 'place' }).results.map(({ id }) => id), ['place-a']);
  assert.deepEqual(searchDestinationIndex(index, '', 'en', { category: 'story' }).results.map(({ id }) => id), ['person-a']);
  assert.deepEqual(searchDestinationIndex(index, '', 'en', { category: 'tree' }).results.map(({ id }) => id), ['tree-a']);
  assert.deepEqual(searchDestinationIndex(index, '', 'en', { category: 'feature' }).results.map(({ id }) => id), ['bench-a']);
  assert.equal(searchDestinationIndex(index, 'architect', 'en', { category: 'story' }).results[0].id, 'person-a');
});

test('walking-network discovery keeps source IDs, derives junctions without graph mutation and bounds DOM candidates', () => {
  const raw = {
    counts: { path_nodes: 4, rendered_segments: 4 },
    segments: [
      { id: 'seg-a-b', from: 'node-a', to: 'node-b', geometry: [[51.31, 9.41], [51.311, 9.411]], distance_m: 12, surface: 'gravel', highway: 'path', steps: false },
      { id: 'seg-a-c', from: 'node-a', to: 'node-c', geometry: [[51.31, 9.41], [51.312, 9.412]], distance_m: 22, surface: 'paved', highway: 'footway', steps: false },
      { id: 'seg-a-d', from: 'node-a', to: 'node-d', geometry: [[51.31, 9.41], [51.313, 9.413]], distance_m: 32, surface: 'stone_steps', highway: 'steps', steps: true },
      { id: 'seg-a-d-reverse', from: 'node-d', to: 'node-a', geometry: [[51.313, 9.413], [51.31, 9.41]], distance_m: 32, surface: 'stone_steps', highway: 'steps', steps: true },
    ],
  };
  const descriptor = createWalkingNetworkDescriptor(raw);
  assert.equal(descriptor.nodesById.get('node-a').degree, 3, 'reverse segment must not inflate unique-neighbor degree');
  const index = createNetworkDiscoveryIndex(descriptor, 'en');
  assert.equal(index.find(({ id }) => id === 'node-a')?.kind, 'junction');
  assert.equal(index.find(({ id }) => id === 'seg-a-d')?.kind, 'steps');
  assert.deepEqual(searchNetworkDiscovery(index, { kind: 'junction' }).results.map(({ id }) => id), ['node-a']);
  assert.equal(searchNetworkDiscovery(index, { query: 'stone_steps' }).total, 2);
  const bounded = searchNetworkDiscovery(Array.from({ length: 100 }, (_, i) => ({ id: `p-${String(i).padStart(3, '0')}`, kind: 'path', title: 'Path', context: '', keywords: [], position: { lng: 9, lat: 51 } })));
  assert.equal(bounded.results.length, NETWORK_RESULT_LIMIT);
  assert.equal(bounded.limited, true);
});

test('narration descriptor is bilingual, transcript-backed and narrator is inert until explicit play', () => {
  const node = {
    id: 'aquaedukt',
    name: { de: 'Aquädukt', en: 'Aqueduct' },
    description: { de: 'Deutscher Überblick', en: 'English overview' },
    history: { de: 'Deutsche Geschichte', en: 'English history' },
  };
  const de = createNarrationDescriptor(node, 'de');
  const en = createNarrationDescriptor(node, 'en');
  assert.equal(de.langTag, 'de-DE');
  assert.equal(en.langTag, 'en-GB');
  assert.match(en.speechText, /English overview/);
  assert.equal(en.transcript[1].heading, 'Overview');

  const calls = [];
  class FakeUtterance {
    constructor(text) { this.text = text; }
  }
  const synthesis = {
    speak(utterance) { calls.push(['speak', utterance.text]); },
    cancel() { calls.push(['cancel']); },
    getVoices() { return []; },
  };
  const narrator = createSpeechNarrator({ speechSynthesisRef: synthesis, UtteranceCtor: FakeUtterance });
  assert.deepEqual(calls, [], 'construction must never autoplay');
  assert.equal(narrator.play(de), true);
  assert.equal(narrator.play(en), true);
  assert.deepEqual(calls.map(([kind]) => kind), ['speak', 'cancel', 'speak']);
  assert.equal(narrator.activeId, en.id);
  assert.equal(narrator.stop(), true);
  assert.equal(narrator.state, 'idle');
  assert.deepEqual(calls.map(([kind]) => kind), ['speak', 'cancel', 'speak', 'cancel']);
});
