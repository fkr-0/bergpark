import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  classifyMainThreadWork,
  evaluateWasmSpeedup,
  percentile,
  summarizeTimings,
} from '../scripts/perf/lib.mjs';
import { loadRouteProfiles, runRoutePresentationBatch } from '../scripts/perf/compute-bench.mjs';

const budgets = JSON.parse(await readFile(new URL('../benchmarks/performance/budgets.json', import.meta.url), 'utf8'));

test('performance evidence policy pins the architecture hotspot and WASM adoption gates', () => {
  assert.equal(budgets.interaction.main_thread_hotspot_ms, 50);
  assert.equal(budgets.wasm.minimum_hotspot_speedup_ratio, 1.5);
  assert.equal(budgets.wasm.require_worker_js_baseline_first, true);
  assert.equal(budgets.webgpu.required, false);
  assert.equal(budgets.webgpu.baseline_renderer, 'webgl2');
  assert.equal(classifyMainThreadWork(49.99).hotspot, false);
  assert.equal(classifyMainThreadWork(50).hotspot, true);
  assert.equal(evaluateWasmSpeedup({ baselineMs: 15, wasmMs: 10 }).retain_for_speed, true);
  assert.equal(evaluateWasmSpeedup({ baselineMs: 14, wasmMs: 10 }).retain_for_speed, false);
});

test('timing summaries use deterministic nearest-rank percentiles without imposing machine timings on tests', () => {
  const values = [9, 1, 5, 3, 7];
  assert.equal(percentile(values, 0.5), 5);
  assert.equal(percentile(values, 0.95), 9);
  assert.deepEqual(summarizeTimings([]), {
    samples: 0,
    min_ms: null,
    p50_ms: null,
    p95_ms: null,
    max_ms: null,
    mean_ms: null,
  });
});

test('compute harness consumes shipped precomputed route profiles and produces bounded presentation output', async () => {
  const input = await loadRouteProfiles();
  assert.ok(input.edges.length > 0);
  assert.equal(input.edges.length, input.profiles.length);
  assert.ok(input.total_samples >= input.profiles.length * 2);
  assert.ok(input.max_profile_samples > 1);
  const checksum = runRoutePresentationBatch(input.edges);
  assert.ok(Number.isFinite(checksum));
  assert.ok(checksum > 0);
});
