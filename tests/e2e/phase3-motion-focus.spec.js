import { expect, test } from '@playwright/test';
import { captureRuntimeErrors, stubThirdPartyMapTiles } from './test-support.js';

async function openGuide(page, { width = 390, height = 844, reducedMotion = 'no-preference' } = {}) {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ reducedMotion });
  await stubThirdPartyMapTiles(page);
  await page.goto('/');
  await expect(page.locator('#map')).toHaveClass(/leaflet-container/);
}

async function openIndex(page) {
  await page.getByRole('button', { name: 'Index' }).click();
  await expect(page.locator('#map')).toHaveAttribute('data-supplemental-data', 'ready');
  return page.getByRole('searchbox', { name: 'Ziele durchsuchen' });
}

async function instrumentCamera(page) {
  await page.evaluate(() => {
    window.__bergparkCameraCalls = [];
    const prototype = window.L.Map.prototype;
    const originalFlyTo = prototype.flyTo;
    const originalSetView = prototype.setView;
    prototype.flyTo = function patchedFlyTo(target, zoom, options) {
      window.__bergparkCameraCalls.push({ method: 'flyTo', zoom, duration: options?.duration ?? null });
      return originalFlyTo.call(this, target, zoom, options);
    };
    prototype.setView = function patchedSetView(target, zoom, options) {
      window.__bergparkCameraCalls.push({ method: 'setView', zoom, animate: options?.animate ?? null });
      return originalSetView.call(this, target, zoom, options);
    };
  });
}

async function cameraCalls(page) {
  return page.evaluate(() => window.__bergparkCameraCalls ?? []);
}

async function clearCameraCalls(page) {
  await page.evaluate(() => { window.__bergparkCameraCalls = []; });
}

test('reduced motion makes place, tree and visitor focus immediate', async ({ page }) => {
  const errors = captureRuntimeErrors(page);
  await openGuide(page, { reducedMotion: 'reduce' });
  const search = await openIndex(page);
  await instrumentCamera(page);

  await search.fill('aquadukt');
  await page.locator('[data-destination-kind="place"][data-node-id="aquaedukt"]').click();
  await expect(page.locator('[data-action="close-detail"]')).toBeFocused();
  expect(await cameraCalls(page)).toEqual(expect.arrayContaining([expect.objectContaining({ method: 'setView', animate: false })]));
  expect((await cameraCalls(page)).some(({ method }) => method === 'flyTo')).toBe(false);

  await page.locator('[data-action="close-detail"]').click();
  await clearCameraCalls(page);
  await page.getByRole('searchbox', { name: 'Ziele durchsuchen' }).fill('358');
  await page.locator('[data-destination-kind="tree"][data-tree-id="tree-5702751554"]').click();
  expect(await cameraCalls(page)).toEqual(expect.arrayContaining([expect.objectContaining({ method: 'setView', animate: false })]));
  expect((await cameraCalls(page)).some(({ method }) => method === 'flyTo')).toBe(false);

  await page.locator('[data-action="close-tree"]').click();
  await clearCameraCalls(page);
  await page.getByRole('searchbox', { name: 'Ziele durchsuchen' }).fill('45387376');
  await page.locator('[data-destination-kind="feature"][data-feature-id="bench-45387376"]').click();
  expect(await cameraCalls(page)).toEqual(expect.arrayContaining([expect.objectContaining({ method: 'setView', animate: false })]));
  expect((await cameraCalls(page)).some(({ method }) => method === 'flyTo')).toBe(false);
  expect(errors).toEqual([]);
});

test('normal motion preserves place and coordinate animation durations', async ({ page }) => {
  await openGuide(page);
  const search = await openIndex(page);
  await instrumentCamera(page);

  await search.fill('aquadukt');
  await page.locator('[data-destination-kind="place"][data-node-id="aquaedukt"]').click();
  expect(await cameraCalls(page)).toEqual(expect.arrayContaining([expect.objectContaining({ method: 'flyTo', duration: 0.6 })]));

  await page.locator('[data-action="close-detail"]').click();
  await clearCameraCalls(page);
  await page.getByRole('searchbox', { name: 'Ziele durchsuchen' }).fill('358');
  await page.locator('[data-destination-kind="tree"][data-tree-id="tree-5702751554"]').click();
  expect(await cameraCalls(page)).toEqual(expect.arrayContaining([expect.objectContaining({ method: 'flyTo', duration: 0.6 })]));

  await page.locator('[data-action="close-tree"]').click();
  await clearCameraCalls(page);
  await page.getByRole('searchbox', { name: 'Ziele durchsuchen' }).fill('45387376');
  await page.locator('[data-destination-kind="feature"][data-feature-id="bench-45387376"]').click();
  expect(await cameraCalls(page)).toEqual(expect.arrayContaining([expect.objectContaining({ method: 'flyTo', duration: 0.35 })]));
});

test('reduced motion also makes tree and visitor cluster activation immediate', async ({ page }) => {
  await openGuide(page, { reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Bäume' }).click();
  await expect(page.locator('#map')).toHaveAttribute('data-supplemental-data', 'ready');
  await instrumentCamera(page);
  const treeCluster = page.locator('.tree-map-cluster').first();
  await expect(treeCluster).toBeVisible();
  await treeCluster.focus();
  await treeCluster.press('Enter');
  expect(await cameraCalls(page)).toEqual(expect.arrayContaining([expect.objectContaining({ method: 'setView', animate: false })]));
  expect((await cameraCalls(page)).some(({ method }) => method === 'flyTo')).toBe(false);

  await page.reload();
  await expect(page.locator('#map')).toHaveClass(/leaflet-container/);
  await expect(page.locator('#map')).toHaveAttribute('data-supplemental-data', 'ready');
  await page.locator('#visitor-layer-control summary').click();
  await page.locator('#visitor-layer-control input[type="checkbox"]').first().check();
  await instrumentCamera(page);
  const visitorCluster = page.locator('.visitor-map-cluster').first();
  await expect(visitorCluster).toBeVisible();
  await visitorCluster.focus();
  await visitorCluster.press('Enter');
  expect(await cameraCalls(page)).toEqual(expect.arrayContaining([expect.objectContaining({ method: 'setView', animate: false })]));
  expect((await cameraCalls(page)).some(({ method }) => method === 'flyTo')).toBe(false);
});

test('mobile and tablet detail flows return keyboard focus to their invoking controls', async ({ page }) => {
  const errors = captureRuntimeErrors(page);
  await openGuide(page, { width: 390, height: 844 });
  const search = await openIndex(page);

  await search.fill('aquadukt');
  const place = page.locator('[data-destination-kind="place"][data-node-id="aquaedukt"]');
  await place.focus();
  await place.press('Enter');
  await expect(page.locator('[data-action="close-detail"]')).toBeFocused();
  await page.locator('[data-action="close-detail"]').press('Enter');
  await expect(place).toBeFocused();

  await page.getByRole('searchbox', { name: 'Ziele durchsuchen' }).fill('358');
  const tree = page.locator('[data-destination-kind="tree"][data-tree-id="tree-5702751554"]');
  await tree.focus();
  await tree.press('Enter');
  await expect(page.locator('[data-action="close-tree"]')).toBeFocused();
  await page.locator('[data-action="close-tree"]').press('Enter');
  await expect(tree).toBeFocused();

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.getByRole('searchbox', { name: 'Ziele durchsuchen' }).fill('45387376');
  const feature = page.locator('[data-destination-kind="feature"][data-feature-id="bench-45387376"]');
  await feature.focus();
  await feature.press('Enter');
  await expect(page.locator('[data-action="close-visitor-feature"]')).toBeFocused();
  await page.locator('[data-action="close-visitor-feature"]').press('Enter');
  await expect(feature).toBeFocused();
  expect(errors).toEqual([]);
});

test('browser Back from an Index visitor detail returns focus when the prior entry has no deep link', async ({ page }) => {
  const errors = captureRuntimeErrors(page);
  await openGuide(page, { width: 768, height: 1024 });
  const search = await openIndex(page);
  await search.fill('45387376');
  const feature = page.locator('[data-destination-kind="feature"][data-feature-id="bench-45387376"]');
  await feature.focus();
  await feature.press('Enter');
  await expect(page).toHaveURL(/#feature=bench-45387376$/);
  await expect(page.locator('[data-action="close-visitor-feature"]')).toBeFocused();
  await page.goBack();
  await expect(page).not.toHaveURL(/#feature=/);
  await expect(page.locator('#detail-sheet')).toBeHidden();
  await expect(feature).toBeFocused();
  expect(errors).toEqual([]);
});
