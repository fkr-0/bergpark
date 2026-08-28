import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createSpatialController, detectSpatialCapabilities, readSpatialPreference, selectSpatialRenderer } from '../src/spatial-controller.js';

test('capability detection requires WebGL2 rather than accepting a WebGL1 context', () => {
  const webgl1Only = detectSpatialCapabilities({
    documentRef: { createElement: () => ({ getContext: (kind) => kind === 'webgl' ? {} : null }) },
    navigatorRef: {},
  });
  assert.equal(webgl1Only.webgl2, false);

  const webgl2 = detectSpatialCapabilities({
    documentRef: { createElement: () => ({ getContext: (kind) => kind === 'webgl2' ? {} : null }) },
    navigatorRef: {},
  });
  assert.equal(webgl2.webgl2, true);
});

test('renderer preference fails closed to Leaflet without WebGL2, on reduced power, and before terrain ships', () => {
  assert.deepEqual(selectSpatialRenderer({ preference: 'terrain', capabilities: { webgl2: false, terrain: true } }), {
    renderer: 'leaflet', requested: 'terrain', fallbackReason: 'webgl2-unavailable',
  });
  assert.deepEqual(selectSpatialRenderer({ preference: 'terrain', capabilities: { webgl2: true, terrain: true, reducedPower: true } }), {
    renderer: 'leaflet', requested: 'terrain', fallbackReason: 'reduced-power',
  });
  assert.deepEqual(selectSpatialRenderer({ preference: 'terrain', capabilities: { webgl2: true, terrain: false } }), {
    renderer: 'leaflet', requested: 'terrain', fallbackReason: 'terrain-renderer-unavailable',
  });
  assert.equal(selectSpatialRenderer({ preference: 'leaflet', capabilities: {} }).renderer, 'leaflet');
});

test('renderer preference plumbing accepts only explicit known values', () => {
  const storage = { getItem: () => 'terrain' };
  assert.equal(readSpatialPreference({ search: '?renderer=leaflet', storage }), 'leaflet');
  assert.equal(readSpatialPreference({ search: '?renderer=unknown', storage }), 'terrain');
  assert.equal(readSpatialPreference({ search: '', storage: { getItem: () => 'webgpu' } }), 'auto');
});

test('spatial controller forwards core semantics without exposing the adapter map', () => {
  const calls = [];
  const adapter = Object.fromEntries([
    'fitWorld', 'focusPlace', 'focusPosition', 'showRoute', 'clearRoute', 'setUserPosition',
    'setWalkingNetwork', 'setLanguage', 'invalidate', 'destroy',
  ].map((name) => [name, (...args) => { calls.push([name, ...args]); return true; }]));
  adapter.map = { concreteLeafletObject: true };
  adapter.compatibilitySurface = (name) => ({ kind: name, renderer: 'leaflet', map: adapter.map });
  const controller = createSpatialController(adapter, { renderer: 'leaflet', requested: 'auto', fallbackReason: null });
  controller.focusPlace('herkules', { popup: true });
  controller.focusPosition({ lng: 9.4, lat: 51.3 }, { minZoom: 17 });
  controller.showRoute({ id: 'route-1', coordinates: [{ lng: 9.4, lat: 51.3 }, { lng: 9.5, lat: 51.4 }] });
  controller.setUserPosition({ lng: 9.4, lat: 51.3, accuracy: 5 });
  assert.equal('map' in controller, false);
  assert.deepEqual(calls.map(([name]) => name), ['focusPlace', 'focusPosition', 'showRoute', 'setUserPosition']);
  assert.equal(controller.compatibilitySurface('unknown'), null);
  assert.equal(controller.compatibilitySurface('leaflet-overlays-v1').map, adapter.map);
});

test('main orchestration has no direct Leaflet map-object access outside the named compatibility seam', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /mapController\.map/);
  assert.doesNotMatch(source, /\bL\./);
  assert.match(source, /compatibilitySurface\(LEAFLET_OVERLAY_COMPATIBILITY\)/);
});
