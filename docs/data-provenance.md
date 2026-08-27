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

Every coordinate-bearing canonical entity uses a common `position_source`
contract. Phase 7 applies it to places, catalogued trees, benches, explicit path
nodes and visitor POIs; semantic artwork/collection entities currently have no
coordinate fields and therefore do not synthesize a position merely for shape
uniformity.

Required fields/roles:

```json
{
  "position_source": {
    "provider": "OpenStreetMap",
    "element": "way/183224852",
    "url": "https://www.openstreetmap.org/way/183224852",
    "source_timestamp": "2026-08-01T12:00:00Z",
    "retrieved_at": null,
    "retrieval_status": "source_retrieval_time_not_preserved_separately",
    "method": "bounds_midpoint",
    "position_type": "representative_point",
    "horizontal_accuracy_m": null,
    "accuracy_status": "derived_representative_point",
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
`position_type` is independently constrained to `source_point` or
`representative_point`. A representative point may never be relabelled as an
entrance/access point simply because routing needs a connector. If source or
retrieval timestamps were not preserved, the field remains `null` with an
explicit status; filesystem mtimes are not promoted to source provenance.

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
    "snapshot": "data/sources/elevation/points.json",
    "retrieved_at": "2026-08-27T06:07:43.553398+00:00"
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

Derived metrics identify the algorithm, source fields and assumptions in
machine-readable document-level `derived_metric_profile` metadata. A profile
has a stable `profile_id`, an `applies_to` selector and one entry per qualified
metric. This lets Phase-2 route rows stay byte-for-byte stable while still
exposing how their values were produced.

For walking edges the profile covers route distance, endpoint elevation delta,
90 m sampled gross ascent/descent, average grade, walking-time estimate,
surface summary, mapped-path accessibility, endpoint snap distance and the
end-to-end accessibility guard. The mapped-path accessibility algorithm only
uses preserved OSM tag evidence; missing tags remain unknown.

For explicit path segments the profile records haversine distance, endpoint
GLO-90 delta and the fail-closed terrain rule: segments shorter than 90 m retain
their endpoint elevation delta but publish `null` ascent/descent/grade with
`terrain_metric_status=below_dem_horizontal_resolution`. Representative-point
snap connectors inherit no surface/access/steps evidence and remain
`unknown_unmapped_connector`.

Dense route geometry can still be kept for display, but gross ascent/descent
must not repeatedly sum quantized DEM changes at a resolution much finer than
the DEM.

## Phase-8 walking-topology coverage and routing provenance

Phase 8 defines completeness only against an auditable preserved-source scope.
The topology producer reads the four frozen `data/sources/osm-map/*.xml` tiles,
uses preserved boundary `way/608171475`, and includes every source adjacency
that lies in or crosses that boundary under the inherited pedestrian-highway
policy. It excludes private/no-access ways unless an explicit pedestrian
exception exists, excludes `foot=no`, and retains blocked source-node adjacency
as blocked rather than bridging it.

The current frozen selection contains 955 included pedestrian-eligible ways and
41 touching-but-excluded ways (28 private/no-access without a pedestrian
exception and 13 outside the inherited walking-highway policy). It yields 11
source-connected components. These counts are source-scope evidence, not a
claim of complete physical inventory: the preserved boundary itself says it has
not been fully checked. `coverage.physical_inventory_claim` therefore remains
false.

Terrain for newly significant source path nodes is preserved separately in
`data/sources/path-topology-elevation/points.json`. Its selection hash binds all
2,587 source-node IDs/coordinates used by the Phase-8 topology. The snapshot
reuses 1,415 already preserved GLO-90 rows and records 1,172 explicitly fetched
additional rows. Normal builds never refetch this data; a stale selection hash
or missing source node fails closed.

Routing is a derived graph operation over immutable segment facts. The routing
policy is always returned with each result. `shortest` minimizes source-polyline
distance. `avoid_known_steps_lower_ascent` first minimizes known step distance,
then an evidence-aware ascent score, then distance. A weighting penalty assigned
to unknown short-segment terrain is not exported as factual ascent. Likewise,
an absence of known negative accessibility evidence never becomes a positive
accessibility statement: route summaries use
`unknown_not_an_accessibility_claim` unless known negative evidence is present.

Phase-2 landmark-route reproduction is validated against all 122 directed
qualified rows with a 0.25 m tolerance, accounting only for the older one-decimal
route-distance rounding versus the finer Phase-8 segment serialization. The
qualified source facts in those Phase-2 rows are not rewritten by routing.

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
and validation use the preserved snapshots. Where a snapshot carries a source
object timestamp (for example Overpass `timestamp_osm_base` or OSM node
`timestamp`), Phase 7 preserves it. Where the repository did not preserve fetch
time, `retrieved_at` stays `null` with an explicit retrieval status rather than
being reconstructed from local filesystem metadata.

## Unknown-data policy

Use these rules consistently:

- missing source field → `null`/unknown, not a guessed value;
- missing object from snapshot → “not present in this snapshot”, not “does not exist”;
- source conflict → preserve conflict/uncertainty and cite both;
- derived value → label algorithm/source inputs;
- approximate source → retain approximation in visitor/research language.
