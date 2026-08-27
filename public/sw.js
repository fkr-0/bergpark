const SHELL_CACHE = 'bergpark-shell-v2';
const TILE_CACHE = 'bergpark-tiles-v1';
const SHELL = ['./', './manifest.webmanifest'];
const RUNTIME_DATA = [
  './data/nodes.json',
  './data/nodes.de.json',
  './data/nodes.en.json',
  './data/sources.json',
  './data/edges.json',
  './data/trees.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL);
    await Promise.allSettled(RUNTIME_DATA.map((url) => cache.add(url)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key.startsWith('bergpark-shell-') && key !== SHELL_CACHE)
        .map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

function isMapTile(url) {
  return url.hostname.endsWith('tile.openstreetmap.org') || url.hostname.endsWith('tile.opentopomap.org');
}

async function cacheVisitedTile(request) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    const keys = await cache.keys();
    while (keys.length > 80) await cache.delete(keys.shift());
  }
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || (await cache.match('./'));
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  if (isMapTile(url)) {
    event.respondWith(cacheVisitedTile(event.request));
    return;
  }

  if (url.origin === self.location.origin) event.respondWith(networkFirst(event.request));
});
