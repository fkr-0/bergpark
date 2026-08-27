#!/usr/bin/env python3
"""Acquire only missing GLO-90 values for the frozen Phase-8 topology selection.

Normal topology builds are offline.  This explicit acquisition command reuses
all exact coordinates already preserved by earlier graph/tree/bench/visitor
GLO-90 snapshots and contacts Open-Meteo only for selection-hashed coordinates
that have no preserved value.  Existing values are never refreshed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any

try:
    from .path_topology_source import (
        DATA,
        topology_elevation_selection_records,
        topology_elevation_selection_sha256,
    )
except ImportError:
    from path_topology_source import (
        DATA,
        topology_elevation_selection_records,
        topology_elevation_selection_sha256,
    )

DEFAULT_OUT = DATA / "sources" / "path-topology-elevation"
ENDPOINT = "https://api.open-meteo.com/v1/elevation"
REUSE_SNAPSHOTS = (
    DATA / "sources" / "elevation" / "points.json",
    DATA / "sources" / "tree-elevation" / "points.json",
    DATA / "sources" / "bench-elevation" / "points.json",
    DATA / "sources" / "visitor-poi-elevation" / "points.json",
)


def coord_key(lat: float, lng: float) -> tuple[float, float]:
    return round(float(lat), 7), round(float(lng), 7)


def sha256_file(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_reusable_values() -> dict[tuple[float, float], dict[str, Any]]:
    values: dict[tuple[float, float], dict[str, Any]] = {}
    for path in REUSE_SNAPSHOTS:
        if not path.is_file():
            continue
        doc = json.loads(path.read_text())
        snapshot_ref = str(path.relative_to(DATA.parent))
        for point in doc.get("points", []):
            if "lat" not in point or "elevation_m" not in point:
                continue
            lng = point.get("lng", point.get("lon"))
            if lng is None:
                continue
            key = coord_key(point["lat"], lng)
            elevation = float(point["elevation_m"])
            existing = values.get(key)
            if existing is not None and existing["elevation_m"] != elevation:
                raise RuntimeError(
                    f"conflicting preserved GLO-90 values at {key}: "
                    f"{existing['elevation_m']} vs {elevation}"
                )
            values.setdefault(
                key,
                {
                    "elevation_m": elevation,
                    "snapshot": snapshot_ref,
                    "snapshot_sha256": sha256_file(path),
                    "retrieved_at": doc.get("retrieved_utc"),
                },
            )
    return values


def fetch_batch(coords: list[tuple[float, float]]) -> tuple[str, dict[str, Any]]:
    query = urllib.parse.urlencode(
        {
            "latitude": ",".join(f"{lat:.7f}" for lat, _ in coords),
            "longitude": ",".join(f"{lng:.7f}" for _, lng in coords),
        }
    )
    url = f"{ENDPOINT}?{query}"
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "bergpark-graph/phase8 public-spatial-research"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)
    elevations = payload.get("elevation")
    if not isinstance(elevations, list) or len(elevations) != len(coords):
        raise RuntimeError(
            f"unexpected elevation response: expected {len(coords)} values, got {elevations!r}"
        )
    return url, payload


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=pathlib.Path, default=DEFAULT_OUT)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--delay", type=float, default=0.5)
    parser.add_argument("--retries", type=int, default=4)
    args = parser.parse_args()

    out = args.output_dir.resolve()
    if out.exists() and any(out.iterdir()) and not (args.force or args.resume):
        raise SystemExit(f"refusing to overwrite non-empty {out}; pass --force or --resume")
    out.mkdir(parents=True, exist_ok=True)
    if args.force:
        for path in list(out.glob("batch-*.json")) + [out / "points.json"]:
            if path.exists():
                path.unlink()

    selection = topology_elevation_selection_records()
    selection_sha = topology_elevation_selection_sha256(selection)
    reusable = load_reusable_values()
    missing = [
        row
        for row in selection
        if coord_key(row["lat"], row["lng"]) not in reusable
    ]
    fetched_values: dict[tuple[float, float], dict[str, Any]] = {}
    raw_batches: list[dict[str, Any]] = []

    for batch_index, start in enumerate(range(0, len(missing), 100)):
        rows = missing[start : start + 100]
        coords = [coord_key(row["lat"], row["lng"]) for row in rows]
        batch_name = f"batch-{batch_index:02d}.json"
        batch_path = out / batch_name
        record: dict[str, Any] | None = None
        fetched = False
        if args.resume and batch_path.is_file():
            candidate = json.loads(batch_path.read_text())
            if (
                candidate.get("selection_input_sha256") == selection_sha
                and candidate.get("request", {}).get("coordinates") == [[lat, lng] for lat, lng in coords]
                and len(candidate.get("response", {}).get("elevation", [])) == len(coords)
            ):
                record = candidate
                print(f"reused batch {batch_index} ({len(coords)} coordinates)")
        if record is None:
            last_error: Exception | None = None
            for attempt in range(1, args.retries + 1):
                try:
                    url, response = fetch_batch(coords)
                    break
                except Exception as exc:  # bounded retry around a source acquisition command
                    last_error = exc
                    if attempt == args.retries:
                        raise RuntimeError(
                            f"topology elevation batch {batch_index} failed after {args.retries} attempts"
                        ) from exc
                    backoff = args.delay * attempt
                    print(
                        f"batch {batch_index} attempt {attempt}/{args.retries} failed: {exc}; "
                        f"retrying after {backoff:.1f}s"
                    )
                    time.sleep(backoff)
            else:
                raise RuntimeError(f"unreachable retry state: {last_error}")
            fetched = True
            record = {
                "schema_version": 1,
                "selection_input_sha256": selection_sha,
                "retrieved_utc": datetime.now(timezone.utc).isoformat(),
                "request": {
                    "endpoint": ENDPOINT,
                    "coordinate_count": len(coords),
                    "coordinates": [[lat, lng] for lat, lng in coords],
                    "url": url,
                },
                "response": response,
            }
            batch_path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")

        raw_batches.append(
            {
                "batch": batch_name,
                "coordinate_count": len(coords),
                "sha256": sha256_file(batch_path),
                "retrieved_utc": record.get("retrieved_utc"),
            }
        )
        for coord, elevation in zip(coords, record["response"]["elevation"]):
            if elevation is None:
                raise RuntimeError(f"missing elevation for {coord[0]},{coord[1]}")
            fetched_values[coord] = {
                "elevation_m": float(elevation),
                "batch": batch_name,
                "batch_sha256": sha256_file(batch_path),
                "retrieved_at": record.get("retrieved_utc"),
            }
        if fetched and start + 100 < len(missing):
            time.sleep(args.delay)

    points = []
    for row in selection:
        key = coord_key(row["lat"], row["lng"])
        if key in reusable:
            source = reusable[key]
            points.append(
                {
                    **row,
                    "elevation_m": source["elevation_m"],
                    "value_source": {
                        "kind": "reused_preserved_glo90_value",
                        "snapshot": source["snapshot"],
                        "snapshot_sha256": source["snapshot_sha256"],
                        "retrieved_at": source["retrieved_at"],
                    },
                }
            )
        else:
            source = fetched_values.get(key)
            if source is None:
                raise RuntimeError(f"selection coordinate lacks terrain value: {row['path_node_id']}")
            points.append(
                {
                    **row,
                    "elevation_m": source["elevation_m"],
                    "value_source": {
                        "kind": "phase8_fetched_glo90_value",
                        "snapshot": f"data/sources/path-topology-elevation/{source['batch']}",
                        "snapshot_sha256": source["batch_sha256"],
                        "retrieved_at": source["retrieved_at"],
                    },
                }
            )

    timestamps = [
        source.get("retrieved_at")
        for point in points
        for source in [point["value_source"]]
        if source.get("retrieved_at")
    ]
    normalized = {
        "schema_version": 1,
        "selection_input_sha256": selection_sha,
        "selection_count": len(selection),
        "reused_preserved_count": len(selection) - len(missing),
        "phase8_fetched_count": len(missing),
        "retrieved_utc": max(timestamps) if timestamps else None,
        "source": {
            "provider": "Open-Meteo Elevation API",
            "endpoint": ENDPOINT,
            "documentation": "https://open-meteo.com/en/docs/elevation-api",
            "dataset": "Copernicus DEM 2021 GLO-90",
            "resolution_m": 90,
            "dataset_doi": "10.5270/ESA-c5d3d65",
            "vertical_accuracy_m": None,
            "accuracy_status": "not_reported_in_project_source",
            "acquisition_policy": "reuse exact preserved coordinates; fetch only selection-hashed missing coordinates",
        },
        "points": points,
        "raw_batches": raw_batches,
    }
    (out / "points.json").write_text(json.dumps(normalized, ensure_ascii=False, indent=2) + "\n")
    print(
        f"wrote {len(points)} topology elevations: "
        f"{normalized['reused_preserved_count']} reused, {normalized['phase8_fetched_count']} fetched "
        f"in {len(raw_batches)} batches"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
