# Cascades side-view terrain regression evidence — 2026-09-01

## User-visible evidence

A user-provided **1710×569 side-view screenshot** of the deployed Reimagined MapLibre terrain renderer shows the Große Kaskaden axis reading essentially level even though the camera has strong perspective/pitch.

Screenshot evidence SHA-256: `fb7dca1b6eee5eafb95476f912bd4d008d9366c3a64c85c568de707b28686024` (JPEG preservation copy of the supplied screenshot).

The view establishes an unambiguous acceptance direction:

- **left / east:** Neptunbassin — lower end of the Große Kaskaden;
- **right / west:** uphill toward Riesenkopfplateau, Oktogon and Herkules;
- in the defective deployment a visitor cannot reliably tell which end is uphill.

This is treated as a terrain-correctness failure, not a camera-style preference. The committed Hessen ATKIS-DGM1 authority has hundreds of metres of park-wide relief, and the cascade axis must preserve a clearly positive west/uphill rise at 1× terrain exaggeration.

## Runtime regression contract

The MapLibre terrain mesh is checked after DEM readiness with two stable geographic controls derived from the screenshot's lower/upper axis:

| Control | Role | WGS84 |
| --- | --- | --- |
| Neptunbassin | lower / east | 51.315852, 9.397959 |
| Herkules | upper / west | 51.3161018, 9.3932069 |

The runtime mesh must report **at least 60 m positive rise** from Neptunbassin to Herkules. This is deliberately conservative relative to the full water-axis relief while still rejecting a flat, inverted or unavailable DEM.

## Required implementation response

1. Terrain-mesh and hillshade use independent `raster-dem` source-cache instances backed by the same immutable local DGM1 Terrarium tiles.
2. Terrain is explicitly re-applied on MapLibre `style.load` / `load`, including style reconstruction after WebGL context recovery.
3. Runtime qualification uses `queryTerrainElevation()` on the controls above instead of accepting the mere presence of a pitched MapLibre canvas.
4. A successful check records lower, upper and rise values on the map element for deterministic browser qualification; a finite flat/inverted result fails closed to the existing flat fallback.
5. Browser E2E requires the positive cascade rise before declaring DGM1 terrain ready.

The implemented authority is `src/maplibre-map.js`, with deterministic unit coverage in `tests/terrain-relief-guard.test.mjs` and browser proof in `tests/e2e/terrain-relief-regression.spec.js`.

The acceptance intent is visual and directional: **from this side-view class of camera, the Herkules/right-hand end must unmistakably be uphill from the Neptunbassin/left-hand end.**
