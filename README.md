# Bergpark Wilhelmshöhe knowledge graph

Public-source spatial and semantic knowledge graph for Bergpark Wilhelmshöhe,
Kassel.

The data model is built from reproducible source snapshots, with OpenStreetMap
used as the primary coordinate/path authority and historical/collection sources
recorded separately. Coordinates are never promoted from prompt estimates.

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

