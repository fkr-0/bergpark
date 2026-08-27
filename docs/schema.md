# Knowledge graph schema

## Spatial conventions

- Coordinates are WGS84 decimal degrees (`lat`, `lng`).
- Place nodes schema v2 uses `position_source` as the canonical spatial
  provenance contract. It records the public provider/OSM element, derivation
  method, point role, numeric-or-null horizontal accuracy, an explicit accuracy
  status, source snapshot and license.
- Legacy `coordinate_source`, `coordinate_method` and `coordinate_confidence`
  remain additively present for the current browser/content runtime; they are
  compatibility fields, not substitutes for numeric accuracy.
- Direct OSM nodes are labelled `source_point`. Bounds midpoints, supplied
  centres and geometry means are labelled `representative_point`; they are
  never described as surveyed/exact positions or visitor entrances.
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
  "elevation_m": 530.0,
  "height_m": null,
  "height_status": "unknown_no_measurement_source",
  "height_source": null,
  "elevation_source": {
    "dataset": "Copernicus DEM 2021 GLO-90",
    "resolution_m": 90,
    "vertical_accuracy_m": null,
    "accuracy_status": "not_reported_in_project_source"
  },
  "position_source": {
    "provider": "OpenStreetMap",
    "element": "relation/164756",
    "method": "bounds_midpoint",
    "position_type": "representative_point",
    "horizontal_accuracy_m": null,
    "accuracy_status": "derived_representative_point",
    "license": "ODbL-1.0"
  },
  "coordinate_confidence": "medium",
  "coordinate_method": "osm_bounds_midpoint",
  "coordinate_source": {"provider": "OpenStreetMap", "element": "relation/164756"}
}
```

`data/nodes.json` schema version 2 is an additive migration: all 30 stable IDs,
`lat`, `lng` and `elevation_m` values are preserved from the Phase-4/Phase-2
authority. `src/data.js` already carries the document schema version as metadata
and tolerates additional node fields, while `src/content.js` still renders the
legacy `coordinate_source`; the legacy fields therefore remain until a later
explicit consumer migration. `data/graph.json` remains graph schema version 1
because its top-level aggregate contract is unchanged and it composes node rows
verbatim.

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

Phase-5 place nodes now use that normalized object shape while retaining
`coordinate_source`, `coordinate_method` and `coordinate_confidence` for runtime
compatibility. Representative points derived from bounds, centers or geometry
are explicitly labelled representative coordinates, not exact survey positions;
when a source does not state numeric accuracy the exported accuracy remains
`null`. No physical structure/object height is synthesized from terrain
`elevation_m`; height remains independently sourced or unknown.

Benches are durable in `data/benches.json` as a separate first-class POI layer
with spatial provenance and are composed verbatim into `data/graph.json` by the
composition-only Phase-4 boundary.

## Phase-6 visitor POI contract

Phase 6 uses one deliberately common typed document, `data/visitor_pois.json`
(schema version 1), rather than seven nearly identical producer files. Every row
has `kind: "visitor_poi"` and one `family` discriminator: `access`, `toilet`,
`drinking_water`, `viewpoint`, `shelter`, `transit`, or `artwork`. The common
document still reports per-family counts and `scripts/validate_visitor_pois.py`
validates each family-specific evidence rule fail-closed.

Stable IDs are source-derived as
`visitor-poi-osm-<element-type>-<element-id>`. A source element may occur only
once in the document, and visitor POI IDs must also be globally distinct from
place, tree, bench, path-node, historical-figure, semantic-artwork and collection
IDs during composition.

Every row carries the Phase-5 spatial contract:

```json
{
  "id": "visitor-poi-osm-node-12951319673",
  "kind": "visitor_poi",
  "family": "drinking_water",
  "osm_element": {"type": "node", "id": "12951319673", "version": "2"},
  "lat": 51.3122945,
  "lng": 9.4183723,
  "elevation_m": 283.0,
  "position_source": {
    "provider": "OpenStreetMap",
    "element": "node/12951319673",
    "method": "source_node",
    "position_type": "source_point",
    "horizontal_accuracy_m": null,
    "accuracy_status": "not_reported_by_source",
    "license": "ODbL-1.0"
  },
  "elevation_source": {
    "dataset": "Copernicus DEM 2021 GLO-90",
    "resolution_m": 90,
    "vertical_accuracy_m": null,
    "accuracy_status": "not_reported_in_project_source",
    "snapshot": "data/sources/visitor-poi-elevation/points.json"
  },
  "height_m": null,
  "height_status": "unknown_no_measurement_source",
  "height_source": null
}
```

Direct OSM nodes are `source_point`s. The five source-mapped public-transport
platform ways use a deterministic `bounds_midpoint` only for display/indexing
and are explicitly `representative_point`s; they are never promoted to visitor
entrances. Access-family rows are OSM nodes only and require an actual `entrance`
or `barrier` source tag. Toilet `wheelchair` / `toilets:wheelchair`, access,
foot, barrier and related facts remain verbatim in `source_tags`; missing tags
remain unknown rather than becoming positive accessibility claims.

Spatial scope is grounded in the preserved OSM Bergpark protected-area boundary
`way/608171475`. Rows are marked `inside_park`, `boundary_external`, or
`external_relevant`, with boundary distance and selection rationale. The current
source-grounded tranche contains 109 rows: 68 access, 9 toilet, 1 drinking-water,
13 viewpoint, 1 shelter, 6 boundary-transit and 11 artwork POIs. Eight rows are
explicit near-boundary external services/access points and the named `Blick zum
Herkules` viewpoint is the single deliberately `external_relevant` row. These
counts describe this preserved snapshot and selection policy only: absence from
the snapshot is not evidence that a physical POI does not exist.

Normal builds do not refresh OpenStreetMap or elevation services. OSM evidence
comes from the preserved `data/sources/osm-map/*.xml` files. Terrain elevations
come from the separately preserved two-batch
`data/sources/visitor-poi-elevation/` snapshot, whose `points.json` records the
exact POI-selection SHA-256 and fails if IDs or coordinates drift. GLO-90 terrain
elevation never becomes physical object height.

Phase 6 composes the rows additively as `graph.json.visitor_pois` and records
`data/visitor_pois.json` as a schema/hash composition input. No browser loader,
cache, API or service-worker contract is changed in this phase: the existing
runtime continues to consume its established base layers while a later webapp
handoff may expose selective standalone POI loading.

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
SHA-256/size/schema record for every input layer. Phase 6 adds
`data/visitor_pois.json` as the ninth hashed composition input and exposes its
rows additively as top-level `visitor_pois`. `input_set_sha256` hashes that
ordered manifest. The aggregate `generated_at` is derived from the newest
`generated_at` value already present in the hashed inputs rather than wall-clock
time, so repeated composition from byte-identical inputs is byte-identical.
Validation recomputes the input records and fails if an independently owned layer
changes without recomposition.

The compatibility entry point `scripts/build_graph.py` still regenerates its
Phase-2-owned `nodes.json`, `edges.json` and `source_manifest.json`, then delegates
the aggregate write to `compose_graph.py`. Direct composition can therefore be
used without touching any lower-level layer.

Phase 5 performs the canonical place-position producer migration as nodes schema
v2 without changing stable place IDs or current representative coordinates.
`position_source.horizontal_accuracy_m` and
`elevation_source.vertical_accuracy_m` are numeric only when a source actually
reports a defensible accuracy; otherwise they remain `null`. Physical
structure/object height stays separate from terrain `elevation_m`.

## Phase-7 spatial provenance contract

Phase 7 keeps all existing public layer schema-version numbers because the
migration is additive: no existing field is removed or retyped, and the web
runtime can continue consuming the legacy coordinate/route fields. The
composition gate nevertheless treats the added provenance fields as mandatory
for current canonical producer output and fails closed if they are malformed.
This avoids forcing a runtime/API migration merely to qualify source metadata.

Every coordinate-bearing canonical row in `nodes.json`, `trees.json`,
`benches.json`, `path_topology.json#path_nodes`, and `visitor_pois.json` now
carries:

- a provider plus exact source element(s) or document reference;
- preserved source timestamp and retrieval metadata when available, otherwise
  explicit null/unknown retrieval status;
- `method` plus `position_type` (`source_point` or `representative_point`);
- numeric-or-null `horizontal_accuracy_m` plus `accuracy_status`;
- terrain `elevation_source` with dataset, horizontal resolution,
  numeric-or-null `vertical_accuracy_m`, accuracy status and snapshot;
- physical `height_m`/height provenance only where that entity publishes a
  physical-height contract, never by aliasing terrain elevation.

The 30 path nodes associated with place entities inherit the place position
role rather than using the old blanket `place_representative_point` label. This
therefore remains 6 source points and 24 representative points. OSM path nodes
are source points. Unmapped route-coordinate fallback remains explicitly
representative/derived and cannot masquerade as an entrance.

`data/semantic.json` contains no coordinate-bearing artwork or collection rows
at this boundary, so Phase 7 does not fabricate spatial fields for them. Spatial
OSM artwork POIs remain in `visitor_pois.json` and use that layer's spatial
contract.

### Derived metric profiles

`data/edges.json.derived_metric_profile` applies to `edges[*]` and records the
algorithm, source fields and assumptions for distance, terrain delta, 90 m
sampled gross ascent/descent, average grade, walking time, surface summary,
mapped-path accessibility, endpoint snap distance and the guarded end-to-end
accessibility result. The document-level profile is deliberate: the 122
Phase-2 edge rows remain exactly preserved while their derivation becomes
machine-readable.

`data/path_topology.json.derived_metric_profile` applies to
`directed_segments[*]`. Distance is WGS84 haversine between path-node
coordinates. Terrain delta is endpoint GLO-90 terrain difference. Segments
shorter than the 90 m DEM horizontal resolution retain endpoint delta but must
keep `ascent_m`, `descent_m` and `avg_grade_pct` null with
`terrain_metric_status=below_dem_horizontal_resolution`. Mapped OSM surface and
access values are source-qualified; missing tags stay unknown. Representative
point snap connectors inherit no path accessibility facts and remain
`unknown_unmapped_connector`.

The shared `scripts/provenance_contract.py` gate is used by composition and
layer validators. It rejects negative/malformed accuracy, unsupported exactness,
source/representative-role conflation, terrain/physical-height conflation and
missing algorithm/input/assumption qualification for derived metric profiles.

## Provenance

OpenStreetMap-derived data is subject to the Open Database License (ODbL).
Source snapshots and query text are retained under `data/sources/` so each
coordinate/path can be audited independently of the generated exports.

## Concurrent-build staging

The generators default to canonical `data/`. For verification while another
project lane owns that directory, set `BERGPARK_OUTPUT_DATA` to a project-local
staging directory. Source snapshots are always read from canonical
`data/sources/`; only generated outputs are redirected.

