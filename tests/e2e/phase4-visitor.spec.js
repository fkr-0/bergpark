import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { captureRuntimeErrors, stubThirdPartyMapTiles } from './test-support.js';

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

test('320px tree map clusters and individual markers activate from the keyboard', async ({ page }) => {
  const errors = captureRuntimeErrors(page);
  await page.setViewportSize({ width: 320, height: 568 });
  await openGuide(page);
  await page.getByRole('button', { name: 'Bäume' }).click();

  for (let attempt = 0; attempt < 4 && !(await page.locator('.tree-map-point').first().isVisible().catch(() => false)); attempt += 1) {
    const cluster = page.locator('.tree-map-cluster').first();
    await expect(cluster).toBeVisible();
    await cluster.focus();
    await cluster.press('Enter');
    await page.waitForTimeout(450);
  }

  const point = page.locator('.tree-map-point').first();
  await expect(point).toBeVisible();
  await point.focus();
  await point.press(' ');
  await expect(page.locator('#detail-sheet')).toBeVisible();
  await expect(page.locator('#detail-sheet [data-action="close-tree"]')).toBeFocused();
  await expectNoBlockingAxe(page, '#detail-sheet');
  expect(errors).toEqual([]);
});

test('390px feature hash navigation exposes only absolute public evidence', async ({ page }) => {
  const errors = captureRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openGuide(page);
  await page.evaluate(() => { location.hash = '#feature=bench-45387376'; });

  const detail = page.locator('#detail-sheet');
  await expect(detail).toBeVisible();
  const source = detail.getByRole('link', { name: 'Quellbeleg öffnen' });
  await expect(source).toHaveAttribute('href', 'https://www.openstreetmap.org/node/45387376');
  await expect(detail.locator('a[href^="/data/sources"], a[href*="data/sources/"]')).toHaveCount(0);
  await expectNoBlockingAxe(page, '#detail-sheet');
  expect(errors).toEqual([]);
});

test('tablet semantic detail localizes displayed_at and preserves qualification/source evidence', async ({ page }) => {
  const errors = captureRuntimeErrors(page);
  await page.setViewportSize({ width: 768, height: 1024 });
  await openGuide(page);
  await page.evaluate(() => { location.hash = '#place=schloss'; });

  const detail = page.locator('#detail-sheet');
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('Der Segen Jakobs');
  await expect(detail).toContainText('wird gezeigt in');
  await expect(detail).toContainText('does not infer ownership or acquisition history');
  await expect(detail).toContainText('Gemäldegalerie Alte Meister im Schloss Wilhelmshöhe');
  await expect(detail).not.toContainText('hkh-gemaeldegalerie-location');
  await expectNoBlockingAxe(page, '#detail-sheet');
  expect(errors).toEqual([]);
});

test('desktop place/tree/feature history restores back-forward state and ignores missing IDs safely', async ({ page }) => {
  const errors = captureRuntimeErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openGuide(page, '/#place=herkules');
  await expect(page.locator('#detail-sheet h2')).toContainText('Herkules');

  await page.getByRole('button', { name: 'Bäume' }).click();
  await expect(page.locator('#panel-view')).toBeVisible();
  await expect(page.locator('#detail-sheet')).toBeHidden();
  const treeRow = page.locator('[data-tree-id]').first();
  await expect(treeRow).toBeVisible();
  const treeId = await treeRow.getAttribute('data-tree-id');
  expect(treeId).toBeTruthy();
  await treeRow.click();
  await expect(page).toHaveURL(new RegExp(`#tree=${encodeURIComponent(treeId)}`));
  await expect(page.locator('#detail-sheet [data-action="close-tree"]')).toBeVisible();

  await page.evaluate(() => { location.hash = '#feature=bench-45387376'; });
  await expect(page).toHaveURL(/#feature=bench-45387376$/);
  await expect(page.locator('#detail-sheet')).toContainText('45387376');

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`#tree=${encodeURIComponent(treeId)}`));
  await expect(page.locator('#detail-sheet [data-action="close-tree"]')).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/#place=herkules$/);
  await expect(page.locator('#detail-sheet h2')).toContainText('Herkules');

  await page.evaluate(() => { location.hash = '#feature=missing-phase4-id'; });
  await expect(page.locator('#detail-sheet h2')).toContainText('Herkules');
  await expectNoBlockingAxe(page, '#detail-sheet');
  expect(errors).toEqual([]);
});
