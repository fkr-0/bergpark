import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function captureRuntimeErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function stubThirdPartyMapTiles(page) {
  await page.route(/https:\/\/[^/]*tile\.(openstreetmap|opentopomap)\.org\//, (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: TRANSPARENT_PNG,
  }));
}

test('primary landmark markers activate from Enter without pointer input', async ({ page }) => {
  const errors = captureRuntimeErrors(page);
  await stubThirdPartyMapTiles(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#map')).toHaveClass(/leaflet-container/);

  const marker = page.locator('.bergpark-marker-wrap').first();
  await marker.focus();
  await expect(marker).toBeFocused();
  await marker.press('Enter');

  const detail = page.locator('#detail-sheet');
  await expect(detail).toBeVisible();
  const scan = await new AxeBuilder({ page }).include('#detail-sheet').analyze();
  expect(scan.violations.filter(({ impact }) => ['serious', 'critical'].includes(impact))).toEqual([]);
  expect(errors).toEqual([]);
});
