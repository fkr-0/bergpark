# Implementation review

This document records a broad implementation review of the Bergpark repository
at the post-`0.1.0-alpha.1` / post-tree-enrichment state. It is intentionally
more critical than the public README: the purpose is to expose architectural
risks and turn them into testable work.

## Snapshot reviewed

Durable repository facts at review time:

- public alpha release exists and GitHub Pages deployment is configured;
- 30 canonical place nodes;
- 122 directed visitor walking edges;
- 569 catalogued tree records at commit `9d5194f`;
- 215 first-class bench POIs at commit `3882f92`;
- explicit path-topology projection at commit `97335ba`: 1,408 path nodes and
  2,858 directed segments over the already-qualified landmark routes;
- 83 DE and 83 EN content IDs in the reviewed knowledge working set, with key parity;
- 50 source-registry entries in that reviewed knowledge working set;
- semantic source/evidence guardrails committed at `d1b98f1`; semantic entity/relation
  outputs were still an active claimed working tranche during this review;
- combined `graph.json` currently embeds 30 places / 122 edges but 0 trees,
  0 benches, 0 figures, 0 semantic edges and 0 path-topology entities;
- at the review snapshot, Pages used a legacy package-manager check that covered
  Node tests and the Vite build but not the Python data validators/tests; this was
  later superseded by the pnpm release gate.

The working tree contains concurrent knowledge/research activity. Findings here
do not authorize edits to those claimed paths.

## Current reconciliation — 2026-08-31

The original review snapshot is historical. At current HEAD the major P0/P1
foundations have materially advanced:

- `scripts/compose_graph.py` is the composition-only owner of `data/graph.json`;
  the current aggregate carries 23 figures, 14 artworks, 3 collections and 54
  semantic edges alongside trees, benches, path topology and visitor POIs, with
  composition input-hash evidence;
- the runtime-data manifest is the shared publish/load/precache/artifact authority
  for 11 shipped layers and the production artifact gate is budgeted/fail-closed;
- Phase-8 walking topology is 2,633 path nodes / 7,196 directed segments over 955
  included pedestrian-eligible OSM ways in the bounded preserved-source scope;
- graph-side route comparison retains shortest, lower-ascent and avoid-known-steps
  policies, while the visitor UI now also computes deterministic multi-hop routes over
  the published walking network using shortest-distance and avoid-mapped-steps profiles;
  this remains bounded source-snapshot routing, not a physically complete or certified
  accessible park router;
- GPS proximity now uses reported accuracy plus entry/exit hysteresis;
- trees have bounded filterable catalogue results, clustered/individual map
  presentation and evidence-aware detail; benches and visitor POIs are selective
  runtime layers, and semantic entities expose relation traversal with source context;
- route detail exposes mapped-path/access uncertainty and DGM1-derived elevation
  evidence, including a lazy profile that fails accessibly and remains retryable;
  the MapLibre/DGM1/shared-depth stack is now integrated as an explicit opt-in renderer
  with Leaflet retained as the default compatibility path;
- `pnpm run check` currently covers Biome, Node/Vitest, 87 Python integrity tests,
  Vite build and runtime-artifact validation; Chromium E2E remains the broader
  `check:e2e` gate.

Unannotated findings below should therefore be read as historical review context,
not as proof that the defect is still present. Remaining high-value work is source/
editorial freshness and schema policy, beta browser/device qualification, measured
performance/release convergence, and keeping the new bounded routing policy explicit
about incomplete topology and unknown accessibility evidence.

## P0 findings

### 1. Layer generation needs a durable composition boundary

At the durable HEAD first reviewed, `scripts/build_graph.py` still initialized and
wrote empty `trees.json`, `figures.json` and `semantic.json` documents. During this
review the active Phase-3 recovery began correcting that: its claimed working diff
reads curated tree/semantic layers and stops overwriting those files. That removes
the immediate destructive behavior once committed, but benches and path topology are
still separate and composition remains embedded in the spatial builder.

**Risk:** without one explicit composition contract, new layer producers can drift,
be omitted from `graph.json`, or become coupled to unrelated spatial regeneration.

**Required change:** finish the non-destructive Phase-3 correction, then separate
spatial generation from graph composition. Each builder owns one layer; a composer
reads validated, schema-compatible layer files and produces `graph.json` plus an
input-hash/runtime manifest.

### 2. `graph.json` is not yet the canonical aggregate it appears to be

At the durable HEAD reviewed, the combined export contains zero trees/benches/path
topology even though those standalone layers are durable. The active Phase-3 working
diff composes trees and the semantic tranche, but benches and path topology remain
outside `graph.json`.

**Risk:** downstream consumers choosing `graph.json` can receive a materially
incomplete representation with no machine-readable indication that other layer
files are newer/more complete.

**Required change:** composition must assert expected layer versions/counts and
record the exact input hashes used to build the combined export.

### 3. Runtime data contract does not include future graph layers

`src/data.js` requires only `nodes.json`, `edges.json`, and `trees.json`; it can
optionally load bilingual content and sources. It does not load `figures.json`,
`semantic.json`, `graph.json`, the durable bench layer, or the durable
`path_topology.json` projection.

**Risk:** research/data work can become “complete” without becoming visible or
usable in the visitor application.

**Required change:** define a versioned runtime data manifest or explicit layer
loader and make all release-shipped layers part of offline packaging and tests.

**Runtime resolution (2026-08-28):** contract v1 at
`runtime/runtime-data-manifest.json` is now the publish/load/precache/artifact
authority for nodes, edges, trees, bilingual content, sources, figures, semantic
data, benches, visitor POIs and the derived walking network. Aggregate/audit-only
`graph.json`, `path_topology.json` and `validation.json` remain excluded from the
visitor artifact. The independent graph-composition integrity failure tracked by
`tests/test_semantic.py:136` is not waived by this runtime resolution.

### 4. Deployment CI does not validate the full data product

At the review snapshot, `.github/workflows/pages.yml` used the legacy partial
frontend check. The current release path is pnpm-authoritative and includes Python
repository-integrity tests before deployment.

**Risk:** a broken committed data layer can deploy if the browser build still
succeeds.

**Required change:** one repository verification command and one CI workflow
must cover all shipped validators/tests before Pages deployment.

## P1 findings

### 5. Explicit path topology exists, but runtime navigation is still direct-edge lookup

`97335ba` adds a carefully qualified path-topology projection (1,408 nodes /
2,858 directed segments), but `edgeBetween()` still returns only one precomputed
place adjacency and the browser does not route over the low-level topology. The
path export itself explicitly covers the selected landmark-route projection, not
the full walkable park network.

**Risk:** many reachable destinations cannot be routed unless they happen to be
one of the selected adjacency pairs, and treating the new projection as a full
park router would overstate its coverage.

**Required change:** extend topology coverage deliberately, then run multi-hop
routing over the validated topology while keeping the projection/full-network
scope distinction machine-readable.

**Current resolution (2026-08-31):** visitor-facing multi-hop routing is now landed
on the manifest-published walking-network projection. The runtime resolves canonical
place anchors and offers deterministic shortest-mapped-distance and avoid-mapped-steps
profiles without mutating factual segment metadata. Route detail preserves surface,
step, barrier and endpoint unknowns plus the bounded Phase-8 source-snapshot caveat;
“avoid mapped steps” is explicitly not a guarantee of a step-free route.

### 6. Place position provenance is weaker than the new tree/bench contract

Places use `coordinate_confidence` (`high`/`medium`) and `coordinate_method`, but
no common `position_source` object with numeric/unknown horizontal accuracy.
Trees already explicitly state that OSM source accuracy is not reported.

**Risk:** “high confidence” may be mistaken for measured positional accuracy.

**Required change:** normalize all coordinate-bearing entities onto the same
position-source/accuracy vocabulary.

### 7. GPS arrival logic ignores reported location accuracy

The current GPS navigator uses a fixed 30 m nearest-node radius and resets entry
state immediately when no node is inside the radius.

**Risk:** coarse/noisy GPS can trigger false arrivals or repeated enter/leave
flapping; representative landmark points may not coincide with physical visitor
entrances.

**Required change:** incorporate `coords.accuracy`, hysteresis and access-point
semantics.

### 8. Service-worker future-layer coverage is incomplete

The service worker pre-caches only nodes, bilingual content, sources, edges and
trees. It does not yet include semantic/figures/benches or a versioned runtime
manifest.

**Risk:** new layers can work online but disappear or become schema-incompatible
offline.

**Required change:** make runtime data caching driven by the same release/runtime
manifest used by the application.

**Runtime resolution (2026-08-28):** `bergpark-shell-v6` fetches and validates the
published runtime manifest during install and derives its data precache from the
manifest. Release-required layers fail the install if they cannot be cached.

### 9. Service-worker caching/fallback behavior needs explicit qualification

The service worker only caches a fetched tile when `response.ok` is true.
Cross-origin image requests can produce opaque responses in browsers; opaque
responses have status 0 and are not `ok`. In addition, the generic same-origin
`networkFirst()` catch path falls back to cached `./` for any request type. A
missing offline JSON layer can therefore receive HTML instead of an explicit
data-miss response.

**Risk:** visited-tile caching may not behave consistently across providers/
browsers, and an uncached offline data request can fail later as an HTML-as-JSON
parse error rather than a clear unavailable-layer state.

**Required change:** test the built service worker against real request modes,
use request-type/content-aware fallbacks, and handle opaque tile responses only
where provider policy and browser behavior permit caching them.

**Runtime resolution (2026-08-28):** data, navigation and static fallback paths
are separate. Data caches only successful JSON; HTML-on-data becomes JSON 502 and
an uncached offline miss becomes JSON 503. Opaque responses from the explicitly
recognized OSM/OpenTopoMap tile hosts are accepted into the bounded visited-tile
cache. Node SW tests cover the opaque path and v5→v6 cache cleanup; Chromium
browser coverage exercises warmed offline data plus an explicit uncached data
miss. Firefox still has the already documented Playwright synthetic-offline
`NS_ERROR_OFFLINE` limitation; WebKit remains host-library-blocked on Arch.

### 10. Generated timestamps weaken exact reproducibility

Generated JSON includes current timestamps. Exact output hashes therefore change
on a rebuild even when source snapshots and semantic data do not.

**Risk:** exact-hash qualification becomes difficult to reproduce and diff noise
obscures substantive changes.

**Required change:** support deterministic build metadata (`SOURCE_DATE_EPOCH`,
source-revision timestamp, or a separate non-content manifest).

**Runtime resolution (2026-08-28):** runtime release metadata is separate from
layer bytes and derives only from explicit `SOURCE_DATE_EPOCH` and source revision
inputs. Pages sets these from the checked-out commit; local builds without such
authority record `null` rather than using wall-clock time.

### 11. Snapshot counts are embedded as code assertions

Tree and bench builders currently assert exact expected counts (569 trees,
215 benches in the current bench implementation).

The tree count is meaningful because it comes from a preserved catalogue ID set,
but even there the expected authority belongs in a source manifest rather than a
magic number distributed through code/tests. For OSM-derived benches, a source
refresh will legitimately change the count.

**Required change:** move expected snapshot/cardinality authority into input
manifests and validate against those manifests.

### 12. No formal public layer schemas/migrations

Data files carry `schema_version`, but there is no central JSON Schema/equivalent
contract or migration policy.

**Risk:** producers and browser consumers can drift independently.

**Required change:** formalize per-layer schema and compatibility rules before
schema v2 routing/composition lands.

## P2 findings

### 13. Tree runtime is list-first and map-detail-light

The tree explorer can filter and select a tree, but selection only flies the map
to its coordinates. Trees are not a dedicated clustered map layer and there is
no full tree detail sheet presenting provenance, catalogue data, circumference,
start date or explicit unknown height.

**Current resolution (2026-08-31):** the historical limitation is resolved. The
runtime keeps the result DOM bounded while filtering, renders deterministic tree
clusters/individual markers with keyboard activation, and exposes an evidence-aware
tree detail sheet. Catalogue circumference/start-date fields are shown only when
sourced; missing specimen height remains explicitly unknown rather than inferred.

### 14. Bench runtime integration does not exist yet

The bench dataset is now durable (215 POIs at `3882f92`) but is not copied by
`scripts/copy-data.mjs`, loaded by `src/data.js`, cached by the service worker or
rendered as a map layer.

**Current resolution (2026-08-31):** benches are now manifest-authorized runtime
visitor features, hydrated through the selective visitor-layer adapter, available
offline when shipped/warmed, and rendered only when the visitor enables the layer.
The selective/opt-in policy remains intentional to keep the map bounded.

### 15. Semantic content is not navigable as graph structure

`src/data.js` creates “content-only entities” from bilingual content files, but
there is no first-class semantic relation traversal in the runtime. Figures,
artworks and collections cannot yet drive related-entity navigation.

**Current resolution (2026-08-31):** first-class semantic traversal is landed.
The runtime adapter exposes figures, artworks and collections plus bidirectional
relation links, preserves canonical IDs, and carries qualification/source context
into visitor detail. The composed graph currently contains 23 figures, 14 artworks,
3 collections and 54 semantic edges; editorial/source freshness remains separate
release work.

### 16. Route evidence is richer in JSON than in the UI

The data now distinguishes step sections, surfaces, grade, mapped-path access and
unknown endpoint access. The route UI currently shows distance and walking time
only.

**Current resolution (2026-08-31):** route detail now surfaces mapped-path access,
known/unknown step and endpoint-access evidence, semantic links, and DGM1-derived
terrain/elevation summaries. The detailed DGM1 profile remains lazily loaded; a
chunk failure preserves the summary, exposes a bilingual retry state, and does not
invent missing accessibility/elevation facts. Multi-hop planning is now available
for canonical place anchors over the bounded walking-network projection; remaining
limitations are incomplete physical coverage, unknown accessibility/barrier evidence,
and the absence of a certified accessible or live turn-by-turn navigation guarantee.

### 17. Browser/a11y qualification is reproducible from the repo

Resolved for the alpha.2 release boundary: the repository now carries a
Playwright Chromium smoke suite plus Axe serious/critical checks, and both the
normal CI workflow and the GitHub Pages deployment run them after Node/Python
integrity checks and the production build. The browser suite covers language
switching, index search, deep links, route selection and a warmed offline reload.
Third-party map tiles are deliberately suppressed so CI validates Bergpark
behavior without crawling providers or depending on their availability.

**Remaining beta work:** add Firefox and iOS Safari/WebKit production
qualification and retain manual device/accessibility review where automation is
not sufficient.

### 18. Source refresh/change detection is ad hoc

Raw source snapshots are preserved well, but there is no general source-refresh
manifest showing previous/current source revision, added/removed IDs and
material field changes.

**Opportunity:** a source-diff report would make OSM/content maintenance safer.

## Strengths worth preserving

The review also found several strong implementation choices:

- source snapshots are preserved locally rather than relying on live APIs at runtime;
- graph IDs are stable and compatibility aliases are explicit;
- route edges are directed and reverse elevation/incline semantics are tested;
- unknown endpoint accessibility is not promoted into a false step-free claim;
- terrain elevation is explicitly identified as coarse GLO-90 data;
- tree specimen height remains unknown rather than inferred from species descriptions;
- map text is escaped before HTML insertion and external media URLs are protocol-checked;
- tile caching is deliberately bounded and there is no bulk OSM prefetch;
- the PWA remains usable without GPS;
- source-derived and bilingual content concerns are separated from the spatial builder.

## Recommended implementation order

1. Keep the new bounded multi-hop routing contract narrow and release-qualified:
   preserve source-coverage/access unknowns and add routing profiles only when the
   published evidence can support their semantics.
2. Formalize public layer schema/migration policy and source-refresh change reports so
   future OSM/content updates cannot silently drift producer/runtime contracts.
3. Complete bilingual editorial/source-freshness gates, especially volatile visitor facts
   and media/source licensing metadata.
4. Qualify Firefox plus iOS Safari/WebKit and retain explicit offline-upgrade/device gates.
5. Measure the optional MapLibre/DGM1/shared-depth path on representative mobile hardware;
   keep Leaflet as a first-class compatibility/low-power fallback until parity is proven.
6. Reconcile version, changelog and release evidence before the next deployment from the
   current branch, which is substantially ahead of the published alpha boundary.

The phase mapping and acceptance criteria are maintained in `ROADMAP.md`.
