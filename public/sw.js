const SHELL_CACHE = 'bergpark-shell-v5';
const TILE_CACHE = 'bergpark-tiles-v1';
const SHELL = [
  './manifest.webmanifest',
  './icons/app-icon.svg',
  './icons/app-icon-192.png',
  './icons/app-icon-512.png',
];
const RUNTIME_DATA = [
  './data/nodes.json',
  './data/nodes.de.json',
  './data/nodes.en.json',
  './data/sources.json',
  './data/edges.json',
  './data/trees.json',
  './data/figures.json',
  './data/semantic.json',
  './data/benches.json',
  './data/visitor_pois.json',
  './data/walking-network.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL);
    const shellResponse = await fetch('./');
    if (shellResponse.ok) {
      const html = await shellResponse.clone().text();
      await cache.put('./', shellResponse);
      const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
        .map((match) => new URL(match[1], self.registration.scope))
        .filter((url) => url.origin === self.location.origin && url.pathname.includes('/assets/'))
        .map((url) => url.href);
      await Promise.allSettled([...new Set(assets)].map((url) => cache.add(url)));
    }
    await Promise.allSettled(RUNTIME_DATA.map((url) => cache.add(url)));
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
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || Response.error();
  }
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
      while (keys.length > 80) await cache.delete(keys.shift());
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
  if (url.pathname.includes('/data/')) {
    event.respondWith(networkFirstData(event.request));
    return;
  }
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(networkFirstNavigation(event.request));
    return;
  }
  event.respondWith(cacheFirstStatic(event.request));
});
