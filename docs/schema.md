# Knowledge graph schema

## Spatial conventions

- Coordinates are WGS84 decimal degrees (`lat`, `lng`).
- `coordinate_source` identifies the public source and exact OSM element.
- `coordinate_confidence` is one of `high`, `medium`, `low`.
- Large/linear features use a representative point derived from their mapped
  geometry or bounds and explain that method in `coordinate_method`.
- Path polylines are stored as `[lat, lng]` pairs for direct Leaflet use.
- Walking edges are directed. Opposite directions are separate records because
  slope/accessibility notes may differ.

## Place node

Required keys:

```json
{
  "id": "herkules",
  "kind": "place",
  "name": {"de": "Herkules / Oktogon", "en": "Hercules Monument / Octagon"},
  "type": "monument",
  "lat": 51.3161,
  "lng": 9.3932,
  "elevation_m": 527.0,
  "elevation_source": {
    "dataset": "Copernicus DEM 2021 GLO-90",
    "resolution_m": 90
  },
  "coordinate_confidence": "high",
  "coordinate_source": {"provider": "OpenStreetMap", "element": "relation/164756"}
}
```

## Walking edge

Directed edges use `from` and `to`, carry OSM-derived path geometry, and keep
provenance for every contributing OSM way. `surface_segments` records contiguous
OSM-way sections in travel order with distance, highway, normalized/raw surface,
smoothness, access, foot, handrail, wheelchair and SAC-scale tags. Directional
metadata separates the raw OSM `osm_incline` tag from `route_incline` and records
`osm_way_direction`, so reversing an edge reverses both segment order and the
interpreted travel direction. Route-level `surface` is a distance-weighted
summary; `contains_steps` and `step_distance_m` prevent a route with a short
stair section from being mislabeled as entirely stairs.

Accessibility derived from OSM applies to the mapped walking-network portion.
Landmark representative points may be connected to that network by a short
straight snap whose surface and barrier state are not mapped by this model.
`mapped_path_accessibility` therefore preserves OSM-path evidence separately;
`endpoint_access_unknown` and `endpoint_snap_total_m` make that gap explicit. A
mapped path that appears step-free is labelled
`potentially_step_free_mapped_path`, never as a field-verified end-to-end route.

Phase-2 terrain fields are based on the Open-Meteo Elevation API's Copernicus
DEM 2021 GLO-90 data (90 m resolution). Every edge has a dense display elevation
profile parallel to `path_coordinates`, while gross `ascent_m`/`descent_m` is
computed from samples spaced at roughly 90 m to avoid overstating relief from
DEM-cell quantization. Directed `elevation_delta_m` and `avg_grade_pct` use
route endpoints. Walking time uses a transparent
Naismith-style estimate (5 km/h plus one minute per 10 m ascent). These are
planning estimates, not survey-grade or field-verified accessibility data.

## Semantic node/edge identifiers

All entity IDs are stable lowercase ASCII slugs. Trees use `tree-<osm-node-id>`
because catalogue references are not guaranteed unique (for example some
catalogue refs intentionally identify groups or multiple specimens).

Phase 3 treats people, artworks and collections as first-class graph entities;
semantic edges never point at an unregistered display string. Historical people
live in `data/figures.json`, while artworks, collections, the semantic source
registry and semantic relations live in `data/semantic.json`. `data/graph.json`
composes those curated layers without changing the stable Phase-2 place IDs.

Example artwork and collection entities:

```json
{
  "artwork": {
    "id": "artwork-der-segen-jakobs",
    "kind": "artwork",
    "name": {"de": "Der Segen Jakobs", "en": "Jacob Blessing the Sons of Joseph"},
    "creator_id": "person-rembrandt-van-rijn",
    "source_ids": ["hkh-gemaeldegalerie-collection"]
  },
  "collection": {
    "id": "collection-gemaeldegalerie-alte-meister",
    "kind": "collection",
    "name": {"de": "Gemäldegalerie Alte Meister", "en": "Old Masters Picture Gallery"},
    "current_place_id": "schloss",
    "source_ids": ["hkh-gemaeldegalerie-location"]
  }
}
```

Every semantic relation has a stable `id`, resolvable `from`/`to`, a controlled
relation label, an explicit `confidence` (`high`, `medium`, or `low`), one or
more `source_ids`, and provenance that states both the supported assertion and
its qualification:

```json
{
  "id": "sem-jussow-planned-teufelsbruecke-setting",
  "from": "person-heinrich-christoph-jussow",
  "to": "teufelsbruecke",
  "relation": "planned_landscape_setting_for",
  "confidence": "high",
  "source_ids": ["museum-kassel-jussow-teufelsbruecke-gs5860"],
  "provenance": {
    "basis": "direct_architectural_landscape_plan_catalogue",
    "assertion": "The source documents Jussow's design role for the earlier landscape setting.",
    "qualification": "This is not unqualified authorship of the present bridge."
  }
}
```

That qualification is intentional: semantic relations describe only the phase
and scope actually supported by their sources. Commissioning, design, current
location, collection membership and later replacement/restoration phases must
not be inferred from one another.

## Position provenance and physical height

The target spatial contract for every mapped entity is `lat`, `lng` and terrain
`elevation_m` together with explicit position/elevation provenance and accuracy.
Physical object height is a separate field (`height_m` or a type-specific
equivalent) and must never be populated from terrain elevation or generic
species/building descriptions.

The tree layer already uses the preferred pattern:

```json
{
  "lat": 51.311135,
  "lng": 9.4089563,
  "elevation_m": 361.0,
  "position_source": {
    "provider": "OpenStreetMap",
    "element": "node/5702751554",
    "horizontal_accuracy_m": null,
    "accuracy_status": "not_reported_by_source"
  },
  "elevation_source": {
    "dataset": "Copernicus DEM 2021 GLO-90",
    "resolution_m": 90,
    "vertical_accuracy_m": null
  },
  "height_m": null
}
```

Phase-2 place nodes predate that normalized object shape and still expose
`coordinate_source`, `coordinate_method`, `coordinate_confidence` and
`elevation_source`. A future spatial-schema migration should normalize them
without changing stable IDs. Representative points derived from bounds, centers
or geometry are representative coordinates, not exact survey positions; when a
source does not state numeric accuracy the exported accuracy remains unknown.

Benches are now durable in `data/benches.json` as a separate first-class POI
layer with spatial provenance. They should retain the same provenance/accuracy
rules when later composed into the main graph.

## Standalone explicit path topology

The explicit path-topology phase is now durable in `data/path_topology.json`
without replacing the qualified Phase-2 landmark-to-landmark route model. It
exports sampled path nodes at intersections/turns and at material gradient,
surface or accessibility changes plus directed serializable segments. Phase 3
keeps this as an independently owned layer rather than silently widening
`graph.json`; later composition should preserve the same data contract:

```json
{
  "path_node": {
    "id": "path-node-...",
    "lat": 51.0,
    "lng": 9.0,
    "elevation_m": 300.0,
    "position_source": {"provider": "OpenStreetMap", "horizontal_accuracy_m": null}
  },
  "directed_segment": {
    "from": "path-node-a",
    "to": "path-node-b",
    "geometry": [[51.0, 9.0], [51.0001, 9.0002]],
    "distance_m": 25.0,
    "ascent_m": 2.0,
    "descent_m": 0.0,
    "avg_grade_pct": 8.0,
    "max_grade_pct": null,
    "surface": "paved",
    "width_m": null,
    "steps": false,
    "access": "yes",
    "seasonal": null,
    "source_ids": ["osm-way-..."]
  }
}
```

These are data records, not executable functions. Direction-specific grade,
surface/access changes and source IDs must remain serializable so routing and UI
clients can reason about them independently.

## Phase-4 composition contract

`data/graph.json` is a composition artifact only. Its sole producer is
`scripts/compose_graph.py`; the composer reads canonical layer files and must not
rewrite any producer output. The Phase-4 aggregate keeps the existing top-level
`nodes`, `edges`, `trees`, `figures`, `artworks`, `collections` and
`semantic_edges` fields and adds three backward-compatible top-level fields:

- `benches` — exact rows from `data/benches.json`;
- `path_nodes` — exact rows from `data/path_topology.json#path_nodes`;
- `path_segments` — exact rows from `data/path_topology.json#directed_segments`.

The composer accepts only the explicitly supported input schema versions. Before
writing `graph.json` it validates ID uniqueness and cross-layer references,
including walking-edge place refs, semantic entity refs, path-segment endpoints
and path-node segment refs. Missing files, placeholder/incompatible schemas,
invalid declared counts or duplicate IDs fail closed before the aggregate is
written.

`graph.json.composition` records the composition schema, the composer path and a
SHA-256/size/schema record for every input layer. `input_set_sha256` hashes that
ordered manifest. The aggregate `generated_at` is derived from the newest
`generated_at` value already present in the hashed inputs rather than wall-clock
time, so repeated composition from byte-identical inputs is byte-identical.
Validation recomputes the input records and fails if an independently owned layer
changes without recomposition.

The compatibility entry point `scripts/build_graph.py` still regenerates its
Phase-2-owned `nodes.json`, `edges.json` and `source_manifest.json`, then delegates
the aggregate write to `compose_graph.py`. Direct composition can therefore be
used without touching any lower-level layer.

Canonical place-position normalization remains a separate producer migration.
Stable place IDs and current representative coordinates must remain unchanged
until the spatial producer and knowledge/runtime consumers are coordinated.
When normalized, places should add `position_source.horizontal_accuracy_m` and
`elevation_source.vertical_accuracy_m` as numeric values only when a source
actually reports a defensible accuracy; otherwise they remain `null`. Physical
structure/object height stays separate from terrain `elevation_m`.

## Provenance

OpenStreetMap-derived data is subject to the Open Database License (ODbL).
Source snapshots and query text are retained under `data/sources/` so each
coordinate/path can be audited independently of the generated exports.

## Concurrent-build staging

The generators default to canonical `data/`. For verification while another
project lane owns that directory, set `BERGPARK_OUTPUT_DATA` to a project-local
staging directory. Source snapshots are always read from canonical
`data/sources/`; only generated outputs are redirected.

