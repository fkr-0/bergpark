import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { captureRuntimeErrors, isThirdPartyMapTileUrl, stubThirdPartyMapTiles } from './test-support.js';

async function openGuide(page, path = '/') {
  await stubThirdPartyMapTiles(page);
  await page.goto(path);
  await expect(page.locator('#map')).toHaveClass(/leaflet-container/);
  await expect(page.locator('#map-status')).not.toContainText(/geladen|loading/i);
}

async function expectNoBlockingAxe(page, selector) {
  const scan = await new AxeBuilder({ page }).include(selector).analyze();
  const blocking = scan.violations.filter(({ impact }) => ['serious', 'critical'].includes(impact));
  expect(blocking, blocking.map(({ id, help }) => `${id}: ${help}`).join('\n')).toEqual([]);
}

test('320px tree detail is sourced, missing-height-safe, and restores list focus', async ({ page }) => {
  const errors = captureRuntimeErrors(page);
  await page.setViewportSize({ width: 320, height: 568 });
  await openGuide(page);
  await page.getByRole('button', { name: 'Bäume' }).click();
  await page.getByRole('searchbox', { name: 'Baumsammlung durchsuchen' }).fill('358');
  await page.locator('[data-tree-id]').first().click();

  const detail = page.locator('#detail-sheet');
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('358');
  await expect(detail).toContainText('Positionsquelle');
  await expect(detail).toContainText('Nicht aus einer Messquelle belegt');
  await expect(detail.getByRole('link', { name: /Wikimedia Commons/ })).toBeVisible();
  await expect(detail.locator('[data-action="close-tree"]')).toBeFocused();
  await expectNoBlockingAxe(page, '#detail-sheet');

  await detail.locator('[data-action="close-tree"]').click();
  await expect(page.locator('[data-tree-id]').first()).toBeFocused();
  expect(errors).toEqual([]);
});

test('390px visitor layers are opt-in, bounded and provenance-aware', async ({ page }) => {
  const errors = captureRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openGuide(page);

  const control = page.locator('#visitor-layer-control');
  await control.locator('summary').click();
  await control.getByRole('checkbox', { name: 'Bänke' }).check();
  await expect(page.locator('.visitor-map-point, .visitor-map-cluster').first()).toBeVisible();
  expect(await page.locator('.visitor-map-point, .visitor-map-cluster').count()).toBeLessThanOrEqual(180);
  await expect(control).toContainText('fehlender Eintrag');
  await control.locator('summary').click();
  await expect(control).not.toHaveAttribute('open', '');

  for (let attempt = 0; attempt < 4 && !(await page.locator('.visitor-map-point').first().isVisible().catch(() => false)); attempt += 1) {
    const cluster = page.locator('.visitor-map-cluster').first();
    await cluster.focus();
    await cluster.press('Enter');
    await page.waitForTimeout(450);
  }
  const point = page.locator('.visitor-map-point').first();
  await point.focus();
  await point.press('Enter');
  const detail = page.locator('#detail-sheet');
  await expect(detail).toBeVisible();
  await expect(detail).toContainText(/OpenStreetMap|Quelle & Abdeckung/);
  await expect(detail).toContainText('fehlender Eintrag');
  await expectNoBlockingAxe(page, '#detail-sheet');
  expect(errors).toEqual([]);
});

test('tablet index discovers semantic entities by role and exposes context', async ({ page }) => {
  const errors = captureRuntimeErrors(page);
  await page.setViewportSize({ width: 768, height: 1024 });
  await openGuide(page);
  await page.getByRole('button', { name: 'Index' }).click();
  await page.getByRole('searchbox', { name: 'Orte durchsuchen' }).fill('architect');
  await expect(page.locator('[data-node-id]').first()).toContainText(/architect/i);
  await page.locator('[data-node-id]').first().click();

  const detail = page.locator('#detail-sheet');
  await expect(detail).toContainText('Rollen');
  await expect(detail.locator('[data-semantic-id]').first()).toBeVisible();
  await expect(detail.locator('.detail-sources')).toBeVisible();
  await expectNoBlockingAxe(page, '#detail-sheet');
  expect(errors).toEqual([]);
});

test('desktop warmed runtime keeps trees and selective layers available offline', async ({ page, context }) => {
  test.setTimeout(60_000);
  const errors = captureRuntimeErrors(page);
  const failedRequests = [];
  page.on('requestfailed', (request) => failedRequests.push(request.url()));
  await page.setViewportSize({ width: 1280, height: 800 });
  await openGuide(page);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker?.controller)), { timeout: 15_000 }).toBe(true);
  await page.reload();
  await expect(page.locator('#map')).toHaveClass(/leaflet-container/);
  expect(errors).toEqual([]);
  errors.length = 0;
  failedRequests.length = 0;

  try {
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('#map')).toHaveClass(/leaflet-container/);
    await page.locator('#visitor-layer-control summary').click();
    await expect(page.locator('#visitor-layer-control')).toContainText('Bänke');
    await page.locator('#visitor-layer-control summary').click();
    await page.getByRole('button', { name: 'Bäume' }).click();
    await expect(page.locator('[data-tree-id]').first()).toBeVisible();
    await expectNoBlockingAxe(page, '#panel-view');
  } finally {
    await context.setOffline(false);
  }
  expect(failedRequests.filter((url) => !isThirdPartyMapTileUrl(url))).toEqual([]);
  expect(errors.filter((error) => error !== 'console: Failed to load resource: net::ERR_FAILED')).toEqual([]);
});
