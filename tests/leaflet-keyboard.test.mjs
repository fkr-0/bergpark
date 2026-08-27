import assert from 'node:assert/strict';
import test from 'node:test';
import { markerKeyboardActivation } from '../src/leaflet-keyboard.js';

test('marker keyboard activation handles Enter and Space once and ignores unrelated/repeat keys', () => {
  const activations = [];
  const prevented = [];
  const stopped = [];
  const handler = markerKeyboardActivation(() => activations.push('activated'));
  const event = (key, repeat = false) => ({
    originalEvent: {
      key,
      repeat,
      preventDefault: () => prevented.push(key),
      stopPropagation: () => stopped.push(key),
    },
  });

  handler(event('ArrowRight'));
  handler(event('Enter', true));
  handler(event('Enter'));
  handler(event(' '));

  assert.deepEqual(activations, ['activated', 'activated']);
  assert.deepEqual(prevented, ['Enter', ' ']);
  assert.deepEqual(stopped, ['Enter', ' ']);
});
