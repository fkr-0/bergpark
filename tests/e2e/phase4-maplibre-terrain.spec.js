import { expect, test } from '@playwright/test';
import { captureRuntimeErrors, stubThirdPartyMapTiles } from './test-support.js';

async function openTerrainGuide(page, fragment = '') {
  await stubThirdPartyMapTiles(page);
  await page.goto(`/?renderer=terrain${fragment}`);
  await expect(page.locator('#map')).toHaveAttribute('data-spatial-preference', 'terrain');
  await expect(page.locator('#map')).toHaveAttribute('data-spatial-renderer', 'terrain');
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await expect(page.locator('.maplibre-place-marker').first()).toBeVisible();
}

test('explicit terrain preference mounts bounded MapLibre terrain while Leaflet remains the default path', async ({ page }) => {
  const errors = captureRuntimeErrors(page);
  await openTerrainGuide(page);

  const map = page.locator('#map');
  await expect(map).toHaveAttribute('data-terrain-encoding', 'terrarium');
  await expect(map).toHaveAttribute('data-terrain-tile-count', '56');
  await expect(map).toHaveAttribute('data-terrain-zooms', '14,15,16');
  await expect(map).toHaveAttribute('data-terrain-vertical-units', 'metres');
  await expect(map).toHaveAttribute('data-terrain-exaggeration', '1');
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText(/HVBG/);
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText(/dl-zero-de\/2\.0/);
  await expect(page.locator('#map')).not.toHaveClass(/leaflet-container/);
  expect(errors.filter((error) => !/Failed to load resource/.test(error))).toEqual([]);

  await page.getByRole('button', { name: 'Index' }).click();
  const search = page.getByRole('searchbox', { name: 'Ziele durchsuchen' });
  await search.fill('Herkules');
  await page.locator('[data-destination-kind="place"][data-node-id="herkules"]').click();
  await page.locator('#detail-sheet [data-route-to]').first().click();
  await expect(page.locator('#map-status')).toContainText(/m · .*min/i);
  await expect(page.locator('#map')).toHaveAttribute('data-spatial-renderer', 'terrain');

  await page.goto('/');
  await expect(page.locator('#map')).toHaveAttribute('data-spatial-renderer', 'leaflet');
  await expect(page.locator('#map')).toHaveAttribute('data-spatial-preference', 'auto');
  await expect(page.locator('#map')).toHaveClass(/leaflet-container/);
  const loadedMapLibre = await page.evaluate(() => performance.getEntriesByType('resource')
    .some(({ name }) => /maplibre-(?:map|gl)/.test(name)));
  expect(loadedMapLibre).toBe(false);
});

test('place, tree and visitor deep links retain identity through the MapLibre controller boundary', async ({ page }) => {
  await openTerrainGuide(page, '#place=herkules');
  await expect(page.locator('#detail-sheet')).toBeVisible();
  await expect(page.locator('#detail-sheet h2')).toContainText(/Herkules|Hercules/);
  await expect(page).toHaveURL(/\?renderer=terrain#place=herkules$/);

  await page.goto('/?renderer=terrain#tree=tree-5702751554');
  await expect(page.locator('#map')).toHaveAttribute('data-spatial-renderer', 'terrain');
  await expect(page.locator('#map')).toHaveAttribute('data-supplemental-data', 'ready');
  await expect(page.locator('[data-action="close-tree"]')).toBeVisible();
  await expect(page).toHaveURL(/#tree=tree-5702751554$/);

  await page.goto('/?renderer=terrain#feature=bench-45387376');
  await expect(page.locator('#map')).toHaveAttribute('data-spatial-renderer', 'terrain');
  await expect(page.locator('#map')).toHaveAttribute('data-supplemental-data', 'ready');
  await expect(page.locator('[data-action="close-visitor-feature"]')).toBeVisible();
  await expect(page).toHaveURL(/#feature=bench-45387376$/);
});

test('supplemental tree and visitor layers stay controller-owned on the terrain renderer', async ({ page }) => {
  await openTerrainGuide(page);
  await page.getByRole('button', { name: 'Bäume' }).click();
  await expect(page.locator('#map')).toHaveAttribute('data-supplemental-data', 'ready');
  await expect.poll(async () => page.locator('#map').evaluate((element) => element.dataset.spatialRenderer)).toBe('terrain');

  await page.getByRole('button', { name: 'Karte' }).click();
  await page.locator('#visitor-layer-control summary').click();
  const benchToggle = page.locator('#visitor-layer-control input[value="bench"]');
  await benchToggle.check();
  await expect(benchToggle).toBeChecked();
  await page.locator('#language').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#map')).toHaveAttribute('data-spatial-renderer', 'terrain');
});

test('WebGL2 capability failure preserves the explicit terrain preference but falls back to Leaflet', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function patchedGetContext(type, ...args) {
      if (type === 'webgl2') return null;
      return original.call(this, type, ...args);
    };
  });
  await stubThirdPartyMapTiles(page);
  await page.goto('/?renderer=terrain#place=herkules');

  const map = page.locator('#map');
  await expect(map).toHaveAttribute('data-spatial-renderer', 'leaflet');
  await expect(map).toHaveAttribute('data-spatial-preference', 'terrain');
  await expect(map).toHaveAttribute('data-spatial-fallback-reason', 'webgl2-unavailable');
  await expect(map).toHaveClass(/leaflet-container/);
  await expect(page.locator('#detail-sheet')).toBeVisible();
  await context.close();
});

test('GPS proximity keeps controller-owned geofence selection parity in terrain mode', async ({ browser }) => {
  const context = await browser.newContext({
    serviceWorkers: 'block',
    permissions: ['geolocation'],
    geolocation: { latitude: 51.3161018, longitude: 9.3932069, accuracy: 5 },
  });
  const page = await context.newPage();
  await stubThirdPartyMapTiles(page);
  await page.goto('/?renderer=terrain');
  await expect(page.locator('#map')).toHaveAttribute('data-spatial-renderer', 'terrain');

  await page.locator('#locate').click();
  await expect(page.locator('#detail-sheet')).toBeVisible();
  await expect(page.locator('#detail-sheet h2')).toContainText(/Herkules|Hercules/);
  await expect(page).toHaveURL(/#place=herkules$/);
  await expect(page.locator('#map')).toHaveAttribute('data-spatial-renderer', 'terrain');
  await context.close();
});

test('terrain manifest initialization failure fails closed to the production Leaflet renderer', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  await stubThirdPartyMapTiles(page);
  await page.route('**/terrain/dgm1-terrarium/manifest.json', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'fixture-terrain-unavailable' }),
  }));
  await page.goto('/?renderer=terrain#place=herkules');

  const map = page.locator('#map');
  await expect(map).toHaveAttribute('data-spatial-renderer', 'leaflet');
  await expect(map).toHaveAttribute('data-spatial-preference', 'terrain');
  await expect(map).toHaveAttribute('data-spatial-fallback-reason', 'terrain-initialization-failed');
  await expect(map).toHaveClass(/leaflet-container/);
  await expect(page.locator('#detail-sheet')).toBeVisible();
  await context.close();
});

test('terrain tile failure degrades MapLibre to a flat usable map without changing canonical identity', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  await stubThirdPartyMapTiles(page);
  await page.route('**/terrain/dgm1-terrarium/*/*/*.png', (route) => route.fulfill({
    status: 503,
    contentType: 'text/plain',
    body: 'fixture terrain tile unavailable',
  }));
  await page.goto('/?renderer=terrain#place=herkules');

  const map = page.locator('#map');
  await expect(map).toHaveAttribute('data-spatial-renderer', 'terrain');
  await expect(map).toHaveAttribute('data-spatial-terrain-state', 'flat-fallback');
  await expect(map).toHaveAttribute('data-spatial-terrain-error', 'terrain-source-unavailable');
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await expect(page.locator('#detail-sheet')).toBeVisible();
  await expect(page).toHaveURL(/#place=herkules$/);
  await context.close();
});
