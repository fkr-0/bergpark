#!/usr/bin/env python3
"""Bounded Hessen ATKIS-DGM1 acquisition/conversion/validation for Bergpark.

The pipeline intentionally uses only Python stdlib plus repository-host Python packages
already present in the environment (NumPy and Pillow). No renderer code is involved.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import os
from pathlib import Path
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import zipfile

import numpy as np
import PIL
from PIL import Image


WCS_URL = "https://inspire-hessen.de/raster/dgm1/ows"
COVERAGE_ID = "he_dgm1"
SOURCE_CRS = "EPSG:25832"
SOURCE_CRS_NAME = "ETRS89 / UTM zone 32N"
VERTICAL_REFERENCE = "DHHN2016_NH"
NODATA = -9999.0
CELL_SIZE_M = 1.0
AOI_MARGIN_M = 150.0
MAX_AOI_MARGIN_M = 250.0
MAX_AOI_CELLS = 8_000_000
EXPECTED_BOUNDS = (526677, 5683885, 529775, 5685981)
EXPECTED_SIZE = (3098, 2096)
LICENSE_CHECKED_AT = "2026-08-28"
PRODUCT_URL = "https://hvbg.hessen.de/landesvermessung/geotopographie/3d-daten/digitale-gelaendemodelle"
OPEN_DATA_URL = "https://opendata.hessen.de/dataset/atkis-dgm-1"
WCS_METADATA_URL = (
    "https://www.geoportal.hessen.de/mapbender/php/mod_exportIso19139.php?"
    "url=https%3A%2F%2Fwww.geoportal.hessen.de%2Fmapbender%2Fphp%2F"
    "mod_dataISOMetadata.php%3FoutputFormat%3Diso19139%26id%3D"
    "3f7eff3c-2dd4-421e-a25d-775205a3c92b"
)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def canonical_json(data: object) -> bytes:
    return (json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode()


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(canonical_json(data))


def utm32_forward(lat_deg: float, lon_deg: float) -> tuple[float, float]:
    """WGS84/ETRS89 -> UTM zone 32N using the standard TM series.

    At Bergpark scale the WGS84/ETRS89 realization difference is far below a DGM1 cell.
    """
    a = 6378137.0
    f = 1.0 / 298.257223563
    e2 = f * (2.0 - f)
    ep2 = e2 / (1.0 - e2)
    k0 = 0.9996
    lon0 = math.radians(9.0)
    phi = math.radians(lat_deg)
    lon = math.radians(lon_deg)
    n = a / math.sqrt(1.0 - e2 * math.sin(phi) ** 2)
    t = math.tan(phi) ** 2
    c = ep2 * math.cos(phi) ** 2
    aa = math.cos(phi) * (lon - lon0)
    m = a * (
        (1 - e2 / 4 - 3 * e2**2 / 64 - 5 * e2**3 / 256) * phi
        - (3 * e2 / 8 + 3 * e2**2 / 32 + 45 * e2**3 / 1024) * math.sin(2 * phi)
        + (15 * e2**2 / 256 + 45 * e2**3 / 1024) * math.sin(4 * phi)
        - (35 * e2**3 / 3072) * math.sin(6 * phi)
    )
    easting = 500000.0 + k0 * n * (
        aa
        + (1 - t + c) * aa**3 / 6
        + (5 - 18 * t + t**2 + 72 * c - 58 * ep2) * aa**5 / 120
    )
    northing = k0 * (
        m
        + n
        * math.tan(phi)
        * (
            aa**2 / 2
            + (5 - t + 9 * c + 4 * c**2) * aa**4 / 24
            + (61 - 58 * t + t**2 + 600 * c - 330 * ep2) * aa**6 / 720
        )
    )
    return easting, northing


def utm32_inverse(easting: float, northing: float) -> tuple[float, float]:
    a = 6378137.0
    f = 1.0 / 298.257223563
    e2 = f * (2.0 - f)
    ep2 = e2 / (1.0 - e2)
    k0 = 0.9996
    x = easting - 500000.0
    m = northing / k0
    mu = m / (a * (1 - e2 / 4 - 3 * e2**2 / 64 - 5 * e2**3 / 256))
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    phi1 = (
        mu
        + (3 * e1 / 2 - 27 * e1**3 / 32) * math.sin(2 * mu)
        + (21 * e1**2 / 16 - 55 * e1**4 / 32) * math.sin(4 * mu)
        + 151 * e1**3 / 96 * math.sin(6 * mu)
        + 1097 * e1**4 / 512 * math.sin(8 * mu)
    )
    n1 = a / math.sqrt(1 - e2 * math.sin(phi1) ** 2)
    t1 = math.tan(phi1) ** 2
    c1 = ep2 * math.cos(phi1) ** 2
    r1 = a * (1 - e2) / (1 - e2 * math.sin(phi1) ** 2) ** 1.5
    d = x / (n1 * k0)
    lat = phi1 - (n1 * math.tan(phi1) / r1) * (
        d**2 / 2
        - (5 + 3 * t1 + 10 * c1 - 4 * c1**2 - 9 * ep2) * d**4 / 24
        + (61 + 90 * t1 + 298 * c1 + 45 * t1**2 - 252 * ep2 - 3 * c1**2) * d**6 / 720
    )
    lon = math.radians(9.0) + (
        d
        - (1 + 2 * t1 + c1) * d**3 / 6
        + (5 - 2 * c1 + 28 * t1 - 3 * c1**2 + 8 * ep2 + 24 * t1**2) * d**5 / 120
    ) / math.cos(phi1)
    return math.degrees(lat), math.degrees(lon)


def graph_bounds(path: Path) -> dict[str, float]:
    return json.loads(path.read_text())["bbox"]


def native_bounds_from_graph(path: Path, margin_m: float = AOI_MARGIN_M) -> tuple[int, int, int, int]:
    if not 0.0 <= margin_m <= MAX_AOI_MARGIN_M:
        raise ValueError(f"AOI margin must be between 0 and {MAX_AOI_MARGIN_M:g} m")
    bbox = graph_bounds(path)
    corners = [
        utm32_forward(lat, lon)
        for lat in (bbox["south"], bbox["north"])
        for lon in (bbox["west"], bbox["east"])
    ]
    eastings = [p[0] for p in corners]
    northings = [p[1] for p in corners]
    bounds = (
        math.floor(min(eastings) - margin_m),
        math.floor(min(northings) - margin_m),
        math.ceil(max(eastings) + margin_m),
        math.ceil(max(northings) + margin_m),
    )
    cells = (bounds[2] - bounds[0]) * (bounds[3] - bounds[1])
    if cells > MAX_AOI_CELLS:
        raise ValueError(f"bounded AOI would contain {cells} cells; cap is {MAX_AOI_CELLS}")
    return bounds


def acquisition_url(bounds: tuple[int, int, int, int]) -> str:
    west, south, east, north = bounds
    params = [
        ("SERVICE", "WCS"),
        ("VERSION", "2.0.1"),
        ("REQUEST", "GetCoverage"),
        ("COVERAGEID", COVERAGE_ID),
        ("FORMAT", "image/tiff"),
        ("SUBSET", f"E({west},{east})"),
        ("SUBSET", f"N({south},{north})"),
    ]
    return f"{WCS_URL}?{urlencode(params, safe='(),')}"


def geotiff_info(path: Path) -> dict[str, object]:
    with Image.open(path) as image:
        tags = image.tag_v2
        scale = tuple(float(v) for v in tags.get(33550, ()))
        tie = tuple(float(v) for v in tags.get(33922, ()))
        geokeys = tuple(int(v) for v in tags.get(34735, ()))
        ascii_params = str(tags.get(34737, ""))
        nodata_raw = tags.get(42113)
        nodata = float(nodata_raw) if nodata_raw is not None else None
        return {
            "format": image.format,
            "mode": image.mode,
            "width": image.width,
            "height": image.height,
            "bits_per_sample": tuple(tags.get(258, ())),
            "sample_format": tuple(tags.get(339, ())),
            "compression": int(tags.get(259, 0)),
            "pixel_scale": scale,
            "tiepoint": tie,
            "geo_key_directory": geokeys,
            "geo_ascii_params": ascii_params,
            "nodata": nodata,
        }


def assert_source_semantics(info: dict[str, object]) -> None:
    errors: list[str] = []
    if info["format"] != "TIFF" or info["mode"] != "F":
        errors.append(f"expected Float32 TIFF, got {info['format']}/{info['mode']}")
    if tuple(info["bits_per_sample"]) != (32,):
        errors.append(f"expected 32 bits/sample, got {info['bits_per_sample']}")
    if tuple(info["sample_format"]) != (3,):
        errors.append(f"expected IEEE float sample format, got {info['sample_format']}")
    if tuple(info["pixel_scale"][:2]) != (1.0, 1.0):
        errors.append(f"expected 1 m cells, got {info['pixel_scale']}")
    if info["nodata"] != NODATA:
        errors.append(f"expected NoData {NODATA}, got {info['nodata']}")
    geokeys = tuple(info["geo_key_directory"])
    if 25832 not in geokeys:
        errors.append("GeoTIFF does not advertise EPSG:25832")
    if errors:
        raise ValueError("; ".join(errors))


def source_bounds(info: dict[str, object]) -> tuple[float, float, float, float]:
    tie = tuple(info["tiepoint"])
    scale = tuple(info["pixel_scale"])
    if len(tie) < 6 or len(scale) < 2:
        raise ValueError("missing GeoTIFF tiepoint/pixel scale")
    west = tie[3]
    north = tie[4]
    east = west + int(info["width"]) * scale[0]
    south = north - int(info["height"]) * scale[1]
    return west, south, east, north


def load_grid(path: Path) -> np.ndarray:
    with Image.open(path) as image:
        grid = np.asarray(image, dtype=np.float32)
    return np.ascontiguousarray(grid)


def write_deterministic_npz(path: Path, grid: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    little = np.ascontiguousarray(grid, dtype="<f4")
    shuffled = np.frombuffer(little.tobytes(order="C"), dtype=np.uint8).reshape(-1, 4).T.copy()

    def npy_bytes(value: np.ndarray) -> bytes:
        buffer = io.BytesIO()
        np.save(buffer, value, allow_pickle=False)
        return buffer.getvalue()

    def zip_info(name: str) -> zipfile.ZipInfo:
        info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.create_system = 3
        info.external_attr = 0o100644 << 16
        info.flag_bits = 0
        return info

    with path.open("wb") as handle:
        with zipfile.ZipFile(handle, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            archive.writestr(
                zip_info("elevation_bytes.npy"),
                npy_bytes(shuffled),
                compress_type=zipfile.ZIP_DEFLATED,
                compresslevel=9,
            )
            archive.writestr(
                zip_info("shape.npy"),
                npy_bytes(np.asarray(little.shape, dtype="<i8")),
                compress_type=zipfile.ZIP_DEFLATED,
                compresslevel=9,
            )


def load_intermediate(path: Path) -> np.ndarray:
    with np.load(path, allow_pickle=False) as archive:
        shuffled = np.asarray(archive["elevation_bytes"], dtype=np.uint8)
        shape = tuple(int(v) for v in np.asarray(archive["shape"], dtype=np.int64))
    if shuffled.ndim != 2 or shuffled.shape[0] != 4 or len(shape) != 2:
        raise ValueError("invalid byte-shuffled terrain artifact shape")
    raw = np.ascontiguousarray(shuffled.T).reshape(-1).tobytes()
    expected_bytes = math.prod(shape) * 4
    if len(raw) != expected_bytes:
        raise ValueError(f"terrain artifact byte count {len(raw)} != {expected_bytes}")
    return np.frombuffer(raw, dtype="<f4").copy().reshape(shape)


def sample_nearest(grid: np.ndarray, bounds: tuple[float, float, float, float], lat: float, lon: float) -> float:
    west, south, east, north = bounds
    easting, northing = utm32_forward(lat, lon)
    if not (west <= easting < east and south < northing <= north):
        raise ValueError(f"point {lat},{lon} outside terrain bounds")
    col = int(math.floor(easting - west))
    row = int(math.floor(north - northing))
    return float(grid[row, col])


def source_manifest(source: Path, graph: Path) -> dict[str, object]:
    info = geotiff_info(source)
    assert_source_semantics(info)
    bounds = source_bounds(info)
    expected = native_bounds_from_graph(graph)
    if tuple(round(v) for v in bounds) != expected:
        raise ValueError(f"source bounds {bounds} differ from bounded AOI {expected}")
    return {
        "schema_version": 1,
        "provider": "Hessisches Landesamt für Bodenmanagement und Geoinformation (HVBG)",
        "dataset": "ATKIS-DGM1",
        "product_identifier": COVERAGE_ID,
        "license": "dl-zero-de/2.0",
        "license_url": "https://www.govdata.de/dl-de/zero-2-0",
        "license_checked_at": LICENSE_CHECKED_AT,
        "official_metadata": {
            "product_url": PRODUCT_URL,
            "open_data_url": OPEN_DATA_URL,
            "wcs_metadata_url": WCS_METADATA_URL,
            "wcs_capabilities_url": f"{WCS_URL}?SERVICE=WCS&VERSION=2.1.0&REQUEST=GetCapabilities",
        },
        "source_url": acquisition_url(expected),
        "acquired_at": datetime.fromtimestamp(source.stat().st_mtime, timezone.utc).isoformat(),
        "source_files": [
            {"name": source.name, "sha256": sha256(source), "bytes": source.stat().st_size}
        ],
        "source_crs": SOURCE_CRS,
        "source_crs_name": SOURCE_CRS_NAME,
        "vertical_reference": VERTICAL_REFERENCE,
        "vertical_reference_basis": "HVBG DGM product metadata; GeoTIFF embeds horizontal EPSG only",
        "grid_spacing_m": CELL_SIZE_M,
        "height_accuracy_m_95pct_up_to": 0.3,
        "source_format": "GeoTIFF Float32",
        "published_product_encoding": "GeoTIFF Float32, LZW, NoData -9999",
        "wcs_response_compression_tag": int(info["compression"]),
        "wcs_response_compression_note": (
            "The bounded WCS response is uncompressed TIFF (tag 1); HVBG product metadata "
            "documents LZW for the published DGM1 product. Compression is transport/storage "
            "encoding and does not change the Float32 elevation samples."
        ),
        "source_nodata": NODATA,
        "axis_order": ["E", "N"],
        "source_bounds_epsg25832": list(expected),
        "source_dimensions": list(EXPECTED_SIZE),
        "runtime_bounds_wgs84": graph_bounds(graph),
        "aoi_margin_m": AOI_MARGIN_M,
    }


def load_source_manifest(path: Path, source: Path) -> dict[str, object]:
    manifest = json.loads(path.read_text())
    required = {
        "schema_version": 1,
        "dataset": "ATKIS-DGM1",
        "product_identifier": COVERAGE_ID,
        "license": "dl-zero-de/2.0",
        "license_checked_at": LICENSE_CHECKED_AT,
        "source_crs": SOURCE_CRS,
        "vertical_reference": VERTICAL_REFERENCE,
        "source_nodata": NODATA,
        "axis_order": ["E", "N"],
        "source_bounds_epsg25832": list(EXPECTED_BOUNDS),
        "source_dimensions": list(EXPECTED_SIZE),
        "aoi_margin_m": AOI_MARGIN_M,
    }
    for key, expected in required.items():
        if manifest.get(key) != expected:
            raise ValueError(f"source manifest {key}={manifest.get(key)!r}; expected {expected!r}")
    files = manifest.get("source_files")
    if not isinstance(files, list) or len(files) != 1:
        raise ValueError("source manifest must contain exactly one bounded source file")
    if files[0].get("sha256") != sha256(source) or files[0].get("bytes") != source.stat().st_size:
        raise ValueError("source file hash/size does not match reviewed source manifest")
    return manifest


def command_acquire(args: argparse.Namespace) -> None:
    graph = Path(args.graph)
    output = Path(args.output)
    bounds = native_bounds_from_graph(graph, args.margin_m)
    if args.margin_m == AOI_MARGIN_M and bounds != EXPECTED_BOUNDS:
        raise ValueError(f"canonical graph AOI drifted: {bounds} != {EXPECTED_BOUNDS}")
    url = acquisition_url(bounds)
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists() and not args.replace:
        info = geotiff_info(output)
        assert_source_semantics(info)
        if tuple(round(v) for v in source_bounds(info)) != bounds:
            raise ValueError("existing source does not match the requested bounded AOI")
        print(f"source already exists; refusing overwrite: {output}", file=sys.stderr)
        print(sha256(output))
        return
    request = Request(url, headers={"User-Agent": "bergpark-dgm1-phase3/1"})
    fd, tmp_name = tempfile.mkstemp(prefix=f".{output.name}.", suffix=".part", dir=output.parent)
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        with urlopen(request, timeout=args.timeout) as response, tmp.open("wb") as handle:
            shutil.copyfileobj(response, handle, length=1024 * 1024)
        info = geotiff_info(tmp)
        assert_source_semantics(info)
        os.replace(tmp, output)
    finally:
        tmp.unlink(missing_ok=True)
    result = {
        "source": str(output),
        "sha256": sha256(output),
        "bytes": output.stat().st_size,
        "url": url,
    }
    print(json.dumps(result, indent=2))


def command_record_source(args: argparse.Namespace) -> None:
    source = Path(args.source)
    manifest = source_manifest(source, Path(args.graph))
    write_json(Path(args.manifest), manifest)
    print(json.dumps(manifest, indent=2, ensure_ascii=False))


def command_build(args: argparse.Namespace) -> None:
    source = Path(args.source)
    source_manifest_path = Path(args.source_manifest)
    artifact = Path(args.artifact)
    load_source_manifest(source_manifest_path, source)
    info = geotiff_info(source)
    assert_source_semantics(info)
    grid = load_grid(source)
    if grid.shape != (EXPECTED_SIZE[1], EXPECTED_SIZE[0]):
        raise ValueError(f"unexpected grid shape {grid.shape}")
    if np.any(grid == NODATA):
        raise ValueError("NoData leaked into bounded Bergpark source")
    if not np.all(np.isfinite(grid)):
        raise ValueError("non-finite elevation in bounded source")
    write_deterministic_npz(artifact, grid)
    manifest = {
        "schema_version": 1,
        "artifact_format": "deterministic-npz-byte-shuffled-float32-v1",
        "array_names": ["elevation_bytes.npy", "shape.npy"],
        "dtype": "float32 little-endian",
        "storage_transform": "reversible 4-lane byte shuffle before DEFLATE",
        "lossy_quantization": False,
        "source": {
            "name": source.name,
            "sha256": sha256(source),
            "bytes": source.stat().st_size,
        },
        "source_manifest": {
            "name": source_manifest_path.name,
            "sha256": sha256(source_manifest_path),
        },
        "source_crs": SOURCE_CRS,
        "axis_order": ["E", "N"],
        "vertical_reference": VERTICAL_REFERENCE,
        "nodata": NODATA,
        "bounds_epsg25832": list(source_bounds(info)),
        "dimensions": [int(grid.shape[1]), int(grid.shape[0])],
        "grid_spacing_m": CELL_SIZE_M,
        "elevation_range_m": [float(np.min(grid)), float(np.max(grid))],
        "processing": {
            "command_profile": "bergpark-dgm1-byte-shuffled-float32-npz-v1",
            "python": sys.version.split()[0],
            "numpy": np.__version__,
            "pillow": PIL.__version__,
            "zip_compression": "byte-shuffle + deflate level 9; fixed 1980-01-01 timestamps",
        },
        "output": {
            "name": artifact.name,
            "sha256": sha256(artifact),
            "bytes": artifact.stat().st_size,
        },
    }
    write_json(Path(args.manifest), manifest)
    print(json.dumps(manifest, indent=2))


def command_validate(args: argparse.Namespace) -> None:
    source = Path(args.source)
    source_manifest_path = Path(args.source_manifest)
    artifact = Path(args.artifact)
    manifest_path = Path(args.manifest)
    graph_path = Path(args.graph)
    info = geotiff_info(source)
    assert_source_semantics(info)
    load_source_manifest(source_manifest_path, source)
    bounds = source_bounds(info)
    expected = native_bounds_from_graph(graph_path)
    if tuple(round(v) for v in bounds) != expected:
        raise ValueError(f"coverage mismatch {bounds} != {expected}")
    grid = load_intermediate(artifact)
    source_grid = load_grid(source)
    if not np.array_equal(grid, source_grid):
        raise ValueError("intermediate artifact differs from source Float32 grid")
    if np.any(grid == NODATA) or not np.all(np.isfinite(grid)):
        raise ValueError("NoData/non-finite elevation in intermediate artifact")
    low, high = float(np.min(grid)), float(np.max(grid))
    if not (150.0 < low < 300.0 and 500.0 < high < 650.0):
        raise ValueError(f"implausible Bergpark elevation range {low}..{high} m")
    manifest = json.loads(manifest_path.read_text())
    expected_manifest_fields = {
        "schema_version": 1,
        "artifact_format": "deterministic-npz-byte-shuffled-float32-v1",
        "dtype": "float32 little-endian",
        "lossy_quantization": False,
        "source_crs": SOURCE_CRS,
        "axis_order": ["E", "N"],
        "vertical_reference": VERTICAL_REFERENCE,
        "nodata": NODATA,
        "dimensions": list(EXPECTED_SIZE),
        "grid_spacing_m": CELL_SIZE_M,
        "bounds_epsg25832": [float(v) for v in EXPECTED_BOUNDS],
    }
    for key, expected_value in expected_manifest_fields.items():
        if manifest.get(key) != expected_value:
            raise ValueError(
                f"artifact manifest {key} does not match qualified pipeline authority"
            )
    if manifest["source"]["sha256"] != sha256(source):
        raise ValueError("source hash does not match artifact manifest")
    if manifest.get("source_manifest", {}).get("sha256") != sha256(source_manifest_path):
        raise ValueError("source-manifest hash does not match artifact manifest")
    if manifest["output"]["sha256"] != sha256(artifact):
        raise ValueError("artifact hash does not match manifest")

    graph = json.loads(graph_path.read_text())
    control_ids = {"herkules", "aquaedukt", "fontaenenteich", "loewenburg"}
    controls = {n["id"]: n for n in graph["nodes"] if n["id"] in control_ids}
    if len(controls) != 4:
        raise ValueError("expected four stable terrain sanity controls")
    samples = []
    for key in sorted(controls):
        node = controls[key]
        e, n = utm32_forward(float(node["lat"]), float(node["lng"]))
        lat2, lon2 = utm32_inverse(e, n)
        roundtrip_m = math.hypot(
            (lat2 - node["lat"]) * 111320.0,
            (lon2 - node["lng"])
            * 111320.0
            * math.cos(math.radians(node["lat"])),
        )
        if roundtrip_m > 0.02:
            raise ValueError(f"coordinate round-trip too large for {key}: {roundtrip_m} m")
        dgm = sample_nearest(grid, bounds, float(node["lat"]), float(node["lng"]))
        glo = node.get("elevation_m")
        if not math.isfinite(dgm) or not 150.0 < dgm < 650.0:
            raise ValueError(f"implausible control elevation for {key}: {dgm}")
        samples.append({
            "id": key,
            "lat": node["lat"],
            "lng": node["lng"],
            "utm_e": round(e, 3),
            "utm_n": round(n, 3),
            "roundtrip_error_m": round(roundtrip_m, 6),
            "dgm1_m": round(dgm, 3),
            "glo90_reference_m": glo,
            "dgm1_minus_glo90_m": None if glo is None else round(dgm - float(glo), 3),
        })
    result = {
        "ok": True,
        "bounds_epsg25832": list(bounds),
        "runtime_bounds_wgs84": graph_bounds(graph_path),
        "margin_m": AOI_MARGIN_M,
        "dimensions": [int(grid.shape[1]), int(grid.shape[0])],
        "elevation_range_m": [low, high],
        "source_sha256": sha256(source),
        "artifact_sha256": sha256(artifact),
        "control_samples": samples,
    }
    print(json.dumps(result, indent=2, ensure_ascii=False))


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="command", required=True)
    a = sub.add_parser("acquire", help="download only the bounded Bergpark WCS coverage")
    a.add_argument("--output", required=True)
    a.add_argument("--graph", default="data/graph.json")
    a.add_argument("--margin-m", type=float, default=AOI_MARGIN_M)
    a.add_argument("--timeout", type=float, default=180.0)
    a.add_argument("--replace", action="store_true")
    a.set_defaults(func=command_acquire)
    r = sub.add_parser("record-source", help="write immutable source/provenance metadata")
    r.add_argument("--source", required=True)
    r.add_argument("--manifest", required=True)
    r.add_argument("--graph", default="data/graph.json")
    r.set_defaults(func=command_record_source)
    b = sub.add_parser("build", help="create the deterministic lossless Float32 intermediate")
    b.add_argument("--source", required=True)
    b.add_argument("--source-manifest", required=True)
    b.add_argument("--artifact", required=True)
    b.add_argument("--manifest", required=True)
    b.set_defaults(func=command_build)
    v = sub.add_parser("validate", help="validate provenance, coverage, transform and elevations")
    v.add_argument("--source", required=True)
    v.add_argument("--source-manifest", required=True)
    v.add_argument("--artifact", required=True)
    v.add_argument("--manifest", required=True)
    v.add_argument("--graph", default="data/graph.json")
    v.set_defaults(func=command_validate)
    return p


def main() -> None:
    args = parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
