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
- landmark markers, walking-network and route polylines;
- German/English detail content and Web Speech API narration;
- GPS proximity activation with a ~30 m trigger and graceful manual fallback;
- searchable entity index and tree-explorer structure;
- installable PWA shell with offline content and bounded visited-tile caching.

Run locally:

```sh
npm ci
npm run dev
```

Release gate:

```sh
npm run check
python -m unittest -v tests.test_graph
```

## Generated data

- `data/nodes.json` — visitable place nodes
- `data/edges.json` — directed walking-path edges
- `data/trees.json` — dendrological nodes (populated in the tree phase)
- `data/figures.json` — historical people (populated in the semantic phase)
- `data/semantic.json` — non-spatial relationships
- `data/graph.json` — combined export
- `data/validation.json` — machine-readable integrity report

## Rebuild

```sh
python scripts/build_graph.py
python scripts/validate_graph.py
```

The project intentionally uses the actual park research extent
`51.307..51.323 N, 9.385..9.425 E`. The narrower longitude range supplied in
the initial seed (`9.400..9.420 E`) excludes the Herkules monument and is kept
only as a rejected seed assumption in validation metadata.

## Release status

See [CHANGELOG.md](CHANGELOG.md) for shipped behavior and known limitations and
[ROADMAP.md](ROADMAP.md) for the alpha → beta → stable gates.

The alpha is intentionally public before all knowledge layers are complete so
map/runtime integration can be qualified continuously. Visitor facts such as
opening hours and accessibility are source-dated and should not be interpreted
as guarantees when conditions change.

