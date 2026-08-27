#!/usr/bin/env python3
"""Validate graph integrity and emit data/validation.json."""

from __future__ import annotations

import json
import math
import os
import pathlib
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Any


ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = pathlib.Path(os.environ.get("BERGPARK_OUTPUT_DATA", str(ROOT / "data"))).resolve()
PARK_BBOX = {"south": 51.307, "west": 9.385, "north": 51.323, "east": 9.425}


def load(name: str) -> Any:
    return json.loads((DATA / name).read_text())


def haversine(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371008.8 * 2 * math.asin(math.sqrt(h))


def main() -> int:
    nodes = load("nodes.json")["nodes"]
    edges = load("edges.json")["edges"]
    node_ids = {n["id"] for n in nodes}
    checks = []
    errors = []
    warnings = []

    bad_coords = [
        n["id"]
        for n in nodes
        if not (
            PARK_BBOX["south"] <= n["lat"] <= PARK_BBOX["north"]
            and PARK_BBOX["west"] <= n["lng"] <= PARK_BBOX["east"]
        )
    ]
    checks.append({"id": "place_coordinates_in_research_bbox", "pass": not bad_coords, "failures": bad_coords})
    errors.extend(f"coordinate outside research bbox: {x}" for x in bad_coords)

    missing_refs = sorted({x for e in edges for x in (e["from"], e["to"]) if x not in node_ids})
    checks.append({"id": "edge_references_exist", "pass": not missing_refs, "failures": missing_refs})
    errors.extend(f"missing edge node: {x}" for x in missing_refs)

    keys = [(e["from"], e["to"]) for e in edges]
    duplicates = sorted({k for k in keys if keys.count(k) > 1})
    checks.append({"id": "no_duplicate_directed_edges", "pass": not duplicates, "failures": duplicates})
    errors.extend(f"duplicate directed edge: {a}->{b}" for a, b in duplicates)

    reverse_missing = sorted((a, b) for a, b in keys if (b, a) not in keys)
    checks.append({"id": "bidirectional_edges", "pass": not reverse_missing, "failures": reverse_missing})
    errors.extend(f"missing reverse edge: {a}->{b}" for a, b in reverse_missing)

    adjacency: dict[str, set[str]] = defaultdict(set)
    for e in edges:
        adjacency[e["from"]].add(e["to"])
    reached = set()
    if nodes:
        q = deque([nodes[0]["id"]])
        reached.add(nodes[0]["id"])
        while q:
            for nxt in adjacency[q.popleft()]:
                if nxt not in reached:
                    reached.add(nxt)
                    q.append(nxt)
    unreachable = sorted(node_ids - reached)
    checks.append({"id": "place_graph_connected", "pass": not unreachable, "failures": unreachable})
    errors.extend(f"unreachable place: {x}" for x in unreachable)

    by_id = {n["id"]: n for n in nodes}
    implausible = []
    for e in edges:
        a, b = by_id[e["from"]], by_id[e["to"]]
        straight = haversine((a["lat"], a["lng"]), (b["lat"], b["lng"]))
        if e["distance_m"] + 2 < straight:
            implausible.append({"edge": e["id"], "distance_m": e["distance_m"], "straight_m": round(straight, 1)})
        if e["distance_m"] > max(2500, straight * 5 + 250):
            warnings.append(f"route detour merits Phase-2 review: {e['id']} ({e['distance_m']} m vs {straight:.1f} m straight)")
    checks.append({"id": "edge_distances_not_shorter_than_geodesic", "pass": not implausible, "failures": implausible})
    errors.extend(f"implausibly short routed edge: {x['edge']}" for x in implausible)

    bad_polylines = []
    for e in edges:
        coords = e.get("path_coordinates", [])
        if len(coords) < 2:
            bad_polylines.append(e["id"])
            continue
        a, b = by_id[e["from"]], by_id[e["to"]]
        if haversine(tuple(coords[0]), (a["lat"], a["lng"])) > 2 or haversine(tuple(coords[-1]), (b["lat"], b["lng"])) > 2:
            bad_polylines.append(e["id"])
    checks.append({"id": "path_polylines_anchor_to_places", "pass": not bad_polylines, "failures": bad_polylines})
    errors.extend(f"polyline does not anchor to place: {x}" for x in bad_polylines)

    manifest = load("source_manifest.json")
    snap_warnings = {k: v for k, v in manifest["routing_snap_m"].items() if v > 75}
    if snap_warnings:
        warnings.append(f"{len(snap_warnings)} place(s) snap >75 m to routable OSM path; Phase 2 should inspect them")

    status = "pass" if not errors else "fail"
    out = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": status,
        "summary": {
            "place_nodes": len(nodes),
            "directed_path_edges": len(edges),
            "errors": len(errors),
            "warnings": len(warnings),
        },
        "bbox": PARK_BBOX,
        "checks": checks,
        "errors": errors,
        "warnings": warnings,
        "phase_1_known_gaps": [
            "Elevation is intentionally null until Phase 2 terrain enrichment.",
            "Surface classification is OSM-tag-derived and requires Phase 2 route-by-route review.",
            "Semantic/figure and tree layers are placeholders until Phases 3 and 4.",
            "The supplied seed bbox was rejected because it excludes Herkules; see source_manifest.json.",
        ],
    }
    (DATA / "validation.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(out["summary"], ensure_ascii=False))
    return 0 if status == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())

