import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

async function openVisitorGuide(page, path = '/') {
  await page.goto(path);
  await expect(page.locator('#map')).toHaveClass(/leaflet-container/);
  await expect(page.locator('.bergpark-marker').first()).toBeVisible();
  await expect(page.locator('#map-status')).not.toContainText(/geladen|loading/i);
}

test.beforeEach(async ({ page }) => {
  // The E2E contract is the Bergpark application. Third-party map tile availability
  // must not make the release gate flaky or turn the test suite into a tile crawler.
  await page.route(/https:\/\/[^/]*tile\.(openstreetmap|opentopomap)\.org\//, (route) => route.abort());
});

test('visitor can switch language, search the index, open a place and show a route', async ({ page }) => {
  await openVisitorGuide(page);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bergpark Wilhelmshöhe');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');

  await page.locator('#language').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#map-status')).toContainText('Tap a place');

  await page.getByRole('button', { name: 'Index' }).click();
  const search = page.getByPlaceholder('Name, building, water feature …');
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
