# Bergpark Reimagined performance Phase 1 — evidence and specialization decisions

Status: **COMPLETE / GREEN for the measurement-and-specialization lane**. This does **not** upgrade the older Phase-8 physical-mobile qualification, which remains externally unproven because no representative physical mobile browser/device is attached.

## Candidate and evidence boundary

Both CPU and browser evidence now profile the same clean detached production candidate at Git HEAD `27f5cabefd9e84ebb97fa2918409cbb9c9691c65`; its built `dist/index.html` SHA256 is `81f55f94dd2ae326059f7961b1179e3b84ee2f8cfeb41b2758e0ad8f9aba69ae`.

The compute harness rejects tracked candidate dirt, imports the route-presentation functions from that candidate rather than the shared checkout, and records `src/routes.js` SHA256 `6e01e813b926f9a1b4cf861e31b4a640e3fd0f05c9b7f3b7faa1828865c0d877` plus graph SHA256 `f8375d1c771997ceaa6a58d7818d61f75be10599127da65255b52a249967c2c3`. This closes a real provenance gap in the earlier draft evidence: a benchmark run from the concurrently edited checkout could otherwise measure navigation work that was not part of the clean candidate.

Third-party raster tiles are stubbed so their network variance does not masquerade as Bergpark performance. Canonical terrain/model/runtime assets are still served from the production candidate. Mobile results are Chromium emulation only and are never presented as physical-device thermal, battery, GPU-memory, or sustained-frame acceptance.

Raw repository-local evidence:

- `.ws-bridge/evidence/bergpark-reimagined-performance/phase1-compute.json` — SHA256 `d8f0fdf9f64f3cdb87dd49fd7aecdaec2e2a9ec012a62e9df1cbdd0a767c30de`
- `.ws-bridge/evidence/bergpark-reimagined-performance/phase1-browser.json` — SHA256 `715e06162b464f1fae9279bcdffeee20d72a2890a61a18c30a5b696cbaa3b1b0`

## CPU / route-elevation result

The complete shipped route-presentation workload is small. One iteration transforms all 122 route edges in the clean Phase-1 candidate, backed by 5,518 precomputed DGM1 elevation samples.

| workload | p50 | p95 | max | decision |
| --- | ---: | ---: | ---: | --- |
| all 122 shipped routes | 2.56 ms | **8.30 ms** | 9.60 ms | no 50 ms main-thread hotspot |
| synthetic 10× route repetition | 22.38 ms | **46.23 ms** | 49.07 ms | stress evidence only; product workload is still far below the gate |

The synthetic 10× probe approaches the 50 ms investigation threshold under concurrent host load, but it is deliberately not a product workload and cannot justify specialization. The real complete route batch remains about one sixth of the threshold at p95. This is decisive against moving route elevation/presentation into a Worker or Rust/WASM today. The product already consumes precomputed route elevation derivatives, and the remaining presentation transform is not a coarse blocking compute seam.

## Browser startup, steady state, interaction, and recovery

The current-schema browser replay includes normal desktop terrain, reduced-motion desktop terrain, and mobile-emulated terrain. All modes completed with zero captured page errors and zero settled 5 s resource, JS-heap, or Long-Task growth.

| probe | desktop | mobile emulation | interpretation |
| --- | ---: | ---: | --- |
| Leaflet cold useful view | 409 ms | — | baseline remains inexpensive |
| Leaflet warm useful p95 | 10.05 ms | — | no startup specialization case |
| terrain cold useful frame | 2,631 ms | 3,517 ms | cold progressive load is not the 1.5 s warm SLO and remains variable |
| terrain warm useful p95 | **1,170 ms** | **1,012 ms** | below the 1.5 s warm useful-frame target on this evidence class |
| terrain warm heritage-ready p95 | 2,200 ms | 1,015 ms | bounded but separate from the warm useful-frame budget |
| route handler synchronous p95 | **5.2 ms** | **11.2 ms** | no coarse JS compute hotspot |
| WebGL context recovery | 1,437 ms | 1,042 ms | context loss/restore succeeds in the profile |
| settled JS heap | 44.7 MB | 60.3 MB | below the 150 MiB JS-heap target; not GPU-memory evidence |
| settled 5 s resource delta | 0 | 0 | no resource-count growth in the sampled idle window |
| settled 5 s heap delta | 0 | 0 | no sampled heap growth |
| settled 5 s long-task delta | 0 | 0 | idle path is quiet in the sampled window |

Reduced-motion desktop terrain is also functional and quiet after settling: warm useful-frame p95 is 75.2 ms, warm heritage-ready p95 77.7 ms, synchronous route-handler p95 24.7 ms, context recovery 1,091 ms, settled heap 53.5 MB, and all three settled deltas are zero. Its single cold sample was a 14.2 s useful-terrain outlier. Because each cold invocation is intentionally a fresh-context sample and cold has no retained SLO here, that observation is recorded as startup variability rather than hidden or promoted into a synthetic optimization case. It should be rechecked under isolated/physical-device qualification before any broader release-performance claim.

### Renderer interaction finding

After the synchronous route handler returns, the terrain renderer still shows expensive frame commits:

- normal desktop: two-frame p95 **2,304 ms**, one Long Task entry, maximum 294 ms;
- reduced-motion desktop: two-frame p95 **916.5 ms**, one Long Task entry, maximum 424 ms;
- mobile emulation: two-frame p95 **516.8 ms**, six Long Task entries, maximum 211 ms.

The harness deliberately waits for terrain, heritage, and supplemental-data readiness before starting these samples. The synchronous callbacks remain 5.2/24.7/11.2 ms p95 respectively. The product path then updates MapLibre route data and uses `fitBounds` with the existing terrain camera policy. Therefore this evidence identifies a **renderer/camera interaction cost**, not a route-elevation or other pure-compute seam suitable for Worker/WASM migration. The performance lane does not modify `src/maplibre-map.js`, `src/main.js`, `src/spatial-controller.js`, or renderer integration without the explicit downstream handoff required by the successor ownership contract.

This renderer finding should be consumed by the terrain/integration lane when that owner is ready to test ordinary renderer/camera/data-layout changes first. It is not a reason to introduce WebGPU: the current shared-depth MapLibre host contract remains WebGL2-specific, and no WebGPU quality/performance hypothesis has been demonstrated against the same interaction.

## GitInspect precedent applied

The useful precedent is architectural rather than technological:

- keep domain data and identity renderer-neutral;
- treat LOD as a policy between complete logical data and rendering, never as an identity rewrite;
- label synthetic CPU/layout evidence as CPU/layout evidence instead of GPU/FPS proof;
- prefer ordinary bounded data-layout/transport wins before a new runtime boundary;
- keep any WASM boundary narrow, versioned, testable, and fail-closed rather than copying a Rust codebase into the browser for novelty.

GitInspect's own browser experiment reinforces the boundary: its small `gitinspect-wasm` crate proves a versioned Rust/WASM capability while explicitly refusing to claim native repository authority, and its graph framework keeps Three-specific resources behind rendering adapters. Bergpark should copy those boundary disciplines, not the mere presence of Rust or WASM.

## Specialization matrix

| candidate | Phase-1 disposition | evidence |
| --- | --- | --- |
| ordinary JS route/elevation optimization | **DEFER / no change** | clean shipped route batch is 8.30 ms p95 |
| Worker-JS route/elevation compute | **DO NOT IMPLEMENT** | no >=50 ms product compute hotspot |
| Rust/wasm-bindgen route/elevation compute | **DO NOT IMPLEMENT** | Worker gate not reached; no hotspot from which to demonstrate the required ~1.5× end-to-end win |
| other Worker/WASM candidates | **DEFER until measured** | no current terrain-resampling, spatial-index, quantization, or geometry preprocessing hotspot was proven in the browser runtime |
| WebGPU | **DO NOT IMPLEMENT now** | WebGL2 remains mandatory MapLibre/shared-depth baseline; no same-scene measured win hypothesis exists |
| WebGL2 MapLibre + shared-depth baseline | **KEEP** | current required renderer contract; warm startup, context recovery, idle resource/heap evidence remain bounded |
| terrain route-interaction renderer/camera work | **HAND OFF, ordinary fixes first** | post-handler frame/Long Task evidence is real, but it is renderer-path work outside this lane's current write ownership |

## Phase gating / terminal decision

The user authorized up to five phases, not five mandatory phases. Phase 1 produces enough evidence to gate off the speculative branches:

- Phase 2 has no owned ordinary JS compute/data-layout hotspot to optimize; the renderer interaction finding requires a terrain/integration ownership handoff instead.
- Phase 3 is skipped because the Worker prerequisite is not met, so Rust/WASM evaluation would be technology-driven rather than evidence-driven.
- Phase 4 is skipped because WebGPU has neither an integration-compatible seam nor a measured same-scene win hypothesis.
- The Phase-5 keep/defer/remove decision is recorded here rather than creating dead experimental code merely to delete it later.

No Worker module, WASM crate, WebGPU adapter, product renderer change, accessibility change, offline policy change, or production dependency is retained by this lane.
