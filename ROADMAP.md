# Bergpark Wilhelmshöhe roadmap

Bergpark is being developed as three cooperating products:

1. a source-grounded spatial and semantic knowledge graph;
2. a bilingual, offline-capable visitor PWA;
3. a reproducible public-data research/build pipeline.

The end state is not merely a map with landmark cards. The target is a durable,
auditable park model in which places, paths, trees, amenities, historical people,
artworks and collections can be queried and navigated without losing provenance,
accuracy limits or source distinctions.

Release progression is evidence-driven. A phase is complete only when its data,
validation, runtime compatibility and provenance gates are all durable.

## Current baseline — development toward 0.1.0-rc.1

Durable capabilities at the current repository boundary include:

- [x] public PWA at `bergpark.fkr.dev` and GitHub Pages release workflow;
- [x] 30 canonical visitable place nodes;
- [x] 122 directed / 61 bidirectional visitor walking edges;
- [x] OSM segment-level surface/accessibility metadata with directed incline semantics;
- [x] GLO-90 terrain elevation for places and route profiles;
- [x] explicit distinction between mapped-path accessibility and unknown endpoint snaps;
- [x] bilingual DE/EN visitor content runtime and TTS;
- [x] GPS proximity navigation with manual fallback;
- [x] searchable place/entity index;
- [x] 569 catalogued trees with stable IDs, coordinates, terrain elevation and source provenance;
- [x] 215 first-class bench POIs from the preserved OSM snapshot, with terrain elevation and explicit source-accuracy limits;
- [x] 109 selective visitor POIs plus bounded tree/bench/visitor-layer rendering in the PWA;
- [x] Graph Phase 8 walking topology with 2,633 path nodes / 7,196 directed segments over a bounded frozen-source scope of 955 included pedestrian-eligible OSM ways, while physical inventory completeness remains explicitly unproven;
- [x] semantic source/evidence guardrail manifest for the Phase-3 relation tranche;
- [x] semantic figures/artworks/relations composed without changing producer schemas and exposed through runtime compatibility adapters;
- [x] tree/bench/path-topology layers preserved through the non-destructive composition boundary;
- [x] a non-destructive graph composition pipeline for independently generated layers;
- [x] graph-side shortest and avoid-known-steps/lower-ascent routing over the bounded Phase-8 topology;
- [x] repository-wide pnpm verification commands covering Node/Vitest, Python integrity tests and the runtime build; repeated expanded Chromium qualification remains non-green at 58–59/60 and therefore still blocks the RC tag;
- [x] bilingual nature-first almanac/discovery journeys spanning places, stories, trees, visitor features and bounded walking-network discovery;
- [x] optional MapLibre/WebGL2 terrain renderer with shared-depth Three.js heritage presentation, same-session renderer switching, and fail-closed Leaflet fallback;
- [x] offline runtime-manifest packaging, warmed visitor PWA behavior and conservative reduced-motion/a11y browser qualification;
- [ ] physically complete park walking inventory; the preserved Phase-8 source boundary includes an explicit unchecked-boundary caveat and must not be promoted to complete coverage;
- [ ] real iOS Safari/WebKit qualification;
- [ ] physical-mobile thermal/battery/GPU-memory characterization and real assistive-technology/screen-reader fixture qualification.

The most important architectural rule remains that independently owned layers must
not be destroyed by another layer's generator. That separation is now durable through
the composition boundary and Graph Phase 8. Future source refreshes must preserve the
frozen-source completeness caveat, stable IDs and producer ownership rather than
silently regenerating unrelated content/runtime layers.

### Development toward rc.1 beyond public alpha.2

The current branch contains the following work beyond the latest public tag, `v0.1.0-alpha.2`. A September 1 candidate snapshot passed the then-current 57/57 Chromium matrix, but subsequent application changes expanded the matrix to 60 tests and repeated current qualification remains non-green at 58–59/60, so the RC label is withheld:

- DGM1-derived route elevation summaries/profiles with explicit provenance and
  conservative interpretation of short-segment slope;
- renderer-neutral `SpatialWorld` descriptors and an optional MapLibre/WebGL2
  terrain path that coexists with the Leaflet compatibility/fallback surface;
- shared-depth Three.js heritage rendering with bounded asset/runtime LOD policy;
- visitor discovery/search improvements spanning places, stories, trees, visitor
  features and walking-network context;
- runtime-data/PWA upgrade hardening and measured performance/specialization
  evidence without making browser WASM a prerequisite.

These capabilities remain implemented at the repository boundary, but RC
qualification is not current until the browser matrix returns green. They also remain
subject to the explicit external/manual gates above. Deployment is intentionally
separate and requires operator authorization.

---

## Phase 3 — source-grounded semantic layer

**Goal:** make historical people, designers, artworks, collections and explicit
relationships first-class graph entities.

### Scope

- Populate `data/figures.json` with stable entity IDs and source-backed names,
  dates/roles, aliases and source references.
- Populate `data/semantic.json` with typed relations carrying source IDs,
  confidence/evidence status and, where necessary, temporal qualification.
- Model artworks as entities rather than text-only attributes.
- Model collections/gallery membership separately from authorship and commission.
- Preserve historical nuance, especially phased construction/replacement where
  the extant object is not identical to an earlier design.
- Compose semantic entities into `data/graph.json` without changing stable place IDs.

### Acceptance

- all semantic edge endpoints resolve;
- duplicate or contradictory relation IDs fail validation;
- every asserted relation has at least one source reference;
- inferred/ambiguous relations are explicitly marked instead of silently promoted;
- Node/runtime compatibility remains green;
- semantic tests are included in the normal repository verification gate.

---

## Phase 4 — layer composition and schema v2 foundation

**Status: durable.** `scripts/compose_graph.py` is the composition-only owner of
`data/graph.json`; it validates layer compatibility/counts and records exact input
hashes. Runtime publication is separately driven by the versioned runtime-data
manifest.

### Historical problem removed

The durable pre-Phase-3 place/path builder owned output initialization for trees,
figures and semantic edges. That destructive ownership model has been removed:
independent builders now retain their own outputs and the composer assembles the
aggregate without regenerating those layers.

### Deliverables

- Introduce an explicit composition stage, e.g. `scripts/compose_graph.py` or a
  small build orchestrator.
- Make each generator own only its layer output:
  - places/routes → `nodes.json`, `edges.json`;
  - trees → `trees.json`;
  - benches → `benches.json`;
  - figures → `figures.json`;
  - semantic relationships → `semantic.json`.
- Make `graph.json` a pure composed artifact assembled from validated layer files.
- Add layer schema versions and composition compatibility checks.
- Add a machine-readable build/source manifest recording input hashes and
  generator versions/commits.
- Add a fail-closed rule: missing required layers cannot be silently replaced by
  empty placeholders in a release build.

### Acceptance

- rerunning the spatial graph builder cannot modify trees/semantic/bench files;
- graph composition is idempotent for identical inputs apart from explicitly
  documented build metadata;
- stale/incompatible layer schema versions are rejected;
- composed counts exactly match source layer counts.

---

## Phase 5 — explicit routing topology and general routing

**Current status:** the original `97335ba` landmark-route projection has been
superseded by durable Graph Phase 8: 2,633 path nodes and 7,196 directed segments
cover the explicitly bounded preserved-source scope of 955 included pedestrian-
eligible OSM ways. Graph-side shortest/lower-ascent/avoid-known-steps routing is
qualified over that topology. The source boundary remains explicitly not fully
checked, so physical inventory completeness is still unproven.

**Remaining goal:** expose general multi-hop routing as a visitor-facing navigation
capability without overstating source coverage, endpoint/barrier evidence or route
accessibility.

### Path node model

Create stable path nodes at meaningful topology changes:

- OSM intersections and branch points;
- route entrances/exits and place connection points;
- material surface changes;
- accessibility/barrier changes;
- step starts/ends;
- meaningful gradient changes;
- optional geometry simplification points needed to preserve the actual path.

Each path node should expose at minimum:

`id`, `lat`, `lng`, `elevation_m`, `position_source`, source IDs and accuracy status.

### Directed path segment model

Each directed segment should expose at minimum:

`from`, `to`, geometry/polyline, distance, ascent, descent, average/max grade,
surface, smoothness, width where sourced, steps, access, wheelchair/barrier data,
seasonal/conditional restrictions, traversal-relative incline and source IDs.

### Routing engine

- Compute multi-hop routes instead of requiring one preselected direct edge.
- Keep route weighting separate from factual segment metadata.
- Support profiles such as shortest, lower-ascent and avoid-known-steps without
  claiming accessibility where endpoint/barrier evidence is unknown.
- Preserve current 30 place IDs as stable POI IDs; path-node IDs form a separate namespace.

### Acceptance

Foundation/projection gates already achieved should remain green while the scope expands.
The complete-routing gate additionally requires:

- every segment has a reverse or an explicit one-way reason;
- topology covers the intended complete park walking inventory, not only selected landmark routes;
- topology is connected where the underlying public source is connected;
- path geometry endpoints match path-node coordinates;
- route results reproduce known Phase-2 place connections within explained tolerances;
- routing does not cross private/no-foot OSM ways unless an explicit pedestrian exception applies;
- short segments below terrain-source resolution do not acquire fabricated grade/ascent precision.

---

## Phase 6 — complete spatial POI layers

**Goal:** represent useful visitor objects as first-class data without turning
raw OSM presence into unsupported claims of completeness.

### Durable layers already available

- 569 catalogued historic trees (`9d5194f`);
- 215 benches from the preserved OSM map snapshot (`3882f92`).

### Remaining/expansion layers
- entrances/gates and barrier nodes;
- toilets and accessible toilets where sourced;
- drinking-water points where sourced;
- viewpoints;
- shelters/rest points where sourced;
- relevant public-transport access points at the park boundary;
- optional artworks/statues with actual spatial coordinates where a source supports them.

### Rules

- use stable source-derived IDs when possible;
- every coordinate-bearing object gets the same provenance/accuracy contract;
- absence from a source snapshot must never be described as proof of physical absence;
- physical height is a separate field from terrain elevation;
- do not infer specimen/object dimensions from species descriptions or generic type data.

### Acceptance

- each layer has its own validator and summary report;
- all coordinates are in the research extent or explicitly marked boundary/external;
- source snapshot/version and accuracy status are present;
- runtime can selectively load/disable layers without breaking the base map.

---

## Phase 7 — provenance and accuracy normalization

**Goal:** make source quality machine-readable and consistent across all layers.

### Required model

Replace qualitative-only place confidence with a uniform provenance object:

- source/provider and exact element/document reference;
- source timestamp/retrieval timestamp;
- derivation method (`osm_node`, centroid, bounds midpoint, measured point, etc.);
- `horizontal_accuracy_m` when the source actually reports it;
- explicit `accuracy_status` when accuracy is unknown;
- elevation source, resolution and vertical-accuracy status;
- derived/source-reported distinction for every calculated metric.

For buildings/trees/artworks, keep `height_m` or other physical dimensions
separate from `elevation_m`.

### Acceptance

- no field named or described as “exact” without corresponding accuracy evidence;
- every coordinate-bearing object follows the common position contract;
- representative points are distinguishable from visitor entrances/access points;
- all derived values identify the source values and algorithm that produced them.

---

## Phase 8 — bilingual knowledge completeness and editorial QA

**Goal:** make the knowledge corpus complete enough for a visitor release and
safe enough to maintain over time.

### Deliverables

- complete DE/EN key parity for every visitor-facing canonical/content entity;
- source-backed secondary-landmark descriptions;
- explicit uncertainty and disputed-attribution fields where appropriate;
- dated visitor facts such as hours, fees and access conditions;
- image/file-page/license/creator metadata for Wikimedia media;
- automated broken-source-ID and stale-content checks;
- editorial style rules for names, dates, transliteration and source citations.

### Acceptance

- content parity and source resolution tests are release-blocking;
- no volatile visitor fact ships without `verified_on` and source;
- content aliases resolve to stable graph IDs without duplicate entities;
- machine-generated text is not treated as a primary historical source.

---

## Phase 9 — runtime layer integration

**Goal:** expose the richer graph in the visitor app instead of leaving it only
as research JSON.

### Deliverables

- load semantic, figure and bench layers through a versioned runtime data contract;
- render trees and benches as toggleable map layers;
- add clustering/LOD for hundreds of trees/benches;
- tree detail sheets with species, catalogue reference, circumference/date data,
  position/elevation provenance and explicit unknown specimen height where applicable;
- semantic cross-links in place/person/artwork detail views;
- route profile UI for elevation, surface, step sections and known/unknown access evidence;
- deep links that can restore entity, map view and route state;
- multi-hop routing backed by Phase-5 topology.

### Acceptance

- all runtime-loaded layer files are included in offline/release packaging;
- no layer causes an unusable mobile marker flood;
- semantic links never navigate to unresolved IDs;
- direct-edge-only navigation is no longer the only route mechanism.

---

## Phase 10 — GPS and on-site navigation hardening

### Deliverables

- accuracy-aware proximity logic rather than an unconditional fixed 30 m radius;
- entry/exit hysteresis to prevent GPS flapping;
- distinguish representative landmark points from actual entrances;
- optionally choose the nearest valid access/path node for arrival/navigation;
- expose current GPS accuracy in the UI when it materially affects a trigger;
- test denied permission, coarse location, stale readings and stationary jitter.

### Acceptance

- no repeated enter event under bounded stationary jitter;
- coarse GPS accuracy cannot be presented as precise landmark arrival;
- manual browsing remains fully usable with geolocation disabled.

---

## Phase 11 — offline/PWA reliability

### Deliverables

- include every runtime data layer in the service-worker data strategy;
- verify caching of opaque cross-origin map-tile responses or explicitly document
  when provider/browser behavior prevents it;
- version cache keys from application/data revisions rather than manual edits alone;
- test upgrade from one deployed version to the next;
- add offline-first smoke tests against the built artifact;
- keep tile caching bounded and visitor-driven; never bulk-prefetch third-party tiles;
- add an optional provider-compliant offline park pack only if licensing/usage terms permit it.

### Acceptance

- a previously opened place/tree/semantic detail remains usable offline;
- a service-worker update cannot strand stale incompatible JSON;
- tile policy remains within provider terms and documented limits.

---

## Phase 12 — accessibility and route evidence

### Deliverables

- keyboard, screen-reader and reduced-motion qualification;
- visible route evidence: known steps, rough surfaces, grade, handrail and unknown segments;
- separate “known accessible”, “known not accessible” and “unknown” states;
- entrance/barrier evidence so end-to-end route claims do not rely on straight snap connectors;
- route preferences that are evidence-aware and fail closed when required data is unknown.

### Acceptance

- serious WCAG issues are closed or explicitly release-blocking;
- no route is called wheelchair accessible solely from absence of negative OSM tags;
- unknown evidence remains visible to the visitor.

---

## Phase 13 — performance, map scalability and mobile UX

### Deliverables

- clustering/LOD and lazy rendering for large POI layers;
- measured startup/render budgets on representative mobile hardware;
- code splitting for non-map views and large optional datasets;
- bounded memory behavior after repeated layer/route changes;
- responsive detail sheets and map controls on small screens;
- production qualification on Chromium, Firefox and iOS Safari/WebKit.

### Suggested budgets

Budgets should be evidence-based and adjusted after measurements, but the release
process should track at least initial JS/CSS transfer size, startup time, map
interaction responsiveness and memory growth.

---

## Phase 14 — deterministic data builds and repository-wide CI

**Priority: P0/P1 before beta.**

### Deliverables

- one documented verification command covering Node tests, Python tests,
  validators, composition and Vite build;
- GitHub Actions runs all repository validators/tests through the pnpm release gate, not only the frontend build;
- generated artifacts carry deterministic content where feasible;
- support `SOURCE_DATE_EPOCH` or equivalent for generated timestamps when exact
  rebuild hashes are part of qualification;
- record source snapshot hashes and generator revision in a build manifest;
- add JSON Schema or equivalent structural validators for each public layer;
- detect an uncommitted regenerated diff in CI where appropriate.

### Acceptance

- a broken tree/bench/semantic layer blocks deployment;
- exact source inputs for a release are reconstructable from the repository;
- routine offline rebuilds do not contact external services;
- network fetch scripts are explicit research/update operations, not implicit build steps.

---

## Phase 15 — 0.1.0-alpha.2 integration release

Target this milestone after Phases 3–7 have produced a coherent composed graph.

Release gates:

- semantic layer complete for the explicitly researched core relationships;
- tree and bench layers durable and composition-safe;
- graph composition no longer resets independently generated layers;
- common spatial provenance/accuracy contract documented and validated;
- CI covers all currently shipped layer validators and tests;
- runtime remains backward compatible with alpha.1 links/content aliases.

---

## Phase 16 — 0.1.0-beta.1 visitor beta

Target after Phases 8–14 are sufficiently complete.

Release gates:

- bilingual visitor corpus meets completeness/source gates;
- real multi-hop routing uses explicit path topology;
- trees/benches/semantic entities are usable in the runtime, not just JSON exports;
- offline upgrade behavior is tested;
- keyboard/screen-reader/mobile-browser qualification is green;
- route accessibility language matches evidence strength;
- performance budgets are measured and enforced.

---

## Phase 17 — 0.1.0 release candidate and stable release

### RC gate

- full release checklist in `docs/release-checklist.md` passes;
- all source and schema migrations are documented;
- no known P0/P1 data-integrity defect remains;
- production-domain install/offline/deep-link/route smoke tests pass;
- volatile visitor facts have review dates;
- privacy statement matches actual application behavior.

### Stable gate

- no release-blocking RC regressions;
- a clean checkout can reproduce and validate the shipped graph from preserved inputs;
- public documentation accurately describes known data limits and source coverage;
- release/tag/deployment evidence is durable.

---

## Later research and enhancement tracks

These are deliberately outside the first stable gate unless they become necessary
for correctness:

- curated thematic tours: water engineering, architecture, historic trees,
  collections and landscape design;
- route alternatives optimized for slope/surface/rest opportunities;
- time-aware Wasserspiele visitor guidance based on official schedules;
- structured GeoJSON/JSON-LD/RDF exports for research and heritage systems;
- change-detection tooling for OSM/source refreshes;
- field-survey import with explicit GNSS accuracy and observation provenance;
- optional local-first visitor notes/favourites without third-party analytics;
- richer elevation sources where licensing and resolution support meaningful
  segment-level grade improvements;
- multilingual expansion after DE/EN source/editorial quality is stable.

## Roadmap invariants

Across every phase:

1. Preserve stable public entity IDs or provide explicit aliases/migrations.
2. Never overwrite independently owned valid layer data with placeholders.
3. Never fabricate coordinates, dimensions, access facts or historical relations.
4. Keep terrain elevation separate from physical object height.
5. Keep source facts separate from derived metrics.
6. Treat missing source data as unknown, not false.
7. Keep normal builds offline/reproducible; make network research/fetch operations explicit.
8. Respect OpenStreetMap/tile-provider licenses and usage policy.
9. Preserve concurrent work and commit only the intended ownership scope.
10. Make release claims match observable validation evidence.
