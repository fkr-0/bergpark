"""Frozen-source walking-network selection for Bergpark path topology.

This module never performs network I/O.  It derives the Phase-8 intended source
scope from the four preserved OSM ``/api/0.6/map`` tile snapshots.  "Complete"
therefore means complete under this explicit selection policy and these frozen
snapshots; it is not a claim that OSM or the mapped park boundary is a complete
physical inventory.
"""

from __future__ import annotations

import hashlib
import json
import pathlib
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
MAP_DIR = DATA / "sources" / "osm-map"
PATHS_SNAPSHOT = DATA / "sources" / "osm-paths.json"
PARK_BOUNDARY_WAY_ID = "608171475"
EXPECTED_TILES = {
    "ne.xml": (51.315, 9.405, 51.323, 9.425),
    "nw.xml": (51.315, 9.385, 51.323, 9.405),
    "se.xml": (51.307, 9.405, 51.315, 9.425),
    "sw.xml": (51.307, 9.385, 51.315, 9.405),
}
WALKABLE_HIGHWAYS = {
    "footway",
    "path",
    "steps",
    "pedestrian",
    "track",
    "service",
    "living_street",
    "residential",
    "unclassified",
    "tertiary",
}
PEDESTRIAN_EXCEPTIONS = {"yes", "designated", "permissive"}
RELEVANT_NODE_TAGS = {
    "access",
    "barrier",
    "crossing",
    "entrance",
    "foot",
    "highway",
    "wheelchair",
}


def sha256_file(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def coord_key(lat: float, lng: float) -> tuple[float, float]:
    return round(float(lat), 7), round(float(lng), 7)


def _snapshot_ref(path: pathlib.Path) -> str:
    return f"data/sources/osm-map/{path.name}"


def load_osm_snapshots() -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]], list[dict[str, Any]]]:
    """Load and cross-tile reconcile exact OSM node/way identities."""
    paths = sorted(MAP_DIR.glob("*.xml"))
    if {path.name for path in paths} != set(EXPECTED_TILES):
        raise RuntimeError("expected exactly preserved OSM map snapshots ne/nw/se/sw.xml")

    nodes: dict[str, dict[str, Any]] = {}
    ways: dict[str, dict[str, Any]] = {}
    snapshot_records: list[dict[str, Any]] = []
    for path in paths:
        root = ET.parse(path).getroot()
        bounds = root.find("bounds")
        if bounds is None:
            raise RuntimeError(f"{path.name} lacks OSM map bounds")
        actual = tuple(float(bounds.attrib[key]) for key in ("minlat", "minlon", "maxlat", "maxlon"))
        if actual != EXPECTED_TILES[path.name]:
            raise RuntimeError(f"{path.name} bounds drifted: {actual!r}")
        snapshot_records.append(
            {
                "path": _snapshot_ref(path),
                "sha256": sha256_file(path),
                "bounds": {
                    "south": actual[0],
                    "west": actual[1],
                    "north": actual[2],
                    "east": actual[3],
                },
            }
        )

        for element in root:
            if element.tag == "node":
                node_id = element.attrib["id"]
                coord = coord_key(element.attrib["lat"], element.attrib["lon"])
                tags = {tag.attrib["k"]: tag.attrib["v"] for tag in element.findall("tag")}
                row = nodes.setdefault(
                    node_id,
                    {
                        "id": node_id,
                        "coord": coord,
                        "version": element.attrib.get("version"),
                        "timestamp": element.attrib.get("timestamp"),
                        "tags": {},
                        "snapshot_refs": set(),
                    },
                )
                if row["coord"] != coord:
                    raise RuntimeError(f"OSM node {node_id} differs across preserved snapshots")
                row["tags"].update(tags)
                row["snapshot_refs"].add(_snapshot_ref(path))
                versions = [value for value in (row.get("version"), element.attrib.get("version")) if value]
                if versions:
                    row["version"] = max(versions, key=int)
                timestamps = [value for value in (row.get("timestamp"), element.attrib.get("timestamp")) if value]
                if timestamps:
                    row["timestamp"] = max(timestamps)
            elif element.tag == "way":
                way_id = element.attrib["id"]
                refs = [nd.attrib["ref"] for nd in element.findall("nd")]
                tags = {tag.attrib["k"]: tag.attrib["v"] for tag in element.findall("tag")}
                row = ways.setdefault(
                    way_id,
                    {
                        "id": way_id,
                        "refs": refs,
                        "version": element.attrib.get("version"),
                        "timestamp": element.attrib.get("timestamp"),
                        "tags": tags,
                        "snapshot_refs": set(),
                    },
                )
                if row["refs"] != refs or row["tags"] != tags:
                    raise RuntimeError(f"OSM way {way_id} differs across preserved snapshots")
                row["snapshot_refs"].add(_snapshot_ref(path))
                versions = [value for value in (row.get("version"), element.attrib.get("version")) if value]
                if versions:
                    row["version"] = max(versions, key=int)
                timestamps = [value for value in (row.get("timestamp"), element.attrib.get("timestamp")) if value]
                if timestamps:
                    row["timestamp"] = max(timestamps)

    for way in ways.values():
        missing = [node_id for node_id in way["refs"] if node_id not in nodes]
        # Map API may include a way that continues outside the requested tiles.  A
        # segment is usable only where both source nodes were preserved; the
        # coverage report records incomplete-way references explicitly.
        way["missing_node_refs"] = missing
    return nodes, ways, snapshot_records


def park_polygon(nodes: dict[str, dict[str, Any]], ways: dict[str, dict[str, Any]]) -> tuple[list[tuple[float, float]], set[str], dict[str, Any]]:
    boundary = ways.get(PARK_BOUNDARY_WAY_ID)
    if boundary is None or boundary["tags"].get("name") != "Bergpark Wilhelmshöhe":
        raise RuntimeError("preserved OSM Bergpark boundary way/608171475 missing")
    if boundary["missing_node_refs"]:
        raise RuntimeError("preserved Bergpark boundary geometry is incomplete")
    coords = [nodes[node_id]["coord"] for node_id in boundary["refs"]]
    if len(coords) < 4 or coords[0] != coords[-1]:
        raise RuntimeError("Bergpark boundary must be a closed source way")
    return coords, set(boundary["refs"]), boundary


def point_in_polygon(coord: tuple[float, float], polygon: list[tuple[float, float]]) -> bool:
    lat, lng = coord
    x, y = lng, lat
    inside = False
    xy = [(lon, plat) for plat, lon in polygon]
    for (x1, y1), (x2, y2) in zip(xy, xy[1:]):
        if (y1 > y) != (y2 > y):
            crossing_x = (x2 - x1) * (y - y1) / (y2 - y1) + x1
            if x < crossing_x:
                inside = not inside
    return inside


def _orientation(a: tuple[float, float], b: tuple[float, float], c: tuple[float, float]) -> float:
    # Work in lng/lat plane; this is only a bounded source-scope intersection
    # classification, never a routing distance or accuracy metric.
    ax, ay = a[1], a[0]
    bx, by = b[1], b[0]
    cx, cy = c[1], c[0]
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)


def _on_segment(a: tuple[float, float], b: tuple[float, float], p: tuple[float, float]) -> bool:
    eps = 1e-12
    return (
        min(a[0], b[0]) - eps <= p[0] <= max(a[0], b[0]) + eps
        and min(a[1], b[1]) - eps <= p[1] <= max(a[1], b[1]) + eps
        and abs(_orientation(a, b, p)) <= eps
    )


def segments_intersect(a: tuple[float, float], b: tuple[float, float], c: tuple[float, float], d: tuple[float, float]) -> bool:
    o1, o2 = _orientation(a, b, c), _orientation(a, b, d)
    o3, o4 = _orientation(c, d, a), _orientation(c, d, b)
    if (o1 > 0) != (o2 > 0) and (o3 > 0) != (o4 > 0):
        return True
    return any(
        (
            abs(o) <= 1e-12 and _on_segment(x, y, p)
            for o, x, y, p in (
                (o1, a, b, c),
                (o2, a, b, d),
                (o3, c, d, a),
                (o4, c, d, b),
            )
        )
    )


def segment_intersects_polygon(a: tuple[float, float], b: tuple[float, float], polygon: list[tuple[float, float]]) -> bool:
    return any(segments_intersect(a, b, c, d) for c, d in zip(polygon, polygon[1:]))


def way_pedestrian_policy(tags: dict[str, str]) -> tuple[bool, str]:
    highway = tags.get("highway")
    if highway not in WALKABLE_HIGHWAYS:
        return False, "highway_not_in_phase2_walkable_policy"
    if tags.get("foot") == "no":
        return False, "foot_no"
    if tags.get("access") in {"private", "no"} and tags.get("foot") not in PEDESTRIAN_EXCEPTIONS:
        return False, "access_private_or_no_without_pedestrian_exception"
    return True, "included"


def node_pedestrian_block(tags: dict[str, str]) -> str | None:
    if tags.get("foot") == "no":
        return "node_foot_no"
    if tags.get("access") in {"private", "no"} and tags.get("foot") not in PEDESTRIAN_EXCEPTIONS:
        return "node_access_private_or_no_without_pedestrian_exception"
    return None


def pedestrian_oneway(tags: dict[str, str]) -> tuple[str, str | None]:
    """Return pedestrian direction: both/forward/reverse and source reason.

    Generic ``oneway`` is deliberately not promoted to a pedestrian restriction;
    OSM vehicle one-way semantics do not, by themselves, establish foot one-way.
    """
    raw = tags.get("oneway:foot", tags.get("foot:oneway"))
    if raw is not None:
        value = raw.strip().lower()
        if value in {"yes", "1", "true"}:
            return "forward", f"source tag oneway:foot={raw}"
        if value in {"-1", "reverse"}:
            return "reverse", f"source tag oneway:foot={raw}"
        if value in {"no", "0", "false"}:
            return "both", None
        return "both", None
    conveying = tags.get("conveying")
    if tags.get("highway") == "steps" and conveying in {"forward", "backward"}:
        direction = "forward" if conveying == "forward" else "reverse"
        return direction, f"source tag conveying={conveying}"
    return "both", None


def route_coordinate_path_ids(nodes: dict[str, dict[str, Any]]) -> tuple[dict[tuple[float, float], str], set[str]]:
    """Recreate the Phase-7 route-coordinate path-node namespace from inputs."""
    place_doc = json.loads((DATA / "nodes.json").read_text())
    edge_doc = json.loads((DATA / "edges.json").read_text())
    place_at: dict[tuple[float, float], list[str]] = defaultdict(list)
    for place in place_doc["nodes"]:
        place_at[coord_key(place["lat"], place["lng"])].append(place["id"])
    osm_at: dict[tuple[float, float], list[str]] = defaultdict(list)
    for node_id, node in nodes.items():
        osm_at[node["coord"]].append(node_id)

    path_id_by_coord: dict[tuple[float, float], str] = {}
    route_osm_ids: set[str] = set()
    for edge in edge_doc["edges"]:
        for lat, lng in edge["path_coordinates"]:
            coord = coord_key(lat, lng)
            if coord in path_id_by_coord:
                continue
            related_places = sorted(set(place_at.get(coord, [])))
            osm_ids = sorted(set(osm_at.get(coord, [])), key=int)
            route_osm_ids.update(osm_ids)
            if related_places:
                path_id_by_coord[coord] = f"pathnode-place-{related_places[0]}"
            elif osm_ids:
                path_id_by_coord[coord] = f"pathnode-osm-{osm_ids[0]}"
            else:
                digest = hashlib.sha1(f"{coord[0]:.7f},{coord[1]:.7f}".encode()).hexdigest()[:12]
                path_id_by_coord[coord] = f"pathnode-coordinate-{digest}"
    return path_id_by_coord, route_osm_ids


def _adjacency_scope(
    a: str,
    b: str,
    *,
    nodes: dict[str, dict[str, Any]],
    polygon: list[tuple[float, float]],
    boundary_nodes: set[str],
) -> str | None:
    ca, cb = nodes[a]["coord"], nodes[b]["coord"]
    a_inside = a in boundary_nodes or point_in_polygon(ca, polygon)
    b_inside = b in boundary_nodes or point_in_polygon(cb, polygon)
    if a_inside and b_inside:
        return "inside_park_source_boundary"
    if a_inside or b_inside or segment_intersects_polygon(ca, cb, polygon):
        return "boundary_crossing_source_segment"
    return None


def build_source_network() -> dict[str, Any]:
    nodes, ways, snapshots = load_osm_snapshots()
    polygon, boundary_nodes, boundary = park_polygon(nodes, ways)
    route_path_by_coord, route_osm_ids = route_coordinate_path_ids(nodes)

    source_highway_way_ids = {way_id for way_id, way in ways.items() if "highway" in way["tags"]}
    touching_way_ids: set[str] = set()
    selected_way_ids: set[str] = set()
    excluded_ways: dict[str, dict[str, Any]] = {}
    adjacency_by_way: dict[str, list[dict[str, Any]]] = defaultdict(list)
    blocked_adjacencies: list[dict[str, Any]] = []
    degree: Counter[str] = Counter()
    ways_at_node: dict[str, set[str]] = defaultdict(set)

    for way_id in sorted(source_highway_way_ids, key=int):
        way = ways[way_id]
        tags = way["tags"]
        refs = way["refs"]
        scoped_pairs: list[tuple[int, str, str, str]] = []
        for index, (a, b) in enumerate(zip(refs, refs[1:])):
            if a not in nodes or b not in nodes:
                continue
            relation = _adjacency_scope(
                a,
                b,
                nodes=nodes,
                polygon=polygon,
                boundary_nodes=boundary_nodes,
            )
            if relation is not None:
                scoped_pairs.append((index, a, b, relation))
        if not scoped_pairs:
            continue
        touching_way_ids.add(way_id)
        allowed, reason = way_pedestrian_policy(tags)
        if not allowed:
            excluded_ways[way_id] = {
                "osm_way_id": way_id,
                "reason": reason,
                "highway": tags.get("highway"),
                "access": tags.get("access"),
                "foot": tags.get("foot"),
                "name": tags.get("name"),
                "snapshot_refs": sorted(way["snapshot_refs"]),
            }
            continue

        selected_way_ids.add(way_id)
        for index, a, b, relation in scoped_pairs:
            a_block = node_pedestrian_block(nodes[a]["tags"])
            b_block = node_pedestrian_block(nodes[b]["tags"])
            if a_block or b_block:
                blocked_adjacencies.append(
                    {
                        "osm_way_id": way_id,
                        "way_index": index,
                        "from_osm_node": a,
                        "to_osm_node": b,
                        "reason": a_block or b_block,
                        "blocked_node_ids": [node_id for node_id, why in ((a, a_block), (b, b_block)) if why],
                    }
                )
                continue
            row = {
                "osm_way_id": way_id,
                "way_index": index,
                "from_osm_node": a,
                "to_osm_node": b,
                "scope_relation": relation,
            }
            adjacency_by_way[way_id].append(row)
            degree[a] += 1
            degree[b] += 1
            ways_at_node[a].add(way_id)
            ways_at_node[b].add(way_id)

    source_node_ids = set(degree)
    meaningful: set[str] = set(route_osm_ids) & source_node_ids
    reasons_by_node: dict[str, set[str]] = defaultdict(set)
    for node_id in meaningful:
        reasons_by_node[node_id].add("phase7_route_projection_node")
    for node_id in source_node_ids:
        if degree[node_id] != 2:
            meaningful.add(node_id)
            reasons_by_node[node_id].add("network_degree_not_two")
        if len(ways_at_node[node_id]) > 1:
            meaningful.add(node_id)
            reasons_by_node[node_id].add("multiple_source_ways")
        if RELEVANT_NODE_TAGS & set(nodes[node_id]["tags"]):
            meaningful.add(node_id)
            reasons_by_node[node_id].add("source_node_tag_transition")

    # Split every way wherever the scoped selection has a gap and preserve each
    # run endpoint.  This ensures boundary and blocked-node exclusions cannot be
    # silently bridged by a compressed segment.
    runs_by_way: dict[str, list[list[dict[str, Any]]]] = defaultdict(list)
    for way_id, rows in adjacency_by_way.items():
        rows = sorted(rows, key=lambda row: row["way_index"])
        run: list[dict[str, Any]] = []
        previous_index: int | None = None
        for row in rows:
            if previous_index is None or row["way_index"] == previous_index + 1:
                run.append(row)
            else:
                if run:
                    runs_by_way[way_id].append(run)
                run = [row]
            previous_index = row["way_index"]
        if run:
            runs_by_way[way_id].append(run)
        for selected_run in runs_by_way[way_id]:
            for node_id in (selected_run[0]["from_osm_node"], selected_run[-1]["to_osm_node"]):
                meaningful.add(node_id)
                reasons_by_node[node_id].add("selected_way_run_endpoint")
            for row in selected_run:
                if row["scope_relation"] == "boundary_crossing_source_segment":
                    for node_id in (row["from_osm_node"], row["to_osm_node"]):
                        meaningful.add(node_id)
                        reasons_by_node[node_id].add("boundary_crossing_endpoint")

    chains: list[dict[str, Any]] = []
    for way_id in sorted(runs_by_way, key=int):
        way = ways[way_id]
        for run in runs_by_way[way_id]:
            raw_nodes = [run[0]["from_osm_node"]] + [row["to_osm_node"] for row in run]
            start = 0
            for index in range(1, len(raw_nodes)):
                if raw_nodes[index] not in meaningful:
                    continue
                chain_nodes = raw_nodes[start : index + 1]
                if len(chain_nodes) >= 2:
                    scope_relations = sorted({row["scope_relation"] for row in run[start:index]})
                    chains.append(
                        {
                            "osm_way_id": way_id,
                            "osm_way_version": way.get("version"),
                            "source_timestamp": way.get("timestamp"),
                            "snapshot_refs": sorted(way["snapshot_refs"]),
                            "source_node_ids": chain_nodes,
                            "geometry": [[nodes[node_id]["coord"][0], nodes[node_id]["coord"][1]] for node_id in chain_nodes],
                            "tags": dict(way["tags"]),
                            "scope_relations": scope_relations,
                        }
                    )
                start = index
            if start != len(raw_nodes) - 1:
                raise RuntimeError(f"way {way_id} did not terminate at a meaningful source node")

    # Path-node IDs retain Phase-7 names where a route coordinate already owned
    # that coordinate.  New nodes are exact source-node IDs and never merge
    # merely coincident but topologically distinct OSM nodes.
    path_id_by_osm: dict[str, str] = {}
    for node_id in meaningful:
        coord = nodes[node_id]["coord"]
        existing = route_path_by_coord.get(coord)
        if existing and (existing.startswith("pathnode-osm-") or existing.startswith("pathnode-place-")):
            path_id_by_osm[node_id] = existing
        else:
            path_id_by_osm[node_id] = f"pathnode-osm-{node_id}"

    components = _source_components(adjacency_by_way)
    overpass = json.loads(PATHS_SNAPSHOT.read_text()) if PATHS_SNAPSHOT.is_file() else {}
    overpass_way_ids = {
        str(element["id"])
        for element in overpass.get("elements", [])
        if element.get("type") == "way"
    }
    overpass_subset_ok = overpass_way_ids <= source_highway_way_ids

    coverage = {
        "status": "complete_preserved_source_scope_not_physical_inventory",
        "physical_inventory_claim": False,
        "intended_source_scope": (
            "All adjacencies from the preserved OSM map tiles whose source geometry lies in or crosses "
            "the preserved Bergpark boundary way/608171475, restricted by the inherited Phase-2 "
            "pedestrian-highway policy and explicit source access/foot restrictions."
        ),
        "boundary_element": f"way/{PARK_BOUNDARY_WAY_ID}",
        "boundary_source_note": boundary["tags"].get("note"),
        "boundary_quality_status": "source_boundary_explicitly_not_fully_checked",
        "map_snapshots": snapshots,
        "source_highway_ways_in_tile_union": len(source_highway_way_ids),
        "highway_ways_touching_boundary_scope": len(touching_way_ids),
        "included_walkable_ways": len(selected_way_ids),
        "excluded_touching_ways": len(excluded_ways),
        "excluded_way_reasons": dict(sorted(Counter(row["reason"] for row in excluded_ways.values()).items())),
        "blocked_node_adjacencies": len(blocked_adjacencies),
        "raw_selected_adjacencies": sum(len(rows) for rows in adjacency_by_way.values()),
        "raw_selected_source_nodes": len(source_node_ids),
        "meaningful_source_path_nodes": len(meaningful),
        "compressed_undirected_source_chains": len(chains),
        "source_connected_components": len(components),
        "source_component_sizes": [len(component) for component in components],
        "overpass_bbox_highway_snapshot": {
            "path": "data/sources/osm-paths.json",
            "sha256": sha256_file(PATHS_SNAPSHOT) if PATHS_SNAPSHOT.is_file() else None,
            "source_timestamp": overpass.get("osm3s", {}).get("timestamp_osm_base"),
            "way_count": len(overpass_way_ids),
            "all_way_ids_present_in_map_tile_union": overpass_subset_ok,
            "role": "independent preserved bbox cross-check; map tile union remains topology authority because it preserves exact node IDs",
        },
    }
    if not overpass_subset_ok:
        raise RuntimeError("preserved Overpass highway cross-check contains ways absent from OSM map tile union")

    return {
        "nodes": nodes,
        "ways": ways,
        "boundary": boundary,
        "path_id_by_osm": path_id_by_osm,
        "meaningful_osm_node_ids": meaningful,
        "node_reasons": {node_id: sorted(reasons_by_node[node_id]) for node_id in meaningful},
        "chains": chains,
        "excluded_ways": [excluded_ways[way_id] for way_id in sorted(excluded_ways, key=int)],
        "blocked_adjacencies": blocked_adjacencies,
        "coverage": coverage,
    }


def _source_components(adjacency_by_way: dict[str, list[dict[str, Any]]]) -> list[set[str]]:
    graph: dict[str, set[str]] = defaultdict(set)
    for rows in adjacency_by_way.values():
        for row in rows:
            a, b = row["from_osm_node"], row["to_osm_node"]
            graph[a].add(b)
            graph[b].add(a)
    unseen = set(graph)
    components: list[set[str]] = []
    while unseen:
        start = min(unseen, key=int)
        stack = [start]
        component = {start}
        unseen.remove(start)
        while stack:
            current = stack.pop()
            for neighbor in graph[current]:
                if neighbor in unseen:
                    unseen.remove(neighbor)
                    component.add(neighbor)
                    stack.append(neighbor)
        components.append(component)
    components.sort(key=lambda component: (-len(component), min(map(int, component))))
    return components


def topology_elevation_selection_records(network: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    network = network or build_source_network()
    records = []
    seen_path_ids: set[str] = set()
    for osm_node_id in sorted(network["meaningful_osm_node_ids"], key=int):
        path_node_id = network["path_id_by_osm"][osm_node_id]
        # A source-point place may own the exact coordinate/path-node ID. Its
        # Phase-7 elevation is already preserved in the core elevation snapshot.
        if path_node_id.startswith("pathnode-place-"):
            continue
        if path_node_id in seen_path_ids:
            raise RuntimeError(f"multiple OSM nodes collapse onto path node {path_node_id}")
        seen_path_ids.add(path_node_id)
        node = network["nodes"][osm_node_id]
        records.append(
            {
                "path_node_id": path_node_id,
                "osm_node_id": osm_node_id,
                "lat": node["coord"][0],
                "lng": node["coord"][1],
            }
        )
    return records


def topology_elevation_selection_sha256(records: list[dict[str, Any]] | None = None) -> str:
    records = records or topology_elevation_selection_records()
    encoded = json.dumps(records, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()
