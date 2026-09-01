import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { captureRuntimeErrors, stubThirdPartyMapTiles } from './test-support.js';

async function installSpeechHarness(page) {
  await page.addInitScript(() => {
    window.__bergparkSpeechCalls = [];
    class TestUtterance {
      constructor(text) {
        this.text = text;
        this.lang = '';
        this.voice = null;
        this.onend = null;
        this.onerror = null;
      }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: TestUtterance });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        speak(utterance) { window.__bergparkSpeechCalls.push(['speak', utterance.lang, utterance.text]); },
        cancel() { window.__bergparkSpeechCalls.push(['cancel']); },
        pause() { window.__bergparkSpeechCalls.push(['pause']); },
        resume() { window.__bergparkSpeechCalls.push(['resume']); },
        getVoices() { return []; },
      },
    });
  });
}

async function openCompanion(page, path = '/#place=herkules') {
  await stubThirdPartyMapTiles(page);
  await page.goto(path);
  await expect(page.locator('#map')).toHaveClass(/leaflet-container/);
  await expect(page.locator('#map')).toHaveAttribute('data-supplemental-data', 'ready');
  await expect(page.locator('#detail-sheet .audio-guide')).toBeVisible();
}

test('audio is manual, bilingual transcripts follow selection, related journeys retain browser return context, and detail is accessible', async ({ page }) => {
  const errors = captureRuntimeErrors(page);
  await installSpeechHarness(page);
  await openCompanion(page);

  expect(await page.evaluate(() => window.__bergparkSpeechCalls)).toEqual([]);
  const language = page.locator('[data-audio-language]');
  await expect(language).toBeVisible();
  await expect(page.locator('[data-transcript-language="de"]')).toBeVisible();
  await expect(page.locator('[data-transcript-language="en"]')).toBeHidden();
  await language.selectOption('en');
  await expect(page.locator('[data-transcript-language="de"]')).toBeHidden();
  await expect(page.locator('[data-transcript-language="en"]')).toBeVisible();

  await page.locator('[data-transcript-language="en"] summary').click();
  await expect(page.locator('[data-transcript-language="en"] p').first()).toBeVisible();
  await page.locator('[data-action="narrate"]').click();
  await page.locator('[data-action="pause-narration"]').click();
  await page.locator('[data-action="resume-narration"]').click();
  await page.locator('[data-action="stop-narration"]').click();
  const callKinds = await page.evaluate(() => window.__bergparkSpeechCalls.map(([kind]) => kind));
  expect(callKinds).toEqual(['speak', 'pause', 'resume', 'cancel']);

  const related = page.locator('[data-related-id]').first();
  await expect(related).toBeVisible();
  const relatedId = await related.getAttribute('data-related-id');
  await related.click();
  await expect(page).toHaveURL(new RegExp(`#place=${relatedId}$`));
  await page.goBack();
  await expect(page).toHaveURL(/#place=herkules$/);
  await expect(page.locator('#detail-sheet h2')).toContainText(/Herkules|Hercules/);

  const scan = await new AxeBuilder({ page }).include('#detail-sheet').analyze();
  const blocking = scan.violations.filter(({ impact }) => ['serious', 'critical'].includes(impact));
  expect(blocking, blocking.map(({ id, help }) => `${id}: ${help}`).join('\n')).toEqual([]);
  expect(errors).toEqual([]);
});

test('warmed shipped transcript remains readable offline without speech support', async ({ page, context }) => {
  await openCompanion(page);
  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) throw new Error('service worker API unavailable');
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(page.locator('#map')).toHaveAttribute('data-supplemental-data', 'ready');
  await expect(page.locator('[data-narration-transcript]:not([hidden])')).toBeVisible();

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#detail-sheet .audio-guide')).toBeVisible();
    await expect(page.locator('[data-narration-transcript]:not([hidden])')).toBeVisible();
    await page.locator('[data-narration-transcript]:not([hidden]) summary').click();
    await expect(page.locator('[data-narration-transcript]:not([hidden]) p').first()).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
