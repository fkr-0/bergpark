# Architecture

Bergpark is a small visitor application backed by a comparatively rich public-data
model. The architectural goal is to keep research/source provenance, generated
spatial layers and browser presentation independently maintainable while still
producing one coherent release.

## Product boundaries

### 1. Research/source layer

Preserved inputs live under `data/sources/` and `data/research/`.

Examples:

- OpenStreetMap POI and map snapshots;
- catalogue/tree source records;
- preserved elevation API responses;
- Wikimedia Commons geosearch audits;
- official/heritage source references and research notes.

Normal release builds should consume preserved inputs and not silently contact
external services.

### 2. Generated data layers

The repository currently or imminently has these independent generated layers:

- places: `data/nodes.json`;
- directed visitor connections: `data/edges.json`;
- trees: `data/trees.json`;
- benches: `data/benches.json`;
- route-topology projection: `data/path_topology.json`;
- historical people/entities: `data/figures.json`;
- semantic relationships: `data/semantic.json`;
- bilingual content: `data/nodes.de.json`, `data/nodes.en.json`;
- source registry: `data/sources.json`.

Each layer should have exactly one producer and one validator.

### 3. Composition layer

`data/graph.json` is now a pure composition artifact produced by
`scripts/compose_graph.py`. The composer validates independently owned layer
schemas/counts, records exact input hashes and never regenerates or resets lower-
level layer outputs.

Current flow:

```text
preserved sources
      │
      ├── build places/routes ── validate ── nodes.json / edges.json
      ├── build trees ───────── validate ── trees.json
      ├── build benches ─────── validate ── benches.json
      ├── build path topology ─ validate ── path_topology.json
      ├── build semantics ───── validate ── figures.json / semantic.json
      └── authored knowledge ── validate ── nodes.de/en.json / sources.json
                                         │
                                         ▼
                                  compose_graph.py
                                         │
                                         └── graph.json + composition input hashes
```

Runtime publication is a separate boundary driven by
`runtime/runtime-data-manifest.json`; aggregate/audit graph artifacts are not
implicitly shipped to the browser.

### 4. Runtime publishing layer

`scripts/copy-data.mjs` copies or derives the deployable subset into
`public/data/` before Vite builds. The authoritative layer list, schemas, load
phases, precache policy and byte budgets live in
`runtime/runtime-data-manifest.json`; the generated public manifest adds exact
hashes/sizes for the concrete build.

### 5. Browser application

The PWA is intentionally small:

- `src/data.js` — runtime layer loading and lookup indexes;
- `src/map.js` — Leaflet map, place markers and route geometry;
- `src/presentation.js` — per-node visual presentation policy;
- `src/model-viewer.js` — lazy Three.js/glTF landmark viewer and bounded asset loader;
- `src/gps.js` — geolocation/proximity behavior;
- `src/content.js` — detail rendering, source links and TTS;
- `src/trees.js` — tree filtering/list UI;
- `src/glossary.js` — searchable entity index;
- `src/i18n.js` — DE/EN runtime strings.

The browser should consume validated release artifacts, not reproduce research or
source-resolution logic.

### Rich node presentation and 3D runtime

Leaflet remains the authoritative 2D navigation surface. Replacing the whole
visitor map with a permanent WebGL scene would make GPS, routing, accessibility,
offline operation and low-end-mobile performance harder for little benefit.
Instead, individual entities opt into richer presentation independently.

The browser presentation contract has two independent surfaces:

```js
{
  map: {
    kind: 'pin' | 'structure' | 'model',
    structure: 'hercules' | 'palace' | 'castle' | 'fountain' | 'aqueduct',
    modelUrl: './models/example.glb',
    posterUrl: './models/example.webp',
    scale: 1.0,
  },
  detail: {
    kind: 'standard' | 'embedded-visual' | 'model-ready' | 'model',
    assetId: 'stable-ui-asset-id',
    modelUrl: './models/example.glb',
    posterUrl: './models/example.webp',
  },
}
```

`pin` is the cheap default. `structure` is a DOM/CSS pseudo-3D marker used for a
small number of important landmarks. `model` enables a real interactive Three.js
scene only after the visitor selects the node and explicitly opens its 3D view.
The renderer, OrbitControls and GLTFLoader are dynamically imported; normal map
startup therefore does not download or initialize Three.js.

The first implemented 3D set is:

- Herkules — procedural schematic scene;
- Schloss Wilhelmshöhe — procedural schematic scene;
- Löwenburg — procedural schematic scene;
- Große Fontäne — procedural schematic scene;
- Aquädukt — same-origin glTF asset through the production GLTFLoader path.

These views are explicitly schematic and not survey-grade, metrically exact
reconstructions. They are presentation artifacts and must not be confused with
canonical spatial or historical evidence.

External glTF/GLB assets are restricted to the Bergpark origin and fail closed
above 5 MiB or 180,000 triangles. A load/WebGL failure leaves the ordinary map
and editorial detail path usable. The viewer has rotate/pause, reset and close
controls; drag/wheel interaction; Escape-to-close; focus restoration; reduced-
motion-aware autorotation; resize handling; and explicit renderer/geometry/
material disposal on close.

Presentation metadata is deliberately separate from historical/spatial truth.
The initial landmark overrides live in `src/presentation.js`; once the asset set
becomes large they may move to a small deployable UI manifest, but they must not
be mixed into canonical coordinate/provenance claims merely to control
appearance.

## Stable ID namespaces

IDs are public compatibility contracts once released.

Recommended namespaces/rules:

- places: existing stable lowercase slugs (`herkules`, `schloss`, ...);
- path nodes: `path-<source-or-stable-derived-id>`;
- path segments: stable directed IDs derived from path-node endpoints/source IDs;
- trees: `tree-<osm-node-id>`;
- benches: `bench-<osm-node-id>`;
- figures: stable semantic slugs or source-backed authority IDs with aliases;
- artworks: `artwork-<stable-slug-or-authority-id>`;
- content IDs: may differ from route/place IDs only through explicit aliases.

A rename requires an alias/migration, not an in-place silent replacement.

## Proposed common spatial contract

All coordinate-bearing entities should converge on a common shape:

```json
{
  "id": "...",
  "kind": "place|tree|bench|path_node|artwork|...",
  "lat": 51.0,
  "lng": 9.0,
  "elevation_m": 300.0,
  "position_source": {
    "provider": "OpenStreetMap",
    "element": "node/123",
    "source_timestamp": "...",
    "method": "source_node",
    "horizontal_accuracy_m": null,
    "accuracy_status": "not_reported_by_source"
  },
  "elevation_source": {
    "provider": "Open-Meteo Elevation API",
    "dataset": "Copernicus DEM 2021 GLO-90",
    "resolution_m": 90,
    "vertical_accuracy_m": null
  }
}
```

`elevation_m` means terrain elevation. Physical object/specimen height is always
another field such as `height_m`, with its own source/status.

## Routing architecture

### Current model

The repository retains 122 qualified high-level place-to-place walking edges for
visitor presentation and also carries the bounded Phase-8 walking topology with
2,633 path nodes / 7,196 directed segments over 955 included pedestrian-eligible
OSM ways. Graph-side routing can compute shortest, lower-ascent and avoid-known-
steps paths over that bounded topology. The visitor UI still primarily presents
qualified high-level routes and discovery rather than claiming a complete turn-
by-turn navigation engine or complete physical path inventory.

### Target model

The routing substrate should be explicit path nodes and directed path segments.
Place/POI nodes connect to path nodes through source-backed access connectors.

A segment is factual data; a routing profile is policy.

Factual segment fields include:

- geometry;
- distance;
- terrain profile and derived grade metrics;
- surface/smoothness;
- steps;
- barriers/access/wheelchair tags;
- route-relative incline;
- width where sourced;
- conditional/seasonal restrictions;
- source IDs and provenance.

Routing weights (shortest, lower ascent, avoid known steps) should not be stored as
facts in the segment itself.

## Accessibility architecture

Accessibility has three evidence states:

1. known negative evidence (steps, `wheelchair=no`, barrier, etc.);
2. positive but bounded mapped-path evidence;
3. unknown evidence.

The application must not convert absence of negative tags into a positive
wheelchair-accessible claim. End-to-end accessibility also depends on entrances,
endpoint connectors and conditions not necessarily represented by OSM paths.

## Semantic architecture

Semantic relations should be typed graph edges between first-class entities.

Example:

```json
{
  "id": "relation-jussow-aquaedukt-design",
  "from": "heinrich-christoph-jussow",
  "to": "aquaedukt",
  "type": "designed",
  "confidence": "high",
  "source_ids": ["museum-kassel-gs-5846"],
  "temporal_scope": "original design"
}
```

Temporal qualification matters when a later extant object differs from an earlier
design or structure.

## Data/version compatibility

Every layer should have:

- `schema_version`;
- generated/source timestamp metadata;
- input/source hash references;
- validator version/revision;
- explicit status (`ready`, `partial`, etc.) only when that status has defined meaning.

The runtime should reject or gracefully disable an incompatible optional layer
rather than silently misinterpreting it.

The release runtime now has one explicit authority at
`runtime/runtime-data-manifest.json`. Contract version 1 names every shipped
visitor-facing data layer, its load phase, release/boot requirement, precache
policy and supported schema shape/version. `scripts/copy-data.mjs` derives the
published `data/runtime-manifest.json` from that authority and adds exact byte
counts and SHA-256 hashes. Browser loading, service-worker precache and
`scripts/check-runtime-artifact.mjs` consume that published contract instead of
maintaining independent filename lists.

## Build determinism

Exact source/input hashes are more valuable than wall-clock generation timestamps.
Generated content should be deterministic where practical. If a timestamp is
required, prefer a reproducible build/source timestamp (for example via
`SOURCE_DATE_EPOCH`) or put it in a separate manifest that does not obscure data
diffs.

Local runtime publishing leaves release revision/date fields `null` unless an
authoritative value is supplied. The Pages workflow supplies the checked-out Git
commit timestamp as `SOURCE_DATE_EPOCH` and `GITHUB_SHA` as the source revision;
it does not synthesize a wall-clock build date.

## Offline architecture

The service worker should cache:

- application shell/assets required by the built app;
- the exact runtime data manifest and compatible layer files;
- only map tiles the visitor actually viewed, within provider policy and a bounded cache.

Layer/schema upgrades need cache-version coupling so old JSON cannot be served to
new browser code indefinitely.

`bergpark-shell-v6` couples the current contract to a new shell cache. Install
fails if a release-required precache layer cannot be cached, and activation then
removes older `bergpark-shell-*` caches. Same-origin data is network-first but is
cached only when it is successful JSON. An uncached offline data request returns
an explicit JSON 503 and a successful HTML response on a data URL is converted to
a JSON 502 rather than becoming an HTML-as-JSON parse failure. Navigation remains
the only request class allowed to fall back to cached application HTML.

Known OSM/OpenTopoMap tile hosts remain visitor-driven and cache-first after the
first visit. Successful and opaque cross-origin image responses are cacheable;
the entry bound comes from the runtime manifest (80 in contract v1). No release
step bulk-prefetches third-party tiles.

## Release architecture

A release is the combination of:

1. preserved source inputs;
2. generated/validated layer outputs;
3. composed runtime data;
4. browser artifact;
5. release evidence.

The release gate should validate all five, not only whether Vite can produce a
bundle.
