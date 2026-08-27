#!/usr/bin/env python3
"""Build the frozen-source Bergpark walking topology.

Phase 8 preserves the qualified Phase-7 landmark-route projection and expands
it with every pedestrian-eligible chain in the explicitly bounded preserved
OSM source scope.  Normal builds are offline; missing terrain values must have
been acquired separately by ``fetch_path_topology_elevation.py``.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import pathlib
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

try:
    from .path_topology_source import (
        build_source_network,
        pedestrian_oneway,
        topology_elevation_selection_records,
        topology_elevation_selection_sha256,
    )
except ImportError:  # Direct `python scripts/build_path_topology.py` execution.
    from path_topology_source import (
        build_source_network,
        pedestrian_oneway,
        topology_elevation_selection_records,
        topology_elevation_selection_sha256,
    )


ROOT = pathlib.Path(__file__).resolve().parents[1]
CANONICAL_DATA = ROOT / "data"
DATA = pathlib.Path(os.environ.get("BERGPARK_OUTPUT_DATA", str(CANONICAL_DATA))).resolve()
MAP_DIR = CANONICAL_DATA / "sources" / "osm-map"
TOPOLOGY_ELEVATION = CANONICAL_DATA / "sources" / "path-topology-elevation" / "points.json"


def coord_key(lat: float, lng: float) -> tuple[float, float]:
    return round(float(lat), 7), round(float(lng), 7)


def haversine(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371008.8 * 2 * math.asin(math.sqrt(h))


def load_osm() -> tuple[
    dict[str, tuple[float, float]],
    dict[tuple[tuple[float, float], tuple[float, float]], list[dict[str, Any]]],
    dict[str, dict[str, Any]],
]:
    nodes: dict[str, tuple[float, float]] = {}
    node_provenance: dict[str, dict[str, Any]] = {}
    ways: dict[str, tuple[list[str], dict[str, str]]] = {}
    for path in sorted(MAP_DIR.glob("*.xml")):
        root = ET.parse(path).getroot()
        for node in root.findall("node"):
            node_id = node.attrib["id"]
            coord = coord_key(node.attrib["lat"], node.attrib["lon"])
            if node_id in nodes and nodes[node_id] != coord:
                raise RuntimeError(f"OSM node {node_id} differs across preserved snapshots")
            nodes[node_id] = coord
            meta = node_provenance.setdefault(
                node_id,
                {
                    "version": node.attrib.get("version"),
                    "timestamp": node.attrib.get("timestamp"),
                    "snapshot_refs": set(),
                },
            )
            meta["snapshot_refs"].add(f"data/sources/osm-map/{path.name}")
            versions = [value for value in (meta.get("version"), node.attrib.get("version")) if value]
            if versions:
                meta["version"] = max(versions, key=int)
            timestamps = [value for value in (meta.get("timestamp"), node.attrib.get("timestamp")) if value]
            if timestamps:
                meta["timestamp"] = max(timestamps)
        for way in root.findall("way"):
            way_id = way.attrib["id"]
            if way_id in ways:
                continue
            refs = [ref.attrib["ref"] for ref in way.findall("nd")]
            tags = {tag.attrib["k"]: tag.attrib["v"] for tag in way.findall("tag")}
            ways[way_id] = (refs, tags)

    adjacency: dict[tuple[tuple[float, float], tuple[float, float]], list[dict[str, Any]]] = defaultdict(list)
    for way_id, (refs, tags) in ways.items():
        for index, (a, b) in enumerate(zip(refs, refs[1:])):
            if a not in nodes or b not in nodes:
                continue
            ca, cb = nodes[a], nodes[b]
            adjacency[(ca, cb)].append(
                {"osm_way_id": way_id, "osm_way_direction": "forward", "from_osm_node": a, "to_osm_node": b, "tags": tags}
            )
            adjacency[(cb, ca)].append(
                {"osm_way_id": way_id, "osm_way_direction": "reverse", "from_osm_node": b, "to_osm_node": a, "tags": tags}
            )
    return nodes, adjacency, node_provenance


def scalar(values: list[Any]) -> Any:
    normalized = []
    for value in values:
        if value is None or value == "":
            continue
        if value not in normalized:
            normalized.append(value)
    if not normalized:
        return None
    if len(normalized) == 1:
        return normalized[0]
    return "mixed"


def parse_float(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        return float(value.replace(",", ".").strip())
    except ValueError:
        return None


def normalized_surface(tags: dict[str, str]) -> str:
    if tags.get("highway") == "steps":
        return "stone_steps"
    raw = tags.get("surface")
    if raw in {"asphalt", "paved", "paving_stones", "sett", "cobblestone", "concrete", "concrete:plates"}:
        return "paved"
    if raw in {"gravel", "fine_gravel", "compacted", "pebblestone"}:
        return "gravel"
    if raw in {"dirt", "earth", "ground", "mud", "unpaved"}:
        return "dirt"
    if raw == "grass":
        return "grass"
    return "unknown"


def fallback_node_id(coord: tuple[float, float]) -> str:
    digest = hashlib.sha1(f"{coord[0]:.7f},{coord[1]:.7f}".encode()).hexdigest()[:12]
    return f"pathnode-coordinate-{digest}"


def polyline_distance(geometry: list[list[float]]) -> float:
    return sum(
        haversine((a[0], a[1]), (b[0], b[1]))
        for a, b in zip(geometry, geometry[1:])
    )


def route_relative_incline(raw: str | None, direction: str) -> str | None:
    if not raw or direction not in {"forward", "reverse"}:
        return None
    if direction == "forward":
        return raw
    lowered = raw.lower()
    if lowered == "up":
        return "down"
    if lowered == "down":
        return "up"
    suffix = "%" if raw.endswith("%") else ""
    number = raw[:-1] if suffix else raw
    try:
        return f"{-float(number):g}{suffix}"
    except ValueError:
        return None


def topology_elevation_rows(network: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], str | None]:
    if not TOPOLOGY_ELEVATION.is_file():
        raise RuntimeError(
            "Phase-8 topology elevation snapshot is missing; run "
            "scripts/fetch_path_topology_elevation.py explicitly before the offline build"
        )
    doc = json.loads(TOPOLOGY_ELEVATION.read_text())
    selection = topology_elevation_selection_records(network)
    expected_sha = topology_elevation_selection_sha256(selection)
    if doc.get("selection_input_sha256") != expected_sha:
        raise RuntimeError("Phase-8 topology elevation selection hash is stale")
    rows = {row["path_node_id"]: row for row in doc.get("points", [])}
    expected_ids = {row["path_node_id"] for row in selection}
    if set(rows) != expected_ids:
        raise RuntimeError("Phase-8 topology elevation snapshot does not match source-node selection")
    for selected in selection:
        row = rows[selected["path_node_id"]]
        if (
            row.get("osm_node_id") != selected["osm_node_id"]
            or coord_key(row["lat"], row["lng"]) != coord_key(selected["lat"], selected["lng"])
            or not isinstance(row.get("elevation_m"), (int, float))
        ):
            raise RuntimeError(f"topology elevation row drift: {selected['path_node_id']}")
    return rows, doc.get("retrieved_utc")


def source_node_barrier_evidence(
    source_node_ids: list[str], network: dict[str, Any]
) -> list[dict[str, Any]]:
    rows = []
    for node_id in source_node_ids:
        tags = network["nodes"][node_id]["tags"]
        if not any(key in tags for key in ("barrier", "access", "foot", "wheelchair", "entrance")):
            continue
        rows.append(
            {
                "osm_node_id": node_id,
                "barrier": tags.get("barrier"),
                "entrance": tags.get("entrance"),
                "access": tags.get("access"),
                "foot": tags.get("foot"),
                "wheelchair": tags.get("wheelchair"),
            }
        )
    return rows


def segment_accessibility_status(
    *,
    steps: bool | None,
    wheelchair: Any,
    barrier_evidence: list[dict[str, Any]],
    source_kind: str,
) -> str:
    if source_kind == "representative_point_snap_connector":
        return "unknown_unmapped_connector"
    if steps is True:
        return "known_steps"
    if wheelchair == "no":
        return "known_wheelchair_no"
    if any(row.get("barrier") in {"stile", "turnstile"} for row in barrier_evidence):
        return "known_barrier_mobility_constraint"
    return "unknown_not_field_verified"


def segment_terrain_metrics(
    from_node: dict[str, Any], to_node: dict[str, Any], distance: float
) -> dict[str, Any]:
    delta = float(to_node["elevation_m"]) - float(from_node["elevation_m"])
    defensible = distance >= 90.0
    return {
        "elevation_delta_m": round(delta, 1),
        "ascent_m": round(max(0.0, delta), 1) if defensible else None,
        "descent_m": round(max(0.0, -delta), 1) if defensible else None,
        "avg_grade_pct": round((delta / distance) * 100, 1) if defensible else None,
        "terrain_metric_status": (
            "coarse_glo90_endpoint_estimate" if defensible else "below_dem_horizontal_resolution"
        ),
    }


def source_chain_segment_id(
    way_id: str, from_id: str, to_id: str, source_node_ids: list[str]
) -> str:
    digest = hashlib.sha1("/".join(source_node_ids).encode()).hexdigest()[:10]
    return (
        f"pathseg-way-{way_id}-{from_id.removeprefix('pathnode-')}--"
        f"{to_id.removeprefix('pathnode-')}-{digest}"
    )


def traversal_allowed_by_pedestrian_oneway(
    tags: dict[str, str], way_direction: str
) -> tuple[bool, str | None]:
    direction_policy, reason = pedestrian_oneway(tags)
    if direction_policy == "both" or direction_policy == way_direction:
        return True, None
    return False, reason


def topology_components(
    path_nodes: dict[str, dict[str, Any]], segments: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Assign deterministic, auditable components over routable topology."""
    adjacency: dict[str, set[str]] = defaultdict(set)
    for segment in segments:
        if segment.get("routing_eligible") is not True:
            continue
        adjacency[segment["from"]].add(segment["to"])
        adjacency[segment["to"]].add(segment["from"])

    unseen = set(path_nodes)
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

    result = []
    for component in components:
        node_ids = sorted(component)
        digest = hashlib.sha1("\n".join(node_ids).encode()).hexdigest()[:12]
        component_id = f"pathcomponent-{digest}"
        directed_segment_count = sum(
            segment.get("routing_eligible") is True
            and segment["from"] in component
            and segment["to"] in component
            for segment in segments
        )
        place_ids = sorted(
            {
                place_id
                for node_id in node_ids
                for place_id in path_nodes[node_id].get("related_place_ids", [])
            }
        )
        for node_id in node_ids:
            path_nodes[node_id]["component_id"] = component_id
        result.append(
            {
                "id": component_id,
                "path_node_count": len(node_ids),
                "directed_segment_count": directed_segment_count,
                "representative_path_node_id": node_ids[0],
                "related_place_ids": place_ids,
                "path_node_ids": node_ids,
            }
        )
    return result


def add_full_source_scope(
    path_nodes: dict[str, dict[str, Any]],
    segments: list[dict[str, Any]],
    network: dict[str, Any],
    topology_elevations: dict[str, dict[str, Any]],
) -> None:
    """Merge the complete preserved-source scope into the Phase-7 projection."""
    # Add only graph-significant source nodes.  Intermediate OSM geometry points
    # remain verbatim inside segment polylines and are not invented graph nodes.
    for osm_node_id in sorted(network["meaningful_osm_node_ids"], key=int):
        path_id = network["path_id_by_osm"][osm_node_id]
        source_node = network["nodes"][osm_node_id]
        coord = source_node["coord"]
        existing = path_nodes.get(path_id)
        if existing is not None:
            if coord_key(existing["lat"], existing["lng"]) != coord:
                raise RuntimeError(f"source path-node coordinate conflict: {path_id}")
            existing.setdefault("topology_roles", [])
            for role in network["node_reasons"].get(osm_node_id, []):
                if role not in existing["topology_roles"]:
                    existing["topology_roles"].append(role)
            existing["topology_roles"].sort()
            source_tags = source_node["tags"]
            if source_tags:
                existing["osm_node_tags"] = {
                    key: source_tags[key]
                    for key in sorted(source_tags)
                    if key in {"access", "barrier", "crossing", "entrance", "foot", "highway", "wheelchair"}
                }
            continue

        elevation_row = topology_elevations.get(path_id)
        if elevation_row is None:
            raise RuntimeError(f"new source path node lacks selected terrain snapshot: {path_id}")
        snapshot_refs = sorted(source_node["snapshot_refs"])
        path_nodes[path_id] = {
            "id": path_id,
            "kind": "path_node",
            "lat": coord[0],
            "lng": coord[1],
            "elevation_m": float(elevation_row["elevation_m"]),
            "position_source": {
                "kind": "osm_path_node",
                "provider": "OpenStreetMap",
                "elements": [f"node/{osm_node_id}"],
                "snapshot": snapshot_refs[0],
                "snapshot_refs": snapshot_refs,
                "source_version": source_node.get("version"),
                "source_timestamp": source_node.get("timestamp"),
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
                "snapshot": "data/sources/path-topology-elevation/points.json",
                "value_source": elevation_row.get("value_source"),
            },
            "related_place_ids": [],
            "osm_node_ids": [osm_node_id],
            "osm_node_tags": {
                key: source_node["tags"][key]
                for key in sorted(source_node["tags"])
                if key in {"access", "barrier", "crossing", "entrance", "foot", "highway", "wheelchair"}
            },
            "topology_roles": network["node_reasons"].get(osm_node_id, []),
            "next_segment_ids": [],
            "previous_segment_ids": [],
        }

    by_pair: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for segment in segments:
        by_pair[(segment["from"], segment["to"])].append(segment)

    for segment in segments:
        segment.setdefault("coverage_membership", "phase7_route_projection_extension")
        segment.setdefault("routing_eligible", True)
        segment.setdefault("one_way_reason", None)
        segment.setdefault("reverse_segment_id", None)
        segment.setdefault("barrier_evidence", [])
        segment.setdefault("conditional_access", None)
        segment.setdefault("osm_incline", None)
        segment.setdefault("route_incline", None)
        segment.setdefault("pedestrian_oneway", "both")
        segment.setdefault("vehicle_oneway", None)
        if segment["source_kind"] == "representative_point_snap_connector":
            segment["accessibility_status"] = "unknown_unmapped_connector"
            segment["coverage_membership"] = "phase7_place_snap_connector"
        else:
            way_tags = [network["ways"][way_id]["tags"] for way_id in segment["osm_way_ids"] if way_id in network["ways"]]
            segment["conditional_access"] = scalar(
                [tags.get("foot:conditional") or tags.get("access:conditional") for tags in way_tags]
            )
            segment["osm_incline"] = scalar([tags.get("incline") for tags in way_tags])
            traversals = segment.get("osm_traversals", [])
            segment["route_incline"] = scalar(
                [
                    route_relative_incline(
                        network["ways"][row["osm_way_id"]]["tags"].get("incline"),
                        row["osm_way_direction"],
                    )
                    for row in traversals
                    if row["osm_way_id"] in network["ways"]
                ]
            )
            segment["vehicle_oneway"] = scalar([tags.get("oneway") for tags in way_tags])
            foot_directions = [pedestrian_oneway(tags)[0] for tags in way_tags]
            segment["pedestrian_oneway"] = scalar(foot_directions) or "both"
            traversal_permissions = []
            blocked_oneway_reasons = []
            for row in traversals:
                way = network["ways"].get(row["osm_way_id"])
                if way is None:
                    continue
                allowed, reason = traversal_allowed_by_pedestrian_oneway(
                    way["tags"], row["osm_way_direction"]
                )
                traversal_permissions.append(allowed)
                if not allowed and reason:
                    blocked_oneway_reasons.append(reason)
            if traversal_permissions and not any(traversal_permissions):
                # Keep the exact Phase-7 projection row for compatibility, but
                # never let routing traverse it against source-backed foot
                # direction evidence.
                segment["routing_eligible"] = False
                segment["one_way_reason"] = " | ".join(sorted(set(blocked_oneway_reasons)))
            source_node_ids = sorted(
                {
                    node_id
                    for row in traversals
                    for node_id in (row.get("from_osm_node"), row.get("to_osm_node"))
                    if node_id in network["nodes"]
                },
                key=int,
            )
            segment["barrier_evidence"] = source_node_barrier_evidence(source_node_ids, network)
            segment["accessibility_status"] = segment_accessibility_status(
                steps=segment.get("steps"),
                wheelchair=segment.get("wheelchair"),
                barrier_evidence=segment["barrier_evidence"],
                source_kind=segment["source_kind"],
            )

    # Exact Phase-7 pair IDs have a unique reverse.  They remain stable even
    # where new parallel source chains are added.
    legacy_by_pair = {
        (segment["from"], segment["to"]): segment
        for segment in segments
        if segment["source_kind"] in {"osm_walkable_adjacency", "representative_point_snap_connector"}
    }
    for pair, segment in legacy_by_pair.items():
        reverse = legacy_by_pair.get((pair[1], pair[0]))
        if reverse is not None:
            segment["reverse_segment_id"] = reverse["id"]

    for chain in network["chains"]:
        way_id = chain["osm_way_id"]
        tags = chain["tags"]
        source_node_ids = chain["source_node_ids"]
        forward_from = network["path_id_by_osm"][source_node_ids[0]]
        forward_to = network["path_id_by_osm"][source_node_ids[-1]]
        # Closed source ways may legitimately compress to a positive-length
        # self-loop. Preserve that source geometry instead of inventing a split
        # point solely to satisfy the graph serialization.
        direction_policy, one_way_reason = pedestrian_oneway(tags)
        directions = []
        if direction_policy in {"both", "forward"}:
            directions.append(("forward", forward_from, forward_to, source_node_ids, chain["geometry"]))
        if direction_policy in {"both", "reverse"}:
            directions.append(
                (
                    "reverse",
                    forward_to,
                    forward_from,
                    list(reversed(source_node_ids)),
                    list(reversed(chain["geometry"])),
                )
            )

        created: list[dict[str, Any]] = []
        for way_direction, from_id, to_id, traversal_nodes, geometry in directions:
            # A direct source adjacency already serialized by Phase 7 retains
            # its exact ID and route-context fields instead of being duplicated.
            legacy_candidates = by_pair.get((from_id, to_id), [])
            legacy = next(
                (
                    item
                    for item in legacy_candidates
                    if item["source_kind"] == "osm_walkable_adjacency"
                    and way_id in item.get("osm_way_ids", [])
                    and len(source_node_ids) == 2
                ),
                None,
            )
            if legacy is not None:
                legacy["coverage_membership"] = "preserved_source_scope_and_phase7_projection"
                legacy["source_scope_relations"] = chain["scope_relations"]
                continue

            segment_id = source_chain_segment_id(way_id, from_id, to_id, traversal_nodes)
            distance = polyline_distance(geometry)
            barrier_evidence = source_node_barrier_evidence(traversal_nodes, network)
            steps = tags.get("highway") == "steps"
            segment = {
                "id": segment_id,
                "kind": "directed_path_segment",
                "from": from_id,
                "to": to_id,
                "geometry": geometry,
                "distance_m": round(distance, 2),
                **segment_terrain_metrics(path_nodes[from_id], path_nodes[to_id], distance),
                "surface": normalized_surface(tags),
                "osm_surface": tags.get("surface"),
                "highway": tags.get("highway"),
                "width_m": parse_float(tags.get("width")),
                "steps": steps,
                "access": tags.get("access"),
                "foot": tags.get("foot"),
                "wheelchair": tags.get("wheelchair"),
                "handrail": tags.get("handrail"),
                "smoothness": tags.get("smoothness"),
                "seasonal": tags.get("seasonal"),
                "conditional_access": tags.get("foot:conditional") or tags.get("access:conditional"),
                "barrier_evidence": barrier_evidence,
                "source_kind": "osm_walkable_chain",
                "osm_way_ids": [way_id],
                "osm_traversals": [
                    {
                        "osm_way_id": way_id,
                        "osm_way_direction": way_direction,
                        "from_osm_node": a,
                        "to_osm_node": b,
                    }
                    for a, b in zip(traversal_nodes, traversal_nodes[1:])
                ],
                "source_ambiguity": False,
                "route_edge_ids": [],
                "source_ids": [
                    *chain["snapshot_refs"],
                    "data/sources/path-topology-elevation/points.json",
                ],
                "coverage_membership": "preserved_source_scope",
                "source_scope_relations": chain["scope_relations"],
                "routing_eligible": True,
                "pedestrian_oneway": direction_policy,
                "vehicle_oneway": tags.get("oneway"),
                "one_way_reason": one_way_reason if direction_policy != "both" else None,
                "reverse_segment_id": None,
                "osm_incline": tags.get("incline"),
                "route_incline": route_relative_incline(tags.get("incline"), way_direction),
                "accessibility_status": segment_accessibility_status(
                    steps=steps,
                    wheelchair=tags.get("wheelchair"),
                    barrier_evidence=barrier_evidence,
                    source_kind="osm_walkable_chain",
                ),
            }
            segments.append(segment)
            by_pair[(from_id, to_id)].append(segment)
            created.append(segment)

        if direction_policy == "both" and len(created) == 2:
            created[0]["reverse_segment_id"] = created[1]["id"]
            created[1]["reverse_segment_id"] = created[0]["id"]
        elif direction_policy == "both" and created:
            # One or both directions may have been represented by stable Phase-7
            # direct-adjacency rows. Resolve reverse IDs by exact source way.
            for segment in created:
                reverse_candidates = by_pair.get((segment["to"], segment["from"]), [])
                reverse = next(
                    (item for item in reverse_candidates if way_id in item.get("osm_way_ids", [])),
                    None,
                )
                if reverse is None:
                    raise RuntimeError(f"bidirectional source chain lacks reverse: {segment['id']}")
                segment["reverse_segment_id"] = reverse["id"]
                if reverse.get("reverse_segment_id") is None:
                    reverse["reverse_segment_id"] = segment["id"]


def path_derived_metric_profile(elevation_retrieved_at: str | None) -> dict[str, Any]:
    return {
        "profile_id": "phase8-path-topology-derived-v2",
        "applies_to": "directed_segments[*]",
        "source_vs_derived_policy": (
            "source_facts_are_preserved; derived_values_require_declared_algorithm_and_inputs"
        ),
        "terrain_source": {
            "provider": "Open-Meteo Elevation API",
            "dataset": "Copernicus DEM 2021 GLO-90",
            "resolution_m": 90,
            "vertical_accuracy_m": None,
            "accuracy_status": "not_reported_in_project_source",
            "snapshot": "data/sources/elevation/points.json",
            "expanded_topology_snapshot": "data/sources/path-topology-elevation/points.json",
            "retrieved_at": elevation_retrieved_at,
        },
        "metrics": {
            "distance_m": {
                "kind": "derived",
                "algorithm": "sum_wgs84_haversine_over_source_polyline",
                "source_fields": ["geometry", "from", "to"],
                "assumptions": "Compressed source chains retain every preserved OSM geometry point; Phase-7 direct adjacencies remain two-point polylines.",
            },
            "elevation_delta_m": {
                "kind": "derived",
                "algorithm": "to_node_terrain_elevation_minus_from_node_terrain_elevation",
                "source_fields": ["from.elevation_m", "to.elevation_m"],
                "assumptions": "Endpoint GLO-90 terrain values are approximate and not physical object heights.",
            },
            "ascent_m": {
                "kind": "derived",
                "algorithm": "positive_endpoint_glo90_delta_if_segment_at_least_dem_resolution",
                "source_fields": ["elevation_delta_m", "distance_m", "terrain_metric_status"],
                "assumptions": "Only segments >=90 m publish ascent; shorter segments remain null because GLO-90 cannot support that precision.",
            },
            "descent_m": {
                "kind": "derived",
                "algorithm": "negative_endpoint_glo90_delta_if_segment_at_least_dem_resolution",
                "source_fields": ["elevation_delta_m", "distance_m", "terrain_metric_status"],
                "assumptions": "Only segments >=90 m publish descent; shorter segments remain null because GLO-90 cannot support that precision.",
            },
            "avg_grade_pct": {
                "kind": "derived",
                "algorithm": "endpoint_glo90_delta_divided_by_segment_distance_if_at_least_90m",
                "source_fields": ["elevation_delta_m", "distance_m", "terrain_metric_status"],
                "assumptions": "Short-segment grade is explicitly null below the 90 m DEM horizontal resolution; long-segment grade remains coarse.",
            },
            "surface": {
                "kind": "source_qualified_derived",
                "algorithm": "normalize_unique_contributing_osm_way_surface_or_mixed",
                "source_fields": ["data/sources/osm-map/*.xml way.tags.surface", "osm_way_ids"],
                "assumptions": "Missing OSM surface remains unknown; multiple conflicting source ways remain mixed/ambiguous.",
            },
            "access": {
                "kind": "source_qualified_derived",
                "algorithm": "unique_contributing_osm_way_access_tag_or_mixed",
                "source_fields": ["data/sources/osm-map/*.xml way.tags.access", "osm_way_ids"],
                "assumptions": "Missing access tags remain unknown and are never interpreted as accessible.",
            },
            "accessibility_status": {
                "kind": "source_qualified_derived",
                "algorithm": "known_negative_evidence_else_explicit_unknown",
                "source_fields": ["source_kind", "steps", "wheelchair", "barrier_evidence", "access", "foot"],
                "assumptions": "Known steps/wheelchair/barrier constraints are negative evidence; all other source paths and unmapped representative-point connectors remain unknown rather than being called accessible.",
            },
        },
    }


def main() -> int:
    place_doc = json.loads((DATA / "nodes.json").read_text())
    edge_doc = json.loads((DATA / "edges.json").read_text())
    elevation_doc = json.loads((CANONICAL_DATA / "sources" / "elevation" / "points.json").read_text())
    places = place_doc["nodes"]
    edges = edge_doc["edges"]
    osm_nodes, adjacency, osm_node_provenance = load_osm()
    elevation_retrieved_at = elevation_doc.get("retrieved_utc")
    network = build_source_network()
    topology_elevations, topology_elevation_retrieved_at = topology_elevation_rows(network)

    elevations = {coord_key(p["lat"], p["lng"]): float(p["elevation_m"]) for p in elevation_doc["points"]}
    place_at: dict[tuple[float, float], list[dict[str, Any]]] = defaultdict(list)
    for place in places:
        place_at[coord_key(place["lat"], place["lng"])].append(place)
    osm_at: dict[tuple[float, float], list[str]] = defaultdict(list)
    for node_id, coord in osm_nodes.items():
        osm_at[coord].append(node_id)

    all_coords = {coord_key(lat, lng) for edge in edges for lat, lng in edge["path_coordinates"]}
    missing_elevation = sorted(coord for coord in all_coords if coord not in elevations)
    if missing_elevation:
        raise RuntimeError(f"Phase-2 elevation snapshot lacks {len(missing_elevation)} route coordinates")

    node_id_by_coord: dict[tuple[float, float], str] = {}
    path_nodes: dict[str, dict[str, Any]] = {}
    for coord in sorted(all_coords):
        related_places = sorted({p["id"] for p in place_at.get(coord, [])})
        osm_ids = sorted(set(osm_at.get(coord, [])), key=int)
        if related_places:
            node_id = f"pathnode-place-{related_places[0]}"
            source_positions = [p["position_source"] for p in place_at[coord]]
            primary = source_positions[0]
            if any(
                (position.get("provider"), position.get("element"), position.get("method"), position.get("position_type"))
                != (primary.get("provider"), primary.get("element"), primary.get("method"), primary.get("position_type"))
                for position in source_positions[1:]
            ):
                raise RuntimeError(f"coincident place positions have incompatible provenance at {coord}")
            position_source = {
                "kind": "place_position",
                "provider": primary.get("provider"),
                "element": primary.get("element"),
                "snapshot": primary.get("snapshot"),
                "source_timestamp": primary.get("source_timestamp"),
                "retrieved_at": primary.get("retrieved_at"),
                "retrieval_status": primary.get(
                    "retrieval_status", "source_retrieval_time_not_preserved_separately"
                ),
                "method": primary.get("method"),
                "position_type": primary.get("position_type"),
                "horizontal_accuracy_m": primary.get("horizontal_accuracy_m"),
                "accuracy_status": primary.get("accuracy_status"),
                "license": primary.get("license", "ODbL-1.0"),
                "source_layer": "data/nodes.json",
                "place_ids": related_places,
                "coordinate_sources": [p.get("coordinate_source") for p in place_at[coord]],
            }
        elif osm_ids:
            node_id = f"pathnode-osm-{osm_ids[0]}"
            metas = [osm_node_provenance[node_id_] for node_id_ in osm_ids]
            snapshot_refs = sorted({ref for meta in metas for ref in meta["snapshot_refs"]})
            timestamps = sorted({meta.get("timestamp") for meta in metas if meta.get("timestamp")})
            position_source = {
                "kind": "osm_path_node",
                "provider": "OpenStreetMap",
                "elements": [f"node/{node_id_}" for node_id_ in osm_ids],
                "snapshot": snapshot_refs[0],
                "snapshot_refs": snapshot_refs,
                "source_timestamp": max(timestamps) if timestamps else None,
                "retrieved_at": None,
                "retrieval_status": "source_retrieval_time_not_preserved_separately",
                "method": "source_node",
                "position_type": "source_point",
                "license": "ODbL-1.0",
                "horizontal_accuracy_m": None,
                "accuracy_status": "not_reported_by_source",
            }
        else:
            node_id = fallback_node_id(coord)
            position_source = {
                "kind": "qualified_route_coordinate",
                "provider": "Bergpark derived route export",
                "document_ref": "data/edges.json",
                "source": "data/edges.json",
                "snapshot": "data/edges.json",
                "source_timestamp": edge_doc.get("generated_at"),
                "retrieved_at": None,
                "retrieval_status": "derived_from_hashed_route_layer",
                "method": "route_geometry_coordinate",
                "position_type": "representative_point",
                "horizontal_accuracy_m": None,
                "accuracy_status": "derived_from_route_export",
            }
        node_id_by_coord[coord] = node_id
        path_nodes[node_id] = {
            "id": node_id,
            "kind": "path_node",
            "lat": coord[0],
            "lng": coord[1],
            "elevation_m": elevations[coord],
            "position_source": position_source,
            "elevation_source": {
                "provider": "Open-Meteo Elevation API",
                "dataset": "Copernicus DEM 2021 GLO-90",
                "resolution_m": 90,
                "vertical_accuracy_m": None,
                "accuracy_status": "not_reported_in_project_source",
                "snapshot": "data/sources/elevation/points.json",
                "retrieved_at": elevation_retrieved_at,
            },
            "related_place_ids": related_places,
            "osm_node_ids": osm_ids,
            "next_segment_ids": [],
            "previous_segment_ids": [],
        }

    segment_occurrences: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for edge in edges:
        coords = [coord_key(lat, lng) for lat, lng in edge["path_coordinates"]]
        edge_way_ids = set(edge.get("osm_way_ids", []))
        for a, b in zip(coords, coords[1:]):
            from_id, to_id = node_id_by_coord[a], node_id_by_coord[b]
            if from_id == to_id:
                continue
            candidates = [c for c in adjacency.get((a, b), []) if c["osm_way_id"] in edge_way_ids]
            segment_occurrences[(from_id, to_id)].append(
                {"edge_id": edge["id"], "from_coord": a, "to_coord": b, "candidates": candidates}
            )

    segments = []
    for (from_id, to_id), occurrences in sorted(segment_occurrences.items()):
        a = tuple(occurrences[0]["from_coord"])
        b = tuple(occurrences[0]["to_coord"])
        candidate_map: dict[tuple[str, str], dict[str, Any]] = {}
        for occurrence in occurrences:
            for candidate in occurrence["candidates"]:
                candidate_map[(candidate["osm_way_id"], candidate["osm_way_direction"])] = candidate
        candidates = [candidate_map[key] for key in sorted(candidate_map, key=lambda item: (int(item[0]), item[1]))]
        tags_list = [candidate["tags"] for candidate in candidates]
        distance = haversine(a, b)
        delta = path_nodes[to_id]["elevation_m"] - path_nodes[from_id]["elevation_m"]
        segment_id = f"pathseg-{from_id.removeprefix('pathnode-')}--{to_id.removeprefix('pathnode-')}"

        if candidates:
            source_kind = "osm_walkable_adjacency"
            surfaces = [normalized_surface(tags) for tags in tags_list]
            surface = scalar(surfaces)
            highway = scalar([tags.get("highway") for tags in tags_list])
            osm_surface = scalar([tags.get("surface") for tags in tags_list])
            access = scalar([tags.get("access") for tags in tags_list])
            foot = scalar([tags.get("foot") for tags in tags_list])
            wheelchair = scalar([tags.get("wheelchair") for tags in tags_list])
            handrail = scalar([tags.get("handrail") for tags in tags_list])
            seasonal = scalar([tags.get("seasonal") for tags in tags_list])
            smoothness = scalar([tags.get("smoothness") for tags in tags_list])
            width_values = [parse_float(tags.get("width")) for tags in tags_list]
            width_m = scalar(width_values)
            steps = any(tags.get("highway") == "steps" for tags in tags_list)
        else:
            source_kind = "representative_point_snap_connector"
            surface = highway = osm_surface = access = foot = wheelchair = handrail = seasonal = smoothness = width_m = None
            steps = None

        terrain_metrics_defensible = distance >= 90.0
        segment = {
            "id": segment_id,
            "kind": "directed_path_segment",
            "from": from_id,
            "to": to_id,
            "geometry": [[a[0], a[1]], [b[0], b[1]]],
            "distance_m": round(distance, 2),
            "elevation_delta_m": round(delta, 1),
            "ascent_m": round(max(0.0, delta), 1) if terrain_metrics_defensible else None,
            "descent_m": round(max(0.0, -delta), 1) if terrain_metrics_defensible else None,
            "avg_grade_pct": round((delta / distance) * 100, 1) if terrain_metrics_defensible else None,
            "terrain_metric_status": (
                "coarse_glo90_endpoint_estimate"
                if terrain_metrics_defensible
                else "below_dem_horizontal_resolution"
            ),
            "surface": surface,
            "osm_surface": osm_surface,
            "highway": highway,
            "width_m": width_m,
            "steps": steps,
            "access": access,
            "foot": foot,
            "wheelchair": wheelchair,
            "handrail": handrail,
            "smoothness": smoothness,
            "seasonal": seasonal,
            "source_kind": source_kind,
            "osm_way_ids": sorted({c["osm_way_id"] for c in candidates}, key=int),
            "osm_traversals": [
                {
                    "osm_way_id": c["osm_way_id"],
                    "osm_way_direction": c["osm_way_direction"],
                    "from_osm_node": c["from_osm_node"],
                    "to_osm_node": c["to_osm_node"],
                }
                for c in candidates
            ],
            "source_ambiguity": len(candidates) > 1,
            "route_edge_ids": sorted({occurrence["edge_id"] for occurrence in occurrences}),
            "source_ids": ["data/edges.json", "data/sources/osm-map/*.xml", "data/sources/elevation/points.json"],
        }
        if source_kind == "representative_point_snap_connector":
            segment["accessibility_status"] = "unknown_unmapped_connector"
        segments.append(segment)
        path_nodes[from_id]["next_segment_ids"].append(segment_id)
        path_nodes[to_id]["previous_segment_ids"].append(segment_id)

    add_full_source_scope(path_nodes, segments, network, topology_elevations)

    # Recompute adjacency lists from the merged topology so old path-node IDs
    # remain stable while newly exposed branch choices become visible.
    for node in path_nodes.values():
        node["next_segment_ids"] = []
        node["previous_segment_ids"] = []
    segment_ids: set[str] = set()
    for segment in segments:
        if segment["id"] in segment_ids:
            raise RuntimeError(f"duplicate path segment id after Phase-8 merge: {segment['id']}")
        segment_ids.add(segment["id"])
        if segment["from"] not in path_nodes or segment["to"] not in path_nodes:
            raise RuntimeError(f"segment endpoint missing after Phase-8 merge: {segment['id']}")
        path_nodes[segment["from"]]["next_segment_ids"].append(segment["id"])
        path_nodes[segment["to"]]["previous_segment_ids"].append(segment["id"])
    for node in path_nodes.values():
        node["next_segment_ids"].sort()
        node["previous_segment_ids"].sort()

    connected_components = topology_components(path_nodes, segments)
    coverage = dict(network["coverage"])
    coverage.update(
        {
            "final_path_nodes": len(path_nodes),
            "final_directed_segments": len(segments),
            "final_connected_components": len(connected_components),
            "final_component_path_node_sizes": [
                component["path_node_count"] for component in connected_components
            ],
        }
    )

    doc = {
        "schema_version": 1,
        "generated_at": max(
            timestamp
            for timestamp in (
                place_doc.get("generated_at"),
                edge_doc.get("generated_at"),
                elevation_retrieved_at,
                topology_elevation_retrieved_at,
            )
            if timestamp
        ),
        "status": "qualified_complete_preserved_source_scope",
        "derived_metric_profile": path_derived_metric_profile(
            max(
                timestamp
                for timestamp in (elevation_retrieved_at, topology_elevation_retrieved_at)
                if timestamp
            )
        ),
        "path_node_count": len(path_nodes),
        "directed_segment_count": len(segments),
        "path_nodes": [path_nodes[node_id] for node_id in sorted(path_nodes)],
        "directed_segments": segments,
        "connected_components": connected_components,
        "coverage": coverage,
        "excluded_source_ways": network["excluded_ways"],
        "blocked_source_adjacencies": network["blocked_adjacencies"],
        "model": {
            "next_function_representation": "Each path node's next_segment_ids serializes the available directed functions to neighboring path nodes.",
            "scope": "Complete under the explicit preserved-source selection policy: every pedestrian-eligible OSM source chain in/at mapped Bergpark boundary way/608171475, plus the exact Phase-7 route-projection extension needed to keep the 122 qualified landmark routes stable. This is not a physical-world completeness claim.",
            "compression_policy": "Graph nodes are kept at intersections/branch points, source-way run endpoints, source node access/barrier/entrance transitions, boundary crossings, and every Phase-7 route path node. Intermediate source geometry points remain verbatim in segment polylines.",
            "snap_connector_policy": "Landmark representative-point to OSM-network connectors retain unknown surface/access/steps rather than inheriting path tags.",
            "grade_policy": "Per-segment grade/ascent/descent are emitted only for segments at least 90 m long. Shorter segments retain raw endpoint DEM elevations/delta but suppress derived terrain metrics because GLO-90 cannot support them at that scale.",
            "pedestrian_direction_policy": "Generic vehicle oneway is factual metadata only. Pedestrian one-way traversal is enforced only from source-backed oneway:foot/foot:oneway or conveying direction evidence; every other source chain has an explicit reverse.",
            "accessibility_policy": "Known negative evidence is retained; missing access/wheelchair/barrier evidence remains unknown and no route is called accessible merely because it is routable.",
        },
        "provenance": {
            "route_edges": "data/edges.json",
            "osm_snapshots": "data/sources/osm-map/*.xml",
            "elevation": "data/sources/elevation/points.json",
            "expanded_topology_elevation": "data/sources/path-topology-elevation/points.json",
            "expanded_topology_elevation_selection_sha256": topology_elevation_selection_sha256(
                topology_elevation_selection_records(network)
            ),
            "osm_license": "ODbL-1.0",
        },
    }
    (DATA / "path_topology.json").write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
    print(f"wrote {len(path_nodes)} path nodes and {len(segments)} directed low-level segments")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
