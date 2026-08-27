#!/usr/bin/env python3
"""Build the Bergpark place/path graph from public spatial snapshots.

No third-party Python packages are required. Phase 2 enriches the Phase-1 OSM
graph with a preserved Copernicus GLO-90 terrain snapshot. Phase 3 composes the
curated semantic and tree layers into graph.json without regenerating or
overwriting those independently owned layer files.
"""

from __future__ import annotations

import heapq
import json
import math
import os
import pathlib
import xml.etree.ElementTree as ET
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

try:
    from .compose_graph import compose_graph
except ImportError:  # Direct `python scripts/build_graph.py` execution.
    from compose_graph import compose_graph


ROOT = pathlib.Path(__file__).resolve().parents[1]
CANONICAL_DATA = ROOT / "data"
DATA = pathlib.Path(os.environ.get("BERGPARK_OUTPUT_DATA", str(CANONICAL_DATA))).resolve()
SOURCES = CANONICAL_DATA / "sources"
ELEVATION_POINTS = SOURCES / "elevation" / "points.json"

# The supplied 9.400..9.420E seed box excludes the Herkules. This broader box
# is derived from the actual OSM/UNESCO park geography and is deliberately
# audited in validation.json.
PARK_BBOX = {
    "south": 51.307,
    "west": 9.385,
    "north": 51.323,
    "east": 9.425,
}
REJECTED_SEED_BBOX = {
    "south": 51.312,
    "west": 9.400,
    "north": 51.322,
    "east": 9.420,
}


@dataclass(frozen=True)
class PlaceSpec:
    id: str
    de: str
    en: str
    type: str
    osm_type: str
    osm_id: int
    aliases: tuple[str, ...] = ()


PLACE_SPECS = (
    PlaceSpec("herkules", "Herkules / Oktogon", "Hercules Monument / Octagon", "monument", "relation", 164756),
    PlaceSpec("kaskaden", "Große Kaskaden", "Great Cascades", "waterfeature", "node", 3923243905, ("Kaskaden",)),
    PlaceSpec("neptunbecken", "Neptunbecken", "Neptune Basin", "waterfeature", "node", 2912938750),
    PlaceSpec("felseneck", "Felseneck", "Felseneck", "viewpoint", "way", 389165294),
    PlaceSpec("steinhofer-wasserfall", "Steinhöfer Wasserfall", "Steinhöfer Waterfall", "waterfeature", "way", 600205054),
    PlaceSpec("teufelsbruecke", "Teufelsbrücke", "Devil's Bridge", "bridge", "way", 541136210),
    PlaceSpec("aquaedukt", "Aquädukt", "Aqueduct", "waterfeature", "way", 499181982),
    PlaceSpec("plutogrotte", "Plutogrotte", "Pluto Grotto", "grotto", "way", 389164993),
    PlaceSpec("eremitage", "Eremitage des Sokrates", "Hermitage of Socrates", "grotto", "way", 541728530),
    PlaceSpec("cestius-pyramide", "Cestiuspyramide", "Pyramid of Cestius", "monument", "way", 541144378, ("Cestius-Pyramide",)),
    PlaceSpec("vergils-grab", "Grabmal des Vergil", "Tomb of Virgil", "monument", "way", 541585797, ("Vergils Grab",)),
    PlaceSpec("jussow-tempel", "Jussow-Tempel", "Jussow Temple", "temple", "way", 321469909, ("Apollotempel",)),
    PlaceSpec("peneuskaskaden", "Peneuskaskaden", "Peneus Cascades", "waterfeature", "node", 3163220629),
    PlaceSpec("fontaenenteich", "Fontänenteich", "Fountain Pond", "lake", "relation", 7321251),
    PlaceSpec("grosse-fontaene", "Große Fontäne", "Great Fountain", "waterfeature", "node", 373197742),
    PlaceSpec("schloss", "Schloss Wilhelmshöhe", "Wilhelmshöhe Palace", "palace", "way", 183224852),
    PlaceSpec("ballhaus", "Ballhaus", "Ballroom", "building", "way", 33077249),
    PlaceSpec("gewaechshaus", "Großes Gewächshaus", "Great Greenhouse", "building", "way", 31735163, ("Gewächshaus",)),
    PlaceSpec("lac", "Lac", "Lac", "lake", "relation", 7723238),
    PlaceSpec("loewenburg", "Löwenburg", "Löwenburg Castle", "castle", "relation", 6241813),
    PlaceSpec("mulang", "Dorf Mulang", "Mulang Village", "village", "node", 3923256516, ("Parkdorf Mulang",)),
    PlaceSpec("entenfang", "Entenfang", "Duck Pond", "pond", "way", 83586933, ("Entenpfuhl (seed label)",)),
    PlaceSpec("neuer-wasserfall", "Neuer Wasserfall", "New Waterfall", "waterfeature", "way", 547719842),
    PlaceSpec("halle-des-sokrates", "Halle des Sokrates", "Hall of Socrates", "temple", "way", 321469908),
    PlaceSpec("merkurtempel", "Merkurtempel", "Temple of Mercury", "temple", "way", 389166242),
    PlaceSpec("sibyllengrotte", "Sibyllengrotte", "Sibyl Grotto", "grotto", "node", 674079825),
    PlaceSpec("pagode", "Pagode", "Pagoda", "building", "way", 214802668),
    PlaceSpec("kleiner-herkules", "Kleiner Herkules", "Little Hercules", "ruin", "way", 607746853),
    PlaceSpec("vexierwassergrotte", "Vexierwassergrotte", "Vexing Water Grotto", "grotto", "way", 646446140),
    PlaceSpec("fontaenenreservoir", "Fontänenreservoir", "Fountain Reservoir", "waterfeature", "way", 42022370),
)


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


def haversine(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371008.8 * 2 * math.asin(math.sqrt(h))


def coordinate_key(lat: float, lng: float) -> tuple[float, float]:
    return round(float(lat), 7), round(float(lng), 7)


def load_elevations() -> tuple[dict[tuple[float, float], float], dict[str, Any]]:
    if not ELEVATION_POINTS.is_file():
        raise FileNotFoundError(
            f"missing Phase-2 terrain snapshot {ELEVATION_POINTS}; run scripts/fetch_elevation.py"
        )
    doc = json.loads(ELEVATION_POINTS.read_text())
    points = {
        coordinate_key(row["lat"], row["lng"]): float(row["elevation_m"])
        for row in doc["points"]
    }
    return points, doc["source"]


def elevation_at(
    elevations: dict[tuple[float, float], float], lat: float, lng: float
) -> float:
    key = coordinate_key(lat, lng)
    if key not in elevations:
        raise KeyError(f"terrain elevation missing for {key[0]},{key[1]}")
    return elevations[key]


def load_pois() -> dict[tuple[str, int], dict[str, Any]]:
    doc = json.loads((SOURCES / "osm-pois.json").read_text())
    return {(e["type"], int(e["id"])): e for e in doc["elements"]}


def representative_point(element: dict[str, Any]) -> tuple[float, float, str]:
    if element["type"] == "node":
        return float(element["lat"]), float(element["lon"]), "osm_node"
    if element.get("center"):
        c = element["center"]
        return float(c["lat"]), float(c["lon"]), "osm_center"
    if element.get("bounds"):
        b = element["bounds"]
        return (
            (float(b["minlat"]) + float(b["maxlat"])) / 2,
            (float(b["minlon"]) + float(b["maxlon"])) / 2,
            "osm_bounds_midpoint",
        )
    points: list[tuple[float, float]] = []
    for p in element.get("geometry", []) or []:
        if "lat" in p:
            points.append((float(p["lat"]), float(p["lon"])))
    if points:
        return (
            sum(p[0] for p in points) / len(points),
            sum(p[1] for p in points) / len(points),
            "osm_geometry_mean",
        )
    raise ValueError(f"No coordinate geometry for {element['type']}/{element['id']}")


def build_places(
    pois: dict[tuple[str, int], dict[str, Any]],
    elevations: dict[tuple[float, float], float],
) -> list[dict[str, Any]]:
    out = []
    for spec in PLACE_SPECS:
        key = (spec.osm_type, spec.osm_id)
        if key not in pois:
            raise KeyError(f"Missing source element {spec.osm_type}/{spec.osm_id} for {spec.id}")
        source = pois[key]
        lat, lng, method = representative_point(source)
        tags = source.get("tags", {})
        out.append(
            {
                "id": spec.id,
                "kind": "place",
                "name": {"de": spec.de, "en": spec.en},
                "aliases": list(spec.aliases),
                "type": spec.type,
                "lat": round(lat, 7),
                "lng": round(lng, 7),
                "elevation_m": elevation_at(elevations, lat, lng),
                "elevation_source": {
                    "provider": "Open-Meteo Elevation API",
                    "dataset": "Copernicus DEM 2021 GLO-90",
                    "resolution_m": 90,
                    "snapshot": "data/sources/elevation/points.json",
                },
                "coordinate_confidence": "high" if spec.osm_type in {"node", "way"} else "medium",
                "coordinate_method": method,
                "coordinate_source": {
                    "provider": "OpenStreetMap",
                    "element": f"{spec.osm_type}/{spec.osm_id}",
                    "license": "ODbL-1.0",
                },
                "osm_tags": {
                    k: tags[k]
                    for k in ("historic", "tourism", "building", "man_made", "natural", "water", "wikidata", "wikipedia", "start_date")
                    if k in tags
                },
            }
        )
    return out


def load_osm_map() -> tuple[dict[str, tuple[float, float]], dict[str, dict[str, Any]]]:
    nodes: dict[str, tuple[float, float]] = {}
    ways: dict[str, dict[str, Any]] = {}
    for path in sorted((SOURCES / "osm-map").glob("*.xml")):
        root = ET.parse(path).getroot()
        for node in root.findall("node"):
            nodes[node.attrib["id"]] = (float(node.attrib["lat"]), float(node.attrib["lon"]))
        for way in root.findall("way"):
            wid = way.attrib["id"]
            if wid in ways:
                continue
            tags = {t.attrib["k"]: t.attrib["v"] for t in way.findall("tag")}
            refs = [n.attrib["ref"] for n in way.findall("nd")]
            ways[wid] = {"id": wid, "tags": tags, "refs": refs}
    return nodes, ways


def route_graph(nodes: dict[str, tuple[float, float]], ways: dict[str, dict[str, Any]]):
    graph: dict[str, list[tuple[str, float, str, dict[str, str]]]] = defaultdict(list)
    route_nodes: set[str] = set()
    for wid, way in ways.items():
        tags = way["tags"]
        highway = tags.get("highway")
        if highway not in WALKABLE_HIGHWAYS:
            continue
        if tags.get("foot") == "no":
            continue
        if tags.get("access") in {"private", "no"} and tags.get("foot") not in {"yes", "designated", "permissive"}:
            continue
        refs = [r for r in way["refs"] if r in nodes]
        for a, b in zip(refs, refs[1:]):
            d = haversine(nodes[a], nodes[b])
            graph[a].append((b, d, wid, tags))
            graph[b].append((a, d, wid, tags))
            route_nodes.update((a, b))
    return graph, route_nodes


def nearest_route_node(point: tuple[float, float], nodes: dict[str, tuple[float, float]], candidates: set[str]) -> tuple[str, float]:
    # The park bbox is small enough for a deterministic linear scan (~40k OSM
    # nodes). This avoids adding a spatial-index dependency to the data build.
    best_id = ""
    best = float("inf")
    for nid in candidates:
        d = haversine(point, nodes[nid])
        if d < best:
            best_id, best = nid, d
    if not best_id:
        raise ValueError("walking network is empty")
    return best_id, best


def dijkstra(
    graph: dict[str, list[tuple[str, float, str, dict[str, str]]]],
    start: str,
    targets: set[str],
) -> dict[str, tuple[float, list[tuple[str, str, dict[str, str]]], list[str]]]:
    dist = {start: 0.0}
    prev: dict[str, tuple[str, str, dict[str, str]]] = {}
    q = [(0.0, start)]
    remaining = set(targets)
    found: dict[str, tuple[float, list[tuple[str, str, dict[str, str]]], list[str]]] = {}
    while q and remaining:
        d, u = heapq.heappop(q)
        if d != dist.get(u):
            continue
        if u in remaining:
            node_path = [u]
            segs: list[tuple[str, str, dict[str, str]]] = []
            cur = u
            while cur != start:
                p, wid, tags = prev[cur]
                segs.append((p, wid, tags))
                node_path.append(p)
                cur = p
            node_path.reverse()
            segs.reverse()
            found[u] = (d, segs, node_path)
            remaining.remove(u)
        for v, w, wid, tags in graph.get(u, []):
            nd = d + w
            if nd < dist.get(v, float("inf")):
                dist[v] = nd
                prev[v] = (u, wid, tags)
                heapq.heappush(q, (nd, v))
    return found


def normalize_surface(raw: str | None, highway: str | None) -> str:
    if highway == "steps":
        return "stone_steps"
    if raw in {"asphalt", "paved", "paving_stones", "sett", "cobblestone", "concrete", "concrete:plates"}:
        return "paved"
    if raw in {"gravel", "fine_gravel", "compacted", "pebblestone"}:
        return "gravel"
    if raw in {"dirt", "earth", "ground", "mud", "unpaved"}:
        return "dirt"
    if raw == "grass":
        return "grass"
    return "unknown"


def way_traversal_direction(refs: list[str], a: str, b: str) -> str:
    for left, right in zip(refs, refs[1:]):
        if left == a and right == b:
            return "forward"
        if left == b and right == a:
            return "reverse"
    return "unknown"


def route_relative_incline(raw: str | None, direction: str) -> str | None:
    if not raw or direction == "unknown":
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


def reverse_surface_segments(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for segment in reversed(segments):
        reversed_segment = dict(segment)
        direction = segment.get("osm_way_direction")
        if direction == "forward":
            direction = "reverse"
        elif direction == "reverse":
            direction = "forward"
        reversed_segment["osm_way_direction"] = direction
        reversed_segment["route_incline"] = route_relative_incline(
            reversed_segment.get("osm_incline"), direction
        )
        out.append(reversed_segment)
    return out


def build_surface_segments(
    node_path: list[str],
    segs: list[tuple[str, str, dict[str, str]]],
    nodes: dict[str, tuple[float, float]],
    ways: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    grouped: list[dict[str, Any]] = []
    for index, (_, wid, tags) in enumerate(segs):
        a, b = node_path[index], node_path[index + 1]
        distance = haversine(nodes[a], nodes[b])
        surface = normalize_surface(tags.get("surface"), tags.get("highway"))
        direction = way_traversal_direction(ways[wid]["refs"], a, b)
        osm_incline = tags.get("incline")
        route_incline = route_relative_incline(osm_incline, direction)
        signature = (
            wid,
            surface,
            tags.get("highway"),
            tags.get("surface"),
            tags.get("smoothness"),
            tags.get("wheelchair"),
            tags.get("access"),
            tags.get("foot"),
            tags.get("handrail"),
            direction,
            osm_incline,
            route_incline,
            tags.get("sac_scale"),
        )
        if grouped and grouped[-1]["_signature"] == signature:
            grouped[-1]["distance_m"] += distance
            continue
        grouped.append(
            {
                "_signature": signature,
                "osm_way_id": wid,
                "distance_m": distance,
                "highway": tags.get("highway"),
                "surface": surface,
                "osm_surface": tags.get("surface"),
                "smoothness": tags.get("smoothness"),
                "wheelchair": tags.get("wheelchair"),
                "access": tags.get("access"),
                "foot": tags.get("foot"),
                "handrail": tags.get("handrail"),
                "osm_way_direction": direction,
                "osm_incline": osm_incline,
                "route_incline": route_incline,
                "sac_scale": tags.get("sac_scale"),
                "steps": tags.get("highway") == "steps",
            }
        )
    for segment in grouped:
        segment.pop("_signature")
        segment["distance_m"] = round(segment["distance_m"], 1)
    return grouped


def summarize_surface(segments: list[dict[str, Any]]) -> dict[str, Any]:
    distances: dict[str, float] = defaultdict(float)
    for segment in segments:
        distances[segment["surface"]] += segment["distance_m"]
    known = {k: v for k, v in distances.items() if k != "unknown"}
    primary_pool = known or distances
    primary = max(primary_pool, key=primary_pool.get) if primary_pool else "unknown"
    step_distance = sum(s["distance_m"] for s in segments if s["steps"])
    contains_steps = step_distance > 0
    if contains_steps:
        accessibility = "not_step_free"
    elif any(s.get("wheelchair") == "no" for s in segments):
        accessibility = "not_wheelchair_accessible"
    elif any(
        s["surface"] in {"dirt", "grass"}
        or s.get("smoothness") in {"bad", "very_bad", "horrible", "very_horrible", "impassable"}
        or s.get("sac_scale")
        for s in segments
    ):
        accessibility = "limited"
    elif segments and all(s["surface"] in {"paved", "gravel"} for s in segments):
        accessibility = "potentially_step_free_mapped_path"
    else:
        accessibility = "unknown"
    return {
        "surface": primary,
        "surface_mix": sorted(distances),
        "surface_distance_m": {k: round(v, 1) for k, v in sorted(distances.items())},
        "contains_steps": contains_steps,
        "step_distance_m": round(step_distance, 1),
        "accessibility": accessibility,
    }


def elevation_profile_metrics(
    path_coordinates: list[list[float]],
    elevations: dict[tuple[float, float], float],
    distance_m: float,
) -> dict[str, Any]:
    profile = [elevation_at(elevations, lat, lng) for lat, lng in path_coordinates]

    # GLO-90 has 90 m horizontal resolution. Summing every dense OSM vertex
    # would repeatedly cross quantized DEM-cell values and overstate gross
    # ascent/descent. Keep the dense profile for rendering, but calculate gross
    # metrics from samples spaced at roughly the DEM resolution.
    sample_indices = [0]
    since_sample = 0.0
    for index in range(1, len(path_coordinates)):
        since_sample += haversine(tuple(path_coordinates[index - 1]), tuple(path_coordinates[index]))
        if since_sample >= 90.0:
            sample_indices.append(index)
            since_sample = 0.0
    if sample_indices[-1] != len(path_coordinates) - 1:
        sample_indices.append(len(path_coordinates) - 1)
    sampled_profile = [profile[index] for index in sample_indices]

    ascent = 0.0
    descent = 0.0
    for before, after in zip(sampled_profile, sampled_profile[1:]):
        delta = after - before
        if delta > 0:
            ascent += delta
        elif delta < 0:
            descent -= delta
    delta = profile[-1] - profile[0]
    return {
        "elevation_profile_m": profile,
        "elevation_metric_sampling_m": 90,
        "elevation_metric_sample_count": len(sample_indices),
        "elevation_delta_m": round(delta, 1),
        "ascent_m": round(ascent, 1),
        "descent_m": round(descent, 1),
        "avg_grade_pct": round((delta / distance_m) * 100, 1) if distance_m else 0.0,
    }


def build_pairwise_routes(places: list[dict[str, Any]]):
    nodes, ways = load_osm_map()
    graph, route_nodes = route_graph(nodes, ways)
    snap: dict[str, tuple[str, float]] = {}
    place_by_id = {p["id"]: p for p in places}
    for p in places:
        snap[p["id"]] = nearest_route_node((p["lat"], p["lng"]), nodes, route_nodes)

    pair_routes: dict[tuple[str, str], dict[str, Any]] = {}
    ids = [p["id"] for p in places]
    for idx, a in enumerate(ids):
        start_node = snap[a][0]
        # Multiple landmarks can legitimately snap to the same OSM walking node.
        # Preserve every place instead of collapsing them in a node->place dict.
        target_map: dict[str, list[str]] = defaultdict(list)
        for b in ids[idx + 1 :]:
            target_map[snap[b][0]].append(b)
        found = dijkstra(graph, start_node, set(target_map))
        for target_node, (net_distance, segs, node_path) in found.items():
            for b in target_map[target_node]:
                pa, pb = place_by_id[a], place_by_id[b]
                path_coordinates = [[pa["lat"], pa["lng"]]]
                path_coordinates.extend([[round(nodes[n][0], 7), round(nodes[n][1], 7)] for n in node_path])
                path_coordinates.append([pb["lat"], pb["lng"]])
                surface_segments = build_surface_segments(node_path, segs, nodes, ways)
                way_ids = []
                for _, wid, _ in segs:
                    if not way_ids or way_ids[-1] != wid:
                        way_ids.append(wid)
                total = snap[a][1] + net_distance + snap[b][1]
                surface_summary = summarize_surface(surface_segments)
                pair_routes[(a, b)] = {
                    "distance_m": total,
                    "path_coordinates": path_coordinates,
                    "osm_way_ids": way_ids,
                    "surface_segments": surface_segments,
                    **surface_summary,
                    "snap_distance_m": {a: snap[a][1], b: snap[b][1]},
                }
    return pair_routes, snap


class DSU:
    def __init__(self, ids: list[str]):
        self.p = {x: x for x in ids}

    def find(self, x: str) -> str:
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a: str, b: str) -> bool:
        a, b = self.find(a), self.find(b)
        if a == b:
            return False
        self.p[b] = a
        return True


def select_adjacencies(places: list[dict[str, Any]], pair_routes: dict[tuple[str, str], dict[str, Any]]) -> set[tuple[str, str]]:
    ids = [p["id"] for p in places]
    selected: set[tuple[str, str]] = set()
    by_node: dict[str, list[tuple[float, tuple[str, str]]]] = defaultdict(list)
    for pair, route in pair_routes.items():
        a, b = pair
        by_node[a].append((route["distance_m"], pair))
        by_node[b].append((route["distance_m"], pair))

    # Local neighborhood edges: the three closest route-reachable places per
    # node give useful visitor choices rather than a bare spanning tree.
    for pid in ids:
        for _, pair in sorted(by_node[pid])[:3]:
            selected.add(pair)

    # Add a minimum spanning backbone over all routed pairs to guarantee the
    # exported place layer stays connected even if local neighborhoods cluster.
    dsu = DSU(ids)
    for pair, route in sorted(pair_routes.items(), key=lambda item: item[1]["distance_m"]):
        if dsu.union(*pair):
            selected.add(pair)
    return selected


def notes_for(direction: str, route: dict[str, Any]) -> dict[str, str]:
    if route["contains_steps"]:
        return {
            "de": f"OSM-Route enthält auf etwa {route['step_distance_m']:.0f} m Treppen; nicht stufenfrei.",
            "en": f"OSM route contains about {route['step_distance_m']:.0f} m of steps; not step-free.",
        }
    return {
        "de": "OSM-Fußwegroute mit segmentweiser Oberfläche und GLO-90-Höhenprofil; Barrierefreiheit nicht vor Ort verifiziert.",
        "en": "OSM walking route with segment-level surfaces and GLO-90 elevation profile; accessibility not field-verified.",
    }


def directed_edges(
    places: list[dict[str, Any]],
    pair_routes: dict[tuple[str, str], dict[str, Any]],
    elevations: dict[tuple[float, float], float],
) -> list[dict[str, Any]]:
    selected = select_adjacencies(places, pair_routes)
    edges = []
    for a, b in sorted(selected):
        r = pair_routes[(a, b)]
        profile = elevation_profile_metrics(r["path_coordinates"], elevations, r["distance_m"])
        forward_walk = max(1, round(r["distance_m"] / (5000 / 60) + profile["ascent_m"] / 10))
        reverse_walk = max(1, round(r["distance_m"] / (5000 / 60) + profile["descent_m"] / 10))
        endpoint_snap_total = r["snap_distance_m"][a] + r["snap_distance_m"][b]
        endpoint_access_unknown = endpoint_snap_total > 2.0
        full_route_accessibility = r["accessibility"]
        if r["accessibility"] == "potentially_step_free_mapped_path" and endpoint_access_unknown:
            full_route_accessibility = "endpoint_access_unknown"
        base = {
            "distance_m": round(r["distance_m"], 1),
            "surface": r["surface"],
            "surface_mix": r["surface_mix"],
            "surface_distance_m": r["surface_distance_m"],
            "contains_steps": r["contains_steps"],
            "step_distance_m": r["step_distance_m"],
            "accessibility": full_route_accessibility,
            "mapped_path_accessibility": r["accessibility"],
            "endpoint_access_unknown": endpoint_access_unknown,
            "endpoint_snap_total_m": round(endpoint_snap_total, 1),
            "osm_way_ids": r["osm_way_ids"],
            "routing_source": "OpenStreetMap shortest walking path",
            "license": "ODbL-1.0",
            "elevation_source": {
                "provider": "Open-Meteo Elevation API",
                "dataset": "Copernicus DEM 2021 GLO-90",
                "resolution_m": 90,
                "snapshot": "data/sources/elevation/points.json",
            },
        }
        edges.append(
            {
                "id": f"{a}--{b}",
                "from": a,
                "to": b,
                **base,
                "walking_min": forward_walk,
                "surface_segments": r["surface_segments"],
                "elevation_delta_m": profile["elevation_delta_m"],
                "ascent_m": profile["ascent_m"],
                "descent_m": profile["descent_m"],
                "avg_grade_pct": profile["avg_grade_pct"],
                "elevation_profile_m": profile["elevation_profile_m"],
                "elevation_metric_sampling_m": profile["elevation_metric_sampling_m"],
                "elevation_metric_sample_count": profile["elevation_metric_sample_count"],
                "path_coordinates": r["path_coordinates"],
                "snap_distance_m": {
                    "from": round(r["snap_distance_m"][a], 1),
                    "to": round(r["snap_distance_m"][b], 1),
                },
                "notes": notes_for("forward", r),
            }
        )
        edges.append(
            {
                "id": f"{b}--{a}",
                "from": b,
                "to": a,
                **base,
                "walking_min": reverse_walk,
                "surface_segments": reverse_surface_segments(r["surface_segments"]),
                "elevation_delta_m": -profile["elevation_delta_m"],
                "ascent_m": profile["descent_m"],
                "descent_m": profile["ascent_m"],
                "avg_grade_pct": -profile["avg_grade_pct"],
                "elevation_profile_m": list(reversed(profile["elevation_profile_m"])),
                "elevation_metric_sampling_m": profile["elevation_metric_sampling_m"],
                "elevation_metric_sample_count": profile["elevation_metric_sample_count"],
                "path_coordinates": list(reversed(r["path_coordinates"])),
                "snap_distance_m": {
                    "from": round(r["snap_distance_m"][b], 1),
                    "to": round(r["snap_distance_m"][a], 1),
                },
                "notes": notes_for("reverse", r),
            }
        )
    return edges


def watercourse_reference_audit(places: list[dict[str, Any]]) -> dict[str, Any]:
    by_id = {p["id"]: p for p in places}
    timed_stations = [
        "kaskaden",
        "steinhofer-wasserfall",
        "teufelsbruecke",
        "aquaedukt",
        "grosse-fontaene",
    ]
    return {
        "purpose": (
            "official visitor-route context only; do not force this distance or elevation "
            "onto arbitrary shortest-path graph edges"
        ),
        "source": {
            "publisher": "Hessen Kassel Heritage",
            "url": "https://www.heritage-kassel.de/besuch/wasserspiele",
            "published_reference": {
                "visitor_route_distance_m": 2300,
                "route_description": "from below Herkules downhill to Schloss Wilhelmshöhe",
                "elevation_change_description": "almost 200 metres; safety guidance also says over 200 metres downhill",
                "timed_stations": timed_stations,
            },
        },
        "graph_dem_context": {
            "herkules_representative_terrain_m": by_id["herkules"]["elevation_m"],
            "grosse_fontaene_representative_terrain_m": by_id["grosse-fontaene"]["elevation_m"],
            "schloss_representative_terrain_m": by_id["schloss"]["elevation_m"],
            "herkules_to_schloss_endpoint_drop_m": round(
                by_id["herkules"]["elevation_m"] - by_id["schloss"]["elevation_m"], 1
            ),
            "note": "GLO-90 representative-point terrain values are approximate and are not the official route profile.",
        },
    }


def dump(name: str, obj: Any) -> None:
    (DATA / name).write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n")


def main() -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    elevations, elevation_source = load_elevations()
    pois = load_pois()
    places = build_places(pois, elevations)
    pair_routes, snap = build_pairwise_routes(places)
    edges = directed_edges(places, pair_routes, elevations)
    watercourse_audit = watercourse_reference_audit(places)

    nodes_doc = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "bbox": PARK_BBOX,
        "nodes": places,
    }
    edges_doc = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "edges": edges,
    }
    source_manifest = {
        "schema_version": 1,
        "retrieved_utc": datetime.now(timezone.utc).isoformat(),
        "sources": [
            {
                "id": "osm-overpass-pois",
                "publisher": "OpenStreetMap contributors",
                "url": "https://overpass-api.de/api/interpreter",
                "query_file": "data/sources/osm-pois.overpass",
                "snapshot": "data/sources/osm-pois.json",
                "license": "ODbL-1.0",
            },
            {
                "id": "osm-api-map",
                "publisher": "OpenStreetMap contributors",
                "url": "https://api.openstreetmap.org/api/0.6/map",
                "snapshots": [f"data/sources/osm-map/{x}.xml" for x in ("sw", "nw", "se", "ne")],
                "license": "ODbL-1.0",
            },
            {
                "id": "osm-wiki-bergpark",
                "publisher": "OpenStreetMap Wiki contributors",
                "url": "https://wiki.openstreetmap.org/wiki/User:Jo_Cassel/Bergpark_Wilhelmsh%C3%B6he",
                "purpose": "cross-reference of mapped garden architecture and vegetation sources",
            },
            {
                "id": "unesco-1413-map",
                "publisher": "UNESCO World Heritage Centre",
                "url": "https://whc.unesco.org/en/list/1413/maps/",
                "purpose": "World Heritage property geographic cross-check",
            },
            {
                "id": "hkh-bergpark",
                "publisher": "Hessen Kassel Heritage",
                "url": "https://www.heritage-kassel.de/standorte/bergpark-wilhelmshoehe",
                "purpose": "official site/visitor and heritage cross-check",
            },
            {
                "id": "wikimedia-commons-geotag-audit",
                "publisher": "Wikimedia Commons contributors",
                "url": "https://commons.wikimedia.org/w/api.php",
                "snapshot": "data/sources/commons-geotag-audit.json",
                "purpose": "nearby geotagged-media cross-check of OSM representative coordinates; proximity does not prove landmark identity",
            },
            {
                "id": "open-meteo-elevation-glo90",
                "publisher": "Open-Meteo / Copernicus Programme",
                "url": "https://open-meteo.com/en/docs/elevation-api",
                "snapshot": "data/sources/elevation/points.json",
                "raw_batches": "data/sources/elevation/batch-*.json",
                "dataset": elevation_source.get("dataset"),
                "resolution_m": elevation_source.get("resolution_m"),
                "dataset_doi": elevation_source.get("dataset_doi"),
            },
        ],
        "rejected_seed_assumptions": [
            {
                "field": "validation_bbox",
                "supplied": REJECTED_SEED_BBOX,
                "reason": "The supplied west boundary 9.400 E excludes the OSM/UNESCO Herkules area around 9.393 E.",
            },
            {
                "field": "lac/fontaenenteich",
                "reason": "OSM maps Lac and Fontänenteich as distinct water bodies; the graph models both separately.",
            },
            {
                "field": "entenpfuhl",
                "reason": "No matching named OSM landmark was found; the mapped historical pond is Entenfang, retained with the seed label only as an alias.",
            },
            {
                "field": "neue-wasserkunst",
                "reason": "Treated as a conceptual group of the romantic water features, not promoted to a fabricated point coordinate.",
            },
        ],
        "routing_snap_m": {pid: round(distance, 1) for pid, (_, distance) in sorted(snap.items())},
        "watercourse_reference_audit": watercourse_audit,
    }

    dump("nodes.json", nodes_doc)
    dump("edges.json", edges_doc)
    dump("source_manifest.json", source_manifest)
    compose_graph(DATA)


if __name__ == "__main__":
    main()

