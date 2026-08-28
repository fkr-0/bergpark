import { expect, test } from '@playwright/test';
import { captureRuntimeErrors, stubThirdPartyMapTiles } from './test-support.js';

async function openMobileGuide(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubThirdPartyMapTiles(page);
  await page.goto('/');
  await expect(page.locator('#map')).toHaveClass(/leaflet-container/);
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker?.controller)), { timeout: 15_000 }).toBe(true);
  await expect(page.locator('#map')).toHaveClass(/leaflet-container/);
}

test('mobile production PWA exposes a controlled installable shell and warms the complete walking projection', async ({ page }) => {
  const errors = captureRuntimeErrors(page);
  await openMobileGuide(page);

  const state = await page.evaluate(async () => {
    const manifestLink = document.querySelector('link[rel="manifest"]');
    const manifest = await fetch(manifestLink.href).then((response) => response.json());
    const registration = await navigator.serviceWorker.ready;
    const cacheKeys = await caches.keys();
    const shellRequests = await caches.open('bergpark-shell-v6').then((cache) => cache.keys());
    return {
      manifest,
      controller: Boolean(navigator.serviceWorker.controller),
      activeState: registration.active?.state,
      scope: registration.scope,
      cacheKeys,
      warmedPaths: shellRequests.map((request) => new URL(request.url).pathname),
      standalone: matchMedia('(display-mode: standalone)').matches,
    };
  });

  expect(state.controller).toBe(true);
  expect(state.activeState).toBe('activated');
  expect(state.scope).toBe(new URL('/', page.url()).href);
  expect(state.manifest.start_url).toBe('./');
  expect(state.manifest.scope).toBe('./');
  expect(state.manifest.display).toBe('standalone');
  expect(state.manifest.icons.some(({ sizes }) => sizes === '192x192')).toBe(true);
  expect(state.manifest.icons.some(({ sizes }) => sizes === '512x512')).toBe(true);
  expect(state.cacheKeys).toContain('bergpark-shell-v6');
  expect(state.warmedPaths).toContain('/data/runtime-manifest.json');
  expect(state.warmedPaths).toContain('/data/walking-network.json');
  expect(state.warmedPaths).toContain('/icons/app-icon-192.png');
  expect(state.warmedPaths).toContain('/icons/app-icon-512.png');
  expect(state.warmedPaths.some((path) => path.startsWith('/assets/'))).toBe(true);
  expect(state.standalone).toBe(false);

  await expect(page.locator('#map')).toHaveAttribute('data-walking-network-segments', '3354', { timeout: 10_000 });
  const initialResources = await page.evaluate(() => performance.getEntriesByType('resource').map(({ name }) => name));
  expect(initialResources.some((name) => /three\.module|GLTFLoader|OrbitControls/.test(name))).toBe(false);
  expect(errors).toEqual([]);
});

test('warmed mobile PWA reloads offline with shell, data, visitor layers, and walking network intact', async ({ page, context }) => {
  test.setTimeout(60_000);
  const errors = captureRuntimeErrors(page);
  await openMobileGuide(page);
  await expect(page.locator('#map')).toHaveAttribute('data-walking-network-segments', '3354', { timeout: 10_000 });
  errors.length = 0;

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bergpark Wilhelmshöhe');
    await expect(page.locator('#map')).toHaveClass(/leaflet-container/);
    await expect(page.locator('#map')).toHaveAttribute('data-walking-network-segments', '3354', { timeout: 10_000 });
    await page.locator('#visitor-layer-control summary').click();
    await expect(page.locator('#visitor-layer-control')).toContainText('Bänke');
    await page.locator('#visitor-layer-control summary').click();
    await page.getByRole('button', { name: 'Bäume' }).click();
    await expect(page.locator('[data-tree-id]').first()).toBeVisible();
    expect(errors.filter((error) => error !== 'console: Failed to load resource: net::ERR_FAILED')).toEqual([]);
    errors.length = 0;

    const missingData = await page.evaluate(async () => {
      const response = await fetch('./data/not-shipped.json');
      return {
        status: response.status,
        contentType: response.headers.get('content-type'),
        body: await response.json(),
      };
    });
    expect(missingData.status).toBe(503);
    expect(missingData.contentType).toContain('application/json');
    expect(missingData.body.error).toBe('offline_data_unavailable');
  } finally {
    await context.setOffline(false);
  }

  expect(errors.every((error) => error === 'console: Failed to load resource: the server responded with a status of 503 ()')).toBe(true);
});
