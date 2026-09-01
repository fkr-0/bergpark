import { expect, test } from '@playwright/test';
import { stubThirdPartyMapTiles } from './test-support.js';

test('DGM1 runtime mesh proves the side-view cascades rise before terrain is ready', async ({ page }) => {
  await stubThirdPartyMapTiles(page);
  await page.goto('/?renderer=terrain');
  const map = page.locator('#map');
  await expect(map).toHaveAttribute('data-spatial-renderer', 'terrain');
  await expect(map).toHaveAttribute('data-spatial-terrain-state', 'terrain');
  await expect(map).toHaveAttribute('data-spatial-terrain-active', 'true');
  await expect(map).toHaveAttribute('data-spatial-terrain-ready', 'true', { timeout: 20_000 });
  await expect(map).toHaveAttribute('data-spatial-terrain-verified', 'cascades-rise');

  const measured = await map.evaluate((element) => ({
    lower: Number(element.dataset.spatialTerrainLowerM),
    upper: Number(element.dataset.spatialTerrainUpperM),
    rise: Number(element.dataset.spatialTerrainRiseM),
  }));
  expect(measured.lower).toBeGreaterThan(150);
  expect(measured.upper).toBeGreaterThan(measured.lower);
  expect(measured.rise).toBeGreaterThanOrEqual(60);
  expect(measured.rise).toBeCloseTo(measured.upper - measured.lower, 2);

  const localDemRequests = await page.evaluate(() => performance.getEntriesByType('resource')
    .filter(({ name }) => /\/terrain\/dgm1-terrarium\/(?:14|15|16)\/\d+\/\d+\.png$/.test(name)).length);
  expect(localDemRequests).toBeGreaterThan(0);
});
