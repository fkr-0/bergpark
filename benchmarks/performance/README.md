# Bergpark performance evidence harness

This directory defines the reproducible evidence contract for the
`bergpark-reimagined-performance` successor lane. It deliberately separates product workloads
from stress probes and CPU evidence from GPU/rendering claims.

## Phase-1 commands

Build a clean production candidate first, then point both compute and browser harnesses at
that same candidate. In a shared dirty checkout, use a clean detached worktree instead of
benchmarking concurrent product edits:

    pnpm run build
    node scripts/perf/compute-bench.mjs \
      --candidate-root . \
      --output .ws-bridge/evidence/bergpark-reimagined-performance/phase1-compute.json
    node scripts/perf/browser-profile.mjs \
      --candidate-root . \
      --output .ws-bridge/evidence/bergpark-reimagined-performance/phase1-browser.json \
      --idle-ms 5000 \
      --warm-iterations 3

Both harnesses reject tracked candidate dirt. The compute evidence records the candidate Git
HEAD plus route/graph hashes and imports the route presentation functions from that candidate,
so concurrent navigation edits cannot silently contaminate a clean-baseline result. The browser
harness starts its own production `vite preview` server on an ephemeral localhost port and stubs
only third-party raster map tiles. Canonical Bergpark terrain/model/runtime assets still come
from the built candidate.

The current keep/defer/remove decisions and exact Phase-1 evidence hashes are recorded in
`benchmarks/performance/phase1-decision.md`.

## Evidence rules

- `actual` compute workloads use the currently shipped route profiles. Stress multipliers are
  labeled synthetic and cannot justify a product optimization by themselves.
- A 50 ms p95 main-thread unit is the investigation threshold inherited from the architecture
  interaction target; the harness does not turn machine-specific timing into a brittle test.
- Browser cold and warm results use separate cache semantics. Warm iterations reuse one browser
  context; each harness invocation starts its cold sample from a fresh context. Repeated cold
  qualification comes from repeated isolated invocations, not from relabeling warm reloads.
- Mobile results are **browser emulation only**. They are useful for viewport/touch regression
  and relative comparisons, but they never replace the physical-mobile p95/thermal/battery/GPU
  evidence still missing from the Phase-8 closeout.
- Chromium heap telemetry is recorded where exposed. It is not GPU-memory evidence.
- Long-task/resource deltas are recorded after the scene reaches its ready state so an idle
  render/network loop is visible without inventing FPS from unrelated CPU timings.
- WebGPU is not required and the Phase-1 harness does not initialize it. WebGL2 remains the
  renderer baseline.
- Worker/WASM specialization must start from an actual measured main-thread hotspot. Browser
  WASM additionally needs the architecture gate: Worker-JS baseline first and roughly 1.5x or
  better hotspot speedup after startup/copy costs, unless a separately documented
  maintainability/safety boundary justifies it.

## GitInspect precedent consumed

The harness follows the useful part of GitInspect's precedent: renderer-neutral data stays
outside rendering adapters, LOD must preserve domain identity, synthetic CPU/layout benchmarks
must not be advertised as GPU/FPS evidence, and a WASM boundary is narrow/versioned/fail-closed
rather than a technology-driven rewrite.
