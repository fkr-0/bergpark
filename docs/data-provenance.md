# Data provenance and accuracy policy

Bergpark combines public spatial data, coarse terrain data, historical research,
visitor information and derived routing metrics. The project should make it
possible to tell which values came directly from a source, which were derived,
and how precise the source actually claims to be.

## Core rule

A precise-looking number is not evidence of real-world precision.

Seven decimal places from an OSM node do not imply centimetre accuracy. A
representative point calculated from a building boundary is not an entrance. A
90 m DEM value is not a surveyed monument elevation. Missing accessibility tags
do not imply an accessible route.

## Position contract

Every coordinate-bearing entity should eventually use a common
`position_source` object.

Recommended fields:

```json
{
  "position_source": {
    "provider": "OpenStreetMap",
    "element": "way/183224852",
    "url": "https://www.openstreetmap.org/way/183224852",
    "source_timestamp": "2026-08-01T12:00:00Z",
    "retrieved_at": "2026-08-27T00:00:00Z",
    "method": "bounds_midpoint",
    "horizontal_accuracy_m": null,
    "accuracy_status": "not_reported_by_source",
    "license": "ODbL-1.0"
  }
}
```

### `method`

Examples:

- `source_node` — direct point from the source;
- `source_centroid` — source supplied a centre;
- `bounds_midpoint` — derived from source bounds;
- `geometry_mean` — derived from source geometry;
- `entrance_node` — source-backed visitor access point;
- `field_observation` — measured on site with observation provenance.

The method should describe what was done, not imply a quality grade.

### Accuracy

Use `horizontal_accuracy_m` only when there is defensible evidence for a numeric
value. Otherwise use `null` and an explicit status such as:

- `not_reported_by_source`;
- `derived_representative_point`;
- `estimated_from_source_scale` only if the estimation method is documented;
- `field_reported` when the observation source reports a measurement accuracy.

Qualitative confidence may still be useful for source reconciliation, but it is
not a substitute for positional accuracy.

## Terrain elevation contract

`elevation_m` is terrain elevation at/near the entity coordinate.

Current graph/tree terrain values use the Open-Meteo Elevation API backed by
Copernicus DEM 2021 GLO-90 at 90 m horizontal resolution.

Recommended source metadata:

```json
{
  "elevation_m": 530.0,
  "elevation_source": {
    "provider": "Open-Meteo Elevation API",
    "dataset": "Copernicus DEM 2021 GLO-90",
    "resolution_m": 90,
    "vertical_accuracy_m": null,
    "accuracy_status": "not_reported_in_project_source",
    "snapshot": "data/sources/elevation/points.json"
  }
}
```

The project must not call these values survey-grade.

## Physical height is separate

Never overload terrain elevation with object/specimen height.

Examples:

- tree terrain elevation: `elevation_m`;
- tree physical height: `height_m`;
- building/monument physical height: `height_m` or a more specific named field.

A physical height should have its own source/status:

```json
{
  "height_m": null,
  "height_status": "unknown_no_measurement_source",
  "height_source": null
}
```

Typical/species maximum heights must not be promoted to specimen measurements.

## Derived route metrics

A route can contain source facts and derived metrics.

### Source facts

Examples:

- OSM way IDs;
- `highway`, `surface`, `smoothness`, `wheelchair`, `access`, `foot`;
- `steps`, `handrail`, `incline`;
- path geometry.

### Derived metrics

Examples:

- segment/route distance;
- route-relative incline interpretation;
- terrain elevation delta;
- ascent/descent;
- average grade;
- walking-time estimate;
- summarized surface/accessibility categories.

Derived metrics should identify the algorithm/assumptions in schema or build
metadata. For GLO-90, dense geometry can be kept for display, but gross
ascent/descent should not repeatedly sum quantized changes at a resolution much
finer than the DEM.

## Accessibility evidence

The project distinguishes evidence rather than issuing unsupported guarantees.

### Known negative

Examples:

- route contains steps;
- `wheelchair=no`;
- a mapped barrier blocks access;
- a private/no-foot segment without a pedestrian exception.

### Positive but bounded evidence

A mapped path may appear step-free in the available OSM tags, but that does not
prove the whole landmark-to-landmark route is accessible.

Use language such as `potentially_step_free_mapped_path` and expose unknown
endpoint/entrance evidence separately.

### Unknown

Missing tags or unsourced endpoint connectors are unknown, not positive.

## Representative points vs access points

Large places/buildings need at least two concepts:

- representative point: useful for display/indexing/geofencing;
- access/entrance point: useful for navigation and accessibility.

Do not route a visitor to a centroid and describe it as an entrance unless the
source supports that interpretation.

## Historical/semantic provenance

Every semantic relation should identify sources and evidence strength.

Recommended fields:

```json
{
  "id": "relation-example",
  "from": "person-id",
  "to": "place-id",
  "type": "designed",
  "source_ids": ["source-a"],
  "evidence_status": "explicit_source_statement",
  "confidence": "high",
  "temporal_scope": "original design",
  "note": null
}
```

Do not infer commission, authorship, acquisition, current location or identity
merely because two sources mention related objects.

## Volatile visitor facts

Opening hours, fees, closures, Wasserspiele schedules and operational access can
change independently of the historical graph.

Visitor-facing volatile facts should carry:

- source ID/URL;
- `verified_on` date;
- optionally `valid_from` / `valid_until` if the source provides them;
- a status such as `current_as_of_verification`.

Stale facts should degrade to “verify with official source” rather than remain
presented as current guarantees indefinitely.

## Media provenance

For Wikimedia Commons or other reusable media, preserve at least:

- file page URL;
- direct media URL only when needed by the runtime;
- creator/author when available;
- license name/link;
- source page;
- caption/subject identity confidence.

A nearby geotagged photograph is a proximity cross-check, not proof that the
photo depicts the landmark at the queried coordinate.

## Source snapshots

Raw/public source snapshots used for releases should be preserved when legally
and practically appropriate. A release/source manifest should record hashes for
those inputs.

Network fetch operations should be explicit update/research steps. Normal builds
and validation should use the preserved snapshots.

## Unknown-data policy

Use these rules consistently:

- missing source field → `null`/unknown, not a guessed value;
- missing object from snapshot → “not present in this snapshot”, not “does not exist”;
- source conflict → preserve conflict/uncertainty and cite both;
- derived value → label algorithm/source inputs;
- approximate source → retain approximation in visitor/research language.
