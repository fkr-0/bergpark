import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const SCOPE = 'https://bergpark.test/';

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

test('Phase 7 install warms hashed assets plus walking-network data and activate removes stale shell caches', async () => {
  const worker = await loadServiceWorker();
  worker.state.fetch = async (input) => {
    const url = absoluteUrl(input);
    if (url === SCOPE) {
      return new Response('<link rel="stylesheet" href="./assets/app.css"><script src="./assets/app.js"></script>', { status: 200 });
    }
    return new Response(`ok:${url}`, { status: 200 });
  };

  await dispatchLifecycle(worker.listeners.get('install'));
  const shell = await worker.caches.open('bergpark-shell-v5');
  const warmed = (await shell.keys()).map(({ url }) => new URL(url).pathname);
  assert.ok(warmed.includes('/assets/app.css'));
  assert.ok(warmed.includes('/assets/app.js'));
  assert.ok(warmed.includes('/icons/app-icon.svg'));
  assert.ok(warmed.includes('/icons/app-icon-192.png'));
  assert.ok(warmed.includes('/icons/app-icon-512.png'));
  assert.ok(warmed.includes('/data/walking-network.json'));

  await worker.caches.open('bergpark-shell-v4');
  await worker.caches.open('unrelated-cache');
  await dispatchLifecycle(worker.listeners.get('activate'));
  assert.deepEqual((await worker.caches.keys()).sort(), ['bergpark-shell-v5', 'unrelated-cache']);
});

test('static assets are cache-first while runtime data is network-first with offline fallback', async () => {
  const worker = await loadServiceWorker();
  const shell = await worker.caches.open('bergpark-shell-v5');
  const staticRequest = new Request(`${SCOPE}assets/app.js`);
  const dataRequest = new Request(`${SCOPE}data/walking-network.json`);
  await shell.put(staticRequest, new Response('cached-static', { status: 200 }));
  await shell.put(dataRequest, new Response('cached-data', { status: 200 }));

  worker.state.fetch = async () => { throw new Error('offline'); };
  const staticResponse = await worker.get('cacheFirstStatic')(staticRequest);
  assert.equal(await staticResponse.text(), 'cached-static');

  worker.state.fetch = async () => new Response('fresh-data', { status: 200 });
  const onlineData = await worker.get('networkFirstData')(dataRequest);
  assert.equal(await onlineData.text(), 'fresh-data');
  assert.equal(await (await shell.match(dataRequest)).text(), 'fresh-data');

  worker.state.fetch = async () => { throw new Error('offline'); };
  const offlineData = await worker.get('networkFirstData')(dataRequest);
  assert.equal(await offlineData.text(), 'fresh-data');
});

test('visited tile cache remains bounded and tile failure returns an error response, not a synthetic empty tile', async () => {
  const worker = await loadServiceWorker();
  const tiles = await worker.caches.open('bergpark-tiles-v1');
  for (let index = 0; index < 80; index += 1) {
    await tiles.put(new Request(`https://a.tile.openstreetmap.org/15/${index}/0.png`), new Response('tile', { status: 200 }));
  }

  worker.state.fetch = async () => new Response('new-tile', { status: 200 });
  const newest = new Request('https://a.tile.openstreetmap.org/15/999/0.png');
  assert.equal(await (await worker.get('cacheVisitedTile')(newest)).text(), 'new-tile');
  assert.equal((await tiles.keys()).length, 80);
  assert.ok(await tiles.match(newest));

  worker.state.fetch = async () => { throw new Error('offline'); };
  const missing = await worker.get('cacheVisitedTile')(new Request('https://b.tile.openstreetmap.org/15/1000/0.png'));
  assert.equal(missing.type, 'error');
  assert.equal(missing.status, 0);
});
