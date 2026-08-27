# Changelog

All notable user-visible changes to Bergpark Wilhelmshöhe are documented here.
This project follows Semantic Versioning. Pre-release versions are explicitly
marked as alpha/beta until the visitor guide, knowledge graph and offline
experience have completed their release gates.

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
