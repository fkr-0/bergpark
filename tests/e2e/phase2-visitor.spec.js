import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { captureRuntimeErrors, stubThirdPartyMapTiles } from './test-support.js';

async function openVisitorGuide(page, path = '/') {
  await stubThirdPartyMapTiles(page);
  await page.goto(path);
  await expect(page.locator('#map')).toHaveClass(/leaflet-container/);
  await expect(page.locator('.bergpark-marker').first()).toBeVisible();
  await expect(page.locator('#map-status')).not.toContainText(/geladen|loading/i);
}

function seriousOrCritical(scan) {
  return scan.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
}

test('tree explorer bounds the mobile result DOM while filters keep the map in sync', async ({ page }) => {
  const runtimeErrors = captureRuntimeErrors(page);
  await page.setViewportSize({ width: 320, height: 568 });
  await openVisitorGuide(page);

  await page.getByRole('button', { name: 'Bäume' }).click();
  await expect(page.getByRole('searchbox', { name: 'Baumsammlung durchsuchen' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Art' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Ort / Parkbereich' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Bedeutung' })).toBeVisible();

  await expect(page.locator('[data-tree-id]')).toHaveCount(60);
  await expect(page.locator('.tree-results-summary')).toContainText('60 von 569 Bäumen angezeigt');
  await page.getByRole('button', { name: 'Weitere Bäume anzeigen' }).click();
  await expect(page.locator('[data-tree-id]')).toHaveCount(120);

  const search = page.getByRole('searchbox', { name: 'Baumsammlung durchsuchen' });
  await search.fill('358');
  await expect(page.locator('[data-tree-id]')).toHaveCount(1);
  await expect(page.locator('[data-tree-id]').first()).toContainText('358');
  await expect(page.locator('.tree-map-point, .tree-map-cluster')).toHaveCount(1);

  const scan = await new AxeBuilder({ page }).include('#panel-view').analyze();
  const blocking = seriousOrCritical(scan);
  expect(blocking, blocking.map((violation) => `${violation.id}: ${violation.help}`).join('\n')).toEqual([]);
  expect(runtimeErrors).toEqual([]);
});

test('route detail preserves mapped-path uncertainty, semantic links, and keyboard focus', async ({ page }) => {
  const runtimeErrors = captureRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openVisitorGuide(page, '/#place=aquaedukt');

  const detail = page.locator('#detail-sheet');
  await expect(detail).toBeVisible();
  await expect(detail.locator('h2')).toContainText('Aquädukt');
  await expect(detail.locator('[data-semantic-id]').first()).toBeVisible();
  await expect(detail.locator('[data-semantic-id]').first()).toHaveAttribute('data-semantic-id', /^person-/);

  await detail.locator('[data-route-to]').first().click();
  await expect(detail.locator('.route-metrics')).toBeVisible();
  await expect(detail).toContainText('Distanz');
  await expect(detail).toContainText('Gehzeit');
  await expect(detail).toContainText('Anstieg');
  await expect(detail).toContainText('Abstieg');
  await expect(detail).toContainText('Ø Steigung');
  await expect(detail).toContainText('Kartierter Weg');
  await expect(detail).toContainText('nicht auf Barrieren geprüft');
  await expect(detail.locator('[data-action="close-route"]')).toBeFocused();

  const scan = await new AxeBuilder({ page }).include('#detail-sheet').analyze();
  const blocking = seriousOrCritical(scan);
  expect(blocking, blocking.map((violation) => `${violation.id}: ${violation.help}`).join('\n')).toEqual([]);

  await detail.locator('[data-action="close-route"]').click();
  await expect(detail.locator('h2')).toContainText('Aquädukt');
  await expect(detail.locator('[data-action="close-detail"]')).toBeFocused();

  await detail.locator('[data-semantic-id]').first().click();
  await expect(detail).toBeVisible();
  await expect(page).toHaveURL(/#place=person-/);
  await expect(detail.locator('h2')).not.toContainText('Aquädukt');
  expect(runtimeErrors).toEqual([]);
});
