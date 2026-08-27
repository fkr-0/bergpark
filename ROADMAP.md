# Bergpark Wilhelmshöhe roadmap

The repository contains three cooperating products: the visitor PWA, the
spatial/semantic graph, and the bilingual knowledge corpus. Release progression
is evidence-driven rather than tied to a fixed date.

## 0.1.0-alpha.1 — public integration alpha

- [x] Installable Vite/Leaflet PWA shell.
- [x] Canonical major-place graph and directed walking network.
- [x] Elevation/surface/accessibility provenance for walking edges.
- [x] GPS proximity trigger and manual fallback.
- [x] DE/EN detail system, TTS, index and route visualization.
- [x] GitHub Pages deployment and `bergpark.fkr.dev` custom domain.
- [ ] Complete catalogued historic-tree graph and visitor explorer.
- [ ] Finish secondary-landmark DE/EN content inventory.
- [ ] Finish historical figures, artworks, collections and semantic edges.

## 0.1.0-alpha.2 — content + dendrology alpha

- Populate the full catalogue-backed tree layer with stable IDs, species,
  location, significance and provenance.
- Add tree clustering/LOD so hundreds of specimens remain usable on mobile.
- Finish the official/UNESCO/OSM secondary-landmark inventory in both
  languages and reconcile all content IDs against canonical graph aliases.
- Render historical figures and artworks as cross-linked semantic entities.
- Add explicit sampled path nodes/path-segment serialization where it improves
  routing provenance without destabilizing current place IDs.
- Add automated schema/content parity checks to the standard release gate.

## 0.1.0-beta.1 — visitor experience beta

- Add location and significance filters to the full tree explorer.
- Improve landmark galleries with verified Wikimedia Commons file/license
  metadata and resilient offline placeholders.
- Add route profiles (distance/elevation/surface/accessibility) to navigation
  cards and make route-state restoration deep-linkable.
- Validate service-worker upgrade/offline behavior from the built artifact.
- Qualify current Chrome, Firefox and iOS Safari mobile behavior.
- Run keyboard/screen-reader/accessibility audits and close all serious issues.
- Add lightweight performance budgets for initial JS/CSS and map startup.

## 0.1.0 — first stable visitor release

- All requested major landmarks have reviewed DE/EN visitor content.
- Tree collection is complete enough to be called a catalogue rather than a
  placeholder/partial import.
- Graph/content ID, source and relationship integrity gates are green.
- Production custom-domain PWA install/offline/navigation smoke tests are green.
- Accessibility and browser support statements match observed evidence.
- Visitor-facing volatile facts show a verification date and source.

## Later

- Optional downloadable offline park packs that respect tile-provider policy.
- Curated thematic tours (water engineering, architecture, trees, collections).
- On-device route selection informed by slope/surface/accessibility preferences.
- Structured export formats for external research/heritage applications.
