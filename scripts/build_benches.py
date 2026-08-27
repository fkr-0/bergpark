#!/usr/bin/env python3
"""Export OSM benches as first-class spatial POIs."""

from __future__ import annotations

import json
import os
import pathlib
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any


ROOT = pathlib.Path(__file__).resolve().parents[1]
CANONICAL_DATA = ROOT / "data"
DATA = pathlib.Path(os.environ.get("BERGPARK_OUTPUT_DATA", str(CANONICAL_DATA))).resolve()
MAP_DIR = CANONICAL_DATA / "sources" / "osm-map"
ELEVATION = CANONICAL_DATA / "sources" / "bench-elevation" / "points.json"


def source_benches() -> dict[str, dict[str, Any]]:
    rows = {}
    for path in sorted(MAP_DIR.glob("*.xml")):
        root = ET.parse(path).getroot()
        for node in root.findall("node"):
            tags = {tag.attrib["k"]: tag.attrib["v"] for tag in node.findall("tag")}
            if tags.get("amenity") != "bench":
                continue
            node_id = node.attrib["id"]
            rows[node_id] = {
                "id": node_id,
                "lat": round(float(node.attrib["lat"]), 7),
                "lng": round(float(node.attrib["lon"]), 7),
                "version": node.attrib.get("version"),
                "timestamp": node.attrib.get("timestamp"),
                "snapshot": f"data/sources/osm-map/{path.name}",
                "tags": tags,
            }
    if len(rows) != 215:
        raise RuntimeError(f"expected 215 benches, got {len(rows)}")
    return rows


def elevation_lookup() -> tuple[dict[str, float], dict[str, Any], str | None]:
    doc = json.loads(ELEVATION.read_text())
    points = {str(row["osm_node_id"]): float(row["elevation_m"]) for row in doc["points"]}
    if len(points) != 215:
        raise RuntimeError(f"expected 215 bench elevations, got {len(points)}")
    return points, doc.get("source", {}), doc.get("retrieved_utc")


def parse_int(value: str | None) -> int | None:
    try:
        return int(value) if value is not None else None
    except ValueError:
        return None


def main() -> int:
    source = source_benches()
    elevations, elevation_source, elevation_retrieved_at = elevation_lookup()
    benches = []
    for node_id in sorted(source, key=int):
        node = source[node_id]
        tags = node["tags"]
        benches.append(
            {
                "id": f"bench-{node_id}",
                "kind": "bench",
                "osm_node_id": node_id,
                "lat": node["lat"],
                "lng": node["lng"],
                "elevation_m": elevations[node_id],
                "position_source": {
                    "provider": "OpenStreetMap",
                    "element": f"node/{node_id}",
                    "snapshot": node["snapshot"],
                    "source_version": node.get("version"),
                    "source_timestamp": node.get("timestamp"),
                    "retrieved_at": None,
                    "retrieval_status": "source_retrieval_time_not_preserved_separately",
                    "method": "source_node",
                    "position_type": "source_point",
                    "license": "ODbL-1.0",
                    "horizontal_accuracy_m": None,
                    "accuracy_status": "not_reported_by_source",
                },
                "elevation_source": {
                    "provider": "Open-Meteo Elevation API",
                    "dataset": "Copernicus DEM 2021 GLO-90",
                    "resolution_m": 90,
                    "vertical_accuracy_m": None,
                    "accuracy_status": "not_reported_in_project_source",
                    "snapshot": "data/sources/bench-elevation/points.json",
                    "retrieved_at": elevation_retrieved_at,
                },
                "height_m": None,
                "height_status": "unknown_no_measurement_source",
                "height_source": None,
                "name": tags.get("name"),
                "description": tags.get("description"),
                "backrest": tags.get("backrest"),
                "armrest": tags.get("armrest"),
                "seats": parse_int(tags.get("seats")),
                "material": tags.get("material"),
                "colour": tags.get("colour"),
                "direction_deg": tags.get("direction"),
                "access": tags.get("access"),
                "covered": tags.get("covered"),
                "inscription": tags.get("inscription"),
                "image": tags.get("image"),
                "check_date": tags.get("check_date"),
                "source_refs": [
                    node["snapshot"],
                    f"https://www.openstreetmap.org/node/{node_id}",
                    "data/sources/bench-elevation/points.json",
                ],
            }
        )

    doc = {
        "schema_version": 1,
        "generated_at": elevation_retrieved_at,
        "status": "osm_snapshot_complete",
        "bench_count": len(benches),
        "benches": benches,
        "provenance": {
            "osm_snapshots": "data/sources/osm-map/*.xml",
            "elevation": "data/sources/bench-elevation/points.json",
            "elevation_dataset": elevation_source.get("dataset"),
            "elevation_retrieved_at": elevation_retrieved_at,
            "osm_retrieval_status": "source timestamps preserved per node; fetch time not preserved separately",
            "osm_license": "ODbL-1.0",
        },
        "quality": {
            "stable_id_rule": "bench-<osm-node-id>",
            "coverage_note": "Contains benches present in the four preserved Bergpark OSM map snapshots; absence is not proof that no physical bench exists.",
            "position_accuracy_policy": "OSM mapped positions are retained without inventing a horizontal accuracy value.",
        },
    }
    (DATA / "benches.json").write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
    print(f"wrote {len(benches)} first-class bench POIs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
