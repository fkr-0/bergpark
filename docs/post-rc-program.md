# Bergpark post-RC execution program

Status: active after the 2026-09-02 Reimagined RC deployment.

This document turns `ROADMAP.md`, `reimagined.md`, the implementation review, and the
release checklist into an execution-oriented program for the next work. It does not
replace those authorities. It narrows them into immediate quality tasks and a larger
beta-to-stable roadmap.

## Product principle

Bergpark should behave first as an excellent outdoor visitor companion and only second as
a showcase for rendering technology.

Order of value:

1. orientation and navigation;
2. trustworthy terrain, route effort and location context;
3. discovery of nature, heritage and useful visitor objects;
4. low-screen-time guidance and optional narration;
5. deep source-grounded exploration through the almanac;
6. 3D/atmosphere only where it improves understanding.

Leaflet remains a first-class 2D/low-power/fallback renderer. MapLibre/DGM1 is the richer
terrain renderer. AR/WebXR and a photoreal digital twin remain non-goals.

## Current strengths to preserve

- 30 canonical visitable places with stable identities;
- DGM1-backed route elevation evidence and a real MapLibre terrain path;
- 2,633 path nodes / 7,196 directed segments in the bounded Phase-8 walking projection;
- 569 catalogued trees, 215 benches and 109 selective visitor POIs;
- bilingual DE/EN content, semantic people/artwork/collection relationships and TTS;
- multi-hop route planning with explicit source-coverage/accessibility limits;
- runtime-manifest-driven offline packaging and upgrade tests;
- renderer-neutral selection/deep-link state and fail-closed Leaflet fallback;
- automated Chromium, data-integrity, build, PWA and accessibility gates.

The recent flat-cascades incident is now a permanent design lesson: a renderer is not
qualified merely because the canvas, tiles and mode switch exist. Product-significant
spatial claims need observable, domain-specific acceptance evidence.

---

## Horizon 0 — immediate post-RC hardening (now → ~2 weeks)

The next work should optimize confidence and visitor clarity before adding broad new
features.

### BPK-QA-01 — production visual and spatial acceptance matrix — P0

Create a small set of canonical views and journeys with screenshot/state evidence on the
deployed origin. Include at minimum:

- cascades side view: Neptunbassin visibly lower than the Herkules end;
- Herkules / cascades axial view;
- Schloss / Löwenburg / Aquädukt terrain views;
- Leaflet ↔ terrain same-session switching;
- route selection + elevation profile;
- tree/visitor layer activation;
- offline warmed reopen;
- DE/EN and reduced-motion variants where presentation changes materially.

Acceptance:

- every canonical spatial view has a semantic invariant, not only a screenshot diff;
- terrain readiness requires valid DGM1 elevation behavior;
- no mode switch loses canonical place/route identity;
- visual evidence is captured at mobile and desktop viewports;
- deployed-origin smoke is distinguished from local-preview qualification.

### BPK-QA-02 — real browser/device and assistive-technology qualification — P0

Qualify what Chromium CI cannot prove:

- Firefox desktop;
- iOS Safari/WebKit on a real supported device;
- one representative Android physical device;
- screen reader / keyboard-only review of the primary visitor flows;
- thermal/battery/GPU-memory smoke for sustained terrain use;
- coarse/denied/stale GPS behavior on physical devices.

Acceptance:

- no release-blocking navigation/offline/a11y defect;
- terrain may fall back to Leaflet, but fallback must be explicit and fully usable;
- a 10–15 minute terrain/navigation session shows bounded memory and no severe thermal
  or battery pathology;
- device findings become reproducible tests where automation is realistic.

### BPK-UI-01 — map/terrain interaction and mode clarity — P1

Polish the map as a visitor instrument rather than a renderer demo:

- make 2D/terrain mode and fallback state understandable without technical vocabulary;
- provide obvious reset-north / useful pitch / orientation affordances;
- keep selected destination, route and current context visible during camera changes;
- tune control density, touch targets and occlusion on 320–430 px screens;
- ensure terrain camera defaults make mountain relief legible without exaggerating data;
- retain 1× terrain truth by default; any presentation exaggeration must be explicit.

Acceptance:

- first-time users can tell which map mode they are in and return to a familiar view;
- controls do not cover route/detail critical content at narrow widths;
- side-view slope direction remains obvious for the cascades and at least two other
  high-relief routes;
- reduced-motion and low-power behavior remain first-class.

### BPK-UI-02 — route/navigation experience and evidence hierarchy — P1

Move route information from a technically complete detail into a visitor-readable
navigation experience:

- prioritize distance, time, ascent/descent and route direction;
- show steps, rough surfaces, grade and unknown access evidence compactly;
- make “avoid mapped steps” visibly different from “step-free”;
- improve elevation-profile readability and current-route context;
- add low-screen-time progress cues without claiming turn-by-turn navigation that the
  current evidence/model cannot support;
- surface route-source coverage caveats at the right level rather than burying or
  over-promoting them.

Acceptance:

- a visitor can compare two route options without opening raw provenance detail;
- unknown accessibility evidence is visible and never converted into a positive claim;
- route state survives renderer/language/offline transitions already supported by the app;
- route UI remains usable with GPS denied.

### BPK-DATA-01 — schema, source-refresh and provenance convergence — P1

Before broad data expansion, make updates safer:

- formal public layer schemas / migration policy;
- source-refresh manifests with previous/current snapshot identity;
- added/removed/changed stable-ID reports;
- cardinality authority moved from magic assertions into source manifests;
- common position/provenance contract across places, trees, benches, visitor features and
  future entrances/barriers;
- fail-closed checks for materially incompatible runtime/source changes.

Acceptance:

- a source refresh produces a human-reviewable diff before composed/runtime artifacts are
  accepted;
- schema compatibility is machine-readable;
- stable IDs cannot silently churn;
- derived values identify source inputs and algorithm/version;
- unknown accuracy remains unknown.

### BPK-CONTENT-01 — editorial freshness, bilingual parity and media evidence — P1

Treat the visitor corpus as a maintained product:

- audit DE/EN parity and editorial quality for all visitor-facing canonical entities;
- identify thin secondary-landmark entries and fill them from source-grounded research;
- give volatile facts `verified_on` + source and remove/stale-mark unsupported live facts;
- complete Wikimedia/file-page/license/creator metadata for displayed media;
- normalize names, dates and uncertainty/disputed-attribution style;
- create a stale-content/source-resolution report suitable for release gating.

Acceptance:

- no volatile visitor fact ships without freshness authority;
- DE/EN parity and source resolution are release-blocking;
- media use can be audited from repository metadata;
- uncertainty is explicit rather than flattened into confident prose.

### BPK-DATA-02 — visitor essentials and water/cascades spatial completeness — P1

Prioritize data that changes an on-site visit:

- entrances/gates and barrier nodes;
- toilets and accessible toilets where sourced;
- drinking water;
- viewpoints and rest/shelter points;
- public-transport access points at park boundaries;
- key water-axis/cascade objects, crossings, stairs and viewpoints with source-backed
  spatial identity;
- distinguish representative landmark points from actual access points.

The cascades should be modeled as heritage/water/path entities where evidence supports
that model; do not infer architectural dimensions from DGM1 terrain.

Acceptance:

- each new layer has validator + provenance + source snapshot identity;
- no physical-completeness claim is made from absence in OSM or another snapshot;
- route endpoints can prefer sourced access nodes where available;
- cascade/stair/path semantics can support later explanatory 3D without inventing geometry.

---

## Horizon 1 — visitor beta (~2–6 weeks)

Beta should be earned by product/device evidence, not by adding another large feature set.

### Technical

- close Firefox + iOS Safari/WebKit qualification;
- measure and enforce mobile startup, interaction, memory and terrain budgets;
- formalize schemas/migrations/source refresh;
- improve route progress and access-point semantics;
- harden deployed-origin install/offline/deep-link tests;
- add domain-specific spatial acceptance checks for important terrain/navigation claims;
- keep MapLibre optional until mobile parity and stability are demonstrated.

### UI/product

- finish map/control hierarchy and small-screen detail-sheet polish;
- make route effort and accessibility evidence scannable;
- improve discovery to answer “what is around me / where should I go next?” quickly;
- keep narration/transcripts useful but quiet by default;
- reduce avoidable screen time during a walk;
- expose source detail progressively rather than making every visitor read research metadata.

### Content/data

- complete priority visitor essentials;
- close thin DE/EN landmark descriptions;
- source and date volatile facts;
- expand entrances/barriers/access-point evidence;
- perform one controlled OSM/content refresh through the new change-report pipeline;
- review route coverage gaps without promoting the bounded topology to physical completeness.

Beta gate: the `ROADMAP.md` Phase-16 intent remains authoritative: bilingual corpus,
real multi-hop routing, runtime entities, offline upgrades, browser/a11y qualification,
evidence-honest route language and measured performance budgets must all be credible.

---

## Horizon 2 — spatial interpretation and stable-release convergence (~1–3 months)

### BPK-SPATIAL-01 — cascades and selected heritage explanatory geometry — P2

Once BPK-DATA-02 supplies authoritative identities/access/path/water semantics, add only
curated geometry that improves understanding:

- simplified cascades/stair/terrace explanatory mesh or sourced glTF where justified;
- selected heritage objects using the existing shared-depth Three layer;
- provenance attached to every authored/simplified representation;
- aggressive LOD / lazy load / low-power fallback;
- no claim that schematic geometry is survey-grade or photogrammetric.

This is where architectural stairs can become visually legible. DGM1 should continue to
represent terrain, not be forced to impersonate architecture.

### Broader technical roadmap

- stable public schema/migration policy;
- source-diff tooling and repeatable refresh cadence;
- stronger access-aware routing only as entrances/barriers/width/surface evidence improves;
- optional provider-compliant offline park pack if licensing permits;
- renderer/performance specialization only after measurement; WebGPU remains experimental;
- no browser WASM expansion unless a measured compute seam crosses the existing adoption
  threshold.

### Broader content roadmap

- deeper nature interpretation around specimen trees, habitats, water engineering and
  seasonal landscape experience;
- a richer spatial almanac linking place ↔ person ↔ artwork ↔ collection ↔ path ↔ tree;
- sourced thematic walks (water, viewpoints, architecture, trees, short/low-ascent);
- image/media curation with durable licensing metadata;
- recurring source/editorial review dates for volatile information;
- explicit historical uncertainty and phased-construction narratives.

Stable-release convergence follows the release checklist: no known P0/P1 integrity issue,
clean offline validation from preserved inputs, documented migration/privacy behavior,
production-origin smoke, and an RC regression period.

---

## Sequencing / dependencies

Recommended immediate order:

1. BPK-QA-01 and BPK-QA-02 in parallel;
2. BPK-UI-01 informed by the visual/device findings;
3. BPK-UI-02 in parallel with BPK-DATA-02;
4. BPK-DATA-01 before any broad source refresh;
5. BPK-CONTENT-01 continuously, but make freshness/parity gates release-blocking before beta;
6. BPK-SPATIAL-01 only after the cascades/access semantic authority is strong enough.

Do not let the 3D heritage lane outrun visitor QA, source quality, route evidence or mobile
qualification.

## Definition of a good next release

The next release should feel less like “more features” and more like a better field tool:

- terrain is obviously correct when it matters;
- the visitor immediately understands map orientation and route effort;
- the UI is calm on a phone;
- important facilities/access points are trustworthy and sourced;
- content is bilingual, fresh where volatile, and auditable;
- offline and fallback behavior remain excellent;
- richer 3D is introduced only where it makes the real park easier to understand.
