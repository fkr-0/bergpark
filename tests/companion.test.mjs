import test from 'node:test';
import assert from 'node:assert/strict';

import { createNarrationDescriptor, createNarrationVariants, createSpeechNarrator } from '../src/audio-guide.js';
import { buildRelatedJourney, relatedJourneyBuckets } from '../src/related-journey.js';
import { normalizeSearchText } from '../src/destination-search.js';

function speechHarness() {
  const calls = [];
  const speech = {
    speak(utterance) { calls.push(['speak', utterance.text]); },
    cancel() { calls.push(['cancel']); },
    pause() { calls.push(['pause']); },
    resume() { calls.push(['resume']); },
    getVoices() { return []; },
  };
  class Utterance {
    constructor(text) { this.text = text; this.lang = ''; this.onend = null; this.onerror = null; }
  }
  return { calls, speech, Utterance };
}

test('companion search normalization is diacritic-insensitive', () => {
  assert.equal(normalizeSearchText('  Löwenburg  '), 'lowenburg');
  assert.equal(normalizeSearchText('WASSERFÄLLE'), 'wasserfalle');
});

test('narration descriptors and transcript stay available in both languages', () => {
  const node = {
    id: 'herkules',
    name: { de: 'Herkules', en: 'Hercules' },
    description: { de: 'Deutsch', en: 'English' },
  };
  const descriptor = createNarrationDescriptor(node, 'de');
  const variants = createNarrationVariants(node);
  assert.equal(descriptor.transcript.length, 2);
  assert.equal(descriptor.speechText, 'Herkules. Deutsch');
  assert.deepEqual(variants.map(({ language }) => language), ['de', 'en']);
});

test('speech narrator has explicit pause/resume/stop and no autoplay', () => {
  const { calls, speech, Utterance } = speechHarness();
  const narrator = createSpeechNarrator({ speechSynthesisRef: speech, UtteranceCtor: Utterance });
  const descriptor = createNarrationDescriptor({ id: 'x', name: { de: 'Ort', en: 'Place' }, description: { de: 'Text', en: 'Text' } });
  assert.deepEqual(calls, []);
  assert.equal(narrator.play(descriptor), true);
  assert.equal(narrator.state, 'playing');
  assert.equal(narrator.pause(), true);
  assert.equal(narrator.state, 'paused');
  assert.equal(narrator.resume(), true);
  assert.equal(narrator.state, 'playing');
  assert.equal(narrator.stop(), true);
  assert.equal(narrator.state, 'idle');
  assert.deepEqual(calls.map(([type]) => type), ['speak', 'pause', 'resume', 'cancel']);
});

test('speech narrator degrades cleanly when SpeechSynthesis is absent', () => {
  const narrator = createSpeechNarrator({ speechSynthesisRef: null, UtteranceCtor: null });
  assert.equal(narrator.supported, false);
  assert.equal(narrator.play({ id: 'x', speechText: 'hello', langTag: 'en-GB' }), false);
  assert.equal(narrator.pause(), false);
  assert.equal(narrator.resume(), false);
});

test('related journey prefers canonical semantic relations then bounded nearby walks', () => {
  const hercules = { id: 'herkules', name: { de: 'Herkules', en: 'Hercules' }, type: 'monument', osm_tags: {} };
  const drawing = { id: 'artwork-herkules', name: { de: 'Herkules-Entwurf', en: 'Hercules design' }, kind: 'artwork' };
  const schloss = { id: 'schloss', name: { de: 'Schloss', en: 'Palace' }, type: 'palace', osm_tags: {} };
  const graph = {
    entitiesById: new Map([['herkules', hercules], ['artwork-herkules', drawing]]),
    nodesById: new Map([['herkules', hercules], ['schloss', schloss]]),
    semanticRelationsByEntity: new Map([['herkules', [{ from: 'herkules', to: 'artwork-herkules', relation: 'documents_design_for', provenance: { assertion: 'source-backed' }, source_ids: ['src-1'] }]]]),
    outgoing: new Map([['herkules', [{ id: 'edge-1', from: 'herkules', to: 'schloss', distance_m: 200, walking_min: 4 }]]]),
  };
  const journey = buildRelatedJourney(graph, 'herkules', 'en', { limit: 4 });
  assert.deepEqual(journey.map(({ id }) => id), ['artwork-herkules', 'schloss']);
  assert.equal(journey[0].source, 'semantic');
  assert.deepEqual(journey[0].sourceIds, ['src-1']);
  assert.equal(relatedJourneyBuckets(graph, 'herkules', 'en').nearby.length, 1);
});
