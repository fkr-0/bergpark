import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const SCOPE = 'https://bergpark.test/';
const CONTRACT = JSON.parse(await readFile(new URL('../runtime/runtime-data-manifest.json', import.meta.url), 'utf8'));
const PUBLISHED_MANIFEST = {
  ...CONTRACT,
  layers: CONTRACT.layers.map((layer) => ({ ...layer, available: true, bytes: 1, sha256: 'fixture' })),
};

function absoluteUrl(input) {
  if (input instanceof Request) return input.url;
  return new URL(String(input), SCOPE).href;
}

class FakeCache {
  constructor(fetcher) {
    this.fetcher = fetcher;
    this.entries = new Map();
  }

  async match(input) {
    const response = this.entries.get(absoluteUrl(input));
    return response?.clone() ?? null;
  }

  async put(input, response) {
    this.entries.set(absoluteUrl(input), response.clone());
  }

  async add(input) {
    const request = new Request(absoluteUrl(input));
    const response = await this.fetcher(request);
    if (!response.ok && response.type !== 'opaque') throw new Error(`cache add failed: ${request.url}`);
    await this.put(request, response);
  }

  async addAll(inputs) {
    await Promise.all(inputs.map((input) => this.add(input)));
  }

  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }

  async delete(input) {
    return this.entries.delete(absoluteUrl(input));
  }
}

class FakeCacheStorage {
  constructor(fetcher) {
    this.fetcher = fetcher;
    this.caches = new Map();
  }

  async open(name) {
    if (!this.caches.has(name)) this.caches.set(name, new FakeCache(this.fetcher));
    return this.caches.get(name);
  }

  async keys() {
    return [...this.caches.keys()];
  }

  async delete(name) {
    return this.caches.delete(name);
  }
}

async function loadServiceWorker() {
  const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  const listeners = new Map();
  const state = {
    fetch: async (input) => new Response(`network:${absoluteUrl(input)}`, { status: 200 }),
  };
  const caches = new FakeCacheStorage((input) => state.fetch(input));
  const self = {
    location: new URL(SCOPE),
    registration: { scope: SCOPE },
    clients: { claim: async () => {} },
    skipWaiting() {},
    addEventListener(type, listener) { listeners.set(type, listener); },
  };
  const context = vm.createContext({
    caches,
    console,
    fetch: (input) => state.fetch(input),
    Promise,
    Request,
    Response,
    self,
    Set,
    URL,
  });
  new vm.Script(source, { filename: 'public/sw.js' }).runInContext(context);
  return {
    caches,
    listeners,
    state,
    get(name) { return vm.runInContext(name, context); },
  };
}

function dispatchLifecycle(listener) {
  let completion;
  listener({ waitUntil(promise) { completion = Promise.resolve(promise); } });
  return completion;
}

function runtimeNetworkResponse(input) {
  const url = absoluteUrl(input);
  if (url === SCOPE) {
    return new Response('<link rel="stylesheet" href="./assets/app.css"><script src="./assets/app.js"></script>', { status: 200 });
  }
  if (url.endsWith('/data/runtime-manifest.json')) {
    return new Response(JSON.stringify(PUBLISHED_MANIFEST), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (url.includes('/data/')) {
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(`ok:${url}`, { status: 200 });
}

test('Phase 7 install warms manifest-authorized layers and activate upgrades v5 shell cache atomically', async () => {
  const worker = await loadServiceWorker();
  worker.state.fetch = async (input) => runtimeNetworkResponse(input);

  await dispatchLifecycle(worker.listeners.get('install'));
  const shell = await worker.caches.open('bergpark-shell-v6');
  const warmed = (await shell.keys()).map(({ url }) => new URL(url).pathname);
  assert.ok(warmed.includes('/assets/app.css'));
  assert.ok(warmed.includes('/assets/app.js'));
  assert.ok(warmed.includes('/icons/app-icon.svg'));
  assert.ok(warmed.includes('/icons/app-icon-192.png'));
  assert.ok(warmed.includes('/icons/app-icon-512.png'));
  assert.ok(warmed.includes('/data/runtime-manifest.json'));
  for (const layer of PUBLISHED_MANIFEST.layers.filter((entry) => entry.precache)) {
    assert.ok(warmed.includes(`/data/${layer.filename}`), `expected warmed ${layer.filename}`);
  }

  await worker.caches.open('bergpark-shell-v5');
  await worker.caches.open('unrelated-cache');
  await dispatchLifecycle(worker.listeners.get('activate'));
  assert.deepEqual((await worker.caches.keys()).sort(), ['bergpark-shell-v6', 'unrelated-cache']);
});

test('static assets are cache-first while valid runtime JSON is network-first with offline fallback', async () => {
  const worker = await loadServiceWorker();
  const shell = await worker.caches.open('bergpark-shell-v6');
  const staticRequest = new Request(`${SCOPE}assets/app.js`);
  const dataRequest = new Request(`${SCOPE}data/walking-network.json`);
  await shell.put(staticRequest, new Response('cached-static', { status: 200 }));
  await shell.put(dataRequest, new Response('{"cached":true}', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));

  worker.state.fetch = async () => { throw new Error('offline'); };
  const staticResponse = await worker.get('cacheFirstStatic')(staticRequest);
  assert.equal(await staticResponse.text(), 'cached-static');

  worker.state.fetch = async () => new Response('{"fresh":true}', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  const onlineData = await worker.get('networkFirstData')(dataRequest);
  assert.equal(await onlineData.text(), '{"fresh":true}');
  assert.equal(await (await shell.match(dataRequest)).text(), '{"fresh":true}');

  worker.state.fetch = async () => { throw new Error('offline'); };
  const offlineData = await worker.get('networkFirstData')(dataRequest);
  assert.equal(await offlineData.text(), '{"fresh":true}');
});

test('uncached offline data returns explicit JSON 503 and HTML-as-JSON is rejected without cache pollution', async () => {
  const worker = await loadServiceWorker();
  const shell = await worker.caches.open('bergpark-shell-v6');
  const request = new Request(`${SCOPE}data/not-shipped.json`);

  worker.state.fetch = async () => { throw new Error('offline'); };
  const offline = await worker.get('networkFirstData')(request);
  assert.equal(offline.status, 503);
  assert.match(offline.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await offline.json(), { error: 'offline_data_unavailable', path: '/data/not-shipped.json' });

  worker.state.fetch = async () => new Response('<!doctype html><title>fallback</title>', {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  });
  const invalid = await worker.get('networkFirstData')(request);
  assert.equal(invalid.status, 502);
  assert.deepEqual(await invalid.json(), { error: 'invalid_data_content_type', path: '/data/not-shipped.json' });
  assert.equal(await shell.match(request), null);

  worker.state.fetch = async () => new Response('missing', { status: 404 });
  const missing = await worker.get('networkFirstData')(request);
  assert.equal(missing.status, 404);
});

test('visited tile cache accepts opaque provider responses and uses manifest tile-entry budget', async () => {
  const worker = await loadServiceWorker();
  const shell = await worker.caches.open('bergpark-shell-v6');
  const tinyBudgetManifest = {
    ...PUBLISHED_MANIFEST,
    budgets: { ...PUBLISHED_MANIFEST.budgets, visited_tile_entries: 2 },
  };
  await shell.put(
    new Request(`${SCOPE}data/runtime-manifest.json`),
    new Response(JSON.stringify(tinyBudgetManifest), { headers: { 'Content-Type': 'application/json' } }),
  );

  const tiles = await worker.caches.open('bergpark-tiles-v1');
  await tiles.put(new Request('https://a.tile.openstreetmap.org/15/1/0.png'), new Response('tile-1', { status: 200 }));
  await tiles.put(new Request('https://a.tile.openstreetmap.org/15/2/0.png'), new Response('tile-2', { status: 200 }));

  const opaque = new Response('opaque-tile', { status: 200 });
  Object.defineProperty(opaque, 'type', { value: 'opaque' });
  Object.defineProperty(opaque, 'ok', { value: false });
  worker.state.fetch = async () => opaque;
  const newest = new Request('https://a.tile.openstreetmap.org/15/3/0.png');
  const returned = await worker.get('cacheVisitedTile')(newest);
  assert.equal(returned.type, 'opaque');
  assert.equal((await tiles.keys()).length, 2);
  assert.ok(await tiles.match(newest));

  worker.state.fetch = async () => { throw new Error('offline'); };
  const missing = await worker.get('cacheVisitedTile')(new Request('https://b.tile.openstreetmap.org/15/1000/0.png'));
  assert.equal(missing.type, 'error');
  assert.equal(missing.status, 0);
});
