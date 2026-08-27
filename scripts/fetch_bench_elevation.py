#!/usr/bin/env python3
"""Fetch GLO-90 terrain elevation for OSM benches in the Bergpark snapshots."""

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
MAP_DIR = ROOT / "data" / "sources" / "osm-map"
DEFAULT_OUT = ROOT / "data" / "sources" / "bench-elevation"
ENDPOINT = "https://api.open-meteo.com/v1/elevation"


def benches() -> list[tuple[str, float, float]]:
    rows: dict[str, tuple[str, float, float]] = {}
    for path in sorted(MAP_DIR.glob("*.xml")):
        root = ET.parse(path).getroot()
        for node in root.findall("node"):
            tags = {tag.attrib["k"]: tag.attrib["v"] for tag in node.findall("tag")}
            if tags.get("amenity") != "bench":
                continue
            node_id = node.attrib["id"]
            rows[node_id] = (node_id, round(float(node.attrib["lat"]), 7), round(float(node.attrib["lon"]), 7))
    return [rows[node_id] for node_id in sorted(rows, key=int)]


def fetch(batch: list[tuple[str, float, float]]) -> tuple[str, dict]:
    query = urllib.parse.urlencode(
        {
            "latitude": ",".join(f"{lat:.7f}" for _, lat, _ in batch),
            "longitude": ",".join(f"{lng:.7f}" for _, _, lng in batch),
        }
    )
    url = f"{ENDPOINT}?{query}"
    request = urllib.request.Request(url, headers={"User-Agent": "bergpark-graph/0.4 bench-spatial-research"})
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)
    values = payload.get("elevation")
    if not isinstance(values, list) or len(values) != len(batch):
        raise RuntimeError(f"unexpected elevation response for {len(batch)} benches")
    return url, payload


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=pathlib.Path, default=DEFAULT_OUT)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--delay", type=float, default=1.5)
    args = parser.parse_args()
    out = args.output_dir.resolve()
    if out.exists() and any(out.iterdir()) and not (args.force or args.resume):
        raise SystemExit(f"refusing to overwrite non-empty {out}; pass --force or --resume")
    out.mkdir(parents=True, exist_ok=True)
    if args.force:
        for path in list(out.glob("batch-*.json")) + [out / "points.json"]:
            if path.exists():
                path.unlink()

    features = benches()
    if len(features) != 215:
        raise RuntimeError(f"expected 215 benches in preserved map snapshots, got {len(features)}")
    rows = []
    raw_batches = []
    for batch_index, start in enumerate(range(0, len(features), 100)):
        batch = features[start : start + 100]
        name = f"batch-{batch_index:02d}.json"
        path = out / name
        record = None
        if args.resume and path.exists():
            candidate = json.loads(path.read_text())
            expected = [[node_id, lat, lng] for node_id, lat, lng in batch]
            if candidate.get("request", {}).get("benches") == expected:
                record = candidate
                print(f"reused {name}")
        if record is None:
            url, response = fetch(batch)
            record = {
                "schema_version": 1,
                "retrieved_utc": datetime.now(timezone.utc).isoformat(),
                "request": {"endpoint": ENDPOINT, "benches": [[a, b, c] for a, b, c in batch], "url": url},
                "response": response,
            }
            path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
            if start + 100 < len(features):
                time.sleep(args.delay)
        for (node_id, lat, lng), elevation in zip(batch, record["response"]["elevation"]):
            if elevation is None:
                raise RuntimeError(f"missing elevation for bench {node_id}")
            rows.append({"osm_node_id": node_id, "lat": lat, "lng": lng, "elevation_m": float(elevation)})
        raw_batches.append({"batch": name, "bench_count": len(batch), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})

    doc = {
        "schema_version": 1,
        "retrieved_utc": datetime.now(timezone.utc).isoformat(),
        "source": {
            "provider": "Open-Meteo Elevation API",
            "dataset": "Copernicus DEM 2021 GLO-90",
            "resolution_m": 90,
            "vertical_accuracy_m": None,
            "dataset_doi": "10.5270/ESA-c5d3d65",
        },
        "bench_count": len(rows),
        "points": rows,
        "raw_batches": raw_batches,
    }
    (out / "points.json").write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
    print(f"wrote {len(rows)} bench elevations in {len(raw_batches)} batches")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
