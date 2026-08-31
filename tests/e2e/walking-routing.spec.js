import { expect, test } from '@playwright/test';
import { stubThirdPartyMapTiles } from './test-support.js';

async function openGuide(page, path = '/') {
  await page.goto(path);
  await expect(page.locator('#map')).toHaveAttribute('data-spatial-renderer', 'leaflet');
  await expect(page.locator('#map')).toHaveClass(/leaflet-container/);
  await expect(page.locator('.bergpark-marker').first()).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await stubThirdPartyMapTiles(page);
});

test('visitor can select and restore a multi-hop route without losing source caveats', async ({ page }) => {
  await openGuide(page, '/#place=herkules');
  const detail = page.locator('#detail-sheet');
  const planner = detail.locator('[data-walking-route-planner="ready"]');
  await expect(planner).toBeVisible({ timeout: 10_000 });
  await planner.locator('[data-walking-route-to]').selectOption('schloss');
  await planner.locator('[data-walking-route-profile]').selectOption('shortest');
  await planner.locator('[data-walking-route-form]').evaluate((form) => form.requestSubmit());

  const route = detail.locator('[data-walking-route-result]');
  await expect(route).toBeVisible();
  await expect(page).toHaveURL(/#route=herkules&to=schloss&profile=shortest$/);
  await expect(route.locator('[data-walking-route-policy]')).toContainText('veröffentlichte Segmentdistanz');
  await expect(route.locator('[data-walking-route-endpoints]')).toContainText('Endpunkt-Connector');
  await expect(route.locator('[data-walking-route-coverage]')).toContainText('keine physisch vollständige Parkinventur');
  await expect(page.locator('#map-status')).toContainText(/Schloss.*m/);

  await page.reload();
  await expect(page.locator('[data-walking-route-result]')).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveURL(/#route=herkules&to=schloss&profile=shortest$/);
  await expect(page.locator('[data-walking-route-coverage]')).toContainText('keine physisch vollständige Parkinventur');

  await page.locator('[data-action="close-walking-route"]').click();
  await expect(page).toHaveURL(/#place=herkules$/);
  await expect(page.locator('[data-walking-route-planner="ready"]')).toBeVisible();
});

test('saved route with unsupported profile fails visibly at the source place', async ({ page }) => {
  await openGuide(page, '/#route=herkules&to=schloss&profile=wheelchair');
  const planner = page.locator('[data-walking-route-planner="ready"]');
  await expect(planner).toBeVisible({ timeout: 10_000 });
  await expect(planner.locator('[data-walking-route-error]')).toContainText('Routenprofil wird nicht unterstützt');
  await expect(page.locator('#map-status')).toContainText('Routenprofil wird nicht unterstützt');
  await expect(page.locator('[data-walking-route-result]')).toHaveCount(0);
  await expect(page).toHaveURL(/#route=herkules&to=schloss&profile=wheelchair$/);
});

test('multi-hop route remains renderer-neutral in optional terrain mode', async ({ page }) => {
  await page.goto('/?renderer=terrain#place=herkules');
  await expect(page.locator('#map')).toHaveAttribute('data-spatial-renderer', 'terrain');
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  const planner = page.locator('[data-walking-route-planner="ready"]');
  await expect(planner).toBeVisible({ timeout: 10_000 });
  await planner.locator('[data-walking-route-to]').selectOption('schloss');
  await planner.locator('[data-walking-route-form]').evaluate((form) => form.requestSubmit());

  await expect(page.locator('[data-walking-route-result]')).toBeVisible();
  await expect(page.locator('#map')).toHaveAttribute('data-spatial-renderer', 'terrain');
  await expect(page).toHaveURL(/\?renderer=terrain#route=herkules&to=schloss&profile=shortest$/);
});
