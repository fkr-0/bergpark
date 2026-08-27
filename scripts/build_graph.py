#!/usr/bin/env python3
"""Build the Phase-1 Bergpark place/path graph from public OSM snapshots.

No third-party Python packages are required. Later phases extend the same output
files with elevation, semantic and dendrological data.
"""

from __future__ import annotations

import heapq
import json
import math
import pathlib
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
SOURCES = DATA / "sources"

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


def build_places(pois: dict[tuple[str, int], dict[str, Any]]) -> list[dict[str, Any]]:
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
                "elevation_m": None,
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


def classify_surface(tags_list: list[dict[str, str]]) -> tuple[str, list[str], str]:
    surfaces = [t.get("surface", "unknown") for t in tags_list]
    highways = [t.get("highway", "") for t in tags_list]
    uniq = sorted(set(surfaces))
    if "steps" in highways:
        return "stone_steps", uniq, "stairs_only"
    normalized = []
    for s in surfaces:
        if s in {"asphalt", "paved", "paving_stones", "sett", "cobblestone", "concrete", "concrete:plates"}:
            normalized.append("paved")
        elif s in {"gravel", "fine_gravel", "compacted", "pebblestone"}:
            normalized.append("gravel")
        elif s in {"dirt", "earth", "ground", "mud", "unpaved"}:
            normalized.append("dirt")
        elif s == "grass":
            normalized.append("grass")
        else:
            normalized.append("unknown")
    primary = Counter(normalized).most_common(1)[0][0] if normalized else "unknown"
    accessibility = "unknown" if primary == "unknown" else "limited"
    return primary, uniq, accessibility


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
        target_map = {snap[b][0]: b for b in ids[idx + 1 :]}
        found = dijkstra(graph, start_node, set(target_map))
        for target_node, (net_distance, segs, node_path) in found.items():
            b = target_map[target_node]
            pa, pb = place_by_id[a], place_by_id[b]
            path_coordinates = [[pa["lat"], pa["lng"]]]
            path_coordinates.extend([[round(nodes[n][0], 7), round(nodes[n][1], 7)] for n in node_path])
            path_coordinates.append([pb["lat"], pb["lng"]])
            tags_list = [tags for _, _, tags in segs]
            way_ids = []
            for _, wid, _ in segs:
                if not way_ids or way_ids[-1] != wid:
                    way_ids.append(wid)
            total = snap[a][1] + net_distance + snap[b][1]
            surface, surface_mix, accessibility = classify_surface(tags_list)
            pair_routes[(a, b)] = {
                "distance_m": total,
                "path_coordinates": path_coordinates,
                "osm_way_ids": way_ids,
                "surface": surface,
                "surface_mix": surface_mix,
                "accessibility": accessibility,
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
    if route["accessibility"] == "stairs_only":
        return {
            "de": "OSM-Route enthält Treppen; nicht stufenfrei.",
            "en": "OSM route contains steps; not step-free.",
        }
    return {
        "de": "Initiale OSM-Fußwegroute; Oberfläche und Höhenprofil werden in Phase 2 verfeinert.",
        "en": "Initial OSM walking route; surface and elevation profile are refined in Phase 2.",
    }


def directed_edges(places: list[dict[str, Any]], pair_routes: dict[tuple[str, str], dict[str, Any]]) -> list[dict[str, Any]]:
    selected = select_adjacencies(places, pair_routes)
    edges = []
    for a, b in sorted(selected):
        r = pair_routes[(a, b)]
        base = {
            "distance_m": round(r["distance_m"], 1),
            "walking_min": max(1, round(r["distance_m"] / (5000 / 60))),
            "surface": r["surface"],
            "surface_mix": r["surface_mix"],
            "accessibility": r["accessibility"],
            "osm_way_ids": r["osm_way_ids"],
            "routing_source": "OpenStreetMap shortest walking path (Phase 1)",
            "license": "ODbL-1.0",
        }
        edges.append(
            {
                "id": f"{a}--{b}",
                "from": a,
                "to": b,
                **base,
                "elevation_delta_m": None,
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
                "elevation_delta_m": None,
                "path_coordinates": list(reversed(r["path_coordinates"])),
                "snap_distance_m": {
                    "from": round(r["snap_distance_m"][b], 1),
                    "to": round(r["snap_distance_m"][a], 1),
                },
                "notes": notes_for("reverse", r),
            }
        )
    return edges


def dump(name: str, obj: Any) -> None:
    (DATA / name).write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n")


def main() -> None:
    pois = load_pois()
    places = build_places(pois)
    pair_routes, snap = build_pairwise_routes(places)
    edges = directed_edges(places, pair_routes)

    empty_trees = {"schema_version": 1, "trees": [], "status": "pending_phase_4"}
    empty_figures = {"schema_version": 1, "figures": [], "status": "pending_phase_3"}
    empty_semantic = {"schema_version": 1, "semantic_edges": [], "status": "pending_phase_3"}
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
    graph = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "bbox": PARK_BBOX,
        "nodes": places,
        "edges": edges,
        "trees": [],
        "figures": [],
        "semantic_edges": [],
        "provenance": {
            "coordinate_primary": "OpenStreetMap",
            "path_primary": "OpenStreetMap",
            "osm_license": "ODbL-1.0",
            "source_snapshots": [
                "data/sources/osm-pois.json",
                "data/sources/osm-map/sw.xml",
                "data/sources/osm-map/nw.xml",
                "data/sources/osm-map/se.xml",
                "data/sources/osm-map/ne.xml",
            ],
        },
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
    }

    dump("nodes.json", nodes_doc)
    dump("edges.json", edges_doc)
    dump("trees.json", empty_trees)
    dump("figures.json", empty_figures)
    dump("semantic.json", empty_semantic)
    dump("graph.json", graph)
    dump("source_manifest.json", source_manifest)


if __name__ == "__main__":
    main()

