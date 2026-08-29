import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { captureRuntimeErrors, stubThirdPartyMapTiles } from './test-support.js';

async function openSharedDepthGuide(page, fragment = '#place=aquaedukt') {
  await stubThirdPartyMapTiles(page);
  await page.goto(`/?renderer=terrain${fragment}`);
  const map = page.locator('#map');
  await expect(map).toHaveAttribute('data-spatial-renderer', 'terrain');
  await expect(map).toHaveAttribute('data-spatial-heritage-id', 'aquaedukt');
  return map;
}

test('Aquaedukt is genuinely drawn through one shared-depth MapLibre custom layer with canonical deep-link identity', async ({ page }) => {
  const errors = captureRuntimeErrors(page);
  const map = await openSharedDepthGuide(page);

  await expect(map).toHaveAttribute('data-spatial-heritage-layer', 'terrain-heritage-aquaedukt');
  await expect(map).toHaveAttribute('data-spatial-heritage-depth', 'shared');
  await expect(map).toHaveAttribute('data-spatial-heritage-animation', 'none');
  await expect(map).toHaveAttribute('data-spatial-heritage-display-offset-m', '0.35');
  await expect(map).toHaveAttribute('data-spatial-heritage-model-metres-per-unit', '1');
  await expect(map).toHaveAttribute('data-spatial-heritage-state', 'ready', { timeout: 15_000 });
  await expect(map).toHaveAttribute('data-spatial-heritage-rendered', 'true', { timeout: 15_000 });
  await expect(map).toHaveAttribute('data-spatial-heritage-model-source', 'gltf');

  const bytes = Number(await map.getAttribute('data-spatial-heritage-model-bytes'));
  const triangles = Number(await map.getAttribute('data-spatial-heritage-model-triangles'));
  expect(bytes).toBeGreaterThan(0);
  expect(bytes).toBeLessThanOrEqual(5 * 1024 * 1024);
  expect(triangles).toBeGreaterThan(0);
  expect(triangles).toBeLessThanOrEqual(180_000);

  await expect(page.locator('.maplibregl-canvas')).toHaveCount(1);
  await expect(page.locator('.maplibre-place-marker[data-place-id="aquaedukt"]')).toBeVisible();
  await expect(page.locator('#detail-sheet')).toBeVisible();
  await expect(page.locator('#detail-sheet h2')).toContainText(/Aquädukt|Aqueduct/);
  await expect(page).toHaveURL(/\?renderer=terrain#place=aquaedukt$/);
  expect(errors.filter((error) => !/Failed to load resource/.test(error))).toEqual([]);
});

test('shared-depth integration failure removes itself while the terrain map and canonical detail remain usable', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  await stubThirdPartyMapTiles(page);
  await page.route('**/models/aquaedukt-schematic.gltf', (route) => route.fulfill({
    status: 503,
    contentType: 'text/plain',
    body: 'fixture model unavailable',
  }));
  await page.goto('/?renderer=terrain#place=aquaedukt');

  const map = page.locator('#map');
  await expect(map).toHaveAttribute('data-spatial-renderer', 'terrain');
  await expect(map).toHaveAttribute('data-spatial-heritage-state', 'unavailable', { timeout: 15_000 });
  await expect(map).toHaveAttribute('data-spatial-heritage-error', /3D model request failed: 503/);
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await expect(page.locator('#detail-sheet')).toBeVisible();
  await expect(page).toHaveURL(/#place=aquaedukt$/);
  await context.close();
});

test('shared loader blocks secondary-resource network escape in terrain mode', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  await stubThirdPartyMapTiles(page);
  const fixtureUrl = new URL('../../public/models/aquaedukt-schematic.gltf', import.meta.url);
  const malicious = JSON.parse(await readFile(fixtureUrl, 'utf8'));
  malicious.buffers[0].uri = 'https://example.invalid/unbounded-buffer.bin';
  let escapedRequests = 0;
  page.on('request', (request) => {
    if (request.url().startsWith('https://example.invalid/')) escapedRequests += 1;
  });
  await page.route('**/models/aquaedukt-schematic.gltf', (route) => route.fulfill({
    status: 200,
    contentType: 'model/gltf+json',
    body: JSON.stringify(malicious),
  }));

  await page.goto('/?renderer=terrain#place=aquaedukt');
  const map = page.locator('#map');
  await expect(map).toHaveAttribute('data-spatial-heritage-state', 'unavailable', { timeout: 15_000 });
  await expect(map).toHaveAttribute('data-spatial-heritage-error', /embed all secondary buffers and textures/);
  expect(escapedRequests).toBe(0);
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await expect(page.locator('#detail-sheet')).toBeVisible();
  await context.close();
});

test('WebGL context loss disposes the shared layer and restoration rebuilds it without losing canonical selection', async ({ page }) => {
  const map = await openSharedDepthGuide(page);
  await expect(map).toHaveAttribute('data-spatial-heritage-rendered', 'true', { timeout: 15_000 });

  const canLoseContext = await page.evaluate(() => {
    const canvas = document.querySelector('.maplibregl-canvas');
    const gl = canvas?.getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_lose_context');
    if (!extension) return false;
    window.__bergparkLoseContext = extension;
    extension.loseContext();
    return true;
  });
  expect(canLoseContext).toBe(true);
  await expect(map).toHaveAttribute('data-spatial-heritage-state', 'context-lost', { timeout: 10_000 });

  await page.evaluate(() => window.__bergparkLoseContext.restoreContext());
  await expect(map).toHaveAttribute('data-spatial-heritage-state', 'ready', { timeout: 15_000 });
  await expect(map).toHaveAttribute('data-spatial-heritage-rendered', 'true', { timeout: 15_000 });
  await expect(map).toHaveAttribute('data-spatial-renderer', 'terrain');
  await expect(page.locator('#detail-sheet')).toBeVisible();
  await expect(page).toHaveURL(/#place=aquaedukt$/);
});

test('reduced motion keeps the terrain heritage object static and Leaflet remains the untouched default/modal fallback', async ({ browser }) => {
  const terrainContext = await browser.newContext({ reducedMotion: 'reduce', serviceWorkers: 'block' });
  const terrainPage = await terrainContext.newPage();
  const terrainMap = await openSharedDepthGuide(terrainPage);
  await expect(terrainMap).toHaveAttribute('data-spatial-heritage-state', 'ready', { timeout: 15_000 });
  await expect(terrainMap).toHaveAttribute('data-spatial-heritage-rendered', 'true');
  await expect(terrainMap).toHaveAttribute('data-spatial-heritage-animation', 'none');
  await terrainContext.close();

  const leafletContext = await browser.newContext({ reducedMotion: 'reduce', serviceWorkers: 'block' });
  const leafletPage = await leafletContext.newPage();
  await stubThirdPartyMapTiles(leafletPage);
  await leafletPage.goto('/#place=aquaedukt');
  const leafletMap = leafletPage.locator('#map');
  await expect(leafletMap).toHaveAttribute('data-spatial-renderer', 'leaflet');
  await expect(leafletMap).toHaveAttribute('data-spatial-preference', 'auto');
  await expect(leafletMap).toHaveClass(/leaflet-container/);
  await expect(leafletPage.locator('.maplibregl-canvas')).toHaveCount(0);

  const launch = leafletPage.locator('[data-model-launch]');
  await expect(launch).toBeVisible();
  await launch.click();
  const viewer = leafletPage.locator('.landmark-model-viewer');
  await expect(viewer).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });
  await expect(viewer).toHaveAttribute('data-model-source', 'gltf');
  await expect(viewer.locator('[data-model-rotate]')).toHaveAttribute('aria-pressed', 'false');
  await leafletContext.close();
});
