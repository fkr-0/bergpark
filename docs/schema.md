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
OSM-way sections with distance, highway, normalized/raw surface, smoothness,
access, foot, handrail, wheelchair, incline and SAC-scale tags. Route-level `surface` is a distance-
weighted summary; `contains_steps` and `step_distance_m` prevent a route with a
short stair section from being mislabeled as entirely stairs.

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

## Provenance

OpenStreetMap-derived data is subject to the Open Database License (ODbL).
Source snapshots and query text are retained under `data/sources/` so each
coordinate/path can be audited independently of the generated exports.

## Concurrent-build staging

The generators default to canonical `data/`. For verification while another
project lane owns that directory, set `BERGPARK_OUTPUT_DATA` to a project-local
staging directory. Source snapshots are always read from canonical
`data/sources/`; only generated outputs are redirected.

