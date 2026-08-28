const SHELL_CACHE = 'bergpark-shell-v6';
const TILE_CACHE = 'bergpark-tiles-v1';
const RUNTIME_MANIFEST = './data/runtime-manifest.json';
const DEFAULT_TILE_LIMIT = 80;
const SHELL = [
  './manifest.webmanifest',
  './icons/app-icon.svg',
  './icons/app-icon-192.png',
  './icons/app-icon-512.png',
];

function isJsonResponse(response) {
  return response.headers.get('content-type')?.toLowerCase().includes('application/json') === true;
}

function jsonError(status, code, path) {
  return new Response(JSON.stringify({ error: code, path }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function validateRuntimeManifest(manifest) {
  if (
    !manifest
    || manifest.schema_version !== 1
    || manifest.contract !== 'bergpark-runtime-data'
    || manifest.contract_version !== 1
    || !Array.isArray(manifest.layers)
  ) {
    throw new Error('Incompatible runtime data manifest');
  }
  return manifest;
}

async function fetchRuntimeManifest(cache) {
  const request = new Request(new URL(RUNTIME_MANIFEST, self.registration.scope), {
    headers: { Accept: 'application/json' },
  });
  const response = await fetch(request);
  if (!response.ok) throw new Error(`Runtime manifest request failed: ${response.status}`);
  if (!isJsonResponse(response)) throw new Error('Runtime manifest response is not JSON');
  const manifest = validateRuntimeManifest(await response.clone().json());
  await cache.put(request, response.clone());
  return manifest;
}

async function cachedRuntimeManifest() {
  const cache = await caches.open(SHELL_CACHE);
  const response = await cache.match(new URL(RUNTIME_MANIFEST, self.registration.scope).href);
  if (!response || !isJsonResponse(response)) return null;
  try {
    return validateRuntimeManifest(await response.json());
  } catch {
    return null;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL);
    const shellResponse = await fetch('./');
    if (!shellResponse.ok) throw new Error(`Application shell request failed: ${shellResponse.status}`);
    const html = await shellResponse.clone().text();
    await cache.put('./', shellResponse);
    const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((match) => new URL(match[1], self.registration.scope))
      .filter((url) => url.origin === self.location.origin && url.pathname.includes('/assets/'))
      .map((url) => url.href);
    await Promise.all([...new Set(assets)].map((url) => cache.add(url)));

    const runtimeManifest = await fetchRuntimeManifest(cache);
    const runtimeLayers = runtimeManifest.layers.filter((layer) => layer.precache && layer.available !== false);
    const requiredLayers = runtimeLayers.filter((layer) => layer.release_required);
    const optionalLayers = runtimeLayers.filter((layer) => !layer.release_required);
    await Promise.all(requiredLayers.map((layer) => cache.add(`./data/${layer.filename}`)));
    await Promise.allSettled(optionalLayers.map((layer) => cache.add(`./data/${layer.filename}`)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith('bergpark-shell-') && key !== SHELL_CACHE)
        .map((key) => caches.delete(key)),
    );
    await self.clients.claim();
  })());
});

function isMapTile(url) {
  return url.hostname.endsWith('tile.openstreetmap.org') || url.hostname.endsWith('tile.opentopomap.org');
}

async function networkFirstData(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (!response.ok) return response;
    if (!isJsonResponse(response)) return jsonError(502, 'invalid_data_content_type', new URL(request.url).pathname);
    await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || jsonError(503, 'offline_data_unavailable', new URL(request.url).pathname);
  }
}

async function visitedTileLimit() {
  const manifest = await cachedRuntimeManifest();
  const limit = manifest?.budgets?.visited_tile_entries;
  return Number.isSafeInteger(limit) && limit > 0 ? limit : DEFAULT_TILE_LIMIT;
}

async function cacheVisitedTile(request) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') {
      await cache.put(request, response.clone());
      const keys = await cache.keys();
      const limit = await visitedTileLimit();
      while (keys.length > limit) await cache.delete(keys.shift());
    }
    return response;
  } catch {
    return Response.error();
  }
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || (await cache.match('./')) || Response.error();
  }
}

async function cacheFirstStatic(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  if (isMapTile(url)) {
    event.respondWith(cacheVisitedTile(event.request));
    return;
  }

  if (url.origin !== self.location.origin) return;
  const dataPath = new URL('./data/', self.registration.scope).pathname;
  if (url.pathname.startsWith(dataPath)) {
    event.respondWith(networkFirstData(event.request));
    return;
  }
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(networkFirstNavigation(event.request));
    return;
  }
  event.respondWith(cacheFirstStatic(event.request));
});
