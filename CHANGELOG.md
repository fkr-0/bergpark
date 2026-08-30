# Changelog

All notable user-visible changes to Bergpark Wilhelmshöhe are documented here.
This project follows Semantic Versioning. Pre-release versions are explicitly
marked as alpha/beta until the visitor guide, knowledge graph and offline
experience have completed their release gates.

## [Unreleased]

### Added

- Versioned runtime-data contract covering every visitor-facing shipped layer,
  with schema compatibility, load/precache policy, exact artifact hashes/sizes
  and explicit data/startup budgets.
- Production artifact verification that rejects undeclared/aggregate data payloads
  and checks the manifest, layer hashes/sizes/schemas and initial JS/CSS budgets.
- DGM1-derived route elevation summaries and lazily rendered profiles with explicit
  terrain provenance, source accuracy context and conservative short-segment slope
  interpretation.
- Renderer-neutral spatial descriptors plus an optional MapLibre/WebGL2 terrain
  surface and shared-depth Three.js heritage layer; Leaflet remains available as
  the compatibility/low-power fallback.
- Visitor discovery/search foundations spanning places, stories, trees, visitor
  features and walking-network context without changing canonical entity IDs.

### Changed

- Runtime data publishing, browser hydration and service-worker precache now use
  the same manifest authority instead of three drifting filename lists.
- Pages derives runtime release metadata from the checked-out commit timestamp and
  SHA; local builds without source-backed metadata leave those fields unset rather
  than injecting the current wall-clock time.
- The PWA shell cache advances to `bergpark-shell-v6`; successful installation of
  the new contract removes older shell caches while preserving the bounded visited
  tile cache.

### Fixed

- Runtime JSON loading rejects incompatible schemas and successful non-JSON
  responses explicitly. Offline uncached data now returns structured JSON 503,
  and application HTML is reserved for navigation fallback instead of ever being
  supplied as JSON data.
- Opaque responses from recognized cross-origin map tile hosts are qualified for
  bounded visitor-driven caching; the tile-entry limit is read from the runtime
  contract.

- Visitor evidence links reject relative/internal research references and select
  only absolute HTTP(S) evidence, so bench details no longer turn preserved
  `data/sources/...` snapshots into clickable runtime links.
- Semantic `displayed_at` relations are localized and now surface relation
  confidence, source evidence, assertion and qualification; the Rembrandt display
  relation remains explicitly a museum-location statement rather than an ownership
  or acquisition-history inference.
- Place, tree and visitor-feature fragment state now restores during in-session
  hash changes and browser back/forward navigation without recursive history writes;
  malformed or missing IDs fail safely.
- Tree points and tree clusters explicitly activate with Enter/Space through the
  shared Leaflet keyboard helper used by landmark markers.

### Documentation

- README, architecture/development guidance, implementation review, ROADMAP and
  bridge tasks are reconciled with the current composition/runtime authority and
  the 2,633-node / 7,196-segment bounded Phase-8 walking topology.
- ROADMAP current-baseline claims now reflect durable alpha.4/alpha.5 visitor
  functionality and the bounded Graph Phase-8 topology/routing authority without
  rewriting historical phase descriptions or release metadata.

## [0.1.0-alpha.5] - 2026-08-27

### Added

- Selective visitor map layers for 215 sourced benches and 109 qualified visitor
  POIs, with provenance-aware detail sheets and explicit unknown/missing-state
  wording rather than inferred field conditions.
- Compact sourced tree details that keep terrain elevation separate from unknown
  physical tree height and fail closed on non-public evidence links.
- Phase-3 browser coverage across 320 px mobile, 390 px mobile, tablet and desktop
  for tree details, semantic index context, visitor layers and warmed offline use.

### Changed

- Dense visitor clusters retain the 180-marker rendering bound but can now drill
  into a selected cluster at maximum zoom instead of becoming permanently
  non-expandable.
- Visitor cluster and point markers explicitly support Enter/Space keyboard
  activation instead of relying on Leaflet's popup-only keypress behavior.
- Browser tests use deterministic in-memory map-tile fixtures, so CI performs no
  third-party tile crawl and no longer mistakes intentionally aborted tile
  requests for application runtime failures.
- Local development, Playwright preview orchestration and documentation are
  pnpm-authoritative throughout.
- Semantic role/object metadata is searchable and visible in visitor details,
  while runtime packaging remains selective rather than exposing aggregate or
  audit-only graph payloads.

### Verification

- Integrated preflight `pnpm run check:e2e`: PASS with Biome warnings-fatal,
  28/28 Node tests, 2/2 Vitest tests, 65/65 Python tests, Vite 8.2.2 build and
  16/16 Chromium Playwright tests.
- Exact clean-candidate evidence is recorded in `release-evidence.yml` before
  push; shared-checkout counts include concurrent durable/uncommitted seams and
  are not substituted for that clean qualification.

### Known alpha limitations

- Playwright Firefox's synthetic offline mode returns `NS_ERROR_OFFLINE` before
  service-worker navigation on the two offline-reload cases; the non-offline
  visitor/3D Firefox slice is qualified separately.
- WebKit is not qualified on the current Arch host because its Playwright runtime
  dependencies are unavailable; real iOS Safari remains a beta gate.
- Landmark 3D assets remain schematic interaction models rather than surveyed
  architectural reconstructions.

## [0.1.0-alpha.4] - 2026-08-27

### Added

- Per-node rich presentation policy with lightweight structure markers for
  selected landmarks while preserving the normal Leaflet map for navigation.
- Lazy interactive Three.js landmark viewer with rotate/pause, reset, drag/zoom,
  Escape/close, focus restoration and reduced-motion-aware autorotation.
- Schematic 3D scenes for Herkules, Schloss Wilhelmshöhe, Löwenburg and Große
  Fontäne, plus a same-origin glTF Aquädukt asset exercising the production model
  loader path.
- Fail-closed 3D asset policy: same-origin glTF/GLB only, 5 MiB and 180,000
  triangle budgets, embedded secondary resources, accessible fallback when
  WebGL/model loading is unavailable, and explicit renderer/model disposal.
- Visitor-facing tree map/explorer integration for the 569-tree catalogue with
  deterministic clustering/LOD, location/species/significance filters and
  bounded mobile result paging.
- Route detail sheets exposing distance, walking time, ascent/descent, average
  grade, surface/access evidence, mapped steps and endpoint uncertainty without
  overstating field-level accessibility.
- Historical semantic links between places, figures, artworks and collections,
  preserving source-backed relations in the visitor detail flow.

### Changed

- Service-worker runtime data is network-first with offline fallback; generated
  build assets are cached from the built HTML and visited map tiles remain
  bounded rather than bulk-prefetched.
- Graph Phase 7 normalizes provenance and accuracy contracts while preserving
  stable place/tree/bench/path identities and route semantics.
- pnpm 11.3.0 is now the authoritative package manager: `pnpm-lock.yaml`, frozen
  installs, pnpm scripts and pnpm-based GitHub CI/Pages gates replace the legacy
  package-manager release commands and lockfile.
- Vitest 4.1.11 is a first-class unit-test runner alongside the retained Node
  compatibility suites, with a dedicated presentation-contract smoke suite.
- Biome 2.5.10 is a warnings-fatal lint gate using recommended rules; intentional
  Leaflet/reduced-motion CSS cascade overrides are documented as scoped rule
  exceptions rather than being bulk-reformatted.

### Verification

- pnpm frozen-lock install: PASS.
- Biome warnings-fatal lint gate: PASS.
- Node visitor/runtime/presentation tests: 22/22 PASS.
- Vitest presentation-contract tests: 2/2 PASS.
- Python repository integrity suite: 65/65 PASS.
- Vite 8.2.2 production build: PASS.
- Chromium Playwright E2E: 11/11 PASS, including tree/route/semantic flows,
  serious/critical Axe checks, 3D WebGL/glTF/fallback/security cases and warmed
  offline reopening.
- Firefox Phase-2 visitor qualification: 2/2 PASS when run against the built
  preview (tree explorer and route/semantic/focus flow).

### Known alpha limitations

- The bundled landmark 3D assets are schematic interaction models, not surveyed
  architectural/heritage reconstructions.
- Full Firefox 3D and iOS Safari/WebKit production qualification remain beta
  gates.
- Field-level accessibility, live opening hours and water-feature schedules
  remain source-dated evidence rather than operational guarantees.

## [0.1.0-alpha.2] - 2026-08-27

### Added

- Reproducible Chromium end-to-end release tests covering application boot,
  DE/EN switching, index search, landmark deep links, route selection and the
  warmed offline-PWA path.
- Automated Axe browser checks that fail the release gate on unreviewed serious
  or critical accessibility findings.
- Repository CI for pull requests and `main`, with Node tests, the complete
  Python data-integrity suite, a production Vite build and browser E2E.
- Expanded visitor data shipped by the post-alpha.1 graph phases: 569 catalogued
  trees, 215 benches, 1,408 path nodes / 2,858 directed path segments, 109
  source-grounded visitor POIs and the first sourced semantic entities/relations.

### Changed

- GitHub Pages now deploys only after the same complete data/runtime/build and
  Chromium E2E/a11y gates pass in CI.
- Place spatial provenance and graph composition are normalized so newer tree,
  bench, path-topology, semantic and visitor-POI layers remain independently
  validated while composing into the browser graph.
- Browser E2E deliberately suppresses third-party map-tile traffic: the release
  contract tests Bergpark behavior without turning CI into an OpenStreetMap tile
  crawler or failing on an unrelated tile-provider outage.

### Verification

- Node visitor-guide tests: 8/8 PASS.
- Python repository integrity suite: 45/45 PASS.
- Vite 8.2.2 production build: PASS.
- Chromium Playwright E2E: 3/3 PASS, including offline reload and automated
  serious/critical accessibility qualification.
- GoDaddy CNAME postflight and GitHub Pages custom-domain state: verified;
  GitHub reports the `bergpark.fkr.dev` certificate approved and HTTPS enforced.

### Known alpha limitations

- Firefox and iOS Safari/WebKit production qualification remain beta gates.
- Field-level accessibility, live opening hours and water-feature schedules
  remain source-dated evidence rather than operational guarantees.

## [0.1.0-alpha.1] - 2026-08-27

### Added

- Mobile-first Leaflet visitor map centered on Bergpark Wilhelmshöhe, with
  touch zoom/pan, OpenStreetMap and OpenTopoMap layers, and rich place markers.
- Canonical spatial graph with 30 visitable place nodes and 122 directed
  walking edges, including route geometry, walking-time estimates, elevation
  metrics and route/accessibility provenance.
- German/English runtime language switching and bilingual long-form content for
  the first authored landmark tranche.
- Place detail sheets with history, architecture, cultural significance,
  visitor information, artwork metadata, source links and Web Speech API
  narration.
- GPS `watchPosition` navigation with graceful desktop/manual fallback and a
  30 metre landmark proximity trigger.
- Searchable A-Z entity index and tree-explorer UI plumbing.
- Walking-network and selected-route polyline rendering.
- Installable PWA manifest, app icons, service worker and bounded caching of
  map tiles actually viewed by the visitor.
- Reproducible public-source graph build and validation pipeline using
  OpenStreetMap and documented elevation/source snapshots.
- GitHub Pages deployment workflow and custom-domain support for
  `bergpark.fkr.dev`.

### Changed

- Runtime data publishing now copies only deployable graph/content exports;
  large source/audit snapshots are intentionally excluded from the web build.
- Directed route accessibility semantics distinguish mapped-path evidence from
  unknown landmark-to-network endpoint connectors instead of overstating
  step-free accessibility.

### Verification

- Canonical Phase-2 graph authority: 30 place nodes, 122 directed edges,
  validation PASS with zero errors and zero warnings.
- Graph test suite: 7/7 PASS at the Phase-2 authority.
- Visitor-guide Node tests and Vite production build are release gates.
- Browser qualification covered map/index/detail interactions, DE/EN switching,
  route selection and automated accessibility checks in Chromium.

### Known alpha limitations

- The catalogued historic-tree layer is not yet complete; the tree explorer is
  intentionally capable of showing an explicit pending/partial state.
- Secondary-landmark bilingual content, historical figures/artworks and
  semantic relationships are still being expanded by dedicated knowledge and
  graph phases.
- Offline map support caches tiles visited by the user; it does not bulk-fetch
  OpenStreetMap tiles and must not be treated as a complete offline basemap.
- Field-level accessibility, live opening hours and water-feature schedules
  require on-site/operator verification before being represented as guarantees.
- Firefox/iOS Safari production qualification remains part of the beta gate.

[0.1.0-alpha.1]: https://github.com/fkr-0/bergpark/releases/tag/v0.1.0-alpha.1
[0.1.0-alpha.2]: https://github.com/fkr-0/bergpark/releases/tag/v0.1.0-alpha.2
[0.1.0-alpha.4]: https://github.com/fkr-0/bergpark/releases/tag/v0.1.0-alpha.4
