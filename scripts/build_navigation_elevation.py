#!/usr/bin/env python3
"""Build renderer-neutral DGM1 route elevation derivatives for visitor navigation.

The generator reads the immutable Phase-3 DGM1 Float32 artifact and the canonical
walking edges. It never reads MapLibre/Terrarium renderer tiles. Route geometry is
sampled in EPSG:25832 at equal horizontal intervals no larger than 20 m, with
bilinear interpolation between 1 m DGM cells. Endpoint snap connectors are excluded
because their path/access geometry is explicitly unknown in the canonical route data.
"""

from __future__ import annotations

import importlib.util
import json
import math
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DGM1_PATH = ROOT / "terrain" / "pipeline" / "dgm1.py"
SPEC = importlib.util.spec_from_file_location("bergpark_dgm1_navigation", DGM1_PATH)
DGM1 = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(DGM1)

ARTIFACT = ROOT / "terrain" / "artifacts" / "bergpark-dgm1.npz"
ARTIFACT_MANIFEST = ROOT / "terrain" / "artifacts" / "bergpark-dgm1.manifest.json"
SOURCE_MANIFEST = ROOT / "terrain" / "sources" / "hessen-dgm1.yml"
EDGES = ROOT / "data" / "edges.json"
SUMMARY_OUTPUT = ROOT / "src" / "elevation" / "generated-route-summaries.js"
PROFILE_OUTPUT = ROOT / "src" / "elevation" / "generated-route-profiles.js"
TARGET_SPACING_M = 20.0
PROFILE_VERSION = "dgm1-route-elevation-v1"


def canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def bilinear_sample(grid, bounds, easting: float, northing: float) -> float:
    """Interpolate cell-centre DGM values without extending reviewed coverage."""
    west, south, east, north = bounds
    if not (west <= easting <= east and south <= northing <= north):
        raise ValueError(f"point {easting},{northing} outside reviewed DGM1 bounds")

    # GeoTIFF tiepoints describe the raster envelope. Float32 values represent the
    # one-metre cells whose centres are offset by 0.5 m from that envelope.
    col_f = clamp(easting - west - 0.5, 0.0, grid.shape[1] - 1.0)
    row_f = clamp(north - northing - 0.5, 0.0, grid.shape[0] - 1.0)
    col0 = int(math.floor(col_f))
    row0 = int(math.floor(row_f))
    col1 = min(col0 + 1, grid.shape[1] - 1)
    row1 = min(row0 + 1, grid.shape[0] - 1)
    tx = col_f - col0
    ty = row_f - row0
    top = float(grid[row0, col0]) * (1.0 - tx) + float(grid[row0, col1]) * tx
    bottom = float(grid[row1, col0]) * (1.0 - tx) + float(grid[row1, col1]) * tx
    return top * (1.0 - ty) + bottom * ty


def route_geometry(path_coordinates):
    points = [DGM1.utm32_forward(float(lat), float(lng)) for lat, lng in path_coordinates]
    if len(points) < 2:
        raise ValueError("route needs at least two path coordinates")
    cumulative = [0.0]
    for left, right in zip(points, points[1:]):
        cumulative.append(cumulative[-1] + math.hypot(right[0] - left[0], right[1] - left[1]))
    if cumulative[-1] <= 0.0:
        raise ValueError("route path has zero horizontal length")
    return points, cumulative


def interpolate_path(points, cumulative, distance_m: float):
    if distance_m <= 0.0:
        return points[0]
    if distance_m >= cumulative[-1]:
        return points[-1]
    lo = 0
    hi = len(cumulative) - 1
    while lo + 1 < hi:
        mid = (lo + hi) // 2
        if cumulative[mid] <= distance_m:
            lo = mid
        else:
            hi = mid
    span = cumulative[lo + 1] - cumulative[lo]
    if span <= 0.0:
        return points[lo]
    ratio = (distance_m - cumulative[lo]) / span
    return (
        points[lo][0] + (points[lo + 1][0] - points[lo][0]) * ratio,
        points[lo][1] + (points[lo + 1][1] - points[lo][1]) * ratio,
    )


def sample_route(grid, bounds, edge):
    points, cumulative = route_geometry(edge["path_coordinates"])
    path_distance = cumulative[-1]
    intervals = max(1, math.ceil(path_distance / TARGET_SPACING_M))
    spacing = path_distance / intervals
    distances = [path_distance * index / intervals for index in range(intervals + 1)]
    elevations = []
    for distance in distances:
        easting, northing = interpolate_path(points, cumulative, distance)
        elevations.append(bilinear_sample(grid, bounds, easting, northing))

    deltas = [right - left for left, right in zip(elevations, elevations[1:])]
    grades = [delta / spacing * 100.0 for delta in deltas] if spacing else []
    ascent = sum(max(delta, 0.0) for delta in deltas)
    descent = sum(max(-delta, 0.0) for delta in deltas)
    elevation_delta = elevations[-1] - elevations[0]
    summary = {
        "routeId": edge["id"],
        "fromId": edge["from"],
        "toId": edge["to"],
        "mappedPathDistanceM": round(path_distance, 2),
        "targetSpacingM": TARGET_SPACING_M,
        "effectiveSpacingM": round(spacing, 3),
        "sampleCount": len(elevations),
        "startElevationM": round(elevations[0], 2),
        "endElevationM": round(elevations[-1], 2),
        "minElevationM": round(min(elevations), 2),
        "maxElevationM": round(max(elevations), 2),
        "elevationDeltaM": round(elevation_delta, 2),
        "ascentM": round(ascent, 2),
        "descentM": round(descent, 2),
        "averageGradePct": round(elevation_delta / path_distance * 100.0, 2),
        "maxUphillGradePct": round(max(grades, default=0.0), 2),
        "maxDownhillGradePct": round(min(grades, default=0.0), 2),
    }
    profile = {
        "routeId": edge["id"],
        "distancesM": [round(value, 2) for value in distances],
        "elevationsM": [round(value, 2) for value in elevations],
    }
    return summary, profile


def write_module(path: Path, declarations: list[tuple[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = ["// Generated by scripts/build_navigation_elevation.py. Do not edit by hand."]
    for name, value in declarations:
        lines.append(f"export const {name} = Object.freeze({canonical_json(value)});")
    path.write_text("\n".join(lines) + "\n")


def main() -> None:
    artifact_manifest = json.loads(ARTIFACT_MANIFEST.read_text())
    source_manifest = json.loads(SOURCE_MANIFEST.read_text())
    edges_document = json.loads(EDGES.read_text())
    if DGM1.sha256(ARTIFACT) != artifact_manifest["output"]["sha256"]:
        raise ValueError("DGM1 artifact hash differs from reviewed manifest")
    if DGM1.sha256(SOURCE_MANIFEST) != artifact_manifest["source_manifest"]["sha256"]:
        raise ValueError("DGM1 source-manifest hash differs from reviewed artifact manifest")

    grid = DGM1.load_intermediate(ARTIFACT)
    bounds = tuple(float(value) for value in artifact_manifest["bounds_epsg25832"])
    if grid.shape != (artifact_manifest["dimensions"][1], artifact_manifest["dimensions"][0]):
        raise ValueError("DGM1 artifact dimensions differ from reviewed manifest")

    summaries = {}
    profiles = {}
    for edge in sorted(edges_document["edges"], key=lambda item: item["id"]):
        summary, profile = sample_route(grid, bounds, edge)
        summaries[edge["id"]] = summary
        profiles[edge["id"]] = profile

    source = {
        "profileVersion": PROFILE_VERSION,
        "dataset": "ATKIS-DGM1",
        "provider": source_manifest["provider"],
        "artifactSha256": artifact_manifest["output"]["sha256"],
        "artifactManifestSha256": DGM1.sha256(ARTIFACT_MANIFEST),
        "sourceManifestSha256": DGM1.sha256(SOURCE_MANIFEST),
        "sourceCrs": artifact_manifest["source_crs"],
        "verticalReference": artifact_manifest["vertical_reference"],
        "gridSpacingM": artifact_manifest["grid_spacing_m"],
        "heightAccuracyM95PctUpTo": source_manifest.get("height_accuracy_m_95pct_up_to"),
        "interpolation": "bilinear-cell-centres-v1",
        "routeSampling": "equal-distance-epsg25832-max-20m-v1",
        "terrainSemantics": "bare-earth terrain elevation; never structure, monument, tree or specimen height",
        "coverageSemantics": "mapped path_coordinates only; endpoint snap connectors are excluded",
        "uncertaintySemantics": "source height accuracy is recorded; route geometry/interpolation and climb aggregation have no combined calibrated error bound",
    }
    write_module(
        SUMMARY_OUTPUT,
        [
            ("ROUTE_ELEVATION_SOURCE", source),
            ("ROUTE_ELEVATION_SUMMARIES", summaries),
        ],
    )
    write_module(PROFILE_OUTPUT, [("ROUTE_ELEVATION_PROFILES", profiles)])
    print(
        json.dumps(
            {
                "profileVersion": PROFILE_VERSION,
                "routes": len(summaries),
                "samples": sum(value["sampleCount"] for value in summaries.values()),
                "summaryOutput": str(SUMMARY_OUTPUT.relative_to(ROOT)),
                "profileOutput": str(PROFILE_OUTPUT.relative_to(ROOT)),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
