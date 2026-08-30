import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  routeEvidence as defaultRouteEvidence,
  routeProfilePolyline as defaultRouteProfilePolyline,
} from '../../src/routes.js';
import { classifyMainThreadWork, measureIterations, parsePositiveInteger } from './lib.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function loadRouteProfiles(candidateRoot = ROOT) {
  const graphPath = resolve(candidateRoot, 'data/graph.json');
  const raw = await readFile(graphPath);
  const graph = JSON.parse(raw.toString('utf8'));
  const edges = (graph.edges ?? []).filter((edge) => Array.isArray(edge.elevation_profile_m));
  const profiles = edges.map((edge) => edge.elevation_profile_m.filter(Number.isFinite));
  return {
    graph_sha256: sha256(raw),
    edges,
    profiles,
    total_samples: profiles.reduce((total, profile) => total + profile.length, 0),
    max_profile_samples: Math.max(0, ...profiles.map((profile) => profile.length)),
  };
}

export function runRoutePresentationBatch(
  edges,
  {
    routeEvidence = defaultRouteEvidence,
    routeProfilePolyline = defaultRouteProfilePolyline,
  } = {},
) {
  let checksum = 0;
  for (const edge of edges) {
    const evidence = routeEvidence(edge);
    const profile = routeProfilePolyline(evidence.elevationProfileM);
    checksum += profile.points.length;
    checksum += evidence.surfaces.length;
    checksum += evidence.containsSteps ? 1 : 0;
  }
  return checksum;
}

function expandWorkload(edges, multiplier) {
  if (multiplier <= 1) return edges;
  const expanded = [];
  for (let index = 0; index < multiplier; index += 1) expanded.push(...edges);
  return expanded;
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function resolveCandidate(candidateRoot, { requireCleanCandidate = false } = {}) {
  const root = resolve(candidateRoot);
  const trackedStatus = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  if (requireCleanCandidate && trackedStatus) {
    throw new Error(`candidate root has tracked dirt:\n${trackedStatus}`);
  }

  const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const routesPath = resolve(root, 'src/routes.js');
  const routesBytes = await readFile(routesPath);
  const operations = root === resolve(ROOT)
    ? { routeEvidence: defaultRouteEvidence, routeProfilePolyline: defaultRouteProfilePolyline }
    : await import(`${pathToFileURL(routesPath).href}?bergpark-perf=${Date.now()}`);

  if (typeof operations.routeEvidence !== 'function' || typeof operations.routeProfilePolyline !== 'function') {
    throw new Error('candidate routes module does not expose the required performance operations');
  }

  return {
    root,
    git_head: gitHead,
    tracked_clean: trackedStatus.length === 0,
    routes_sha256: sha256(routesBytes),
    operations: {
      routeEvidence: operations.routeEvidence,
      routeProfilePolyline: operations.routeProfilePolyline,
    },
  };
}

export async function runComputeBenchmark({
  samples = 80,
  warmup = 20,
  stressMultiplier = 10,
  candidateRoot = ROOT,
  requireCleanCandidate = false,
} = {}) {
  const candidate = await resolveCandidate(candidateRoot, { requireCleanCandidate });
  const input = await loadRouteProfiles(candidate.root);
  const actual = await measureIterations(
    () => runRoutePresentationBatch(input.edges, candidate.operations),
    { samples, warmup },
  );
  const stressEdges = expandWorkload(input.edges, stressMultiplier);
  const stress = await measureIterations(
    () => runRoutePresentationBatch(stressEdges, candidate.operations),
    {
      samples: Math.max(20, Math.floor(samples / 2)),
      warmup: Math.max(5, Math.floor(warmup / 2)),
    },
  );
  const actualClassification = classifyMainThreadWork(actual.timings.p95_ms);

  return {
    schema_version: 2,
    generated_at: new Date().toISOString(),
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    candidate: {
      root: candidate.root,
      git_head: candidate.git_head,
      tracked_clean: candidate.tracked_clean,
      routes_sha256: candidate.routes_sha256,
      graph_sha256: input.graph_sha256,
    },
    input: {
      graph_sha256: input.graph_sha256,
      route_edges: input.edges.length,
      elevation_profiles: input.profiles.length,
      elevation_samples: input.total_samples,
      max_profile_samples: input.max_profile_samples,
      authority: 'precomputed route elevation profiles from data/graph.json',
    },
    actual_product_batch: {
      description: 'one presentation transform of every currently shipped route edge/profile',
      ...actual,
      classification: actualClassification,
    },
    synthetic_stress_batch: {
      description: `${stressMultiplier}x repeated shipped route batch; stress evidence only`,
      multiplier: stressMultiplier,
      route_transforms_per_iteration: input.edges.length * stressMultiplier,
      ...stress,
      classification: classifyMainThreadWork(stress.timings.p95_ms),
    },
    specialization_decision: actualClassification.hotspot
      ? 'investigate-ordinary-js-or-worker-boundary'
      : 'no-runtime-route-compute-hotspot-worker-or-wasm-not-earned',
  };
}

async function main() {
  const samples = parsePositiveInteger(argValue('--samples'), 80, '--samples');
  const warmup = parsePositiveInteger(argValue('--warmup'), 20, '--warmup');
  const stressMultiplier = parsePositiveInteger(argValue('--stress-multiplier'), 10, '--stress-multiplier');
  const candidateRoot = argValue('--candidate-root') ? resolve(ROOT, argValue('--candidate-root')) : ROOT;
  const result = await runComputeBenchmark({
    samples,
    warmup,
    stressMultiplier,
    candidateRoot,
    requireCleanCandidate: true,
  });
  const output = argValue('--output');
  if (output) {
    const path = resolve(ROOT, output);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(result, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entry === import.meta.url) main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
