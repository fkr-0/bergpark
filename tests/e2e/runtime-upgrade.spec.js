import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { expect, test } from '@playwright/test';
import { stubThirdPartyMapTiles } from './test-support.js';

const candidateDist = resolve(process.env.BERGPARK_UPGRADE_CANDIDATE_DIST ?? 'dist');
const deployedSwV4Path = resolve('tests/fixtures/runtime-upgrade/deployed-sw-v4.js');
const priorHtml = `<!doctype html>
<html lang="de">
  <head><meta charset="utf-8"><title>Bergpark deployed-v4 fixture</title></head>
  <body><main id="prior-shell">Bergpark deployed v4 controlled session</main></body>
</html>\n`;
const priorManifest = JSON.stringify({
  name: 'Bergpark deployed-v4 fixture',
  short_name: 'Bergpark',
  start_url: './',
  scope: './',
  display: 'standalone',
});

function contentType(pathname) {
  switch (extname(pathname)) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.webmanifest': return 'application/manifest+json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    default: return 'application/octet-stream';
  }
}

async function createUpgradeServer() {
  const deployedSwV4 = await readFile(deployedSwV4Path);
  let mode = 'prior';

  const server = createServer(async (request, response) => {
    try {
      const origin = `http://${request.headers.host}`;
      const pathname = decodeURIComponent(new URL(request.url, origin).pathname);

      if (pathname === '/sw.js') {
        const body = mode === 'prior' ? deployedSwV4 : await readFile(resolve(candidateDist, 'sw.js'));
        response.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-store',
          'Service-Worker-Allowed': '/',
        });
        response.end(body);
        return;
      }

      if (mode === 'prior') {
        if (pathname === '/') {
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          response.end(priorHtml);
          return;
        }
        if (pathname === '/manifest.webmanifest') {
          response.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8' });
          response.end(priorManifest);
          return;
        }
        if (pathname.startsWith('/data/')) {
          response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end('{}');
          return;
        }
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('prior fixture not found');
        return;
      }

      if (mode === 'candidate-fail' && pathname === '/data/nodes.json') {
        response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end('{"error":"required_fixture_layer_unavailable"}');
        return;
      }

      if (pathname === '/data/html-fallback.json') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end('<!doctype html><title>wrong data fallback</title>');
        return;
      }

      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
      const filePath = resolve(candidateDist, relative);
      if (filePath !== candidateDist && !filePath.startsWith(`${candidateDist}${sep}`)) {
        response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('invalid path');
        return;
      }

      try {
        const body = await readFile(filePath);
        response.writeHead(200, { 'Content-Type': contentType(filePath), 'Cache-Control': 'no-store' });
        response.end(body);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end('candidate fixture not found');
      }
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(`fixture server error: ${error.message}`);
    }
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    setMode(nextMode) { mode = nextMode; },
    close() { return new Promise((resolveClose) => server.close(resolveClose)); },
  };
}

async function updateRegistration(page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration) throw new Error('upgrade fixture has no service-worker registration');
    await registration.update();
    const worker = registration.installing ?? registration.waiting;
    if (!worker) return { state: registration.active?.state ?? null, changed: false };
    const state = await new Promise((resolveState, rejectState) => {
      const timeout = setTimeout(() => rejectState(new Error(`worker update timed out in ${worker.state}`)), 20_000);
      const finish = () => {
        if (worker.state !== 'activated' && worker.state !== 'redundant') return;
        clearTimeout(timeout);
        resolveState(worker.state);
      };
      worker.addEventListener('statechange', finish);
      finish();
    });
    return { state, changed: true };
  });
}

async function cacheKeys(page) {
  return page.evaluate(() => caches.keys());
}

test('deployed v4 controlled session survives failed v6 install, then upgrades atomically and reopens v6 offline', async ({ page, context, browserName }) => {
  test.setTimeout(90_000);
  const fixture = await createUpgradeServer();
  await context.clearPermissions();
  await stubThirdPartyMapTiles(page);

  try {
    await page.goto(`${fixture.origin}/`);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('./sw.js', { scope: './' });
      await navigator.serviceWorker.ready;
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#prior-shell')).toHaveText('Bergpark deployed v4 controlled session');
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

    const seeded = await page.evaluate(async () => {
      const tile = new Request(`${location.origin}/visited-tile-fixture.png`);
      const cache = await caches.open('bergpark-tiles-v1');
      await cache.put(tile, new Response('visited-before-upgrade', { status: 200 }));
      return { cacheKeys: await caches.keys(), tileUrl: tile.url };
    });
    expect(seeded.cacheKeys).toContain('bergpark-shell-v4');
    expect(seeded.cacheKeys).toContain('bergpark-tiles-v1');

    fixture.setMode('candidate-fail');
    const failedUpdate = await updateRegistration(page);
    expect(failedUpdate.changed).toBe(true);
    expect(failedUpdate.state).toBe('redundant');
    expect(await cacheKeys(page)).toContain('bergpark-shell-v4');
    expect(await cacheKeys(page)).toContain('bergpark-tiles-v1');

    if (browserName === 'chromium') {
      await context.setOffline(true);
      try {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.locator('#prior-shell')).toHaveText('Bergpark deployed v4 controlled session');
      } finally {
        await context.setOffline(false);
      }
    }

    fixture.setMode('candidate');
    const successfulUpdate = await updateRegistration(page);
    expect(successfulUpdate.changed).toBe(true);
    expect(successfulUpdate.state).toBe('activated');
    await expect.poll(async () => (await cacheKeys(page)).includes('bergpark-shell-v6')).toBe(true);
    await expect.poll(async () => (await cacheKeys(page)).includes('bergpark-shell-v4')).toBe(false);
    expect(await cacheKeys(page)).toContain('bergpark-tiles-v1');

    const upgradedCache = await page.evaluate(async ({ tileUrl }) => {
      const shell = await caches.open('bergpark-shell-v6');
      const tileCache = await caches.open('bergpark-tiles-v1');
      return {
        warmedPaths: (await shell.keys()).map((request) => new URL(request.url).pathname),
        retainedTile: await (await tileCache.match(tileUrl))?.text(),
      };
    }, { tileUrl: seeded.tileUrl });
    expect(upgradedCache.warmedPaths).toContain('/data/runtime-manifest.json');
    expect(upgradedCache.warmedPaths).toContain('/data/nodes.json');
    expect(upgradedCache.warmedPaths).toContain('/data/walking-network.json');
    expect(upgradedCache.retainedTile).toBe('visited-before-upgrade');

    const dataContract = await page.evaluate(async () => {
      const runtime = await fetch('./data/runtime-manifest.json');
      const nodes = await fetch('./data/nodes.json');
      const invalid = await fetch('./data/html-fallback.json');
      return {
        runtime: { status: runtime.status, contentType: runtime.headers.get('content-type'), body: await runtime.json() },
        nodes: { status: nodes.status, contentType: nodes.headers.get('content-type') },
        invalid: { status: invalid.status, contentType: invalid.headers.get('content-type'), body: await invalid.json() },
      };
    });
    expect(dataContract.runtime.status).toBe(200);
    expect(dataContract.runtime.contentType).toContain('application/json');
    expect(dataContract.runtime.body.contract).toBe('bergpark-runtime-data');
    expect(dataContract.runtime.body.contract_version).toBe(1);
    expect(dataContract.nodes.status).toBe(200);
    expect(dataContract.nodes.contentType).toContain('application/json');
    expect(dataContract.invalid.status).toBe(502);
    expect(dataContract.invalid.contentType).toContain('application/json');
    expect(dataContract.invalid.body.error).toBe('invalid_data_content_type');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bergpark Wilhelmshöhe');
    await expect(page.locator('#map')).toHaveClass(/leaflet-container/);
    const geolocationState = await page.evaluate(async () => (await navigator.permissions.query({ name: 'geolocation' })).state);
    expect(geolocationState).not.toBe('granted');
    await page.getByRole('button', { name: 'Bäume' }).click();
    await expect(page.locator('[data-tree-id]').first()).toBeVisible();

    const installability = await page.evaluate(async () => {
      const manifestLink = document.querySelector('link[rel="manifest"]');
      const manifest = await fetch(manifestLink.href).then((response) => response.json());
      return { manifest, controlled: Boolean(navigator.serviceWorker.controller) };
    });
    expect(installability.controlled).toBe(true);
    expect(installability.manifest.start_url).toBe('./');
    expect(installability.manifest.scope).toBe('./');
    expect(installability.manifest.display).toBe('standalone');

    if (browserName === 'chromium') {
      await context.setOffline(true);
      try {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bergpark Wilhelmshöhe');
        await expect(page.locator('#map')).toHaveClass(/leaflet-container/);
        const missing = await page.evaluate(async () => {
          const response = await fetch('./data/not-shipped.json');
          return {
            status: response.status,
            contentType: response.headers.get('content-type'),
            body: await response.json(),
          };
        });
        expect(missing.status).toBe(503);
        expect(missing.contentType).toContain('application/json');
        expect(missing.body.error).toBe('offline_data_unavailable');
      } finally {
        await context.setOffline(false);
      }
    }
  } finally {
    await context.setOffline(false).catch(() => {});
    await fixture.close();
  }
});
