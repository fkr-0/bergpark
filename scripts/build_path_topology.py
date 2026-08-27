#!/usr/bin/env python3
"""Project qualified landmark routes into explicit path nodes/segments.

This is the serializable equivalent of a "function to the next path node": a
path node lists directed next-segment IDs, while each segment contains its
target, geometry, distance, terrain change and source-backed traversal facts.
"""

from __future__ import annotations

import hashlib
import json
import math
import pathlib
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any


ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
MAP_DIR = DATA / "sources" / "osm-map"


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
]:
    nodes: dict[str, tuple[float, float]] = {}
    ways: dict[str, tuple[list[str], dict[str, str]]] = {}
    for path in sorted(MAP_DIR.glob("*.xml")):
        root = ET.parse(path).getroot()
        for node in root.findall("node"):
            nodes[node.attrib["id"]] = coord_key(node.attrib["lat"], node.attrib["lon"])
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
    return nodes, adjacency


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


def main() -> int:
    place_doc = json.loads((DATA / "nodes.json").read_text())
    edge_doc = json.loads((DATA / "edges.json").read_text())
    elevation_doc = json.loads((DATA / "sources" / "elevation" / "points.json").read_text())
    places = place_doc["nodes"]
    edges = edge_doc["edges"]
    osm_nodes, adjacency = load_osm()

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
            position_source = {
                "kind": "place_representative_point",
                "place_ids": related_places,
                "coordinate_sources": [p.get("coordinate_source") for p in place_at[coord]],
                "horizontal_accuracy_m": None,
                "accuracy_status": "not_reported_or_representative_geometry",
            }
        elif osm_ids:
            node_id = f"pathnode-osm-{osm_ids[0]}"
            position_source = {
                "kind": "osm_path_node",
                "provider": "OpenStreetMap",
                "elements": [f"node/{node_id_}" for node_id_ in osm_ids],
                "license": "ODbL-1.0",
                "horizontal_accuracy_m": None,
                "accuracy_status": "not_reported_by_source",
            }
        else:
            node_id = fallback_node_id(coord)
            position_source = {
                "kind": "qualified_route_coordinate",
                "source": "data/edges.json",
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
                "snapshot": "data/sources/elevation/points.json",
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

    for node in path_nodes.values():
        node["next_segment_ids"].sort()
        node["previous_segment_ids"].sort()

    doc = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "qualified_route_topology_projection",
        "path_node_count": len(path_nodes),
        "directed_segment_count": len(segments),
        "path_nodes": [path_nodes[node_id] for node_id in sorted(path_nodes)],
        "directed_segments": segments,
        "model": {
            "next_function_representation": "Each path node's next_segment_ids serializes the available directed functions to neighboring path nodes.",
            "scope": "Projection of the 122 qualified landmark walking edges, not every walkable OSM way in the park.",
            "snap_connector_policy": "Landmark representative-point to OSM-network connectors retain unknown surface/access/steps rather than inheriting path tags.",
            "grade_policy": "Per-segment grade/ascent/descent are emitted only for segments at least 90 m long. Shorter segments retain raw endpoint DEM elevations/delta but suppress derived terrain metrics because GLO-90 cannot support them at that scale.",
        },
        "provenance": {
            "route_edges": "data/edges.json",
            "osm_snapshots": "data/sources/osm-map/*.xml",
            "elevation": "data/sources/elevation/points.json",
            "osm_license": "ODbL-1.0",
        },
    }
    (DATA / "path_topology.json").write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
    print(f"wrote {len(path_nodes)} path nodes and {len(segments)} directed low-level segments")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
