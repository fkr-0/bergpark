import { expect, test } from '@playwright/test';
import { stubThirdPartyMapTiles } from './test-support.js';

async function openGuide(page, fragment = '') {
  await stubThirdPartyMapTiles(page);
  await page.goto(`/${fragment}`);
  await expect(page.locator('#map')).toHaveAttribute('data-spatial-renderer', 'leaflet');
  await expect(page.locator('#renderer-switch')).toHaveAttribute('data-renderer', 'leaflet');
}

test('same-session renderer switching preserves landmark selection, route elevation and canonical identity', async ({ page }) => {
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
  await expect(page.locator('[data-route-profile]')).toContainText(/DGM1|Höhenprofil|Elevation profile/);
  await expect(page.locator('[data-route-profile]')).toContainText(/Anstieg|ascent/i);

  await switchButton.click();
  await expect(map).toHaveAttribute('data-spatial-renderer', 'leaflet', { timeout: 10_000 });
  await expect(map.locator('.maplibregl-canvas')).toHaveCount(0);
  await expect(switchButton).toHaveAttribute('data-renderer', 'leaflet');
  await expect(page.locator('#detail-sheet [data-route-profile]')).toBeVisible();
  await expect(page.locator('#detail-sheet h2')).toContainText(/Herkules|Hercules/);
  await expect(page).toHaveURL(/#place=herkules$/);
  await expect(map).toHaveClass(/leaflet-container/);

  await page.locator('[data-action="close-route"]').click();
  await expect(page.locator('#detail-sheet h2')).toContainText(/Herkules|Hercules/);

  await page.goto('/?renderer=terrain#place=herkules');
  await expect(map).toHaveAttribute('data-spatial-renderer', 'terrain');
  await expect(page.locator('#detail-sheet h2')).toContainText(/Herkules|Hercules/);

  await switchButton.click();
  await expect(map).toHaveAttribute('data-spatial-renderer', 'leaflet');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.context().setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(map).toHaveClass(/leaflet-container/);
    await expect(page.locator('#detail-sheet')).toBeVisible();
    await expect(page.locator('#detail-sheet h2')).toContainText(/Herkules|Hercules/);
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
