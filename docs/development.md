# Development and verification guide

This guide describes the repository workflow while the alpha build grows into a
multi-layer data pipeline.

## Local application

Install dependencies and run the development server:

```sh
pnpm install --frozen-lockfile
pnpm run dev
```

Run the current browser-side release gate:

```sh
pnpm run check
```

`pnpm run check` is the repository release gate for Biome, Node compatibility
tests, Vitest, Python repository-integrity tests, and the Vite production build.
Use `pnpm run check:e2e` when the Chromium browser/offline/accessibility gate is
also required.

## Spatial graph verification

Current place/route graph checks:

```sh
python scripts/validate_graph.py
python -m unittest -v tests.test_graph
```

For a non-canonical qualification build, redirect generated output into the
project-local work area:

```sh
BERGPARK_OUTPUT_DATA=.work/graph-check python scripts/build_graph.py
BERGPARK_OUTPUT_DATA=.work/graph-check python scripts/validate_graph.py
BERGPARK_OUTPUT_DATA=.work/graph-check python -m unittest -v tests.test_graph
```

This is preferable while another lane owns canonical data paths.

## Tree verification

```sh
python scripts/build_trees.py
python scripts/validate_trees.py
python -m unittest -v tests.test_trees
```

Tree elevation/source refreshes are explicit research/network operations, not
implicit steps in ordinary builds.

## Bench verification

The durable bench layer uses:

```sh
python scripts/build_benches.py
python scripts/validate_benches.py
python -m unittest -v tests.test_benches
```

A source refresh may legitimately change the number of OSM benches. Snapshot
cardinality should therefore be recorded in source/build metadata rather than
being treated as an eternal project constant.

## Path-topology verification

The current explicit topology is a projection of the qualified landmark routes:

```sh
python scripts/build_path_topology.py
python scripts/validate_path_topology.py
python -m unittest -v tests.test_path_topology
```

Its `scope`/validation notes are part of the contract: this is not yet every
walkable OSM way in the park.

## Semantic verification

The semantic layer should have a dedicated validator/test suite and become part
of the repository-wide verification gate after Phase 3 is durable.

Semantic tooling must not rewrite bilingual knowledge files or the content
source registry merely to satisfy graph composition.

## Generated data ownership

The target ownership model is one producer per layer:

| Layer | Producer | Validator |
|---|---|---|
| Places/routes | spatial graph builder | graph validator/tests |
| Trees | tree builder | tree validator/tests |
| Benches | bench builder | bench validator/tests |
| Figures/semantic edges | semantic builder | semantic validator/tests |
| Bilingual knowledge | editorial/knowledge tooling | parity/source checks |
| Combined graph | composer only | composition validator |

Until the composition refactor lands, use care: the current spatial builder still
contains placeholder writes for other layers. Prefer staging builds when a valid
independent layer is present.

## Runtime data publishing

Vite's `predev` and `prebuild` run:

```sh
node scripts/copy-data.mjs
```

This copies the deployable data subset from `data/` to `public/data/`.
The list is currently manual. Future layers should be driven by a versioned
runtime manifest so offline packaging cannot silently omit a newly shipped layer.

## Normal builds should be offline

Routine validation and release builds should consume preserved snapshots and
must not depend on external APIs being available.

Keep network operations explicit for:

- elevation refreshes;
- OSM/source snapshot updates;
- Wikimedia Commons audits;
- other public-source research.

Preserve raw responses and provenance when a fetched source affects canonical data.

## Shared-checkout discipline

Multiple project lanes can work in this checkout. Before writing:

1. inspect Git status and recent commits;
2. inspect active ws-bridge presence, claims and notes;
3. claim only the exact files required;
4. preserve unrelated dirty files;
5. stage only the intended ownership tranche;
6. announce cross-layer schema changes before canonicalizing them.

Avoid broad directory claims when narrow file claims are sufficient.

## Commit discipline

A commit should contain one coherent ownership tranche, for example:

- tree spatial enrichment;
- semantic figures/relations;
- runtime tree/bench integration;
- documentation/roadmap updates.

Before committing, inspect staged paths and run `git diff --check`.

## Desired repository-wide verification command

Before beta, keep `pnpm run check:e2e` as the documented deterministic verification
entry point and extend it as additional release validators become durable:

1. structural/schema validation;
2. graph validator + graph tests;
3. tree validator + tree tests;
4. bench validator + bench tests;
5. path-topology validator + tests;
6. semantic/content validators + tests;
7. composition validation;
8. Node tests;
9. Vite production build;
10. browser/offline/a11y smoke tests where configured.

Pages deployment should depend on the complete gate rather than only the
frontend build.

## Adding a new data layer

A new visitor/research layer should define:

- source/provenance contract;
- stable ID rule;
- builder/importer;
- validator;
- focused tests;
- schema version;
- summary/quality report;
- composition integration;
- runtime/offline packaging decision.

A JSON file existing under `data/` does not by itself mean the layer is integrated.

## Updating public sources

For a source refresh:

1. preserve prior release authority in Git history;
2. preserve the new snapshot where licensing permits;
3. record retrieval/source revision and hash;
4. generate a source diff of added/removed IDs and material field changes;
5. rebuild only dependent layers;
6. run layer and composition validation;
7. review generated diffs before committing.

Missing fields remain unknown. A changed source count is not automatically an error.
