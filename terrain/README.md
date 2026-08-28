# Bergpark DGM1 terrain pipeline

This directory owns the renderer-neutral terrain acquisition and conversion boundary.
It does **not** contain MapLibre/Three integration and it does not rewrite canonical graph data.

## Authority and bounded AOI

- Provider: Hessisches Landesamt für Bodenmanagement und Geoinformation (HVBG)
- Product: ATKIS-DGM1
- Official WCS: `https://inspire-hessen.de/raster/dgm1/ows`
- Coverage: `he_dgm1`
- Native CRS: EPSG:25832 (ETRS89 / UTM zone 32N)
- Vertical reference: DHHN2016_NH metres, from the official HVBG DGM product metadata
- Native cell size: 1 m
- Source pixel semantics: 32-bit float; NoData `-9999`
- Licence: `dl-zero-de/2.0`

The Phase-3 acquisition uses the canonical runtime bounding box from `data/graph.json`,
transforms its four corners to EPSG:25832, expands the envelope by **150 m**, and snaps
outwards to the 1 m DGM grid. For the Phase-3 authority this is:

`[526677, 5683885, 529775, 5685981]` (E_min, N_min, E_max, N_max)

or 3098 × 2096 one-metre cells. The original WCS response remains in the ignored
`.work/terrain/dgm1/source/` acquisition cache and is identified immutably by the source
manifest hash.

## Intermediate format

`terrain/artifacts/bergpark-dgm1.npz` is a lossless, deterministic ZIP/NPY container.
Before DEFLATE compression, the four bytes of every little-endian Float32 sample are
byte-shuffled into four lanes; the original 2D shape is stored alongside them. This is
fully reversible and avoids quantisation while materially improving compression on the
smooth 1 m terrain field. ZIP timestamps and attributes are fixed by the pipeline, so
rebuilding from identical source bytes produces identical output bytes.

This artifact is deliberately a **canonical processing/sampling intermediate**, not a
browser tile format. It keeps all DGM1 Float32 values without quantisation and compresses
the park-sized grid enough to be reviewable in Git without introducing another runtime
codec dependency. Phase 3 measures the original WCS TIFF at 24.783 MiB and the committed
intermediate at **11.974 MiB** (48.3% of source bytes), comfortably below the architecture's
60 MiB preferred / 80 MiB hard-review terrain-pack gates. This is the explicit repository
size justification for committing the intermediate rather than the larger original source.
A later renderer phase may derive a streamable Terrarium/raster-dem pyramid from this exact
artifact and manifest.

## Commands

Run from the repository root:

    python terrain/pipeline/dgm1.py record-source \
      --source .work/terrain/dgm1/source/he_dgm1_bergpark_526677_5683885_529775_5685981.tiff \
      --manifest terrain/sources/hessen-dgm1.yml

    python terrain/pipeline/dgm1.py build \
      --source .work/terrain/dgm1/source/he_dgm1_bergpark_526677_5683885_529775_5685981.tiff \
      --source-manifest terrain/sources/hessen-dgm1.yml \
      --artifact terrain/artifacts/bergpark-dgm1.npz \
      --manifest terrain/artifacts/bergpark-dgm1.manifest.json

    python terrain/pipeline/dgm1.py validate \
      --source .work/terrain/dgm1/source/he_dgm1_bergpark_526677_5683885_529775_5685981.tiff \
      --source-manifest terrain/sources/hessen-dgm1.yml \
      --artifact terrain/artifacts/bergpark-dgm1.npz \
      --manifest terrain/artifacts/bergpark-dgm1.manifest.json \
      --graph data/graph.json

`acquire` performs the same bounded WCS request directly and refuses to overwrite a
non-identical existing source unless `--replace` is explicit. The margin is hard-capped at
250 m and the resulting grid at 8,000,000 cells, so this helper cannot be repurposed into a
state-wide downloader by passing an unbounded margin.

The provenance file keeps the architecture's `.yml` name but is emitted as canonical JSON,
which is also valid YAML 1.2. This gives stable key ordering and bytes for review/hashing
without adding a YAML serializer to the pipeline dependency boundary.
