#!/usr/bin/env python3
"""Fetch terrain elevation for the 569 catalogued Bergpark tree nodes.

The existing Phase-2 elevation snapshot intentionally contains only place and
exported-route coordinates. Tree coordinates are therefore fetched into a
separate, auditable snapshot so the tree tranche cannot silently change the
qualified route source data.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone


ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "data" / "sources" / "osm-tree-nodes"
ID_FILE = ROOT / "data" / "sources" / "osm-tree-node-ids.txt"
DEFAULT_OUT = ROOT / "data" / "sources" / "tree-elevation"
ENDPOINT = "https://api.open-meteo.com/v1/elevation"


def catalog_ids() -> list[str]:
    ids = [line.strip() for line in ID_FILE.read_text().splitlines() if line.strip()]
    if len(ids) != 569 or len(set(ids)) != 569:
        raise RuntimeError(f"expected 569 unique catalog node ids, got {len(ids)} / {len(set(ids))} unique")
    return ids


def tree_coordinates() -> list[tuple[str, float, float]]:
    wanted = set(catalog_ids())
    rows: dict[str, tuple[str, float, float]] = {}
    for path in sorted(SOURCE_DIR.glob("chunk-*.xml")):
        root = ET.parse(path).getroot()
        for node in root.findall("node"):
            node_id = node.attrib["id"]
            if node_id in wanted:
                rows[node_id] = (node_id, round(float(node.attrib["lat"]), 7), round(float(node.attrib["lon"]), 7))
    missing = sorted(wanted - rows.keys())
    if missing:
        raise RuntimeError(f"missing {len(missing)} fetched OSM tree nodes; examples: {missing[:5]}")
    # Preserve the catalog order, which is stable independently of XML chunk order.
    return [rows[node_id] for node_id in catalog_ids()]


def fetch_batch(coords: list[tuple[str, float, float]]) -> tuple[str, dict]:
    query = urllib.parse.urlencode(
        {
            "latitude": ",".join(f"{lat:.7f}" for _, lat, _ in coords),
            "longitude": ",".join(f"{lng:.7f}" for _, _, lng in coords),
        }
    )
    url = f"{ENDPOINT}?{query}"
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "bergpark-graph/0.4 tree-spatial-research"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)
    elevations = payload.get("elevation")
    if not isinstance(elevations, list) or len(elevations) != len(coords):
        raise RuntimeError(f"unexpected elevation response for {len(coords)} coordinates")
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

    coords = tree_coordinates()
    rows = []
    raw_batches = []
    for batch_index, start in enumerate(range(0, len(coords), 100)):
        batch = coords[start : start + 100]
        name = f"batch-{batch_index:02d}.json"
        path = out / name
        record = None
        fetched = False
        if args.resume and path.is_file():
            candidate = json.loads(path.read_text())
            expected = [[node_id, lat, lng] for node_id, lat, lng in batch]
            if (
                candidate.get("request", {}).get("trees") == expected
                and len(candidate.get("response", {}).get("elevation", [])) == len(batch)
            ):
                record = candidate
                print(f"reused {name} ({len(batch)} trees)")
        if record is None:
            last_error: Exception | None = None
            for attempt in range(1, args.retries + 1):
                try:
                    url, response = fetch_batch(batch)
                    break
                except Exception as exc:
                    last_error = exc
                    if attempt == args.retries:
                        raise RuntimeError(f"tree elevation batch {batch_index} failed") from exc
                    delay = args.delay * attempt
                    print(f"batch {batch_index} attempt {attempt} failed: {exc}; retry in {delay:.1f}s")
                    time.sleep(delay)
            else:
                raise RuntimeError(f"unreachable retry state: {last_error}")
            record = {
                "schema_version": 1,
                "retrieved_utc": datetime.now(timezone.utc).isoformat(),
                "request": {
                    "endpoint": ENDPOINT,
                    "trees": [[node_id, lat, lng] for node_id, lat, lng in batch],
                    "url": url,
                },
                "response": response,
            }
            path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
            fetched = True
        values = record["response"]["elevation"]
        for (node_id, lat, lng), elevation in zip(batch, values):
            if elevation is None:
                raise RuntimeError(f"missing elevation for OSM tree node {node_id}")
            rows.append({"osm_node_id": node_id, "lat": lat, "lng": lng, "elevation_m": float(elevation)})
        raw_batches.append(
            {
                "batch": name,
                "tree_count": len(batch),
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            }
        )
        if fetched and start + 100 < len(coords):
            time.sleep(args.delay)

    doc = {
        "schema_version": 1,
        "retrieved_utc": datetime.now(timezone.utc).isoformat(),
        "source": {
            "provider": "Open-Meteo Elevation API",
            "endpoint": ENDPOINT,
            "documentation": "https://open-meteo.com/en/docs/elevation-api",
            "dataset": "Copernicus DEM 2021 GLO-90",
            "resolution_m": 90,
            "dataset_doi": "10.5270/ESA-c5d3d65",
            "vertical_accuracy_m": None,
            "accuracy_note": "API does not provide a per-point vertical accuracy value; 90 m is horizontal DEM resolution, not vertical accuracy.",
        },
        "tree_count": len(rows),
        "points": rows,
        "raw_batches": raw_batches,
    }
    (out / "points.json").write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
    print(f"wrote {len(rows)} tree elevations in {len(raw_batches)} batches to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
