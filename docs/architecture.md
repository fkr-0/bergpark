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

`data/graph.json` should become a pure composition artifact. It should never be
the mechanism by which a lower-level builder creates or resets another layer.

Desired flow:

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
                                         ├── graph.json
                                         └── runtime-manifest.json
```

The composer should verify layer schema compatibility and record input hashes.

### 4. Runtime publishing layer

`scripts/copy-data.mjs` copies the deployable subset into `public/data/` before
Vite builds. This stage should be driven by an explicit runtime manifest rather
than a manually maintained list once more layers are shipped.

### 5. Browser application

The PWA is intentionally small:

- `src/data.js` — runtime layer loading and lookup indexes;
- `src/map.js` — Leaflet map, place markers and route geometry;
- `src/gps.js` — geolocation/proximity behavior;
- `src/content.js` — detail rendering, source links and TTS;
- `src/trees.js` — tree filtering/list UI;
- `src/glossary.js` — searchable entity index;
- `src/i18n.js` — DE/EN runtime strings.

The browser should consume validated release artifacts, not reproduce research or
source-resolution logic.

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

The current graph exports a selected set of place-to-place shortest walking paths.
This is useful for display and nearby navigation but is not a general router.

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

## Build determinism

Exact source/input hashes are more valuable than wall-clock generation timestamps.
Generated content should be deterministic where practical. If a timestamp is
required, prefer a reproducible build/source timestamp (for example via
`SOURCE_DATE_EPOCH`) or put it in a separate manifest that does not obscure data
diffs.

## Offline architecture

The service worker should cache:

- application shell/assets required by the built app;
- the exact runtime data manifest and compatible layer files;
- only map tiles the visitor actually viewed, within provider policy and a bounded cache.

Layer/schema upgrades need cache-version coupling so old JSON cannot be served to
new browser code indefinitely.

## Release architecture

A release is the combination of:

1. preserved source inputs;
2. generated/validated layer outputs;
3. composed runtime data;
4. browser artifact;
5. release evidence.

The release gate should validate all five, not only whether Vite can produce a
bundle.
