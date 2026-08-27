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

try:
    from .compose_graph import assert_graph_inputs_current
    from .provenance_contract import validate_metric_profile, validate_spatial_entity
    from .validate_path_routing import validate_documents as validate_path_routing_documents
    from .validate_visitor_pois import validate_document as validate_visitor_poi_document
except ImportError:  # Direct `python scripts/validate_graph.py` execution.
    from compose_graph import assert_graph_inputs_current
    from provenance_contract import validate_metric_profile, validate_spatial_entity
    from validate_path_routing import validate_documents as validate_path_routing_documents
    from validate_visitor_pois import validate_document as validate_visitor_poi_document


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


def valid_optional_accuracy(value: Any) -> bool:
    return value is None or (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and value >= 0
    )


def main() -> int:
    nodes = load("nodes.json")["nodes"]
    edges = load("edges.json")["edges"]
    graph = load("graph.json")
    figures_doc = load_curated("figures.json")
    semantic_doc = load_curated("semantic.json")
    trees_doc = load_curated("trees.json")
    benches_doc = load_curated("benches.json")
    path_topology_doc = load_curated("path_topology.json")
    visitor_pois_doc = load_curated("visitor_pois.json")
    figures = figures_doc.get("figures", [])
    artworks = semantic_doc.get("artworks", [])
    collections = semantic_doc.get("collections", [])
    semantic_edges = semantic_doc.get("semantic_edges", [])
    semantic_sources = semantic_doc.get("sources", [])
    trees = trees_doc.get("trees", [])
    benches = benches_doc.get("benches", [])
    path_nodes = path_topology_doc.get("path_nodes", [])
    path_segments = path_topology_doc.get("directed_segments", [])
    visitor_pois = visitor_pois_doc.get("pois", [])
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

    position_contract_failures = []
    representative_failures = []
    allowed_methods = {
        "source_node": ("source_point", "not_reported_by_source"),
        "source_centroid": ("representative_point", "derived_representative_point"),
        "bounds_midpoint": ("representative_point", "derived_representative_point"),
        "geometry_mean": ("representative_point", "derived_representative_point"),
    }
    legacy_method_map = {
        "osm_node": "source_node",
        "osm_center": "source_centroid",
        "osm_bounds_midpoint": "bounds_midpoint",
        "osm_geometry_mean": "geometry_mean",
    }
    for node in nodes:
        position = node.get("position_source")
        elevation = node.get("elevation_source")
        legacy = node.get("coordinate_source")
        if not isinstance(position, dict) or not isinstance(elevation, dict) or not isinstance(legacy, dict):
            position_contract_failures.append(node["id"])
            continue
        method = position.get("method")
        expected = allowed_methods.get(method)
        if (
            not expected
            or not position.get("provider")
            or not position.get("element")
            or not position.get("snapshot")
            or position.get("position_type") != expected[0]
            or position.get("accuracy_status") != expected[1]
            or "horizontal_accuracy_m" not in position
            or not valid_optional_accuracy(position.get("horizontal_accuracy_m"))
            or legacy.get("provider") != position.get("provider")
            or legacy.get("element") != position.get("element")
            or legacy_method_map.get(node.get("coordinate_method")) != method
            or not node.get("coordinate_confidence")
            or "vertical_accuracy_m" not in elevation
            or not valid_optional_accuracy(elevation.get("vertical_accuracy_m"))
            or not elevation.get("accuracy_status")
            or (
                node.get("height_m") is None
                and (
                    node.get("height_status") != "unknown_no_measurement_source"
                    or node.get("height_source") is not None
                )
            )
            or (
                node.get("height_m") is not None
                and (
                    not isinstance(node.get("height_m"), (int, float))
                    or isinstance(node.get("height_m"), bool)
                    or not isinstance(node.get("height_source"), dict)
                )
            )
        ):
            position_contract_failures.append(node["id"])
        if method in {"source_centroid", "bounds_midpoint", "geometry_mean"} and (
            position.get("position_type") != "representative_point"
            or position.get("accuracy_status") != "derived_representative_point"
        ):
            representative_failures.append(node["id"])
    checks.append(
        {
            "id": "place_position_provenance_normalized",
            "pass": not position_contract_failures,
            "failures": sorted(set(position_contract_failures)),
        }
    )
    errors.extend(
        f"invalid normalized place position/elevation provenance: {x}"
        for x in sorted(set(position_contract_failures))
    )
    checks.append(
        {
            "id": "representative_place_positions_qualified",
            "pass": not representative_failures,
            "failures": sorted(set(representative_failures)),
        }
    )
    errors.extend(
        f"representative place position not explicitly qualified: {x}"
        for x in sorted(set(representative_failures))
    )

    phase7_spatial_failures = []
    for label, rows in (
        ("place", nodes),
        ("tree", trees),
        ("bench", benches),
        ("path_node", path_nodes),
        ("visitor_poi", visitor_pois),
    ):
        for row in rows:
            phase7_spatial_failures.extend(
                validate_spatial_entity(row, label=f"{label}:{row.get('id', '<missing-id>')}")
            )
    checks.append(
        {
            "id": "phase7_common_spatial_provenance",
            "pass": not phase7_spatial_failures,
            "failures": phase7_spatial_failures[:50],
        }
    )
    errors.extend(f"Phase-7 spatial provenance: {failure}" for failure in phase7_spatial_failures)

    edge_doc = load("edges.json")
    routing_checks, routing_errors, routing_warnings, routing_summary = (
        validate_path_routing_documents(path_topology_doc, edge_doc)
    )
    checks.append(
        {
            "id": "phase8_multi_hop_routing_foundation_valid",
            "pass": not routing_errors,
            "failures": routing_errors[:50],
            "subchecks": routing_checks,
            "summary": routing_summary,
        }
    )
    errors.extend(f"Phase-8 routing: {failure}" for failure in routing_errors)
    warnings.extend(f"Phase-8 routing: {warning}" for warning in routing_warnings)
    edge_metric_failures = validate_metric_profile(
        edge_doc.get("derived_metric_profile"),
        label="data/edges.json",
        required_metrics=(
            "distance_m", "elevation_delta_m", "ascent_m", "descent_m", "avg_grade_pct",
            "walking_min", "surface", "mapped_path_accessibility", "endpoint_snap_total_m", "accessibility",
        ),
    )
    path_metric_failures = validate_metric_profile(
        path_topology_doc.get("derived_metric_profile"),
        label="data/path_topology.json",
        required_metrics=(
            "distance_m", "elevation_delta_m", "ascent_m", "descent_m", "avg_grade_pct",
            "surface", "access", "accessibility_status",
        ),
    )
    phase7_metric_failures = edge_metric_failures + path_metric_failures
    checks.append(
        {
            "id": "phase7_derived_metric_provenance",
            "pass": not phase7_metric_failures,
            "failures": phase7_metric_failures[:50],
        }
    )
    errors.extend(f"Phase-7 derived metric provenance: {failure}" for failure in phase7_metric_failures)

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

    visitor_poi_checks, visitor_poi_errors = validate_visitor_poi_document(visitor_pois_doc)
    visitor_poi_valid = not visitor_poi_errors
    checks.append(
        {
            "id": "visitor_poi_layer_valid",
            "pass": visitor_poi_valid,
            "failures": visitor_poi_errors,
            "subchecks": visitor_poi_checks,
        }
    )
    errors.extend(f"invalid visitor POI layer: {failure}" for failure in visitor_poi_errors)

    entity_groups = {
        "place": nodes,
        "tree": trees,
        "bench": benches,
        "path_node": path_nodes,
        "visitor_poi": visitor_pois,
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
        if kind in {"place", "tree", "bench", "path_node", "visitor_poi"}:
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

    path_topology_failures = []
    path_node_ids = {row.get("id") for row in path_nodes}
    path_segment_ids = [row.get("id") for row in path_segments]
    if len(path_segment_ids) != len(set(path_segment_ids)):
        path_topology_failures.append("duplicate_path_segment_ids")
    for segment in path_segments:
        if segment.get("from") not in path_node_ids or segment.get("to") not in path_node_ids:
            path_topology_failures.append(segment.get("id", "<missing-segment-id>"))
    path_segment_id_set = {segment_id for segment_id in path_segment_ids if segment_id}
    for path_node in path_nodes:
        refs = path_node.get("next_segment_ids", []) + path_node.get("previous_segment_ids", [])
        if any(ref not in path_segment_id_set for ref in refs):
            path_topology_failures.append(path_node.get("id", "<missing-path-node-id>"))
    path_topology_failures = sorted(set(path_topology_failures))
    checks.append(
        {
            "id": "composed_path_topology_references_valid",
            "pass": not path_topology_failures,
            "failures": path_topology_failures,
        }
    )
    errors.extend(f"invalid composed path topology: {x}" for x in path_topology_failures)

    composition_failures = []
    expected_graph_layers = {
        "trees": trees,
        "benches": benches,
        "path_nodes": path_nodes,
        "path_segments": path_segments,
        "visitor_pois": visitor_pois,
        "figures": figures,
        "artworks": artworks,
        "collections": collections,
        "semantic_edges": semantic_edges,
    }
    for key, expected_rows in expected_graph_layers.items():
        if graph.get(key) != expected_rows:
            composition_failures.append(key)
    provenance = graph.get("provenance", {})
    if provenance.get("semantic_source_registry") != "data/semantic.json#sources":
        composition_failures.append("semantic_source_registry")
    if provenance.get("bench_layer") != "data/benches.json":
        composition_failures.append("bench_layer_provenance")
    if provenance.get("path_topology_layer") != "data/path_topology.json":
        composition_failures.append("path_topology_provenance")
    if provenance.get("visitor_poi_layer") != "data/visitor_pois.json":
        composition_failures.append("visitor_poi_layer_provenance")
    if provenance.get("visitor_poi_scope") != visitor_pois_doc.get("status"):
        composition_failures.append("visitor_poi_scope_provenance")
    checks.append(
        {
            "id": "graph_composes_independent_layers_exactly",
            "pass": not composition_failures,
            "failures": composition_failures,
        }
    )
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

    composition_hash_failures = []
    try:
        assert_graph_inputs_current(graph, DATA)
    except (FileNotFoundError, TypeError, ValueError, json.JSONDecodeError) as exc:
        composition_hash_failures.append(str(exc))
    checks.append(
        {
            "id": "graph_composition_input_hashes_current",
            "pass": not composition_hash_failures,
            "failures": composition_hash_failures,
        }
    )
    errors.extend(f"stale or incompatible graph composition: {x}" for x in composition_hash_failures)

    status = "pass" if not errors else "fail"
    out = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": status,
        "summary": {
            "place_nodes": len(nodes),
            "directed_path_edges": len(edges),
            "catalogued_trees": len(trees),
            "benches": len(benches),
            "path_nodes": len(path_nodes),
            "directed_path_segments": len(path_segments),
            "visitor_pois": len(visitor_pois),
            "visitor_poi_families": visitor_pois_doc.get("family_counts", {}),
            "historical_figures": len(figures),
            "artworks": len(artworks),
            "collections": len(collections),
            "semantic_relations": len(semantic_edges),
            "semantic_sources": len(semantic_sources),
            "routing_phase2_routes_checked": routing_summary["phase2_routes_checked"],
            "routing_disconnected_components_checked": routing_summary[
                "disconnected_components_checked"
            ],
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
        ],
        "phase_4_known_limits": [
            "At the Phase-4 boundary the composed path topology was the qualified landmark-route projection; Phase 8 expands that same standalone layer without changing the 122 Phase-2 route rows.",
            "Bench and path-topology rows are composed exactly from their independently owned layers; composition does not upgrade source-reported accuracy or accessibility certainty.",
        ],
        "phase_5_known_limits": [
            "Place position_source accuracy is explicit but remains numerically unknown where OpenStreetMap does not report a defensible horizontal accuracy; null is intentional, not zero.",
            "Bounds/center/geometry-derived place coordinates are representative points for display/indexing, not surveyed entrances or exact object positions.",
            "GLO-90 terrain elevation remains approximate and vertical_accuracy_m is null because the preserved project source does not provide a defensible per-place vertical accuracy; terrain elevation is never treated as physical object height.",
        ],
        "phase_6_known_limits": [
            "Visitor POIs are a source-grounded tranche from preserved OSM map snapshots, not a claim of complete physical inventory; absence from the snapshot is not evidence of absence in the park.",
            "Wheelchair, access, foot, entrance and barrier facts are source-tag evidence only; missing tags remain unknown and are never upgraded to positive accessibility claims.",
            "Transit platform ways use explicitly representative bounds-midpoint coordinates and are not treated as visitor entrances.",
            "The current web runtime does not selectively load the standalone visitor_pois.json layer; Phase 6 composes it additively into graph.json without changing loader/cache/API behavior.",
        ],
        "phase_7_known_limits": [
            "OpenStreetMap source timestamps are preserved where present, but fetch/retrieval time remains null where the repository did not preserve it; no timestamp is inferred from filesystem metadata.",
            "Horizontal and vertical accuracy remain null when the preserved source does not report defensible numeric accuracy; null is not zero and is never described as exact.",
            "Derived route/path metrics are qualified by document-level machine-readable profiles; source-backed Phase-2 route rows remain unchanged.",
            "Short path segments below 90 m retain endpoint terrain delta but suppress ascent/descent/grade because GLO-90 cannot support those metrics at that scale.",
            "Semantic artwork/collection entities currently have no coordinate fields; spatial OSM artwork rows live in visitor_pois.json and follow the common spatial contract there.",
        ],
        "phase_8_known_limits": [
            "Walking-topology completeness is bounded to the preserved OSM map-tile selection and pedestrian policy; the preserved park boundary itself is explicitly not fully checked, so this is not a physical-inventory claim.",
            "The avoid-known-steps/lower-ascent route policy is evidence-aware weighting, not accessibility certification; missing access, wheelchair and barrier evidence remains unknown.",
            "Short-segment ascent/descent/grade remains unknown below the 90 m GLO-90 horizontal resolution; route weighting does not convert that unknown terrain into factual ascent.",
            "Disconnected preserved-source components remain disconnected and private/no-foot source restrictions are not bypassed by routing.",
        ],
    }
    (DATA / "validation.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(out["summary"], ensure_ascii=False))
    return 0 if status == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())

