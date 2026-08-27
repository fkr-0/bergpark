"""Validate the frozen-source complete Bergpark walking topology."""

from __future__ import annotations

import hashlib
import json
import math
import os
import pathlib
from collections import defaultdict
from typing import Any

try:
    from .path_topology_source import build_source_network, pedestrian_oneway
    from .provenance_contract import (
        validate_elevation_source,
        validate_metric_profile,
        validate_spatial_entity,
    )
except ImportError:
    from path_topology_source import build_source_network, pedestrian_oneway
    from provenance_contract import (
        validate_elevation_source,
        validate_metric_profile,
        validate_spatial_entity,
    )

ROOT = pathlib.Path(__file__).resolve().parents[1]
CANONICAL_DATA = ROOT / "data"
DATA = pathlib.Path(os.environ.get("BERGPARK_OUTPUT_DATA", str(CANONICAL_DATA))).resolve()
REPORT_DATA = pathlib.Path(os.environ.get("BERGPARK_VALIDATION_OUTPUT_DATA", str(DATA))).resolve()
PEDESTRIAN_EXCEPTIONS = {"yes", "designated", "permissive"}


def haversine(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371008.8 * 2 * math.asin(math.sqrt(h))


def polyline_distance(geometry: list[list[float]]) -> float:
    return sum(
        haversine((a[0], a[1]), (b[0], b[1]))
        for a, b in zip(geometry, geometry[1:])
    )


def _components(
    node_ids: set[str], segments: list[dict[str, Any]]
) -> list[set[str]]:
    adjacency: dict[str, set[str]] = defaultdict(set)
    for segment in segments:
        if segment.get("routing_eligible") is not True:
            continue
        adjacency[segment["from"]].add(segment["to"])
        adjacency[segment["to"]].add(segment["from"])
    unseen = set(node_ids)
    components: list[set[str]] = []
    while unseen:
        start = min(unseen)
        stack = [start]
        component = {start}
        unseen.remove(start)
        while stack:
            current = stack.pop()
            for neighbor in sorted(adjacency[current]):
                if neighbor in unseen:
                    unseen.remove(neighbor)
                    component.add(neighbor)
                    stack.append(neighbor)
        components.append(component)
    components.sort(key=lambda component: (-len(component), min(component)))
    return components


def _component_id(component: set[str]) -> str:
    digest = hashlib.sha1("\n".join(sorted(component)).encode()).hexdigest()[:12]
    return f"pathcomponent-{digest}"


def _represented_source_traversals(
    segments: list[dict[str, Any]],
) -> set[tuple[str, tuple[str, ...]]]:
    represented: set[tuple[str, tuple[str, ...]]] = set()
    for segment in segments:
        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for traversal in segment.get("osm_traversals", []):
            grouped[str(traversal["osm_way_id"])].append(traversal)
        for way_id, rows in grouped.items():
            if not rows:
                continue
            node_ids = [rows[0]["from_osm_node"]]
            contiguous = True
            for row in rows:
                if node_ids[-1] != row["from_osm_node"]:
                    contiguous = False
                    break
                node_ids.append(row["to_osm_node"])
            if contiguous:
                represented.add((way_id, tuple(node_ids)))
            else:
                # Phase-7 ambiguity rows may contain independent candidates for
                # the same path-node adjacency. Preserve each factual traversal.
                for row in rows:
                    represented.add(
                        (way_id, (row["from_osm_node"], row["to_osm_node"]))
                    )
    return represented


def validate_document(
    doc: dict[str, Any], *, network: dict[str, Any] | None = None
) -> tuple[list[dict[str, Any]], list[str], list[str], dict[str, Any]]:
    network = network or build_source_network()
    nodes = doc.get("path_nodes", [])
    segments = doc.get("directed_segments", [])
    by_id = {node.get("id"): node for node in nodes if node.get("id")}
    node_ids = set(by_id)
    errors: list[str] = []
    warnings: list[str] = []
    checks: list[dict[str, Any]] = []

    def check(check_id: str, failures: list[Any]) -> None:
        checks.append({"id": check_id, "pass": not failures, "failures": failures[:50]})

    if doc.get("schema_version") != 1:
        errors.append("path topology schema_version must remain 1")
    if doc.get("status") != "qualified_complete_preserved_source_scope":
        errors.append("path topology status does not claim the bounded preserved-source scope")
    if len(by_id) != len(nodes):
        errors.append("duplicate or missing path node id")
    segment_ids = [segment.get("id") for segment in segments]
    if any(not segment_id for segment_id in segment_ids) or len(segment_ids) != len(set(segment_ids)):
        errors.append("duplicate or missing directed segment id")

    metric_failures = validate_metric_profile(
        doc.get("derived_metric_profile"),
        label="data/path_topology.json",
        required_metrics=(
            "distance_m",
            "elevation_delta_m",
            "ascent_m",
            "descent_m",
            "avg_grade_pct",
            "surface",
            "access",
            "accessibility_status",
        ),
    )
    profile = doc.get("derived_metric_profile")
    metric_failures.extend(
        validate_elevation_source(
            profile.get("terrain_source") if isinstance(profile, dict) else None,
            label="data/path_topology.json.derived_metric_profile.terrain_source",
        )
    )
    errors.extend(metric_failures)
    check("derived_metric_provenance", metric_failures)

    coverage = doc.get("coverage", {})
    source_coverage = network["coverage"]
    coverage_failures = []
    for key in (
        "status",
        "physical_inventory_claim",
        "intended_source_scope",
        "boundary_element",
        "boundary_source_note",
        "boundary_quality_status",
        "map_snapshots",
        "source_highway_ways_in_tile_union",
        "highway_ways_touching_boundary_scope",
        "included_walkable_ways",
        "excluded_touching_ways",
        "excluded_way_reasons",
        "blocked_node_adjacencies",
        "raw_selected_adjacencies",
        "raw_selected_source_nodes",
        "meaningful_source_path_nodes",
        "compressed_undirected_source_chains",
        "source_connected_components",
        "source_component_sizes",
        "overpass_bbox_highway_snapshot",
    ):
        if coverage.get(key) != source_coverage.get(key):
            coverage_failures.append(key)
    if coverage.get("physical_inventory_claim") is not False:
        coverage_failures.append("physical_inventory_claim")
    if coverage.get("boundary_quality_status") != "source_boundary_explicitly_not_fully_checked":
        coverage_failures.append("boundary_quality_status")
    errors.extend(f"preserved-source coverage drift: {key}" for key in coverage_failures)
    check("complete_intended_preserved_source_scope", coverage_failures)

    node_failures: list[str] = []
    segment_failures: list[str] = []
    endpoint_failures: list[str] = []
    terrain_failures: list[str] = []
    private_failures: list[str] = []
    connector_failures: list[str] = []
    reverse_failures: list[str] = []
    reverse_pointer_failures: list[str] = []
    adjacency_reference_failures: list[str] = []

    segment_by_id = {
        segment["id"]: segment for segment in segments if isinstance(segment.get("id"), str)
    }
    pair_map: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for segment in segments:
        pair_map[(segment.get("from"), segment.get("to"))].append(segment)

    for node in nodes:
        node_id = node.get("id", "<missing-id>")
        failures = validate_spatial_entity(node, label=f"path_node:{node_id}")
        if failures or not isinstance(node.get("elevation_m"), (int, float)):
            node_failures.append(node_id)
        for key in ("next_segment_ids", "previous_segment_ids"):
            refs = node.get(key)
            if not isinstance(refs, list) or any(ref not in segment_by_id for ref in refs):
                adjacency_reference_failures.append(node_id)
    errors.extend(f"invalid path node provenance/elevation: {node_id}" for node_id in node_failures)
    errors.extend(f"path node references unknown segment: {node_id}" for node_id in adjacency_reference_failures)
    check("path_node_spatial_provenance", node_failures)
    check("path_node_segment_references", adjacency_reference_failures)

    for segment in segments:
        segment_id = segment.get("id", "<missing-id>")
        from_id, to_id = segment.get("from"), segment.get("to")
        if from_id not in by_id or to_id not in by_id:
            segment_failures.append(segment_id)
            continue
        geometry = segment.get("geometry")
        if not isinstance(geometry, list) or len(geometry) < 2:
            endpoint_failures.append(segment_id)
            continue
        a, b = by_id[from_id], by_id[to_id]
        if geometry[0] != [a["lat"], a["lng"]] or geometry[-1] != [b["lat"], b["lng"]]:
            endpoint_failures.append(segment_id)
        distance = segment.get("distance_m")
        if not isinstance(distance, (int, float)) or abs(float(distance) - polyline_distance(geometry)) > 0.06:
            endpoint_failures.append(segment_id)
        expected_delta = round(float(b["elevation_m"]) - float(a["elevation_m"]), 1)
        if not isinstance(segment.get("elevation_delta_m"), (int, float)) or abs(float(segment["elevation_delta_m"]) - expected_delta) > 0.01:
            terrain_failures.append(segment_id)
        if isinstance(distance, (int, float)) and distance < 90.0:
            if segment.get("terrain_metric_status") != "below_dem_horizontal_resolution" or any(
                segment.get(key) is not None for key in ("ascent_m", "descent_m", "avg_grade_pct")
            ):
                terrain_failures.append(segment_id)
        elif segment.get("terrain_metric_status") != "coarse_glo90_endpoint_estimate":
            terrain_failures.append(segment_id)

        foot = segment.get("foot")
        access = segment.get("access")
        if foot == "no" or (
            access in {"private", "no"} and foot not in PEDESTRIAN_EXCEPTIONS
        ):
            private_failures.append(segment_id)
        for evidence in segment.get("barrier_evidence", []):
            evidence_foot = evidence.get("foot")
            evidence_access = evidence.get("access")
            if evidence_foot == "no" or (
                evidence_access in {"private", "no"}
                and evidence_foot not in PEDESTRIAN_EXCEPTIONS
            ):
                private_failures.append(segment_id)

        if segment.get("source_kind") == "representative_point_snap_connector":
            if (
                segment.get("accessibility_status") != "unknown_unmapped_connector"
                or any(
                    segment.get(key) is not None
                    for key in ("surface", "steps", "access", "foot", "wheelchair")
                )
            ):
                connector_failures.append(segment_id)
        elif not segment.get("osm_way_ids"):
            segment_failures.append(segment_id)

        reverse_candidates = pair_map.get((to_id, from_id), [])
        if not reverse_candidates and not segment.get("one_way_reason"):
            reverse_failures.append(segment_id)
        if not reverse_candidates and segment.get("pedestrian_oneway") not in {"forward", "reverse"}:
            reverse_failures.append(segment_id)
        if segment.get("routing_eligible") is False and not segment.get("one_way_reason"):
            reverse_failures.append(segment_id)
        reverse_id = segment.get("reverse_segment_id")
        if reverse_id is not None:
            reverse = segment_by_id.get(reverse_id)
            if reverse is None or reverse.get("from") != to_id or reverse.get("to") != from_id:
                reverse_pointer_failures.append(segment_id)

    for label, failures in (
        ("segment structure", segment_failures),
        ("geometry/distance endpoint", endpoint_failures),
        ("terrain precision", terrain_failures),
        ("private/no-foot leakage", private_failures),
        ("snap connector evidence", connector_failures),
        ("reverse/one-way", reverse_failures),
        ("reverse pointer", reverse_pointer_failures),
    ):
        errors.extend(f"{label}: {segment_id}" for segment_id in sorted(set(failures)))
    check("segment_endpoints_and_polyline_distance", sorted(set(endpoint_failures)))
    check("glo90_short_segment_precision", sorted(set(terrain_failures)))
    check("no_private_or_no_foot_leakage", sorted(set(private_failures)))
    check("representative_connectors_remain_unknown", sorted(set(connector_failures)))
    check("reverse_or_source_backed_one_way", sorted(set(reverse_failures)))
    check("reverse_segment_pointers_resolve", sorted(set(reverse_pointer_failures)))

    excluded_way_ids = {row["osm_way_id"] for row in network["excluded_ways"]}
    excluded_way_leaks = sorted(
        {
            segment["id"]
            for segment in segments
            if segment.get("routing_eligible") is True
            and excluded_way_ids.intersection(segment.get("osm_way_ids", []))
        }
    )
    errors.extend(f"excluded source way routable: {segment_id}" for segment_id in excluded_way_leaks)
    check("excluded_source_ways_not_routable", excluded_way_leaks)

    blocked = {
        (row["osm_way_id"], row["from_osm_node"], row["to_osm_node"])
        for row in network["blocked_adjacencies"]
    }
    blocked_leaks = []
    for segment in segments:
        if segment.get("routing_eligible") is not True:
            continue
        for traversal in segment.get("osm_traversals", []):
            key = (
                traversal["osm_way_id"],
                traversal["from_osm_node"],
                traversal["to_osm_node"],
            )
            reverse_key = (key[0], key[2], key[1])
            if key in blocked or reverse_key in blocked:
                blocked_leaks.append(segment["id"])
    errors.extend(f"blocked source adjacency routable: {segment_id}" for segment_id in blocked_leaks)
    check("blocked_source_adjacencies_not_routable", sorted(set(blocked_leaks)))

    represented = _represented_source_traversals(segments)
    missing_source_chains: list[str] = []
    for chain in network["chains"]:
        way_id = chain["osm_way_id"]
        source_nodes = chain["source_node_ids"]
        direction, _ = pedestrian_oneway(chain["tags"])
        expected: list[tuple[str, ...]] = []
        if direction in {"both", "forward"}:
            expected.append(tuple(source_nodes))
        if direction in {"both", "reverse"}:
            expected.append(tuple(reversed(source_nodes)))
        for node_sequence in expected:
            if (way_id, node_sequence) not in represented:
                missing_source_chains.append(
                    f"way/{way_id}:{node_sequence[0]}->{node_sequence[-1]}"
                )
    errors.extend(f"missing intended source chain: {row}" for row in missing_source_chains)
    check("all_selected_source_chains_serialized", missing_source_chains)

    derived_components = _components(node_ids, segments)
    declared_components = doc.get("connected_components", [])
    component_failures: list[str] = []
    if len(declared_components) != len(derived_components):
        component_failures.append("component-count")
    declared_node_ids: set[str] = set()
    for index, component in enumerate(declared_components):
        declared_ids = component.get("path_node_ids", [])
        component_set = set(declared_ids)
        if len(component_set) != len(declared_ids):
            component_failures.append(f"component-{index}-duplicate-nodes")
        if component.get("id") != _component_id(component_set):
            component_failures.append(f"component-{index}-id")
        if component.get("path_node_count") != len(component_set):
            component_failures.append(f"component-{index}-node-count")
        directed_count = sum(
            segment.get("routing_eligible") is True
            and segment.get("from") in component_set
            and segment.get("to") in component_set
            for segment in segments
        )
        if component.get("directed_segment_count") != directed_count:
            component_failures.append(f"component-{index}-segment-count")
        for node_id in component_set:
            if by_id.get(node_id, {}).get("component_id") != component.get("id"):
                component_failures.append(f"component-{index}-node-label")
                break
        declared_node_ids.update(component_set)
    if declared_node_ids != node_ids:
        component_failures.append("component-node-partition")
    if [set(component.get("path_node_ids", [])) for component in declared_components] != derived_components:
        component_failures.append("component-membership")
    component_sizes = [len(component) for component in derived_components]
    if coverage.get("final_connected_components") != len(derived_components):
        component_failures.append("coverage-component-count")
    if coverage.get("final_component_path_node_sizes") != component_sizes:
        component_failures.append("coverage-component-sizes")
    if coverage.get("final_path_nodes") != len(nodes):
        component_failures.append("coverage-path-node-count")
    if coverage.get("final_directed_segments") != len(segments):
        component_failures.append("coverage-segment-count")
    errors.extend(f"component audit: {failure}" for failure in component_failures)
    check("connected_components_auditable", component_failures)

    summary = {
        "path_nodes": len(nodes),
        "directed_segments": len(segments),
        "osm_walkable_chains": sum(
            segment.get("source_kind") == "osm_walkable_chain" for segment in segments
        ),
        "phase7_osm_adjacencies": sum(
            segment.get("source_kind") == "osm_walkable_adjacency" for segment in segments
        ),
        "snap_connectors": sum(
            segment.get("source_kind") == "representative_point_snap_connector"
            for segment in segments
        ),
        "segments_with_grade": sum(segment.get("avg_grade_pct") is not None for segment in segments),
        "segments_below_dem_resolution": sum(
            segment.get("terrain_metric_status") == "below_dem_horizontal_resolution"
            for segment in segments
        ),
        "connected_components": len(derived_components),
        "component_path_node_sizes": [len(component) for component in derived_components],
        "selected_source_ways": network["coverage"]["included_walkable_ways"],
        "excluded_source_ways": network["coverage"]["excluded_touching_ways"],
        "errors": len(errors),
        "warnings": len(warnings),
    }
    return checks, errors, warnings, summary


def main() -> int:
    doc = json.loads((DATA / "path_topology.json").read_text())
    checks, errors, warnings, summary = validate_document(doc)
    result = {
        "schema_version": 1,
        "generated_at": doc.get("generated_at"),
        "status": "pass" if not errors else "fail",
        "summary": summary,
        "checks": checks,
        "errors": errors,
        "warnings": warnings,
        "notes": [
            "Coverage is complete only under the explicit preserved OSM tile + park-boundary selection policy; it is not a claim of complete physical inventory.",
            "The preserved boundary way itself states that the boundary is not fully checked, so the validator keeps that source limitation explicit rather than widening scope by inference.",
            "GLO-90 per-short-segment grade remains unknown below 90 m and missing accessibility tags remain unknown.",
        ],
    }
    REPORT_DATA.mkdir(parents=True, exist_ok=True)
    (REPORT_DATA / "path_topology_validation.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    )
    print(json.dumps(summary, ensure_ascii=False))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
