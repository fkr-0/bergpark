import AxeBuilder from '@axe-core/playwright';
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

test('Leaflet detail compares trustworthy direct-route evidence without changing manual navigation', async ({ page }) => {
  await openGuide(page, '/#place=herkules');
  const detail = page.locator('#detail-sheet');
  await expect(detail).toBeVisible();
  await expect(detail.locator('[data-route-sort]')).toBeVisible();

  const options = detail.locator('[data-route-option]');
  await expect(options.first()).toBeVisible();
  expect(await options.count()).toBeLessThanOrEqual(8);
  await expect(options.first().locator('.route-option__metrics')).toContainText(/min.*m.*↑|↑.*m/);
  await expect(options.first().locator('.route-option__evidence')).not.toBeEmpty();

  await detail.locator('[data-route-sort]').selectOption('distance');
  await expect(detail.locator('[data-route-sort]')).toHaveValue('distance');

  await page.locator('#language').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(detail.locator('[data-route-sort]')).toHaveValue('time');
  await expect(detail).toContainText('Directly connected walks');

  await detail.locator('[data-route-to]').first().click();
  await expect(page.locator('#map-status')).toContainText(/m · .*min/i);
  await expect(page.locator('#map')).toHaveAttribute('data-spatial-renderer', 'leaflet');
});

test('almanac filters people/art, trees and visitor features while retaining canonical deep links', async ({ page }) => {
  await openGuide(page);
  await page.getByRole('button', { name: 'Index' }).click();
  await expect(page.getByRole('heading', { name: 'Almanach' })).toBeVisible();

  const category = page.locator('[data-destination-filter]');
  const search = page.locator('[data-destination-search]');
  await category.selectOption('story');
  await search.fill('architect');
  const story = page.locator('.index-list [data-destination-kind]').first();
  await expect(story).toBeVisible();
  const storyId = await story.getAttribute('data-node-id');
  expect(storyId).toBeTruthy();
  await story.click();
  await expect(page).toHaveURL(new RegExp(`#place=${storyId}$`));

  await page.getByRole('button', { name: 'Index' }).click();
  await category.selectOption('tree');
  await search.fill('tree-5702751554');
  await page.locator('[data-tree-id="tree-5702751554"]').click();
  await expect(page).toHaveURL(/#tree=tree-5702751554$/);

  await page.getByRole('button', { name: 'Index' }).click();
  await category.selectOption('feature');
  await search.fill('45387376');
  await page.locator('[data-feature-id="bench-45387376"]').click();
  await expect(page).toHaveURL(/#feature=bench-45387376$/);
});

test('path and junction discovery stays collapsed/lazy, bounded, keyboard-operable and reduced-motion safe', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openGuide(page);
  await page.getByRole('button', { name: 'Index' }).click();

  const network = page.locator('[data-network-discovery]');
  await expect(network).toBeVisible({ timeout: 10_000 });
  await expect(network.locator('.network-list > button')).toHaveCount(0);
  await network.locator('summary').click();
  const networkButtons = network.locator('.network-list > button');
  await expect(networkButtons.first()).toBeVisible();
  expect(await networkButtons.count()).toBeLessThanOrEqual(40);

  await network.locator('[data-network-filter]').selectOption('steps');
  const firstStep = network.locator('.network-list > button').first();
  await expect(firstStep).toBeVisible();
  const networkId = await firstStep.getAttribute('data-network-id');
  expect(networkId).toMatch(/^pathseg-/);
  await firstStep.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#map-status')).toContainText(networkId);
  await expect(page.locator('#map')).toHaveAttribute('data-spatial-renderer', 'leaflet');
  await expect(page).not.toHaveURL(/#(?:place|tree|feature)=/);
});

test('narration is quiet by default, transcript-backed, manual and single-voice', async ({ page }) => {
  await page.addInitScript(() => {
    window.__bergparkSpeechLog = [];
    const synth = window.speechSynthesis;
    const proto = Object.getPrototypeOf(synth);
    Object.defineProperty(proto, 'speak', {
      configurable: true,
      value(utterance) { window.__bergparkSpeechLog.push(['speak', utterance.text]); },
    });
    Object.defineProperty(proto, 'cancel', {
      configurable: true,
      value() { window.__bergparkSpeechLog.push(['cancel']); },
    });
    Object.defineProperty(proto, 'getVoices', { configurable: true, value() { return []; } });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: class FakeUtterance {
        constructor(text) { this.text = text; this.lang = ''; this.onend = null; this.onerror = null; }
      },
    });
  });

  await openGuide(page, '/#place=aquaedukt');
  await expect(page.locator('#map')).toHaveAttribute('data-supplemental-data', 'ready', { timeout: 15_000 });
  const detail = page.locator('#detail-sheet');
  await expect(detail.locator('[data-action="narrate"]')).toBeEnabled();
  expect(await page.evaluate(() => window.__bergparkSpeechLog)).toEqual([]);

  const transcript = detail.locator('[data-narration-transcript]');
  await expect(transcript).toBeVisible();
  await transcript.locator('summary').click();
  await expect(transcript).toContainText('Aquädukt');

  await detail.locator('[data-action="narrate"]').click();
  const stopNarration = detail.locator('[data-action="stop-narration"]');
  await expect(stopNarration).toBeVisible();
  expect((await page.evaluate(() => window.__bergparkSpeechLog)).map(([kind]) => kind)).toEqual(['speak']);
  await detail.locator('[data-action="narrate"]').click();
  expect((await page.evaluate(() => window.__bergparkSpeechLog)).map(([kind]) => kind)).toEqual(['speak', 'cancel', 'speak']);
  await expect(stopNarration).toBeVisible();
  await stopNarration.click();
  expect((await page.evaluate(() => window.__bergparkSpeechLog)).map(([kind]) => kind)).toEqual(['speak', 'cancel', 'speak', 'cancel']);

  await page.locator('#language').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  const englishTranscript = page.locator('[data-narration-transcript]');
  await englishTranscript.locator('summary').click();
  await expect(englishTranscript).toContainText('Aqueduct');

  const scan = await new AxeBuilder({ page }).include('#detail-sheet').analyze();
  expect(scan.violations.filter(({ impact }) => ['serious', 'critical'].includes(impact))).toEqual([]);
});

test('stale canonical IDs fail visibly and warmed discovery remains usable offline', async ({ page, context }) => {
  await openGuide(page, '/#place=phase6-stale-id');
  await expect(page.locator('#map')).toHaveAttribute('data-supplemental-data', 'ready', { timeout: 10_000 });
  await expect(page.locator('#map-status')).toContainText('gespeicherte Park-Link');

  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect(page.locator('#map')).toHaveClass(/leaflet-container/);
  await page.getByRole('button', { name: 'Index' }).click();
  await expect(page.locator('[data-network-discovery]')).toBeVisible({ timeout: 10_000 });

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#map')).toHaveClass(/leaflet-container/);
    await page.getByRole('button', { name: 'Index' }).click();
    const network = page.locator('[data-network-discovery]');
    await expect(network).toBeVisible({ timeout: 10_000 });
    await network.locator('summary').click();
    await expect(network.locator('.network-list > button').first()).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
