export const MAIN_THREAD_HOTSPOT_MS = 50;
export const WASM_MIN_SPEEDUP_RATIO = 1.5;

export function percentile(values, quantile) {
  if (!Array.isArray(values) || values.length === 0) return null;
  if (!(quantile >= 0 && quantile <= 1)) throw new RangeError('quantile must be within [0, 1]');
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(quantile * sorted.length) - 1));
  return sorted[index];
}

export function summarizeTimings(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return { samples: 0, min_ms: null, p50_ms: null, p95_ms: null, max_ms: null, mean_ms: null };
  }
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    samples: values.length,
    min_ms: Math.min(...values),
    p50_ms: percentile(values, 0.5),
    p95_ms: percentile(values, 0.95),
    max_ms: Math.max(...values),
    mean_ms: sum / values.length,
  };
}

export function classifyMainThreadWork(p95Ms, thresholdMs = MAIN_THREAD_HOTSPOT_MS) {
  if (!Number.isFinite(p95Ms)) return { measured: false, hotspot: false, threshold_ms: thresholdMs };
  return {
    measured: true,
    hotspot: p95Ms >= thresholdMs,
    threshold_ms: thresholdMs,
    p95_ms: p95Ms,
  };
}

export function evaluateWasmSpeedup({ baselineMs, wasmMs, minimumRatio = WASM_MIN_SPEEDUP_RATIO }) {
  if (!(baselineMs > 0) || !(wasmMs > 0)) {
    return { measured: false, retain_for_speed: false, minimum_ratio: minimumRatio, speedup_ratio: null };
  }
  const speedupRatio = baselineMs / wasmMs;
  return {
    measured: true,
    retain_for_speed: speedupRatio >= minimumRatio,
    minimum_ratio: minimumRatio,
    speedup_ratio: speedupRatio,
  };
}

export async function measureIterations(fn, { warmup = 10, samples = 50 } = {}) {
  for (let index = 0; index < warmup; index += 1) await fn();
  const durations = [];
  let checksum = 0;
  for (let index = 0; index < samples; index += 1) {
    const started = performance.now();
    checksum += Number(await fn()) || 0;
    durations.push(performance.now() - started);
  }
  return { timings: summarizeTimings(durations), checksum };
}

export function parsePositiveInteger(value, fallback, name) {
  if (value == null) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}
