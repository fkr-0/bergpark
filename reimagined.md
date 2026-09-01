# Bergpark Reimagined

> Authoritative architecture and product decision record for the `bergpark-reimagined`
> prolonged lane. This document does **not** replace, relabel, or consume the
> `bergpark-webapp` release-convergence authority.
>
> Decision date: 2026-08-28
>
> Repository baseline inspected: `5f7267489443419237b2bcb1b60c9b6750546d63`
>
> GitInspect precedent inspected read-only at:
> `9f9747f4b87b65722b258ebe88c3d78bc6a04a03` (with concurrent unrelated dirty work
> explicitly ignored).

## 1. Executive decision

Adopt the following architecture unless a focused implementation benchmark falsifies a
specific component:

**MapLibre GL JS terrain + real Hessen DGM1 + a Three.js shared-depth custom spatial
layer + renderer-neutral Bergpark `SpatialWorld` descriptors/LOD inspired by
GitInspect + selective workers/Rust/WASM only for measured compute seams + the existing
Leaflet implementation retained as the first-class low-power/accessibility/compatibility
fallback.**

This is not a greenfield beauty contest. The burden of proof is on replacing this
architecture.

The important refinement to the initial hypothesis is that **WebGPU is not the primary
renderer path for the MapLibre-integrated world**. Current MapLibre custom 3D layers are
rendered inside a supplied WebGL2 context and can share the map depth buffer. Three's
`WebGPURenderer` can fall back to WebGL2, but it is a different renderer architecture and
is still experimental. It therefore does not drop into the same shared-WebGL2-context
seam as `WebGLRenderer`. WebGPU remains a later, capability-gated experiment only after
the WebGL2 terrain path is green and measured.

The target is also deliberately **not a digital twin**. The real park is the high-fidelity
renderer. The application should make slope, height, route effort, water axes, viewpoints,
paths, landmarks and relationships legible, then get out of the visitor's way.

### Product order of operations

1. orientation and navigation;
2. discovery and exploration;
3. trustworthy enumeration of the park;
4. optional audio-guide interpretation;
5. a spatially linked almanac;
6. visual atmosphere only where it improves the above.

Camera AR/WebXR is retired and is a non-goal unless explicitly reopened by the operator.

---

## 2. Evidence status and repository reality

Every claim in this program should be labelled mentally as one of four states:

- **proven in repository** — implemented/current data or code was inspected;
- **supported upstream** — current official project/provider documentation supports the
  capability, but Bergpark has not yet qualified it;
- **focused-spike proven** — a Bergpark benchmark or integration spike has demonstrated it;
- **speculative** — plausible, but not yet justified by repository or benchmark evidence.

Phase 1 contains repository and upstream evidence only. The new stack is **not yet a
focused-spike-proven production renderer**.

### 2.1 What is already strong and must be preserved

The current app is not “just a Leaflet map.” The repository already contains most of the
semantic authority a terrain product needs:

- Vite/offline PWA shell and bilingual DE/EN content;
- 30 canonical visitable place nodes;
- 122 directed / 61 bidirectional high-level walking edges;
- a substantially richer walking topology: 2,633 path nodes and 7,196 directed segments
  over the current frozen source scope;
- source-qualified OSM surface/access/steps/incline semantics;
- route distance, walking time, ascent, descent, average grade and elevation-profile
  fields;
- 569 catalogued trees with stable identities;
- 215 first-class bench POIs;
- 109 selective visitor POIs;
- semantic figures/artworks/relations and deep-link identities;
- GPS proximity behavior with manual fallback;
- accessible DOM editorial/detail surfaces and TTS;
- a bounded/lazy Three.js landmark viewer with same-origin asset policy, a 5 MiB model
  ceiling, 180,000 triangle ceiling, reduced-motion behavior and WebGL failure fallback;
- a service worker that distinguishes same-origin runtime data from bounded visitor-viewed
  third-party map tiles.

The new renderer must project these authorities; it must not fork or replace them.

### 2.2 The current elevation bottleneck is real

Current canonical terrain values are based on the Open-Meteo Elevation API backed by
**Copernicus DEM 2021 GLO-90 at 90 m horizontal resolution**. The repository already
fails closed around this limitation: explicit path segments shorter than 90 m retain an
endpoint delta but publish `null` ascent/descent/grade, and route climb calculations avoid
summing dense quantized DEM noise.

This is a particularly strong reason to adopt DGM1. In the earlier route projection,
2,854 of 2,858 directed segments were below the 90 m DEM resolution. The larger Phase-8
walking topology now has thousands of short segments as well. A 1 m terrain source does
not merely make the map prettier; it can remove a documented semantic resolution ceiling
for route effort and slope interpretation.

DGM1 must still be treated statistically. A 1 m grid does **not** justify summing every
1 m vertical fluctuation as real ascent or declaring a one-metre local grade to survey
precision. Route metrics need an explicit smoothing/resampling profile consistent with
DGM1 accuracy and pedestrian semantics.

### 2.3 The prior “Leaflet remains authoritative” decision is superseded, not erased

`docs/architecture.md` currently argues that a permanent WebGL world would complicate GPS,
routing, accessibility, offline use and low-end devices for little benefit. That was a
reasonable decision for the previous product target and it explains why Three is currently
lazy and landmark-local.

The product authority has now changed: terrain and mountain legibility are first-class.
The correct response is **not** a big-bang reversal. Leaflet remains production authority
until the MapLibre adapter earns parity, then remains an explicit low-power/2D mode.

---

## 3. How far the current Leaflet + Three solution can go

### Retain

Leaflet remains valuable for:

- fast 2D startup;
- OSM/OpenTopoMap raster compatibility;
- current markers, route polylines and GPS behavior;
- familiar keyboard/touch behavior;
- low-power devices and reduced visual load;
- environments where WebGL2 is unavailable or unreliable;
- an accessibility-friendly fallback whose information is not canvas-only.

The current Three viewer should also remain usable as an editorial/detail fallback even
after selected assets move into the spatial world. One capability bug must not be carried
forward: `src/model-viewer.js` currently treats either WebGL1 or WebGL2 as sufficient, but
current Three `WebGLRenderer` uses WebGL2 and has not supported WebGL1 since r163. The new
renderer/capability gate must therefore require WebGL2 for Three/MapLibre terrain while
Leaflet remains the no-WebGL2 fallback.

### Reasonable enhancements without changing substrate

Leaflet can still gain:

- better elevation profile UI;
- hillshade/topographic overlays;
- route effort and slope annotations;
- renderer-neutral selection/deep-link state;
- better clustering/LOD policies;
- a 2D projection of the new `SpatialWorld` descriptors.

### Where Leaflet becomes the wrong substrate

It remains a 2D map camera/tile architecture. Plugins can provide pseudo-3D markers,
hillshade, canvas overlays and visual tricks, but building a true terrain camera, terrain
occlusion, shared depth, georeferenced 3D models and terrain-aware focus on top of Leaflet
would amount to writing a second spatial engine beside it.

That is the kill line: **do not build the terrain engine inside Leaflet**. Preserve Leaflet
as fallback and migrate the primary spatial camera to MapLibre.

---

## 4. 3D-native mapping substrate evaluation

### 4.1 MapLibre GL JS — chosen geospatial substrate

Current upstream documentation supports the exact seam this program needs:

- `raster-dem` terrain sources;
- Terrain with default exaggeration `1`;
- camera pitch/bearing/altitude semantics;
- `queryTerrainElevation()` for terrain-aware custom object placement;
- custom layers rendered directly into the map GL context using the map camera;
- a 3D custom-layer mode that shares the map depth buffer;
- an official example that places Three.js models on 3D terrain.

This lets MapLibre own what it is better at than a game renderer:

- geospatial projection;
- map camera;
- terrain tile visibility/streaming;
- terrain mesh;
- normal map layers and labels;
- feature queries;
- conventional navigation controls.

And it lets Three own only the curated scene objects that genuinely benefit from a 3D
scene graph.

**Licensing:** MapLibre GL JS is BSD-3-Clause. No API token is inherent to the library.
Tokens and network obligations come from whatever basemap/terrain services are selected;
our production terrain should therefore be same-origin derived DGM1, not a mandatory
commercial service.

**Important implementation constraint:** the current custom-layer interface supplies a
`WebGL2RenderingContext`. Any Three custom layer must respect MapLibre GL state, call the
appropriate Three renderer state reset before rendering, and handle WebGL context
loss/restore. This is a focused-spike acceptance item, not something to hand-wave.

### 4.2 deck.gl — useful optional specialist, not the primary renderer

`TerrainLayer` can build terrain meshes from elevation images and stream tiled terrain.
`Tile3DLayer` is strong for 3D Tiles/I3S/point clouds. deck.gl is also excellent for very
large declarative geospatial datasets.

But adopting it as the primary terrain/world layer adds another rendering/layer policy
system while MapLibre already owns the desired map camera and Three already exists for
curated scene content. More importantly, the current `TerrainExtension` used to drape or
offset overlays on terrain is explicitly documented as **experimental**.

**Decision:** do not add deck.gl in the baseline. Revisit it only if a future requirement
is specifically better served by its strengths — e.g. huge point-cloud/3D-Tiles layers,
GPU-heavy analytical overlays, or a measured limitation in the selected MapLibre/Three
path.

**Licensing:** MIT. No inherent token, but example data sources often use third-party
services and must not be mistaken for offline-ready defaults.

### 4.3 CesiumJS / 3D Tiles — powerful, wrong default product economics

CesiumJS has first-class terrain streaming, quantized mesh, globe-scale coordinates and a
mature 3D Tiles ecosystem. It would be the strongest candidate if Bergpark were becoming
a large-region digital twin or a 3D Tiles/photogrammetry portal.

It is not the best primary substrate here:

- the product is a small park, not a globe;
- our best terrain is Hessen DGM1, while Cesium World Terrain documents roughly 30 m
  resolution for Europe;
- World Terrain is accessed through Cesium ion in the normal hosted path and the official
  docs describe purchased offline/on-premises options;
- Google Photorealistic 3D Tiles through Cesium requires an access token and network
  service;
- photorealistic reconstruction is explicitly not a product prerequisite;
- adopting Cesium would make the existing Leaflet/Three migration less incremental.

Cesium can consume self-hosted terrain through `CesiumTerrainProvider`, so this is not a
claim that Cesium itself is proprietary. The problem is product fit and operational
weight, not renderer quality.

**Licensing:** CesiumJS is Apache-2.0; Cesium ion/global content has separate service and
commercial terms.

### 4.4 Other engines

#### Babylon.js / PlayCanvas

Both are capable 3D engines with strong rendering and tooling. Neither provides a
repository-grounded advantage over the already-present Three.js plus a map-native camera.
Switching engines would create asset/input/integration churn without eliminating the need
for a geospatial substrate.

**Decision:** reject for baseline. Reconsider only if a concrete Three limitation is
measured after the MapLibre spike.

#### D3

D3 remains useful for:

- elevation-profile SVG/canvas charts;
- scales and transforms;
- statistical summaries;
- offline preprocessing prototypes;
- relationship diagrams outside the map.

It is not an appropriate primary renderer for GPU terrain, depth-occluded 3D objects or
large 3D spatial scenes.

---

## 5. GPU-heavy custom renderer / game-style path

A full Three.js terrain world is technically possible. It would require Bergpark to own:

- DEM tiling and terrain mesh LOD;
- projection and floating-origin math;
- camera/map constraints;
- label collision and placement;
- route/feature querying;
- GPS-to-camera semantics;
- spatial tile loading;
- map-style overlays;
- conventional cartographic controls;
- accessibility mirroring.

That is an avoidable reimplementation of geospatial machinery MapLibre already provides.

### Chosen rendering split

```text
MapLibre GL JS
  ├─ projection / camera / zoom / pitch / bearing
  ├─ DGM1 raster-dem terrain mesh + hillshade/color relief
  ├─ ordinary map semantics / route lines / labels
  ├─ visible-tile lifecycle and feature queries
  └─ shared WebGL2 depth/camera context
          │
          └── Three.js custom 3D layer
                ├─ curated heritage glTF/procedural objects
                ├─ selected water/landscape explanatory cues
                ├─ batched/instanced semantic objects where useful
                └─ no independent camera
```

### R3F decision

GitInspect demonstrates a good R3F/Three architecture, but Bergpark is currently a small
vanilla Vite/JavaScript application. Adding React + R3F just to access Three would add a UI
framework migration without solving a terrain problem.

**Decision:** use plain Three.js for the MapLibre custom layer. Reuse GitInspect's
architectural ideas, not its React binding.

### Rendering policy

- demand-driven rendering whenever possible;
- MapLibre owns redraw scheduling; call `triggerRepaint()` only while an actual animation
  or transition requires another frame;
- no permanent autorotating world;
- no one-React/DOM-object-per-tree/bench/path primitive;
- use instancing/batching for repeated simple symbols;
- frustum/distance/semantic LOD before exotic GPU work;
- simplify and compress glTF assets offline;
- load Three and heritage assets only when terrain mode or a 3D object needs them;
- keep editorial details, controls, transcripts and critical labels in accessible DOM.

### Atmosphere

Fog, restrained lighting, water cues and seasonal color may improve depth legibility, but
atmosphere is subordinate to navigation. Do not synthesize photoreal vegetation or add
continuous effects merely because the GPU can render them.

---

## 6. WebGPU decision

Three's current `WebGPURenderer` documentation says:

- WebGPU is the preferred backend when available;
- it can automatically fall back to WebGL2;
- it is still experimental;
- some existing material/postprocessing paths require migration to TSL/node materials;
- `WebGLRenderer` remains maintained and recommended for pure WebGL2 applications.

MDN currently marks WebGPU as **Limited availability / not Baseline**.

There is also a Bergpark-specific integration issue: MapLibre's custom layer contract
supplies a WebGL2 context and a shared WebGL depth buffer. A WebGPU renderer cannot simply
be substituted into that exact shared-context contract. A WebGPU path would require a
different integration/compositing seam or a future MapLibre capability.

**Decision:**

- production terrain/world baseline: MapLibre WebGL2 + Three `WebGLRenderer`;
- no WebGPU dependency for navigation;
- retain renderer-neutral `SpatialWorld` data so later renderer experiments are possible;
- perform a WebGPU spike only after the WebGL2 path is green;
- adopt only if browser/device coverage and a measured quality/performance win justify the
  added renderer/material complexity.

A WebGPU experiment that merely reproduces the WebGL2 result is a failed experiment, not a
roadmap checkbox.

---

## 7. WebAssembly: use compute, not fashion

### 7.1 What GitInspect actually proves

GitInspect's current browser WASM crate is deliberately small. It exposes a version,
deterministic fingerprint and explicit capability record. Its documentation correctly says
that its native Rust repository authority is **not** a browser/WASM renderer or browser Git
backend.

Therefore “clone GitInspect WASM” would copy the wrong thing.

### 7.2 What to reuse from GitInspect

Reuse the discipline:

- a narrow versioned boundary;
- explicit capabilities;
- pure inputs/outputs;
- fail closed when a promised capability is absent;
- keep renderer/domain state outside the boundary;
- benchmark before broadening the module.

### 7.3 Responsibility split

#### TypeScript/JavaScript

- application state and navigation intent;
- `SpatialWorld` descriptors and adapters;
- MapLibre/Three integration;
- DOM accessibility surfaces;
- async orchestration and caching;
- ordinary selection/filter/search work until profiling says otherwise.

The repository is JavaScript today. Slice 0 should not force a TypeScript migration. The
contract can start as JSDoc-typed ES modules and migrate selectively if the maintainability
case becomes strong.

#### Web Workers

Try workers before WASM for coarse CPU work that otherwise blocks interaction:

- terrain-sample batch decode;
- spatial-index construction;
- route elevation/slope calculation;
- large nearby/discovery queries;
- geometry simplification/preprocessing that truly must happen in-browser.

#### Rust/WASM

Only measured, coarse, typed-array-oriented pure compute seams are candidates:

- batch DEM sampling/resampling;
- route elevation smoothing/profile computation;
- large spatial-index queries;
- bounded viewshed/visibility calculations;
- quantization/decoding;
- geometry transforms that cannot be moved entirely offline.

Avoid:

- per-frame render-loop bookkeeping;
- many small JS↔WASM calls;
- mirroring mutable world objects on both sides;
- DOM/UI work;
- moving an already-fast JS function to Rust for novelty.

#### GPU

Use the GPU for raster terrain, transforms, normal rendering, instanced drawing and shader
work. Do not force deterministic/business semantics into shaders unless an accessible CPU
representation remains authoritative.

### 7.4 Browser WASM vs offline Rust/GDAL

The highest-value Rust/native work is likely **offline preprocessing**, not browser WASM.
A reproducible data pipeline can use GDAL and optionally a small Rust CLI to:

- validate source manifests/checksums;
- clip/reproject DGM1;
- encode a bounded terrain pyramid;
- generate a canonical compact terrain-sampling artifact;
- compute deterministic route-elevation fixtures;
- optimize/validate geometry.

This work belongs outside the PWA render loop.

### WASM adoption gate

Do not ship browser WASM unless a benchmark shows at least one of:

- a meaningful main-thread responsiveness improvement on representative mobile hardware;
- roughly >=1.5x speedup of a proven CPU hotspot after module startup/copy costs; or
- a substantial maintainability/safety benefit that justifies the binary boundary.

If typed-array transfer/startup erases the gain, stay in JS/worker code.

---

## 8. Real terrain and authoritative data strategy

### 8.1 Primary physical Z authority: Hessen ATKIS DGM1

The Hessisches Landesamt für Bodenmanagement und Geoinformation (HVBG) documents:

- DGM1 grid spacing: **1 m**;
- ALS-derived terrain in Hessen;
- terrain-dependent height accuracy up to **±0.3 m** for DGM1, with the stated 95%
  confidence context;
- GeoTIFF, 32-bit float, LZW, NoData `-9999`;
- horizontal CRS: **ETRS89 / UTM 32N**;
- vertical reference: **DHHN2016_NH**;
- DGM1 is available as a **free self-service download** through Geodaten online, including
  freely selectable areas through the shop.

The current Hessen Open Data entry for ATKIS-DGM1 records license
**`dl-zero-de/2.0` (Datenlizenz Deutschland – Zero – Version 2.0)**.

This is the preferred terrain source.

### 8.2 BKG comparison

BKG aggregates nationwide official terrain products, but its current public open-data
catalogue emphasizes DGM200/DGM1000. The BKG Geodatenzentrum lists DGM1 as a paid product
(starting at thousands of euros) and DGM5 as restricted in that distribution channel.
For a project wholly inside Hessen, the direct state DGM1 open-data path is both finer and
operationally better.

BKG remains useful as:

- national metadata/reference authority;
- fallback for future cross-state scope;
- a consistency comparison source where licensing permits.

It is not the production DGM1 acquisition path for Bergpark.

### 8.3 DOM1

Hessen DOM1 describes the terrain **plus vegetation/buildings** and is ALS-derived. HVBG
documents DOM1 height accuracy up to ±0.3 m on suitable surfaces, ETRS89/UTM32N +
DHHN2016_NH, and free self-service availability.

Use DOM1 selectively for:

- canopy/structure context studies;
- validating whether a viewshed should consider major surface obstruction;
- offline derivation of coarse vegetation/structure cues.

Do **not** use DOM1 as canonical physical ground Z.

### 8.4 Raw ALS/LiDAR

HVBG documents classified airborne-laser point clouds, a second statewide campaign
completed in 2021, point accuracy around 15 cm vertically / 30 cm horizontally and at
least several points per square metre. Raw point-cloud provision may incur fees/time-based
handling and creates a much larger pipeline.

**Decision:** not a mandatory Phase-1/terrain-MVP input. Reopen only for a specific
viewshed, vegetation or geometry question that DGM1/DOM1 cannot answer.

### 8.5 Orthophotos (DOP20)

Hessen ATKIS DOP20 is available through open-data resources under `dl-zero-de/2.0` and has
20 cm-class imagery semantics by product name/product documentation.

Use orthophotos for:

- source QA;
- optional map context/debugging;
- offline landmark placement verification.

Do not make an orthophoto texture the permanent default visual world. The goal is terrain
legibility and the real landscape, not forcing a satellite-photo simulator onto the
visitor.

### 8.6 3D buildings LoD2

Hessen publishes LoD2 building information derived from official building footprints and
height sources, with standardized roof forms. BKG also distributes a nationwide LoD2
product but documents restricted eligibility in its national channel.

Potential Bergpark use:

- cross-check footprint/height/orientation for ordinary structures;
- seed a low-detail context representation where legally and semantically appropriate.

Do not automatically replace curated heritage interpretation with generic LoD2 geometry.
A palace or waterwork model should exist only if it helps understanding and has clear
provenance/scale semantics.

### 8.7 Acquisition mechanics — Phase 3 qualified

Phase 3 resolved the earlier acquisition uncertainty without scraping the Geodaten-online
shop. HVBG's current INSPIRE service catalogue publishes an official DGM1 WCS endpoint at
`https://inspire-hessen.de/raster/dgm1/ows`; its `he_dgm1` coverage advertises native
EPSG:25832, 1 m grid offsets, Float32 elevation and NoData `-9999`, and supports GeoTIFF
coverage output. A bounded WCS `GetCoverage` request for only the canonical Bergpark runtime
extent plus a 150 m metric margin was successfully acquired and checksum-qualified.

The repository therefore uses the official WCS as the automation-safe acquisition path and
keeps the exact request URL, original response filename, retrieval timestamp, byte size and
SHA256 in `terrain/sources/hessen-dgm1.yml`. The ignored `.work/terrain/dgm1/source/` cache
preserves the original response bytes; all downstream conversion is deterministic from
that immutable input hash. The Geodaten-online shop remains a documented human fallback,
not a scraped pipeline dependency.

---

## 9. CRS, elevation and coordinate policy

### Data boundaries

- public/domain coordinates: WGS84 longitude/latitude;
- official DGM processing: EPSG:25832 / ETRS89 UTM 32N;
- elevation authority: DHHN2016_NH metres from DGM1;
- MapLibre display projection: its normal map projection/Web Mercator terrain path;
- local high-precision scene math when required: a Bergpark-centred local metric frame,
  derived from authoritative coordinates rather than persisted as a second geographic
  truth.

### Rules

1. Never invent Z for a coordinate-bearing entity when DGM1 can be sampled.
2. `elevation_m` remains **terrain elevation**, never tree/building/object height.
3. A 3D object's visual base offset is a separate field, e.g. `terrain_offset_m`, and must
   not mutate physical elevation.
4. Terrain exaggeration defaults to **1.0**. If a user-facing explanatory exaggeration mode
   ever exists, it must be explicitly labelled.
5. MapLibre `queryTerrainElevation()` reflects terrain exaggeration. Therefore it is valid
   for display placement when exaggeration is 1, but it is **not** the canonical data
   source for persisted route/entity elevations. Canonical values come from the DGM1
   sampling artifact/pipeline.
6. Route metrics must declare their smoothing/resampling algorithm and DGM version.

---

## 10. Reproducible terrain conversion / tiling pipeline

Do not commit statewide raw geodata.

### Proposed repository shape

```text
terrain/
  README.md
  sources/
    hessen-dgm1.yml            # immutable source/provenance manifest
  pipeline/
    acquire.*                   # explicit network/manual acquisition helper
    build.*                     # deterministic clip/reproject/encode orchestration
    validate.*                  # bounds/CRS/range/hash checks
  fixtures/
    tiny-dem.*                  # synthetic/small test fixture only

public/terrain/
  manifest.json                # release metadata, bounds, hashes, schema
  dem/{z}/{x}/{y}.png          # bounded raster-dem tiles, generated/release artifact
  samples.*                    # compact canonical sampling artifact
```

Exact filenames are implementation choices; the ownership boundary is not.

### Source manifest minimum

```yaml
schema_version: 1
provider: Hessisches Landesamt für Bodenmanagement und Geoinformation
dataset: ATKIS-DGM1
license: dl-zero-de/2.0
license_checked_at: 2026-08-28
source_url: <exact official acquisition reference>
acquired_at: <timestamp>
source_files:
  - name: <original>
    sha256: <hash>
source_crs: EPSG:25832
vertical_reference: DHHN2016_NH
clip_bounds_wgs84: [west, south, east, north]
processing:
  tool_versions: {}
  command_profile: <stable id>
```

### Processing stages

1. acquire only the Bergpark extent plus a small documented buffer;
2. verify source checksum/metadata/CRS/NoData;
3. mosaic only if multiple source tiles are required;
4. keep the canonical clip in the source CRS while preprocessing;
5. derive a Web-Mercator-compatible raster DEM tile pyramid for MapLibre;
6. prefer **Mapzen Terrarium-compatible RGB encoding** for the first spike: MapLibre
   supports it directly and its quantization precision comfortably exceeds DGM1's stated
   vertical accuracy;
7. derive a compact canonical sampling grid/binary from the same DGM1 clip for
   deterministic entity/path metric computation;
8. write a release manifest with source hash -> derived hash lineage;
9. fail validation on out-of-bounds tiles, unexpected height range, NoData leakage,
   missing license metadata or non-deterministic rebuilds.

### Route-profile caution

Do not sum one-metre DGM samples naïvely. DGM1 accuracy and natural surface roughness can
turn noise/micro-relief into false climb. The route profile should test a walking-relevant
sample spacing and smoothing window (for example a few metres, validated rather than
assumed), preserve raw sampled values for audit where size permits, and publish the exact
profile algorithm/version.

Steps remain a semantic OSM/source fact; do not infer a staircase from DEM slope alone.

---

## 11. Renderer-neutral `SpatialWorld`

### Why

Today `src/main.js` and related modules call Leaflet-specific objects directly. The first
migration task is to stop making domain identity depend on the renderer while preserving
all current behavior.

### Contract sketch

```js
/** renderer-neutral; illustrative, not yet frozen API */
SpatialWorld = {
  revision,
  terrain: {
    datasetId,
    bounds,
    verticalReference,
  },
  entities: Map<id, SpatialEntityDescriptor>,
  routes: Map<id, SpatialRouteDescriptor>,
};

SpatialEntityDescriptor = {
  id,                       // canonical stable ID
  kind,                     // place/tree/bench/visitor/artwork/...
  coordinate: { lng, lat },
  elevation: {
    valueM,
    source,
    mode: 'canonical-terrain' | 'sample-terrain',
  },
  importance,
  presentation,             // renderer-neutral semantic representation hints
  lod,
  semanticIds,
  sourceRefs,
};

SpatialRouteDescriptor = {
  id,
  fromId,
  toId,
  coordinates,
  elevationProfile,
  ascentM,
  descentM,
  grade,
  surfaceEvidence,
  accessibilityEvidence,
};
```

### Non-negotiable boundaries

- canonical graph/content objects do not contain `L.Marker`, `maplibregl.Marker`,
  `THREE.Object3D`, R3F components or renderer handles;
- renderer adapters receive descriptors and return lifecycle/control surfaces;
- selection/deep links use canonical IDs, not rendered-object identity;
- low-power Leaflet and terrain MapLibre must address the same entity IDs;
- almanac/audio/detail UI uses those same IDs.

### GitInspect precedent worth reusing

GitInspect currently demonstrates these valuable concepts:

- `DataMapper`-style mapping from domain records to visual descriptors;
- renderer conversion from descriptors rather than domain objects creating Three nodes;
- logical identity preserved across LOD;
- `full` / `simplified` / `aggregate` / `hidden` LOD planning;
- selected/hovered/search-hit promotion above normal distance tier;
- a lazy heavy Three/R3F scene so the accessible shell can become interactive without
  downloading Three first;
- camera movement thresholds that avoid recalculating expensive projections/LOD every
  tiny frame.

### GitInspect code/concepts **not** to transplant

- Railfield/Git deterministic layout — Bergpark has real coordinates;
- Git-specific contracts, mutation preview or repository authority;
- R3F/React component structure — Bergpark is not a React app;
- GitInspect's current WASM fingerprint/capability demo as if it were a renderer;
- desktop/Tauri assumptions;
- 100k-node policies without re-benchmarking for Bergpark's different object mix.

This is architectural reuse, not cargo-cult code copying.

---

## 12. Map/controller migration boundary

Introduce a common map/spatial controller interface around the behavior `src/main.js`
already consumes.

Illustrative surface:

```js
createSpatialRenderer(container, world, options) -> {
  fitPark(),
  focusEntity(id, options),
  showRoute(route, options),
  showUserPosition(position),
  setWalkingNetwork(network),
  setLanguage(language),
  setFeatureLayerState(state),
  invalidateSize(),
  destroy(),
  capabilities,
}
```

### Leaflet adapter

Wrap current `src/map.js` behavior first, with no visual regression. Tree/visitor layers
must either use the same adapter boundary or receive a temporary explicit compatibility
bridge until moved.

### MapLibre adapter

Implement only after the contract and fallback are green. It owns terrain camera and
normal spatial layers.

### Three custom layer

Extract reusable model asset loading/presentation policy from `src/model-viewer.js` without
deleting the modal viewer. The first integrated heritage object should use the same
canonical presentation metadata and detail identity.

---

## 13. UX and interaction policy

### 13.1 Terrain-first overview

The first acceptance scene is not “can we tilt the map?” It is:

> From an oblique overview, the Schloss–Herkules relationship, climb, major water axis and
> connecting terrain must be immediately legible without reading a technical legend.

Use restrained hillshade/color relief and height. Keep north/reset controls obvious.

### 13.2 Camera modes

Prefer bounded, purposeful camera states over game free-flight:

- **overview** — park fit, meaningful oblique pitch;
- **north/reset** — stable cartographic orientation;
- **GPS follow** — location-centred with an easily visible “stop following” state;
- **route** — fit route while retaining terrain relief;
- **landmark focus** — terrain-aware target/elevation, bounded cinematic transition;
- **2D/low power** — Leaflet compatibility mode.

A desktop orbit-like interaction may be useful for focused landmarks, but unconstrained
flying is not primary navigation.

### 13.3 Mobile outdoors

- one-finger pan and pinch zoom remain conventional;
- two-finger pitch/bearing where MapLibre conventions apply;
- large visible compass/reset/follow affordances;
- destination/route information must survive glare and intermittent one-handed use;
- no tiny hover-only actions;
- instructions remain usable when the canvas is partially or entirely ignored;
- audio suggestions are quiet/manual by default.

### 13.4 Mouse and keyboard

- predictable pan/zoom and focus controls;
- all important destination/search/layer operations have DOM buttons/inputs;
- Escape exits focused/cinematic states and returns focus appropriately;
- selection never requires precise 3D picking only;
- focus rings and keyboard order live outside the WebGL canvas where practical.

### 13.5 Screen reader

The canvas is an enhancement, not the semantic document. Expose:

- current location/follow state;
- selected destination;
- route distance/time/ascent/descent and evidence limits;
- nearby entities as an accessible list/search result;
- entity/almanac detail;
- narration transcript/control;
- map mode and fallback controls.

Do not attempt to verbalize every rendered tree/bench as individual canvas accessibility
nodes at once.

### 13.6 Reduced motion / low power

- honor `prefers-reduced-motion`;
- replace long fly/cinematic moves with immediate or short transitions;
- disable ambient autorotation;
- avoid continuous frame loops at rest;
- expose a persistent low-power/2D preference rather than relying solely on device
  heuristics;
- preserve functionality when Three assets never load.

### 13.7 Audio guide

Audio is a canonical-ID-bound content layer, not a renderer feature:

```text
entity/route id -> story/narration descriptor -> language -> audio/transcript controls
```

Default to manual play. Location-aware prompts may be offered later, but should not become
noisy auto-play narration. The product succeeds when the phone can spend long periods in a
pocket.

---

## 14. Almanac architecture

The almanac should not become a second content database.

Create a unified index over canonical identities:

```text
spatial world ───────┐
                     ├── canonical entity id ── detail/almanac
semantic graph ──────┤                       └── audio/story
                     └────────────────────────── focus/route/discovery
```

Potential entity classes include:

- places/landmarks;
- paths/junctions/viewpoints;
- waterworks and water-axis structures;
- trees/ecology;
- artworks/figures/people;
- facilities/benches/access points;
- historic events/relationships where the current semantic model supports them.

Each almanac entry should be able to locate/focus its spatial entity when one exists, and
each spatial entity should be able to open its almanac/detail entry. Non-spatial historical
entities remain valid without fake coordinates.

---

## 15. Offline/PWA architecture

Current service-worker policy is sound in principle:

- application/runtime data is same-origin and cacheable;
- third-party OSM/OpenTopoMap tiles are cached only after viewing and remain bounded;
- no bulk prefetch of third-party tiles.

DGM1 changes the opportunity because the production terrain pyramid is a **derived,
same-origin open-data release artifact**, not a third-party tile API.

### Cache classes

```text
shell cache
  app HTML/assets + core runtime data

terrain cache / release pack
  bounded Bergpark DGM-derived tiles + terrain manifest/sampling artifact

visited third-party map cache
  OSM/OpenTopoMap only as actually viewed, provider-policy bounded

optional packs
  future imagery/audio extras, explicit user opt-in and separately budgeted
```

Do not conflate these categories.

### Offline pack policy

The core terrain pack can be fully available offline **if** its derived size fits the
budget. Do not prefetch statewide data. Optional imagery/large audio belongs in explicit
packs or demand caches.

### Upgrade integrity

Terrain manifest revision must be coupled to:

- source DGM hash;
- tile/sampler encoding profile;
- `SpatialWorld` terrain revision;
- cache version.

A service-worker upgrade must never combine a new renderer with an incompatible old
terrain sampler silently.

---

## 16. Performance and resource budgets

These are **targets to qualify**, not current measurements.

### Startup and loading

- Leaflet/low-power path must remain usable without loading MapLibre/Three terrain chunks;
- terrain mode heavy code is lazy;
- warm offline terrain view target: useful first terrain frame <=1.5 s on representative
  mid-range hardware;
- cold terrain mode target: interactive shell first, terrain progressively follows;
- no blocking statewide/geodata fetch during app boot.

### Default offline storage

Initial target:

- core app + runtime data + bounded DGM1 terrain pack: **<=60 MiB preferred**;
- **80 MiB hard review gate** before making the terrain pack a default offline install;
- optional imagery/audio packs excluded from that default and explicitly budgeted.

The first pipeline must measure actual values before the pack policy is frozen.

### Rendering

Representative terrain+route+POI scene targets:

- >=30 FPS during interaction on an agreed mid-range Android reference class;
- desktop/laptop target near display refresh for ordinary navigation;
- p95 interaction frame time <=50 ms on the mobile reference scene;
- idle renderer should become event/demand driven rather than burning a continuous loop;
- <=100 scene/map draw calls preferred in the normal overview after batching/LOD;
- <=60 simultaneously prominent text labels before collision/importance policy, unless a
  benchmark proves more is readable and cheap;
- GPU memory target <=128 MiB for the active terrain/world scene on the mobile reference;
- JS heap target <=150 MiB after settled terrain/navigation load.

### Heritage models

Preserve the current hard guard until evidence changes it:

- <=5 MiB per loaded external glTF/GLB;
- <=180k triangles hard current ceiling;
- prefer substantially smaller mobile production assets (e.g. <=75k triangles for a
  normal explanatory landmark where visual evidence supports it);
- do not render every landmark at full model detail simultaneously.

### Battery/thermal

A five-minute stationary map view and a representative 15-minute walking/navigation test
must be profiled. A visually impressive path that keeps the GPU at continuous high load
while the visitor is walking fails the product goal.

---

## 17. Fallback tiers

```text
Tier 0  semantic DOM/list/detail only
        no canvas assumption; screen-reader information remains complete

Tier 1  Leaflet 2D low-power / compatibility
        current map semantics, routes, GPS, selective layers

Tier 2  MapLibre terrain WebGL2
        real DGM1 terrain, map-native layers, no Three heritage objects required

Tier 3  MapLibre terrain + Three WebGL2 custom layer
        curated georeferenced models/cues sharing map camera/depth

Tier 4  optional future experimental enhancement
        WebGPU or specialist layer only when focused evidence justifies it
```

No tier may redefine canonical entity IDs or route facts.

---

## 18. Weighted decision matrix

Scores: 1 poor -> 5 excellent for **this product**, not general framework quality.

| Criterion | Weight | Leaflet + current Three | Full custom Three terrain | MapLibre + Three + Leaflet fallback | deck.gl-centric | CesiumJS-centric |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Visitor orientation/navigation | 25 | 3 | 3 | **5** | 4 | 4 |
| Terrain/geospatial correctness | 15 | 1 | 5 | **5** | 5 | 5 |
| Offline/self-hosting fit | 15 | **5** | 4 | **5** | 4 | 2 |
| Migration/domain preservation | 15 | **5** | 3 | **5** | 3 | 2 |
| Mobile performance/power control | 12 | **5** | 3 | 4 | 4 | 3 |
| Accessibility/fallback | 8 | **5** | 3 | **5** | 3 | 3 |
| Curated 3D extensibility | 5 | 3 | **5** | **5** | 4 | **5** |
| Licensing/vendor/token risk | 5 | **5** | **5** | **5** | 4 | 2 |
| **Weighted / 5** | **100** | **3.80** | **3.65** | **4.88** | **3.92** | **3.30** |

The matrix is intentionally product-weighted. Cesium or a custom engine can outperform
MapLibre/Three on different problem definitions; that is not the current problem.

---

## 19. Component / data-flow diagram

```text
             OFFLINE / BUILD-TIME AUTHORITY

  Hessen HVBG DGM1 GeoTIFF        OSM + curated/source datasets
            │                               │
            v                               v
  provenance/checksum manifest      existing layer producers
            │                               │
            v                               v
  GDAL/Rust preprocessing            composed canonical graph
     │                 │                     │
     │                 ├──> canonical DEM    │
     │                 │    sampler/profile  │
     │                 │                     │
     └──> bounded      │                     │
          raster-dem   │                     │
          tile pyramid │                     │
              │        │                     │
              └────────┴──────────┬──────────┘
                                  v
                         SpatialWorld builder
                    stable IDs / provenance / LOD
                                  │
                 ┌────────────────┼────────────────┐
                 │                │                │
                 v                v                v
          Leaflet adapter   MapLibre adapter   Almanac/audio/detail
          low-power 2D      terrain/camera      accessible DOM
                                  │
                                  v
                        Three custom 3D layer
                    curated heritage/nature cues

                        RUNTIME NAVIGATION

    GPS -> navigation intent -> canonical ID/route -> active renderer
                                      │
                                      └-> same detail/audio/deep link
```

---

## 20. Measurable success criteria

### Terrain correctness

- a fixed set of canonical control points matches the DGM1 sampling artifact within the
  encoding/interpolation tolerance defined by the pipeline;
- no canonical entity persists an elevation taken from visually exaggerated terrain;
- DGM source/version/hash is visible in evidence metadata;
- old GLO-90 provenance is preserved historically rather than silently rewritten.

### Schloss–Herkules vertical slice

- oblique overview visibly communicates the climb and water-axis relationship;
- selecting either landmark focuses it without losing spatial context;
- route detail shows distance/time/ascent/descent and evidence strength;
- no independent Three camera drift exists;
- Leaflet mode still locates the same canonical IDs.

### Navigation

- GPS follow can be entered/exited predictably;
- route/selection survives renderer switch where practical;
- deep links restore the same entity/detail regardless of renderer;
- “where am I?”, “where is X?” and “what is nearby?” have explicit user-facing paths.

### Accessibility

- reduced-motion mode has no mandatory cinematic movement;
- keyboard can select/search/focus without 3D picking;
- screen reader receives route/selection/location semantics outside canvas;
- no-WebGL2 path remains usable;
- serious/critical automated a11y checks remain green, followed by manual keyboard/screen
  reader review for new terrain controls.

### Performance

Record, do not merely eyeball:

- first useful terrain frame;
- JS bundle split sizes;
- terrain pack bytes/tile count;
- frame-time distribution during pan/zoom/follow/focus;
- draw calls and triangles;
- JS heap/GPU resource estimates where tooling permits;
- 5-minute idle and 15-minute active thermal/battery behavior on reference hardware.

---

## 21. Benchmark and profiling plan

### Reference scenes

1. **overview:** full park, terrain + principal routes + major landmarks;
2. **Schloss/Herkules:** oblique vertical relationship with water-axis cues;
3. **dense visitor layer:** trees/benches/visitor POIs under LOD;
4. **active route:** route line, profile/detail, GPS-follow simulation;
5. **heritage focus:** terrain plus one integrated glTF landmark;
6. **fallback:** Leaflet path with identical entity/deep-link assertions.

### Tools/evidence

- browser Performance panel/traces;
- `performance.mark/measure` around terrain/model lifecycle;
- WebGL renderer info/draw-call counters where reliable;
- Playwright deterministic viewport flows and screenshots;
- repeatable synthetic GPS fixtures rather than live location for CI;
- actual mobile-device traces before declaring performance green;
- repository-local evidence, never ephemeral `/tmp` output.

### Comparison rules

- warm vs cold cache reported separately;
- WebGPU/WASM comparisons must use the same scene/data and include startup cost;
- no performance conclusion from a desktop-only synthetic benchmark;
- visual evidence accompanies numerical terrain/camera acceptance.

---

## 22. Implementation roadmap — maximum eight meaningful phases

The program is capped at eight meaningful phases unless explicitly extended. The slices
below combine related work so the cap remains real.

### Phase 1 — architecture decision record — **this phase**

- inspect repository and current GitInspect precedent;
- verify current upstream mapping/rendering/data capabilities;
- write and commit this report;
- no shared runtime/data implementation writes.

**Exit:** `reimagined.md` committed, internally coherent, source ledger current, Phase-2
continuation saved/dispatched.

### Phase 2 — Slice 0: preserve authority and introduce `SpatialWorld`

- add renderer-neutral descriptor/coordinate/capability contracts;
- adapt current Leaflet path behind a spatial renderer/controller boundary;
- preserve graph/content/routes/GPS/deep links/visitor/tree behavior;
- add feature preference/capability gate with Leaflet as default;
- add contract/unit tests;
- no MapLibre dependency is required merely to prove the boundary.

**Reversible:** yes. Kill if abstraction makes current behavior materially worse or leaks
renderer objects into domain data.

### Phase 3 — Slice 1: DGM1 acquisition + deterministic terrain authority — **complete**

- verify exact official acquisition mechanics;
- add source/license/checksum manifest;
- bounded Bergpark clip only;
- deterministic bounded acquisition/conversion pipeline;
- lossless renderer-neutral Float32 intermediate + provenance manifest;
- terrain sampling/coordinate validation and size measurements;
- artifact/cache policy before large data is committed.

**Commitment point:** DGM1 becomes preferred physical Z only after source/provenance and
sampling checks pass.

Phase 3 intentionally stopped before any renderer derivative. Its committed DGM1 authority
is `terrain/artifacts/bergpark-dgm1.npz` SHA256
`cdff4e9d51f8bb1679b6a0e4f9ca6c1aeaa603488644faedafe3685e74989b4b` plus the reviewed
source/artifact manifests.

### Phase 4 — Slice 2: Leaflet-preserving MapLibre terrain coexistence — **complete**

- add MapLibre GL JS 6.6 behind the explicit `renderer=terrain` preference and WebGL2 /
  reduced-power capability gate; `auto` and `leaflet` remain Leaflet;
- deterministically derive only 56 Terrarium tiles at z14-z16 from the immutable Phase-3
  intermediate (4,670,817 tile bytes; manifest SHA256
  `2d48c4f1c14958304e6fe8c5ec3b6174b4687ba2e7f61b659f8f0fade3d38417`);
- keep DGM1 metres at terrain exaggeration 1.0 with bounded WGS84 source bounds and
  explicit HVBG / `dl-zero-de/2.0` attribution;
- project canonical places, routes, walking network, GPS position, trees and visitor
  features only from renderer-neutral `SpatialWorld` / controller inputs;
- bound the terrain camera to the park envelope, z13-z18 and maximum 60° pitch; use a 45°
  overview and deterministic north-facing focus; honor reduced motion;
- fail closed to Leaflet when WebGL2 or terrain initialization is unavailable, and to a
  flat usable MapLibre map when a runtime DEM tile source fails;
- preserve place/tree/visitor deep links, language state and selection identity through the
  same controller boundary;
- retain explicit Leaflet-only compatibility overlays without requiring them from the
  MapLibre path;
- keep MapLibre as a lazy chunk so the default Leaflet startup does not load it;
- no Three custom layer, route-elevation recomputation, WebGPU/WASM/AR or graph mutation.

Focused qualification is 15/15 Node spatial/terrain/motion tests, 5/5 Python derivative
tests, 7/7 serialized Chromium coexistence/fallback/GPS tests and a production build. The
committed renderer derivative is about 4.45 MiB, well below the 60 MiB preferred / 80 MiB
review terrain-pack gates. MapLibre GL JS 6.6.0 is BSD-3-Clause licensed.

Broad Phase-4 qualification keeps inherited failures explicit rather than consuming their
owners: Biome is green (59 files), Node is 69/69, Vitest is 2/2, build/runtime-artifact
budgets are green, and the full Chromium suite is 39/40. The single Chromium failure is the
pre-existing `phase6-integration.spec.js` selector for the old search placeholder; the
current independent unified-search UI exposes `Place, person, tree, visitor feature …`
instead, and that test fails before renderer interaction. Python is 86/87 with the separate
`bergpark-webapp` graph-composition blocker at `tests/test_semantic.py:136` and the same 18
figure IDs missing from `data/graph.json`. Phase 4 does not repair either unrelated lane.

**Kill criterion:** if MapLibre terrain cannot meet mobile reliability/budget, retain the
SpatialWorld/DGM pipeline and reassess renderer without deleting the Leaflet path.

### Phase 5 — Slice 4: georeferenced Three heritage layer — **complete**

- integrate exactly the existing `aquaedukt` / `aqueduct-gltf-v1` schematic into the
  explicit MapLibre terrain mode as one `renderingMode: '3d'` custom layer;
- use MapLibre's canvas, supplied WebGL2 context, camera projection and shared depth buffer;
  Three owns only the one scene object and has no independent navigation camera or canvas;
- place the object from canonical `SpatialWorld` WGS84 identity plus
  `queryTerrainElevation()`, with an explicit 1 metre per schematic-unit presentation
  conversion and a 0.35 m presentation-only ground offset; no renderer elevation is
  written back to `SpatialWorld`, graph Z or route data;
- extract the existing model-loader boundary so the modal viewer and terrain layer share
  the same 5 MiB / 180,000-triangle limit, same-origin top-level request and stricter
  embedded-only secondary-resource policy;
- reset Three GL state before and after each custom-layer draw, never clear/resize the
  MapLibre framebuffer, and never install a Three animation loop or idle repaint loop;
- keep the existing DOM marker/detail/deep-link interaction and lazy modal model viewer as
  the accessible selection and fallback path;
- deterministically dispose model geometry/materials/textures and Three renderer state on
  layer removal and WebGL context loss; MapLibre 6 destroys custom layers while restoring
  its style, so the adapter explicitly re-adds the reusable layer on the restored
  `style.load` boundary;
- fail the object integration closed without failing terrain mode when Three/model loading
  cannot initialize, and remove the object if the terrain source itself degrades to the
  existing flat MapLibre fallback;
- do not expand beyond this one heritage object in Phase 5.

Focused qualification is 26/26 Node placement/lifecycle/policy/controller tests and 5/5
serialized Chromium Phase-5 tests. Current-build broader browser qualification across the
Phase-4 terrain suite, Phase-5 shared-depth suite and existing visitor/model-viewer suite is
21/21, including real draw evidence, canonical deep-link continuity, WebGL context
loss/restore, secondary-resource network-escape rejection, reduced motion, WebGL2/terrain
fallbacks, the Leaflet default and the retained modal glTF viewer. Full JS qualification is
Biome-green (64 files), Node 77/77 and Vitest 2/2; production build and runtime-artifact
budgets are green. The independent Python graph-composition suite remains 86/87 with only
`tests/test_semantic.py:136` failing on the same 18 figure IDs absent from `data/graph.json`;
Phase 5 does not consume that `bergpark-webapp` blocker. The previously classified stale
`tests/e2e/phase6-integration.spec.js` old-placeholder selector also remains outside this
lane and was not repaired.

The one-object shared-depth architecture is therefore stable enough for logical Phase 6 to
start the product-first navigation/discovery/almanac/audio tranche. Representative physical
mobile GPU/thermal profiling remains an explicit Phase-8 qualification item rather than a
reason to broaden this spike.

**Kill criterion:** if later representative mobile qualification shows shared-depth
instability, keep terrain in MapLibre and retain landmark models in the existing
modal/detail path.

### Phase 6 — Slices 5–7: navigation, discovery, almanac and audio foundations — **complete**

Logical Phase 6 is a bounded visitor-first product tranche on top of the Phase-5 renderer
authority. It does not add a renderer, terrain source, graph edge, knowledge record, route
elevation calculation or media asset.

Navigation now presents direct canonical route edges as a deterministic comparison surface.
Walking time, distance, ascent, mapped-path accessibility, mapped steps and surface labels
come only from the existing route evidence; the visitor can sort by time, distance or ascent
without generating a new route or implying finer elevation precision. Manual route selection,
GPS/geofence selection and the existing route-detail uncertainty language remain unchanged.

The existing destination index is now an almanac surface with bounded category filters for
places, people/art, trees and visitor features. Existing `#place`, `#tree` and `#feature`
links remain the identity contract, including semantic entities that were already addressed
through `#place`. A parsed canonical link that is absent after supplemental hydration now
fails visibly instead of silently leaving the visitor on an ambiguous map state.

The deferred walking-network snapshot is projected through `SpatialWorld` with its preserved
`pathnode-*` / `pathseg-*` identities, source-backed surface/highway/accessibility fields and
derived unique-neighbour junction degree. The Index exposes junctions, mapped steps and path
segments in a keyboard-operable DOM surface. It renders at most 40 network results and, more
importantly, does not allocate the roughly 4.5k searchable network projection until the
visitor explicitly opens **Paths & junctions**. Selecting a network item only focuses the
controller-owned map position; it does not fabricate a route or introduce another deep-link
namespace. The inherited destination-list cap remains 80 after broad regression caught and
rejected an unnecessary attempt to tighten it.

Audio is manual and transcript-first. `audio-guide.js` projects only existing bilingual
editorial fields into a narration descriptor. Constructing the controller is inert; only an
explicit Listen action can call browser speech synthesis, a second request cancels the prior
utterance, Stop is visible only while active, and the exact editorial transcript remains
available when speech output is unsupported. There is no autoplay, audio fetch, media cache,
voice-agent backend or continuous audio loop.

Adversarial Phase-6 review closed the requested product risks as follows:

- destination ambiguity is bounded by deterministic search ranking plus explicit almanac
  category filters; stable IDs remain visible/searchable where the source is otherwise unnamed;
- stale canonical IDs fail visibly only after supplemental data has had a chance to hydrate;
- route cards project `routeEvidence` fields and never recompute elevation or infer a
  "better" accessible route;
- GPS accuracy-circle hysteresis and reduced-motion controller behavior are untouched and
  remain covered by the inherited tests;
- the almanac retains the established 80-row DOM cap; optional network discovery is capped at
  40 rendered rows and lazily materialized on disclosure;
- narration has no startup side effect and enforces one active utterance at a time;
- no service-worker/media-cache rule changed, so offline cache growth is limited to the
  already-authorized runtime/static/tile policy;
- no new interval, animation frame, background fetch, renderer, terrain, Three asset or 3D
  object was introduced by this tranche.

Qualification on 2026-08-29:

- Biome: 69 files clean with warnings treated as errors;
- Node: 81/81 pass; Vitest: 2/2 pass;
- focused Phase-6 browser: 5/5 pass, including Leaflet default, canonical identity,
  keyboard/reduced-motion network discovery, narration + transcript + axe, stale IDs and
  warmed offline behavior;
- broad relevant Chromium matrix: 48/48 pass across Phase 2/3 visitor behavior, Phase-4
  MapLibre terrain/fallback, Phase-5 shared depth, PWA/runtime upgrade and visitor-guide E2E;
- runtime artifact: 6,144,047 / 8,388,608 data bytes, 241,377 / 393,216 initial JS bytes,
  38,518 / 98,304 initial CSS bytes;
- `data/graph.json`, `data/figures.json` and `data/semantic.json` retain the Phase-5 hashes
  `f8375d1c…`, `287824de…` and `3dfacad0…`; production data, service worker and renderer files
  are unchanged by this phase;
- Python remains the inherited 86/87 only: `tests/test_semantic.py:136` still reports the same
  18 figure IDs absent from `data/graph.json`. This is the independent owning-lane mismatch
  and was not repaired here. The stale old-placeholder `tests/e2e/phase6-integration.spec.js`
  likewise remains untouched.

Phase 6 is therefore genuinely useful/stable and makes logical Phase 7 eligible for measured
performance specialization only. Phase 7 must still earn any optimization from profiling; it
must not reinterpret this completion as permission for a second 3D object or broader renderer
scope.

### Phase 7 — Slice 8: measured performance specialization

- instancing/batching/culling/LOD/compression/demand rendering first;
- workers for measured CPU hotspots;
- browser Rust/WASM only if its gate is met;
- WebGPU spike only if a real quality/performance hypothesis exists;
- record rejection as a valid result if either technology does not earn its complexity.

### Phase 8 — adversarial qualification and architecture closeout

- representative mobile + desktop profiling;
- headed visual/browser evidence;
- offline upgrade/cache qualification;
- keyboard/screen-reader/reduced-motion checks;
- renderer fallback/device failure scenarios;
- data/license/provenance audit;
- update this report to match reality;
- terminal `STANDBY / COMPLETE AND GREEN` if all gates pass, otherwise exact bounded
  blocker/continuation with no blind polling.

Phase-8 closeout on 2026-08-29 is **`STANDBY / BLOCKED_EXTERNAL_FIXTURE`**, not
`COMPLETE AND GREEN`, and does not authorize a Phase 9. Every architecture gate that can be
truthfully exercised on the available representative desktop is green after one bounded
accessibility correction, but no physical mobile browser fixture was attached (`adb devices -l`
was empty and no iOS device could be enumerated). Therefore physical-mobile sustained p95,
thermal, battery and GPU-memory/context acceptance remain unestablished; browser emulation is
not substituted for that evidence. No runnable Orca/screen-reader fixture was available either,
so automated accessibility evidence is not described as real screen-reader product acceptance.

Representative headed-desktop evidence:

- default/auto still resolves to Leaflet; Index renders exactly 80 initial destinations;
  keyboard disclosure of Paths & junctions renders exactly 40 rows, and a focused network row
  activates with Enter while Leaflet remains the renderer;
- canonical `#place=aquaedukt` exposes transcript-backed quiet narration with
  `speechSynthesis.speaking=false` before explicit play, four direct-route choices preserve
  mapped time/distance/ascent plus access/surface evidence, and route focus preserves the
  canonical source selection; a hard-navigation stale ID remains visible as an unavailable
  saved Park link instead of silently selecting another object;
- detail entry/exit is keyboard-safe: activating the Aquaedukt Almanac row focuses the close
  control, and closing returns focus to the originating Aquaedukt row;
- reduced-motion terrain remains functional and the deterministic GPS tests retain the 30 m
  enter / 45 m exit hysteresis, accuracy-circle gate and controller-owned selection lifecycle;
- the first fresh cold profile reproduced a 66.9 ms font/layout event dominated by text shaping
  and font fallback, while three warm Leaflet reloads had zero renderer-main/layout tasks at or
  above 50 ms. Independent Phase-8 qualification likewise saw a cold-only host/layout outlier
  followed by warm reloads without >50 ms long-animation-frame work. This is classified as a
  cold host/font-cache cost, not an earned product optimization target;
- the Phase-7 `heritage=pending >10 s` observation was reproduced once only when the bounded
  preview-server process expired while `assets/maplibre-gl-worker.mjs` had no completed
  response. With a newly started preview server still live, a fresh terrain+Aquaedukt load was
  `ready/rendered`, completed Three/GLTF resources, and then held a 20 s settled soak at
  95 -> 95 resources with zero long tasks and essentially flat measured heap
  (33,718,419 -> 33,726,766 bytes). Six earlier same-profile warm reloads were also
  `ready/rendered` by 2.5 s. The pending observation is therefore classified as a bounded
  harness/server-lifetime artifact rather than a renderer lifecycle defect;
- a 20 s settled Leaflet sample likewise had no long tasks and released heap rather than showing
  monotonic retention. Host-wide NVIDIA telemetry moved only from 58 C / 7.27 W / 0% reported
  utilization to 57 C / 11.23 W / 0%, but this is not per-browser attribution and is not used as
  physical-mobile thermal/GPU evidence.

Offline/PWA closeout:

- current deterministic service-worker tests re-prove atomic deployed-v4 -> v6 upgrade,
  failed-candidate preservation, cache-first static assets, network-first runtime JSON with
  offline fallback, explicit uncached-data 503 behavior, and the manifest-authorized visited
  tile budget;
- a clean headed controlled origin used about 6.46 MiB at Leaflet startup and about 8.59 MiB
  after explicit terrain+Aquaedukt warm-up; warmed terrain/shared-depth and warmed Leaflet +
  Almanac both reopened offline successfully;
- real visitor-driven map churn reached the exact 80-entry tile cap. Independent qualification
  measured 51 shell entries / 10,052,837 readable shell bytes and a 13,004,773-byte complete
  production `dist`; the committed Terrarium derivative remains 4,670,817 tile bytes. These
  remain well below the 60 MiB preferred / 80 MiB review gates;
- Chromium `navigator.storage.estimate()` on profiles containing opaque third-party tile
  responses is privacy-padded and was non-monotonic, so it is retained as browser telemetry but
  is not treated as authoritative third-party body-size evidence. No bulk tile prefetch was
  introduced or used.

Accessibility and failure-matrix closeout:

- default and detail axe scans had zero violations. The full terrain/detail scan exposed one real
  normal-text contrast defect: `.gallery-placeholder > small` was 4.18:1. Phase 8 changes only
  that credit color from `#667269` to the existing `#536159` tone (~5.42:1); the rebuilt full
  terrain/detail scan returns zero violations. Remaining axe findings are incomplete contrast
  determinations around image-backed content, not violations;
- default/auto Leaflet, explicit terrain, reduced motion, WebGL2-only capability gating and
  reduced-power fail-closed selection remain covered by current deterministic tests. A headed
  aborted terrain-manifest request fell back to Leaflet with
  `terrain-initialization-failed` while preserving Aquaedukt detail;
- headed `WEBGL_lose_context` moved the one shared-depth object to `context-lost`; restoring the
  retained context returned terrain + Aquaedukt to `ready/rendered` with canonical selection
  intact. Current unchanged Phase-5/Phase-7 browser coverage retains model/shared-depth
  initialization-failure and terrain-tile flat-fallback behavior. Aquaedukt remains the only
  shared-depth spatial 3D object and has no independent canvas/camera/animation loop.

Authority and regression audit:

- Phase-3 DGM1 source/artifact authority is byte-for-byte unchanged from `7b44d999…` and Phase-4
  Terrarium authority is byte-for-byte unchanged from `3fcb91e…`; source manifest, derivative
  manifest, checksums and `dl-zero-de/2.0` provenance remain exact;
- graph/figures/semantic/source and bilingual knowledge authorities retain their owning-lane
  hashes; no graph, semantic, terrain source, route elevation, model family or public-data
  acquisition changed in Phase 8;
- after the contrast fix: Biome 69 files clean, Node 81/81, Vitest 2/2, production build and
  runtime budgets are green at 6,144,047 / 8,388,608 data bytes, 241,368 / 393,216 initial JS
  bytes and 38,518 / 98,304 initial CSS bytes. Independent current-product Chromium closeout is
  48/48 green. Python remains the exact inherited 86/87 only at `tests/test_semantic.py:136`;
  the stale `tests/e2e/phase6-integration.spec.js` fixture remains unchanged and out of scope.

### Integration-seam continuation — 2026-09-01

The visitor product now has a same-session renderer switch in the shared top-level chrome. Leaflet
remains the default; activating the switch replaces the existing renderer rather than mounting a
second map. The controller accepts an explicit in-session renderer preference, while canonical
selection, current view, route state, language, GPS position, visitor filters and the bounded tree
filter remain in the main orchestration and are rehydrated into the replacement renderer.

The switch also rebuilds the named Leaflet compatibility overlays whenever a Leaflet adapter is
created, preventing stale tree/visitor layer references from surviving a terrain transition.
Renderer preference is reflected in the URL without creating a second deep-link namespace;
returning to the default map removes the explicit renderer query while preserving the canonical
hash identity.

The new product-shaped headed Chromium qualification covers same-session Leaflet -> terrain ->
Leaflet switching, landmark selection, direct-route detail with DGM1 elevation evidence, route
detail return, canonical deep-link continuity, offline reload of warmed content, terrain-init
failure recovery, shared-depth model failure recovery, and final selection continuity. The
focused integration matrix is 9/9 green and the current spatial/navigation Node matrix is 36/36;
`pnpm run check` is green with 120 Node tests + 2 Vitest tests + 87 Python tests, production build
and runtime budgets green. This continuation does not change DGM1, route calculation, heritage
geometry, or the one-object shared-depth architecture.

The smallest truthful continuation remains external qualification only: attach and authorize the
representative physical mobile browser/device required by this architecture, collect sustained
interaction + idle p95/thermal/battery/GPU-memory/context evidence, and exercise a real
screen-reader fixture if screen-reader product acceptance is required. Until those fixtures
exist, do not dispatch Phase 9 and do not add speculative renderer/performance machinery.

---

## 23. Risks, unknowns and kill criteria

| Risk / unknown | Current state | Required response |
| --- | --- | --- |
| Official DGM1 arbitrary-area direct download automation | **qualified in Phase 3** | official HVBG INSPIRE WCS `he_dgm1`; keep bounded request + immutable checksum/source manifest and retain the shop only as manual fallback |
| DGM1-derived route grade becomes noisy at 1 m | expected risk | test filtering/resampling; never publish raw one-metre noise as trustworthy climb |
| MapLibre + Three shared depth on target mobile devices | **focused browser-qualified in Phase 5**; representative physical-mobile profiling still pending | keep the one-object architecture bounded; complete target-device GPU/thermal/context qualification in Phase 8 before broader 3D scope |
| Terrain pack too large for default offline install | **current bounded pack is within budget**: 4,670,817 Terrarium tile bytes; clean headed warm origin ~8.59 MiB; production `dist` 13,004,773 B | preserve the 60 MiB preferred / 80 MiB review gate; reduce zoom/resolution/bounds before abandoning offline principle |
| MapLibre migration breaks existing deep links/GPS/accessibility | controllable | Leaflet adapter parity tests; renderer-neutral identity; no big-bang switch |
| WebGPU coverage/integration | currently non-Baseline; shared-depth seam mismatch | optional later spike only; reject if no clear win |
| Browser WASM overhead exceeds compute win | unknown | worker/JS baseline first; typed-array coarse benchmark; reject if gate unmet |
| Generic LoD2/DOM data encourages vanity reconstruction | product risk | use only for verified explanatory/QA roles; no digital-twin milestone |
| Battery/thermal load harms real visit | material | demand rendering, low-power mode, real-device traces; visual quality loses to visit usability |
| Source/license terms drift | ongoing | snapshot item metadata/license/retrieval date with each acquisition |

---

## 24. Explicit non-goals

- camera AR/WebXR;
- virtual substitution for the real park;
- photorealistic digital-twin completion as a prerequisite;
- mandatory commercial basemap/terrain/photorealistic API;
- big-bang Leaflet removal;
- a React/R3F migration solely to render Three;
- a Rust/WASM renderer rewrite;
- WebGPU as a navigation requirement;
- a renderer-specific fork of the knowledge graph;
- fabricated elevations or object heights;
- statewide geodata checked into Git;
- bulk prefetching third-party OSM/OpenTopoMap tiles.

---

## 25. Fresh research ledger

Checked: **2026-08-28**. Prefer the primary/official source below. URLs are recorded here
so future phases can re-check assumptions instead of relying on this document's age.

### MapLibre

- CustomLayerInterface — map camera, supplied WebGL2 context, 3D shared depth:
  https://maplibre.org/maplibre-gl-js/docs/API/interfaces/CustomLayerInterface/
- Official Three-on-terrain example:
  https://maplibre.org/maplibre-gl-js/docs/examples/adding-3d-models-using-threejs-on-terrain/
- Raster DEM source specification — Mapbox Terrain RGB / Mapzen Terrarium support and
  bounded source semantics:
  https://maplibre.org/maplibre-style-spec/sources/
- Terrain style specification — source + exaggeration, default 1:
  https://maplibre.org/maplibre-style-spec/terrain/
- Map API — `queryTerrainElevation` and terrain camera APIs:
  https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/
- MapLibre GL JS license (BSD-3-Clause):
  https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt

### Three / WebGPU

- Three `WebGPURenderer` current guidance — WebGL2 fallback, experimental state,
  migration constraints, WebGLRenderer status:
  https://threejs.org/manual/en/webgpurenderer
- Three `WebGLRenderer` — WebGL2 renderer; WebGL1 unsupported since r163:
  https://threejs.org/docs/pages/WebGLRenderer.html
- MDN WebGPU — currently Limited availability / not Baseline:
  https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
- Three.js license (MIT):
  https://github.com/mrdoob/three.js/blob/dev/LICENSE

### deck.gl

- TerrainLayer:
  https://deck.gl/docs/api-reference/geo-layers/terrain-layer
- TerrainExtension — explicitly experimental:
  https://deck.gl/docs/api-reference/extensions/terrain-extension
- deck.gl license (MIT):
  https://github.com/visgl/deck.gl/blob/master/LICENSE

### Cesium

- Cesium World Terrain — hosted ion access and documented Europe resolution:
  https://cesium.com/platform/cesium-ion/content/cesium-world-terrain/
- Cesium terrain overview — hosted/offline/on-premises paths:
  https://cesium.com/learn/cesiumjs-learn/cesiumjs-terrain/
- CesiumTerrainProvider — quantized-mesh/heightmap terrain from a URL/provider:
  https://cesium.com/learn/cesiumjs/ref-doc/CesiumTerrainProvider.html
- Google Photorealistic 3D Tiles in CesiumJS — access token path:
  https://cesium.com/learn/cesiumjs-learn/cesiumjs-photorealistic-3d-tiles/
- CesiumJS license (Apache-2.0):
  https://github.com/CesiumGS/cesium/blob/main/LICENSE.md

### Hessen HVBG / Hessen Open Data

- ATKIS DGM — DGM1 1 m, accuracy, GeoTIFF, ETRS89/UTM32N + DHHN2016_NH, free
  self-service availability:
  https://hvbg.hessen.de/landesvermessung/geotopographie/3d-daten/digitale-gelaendemodelle
- ATKIS-DGM1 metadata/license — `dl-zero-de/2.0`:
  https://opendata.hessen.de/dataset/atkis-dgm-1
- DOM/DOM1:
  https://hvbg.hessen.de/landesvermessung/geotopographie/3d-daten/digitale-oberflaechenmodelle
- Airborne Laserscanning:
  https://hvbg.hessen.de/landesvermessung/geotopographie/3d-daten/airborne-laserscanning
- Hessen 3D building models / LoD2:
  https://hvbg.hessen.de/landesvermessung/geotopographie/3d-daten/3d-gebaeudemodelle
- ATKIS DOP20 metadata/license:
  https://opendata.hessen.de/dataset/atkis-dop-20

### BKG comparison

- BKG terrain catalogue — national DGM product availability/pricing context:
  https://gdz.bkg.bund.de/index.php/default/digitale-geodaten/digitale-gelandemodelle.html
- BKG 2026 Open Data product catalogue — public national open-data products include
  DGM200/DGM1000 rather than DGM1:
  https://www.bkg.bund.de/SharedDocs/Downloads/BKG/DE/Publikationen/Downloads-DE-Flyer/BKG-Produktkatalog-Open-Data-DE.pdf
- BKG LoD2 Germany product context:
  https://gdz.bkg.bund.de/index.php/default/3d-gebaudemodelle-lod2-deutschland-lod2-de.html

---

## 26. Final architecture statement

Bergpark Reimagined should make the mountain easier to understand while asking for less
attention from the visitor.

The committed direction is:

**real Hessen DGM1 physical terrain -> deterministic bounded offline artifacts ->
renderer-neutral canonical `SpatialWorld` -> MapLibre terrain/camera/map semantics ->
curated Three shared-depth 3D only where it teaches something -> the same canonical IDs in
Leaflet fallback, navigation, discovery, almanac and audio.**

The first implementation work is therefore not “make a 3D demo.” It is **Slice 0: make
current authority renderer-neutral without breaking the working app**, followed by a
provenance-first DGM1 pipeline and only then the terrain renderer.
