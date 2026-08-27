const VERSION = 'bergpark-shell-v1';
const SHELL = [
  './',
  './manifest.webmanifest',
  './data/nodes.de.json',
  './data/nodes.en.json',
  './data/edges.json',
  './data/trees.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== VERSION && key.startsWith('bergpark-')).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

function isMapTile(url) {
  return url.hostname.endsWith('tile.openstreetmap.org') || url.hostname.endsWith('tile.opentopomap.org');
}

async function cacheVisitedTile(request) {
  const cache = await caches.open('bergpark-tiles-v1');
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    const keys = await cache.keys();
    while (keys.length > 80) {
      await cache.delete(keys.shift());
    }
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;

  if (isMapTile(url)) {
    event.respondWith(cacheVisitedTile(event.request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(VERSION).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request).then((response) => response || caches.match('./'))),
    );
  }
});
