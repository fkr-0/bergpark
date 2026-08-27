#!/usr/bin/env python3
"""Fetch and preserve GLO-90 terrain elevation for Phase-6 visitor POIs."""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

try:
    from .build_visitor_pois import selection_records, selection_sha256, source_candidates
except ImportError:
    from build_visitor_pois import selection_records, selection_sha256, source_candidates


ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "data" / "sources" / "visitor-poi-elevation"
ENDPOINT = "https://api.open-meteo.com/v1/elevation"
USER_AGENT = "bergpark-graph/0.6 visitor-poi-spatial-research"
MAX_ATTEMPTS = 3


def fetch(batch: list[dict]) -> tuple[str, dict]:
    query = urllib.parse.urlencode(
        {
            "latitude": ",".join(f"{row['lat']:.7f}" for row in batch),
            "longitude": ",".join(f"{row['lng']:.7f}" for row in batch),
        }
    )
    url = f"{ENDPOINT}?{query}"
    last_error: Exception | None = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.load(response)
            values = payload.get("elevation")
            if not isinstance(values, list) or len(values) != len(batch):
                raise RuntimeError(f"unexpected elevation response for {len(batch)} visitor POIs")
            return url, payload
        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code not in {429, 500, 502, 503, 504} or attempt == MAX_ATTEMPTS:
                raise
        except (urllib.error.URLError, TimeoutError) as exc:
            last_error = exc
            if attempt == MAX_ATTEMPTS:
                raise
        time.sleep(2 ** (attempt - 1))
    raise RuntimeError(f"elevation fetch failed: {last_error}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=pathlib.Path, default=DEFAULT_OUT)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--delay", type=float, default=1.5)
    args = parser.parse_args()
    out = args.output_dir.resolve()
    if out.exists() and any(out.iterdir()) and not args.resume:
        raise SystemExit(f"refusing to overwrite non-empty {out}; pass --resume")
    out.mkdir(parents=True, exist_ok=True)

    candidates = source_candidates()
    records = selection_records(candidates)
    selection_hash = selection_sha256(candidates)
    rows = []
    raw_batches = []
    retrieved_times = []
    for batch_index, start in enumerate(range(0, len(records), 100)):
        batch = records[start : start + 100]
        name = f"batch-{batch_index:02d}.json"
        path = out / name
        record = None
        if args.resume and path.exists():
            candidate = json.loads(path.read_text())
            if (
                candidate.get("selection_input_sha256") == selection_hash
                and candidate.get("request", {}).get("pois") == batch
            ):
                record = candidate
                print(f"reused {name}")
        if record is None:
            url, response = fetch(batch)
            record = {
                "schema_version": 1,
                "retrieved_utc": datetime.now(timezone.utc).isoformat(),
                "selection_input_sha256": selection_hash,
                "request": {"endpoint": ENDPOINT, "pois": batch, "url": url},
                "response": response,
            }
            path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
            if start + 100 < len(records):
                time.sleep(args.delay)
        retrieved_times.append(record["retrieved_utc"])
        values = record.get("response", {}).get("elevation")
        if not isinstance(values, list) or len(values) != len(batch):
            raise RuntimeError(f"invalid preserved response in {name}")
        for source_row, elevation in zip(batch, values):
            if elevation is None:
                raise RuntimeError(f"missing elevation for {source_row['poi_id']}")
            rows.append(
                {
                    "poi_id": source_row["poi_id"],
                    "osm_element": source_row["osm_element"],
                    "lat": source_row["lat"],
                    "lng": source_row["lng"],
                    "elevation_m": float(elevation),
                }
            )
        raw_batches.append(
            {
                "batch": name,
                "poi_count": len(batch),
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            }
        )

    doc = {
        "schema_version": 1,
        "retrieved_utc": max(retrieved_times),
        "selection_input_sha256": selection_hash,
        "source": {
            "provider": "Open-Meteo Elevation API",
            "dataset": "Copernicus DEM 2021 GLO-90",
            "resolution_m": 90,
            "vertical_accuracy_m": None,
            "accuracy_status": "not_reported_in_project_source",
            "dataset_doi": "10.5270/ESA-c5d3d65",
        },
        "poi_count": len(rows),
        "points": rows,
        "raw_batches": raw_batches,
    }
    (out / "points.json").write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
    print(f"wrote {len(rows)} visitor POI elevations in {len(raw_batches)} batches")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
