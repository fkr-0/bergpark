# Cascades side-view terrain regression — operator evidence

Date: 2026-09-01

This evidence records the production terrain defect reported from the MapLibre/DGM1 renderer. The accompanying image is an operator-provided side view across the Große Kaskaden axis, downscaled only for repository size.

![Side view showing the cascades rendered essentially flat](./2026-09-01-cascades-side-flat-before.jpg)

## Expected orientation

In this view the **Neptunbecken / lower end is on the left** and the **Herkules / upper end is on the right**. The actual Hessen ATKIS-DGM1 terrain therefore has to produce an unmistakable rise from left to right. This is a correctness requirement, not merely a preferred camera treatment.

Canonical controls used by the regression gate:

- `neptunbecken`: 51.3149902, 9.3984822
- `kaskaden`: 51.3159319, 9.3963653
- `herkules`: 51.3161018, 9.3932069

## Observed defect

The side-on production view renders the water/cascade axis as essentially coplanar. A visitor cannot reliably identify which end is uphill, despite terrain mode being selected and the local DGM1 derivative being present.

## Acceptance contract

1. Decode the committed z16 Terrarium tiles at the three canonical controls and prove monotonic uphill ordering from Neptunbecken to Kaskaden to Herkules.
2. Require at least 40 m decoded rise between Neptunbecken and Herkules. This is deliberately below the known park-scale elevation difference and is only a fail-closed regression floor.
3. In the browser, do not declare terrain ready merely because a MapLibre canvas exists. Terrain readiness must be backed by live `queryTerrainElevation()` values at the same controls.
4. Keep the Hessen source/provenance and metre units unchanged; do not hide a transform/activation bug with arbitrary visual exaggeration.

The screenshot is retained as the human-visible acceptance reference: a side view equivalent to this one must make the uphill direction legible.
