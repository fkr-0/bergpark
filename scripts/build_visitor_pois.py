#!/usr/bin/env python3
"""Build the Phase-6 visitor POI layer from preserved OSM map snapshots.

The normal build is deliberately offline. It selects a bounded visitor-facing
tranche from the four preserved OpenStreetMap map snapshots, uses the mapped
Bergpark protected-area boundary as the spatial scope authority, and joins a
separately preserved GLO-90 elevation snapshot. Snapshot absence is never
interpreted as physical absence.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import pathlib
import xml.etree.ElementTree as ET
from collections import Counter
from typing import Any


ROOT = pathlib.Path(__file__).resolve().parents[1]
CANONICAL_DATA = ROOT / "data"
DATA = pathlib.Path(os.environ.get("BERGPARK_OUTPUT_DATA", str(CANONICAL_DATA))).resolve()
MAP_DIR = CANONICAL_DATA / "sources" / "osm-map"
ELEVATION = CANONICAL_DATA / "sources" / "visitor-poi-elevation" / "points.json"
PARK_BOUNDARY_WAY_ID = "608171475"
OSM_LICENSE = "ODbL-1.0"
SCHEMA_VERSION = 1
FAMILIES = (
    "access",
    "toilet",
    "drinking_water",
    "viewpoint",
    "shelter",
    "transit",
    "artwork",
)
BOUNDARY_TRANSIT_NAMES = {"Herkules", "Wilhelmshöhe (Park)"}
EXTERNAL_VIEWPOINT_IDS = {"5762435318"}  # named "Blick zum Herkules" in the preserved snapshot


def sha256_file(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _snapshot_path(path: pathlib.Path) -> str:
    return f"data/sources/osm-map/{path.name}"


def load_osm_snapshots() -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    nodes: dict[str, dict[str, Any]] = {}
    ways: dict[str, dict[str, Any]] = {}
    paths = sorted(MAP_DIR.glob("*.xml"))
    if [path.name for path in paths] != ["ne.xml", "nw.xml", "se.xml", "sw.xml"]:
        raise RuntimeError("expected exactly preserved OSM map snapshots ne/nw/se/sw.xml")

    for path in paths:
        root = ET.parse(path).getroot()
        for element in root:
            if element.tag == "node":
                node_id = element.attrib["id"]
                tags = {tag.attrib["k"]: tag.attrib["v"] for tag in element.findall("tag")}
                row = nodes.setdefault(
                    node_id,
                    {
                        "type": "node",
                        "id": node_id,
                        "lat": round(float(element.attrib["lat"]), 7),
                        "lng": round(float(element.attrib["lon"]), 7),
                        "version": element.attrib.get("version"),
                        "timestamp": element.attrib.get("timestamp"),
                        "tags": {},
                        "snapshot_refs": set(),
                    },
                )
                if row["lat"] != round(float(element.attrib["lat"]), 7) or row["lng"] != round(
                    float(element.attrib["lon"]), 7
                ):
                    raise RuntimeError(f"OSM node {node_id} differs across preserved snapshots")
                row["tags"].update(tags)
                row["snapshot_refs"].add(_snapshot_path(path))
                row["version"] = max(
                    (value for value in (row.get("version"), element.attrib.get("version")) if value is not None),
                    key=lambda value: int(value),
                    default=None,
                )
                row["timestamp"] = max(
                    (value for value in (row.get("timestamp"), element.attrib.get("timestamp")) if value),
                    default=None,
                )
            elif element.tag == "way":
                way_id = element.attrib["id"]
                tags = {tag.attrib["k"]: tag.attrib["v"] for tag in element.findall("tag")}
                refs = [nd.attrib["ref"] for nd in element.findall("nd")]
                row = ways.setdefault(
                    way_id,
                    {
                        "type": "way",
                        "id": way_id,
                        "refs": refs,
                        "version": element.attrib.get("version"),
                        "timestamp": element.attrib.get("timestamp"),
                        "tags": {},
                        "snapshot_refs": set(),
                    },
                )
                if row["refs"] != refs:
                    # Tile snapshots may contain the same current way; conflicting
                    # geometry would make representative positions ambiguous.
                    raise RuntimeError(f"OSM way {way_id} differs across preserved snapshots")
                row["tags"].update(tags)
                row["snapshot_refs"].add(_snapshot_path(path))
                row["version"] = max(
                    (value for value in (row.get("version"), element.attrib.get("version")) if value is not None),
                    key=lambda value: int(value),
                    default=None,
                )
                row["timestamp"] = max(
                    (value for value in (row.get("timestamp"), element.attrib.get("timestamp")) if value),
                    default=None,
                )
    return nodes, ways


def park_polygon(nodes: dict[str, dict[str, Any]], ways: dict[str, dict[str, Any]]) -> list[tuple[float, float]]:
    boundary = ways.get(PARK_BOUNDARY_WAY_ID)
    if boundary is None or boundary["tags"].get("name") != "Bergpark Wilhelmshöhe":
        raise RuntimeError("preserved OSM Bergpark boundary way/608171475 missing")
    coords = []
    for node_id in boundary["refs"]:
        node = nodes.get(node_id)
        if node is None:
            raise RuntimeError(f"park boundary references missing OSM node {node_id}")
        coords.append((node["lat"], node["lng"]))
    if len(coords) < 4:
        raise RuntimeError("Bergpark boundary geometry is incomplete")
    if coords[0] != coords[-1]:
        coords.append(coords[0])
    return coords


def point_in_polygon(lat: float, lng: float, polygon: list[tuple[float, float]]) -> bool:
    x, y = lng, lat
    inside = False
    xy = [(lon, plat) for plat, lon in polygon]
    for (x1, y1), (x2, y2) in zip(xy, xy[1:]):
        if (y1 > y) != (y2 > y):
            crossing_x = (x2 - x1) * (y - y1) / (y2 - y1) + x1
            if x < crossing_x:
                inside = not inside
    return inside


def _segment_distance_m(lat: float, lng: float, a: tuple[float, float], b: tuple[float, float]) -> float:
    # Bounded local equirectangular projection is sufficient for the sub-km
    # boundary-distance classification; it does not become a routing metric.
    cos_lat = math.cos(math.radians(lat))
    x, y = lng * 111_320 * cos_lat, lat * 110_540
    ax, ay = a[1] * 111_320 * cos_lat, a[0] * 110_540
    bx, by = b[1] * 111_320 * cos_lat, b[0] * 110_540
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(x - ax, y - ay)
    t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(x - (ax + t * dx), y - (ay + t * dy))


def boundary_distance_m(lat: float, lng: float, polygon: list[tuple[float, float]]) -> float:
    return min(_segment_distance_m(lat, lng, a, b) for a, b in zip(polygon, polygon[1:]))


def way_position(way: dict[str, Any], nodes: dict[str, dict[str, Any]]) -> tuple[float, float]:
    coords = [(nodes[ref]["lat"], nodes[ref]["lng"]) for ref in way["refs"] if ref in nodes]
    if len(coords) != len(way["refs"]) or not coords:
        raise RuntimeError(f"OSM way {way['id']} has incomplete preserved geometry")
    # A transit platform way gets a display/indexing representative point only.
    # The bounds midpoint is never labelled as a passenger entrance or exact point.
    return (
        round((min(lat for lat, _ in coords) + max(lat for lat, _ in coords)) / 2, 7),
        round((min(lng for _, lng in coords) + max(lng for _, lng in coords)) / 2, 7),
    )


def _scope(lat: float, lng: float, polygon: list[tuple[float, float]], *, external_relevant: bool = False) -> dict[str, Any]:
    inside = point_in_polygon(lat, lng, polygon)
    distance = round(boundary_distance_m(lat, lng, polygon), 1)
    if inside:
        relation = "inside_park"
        reason = "source point lies inside preserved OSM Bergpark boundary way/608171475"
    elif external_relevant:
        relation = "external_relevant"
        reason = "explicitly selected visitor context outside the park boundary; not claimed as park-interior POI"
    else:
        relation = "boundary_external"
        reason = "source point lies outside but near the preserved Bergpark boundary and is selected as boundary access evidence"
    return {
        "relation": relation,
        "boundary_way": f"way/{PARK_BOUNDARY_WAY_ID}",
        "boundary_distance_m": distance,
        "selection_reason": reason,
    }


def _row_from_element(
    element: dict[str, Any],
    family: str,
    lat: float,
    lng: float,
    polygon: list[tuple[float, float]],
    *,
    external_relevant: bool = False,
) -> dict[str, Any]:
    element_type = element["type"]
    element_id = element["id"]
    snapshots = sorted(element["snapshot_refs"])
    if element_type == "node":
        method = "source_node"
        position_type = "source_point"
        accuracy_status = "not_reported_by_source"
    else:
        method = "bounds_midpoint"
        position_type = "representative_point"
        accuracy_status = "derived_representative_point"
    return {
        "id": f"visitor-poi-osm-{element_type}-{element_id}",
        "kind": "visitor_poi",
        "family": family,
        "osm_element": {
            "type": element_type,
            "id": element_id,
            "version": element.get("version"),
            "timestamp": element.get("timestamp"),
        },
        "lat": lat,
        "lng": lng,
        "position_source": {
            "provider": "OpenStreetMap",
            "element": f"{element_type}/{element_id}",
            "snapshot": snapshots[0],
            "snapshot_refs": snapshots,
            "source_version": element.get("version"),
            "source_timestamp": element.get("timestamp"),
            "method": method,
            "position_type": position_type,
            "horizontal_accuracy_m": None,
            "accuracy_status": accuracy_status,
            "license": OSM_LICENSE,
        },
        "scope": _scope(lat, lng, polygon, external_relevant=external_relevant),
        "name": element["tags"].get("name"),
        "source_tags": dict(sorted(element["tags"].items())),
    }


def source_candidates() -> list[dict[str, Any]]:
    """Return the deterministic Phase-6 POI selection before elevation join."""
    nodes, ways = load_osm_snapshots()
    polygon = park_polygon(nodes, ways)
    rows: dict[str, dict[str, Any]] = {}

    def add_node(node: dict[str, Any], family: str, *, external_relevant: bool = False) -> None:
        row = _row_from_element(
            node,
            family,
            node["lat"],
            node["lng"],
            polygon,
            external_relevant=external_relevant,
        )
        if row["id"] in rows:
            raise RuntimeError(f"OSM element selected into multiple visitor families: {row['id']}")
        rows[row["id"]] = row

    # Entrance/barrier evidence: all mapped access nodes inside the preserved park
    # boundary, plus explicitly near-boundary external access nodes. Ways such as
    # walls/fences are not collapsed to invented entrance points.
    for node in nodes.values():
        tags = node["tags"]
        if "entrance" not in tags and "barrier" not in tags:
            continue
        inside = point_in_polygon(node["lat"], node["lng"], polygon)
        distance = boundary_distance_m(node["lat"], node["lng"], polygon)
        include_external = ("entrance" in tags and distance <= 100) or ("barrier" in tags and distance <= 25)
        if inside or include_external:
            add_node(node, "access")

    for node in nodes.values():
        tags = node["tags"]
        inside = point_in_polygon(node["lat"], node["lng"], polygon)
        distance = boundary_distance_m(node["lat"], node["lng"], polygon)
        if tags.get("amenity") == "toilets" and (inside or distance <= 100):
            add_node(node, "toilet")
        elif (tags.get("amenity") == "drinking_water" or tags.get("drinking_water") == "yes") and inside:
            add_node(node, "drinking_water")
        elif tags.get("tourism") == "viewpoint" and (inside or node["id"] in EXTERNAL_VIEWPOINT_IDS):
            add_node(node, "viewpoint", external_relevant=node["id"] in EXTERNAL_VIEWPOINT_IDS and not inside)
        elif tags.get("amenity") == "shelter" and inside:
            add_node(node, "shelter")
        elif tags.get("tourism") == "artwork" and inside:
            add_node(node, "artwork")
        elif (
            tags.get("public_transport") == "platform"
            and tags.get("name") in BOUNDARY_TRANSIT_NAMES
        ):
            add_node(node, "transit")

    # Platform ways are retained as source-backed transit features. Their
    # coordinate is explicitly representative (bounds midpoint), not an access
    # point. Stop-position nodes are not passenger entrances and are excluded.
    for way in ways.values():
        tags = way["tags"]
        if tags.get("public_transport") != "platform" or tags.get("name") not in BOUNDARY_TRANSIT_NAMES:
            continue
        lat, lng = way_position(way, nodes)
        row = _row_from_element(way, "transit", lat, lng, polygon)
        if row["id"] in rows:
            raise RuntimeError(f"OSM element selected into multiple visitor families: {row['id']}")
        rows[row["id"]] = row

    ordered = sorted(
        rows.values(),
        key=lambda row: (
            FAMILIES.index(row["family"]),
            row["osm_element"]["type"],
            int(row["osm_element"]["id"]),
        ),
    )
    return ordered


def selection_records(candidates: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    candidates = candidates or source_candidates()
    return [
        {
            "poi_id": row["id"],
            "osm_element": row["osm_element"],
            "lat": row["lat"],
            "lng": row["lng"],
            "family": row["family"],
        }
        for row in candidates
    ]


def selection_sha256(candidates: list[dict[str, Any]] | None = None) -> str:
    encoded = json.dumps(
        selection_records(candidates), sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def load_elevations(candidates: list[dict[str, Any]]) -> tuple[dict[str, float], dict[str, Any]]:
    doc = json.loads(ELEVATION.read_text())
    if doc.get("schema_version") != 1:
        raise RuntimeError("visitor POI elevation snapshot schema is incompatible")
    expected_sha = selection_sha256(candidates)
    if doc.get("selection_input_sha256") != expected_sha:
        raise RuntimeError("visitor POI elevation snapshot selection hash is stale")
    points = {}
    for point in doc.get("points", []):
        points[point["poi_id"]] = point
    expected_ids = {row["id"] for row in candidates}
    if set(points) != expected_ids:
        raise RuntimeError("visitor POI elevation snapshot does not match selected POI ids")
    for row in candidates:
        point = points[row["id"]]
        if point.get("lat") != row["lat"] or point.get("lng") != row["lng"]:
            raise RuntimeError(f"visitor POI elevation coordinate drift: {row['id']}")
        if not isinstance(point.get("elevation_m"), (int, float)):
            raise RuntimeError(f"visitor POI elevation missing: {row['id']}")
    return {poi_id: float(point["elevation_m"]) for poi_id, point in points.items()}, doc


def build_document() -> dict[str, Any]:
    candidates = source_candidates()
    elevations, elevation_doc = load_elevations(candidates)
    pois = []
    for row in candidates:
        poi = dict(row)
        poi["elevation_m"] = elevations[row["id"]]
        poi["elevation_source"] = {
            "provider": "Open-Meteo Elevation API",
            "dataset": "Copernicus DEM 2021 GLO-90",
            "resolution_m": 90,
            "vertical_accuracy_m": None,
            "accuracy_status": "not_reported_in_project_source",
            "snapshot": "data/sources/visitor-poi-elevation/points.json",
            "dataset_doi": "10.5270/ESA-c5d3d65",
        }
        poi["height_m"] = None
        poi["height_status"] = "unknown_no_measurement_source"
        poi["height_source"] = None
        poi["source_refs"] = [
            f"https://www.openstreetmap.org/{row['osm_element']['type']}/{row['osm_element']['id']}",
            *row["position_source"]["snapshot_refs"],
            "data/sources/visitor-poi-elevation/points.json",
        ]
        pois.append(poi)

    family_counts = {family: 0 for family in FAMILIES}
    family_counts.update(Counter(row["family"] for row in pois))
    source_snapshots = [
        {
            "path": f"data/sources/osm-map/{path.name}",
            "sha256": sha256_file(path),
        }
        for path in sorted(MAP_DIR.glob("*.xml"))
    ]
    boundary = next(
        way
        for way in load_osm_snapshots()[1].values()
        if way["id"] == PARK_BOUNDARY_WAY_ID
    )
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": elevation_doc.get("retrieved_utc"),
        "status": "qualified_preserved_snapshot_tranche",
        "poi_count": len(pois),
        "family_counts": family_counts,
        "pois": pois,
        "provenance": {
            "osm_snapshot_set": source_snapshots,
            "park_boundary": {
                "element": f"way/{PARK_BOUNDARY_WAY_ID}",
                "version": boundary.get("version"),
                "timestamp": boundary.get("timestamp"),
                "snapshot_refs": sorted(boundary["snapshot_refs"]),
                "license": OSM_LICENSE,
            },
            "elevation_snapshot": "data/sources/visitor-poi-elevation/points.json",
            "selection_input_sha256": selection_sha256(candidates),
        },
        "quality": {
            "schema_decision": "single typed visitor_pois document with family discriminator",
            "stable_id_rule": "visitor-poi-osm-<element-type>-<element-id>",
            "coverage_note": "Contains only visitor POIs supported by the preserved OSM map snapshots and the documented Phase-6 selection policy; absence from this snapshot is not evidence that a physical POI does not exist.",
            "access_note": "Entrance, barrier, wheelchair, foot and access facts are copied from source tags; missing tags remain unknown and no entrance is inferred from a centroid or representative way point.",
            "transit_note": "Transit scope is limited to source-mapped passenger platforms named Herkules or Wilhelmshöhe (Park); platform-way coordinates are representative bounds midpoints, not exact entrances.",
            "height_note": "Terrain elevation is independent from physical height; height_m remains null because this tranche does not promote an independently qualified object-height source.",
        },
    }


def main() -> int:
    doc = build_document()
    DATA.mkdir(parents=True, exist_ok=True)
    output = DATA / "visitor_pois.json"
    output.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"visitor_pois": doc["poi_count"], "families": doc["family_counts"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
