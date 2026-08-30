# Bergpark Wilhelmshöhe

Open-data knowledge graph and installable bilingual visitor PWA for Bergpark
Wilhelmshöhe in Kassel, Germany.

**Public alpha:** https://bergpark.fkr.dev

The map is the visitor application's primary interface. Its coordinates and
walking network come from reproducible spatial graph exports; historical and
collection content is maintained as a bilingual source-grounded knowledge
layer. OpenStreetMap is the primary coordinate/path authority and prompt
estimates are never silently promoted to canonical coordinates.

## Visitor application

Current alpha capabilities include:

- touch-friendly Leaflet map with OpenStreetMap/OpenTopoMap layers;
- landmark markers, walking-network and route polylines backed by the bounded
  Phase-8 preserved-source walking topology (2,633 path nodes / 7,196 directed
  segments across 955 included pedestrian-eligible OSM ways);
- German/English detail content and Web Speech API narration;
- GPS proximity activation with a ~30 m trigger and graceful manual fallback;
- searchable entity index and tree explorer;
- repository data layer with 569 catalogue-backed tree specimens, stable IDs,
  coordinates, terrain elevation and explicit unknown specimen height where the
  source does not report a measurement;
- installable PWA shell with offline content and bounded visited-tile caching.

Run locally:

```sh
pnpm install --frozen-lockfile
pnpm run dev
```

Release gate:

```sh
pnpm run check
python -m unittest -v tests.test_graph
```

## Generated data

- `data/nodes.json` — visitable place nodes
- `data/edges.json` — directed walking-path edges
- `data/trees.json` — 569 catalogue-backed dendrological nodes
- `data/figures.json` — 23 source-grounded historical people/entities in the current bounded semantic tranche
- `data/semantic.json` — 54 typed source-grounded semantic relationships plus artwork/collection entities
- `data/benches.json` — 215 first-class bench POIs from the preserved OSM snapshot
- `data/path_topology.json` — 2,633 path nodes / 7,196 directed segments covering the qualified preserved-source walking scope; physical inventory completeness remains explicitly unproven
- `data/graph.json` — composition-only aggregate of validated independently owned layers with input hashes
- `data/validation.json` — machine-readable place/route integrity report

## Rebuild

```sh
python scripts/build_graph.py
python scripts/validate_graph.py
```

The project intentionally uses the actual park research extent
`51.307..51.323 N, 9.385..9.425 E`. The narrower longitude range supplied in
the initial seed (`9.400..9.420 E`) excludes the Herkules monument and is kept
only as a rejected seed assumption in validation metadata.

## Architecture and project documentation

- [ROADMAP.md](ROADMAP.md) — full implementation phases and alpha → beta → stable gates.
- [docs/implementation-review.md](docs/implementation-review.md) — broad P0/P1/P2 implementation review.
- [docs/architecture.md](docs/architecture.md) — target source/layer/composition/runtime architecture.
- [docs/data-provenance.md](docs/data-provenance.md) — coordinate, elevation, accuracy and evidence policy.
- [docs/development.md](docs/development.md) — development, layer ownership and verification workflow.
- [docs/release-checklist.md](docs/release-checklist.md) — data/runtime/offline/accessibility/release qualification.
- [CHANGELOG.md](CHANGELOG.md) — shipped behavior and known limitations.

## Release status

The alpha is intentionally public while later beta gates remain open so
map/runtime integration can be qualified continuously. Composition-safe graph
layers, the bounded Phase-8 walking topology, runtime manifest/offline packaging,
GPS accuracy/hysteresis, tree/bench/semantic visitor layers and Chromium release
qualification are already durable. The current roadmap keeps physical walking-
inventory completeness, general visitor routing, editorial/source freshness,
Firefox/iOS Safari qualification and performance/device evidence as explicit
remaining gates.

Visitor facts such as opening hours and accessibility are source-dated and
should not be interpreted as guarantees when conditions change.

