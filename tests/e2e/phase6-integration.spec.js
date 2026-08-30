import { expect, test } from '@playwright/test';
import { captureRuntimeErrors, stubThirdPartyMapTiles } from './test-support.js';

async function openGuide(page, path = '/') {
  await stubThirdPartyMapTiles(page);
  await page.goto(path);
  await expect(page.locator('#map')).toHaveClass(/leaflet-container/);
  await expect(page.locator('#map-status')).not.toContainText(/geladen|loading/i);
}

test('complete Phase-8 walking network hydrates as a bounded runtime projection', async ({ page }) => {
  const errors = captureRuntimeErrors(page);
  const requests = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  await page.setViewportSize({ width: 390, height: 844 });
  await openGuide(page);

  const map = page.locator('#map');
  await expect(map).toHaveAttribute('data-walking-network-nodes', '2633', { timeout: 10_000 });
  await expect(map).toHaveAttribute('data-walking-network-directed-segments', '7196');
  await expect(map).toHaveAttribute('data-walking-network-segments', '3354');
  expect(requests.some((path) => path.endsWith('/data/walking-network.json'))).toBe(true);
  expect(requests.some((path) => path.endsWith('/data/path_topology.json'))).toBe(false);
  expect(requests.some((path) => path.endsWith('/data/graph.json'))).toBe(false);
  expect(errors).toEqual([]);
});

test('Phase-3 Flora artwork context renders and switches language without losing semantic linkage', async ({ page }) => {
  const errors = captureRuntimeErrors(page);
  await page.setViewportSize({ width: 768, height: 1024 });
  await openGuide(page);
  await page.getByRole('button', { name: 'Index' }).click();
  await page.getByRole('searchbox', { name: /Ziele durchsuchen|Search destinations/ }).fill('Flora');
  await page.locator('[data-node-id="flora"]').click();

  const detail = page.locator('#detail-sheet');
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('Werkbezug');
  await expect(detail).toContainText('Flora Farnesina');
  await expect(detail).toContainText(/Ludwig Daniel Heyd/);
  await expect(detail.locator('[data-semantic-id="artwork-flora-farnesina"]')).toBeVisible();

  await page.locator('#language').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(detail).toContainText('Artwork context');
  await expect(detail).toContainText(/Ludwig Daniel Heyd/);
  expect(errors).toEqual([]);
});
