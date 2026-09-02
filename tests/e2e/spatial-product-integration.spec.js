import { expect, test } from '@playwright/test';
import { stubThirdPartyMapTiles } from './test-support.js';

test.beforeEach(() => {
  test.setTimeout(60_000);
});

async function openGuide(page, fragment = '') {
  await stubThirdPartyMapTiles(page);
  await page.goto(`/${fragment}`);
  await expect(page.locator('#map')).toHaveAttribute('data-spatial-renderer', 'leaflet');
  await expect(page.locator('#renderer-switch')).toHaveAttribute('data-renderer', 'leaflet');
}

test('same-session renderer switching preserves landmark selection and DGM1 route evidence', async ({ page }) => {
  await openGuide(page, '#place=herkules');

  const map = page.locator('#map');
  const switchButton = page.locator('#renderer-switch');
  await expect(page.locator('#detail-sheet')).toBeVisible();
  await expect(page).toHaveURL(/#place=herkules$/);

  await switchButton.click();
  await expect(map).toHaveAttribute('data-spatial-renderer', 'terrain', { timeout: 15_000 });
  await expect(map.locator('.maplibregl-canvas')).toHaveCount(1);
  await expect(switchButton).toHaveAttribute('data-renderer', 'terrain');
  await expect(page.locator('#detail-sheet h2')).toContainText(/Herkules|Hercules/);
  await expect(page).toHaveURL(/\?renderer=terrain#place=herkules$/);

  const directRoute = page.locator('#detail-sheet [data-route-to]').first();
  await expect(directRoute).toBeVisible();
  await directRoute.click();
  await expect(page.locator('[data-route-profile]')).toContainText(/DGM1|Höhenprofil|Elevation profile/, { timeout: 15_000 });
  await expect(page.locator('[data-route-profile]')).toContainText(/Anstieg|ascent/i, { timeout: 15_000 });

  await switchButton.click();
  await expect(map).toHaveAttribute('data-spatial-renderer', 'leaflet', { timeout: 10_000 });
  await expect(map.locator('.maplibregl-canvas')).toHaveCount(0);
  await expect(switchButton).toHaveAttribute('data-renderer', 'leaflet');
  await expect(page.locator('#detail-sheet [data-route-profile]')).toBeVisible();
  await expect(page.locator('#detail-sheet h2')).toContainText(/Herkules|Hercules/);
  await expect(page).toHaveURL(/#place=herkules$/);
  await expect(map).toHaveClass(/leaflet-container/);
});

test('terrain deep link returns to warmed Leaflet and reopens offline without losing canonical identity', async ({ page }) => {
  await openGuide(page, '#place=herkules');
  const map = page.locator('#map');
  const switchButton = page.locator('#renderer-switch');

  await page.goto('/?renderer=terrain#place=herkules');
  await expect(map).toHaveAttribute('data-spatial-renderer', 'terrain', { timeout: 15_000 });
  await expect(page.locator('#detail-sheet h2')).toContainText(/Herkules|Hercules/);
  await expect(page).toHaveURL(/\?renderer=terrain#place=herkules$/);

  await switchButton.click();
  await expect(map).toHaveAttribute('data-spatial-renderer', 'leaflet', { timeout: 10_000 });
  await expect(page).toHaveURL(/#place=herkules$/);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(map).toHaveClass(/leaflet-container/);
  await expect(page.locator('#detail-sheet h2')).toContainText(/Herkules|Hercules/);

  await page.context().setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(map).toHaveClass(/leaflet-container/);
    await expect(page.locator('#detail-sheet')).toBeVisible();
    await expect(page.locator('#detail-sheet h2')).toContainText(/Herkules|Hercules/);
    await expect(page).toHaveURL(/#place=herkules$/);
  } finally {
    await page.context().setOffline(false);
  }
});

test('terrain initialization and shared-depth model failure recover without losing canonical content', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  await openGuide(page, '#place=aquaedukt');
  const map = page.locator('#map');
  const switchButton = page.locator('#renderer-switch');

  await page.route('**/terrain/dgm1-terrarium/manifest.json', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'fixture-terrain-unavailable' }),
  }));
  await switchButton.click();
  await expect(map).toHaveAttribute('data-spatial-renderer', 'leaflet', { timeout: 10_000 });
  await expect(map).toHaveAttribute('data-spatial-preference', 'auto');
  await expect(page.locator('#detail-sheet h2')).toContainText(/Aquädukt|Aqueduct/);

  await page.unroute('**/terrain/dgm1-terrarium/manifest.json');
  await page.goto('/?renderer=terrain#place=aquaedukt');
  await expect(map).toHaveAttribute('data-spatial-renderer', 'terrain', { timeout: 15_000 });
  await expect(page.locator('#detail-sheet h2')).toContainText(/Aquädukt|Aqueduct/);

  await page.route('**/models/aquaedukt-schematic.gltf', (route) => route.fulfill({
    status: 503,
    contentType: 'text/plain',
    body: 'fixture model unavailable',
  }));
  await page.reload();
  await expect(map).toHaveAttribute('data-spatial-renderer', 'terrain', { timeout: 15_000 });
  await expect(map).toHaveAttribute('data-spatial-heritage-state', 'unavailable', { timeout: 15_000 });
  await expect(page.locator('#detail-sheet h2')).toContainText(/Aquädukt|Aqueduct/);
  await page.unroute('**/models/aquaedukt-schematic.gltf');

  await page.reload();
  await expect(map).toHaveAttribute('data-spatial-renderer', 'terrain', { timeout: 15_000 });
  await expect(map).toHaveAttribute('data-spatial-heritage-state', 'ready', { timeout: 15_000 });
  await expect(map).toHaveAttribute('data-spatial-heritage-rendered', 'true', { timeout: 15_000 });

  await switchButton.click();
  await expect(map).toHaveAttribute('data-spatial-renderer', 'leaflet');
  await expect(page).toHaveURL(/#place=aquaedukt$/);
  await context.close();
});


test('unavailable WebGL2 makes an explicit 3D request visible and restores canonical 2D state', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(kind, ...args) {
      if (kind === 'webgl2') return null;
      return original.call(this, kind, ...args);
    };
  });
  await stubThirdPartyMapTiles(page);
  await page.goto('/#place=herkules');
  const map = page.locator('#map');
  const switchButton = page.locator('#renderer-switch');
  await expect(map).toHaveAttribute('data-spatial-renderer', 'leaflet');
  await switchButton.click();
  await expect(map).toHaveAttribute('data-spatial-renderer', 'leaflet');
  await expect(map).toHaveAttribute('data-spatial-fallback-reason', 'webgl2-unavailable');
  await expect(switchButton).toHaveAttribute('data-fallback-reason', 'webgl2-unavailable');
  await expect(switchButton).toBeEnabled();
  await expect(page.locator('#map-status')).toContainText(/WebGL2|3D terrain|3D-Gelände/);
  await expect(page).toHaveURL(/#place=herkules$/);
  await expect(page).not.toHaveURL(/renderer=terrain/);
  await context.close();
});
