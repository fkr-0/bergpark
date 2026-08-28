import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { captureRuntimeErrors, stubThirdPartyMapTiles } from './test-support.js';

async function openSearch(page, { width = 390, height = 844 } = {}) {
  await page.setViewportSize({ width, height });
  await stubThirdPartyMapTiles(page);
  await page.goto('/');
  await expect(page.locator('#map')).toHaveClass(/leaflet-container/);
  await page.getByRole('button', { name: 'Index' }).click();
  await expect(page.locator('#map')).toHaveAttribute('data-supplemental-data', 'ready');
  return page.getByRole('searchbox', { name: 'Ziele durchsuchen' });
}

test('mobile destination search opens canonical place, tree and shipped visitor feature through existing deep links', async ({ page }) => {
  const errors = captureRuntimeErrors(page);
  const search = await openSearch(page);

  await search.fill('aquadukt');
  const place = page.locator('[data-destination-kind="place"][data-node-id="aquaedukt"]');
  await expect(place).toBeVisible();
  expect((await place.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await place.click();
  await expect(page).toHaveURL(/#place=aquaedukt$/);
  await expect(page.locator('#detail-sheet h2')).toContainText('Aquädukt');

  await page.getByRole('button', { name: 'Index' }).click();
  await page.getByRole('searchbox', { name: 'Ziele durchsuchen' }).fill('358');
  const tree = page.locator('[data-destination-kind="tree"][data-tree-id="tree-5702751554"]');
  await expect(tree).toContainText(/Katalogbaum|Riesenmammutbaum/);
  await tree.click();
  await expect(page).toHaveURL(/#tree=tree-5702751554$/);
  await expect(page.locator('#detail-sheet')).toContainText('358');

  await page.getByRole('button', { name: 'Index' }).click();
  await page.getByRole('searchbox', { name: 'Ziele durchsuchen' }).fill('45387376');
  const feature = page.locator('[data-destination-kind="feature"][data-feature-id="bench-45387376"]');
  await expect(feature).toContainText('Bank');
  await feature.click();
  await expect(page).toHaveURL(/#feature=bench-45387376$/);
  await expect(page.locator('#detail-sheet')).toContainText('45387376');
  expect(errors).toEqual([]);
});

test('semantic destination remains non-spatial, keyboard-operable and localizes on language switch', async ({ page }) => {
  const errors = captureRuntimeErrors(page);
  const search = await openSearch(page, { width: 768, height: 1024 });
  await search.fill('architect');
  const first = page.locator('[data-destination-kind="place"][data-spatial="false"]').first();
  await expect(first).toContainText('Person');
  await expect(first).toContainText('Architekt');

  await search.focus();
  await page.keyboard.press('Tab');
  if (!(await first.evaluate((element) => element === document.activeElement))) {
    await page.keyboard.press('Tab');
  }
  await expect(first).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#place=person-/);
  await expect(page.locator('#detail-sheet')).toContainText('Rollen');

  await page.getByRole('button', { name: 'Index' }).click();
  await page.locator('#language').click();
  const englishSearch = page.getByRole('searchbox', { name: 'Search destinations' });
  await expect(englishSearch).toHaveValue('architect');
  await expect(page.locator('[data-destination-kind="place"][data-spatial="false"]').first()).toContainText('Architect');

  const scan = await new AxeBuilder({ page }).include('#panel-view').analyze();
  const blocking = scan.violations.filter(({ impact }) => ['serious', 'critical'].includes(impact));
  expect(blocking, blocking.map(({ id, help }) => `${id}: ${help}`).join('\n')).toEqual([]);
  expect(errors).toEqual([]);
});

test('destination list remains DOM-bounded before a query', async ({ page }) => {
  await openSearch(page);
  const rows = page.locator('[data-destination-id]');
  await expect(rows).toHaveCount(80);
  await expect(page.locator('.destination-search-summary')).toContainText(/80 von .* Zielen/);
});
