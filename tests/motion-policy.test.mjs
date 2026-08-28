import assert from 'node:assert/strict';
import test from 'node:test';
import { moveMapLibreCamera, prefersReducedMotion } from '../src/motion-policy.js';

test('MapLibre camera jumps immediately when reduced motion is requested', () => {
  const calls = [];
  const map = {
    jumpTo(options) { calls.push(['jumpTo', options]); },
    easeTo(options) { calls.push(['easeTo', options]); },
  };
  const result = moveMapLibreCamera(
    map,
    { center: [9.4, 51.31], zoom: 16, pitch: 45, bearing: 0 },
    { duration: 0.6, matchMedia: () => ({ matches: true }) },
  );
  assert.equal(result, 'immediate');
  assert.deepEqual(calls, [['jumpTo', { center: [9.4, 51.31], zoom: 16, pitch: 45, bearing: 0 }]]);
});

test('MapLibre camera uses non-essential bounded easing otherwise', () => {
  const calls = [];
  const map = {
    jumpTo(options) { calls.push(['jumpTo', options]); },
    easeTo(options) { calls.push(['easeTo', options]); },
  };
  const result = moveMapLibreCamera(
    map,
    { center: [9.4, 51.31], zoom: 17, pitch: 45, bearing: 0 },
    { duration: 0.35, matchMedia: () => ({ matches: false }) },
  );
  assert.equal(result, 'animated');
  assert.deepEqual(calls, [[
    'easeTo',
    { center: [9.4, 51.31], zoom: 17, pitch: 45, bearing: 0, duration: 350, essential: false },
  ]]);
});

test('motion preference helper remains conservative when matchMedia is absent', () => {
  assert.equal(prefersReducedMotion(null), false);
});
