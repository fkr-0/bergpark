import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { parsePositiveInteger, summarizeTimings } from './lib.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const VITE_BIN = fileURLToPath(new URL('../../node_modules/vite/bin/vite.js', import.meta.url));
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  if (!port) throw new Error('failed to reserve an ephemeral preview port');
  return port;
}

async function waitForPreview(url, processHandle) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (processHandle.exitCode != null) throw new Error(`vite preview exited with ${processHandle.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Preview is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`vite preview did not become ready at ${url}`);
}

async function stopPreview(processHandle) {
  if (processHandle.exitCode != null) return;
  processHandle.kill('SIGTERM');
  await Promise.race([
    new Promise((resolveClose) => processHandle.once('close', resolveClose)),
    new Promise((resolveWait) => setTimeout(resolveWait, 3_000)),
  ]);
  if (processHandle.exitCode == null) processHandle.kill('SIGKILL');
}

async function stubThirdPartyTiles(page) {
  await page.route(/https:\/\/[^/]*tile\.(openstreetmap|opentopomap)\.org\//, (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: TRANSPARENT_PNG,
  }));
}

async function addPerformanceProbe(context) {
  await context.addInitScript(() => {
    globalThis.__bergparkPerfLongTasks = [];
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          globalThis.__bergparkPerfLongTasks.push({ startTime: entry.startTime, duration: entry.duration });
        }
      });
      observer.observe({ type: 'longtask', buffered: true });
    } catch {
      // Long Task API availability itself is recorded by an empty result.
    }
  });
}

async function pageTelemetry(page) {
  return page.evaluate(() => ({
    resources: performance.getEntriesByType('resource').length,
    heap_bytes: Number.isFinite(performance.memory?.usedJSHeapSize) ? performance.memory.usedJSHeapSize : null,
    long_tasks: (globalThis.__bergparkPerfLongTasks ?? []).map((entry) => ({ ...entry })),
  }));
}

async function waitForRenderer(page, mode) {
  await page.locator(`#map[data-spatial-renderer="${mode}"]`).waitFor({ state: 'attached', timeout: 15_000 });
}

async function openLeaflet(page, baseUrl) {
  const started = performance.now();
  await page.goto(`${baseUrl}/#place=aquaedukt`, { waitUntil: 'domcontentloaded' });
  await waitForRenderer(page, 'leaflet');
  await page.locator('#detail-sheet').waitFor({ state: 'visible', timeout: 10_000 });
  return { useful_ms: performance.now() - started };
}

async function openTerrain(page, baseUrl) {
  const started = performance.now();
  await page.goto(`${baseUrl}/?renderer=terrain#place=aquaedukt`, { waitUntil: 'domcontentloaded' });
  await waitForRenderer(page, 'terrain');
  const rendererMs = performance.now() - started;
  await page.waitForFunction(() => performance.getEntriesByType('resource').some(({ name }) => (
    /\/terrain\/dgm1-terrarium\/(?:14|15|16)\/[0-9]+\/[0-9]+\.png$/.test(name)
  )), null, { timeout: 15_000 });
  await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
  const terrainMs = performance.now() - started;
  await page.waitForFunction(() => {
    const map = document.querySelector('#map');
    return map?.dataset.spatialHeritageState === 'ready' && map?.dataset.spatialHeritageRendered === 'true';
  }, null, { timeout: 15_000 });
  return {
    renderer_ms: rendererMs,
    useful_terrain_ms: terrainMs,
    heritage_ready_ms: performance.now() - started,
  };
}

async function measureRouteActionCommit(page, baseUrl) {
  const targetUrl = `${baseUrl}/?renderer=terrain#place=aquaedukt`;
  if (page.url() === targetUrl) {
    await page.reload({ waitUntil: 'domcontentloaded' });
  } else {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  }
  await waitForRenderer(page, 'terrain');
  await page.locator('#detail-sheet').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('#detail-sheet [data-route-to]').first().waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForFunction(() => {
    const map = document.querySelector('#map');
    return map?.dataset.spatialHeritageState === 'ready'
      && map?.dataset.spatialHeritageRendered === 'true'
      && map?.dataset.supplementalData === 'ready';
  }, null, { timeout: 15_000 });
  await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
  return page.evaluate(async () => {
    const routeButton = document.querySelector('#detail-sheet [data-route-to]');
    if (!(routeButton instanceof HTMLElement)) throw new Error('route action is unavailable');
    globalThis.__bergparkPerfLongTasks = [];
    const started = performance.now();
    routeButton.click();
    const handlerSyncMs = performance.now() - started;
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
    const frameCommitMs = performance.now() - started;
    if (!/m\s*·/.test(document.querySelector('#map-status')?.textContent ?? '')) {
      throw new Error('route action did not publish route status');
    }
    const longTasks = globalThis.__bergparkPerfLongTasks ?? [];
    return {
      handler_sync_ms: handlerSyncMs,
      two_frame_commit_ms: frameCommitMs,
      long_task_count: longTasks.length,
      max_long_task_ms: longTasks.length ? Math.max(...longTasks.map(({ duration }) => duration)) : 0,
    };
  });
}

async function measureContextRecovery(page) {
  const canLose = await page.evaluate(() => {
    const canvas = document.querySelector('.maplibregl-canvas');
    const gl = canvas?.getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_lose_context');
    if (!extension) return false;
    globalThis.__bergparkPerfLoseContext = extension;
    extension.loseContext();
    return true;
  });
  if (!canLose) return { supported: false, recovery_ms: null };
  await page.waitForFunction(() => document.querySelector('#map')?.dataset.spatialHeritageState === 'context-lost', null, {
    timeout: 10_000,
  });
  const started = performance.now();
  await page.evaluate(() => globalThis.__bergparkPerfLoseContext.restoreContext());
  await page.waitForFunction(() => {
    const map = document.querySelector('#map');
    return map?.dataset.spatialHeritageState === 'ready' && map?.dataset.spatialHeritageRendered === 'true';
  }, null, { timeout: 15_000 });
  return { supported: true, recovery_ms: performance.now() - started };
}

async function measureIdle(page, idleMs, settleMs = 2_000) {
  await page.waitForTimeout(settleMs);
  await page.evaluate(() => { globalThis.__bergparkPerfLongTasks = []; });
  const before = await pageTelemetry(page);
  await page.waitForTimeout(idleMs);
  const after = await pageTelemetry(page);
  return {
    settle_ms: settleMs,
    duration_ms: idleMs,
    resources_before: before.resources,
    resources_after: after.resources,
    resource_delta: after.resources - before.resources,
    heap_before_bytes: before.heap_bytes,
    heap_after_bytes: after.heap_bytes,
    heap_delta_bytes: before.heap_bytes == null || after.heap_bytes == null
      ? null
      : after.heap_bytes - before.heap_bytes,
    long_tasks_before: before.long_tasks.length,
    long_tasks_after: after.long_tasks.length,
    long_task_delta: after.long_tasks.length - before.long_tasks.length,
  };
}

function summarizeOpenRuns(runs, keys) {
  return Object.fromEntries(keys.map((key) => [key, summarizeTimings(runs.map((run) => run[key]).filter(Number.isFinite))]));
}

async function profileMode(browser, baseUrl, mode, {
  mobile = false,
  reducedMotion = false,
  warmIterations = 3,
  interactionIterations = 5,
  idleMs = 5_000,
} = {}) {
  const context = await browser.newContext({
    serviceWorkers: 'block',
    viewport: mobile ? { width: 412, height: 915 } : { width: 1440, height: 1000 },
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
  });
  await addPerformanceProbe(context);
  const page = await context.newPage();
  await stubThirdPartyTiles(page);
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  const open = mode === 'terrain' ? openTerrain : openLeaflet;
  const cold = await open(page, baseUrl);
  const warm = [];
  for (let index = 0; index < warmIterations; index += 1) warm.push(await open(page, baseUrl));

  const routeActions = [];
  let contextRecovery = null;
  if (mode === 'terrain') {
    for (let index = 0; index < interactionIterations; index += 1) {
      routeActions.push(await measureRouteActionCommit(page, baseUrl));
    }
    await openTerrain(page, baseUrl);
    contextRecovery = await measureContextRecovery(page);
  }
  const idle = await measureIdle(page, idleMs);
  const finalTelemetry = await pageTelemetry(page);
  await context.close();

  const timingKeys = mode === 'terrain'
    ? ['renderer_ms', 'useful_terrain_ms', 'heritage_ready_ms']
    : ['useful_ms'];
  return {
    renderer: mode,
    device_class: mobile ? 'mobile-emulation-412x915-touch' : 'desktop-1440x1000',
    motion_preference: reducedMotion ? 'reduce' : 'no-preference',
    evidence_class: mobile ? 'emulation-only' : 'local-desktop-browser',
    cold,
    warm_iterations: warm,
    warm_summary: summarizeOpenRuns(warm, timingKeys),
    route_actions: routeActions,
    route_action_summary: routeActions.length ? {
      handler_sync_ms: summarizeTimings(routeActions.map(({ handler_sync_ms: value }) => value)),
      two_frame_commit_ms: summarizeTimings(routeActions.map(({ two_frame_commit_ms: value }) => value)),
      total_long_tasks: routeActions.reduce((total, { long_task_count: count }) => total + count, 0),
      max_long_task_ms: Math.max(0, ...routeActions.map(({ max_long_task_ms: value }) => value)),
    } : null,
    context_recovery: contextRecovery,
    idle,
    final_resources: finalTelemetry.resources,
    errors,
  };
}

export async function runBrowserProfile({
  idleMs = 5_000,
  warmIterations = 3,
  interactionIterations = 5,
  candidateRoot = ROOT,
} = {}) {
  const resolvedCandidateRoot = resolve(candidateRoot);
  const trackedStatus = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
    cwd: resolvedCandidateRoot,
    encoding: 'utf8',
  }).trim();
  if (trackedStatus) throw new Error(`candidate root has tracked dirt:\n${trackedStatus}`);
  const distIndexPath = resolve(resolvedCandidateRoot, 'dist/index.html');
  await access(distIndexPath);
  const distIndex = await readFile(distIndexPath);
  const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: resolvedCandidateRoot, encoding: 'utf8' }).trim();
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const preview = spawn(process.execPath, [VITE_BIN, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: resolvedCandidateRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  preview.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  let browser = null;
  try {
    await waitForPreview(baseUrl, preview);
    browser = await chromium.launch({ headless: true });
    return {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      browser: 'chromium',
      candidate: {
        git_head: gitHead,
        dist_index_sha256: createHash('sha256').update(distIndex).digest('hex'),
      },
      preview: 'production-vite-dist',
      candidate_root: resolvedCandidateRoot,
      third_party_tiles: 'stubbed-transparent-1px',
      service_workers: 'blocked-for-browser-cache-isolation',
      limitations: [
        'mobile-emulation-is-not-physical-device-evidence',
        'chromium-js-heap-is-not-gpu-memory-evidence',
        'third-party-raster-network-cost-is-excluded',
      ],
      desktop_leaflet: await profileMode(browser, baseUrl, 'leaflet', { warmIterations, interactionIterations, idleMs }),
      desktop_terrain: await profileMode(browser, baseUrl, 'terrain', { warmIterations, interactionIterations, idleMs }),
      desktop_terrain_reduced_motion: await profileMode(browser, baseUrl, 'terrain', {
        reducedMotion: true,
        warmIterations,
        interactionIterations,
        idleMs,
      }),
      mobile_emulated_terrain: await profileMode(browser, baseUrl, 'terrain', {
        mobile: true,
        warmIterations,
        interactionIterations,
        idleMs,
      }),
    };
  } catch (error) {
    if (stderr) error.message += `\nvite preview stderr:\n${stderr}`;
    throw error;
  } finally {
    if (browser) await browser.close();
    await stopPreview(preview);
  }
}

async function main() {
  const idleMs = parsePositiveInteger(argValue('--idle-ms'), 5_000, '--idle-ms');
  const warmIterations = parsePositiveInteger(argValue('--warm-iterations'), 3, '--warm-iterations');
  const interactionIterations = parsePositiveInteger(argValue('--interaction-iterations'), 5, '--interaction-iterations');
  const candidateRoot = argValue('--candidate-root') ? resolve(ROOT, argValue('--candidate-root')) : ROOT;
  const result = await runBrowserProfile({ idleMs, warmIterations, interactionIterations, candidateRoot });
  const output = argValue('--output');
  if (output) {
    const path = resolve(ROOT, output);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(result, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
