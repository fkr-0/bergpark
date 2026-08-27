#!/usr/bin/env python3
"""Fetch reproducible terrain elevations for all current graph coordinates.

The Open-Meteo Elevation API accepts at most 100 coordinate pairs per request.
This script preserves request metadata and raw responses under
data/sources/elevation/ and writes a normalized point table consumed by the
offline graph builder.
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


ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
DEFAULT_OUT = DATA / "sources" / "elevation"
ENDPOINT = "https://api.open-meteo.com/v1/elevation"


def coordinate_key(lat: float, lng: float) -> tuple[float, float]:
    return round(float(lat), 7), round(float(lng), 7)


def collect_coordinates() -> list[tuple[float, float]]:
    nodes = json.loads((DATA / "nodes.json").read_text())["nodes"]
    edges = json.loads((DATA / "edges.json").read_text())["edges"]
    seen: set[tuple[float, float]] = set()
    ordered: list[tuple[float, float]] = []

    def add(lat: float, lng: float) -> None:
        key = coordinate_key(lat, lng)
        if key not in seen:
            seen.add(key)
            ordered.append(key)

    for node in nodes:
        add(node["lat"], node["lng"])
    for edge in edges:
        for lat, lng in edge["path_coordinates"]:
            add(lat, lng)
    return ordered


def fetch_batch(coords: list[tuple[float, float]]) -> tuple[str, dict]:
    query = urllib.parse.urlencode(
        {
            "latitude": ",".join(f"{lat:.7f}" for lat, _ in coords),
            "longitude": ",".join(f"{lng:.7f}" for _, lng in coords),
        }
    )
    url = f"{ENDPOINT}?{query}"
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "bergpark-graph/0.2 public-spatial-research"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)
    values = payload.get("elevation")
    if not isinstance(values, list) or len(values) != len(coords):
        raise RuntimeError(
            f"unexpected elevation response: expected {len(coords)} values, got {values!r}"
        )
    return url, payload


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=pathlib.Path, default=DEFAULT_OUT)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--delay", type=float, default=1.5)
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

    coords = collect_coordinates()
    rows = []
    request_records = []
    for batch_index, start in enumerate(range(0, len(coords), 100)):
        batch = coords[start : start + 100]
        batch_name = f"batch-{batch_index:02d}.json"
        batch_path = out / batch_name
        record = None
        fetched = False
        if args.resume and batch_path.is_file():
            candidate = json.loads(batch_path.read_text())
            expected_coords = [[lat, lng] for lat, lng in batch]
            if (
                candidate.get("request", {}).get("coordinates") == expected_coords
                and len(candidate.get("response", {}).get("elevation", [])) == len(batch)
            ):
                record = candidate
                print(f"reused batch {batch_index} ({len(batch)} coordinates)")
        if record is None:
            last_error: Exception | None = None
            for attempt in range(1, args.retries + 1):
                try:
                    url, response = fetch_batch(batch)
                    break
                except Exception as exc:
                    last_error = exc
                    if attempt == args.retries:
                        raise RuntimeError(
                            f"elevation batch {batch_index} failed after {args.retries} attempts"
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
                "retrieved_utc": datetime.now(timezone.utc).isoformat(),
                "request": {
                    "endpoint": ENDPOINT,
                    "coordinate_count": len(batch),
                    "coordinates": [[lat, lng] for lat, lng in batch],
                    "url": url,
                },
                "response": response,
            }
            batch_path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
        request_records.append(
            {
                "batch": batch_name,
                "coordinate_count": len(batch),
                "sha256": hashlib.sha256(batch_path.read_bytes()).hexdigest(),
            }
        )
        for (lat, lng), elevation in zip(batch, record["response"]["elevation"]):
            if elevation is None:
                raise RuntimeError(f"missing elevation for {lat},{lng}")
            rows.append({"lat": lat, "lng": lng, "elevation_m": float(elevation)})
        if fetched and start + 100 < len(coords):
            time.sleep(args.delay)

    normalized = {
        "schema_version": 1,
        "retrieved_utc": datetime.now(timezone.utc).isoformat(),
        "source": {
            "provider": "Open-Meteo Elevation API",
            "endpoint": ENDPOINT,
            "documentation": "https://open-meteo.com/en/docs/elevation-api",
            "dataset": "Copernicus DEM 2021 GLO-90",
            "resolution_m": 90,
            "dataset_doi": "10.5270/ESA-c5d3d65",
        },
        "coordinate_count": len(rows),
        "points": rows,
        "raw_batches": request_records,
    }
    (out / "points.json").write_text(json.dumps(normalized, ensure_ascii=False, indent=2) + "\n")
    print(f"wrote {len(rows)} terrain elevations in {len(request_records)} batches to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
