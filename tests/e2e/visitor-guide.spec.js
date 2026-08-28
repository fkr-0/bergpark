import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { stubThirdPartyMapTiles } from './test-support.js';

async function openVisitorGuide(page, path = '/') {
  await page.goto(path);
  await expect(page.locator('#map')).toHaveClass(/leaflet-container/);
  await expect(page.locator('.bergpark-marker').first()).toBeVisible();
  await expect(page.locator('#map-status')).not.toContainText(/geladen|loading/i);
}

test.beforeEach(async ({ page }) => {
  // The E2E contract is the Bergpark application. Third-party map tile availability
  // must not make the release gate flaky or turn the test suite into a tile crawler.
  await stubThirdPartyMapTiles(page);
});

test('visitor can switch language, search the index, open a place and show a route', async ({ page }) => {
  await openVisitorGuide(page);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bergpark Wilhelmshöhe');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');

  await page.locator('#language').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#map-status')).toContainText('Tap a place');

  await page.getByRole('button', { name: 'Index' }).click();
  const search = page.getByPlaceholder('Place, person, tree, visitor feature …');
  await expect(search).toBeVisible();
  await search.fill('Hercules');

  const hercules = page.locator('[data-node-id="herkules"]');
  await expect(hercules).toBeVisible();
  await hercules.click();

  await expect(page.locator('#detail-sheet')).toBeVisible();
  await expect(page.locator('#detail-sheet h2')).toContainText(/Hercules|Herkules/);
  await expect(page).toHaveURL(/#place=herkules$/);

  const firstRoute = page.locator('#detail-sheet [data-route-to]').first();
  await expect(firstRoute).toBeVisible();
  await firstRoute.click();
  // The map intentionally uses Leaflet's Canvas renderer, so route polylines do
  // not have a stable DOM element. A positive distance/time status is emitted
  // only after the graph edge resolves and mapController.showRoute succeeds.
  await expect(page.locator('#map-status')).toContainText(/m · .*min/i);
});

test('selected landmark lazily mounts a real interactive 3D scene with accessible controls', async ({ page }) => {
  await openVisitorGuide(page, '/#place=herkules');
  await expect(page.locator('#detail-sheet')).toBeVisible();

  const launch = page.locator('[data-model-launch]');
  await expect(launch).toBeVisible();
  await expect(launch).toHaveAttribute('data-node-id', 'herkules');
  await expect(page.locator('.landmark-model-viewer')).toHaveCount(0);

  const had3dChunkBefore = await page.evaluate(() => performance.getEntriesByType('resource').some(({ name }) => /model-viewer|three/i.test(name)));
  expect(had3dChunkBefore).toBe(false);

  await launch.click();
  const viewer = page.locator('.landmark-model-viewer');
  await expect(viewer).toBeVisible();
  await expect(viewer).toHaveAttribute('data-model-asset', 'hercules');
  await expect(viewer).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });
  await expect(viewer).toHaveAttribute('data-model-source', 'procedural');
  await expect(viewer.locator('[data-model-canvas]')).toBeVisible();
  await expect(viewer.locator('[data-model-close]')).toBeFocused();

  const triangles = Number(await viewer.getAttribute('data-model-triangles'));
  expect(triangles).toBeGreaterThan(0);
  expect(triangles).toBeLessThan(180_000);

  const loaded3dChunk = await page.evaluate(() => performance.getEntriesByType('resource').some(({ name }) => /model-viewer|three/i.test(name)));
  expect(loaded3dChunk).toBe(true);

  const canvas = viewer.locator('[data-model-canvas]');
  const box = await canvas.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(250);
  expect(box?.height ?? 0).toBeGreaterThan(200);
  if (box) {
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.42, { steps: 5 });
    await page.mouse.up();
  }
  await expect(viewer).toHaveAttribute('data-pointer-interactions', '1');

  const close = viewer.locator('[data-model-close]');
  const rotate = viewer.locator('[data-model-rotate]');
  const reset = viewer.locator('[data-model-reset]');
  await close.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(reset).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();

  const rotatingBefore = await rotate.getAttribute('aria-pressed');
  await rotate.click();
  await expect(rotate).toHaveAttribute('aria-pressed', rotatingBefore === 'true' ? 'false' : 'true');
  await reset.click();

  const scan = await new AxeBuilder({ page }).include('.landmark-model-viewer').analyze();
  const blocking = scan.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
  expect(blocking, blocking.map((violation) => `${violation.id}: ${violation.help}`).join('\n')).toEqual([]);

  await viewer.locator('[data-model-close]').click();
  await expect(viewer).toHaveCount(0);
  await expect(launch).toBeFocused();
});

test('all built-in schematic landmark scenes mount through the same viewer contract', async ({ page }) => {
  const fixtures = [
    ['schloss', 'wilhelmshoehe-palace'],
    ['loewenburg', 'loewenburg'],
    ['grosse-fontaene', 'great-fountain'],
  ];

  for (const [id, assetId] of fixtures) {
    await openVisitorGuide(page, `/?model=${encodeURIComponent(id)}#place=${encodeURIComponent(id)}`);
    const launch = page.locator('[data-model-launch]');
    await expect(launch).toBeVisible();
    await expect(launch).toHaveAttribute('data-node-id', id);
    await launch.click();
    const viewer = page.locator('.landmark-model-viewer');
    await expect(viewer).toHaveAttribute('data-model-asset', assetId);
    await expect(viewer).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });
    await expect(viewer).toHaveAttribute('data-model-source', 'procedural');
    await viewer.locator('[data-model-close]').click();
    await expect(viewer).toHaveCount(0);
  }
});

test('same-origin glTF landmark asset loads through bounded production loader path', async ({ page }) => {
  await openVisitorGuide(page, '/#place=aquaedukt');
  const launch = page.locator('[data-model-launch]');
  await expect(launch).toBeVisible();
  await launch.click();

  const viewer = page.locator('.landmark-model-viewer');
  await expect(viewer).toHaveAttribute('data-model-asset', 'aqueduct-gltf-v1');
  await expect(viewer).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });
  await expect(viewer).toHaveAttribute('data-model-source', 'gltf');
  const bytes = Number(await viewer.getAttribute('data-model-bytes'));
  const triangles = Number(await viewer.getAttribute('data-model-triangles'));
  expect(bytes).toBeGreaterThan(0);
  expect(bytes).toBeLessThanOrEqual(5 * 1024 * 1024);
  expect(triangles).toBeGreaterThan(0);
  expect(triangles).toBeLessThan(180_000);
  await expect(viewer.locator('[data-model-canvas]')).toBeVisible();
});

test('glTF loader rejects non-embedded secondary resources before network escape', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  await stubThirdPartyMapTiles(page);

  const fixtureUrl = new URL('../../public/models/aquaedukt-schematic.gltf', import.meta.url);
  const malicious = JSON.parse(await readFile(fixtureUrl, 'utf8'));
  malicious.buffers[0].uri = 'https://example.invalid/unbounded-buffer.bin';
  await page.route('**/models/aquaedukt-schematic.gltf', (route) => route.fulfill({
    status: 200,
    contentType: 'model/gltf+json',
    body: JSON.stringify(malicious),
  }));

  await openVisitorGuide(page, '/#place=aquaedukt');
  await page.locator('[data-model-launch]').click();
  const viewer = page.locator('.landmark-model-viewer');
  await expect(viewer).toHaveAttribute('data-state', 'fallback', { timeout: 15_000 });
  await expect(viewer).toHaveAttribute('data-model-error', /embed all secondary buffers and textures/);
  await expect(viewer.locator('[data-model-fallback]')).toBeVisible();
  await context.close();
});

test('3D viewer fails closed to an accessible fallback when WebGL is unavailable', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function patchedGetContext(type, ...args) {
      if (['webgl', 'webgl2', 'experimental-webgl'].includes(type)) return null;
      return original.call(this, type, ...args);
    };
  });
  await stubThirdPartyMapTiles(page);

  await openVisitorGuide(page, '/#place=herkules');
  await page.locator('[data-model-launch]').click();
  const viewer = page.locator('.landmark-model-viewer');
  await expect(viewer).toHaveAttribute('data-state', 'fallback');
  await expect(viewer.locator('[data-model-fallback]')).toBeVisible();
  await expect(viewer.locator('[data-model-canvas]')).toBeHidden();
  await expect(page.locator('#detail-sheet')).toBeVisible();
  await context.close();
});

test('warmed 3D runtime and glTF asset reopen offline through the service-worker cache', async ({ page, context }) => {
  await openVisitorGuide(page, '/#place=aquaedukt');
  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) throw new Error('service worker API unavailable');
    await navigator.serviceWorker.ready;
  });

  const launch = page.locator('[data-model-launch]');
  await launch.click();
  let viewer = page.locator('.landmark-model-viewer');
  await expect(viewer).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });
  await expect(viewer).toHaveAttribute('data-model-source', 'gltf');
  await viewer.locator('[data-model-close]').click();

  // Reload online once under service-worker control, then prove both code-split
  // Three.js chunks and the viewed glTF asset can be recovered from the cache.
  await page.reload();
  await expect(page.locator('[data-model-launch]')).toBeVisible();
  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-model-launch]')).toBeVisible();
    await page.locator('[data-model-launch]').click();
    viewer = page.locator('.landmark-model-viewer');
    await expect(viewer).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });
    await expect(viewer).toHaveAttribute('data-model-source', 'gltf');
  } finally {
    await context.setOffline(false);
  }
});

test('deep link restores a place detail and primary UI has no serious axe findings', async ({ page }) => {
  await openVisitorGuide(page, '/#place=herkules');
  await expect(page.locator('#detail-sheet')).toBeVisible();
  await expect(page.locator('#detail-sheet h2')).toContainText(/Herkules|Hercules/);

  const scan = await new AxeBuilder({ page }).analyze();
  const blocking = scan.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
  expect(blocking, blocking.map((violation) => `${violation.id}: ${violation.help}`).join('\n')).toEqual([]);
});

test('installed service worker keeps the warmed application usable offline', async ({ page, context }) => {
  await openVisitorGuide(page);

  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) throw new Error('service worker API unavailable');
    await navigator.serviceWorker.ready;
  });

  // Reload once under service-worker control so hashed Vite assets join the
  // runtime cache before the offline qualification.
  await page.reload();
  await expect(page.locator('#map')).toHaveClass(/leaflet-container/);

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bergpark Wilhelmshöhe');
    await expect(page.locator('#map')).toHaveClass(/leaflet-container/);
    await expect(page.locator('.bergpark-marker').first()).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
