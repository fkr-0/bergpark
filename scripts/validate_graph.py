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
COMMONS_AUDIT = ROOT / "data" / "sources" / "commons-geotag-audit.json"
PARK_BBOX = {"south": 51.307, "west": 9.385, "north": 51.323, "east": 9.425}


def load(name: str) -> Any:
    return json.loads((DATA / name).read_text())


def load_curated(name: str) -> Any:
    """Load a curated layer from the build output when present, else canonical data."""
    candidate = DATA / name
    if not candidate.is_file():
        candidate = ROOT / "data" / name
    return json.loads(candidate.read_text())


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
    graph = load("graph.json")
    figures_doc = load_curated("figures.json")
    semantic_doc = load_curated("semantic.json")
    trees_doc = load_curated("trees.json")
    figures = figures_doc.get("figures", [])
    artworks = semantic_doc.get("artworks", [])
    collections = semantic_doc.get("collections", [])
    semantic_edges = semantic_doc.get("semantic_edges", [])
    semantic_sources = semantic_doc.get("sources", [])
    trees = trees_doc.get("trees", [])
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

    missing_elevations = [n["id"] for n in nodes if not isinstance(n.get("elevation_m"), (int, float))]
    checks.append({"id": "place_elevations_present", "pass": not missing_elevations, "failures": missing_elevations})
    errors.extend(f"missing place elevation: {x}" for x in missing_elevations)

    commons_doc = json.loads(COMMONS_AUDIT.read_text()) if COMMONS_AUDIT.is_file() else {"rows": []}
    commons_rows = {row.get("place_id"): row for row in commons_doc.get("rows", [])}
    commons_failures = []
    for node_id in sorted(node_ids):
        row = commons_rows.get(node_id)
        nearest = row.get("nearest") if row else None
        if not row or not nearest or nearest.get("distance_m", 999999) > 150:
            commons_failures.append(node_id)
    checks.append({"id": "commons_nearby_geotag_crosscheck", "pass": not commons_failures, "failures": commons_failures})
    errors.extend(f"missing nearby Commons geotag cross-check: {x}" for x in commons_failures)

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
    bad_elevation_edges = []
    bad_surface_segments = []
    for e in edges:
        a, b = by_id[e["from"]], by_id[e["to"]]
        straight = haversine((a["lat"], a["lng"]), (b["lat"], b["lng"]))
        if e["distance_m"] + 2 < straight:
            implausible.append({"edge": e["id"], "distance_m": e["distance_m"], "straight_m": round(straight, 1)})
        if e["distance_m"] > max(2500, straight * 5 + 250):
            warnings.append(f"route detour merits Phase-2 review: {e['id']} ({e['distance_m']} m vs {straight:.1f} m straight)")
        expected_delta = round(b["elevation_m"] - a["elevation_m"], 1)
        if abs(e.get("elevation_delta_m", 99999) - expected_delta) > 0.11:
            bad_elevation_edges.append(e["id"])
        profile = e.get("elevation_profile_m", [])
        if len(profile) != len(e.get("path_coordinates", [])) or not profile:
            bad_elevation_edges.append(e["id"])
        if e.get("elevation_metric_sampling_m") != 90 or e.get("elevation_metric_sample_count", 0) < 2:
            bad_elevation_edges.append(e["id"])
        segments = e.get("surface_segments", [])
        required_segment_keys = {"access", "foot", "handrail", "osm_way_direction", "osm_incline", "route_incline"}
        if not segments or any(not required_segment_keys <= set(segment) for segment in segments):
            bad_surface_segments.append(e["id"])
        segment_distance = sum(s.get("distance_m", 0) for s in segments)
        snap_distance = e.get("snap_distance_m", {}).get("from", 0) + e.get("snap_distance_m", {}).get("to", 0)
        if not segments or abs((segment_distance + snap_distance) - e["distance_m"]) > 3.0:
            bad_surface_segments.append(e["id"])
        if e.get("accessibility") in {"stairs_only", "potentially_step_free"}:
            bad_surface_segments.append(e["id"])
        snap_total = e.get("snap_distance_m", {}).get("from", 0) + e.get("snap_distance_m", {}).get("to", 0)
        if (
            e.get("mapped_path_accessibility") == "potentially_step_free_mapped_path"
            and snap_total > 2.0
            and (e.get("accessibility") != "endpoint_access_unknown" or not e.get("endpoint_access_unknown"))
        ):
            bad_surface_segments.append(e["id"])
    checks.append({"id": "edge_distances_not_shorter_than_geodesic", "pass": not implausible, "failures": implausible})
    errors.extend(f"implausibly short routed edge: {x['edge']}" for x in implausible)
    bad_elevation_edges = sorted(set(bad_elevation_edges))
    checks.append({"id": "edge_elevation_profiles_consistent", "pass": not bad_elevation_edges, "failures": bad_elevation_edges})
    errors.extend(f"invalid elevation profile: {x}" for x in bad_elevation_edges)
    bad_surface_segments = sorted(set(bad_surface_segments))
    checks.append({"id": "surface_segments_cover_routed_network", "pass": not bad_surface_segments, "failures": bad_surface_segments})
    errors.extend(f"invalid surface segmentation: {x}" for x in bad_surface_segments)

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

    pair_map = {(e["from"], e["to"]): e for e in edges}
    reverse_metric_errors = []
    for e in edges:
        reverse = pair_map.get((e["to"], e["from"]))
        if not reverse:
            continue
        if abs(e["elevation_delta_m"] + reverse["elevation_delta_m"]) > 0.11:
            reverse_metric_errors.append(e["id"])
        if abs(e["ascent_m"] - reverse["descent_m"]) > 0.11 or abs(e["descent_m"] - reverse["ascent_m"]) > 0.11:
            reverse_metric_errors.append(e["id"])
        forward_way_ids = [segment.get("osm_way_id") for segment in e.get("surface_segments", [])]
        reverse_way_ids = [segment.get("osm_way_id") for segment in reverse.get("surface_segments", [])]
        if forward_way_ids != list(reversed(reverse_way_ids)):
            reverse_metric_errors.append(e["id"])
    reverse_metric_errors = sorted(set(reverse_metric_errors))
    checks.append({"id": "reverse_elevation_metrics_consistent", "pass": not reverse_metric_errors, "failures": reverse_metric_errors})
    errors.extend(f"reverse elevation metrics inconsistent: {x}" for x in reverse_metric_errors)

    audit = manifest.get("watercourse_reference_audit", {})
    audit_ok = (
        audit.get("source", {}).get("published_reference", {}).get("visitor_route_distance_m") == 2300
        and isinstance(audit.get("graph_dem_context", {}).get("herkules_to_schloss_endpoint_drop_m"), (int, float))
        and "do not force" in audit.get("purpose", "")
    )
    checks.append({"id": "watercourse_reference_audit_present", "pass": audit_ok, "failures": [] if audit_ok else ["missing audit"]})
    if not audit_ok:
        errors.append("watercourse reference audit missing")

    semantic_source_ids = [source.get("id") for source in semantic_sources]
    duplicate_source_ids = sorted({sid for sid in semantic_source_ids if sid and semantic_source_ids.count(sid) > 1})
    bad_sources = [
        source.get("id", "<missing-id>")
        for source in semantic_sources
        if not source.get("id") or not source.get("publisher") or not source.get("url")
    ]
    source_failures = duplicate_source_ids + bad_sources
    checks.append({"id": "semantic_sources_valid", "pass": not source_failures, "failures": source_failures})
    errors.extend(f"invalid semantic source: {x}" for x in source_failures)
    source_id_set = {sid for sid in semantic_source_ids if sid}

    entity_groups = {
        "place": nodes,
        "tree": trees,
        "historical_figure": figures,
        "artwork": artworks,
        "collection": collections,
    }
    entity_rows = [(kind, row) for kind, rows in entity_groups.items() for row in rows]
    entity_ids = [row.get("id") for _, row in entity_rows]
    duplicate_entity_ids = sorted({eid for eid in entity_ids if eid and entity_ids.count(eid) > 1})
    missing_entity_ids = [kind for kind, row in entity_rows if not row.get("id")]
    entity_failures = duplicate_entity_ids + [f"missing-id:{kind}" for kind in missing_entity_ids]
    checks.append({"id": "semantic_entity_ids_unique", "pass": not entity_failures, "failures": entity_failures})
    errors.extend(f"invalid semantic entity id: {x}" for x in entity_failures)
    entity_id_set = {eid for eid in entity_ids if eid}

    bad_entity_sources = []
    for kind, row in entity_rows:
        if kind in {"place", "tree"}:
            continue
        refs = row.get("source_ids", [])
        if not refs or any(ref not in source_id_set for ref in refs):
            bad_entity_sources.append(row.get("id", f"<missing-{kind}-id>"))
    checks.append({"id": "semantic_entities_have_sources", "pass": not bad_entity_sources, "failures": bad_entity_sources})
    errors.extend(f"semantic entity source unresolved: {x}" for x in bad_entity_sources)

    edge_ids = [edge.get("id") for edge in semantic_edges]
    duplicate_semantic_edge_ids = sorted({eid for eid in edge_ids if eid and edge_ids.count(eid) > 1})
    edge_keys = [(edge.get("from"), edge.get("relation"), edge.get("to")) for edge in semantic_edges]
    duplicate_semantic_relations = sorted({key for key in edge_keys if edge_keys.count(key) > 1})
    bad_semantic_edges = []
    allowed_confidence = {"high", "medium", "low"}
    for edge in semantic_edges:
        refs = edge.get("source_ids", [])
        provenance = edge.get("provenance", {})
        if (
            not edge.get("id")
            or edge.get("from") not in entity_id_set
            or edge.get("to") not in entity_id_set
            or edge.get("from") == edge.get("to")
            or not edge.get("relation")
            or edge.get("confidence") not in allowed_confidence
            or not refs
            or any(ref not in source_id_set for ref in refs)
            or not provenance.get("basis")
            or not provenance.get("assertion")
            or not provenance.get("qualification")
        ):
            bad_semantic_edges.append(edge.get("id", "<missing-id>"))
    semantic_edge_failures = (
        duplicate_semantic_edge_ids
        + [f"duplicate:{a}|{r}|{b}" for a, r, b in duplicate_semantic_relations]
        + bad_semantic_edges
    )
    checks.append({"id": "semantic_relations_valid", "pass": not semantic_edge_failures, "failures": semantic_edge_failures})
    errors.extend(f"invalid semantic relation: {x}" for x in semantic_edge_failures)

    required_relations = {
        ("person-landgraf-karl-von-hessen-kassel", "commissioned", "herkules"),
        ("person-giovanni-francesco-guerniero", "lead_designer_of", "herkules"),
        ("person-giovanni-francesco-guerniero", "lead_designer_of", "kaskaden"),
        ("person-heinrich-christoph-jussow", "designed", "loewenburg"),
        ("person-heinrich-christoph-jussow", "designed", "aquaedukt"),
        ("person-heinrich-christoph-jussow", "planned_landscape_setting_for", "teufelsbruecke"),
        ("person-rembrandt-van-rijn", "created", "artwork-der-segen-jakobs"),
        ("artwork-der-segen-jakobs", "member_of_collection", "collection-gemaeldegalerie-alte-meister"),
        ("collection-gemaeldegalerie-alte-meister", "located_at", "schloss"),
    }
    missing_required_relations = sorted(required_relations - set(edge_keys))
    checks.append({"id": "phase3_required_relations_present", "pass": not missing_required_relations, "failures": missing_required_relations})
    errors.extend(f"missing required Phase-3 relation: {a}|{r}|{b}" for a, r, b in missing_required_relations)

    creator_errors = [
        artwork.get("id")
        for artwork in artworks
        if artwork.get("creator_id") not in entity_id_set
    ]
    collection_location_errors = [
        collection.get("id")
        for collection in collections
        if collection.get("current_place_id") not in node_ids
    ]
    artwork_entity_failures = creator_errors + collection_location_errors
    checks.append({"id": "artworks_and_collections_are_entities", "pass": not artwork_entity_failures, "failures": artwork_entity_failures})
    errors.extend(f"invalid artwork/collection entity: {x}" for x in artwork_entity_failures)

    composition_failures = []
    expected_graph_layers = {
        "trees": {row["id"] for row in trees},
        "figures": {row["id"] for row in figures},
        "artworks": {row["id"] for row in artworks},
        "collections": {row["id"] for row in collections},
        "semantic_edges": {row["id"] for row in semantic_edges},
    }
    for key, expected_ids in expected_graph_layers.items():
        actual_ids = {row.get("id") for row in graph.get(key, [])}
        if actual_ids != expected_ids:
            composition_failures.append(key)
    if graph.get("provenance", {}).get("semantic_source_registry") != "data/semantic.json#sources":
        composition_failures.append("semantic_source_registry")
    checks.append({"id": "graph_composes_curated_layers", "pass": not composition_failures, "failures": composition_failures})
    errors.extend(f"graph layer composition mismatch: {x}" for x in composition_failures)

    spatial_composition_failures = []
    if graph.get("nodes") != nodes:
        spatial_composition_failures.append("nodes")
    if graph.get("edges") != edges:
        spatial_composition_failures.append("edges")
    checks.append(
        {
            "id": "graph_preserves_canonical_phase2_spatial_layers",
            "pass": not spatial_composition_failures,
            "failures": spatial_composition_failures,
        }
    )
    errors.extend(
        f"graph Phase-2 spatial layer mismatch: {x}" for x in spatial_composition_failures
    )

    status = "pass" if not errors else "fail"
    out = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": status,
        "summary": {
            "place_nodes": len(nodes),
            "directed_path_edges": len(edges),
            "catalogued_trees": len(trees),
            "historical_figures": len(figures),
            "artworks": len(artworks),
            "collections": len(collections),
            "semantic_relations": len(semantic_edges),
            "semantic_sources": len(semantic_sources),
            "errors": len(errors),
            "warnings": len(warnings),
        },
        "bbox": PARK_BBOX,
        "checks": checks,
        "errors": errors,
        "warnings": warnings,
        "phase_2_known_limits": [
            "Elevation profiles use the 90 m Copernicus GLO-90 DEM and are approximate; they are not survey-grade measurements.",
            "Surface/accessibility fields are OSM-tag-derived and are not a substitute for field inspection.",
            "Naismith-style walking times use 5 km/h plus 1 minute per 10 m ascent and do not model individual mobility.",
            "The supplied seed bbox was rejected because it excludes Herkules; see source_manifest.json.",
        ],
        "phase_3_known_limits": [
            "Historical authorship/patronage edges encode only the scope explicitly supported by their cited sources; later restoration or replacement phases are not silently folded into earlier design relations.",
            "Phase-2 place nodes expose coordinate source/method/confidence and GLO-90 terrain elevation, but numeric horizontal/vertical accuracy fields are not yet normalized across every mapped entity.",
            "Explicit sampled path topology is now durable as a standalone layer in data/path_topology.json (intersections/turns and material gradient/surface/access changes), but Phase 3 does not compose that layer into graph.json yet.",
            "Bench POIs are now durable as a standalone first-class layer in data/benches.json; Phase 3 does not compose benches into graph.json yet.",
        ],
    }
    (DATA / "validation.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(out["summary"], ensure_ascii=False))
    return 0 if status == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())

