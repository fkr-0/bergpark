#!/usr/bin/env python3
"""Validate the explicit low-level path topology projection."""

from __future__ import annotations

import json
import math
import pathlib
from datetime import datetime, timezone


ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


def haversine(a, b):
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371008.8 * 2 * math.asin(math.sqrt(h))


def main() -> int:
    doc = json.loads((DATA / "path_topology.json").read_text())
    nodes = doc["path_nodes"]
    segments = doc["directed_segments"]
    by_id = {node["id"]: node for node in nodes}
    errors = []
    if len(by_id) != len(nodes):
        errors.append("duplicate path node id")
    segment_ids = [segment["id"] for segment in segments]
    if len(segment_ids) != len(set(segment_ids)):
        errors.append("duplicate directed segment id")
    pairs = [(segment["from"], segment["to"]) for segment in segments]
    if len(pairs) != len(set(pairs)):
        errors.append("duplicate directed path-node pair")

    connector_count = 0
    ambiguous_count = 0
    for segment in segments:
        if segment["from"] not in by_id or segment["to"] not in by_id:
            errors.append(f"missing segment endpoint: {segment['id']}")
            continue
        a, b = by_id[segment["from"]], by_id[segment["to"]]
        if segment["geometry"][0] != [a["lat"], a["lng"]] or segment["geometry"][-1] != [b["lat"], b["lng"]]:
            errors.append(f"geometry endpoint mismatch: {segment['id']}")
        expected_distance = haversine((a["lat"], a["lng"]), (b["lat"], b["lng"]))
        if abs(segment["distance_m"] - expected_distance) > 0.05:
            errors.append(f"distance mismatch: {segment['id']}")
        expected_delta = round(b["elevation_m"] - a["elevation_m"], 1)
        if abs(segment["elevation_delta_m"] - expected_delta) > 0.01:
            errors.append(f"elevation delta mismatch: {segment['id']}")
        if segment["distance_m"] < 90.0:
            if segment.get("terrain_metric_status") != "below_dem_horizontal_resolution":
                errors.append(f"short segment terrain status wrong: {segment['id']}")
            if any(segment.get(key) is not None for key in ("ascent_m", "descent_m", "avg_grade_pct")):
                errors.append(f"short segment publishes unsupported terrain metric: {segment['id']}")
        elif segment.get("terrain_metric_status") != "coarse_glo90_endpoint_estimate":
            errors.append(f"long segment terrain status wrong: {segment['id']}")
        if not segment["route_edge_ids"]:
            errors.append(f"segment has no route context: {segment['id']}")
        if segment["source_kind"] == "representative_point_snap_connector":
            connector_count += 1
            if segment.get("accessibility_status") != "unknown_unmapped_connector":
                errors.append(f"snap connector accessibility guessed: {segment['id']}")
            if any(segment.get(key) is not None for key in ("surface", "steps", "access")):
                errors.append(f"snap connector inherited path attributes: {segment['id']}")
        else:
            if not segment["osm_way_ids"]:
                errors.append(f"OSM adjacency lacks way provenance: {segment['id']}")
        if segment.get("source_ambiguity"):
            ambiguous_count += 1

    segment_id_set = set(segment_ids)
    for node in nodes:
        if not isinstance(node.get("elevation_m"), (int, float)):
            errors.append(f"path node elevation missing: {node['id']}")
        if any(seg_id not in segment_id_set for seg_id in node["next_segment_ids"] + node["previous_segment_ids"]):
            errors.append(f"path node references unknown segment: {node['id']}")

    summary = {
        "path_nodes": len(nodes),
        "directed_segments": len(segments),
        "osm_segments": len(segments) - connector_count,
        "snap_connectors": connector_count,
        "ambiguous_osm_adjacencies": ambiguous_count,
        "segments_with_grade": sum(segment.get("avg_grade_pct") is not None for segment in segments),
        "segments_below_dem_resolution": sum(segment.get("terrain_metric_status") == "below_dem_horizontal_resolution" for segment in segments),
        "errors": len(errors),
    }
    result = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "pass" if not errors else "fail",
        "summary": summary,
        "errors": errors,
        "notes": [
            "This topology covers the already-qualified landmark-route projection, not the complete park path inventory.",
            "GLO-90 per-short-segment grade is coarse; do not interpret it as survey-grade slope.",
        ],
    }
    (DATA / "path_topology_validation.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(summary, ensure_ascii=False))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
