#!/usr/bin/env python3
"""Build/validate the bounded MapLibre Terrarium derivative from Phase-3 DGM1.

This renderer derivative is intentionally downstream of the immutable Phase-3
Float32 intermediate. It never downloads terrain and it never rewrites graph data.
The only supported pyramid is the fixed Bergpark z13-z16 AOI.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import shutil
import sys
from typing import Iterable

import numpy as np
from PIL import Image

# The sibling module owns the qualified DGM1 transform/intermediate semantics.
from dgm1 import canonical_json, load_intermediate, sha256, utm32_inverse


TILE_SIZE = 256
ZOOMS = (13, 14, 15, 16)
TERRARIUM_OFFSET_M = 32768.0
TERRARIUM_QUANTIZATION_M = 1.0 / 256.0
MAX_DERIVATIVE_BYTES = 8 * 1024 * 1024
EXPECTED_SOURCE_MANIFEST_SHA256 = "aa6d1ed921fc51321180c1367d42975fe86e8b906e1dacce54b781c45fc9946e"
EXPECTED_ARTIFACT_SHA256 = "cdff4e9d51f8bb1679b6a0e4f9ca6c1aeaa603488644faedafe3685e74989b4b"
EXPECTED_ARTIFACT_MANIFEST_SHA256 = "d292f8d7dd5c10f5ffa290705a7938e5f2fccd1b3779e37d046c4c5847ffecc3"
DEFAULT_SOURCE_MANIFEST = Path("terrain/sources/hessen-dgm1.yml")
DEFAULT_ARTIFACT = Path("terrain/artifacts/bergpark-dgm1.npz")
DEFAULT_ARTIFACT_MANIFEST = Path("terrain/artifacts/bergpark-dgm1.manifest.json")
DEFAULT_OUTPUT = Path("public/terrain/dgm1-terrarium")
GENERATION_COMMAND = "python terrain/pipeline/maplibre_dem.py build"


def _canonical_write(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(canonical_json(data))


def _load_authority(
    source_manifest_path: Path,
    artifact_path: Path,
    artifact_manifest_path: Path,
) -> tuple[dict[str, object], dict[str, object], np.ndarray]:
    actual = {
        "source_manifest": sha256(source_manifest_path),
        "artifact": sha256(artifact_path),
        "artifact_manifest": sha256(artifact_manifest_path),
    }
    expected = {
        "source_manifest": EXPECTED_SOURCE_MANIFEST_SHA256,
        "artifact": EXPECTED_ARTIFACT_SHA256,
        "artifact_manifest": EXPECTED_ARTIFACT_MANIFEST_SHA256,
    }
    if actual != expected:
        raise ValueError(f"Phase-3 terrain authority drifted: {actual!r} != {expected!r}")

    source_manifest = json.loads(source_manifest_path.read_text())
    artifact_manifest = json.loads(artifact_manifest_path.read_text())
    if artifact_manifest.get("output", {}).get("sha256") != actual["artifact"]:
        raise ValueError("artifact manifest no longer identifies the reviewed Phase-3 artifact")
    if artifact_manifest.get("source_manifest", {}).get("sha256") != actual["source_manifest"]:
        raise ValueError("artifact manifest no longer identifies the reviewed Phase-3 source manifest")
    if source_manifest.get("license") != "dl-zero-de/2.0":
        raise ValueError("unexpected DGM1 licence authority")
    if artifact_manifest.get("vertical_reference") != "DHHN2016_NH":
        raise ValueError("unexpected vertical reference")
    if artifact_manifest.get("grid_spacing_m") != 1.0:
        raise ValueError("unexpected DGM1 grid spacing")
    grid = load_intermediate(artifact_path)
    dims = artifact_manifest.get("dimensions")
    if dims != [int(grid.shape[1]), int(grid.shape[0])]:
        raise ValueError("intermediate dimensions differ from the reviewed manifest")
    return source_manifest, artifact_manifest, grid


def tile_fraction(lon_deg: float, lat_deg: float, zoom: int) -> tuple[float, float]:
    n = float(1 << zoom)
    lat = math.radians(max(-85.05112878, min(85.05112878, lat_deg)))
    x = (lon_deg + 180.0) / 360.0 * n
    y = (1.0 - math.asinh(math.tan(lat)) / math.pi) * 0.5 * n
    return x, y


def tile_ranges(bounds: dict[str, float], zooms: Iterable[int] = ZOOMS) -> dict[int, tuple[range, range]]:
    result: dict[int, tuple[range, range]] = {}
    for zoom in zooms:
        if zoom not in ZOOMS:
            raise ValueError(f"unsupported terrain zoom {zoom}; bounded derivative is fixed to {ZOOMS}")
        west_x, south_y = tile_fraction(bounds["west"], bounds["south"], zoom)
        east_x, north_y = tile_fraction(bounds["east"], bounds["north"], zoom)
        # nextafter prevents an exact east/south tile boundary from adding an unrelated tile.
        x_min = math.floor(west_x)
        x_max = math.floor(math.nextafter(east_x, -math.inf))
        y_min = math.floor(north_y)
        y_max = math.floor(math.nextafter(south_y, -math.inf))
        result[zoom] = (range(x_min, x_max + 1), range(y_min, y_max + 1))
    return result


def tile_count(bounds: dict[str, float], zooms: Iterable[int] = ZOOMS) -> dict[int, int]:
    return {
        zoom: len(xs) * len(ys)
        for zoom, (xs, ys) in tile_ranges(bounds, zooms).items()
    }


def source_bounds_wgs84(native_bounds: list[float]) -> list[float]:
    west, south, east, north = [float(v) for v in native_bounds]
    corners = [
        utm32_inverse(easting, northing)
        for easting in (west, east)
        for northing in (south, north)
    ]
    lats = [lat for lat, _ in corners]
    lons = [lon for _, lon in corners]
    return [min(lons), min(lats), max(lons), max(lats)]


def _utm32_forward_arrays(lat_deg: np.ndarray, lon_deg: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Vectorized WGS84/ETRS89 -> UTM 32N matching dgm1.utm32_forward."""
    a = 6378137.0
    f = 1.0 / 298.257223563
    e2 = f * (2.0 - f)
    ep2 = e2 / (1.0 - e2)
    k0 = 0.9996
    lon0 = math.radians(9.0)
    phi = np.radians(lat_deg)
    lon = np.radians(lon_deg)
    sin_phi = np.sin(phi)
    cos_phi = np.cos(phi)
    n = a / np.sqrt(1.0 - e2 * sin_phi**2)
    t = np.tan(phi) ** 2
    c = ep2 * cos_phi**2
    aa = cos_phi * (lon - lon0)
    m = a * (
        (1 - e2 / 4 - 3 * e2**2 / 64 - 5 * e2**3 / 256) * phi
        - (3 * e2 / 8 + 3 * e2**2 / 32 + 45 * e2**3 / 1024) * np.sin(2 * phi)
        + (15 * e2**2 / 256 + 45 * e2**3 / 1024) * np.sin(4 * phi)
        - (35 * e2**3 / 3072) * np.sin(6 * phi)
    )
    easting = 500000.0 + k0 * n * (
        aa + (1 - t + c) * aa**3 / 6 + (5 - 18 * t + t**2 + 72 * c - 58 * ep2) * aa**5 / 120
    )
    northing = k0 * (
        m
        + n
        * np.tan(phi)
        * (
            aa**2 / 2
            + (5 - t + 9 * c + 4 * c**2) * aa**4 / 24
            + (61 - 58 * t + t**2 + 600 * c - 330 * ep2) * aa**6 / 720
        )
    )
    return easting, northing


def _tile_pixel_lon_lat(zoom: int, tile_x: int, tile_y: int) -> tuple[np.ndarray, np.ndarray]:
    n = float(1 << zoom)
    cols = (tile_x + (np.arange(TILE_SIZE, dtype=np.float64) + 0.5) / TILE_SIZE) / n
    rows = (tile_y + (np.arange(TILE_SIZE, dtype=np.float64) + 0.5) / TILE_SIZE) / n
    lon = cols * 360.0 - 180.0
    mercator = math.pi * (1.0 - 2.0 * rows)
    lat = np.degrees(np.arctan(np.sinh(mercator)))
    return np.broadcast_to(lon[None, :], (TILE_SIZE, TILE_SIZE)), np.broadcast_to(lat[:, None], (TILE_SIZE, TILE_SIZE))


def _sample_bilinear(
    grid: np.ndarray,
    native_bounds: list[float],
    lon: np.ndarray,
    lat: np.ndarray,
) -> np.ndarray:
    west, _south, east, north = [float(v) for v in native_bounds]
    easting, northing = _utm32_forward_arrays(lat, lon)
    # The source transform used by Phase 3 treats bounds as pixel outer edges.
    col = easting - west - 0.5
    row = north - northing - 0.5
    # Raster-dem has no NoData channel. Pixels in edge tiles outside the bounded
    # DGM source are extended from the nearest reviewed source sample. MapLibre's
    # source bounds keep the visible terrain constrained to the canonical park AOI.
    col = np.clip(col, 0.0, grid.shape[1] - 1.0)
    row = np.clip(row, 0.0, grid.shape[0] - 1.0)
    c0 = np.floor(col).astype(np.int32)
    r0 = np.floor(row).astype(np.int32)
    c1 = np.minimum(c0 + 1, grid.shape[1] - 1)
    r1 = np.minimum(r0 + 1, grid.shape[0] - 1)
    dc = col - c0
    dr = row - r0
    top = grid[r0, c0] * (1.0 - dc) + grid[r0, c1] * dc
    bottom = grid[r1, c0] * (1.0 - dc) + grid[r1, c1] * dc
    return (top * (1.0 - dr) + bottom * dr).astype(np.float32)


def terrarium_encode(elevation_m: np.ndarray) -> np.ndarray:
    scaled = np.rint((np.asarray(elevation_m, dtype=np.float64) + TERRARIUM_OFFSET_M) * 256.0)
    if np.any(scaled < 0) or np.any(scaled > (256**3 - 1)):
        raise ValueError("elevation outside Terrarium encoding range")
    encoded = scaled.astype(np.uint32)
    rgb = np.empty(encoded.shape + (3,), dtype=np.uint8)
    rgb[..., 0] = (encoded >> 16) & 0xFF
    rgb[..., 1] = (encoded >> 8) & 0xFF
    rgb[..., 2] = encoded & 0xFF
    return rgb


def terrarium_decode(rgb: np.ndarray) -> np.ndarray:
    data = np.asarray(rgb, dtype=np.uint32)
    value = data[..., 0] * 65536 + data[..., 1] * 256 + data[..., 2]
    return value.astype(np.float64) / 256.0 - TERRARIUM_OFFSET_M


def _write_png(path: Path, rgb: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgb, mode="RGB").save(path, format="PNG", compress_level=9, optimize=False)


def _tile_manifest_entry(output: Path, tile_path: Path, zoom: int, x: int, y: int) -> dict[str, object]:
    return {
        "path": tile_path.relative_to(output).as_posix(),
        "z": zoom,
        "x": x,
        "y": y,
        "bytes": tile_path.stat().st_size,
        "sha256": sha256(tile_path),
    }


def build_derivative(
    *,
    source_manifest_path: Path = DEFAULT_SOURCE_MANIFEST,
    artifact_path: Path = DEFAULT_ARTIFACT,
    artifact_manifest_path: Path = DEFAULT_ARTIFACT_MANIFEST,
    output: Path = DEFAULT_OUTPUT,
    replace: bool = False,
) -> dict[str, object]:
    source_manifest, artifact_manifest, grid = _load_authority(
        source_manifest_path, artifact_path, artifact_manifest_path
    )
    runtime_bounds = source_manifest.get("runtime_bounds_wgs84")
    if not isinstance(runtime_bounds, dict) or set(runtime_bounds) < {"west", "south", "east", "north"}:
        raise ValueError("source manifest lacks canonical runtime bounds")
    runtime_bounds = {key: float(runtime_bounds[key]) for key in ("west", "south", "east", "north")}
    native_bounds = [float(v) for v in artifact_manifest["bounds_epsg25832"]]
    counts = tile_count(runtime_bounds)
    if counts != {13: 4, 14: 4, 15: 12, 16: 40}:
        raise ValueError(f"canonical AOI tile coverage drifted: {counts}")

    if output.exists():
        if not replace:
            raise FileExistsError(f"renderer derivative already exists: {output}")
        if output.resolve() == Path("/"):
            raise ValueError("refusing unsafe output path")
        shutil.rmtree(output)
    output.mkdir(parents=True, exist_ok=True)

    tiles: list[dict[str, object]] = []
    for zoom, (xs, ys) in tile_ranges(runtime_bounds).items():
        for x in xs:
            for y in ys:
                lon, lat = _tile_pixel_lon_lat(zoom, x, y)
                elevation = _sample_bilinear(grid, native_bounds, lon, lat)
                rgb = terrarium_encode(elevation)
                path = output / str(zoom) / str(x) / f"{y}.png"
                _write_png(path, rgb)
                tiles.append(_tile_manifest_entry(output, path, zoom, x, y))

    total_bytes = sum(int(tile["bytes"]) for tile in tiles)
    if total_bytes > MAX_DERIVATIVE_BYTES:
        raise ValueError(f"bounded terrain derivative is {total_bytes} bytes; cap is {MAX_DERIVATIVE_BYTES}")

    manifest = {
        "schema_version": 1,
        "format": "maplibre-raster-dem-terrarium-v1",
        "encoding": "terrarium",
        "tile_size": TILE_SIZE,
        "zooms": list(ZOOMS),
        "tile_counts": {str(key): value for key, value in counts.items()},
        "tile_count": len(tiles),
        "tile_bytes": total_bytes,
        "max_derivative_bytes": MAX_DERIVATIVE_BYTES,
        "tile_url_template": "terrain/dgm1-terrarium/{z}/{x}/{y}.png",
        "source_bounds_wgs84": source_bounds_wgs84(native_bounds),
        "renderer_bounds_wgs84": [
            runtime_bounds["west"],
            runtime_bounds["south"],
            runtime_bounds["east"],
            runtime_bounds["north"],
        ],
        "source_bounds_epsg25832": native_bounds,
        "source_crs": artifact_manifest["source_crs"],
        "source_axis_order": artifact_manifest["axis_order"],
        "vertical_reference": artifact_manifest["vertical_reference"],
        "vertical_units": "metres",
        "terrain_exaggeration": 1.0,
        "terrarium_quantization_m": TERRARIUM_QUANTIZATION_M,
        "resampling": "bilinear from Phase-3 1 m Float32 grid to WebMercator pixel centres",
        "edge_policy": "nearest reviewed DGM1 sample outside source extent within edge tiles; renderer bounds remain canonical park AOI",
        "camera": {
            "initial_pitch_deg": 45.0,
            "initial_bearing_deg": 0.0,
            "min_zoom": 13.0,
            "max_zoom": 18.0,
            "max_pitch_deg": 60.0,
            "fit_max_zoom": 14.75,
        },
        "attribution": {
            "provider": source_manifest["provider"],
            "dataset": source_manifest["dataset"],
            "license": source_manifest["license"],
            "license_url": source_manifest["license_url"],
            "product_url": source_manifest["official_metadata"]["product_url"],
        },
        "provenance": {
            "phase3_source_manifest": {
                "path": source_manifest_path.as_posix(),
                "sha256": sha256(source_manifest_path),
            },
            "phase3_artifact": {
                "path": artifact_path.as_posix(),
                "sha256": sha256(artifact_path),
                "bytes": artifact_path.stat().st_size,
            },
            "phase3_artifact_manifest": {
                "path": artifact_manifest_path.as_posix(),
                "sha256": sha256(artifact_manifest_path),
            },
        },
        "generation_command": GENERATION_COMMAND,
        "tiles": tiles,
    }
    _canonical_write(output / "manifest.json", manifest)
    return manifest


def validate_derivative(
    *,
    source_manifest_path: Path = DEFAULT_SOURCE_MANIFEST,
    artifact_path: Path = DEFAULT_ARTIFACT,
    artifact_manifest_path: Path = DEFAULT_ARTIFACT_MANIFEST,
    output: Path = DEFAULT_OUTPUT,
) -> dict[str, object]:
    source_manifest, artifact_manifest, grid = _load_authority(
        source_manifest_path, artifact_path, artifact_manifest_path
    )
    manifest_path = output / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("format") != "maplibre-raster-dem-terrarium-v1":
        raise ValueError("unexpected renderer derivative format")
    if manifest.get("encoding") != "terrarium" or manifest.get("tile_size") != TILE_SIZE:
        raise ValueError("unexpected raster-dem encoding")
    if manifest.get("zooms") != list(ZOOMS):
        raise ValueError("renderer derivative zoom pyramid drifted")
    if manifest.get("terrain_exaggeration") != 1.0 or manifest.get("vertical_units") != "metres":
        raise ValueError("terrain units/exaggeration drifted")
    runtime_bounds = source_manifest["runtime_bounds_wgs84"]
    expected_bounds = [runtime_bounds[key] for key in ("west", "south", "east", "north")]
    if manifest.get("renderer_bounds_wgs84") != expected_bounds:
        raise ValueError("renderer bounds drifted from canonical Phase-3 AOI")
    if manifest.get("provenance", {}).get("phase3_artifact", {}).get("sha256") != EXPECTED_ARTIFACT_SHA256:
        raise ValueError("renderer derivative lost Phase-3 artifact provenance")
    if manifest.get("provenance", {}).get("phase3_source_manifest", {}).get("sha256") != EXPECTED_SOURCE_MANIFEST_SHA256:
        raise ValueError("renderer derivative lost Phase-3 source provenance")
    if manifest.get("provenance", {}).get("phase3_artifact_manifest", {}).get("sha256") != EXPECTED_ARTIFACT_MANIFEST_SHA256:
        raise ValueError("renderer derivative lost Phase-3 manifest provenance")

    tiles = manifest.get("tiles")
    if not isinstance(tiles, list) or len(tiles) != 60:
        raise ValueError("bounded derivative must contain exactly 60 tiles")
    expected_counts = {str(k): v for k, v in tile_count(runtime_bounds).items()}
    if manifest.get("tile_counts") != expected_counts:
        raise ValueError("tile coverage counts drifted")
    actual_total = 0
    for tile in tiles:
        path = output / tile["path"]
        if not path.is_file():
            raise ValueError(f"missing terrain tile {tile['path']}")
        if sha256(path) != tile.get("sha256") or path.stat().st_size != tile.get("bytes"):
            raise ValueError(f"terrain tile hash/size mismatch: {tile['path']}")
        actual_total += path.stat().st_size
        with Image.open(path) as image:
            if image.mode != "RGB" or image.size != (TILE_SIZE, TILE_SIZE):
                raise ValueError(f"unexpected tile semantics: {tile['path']}")
    if actual_total != manifest.get("tile_bytes") or actual_total > MAX_DERIVATIVE_BYTES:
        raise ValueError("terrain derivative byte budget mismatch")

    # Independent unit check at four canonical controls: encode/decode the source
    # nearest samples and require Terrarium quantization to stay sub-centimetre.
    native_bounds = [float(v) for v in artifact_manifest["bounds_epsg25832"]]
    low, high = artifact_manifest["elevation_range_m"]
    encoded = terrarium_encode(np.asarray([low, high], dtype=np.float32))
    decoded = terrarium_decode(encoded)
    max_error = float(np.max(np.abs(decoded - np.asarray([low, high], dtype=np.float64))))
    if max_error > TERRARIUM_QUANTIZATION_M / 2 + 1e-6:
        raise ValueError(f"Terrarium quantization error too high: {max_error}")
    if grid.shape != (2096, 3098) or native_bounds != [526677.0, 5683885.0, 529775.0, 5685981.0]:
        raise ValueError("Phase-3 grid/bounds drifted during renderer validation")

    return {
        "ok": True,
        "tile_count": len(tiles),
        "tile_bytes": actual_total,
        "manifest_sha256": sha256(manifest_path),
        "max_terrarium_quantization_error_m": max_error,
        "phase3_artifact_sha256": sha256(artifact_path),
    }


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("command", choices=("build", "validate"))
    p.add_argument("--source-manifest", default=str(DEFAULT_SOURCE_MANIFEST))
    p.add_argument("--artifact", default=str(DEFAULT_ARTIFACT))
    p.add_argument("--artifact-manifest", default=str(DEFAULT_ARTIFACT_MANIFEST))
    p.add_argument("--output", default=str(DEFAULT_OUTPUT))
    p.add_argument("--replace", action="store_true", help="replace only the selected generated output directory")
    return p


def main() -> None:
    args = parser().parse_args()
    kwargs = {
        "source_manifest_path": Path(args.source_manifest),
        "artifact_path": Path(args.artifact),
        "artifact_manifest_path": Path(args.artifact_manifest),
        "output": Path(args.output),
    }
    if args.command == "build":
        result = build_derivative(**kwargs, replace=args.replace)
        print(json.dumps({
            "ok": True,
            "tile_count": result["tile_count"],
            "tile_bytes": result["tile_bytes"],
            "output": str(args.output),
            "manifest_sha256": sha256(Path(args.output) / "manifest.json"),
        }, indent=2))
    else:
        print(json.dumps(validate_derivative(**kwargs), indent=2))


if __name__ == "__main__":
    main()
