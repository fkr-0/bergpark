#!/usr/bin/env python3
"""Build the catalogued-tree layer from preserved OSM/Wiki source snapshots."""

from __future__ import annotations

import json
import pathlib
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any


ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
SOURCES = DATA / "sources"
ID_FILE = SOURCES / "osm-tree-node-ids.txt"
TREE_XML = SOURCES / "osm-tree-nodes"
ELEVATION_FILE = SOURCES / "tree-elevation" / "points.json"


def ids() -> list[str]:
    values = [line.strip() for line in ID_FILE.read_text().splitlines() if line.strip()]
    if len(values) != 569 or len(set(values)) != 569:
        raise RuntimeError(f"expected 569 unique tree ids, got {len(values)}")
    return values


def source_nodes() -> dict[str, dict[str, Any]]:
    wanted = set(ids())
    out: dict[str, dict[str, Any]] = {}
    for path in sorted(TREE_XML.glob("chunk-*.xml")):
        root = ET.parse(path).getroot()
        for node in root.findall("node"):
            node_id = node.attrib["id"]
            if node_id not in wanted:
                continue
            tags = {tag.attrib["k"]: tag.attrib["v"] for tag in node.findall("tag")}
            out[node_id] = {
                "id": node_id,
                "lat": round(float(node.attrib["lat"]), 7),
                "lng": round(float(node.attrib["lon"]), 7),
                "version": node.attrib.get("version"),
                "timestamp": node.attrib.get("timestamp"),
                "tags": tags,
            }
    missing = sorted(wanted - out.keys())
    if missing:
        raise RuntimeError(f"missing {len(missing)} catalog source nodes: {missing[:5]}")
    return out


def elevation_lookup() -> tuple[dict[str, float], dict[str, Any]]:
    doc = json.loads(ELEVATION_FILE.read_text())
    points = {str(row["osm_node_id"]): float(row["elevation_m"]) for row in doc["points"]}
    if len(points) != 569:
        raise RuntimeError(f"expected 569 tree elevations, got {len(points)}")
    return points, doc["source"]


def number_or_none(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return float(value.replace(",", ".").strip())
    except ValueError:
        return None


def tree_record(node: dict[str, Any], elevation_m: float) -> dict[str, Any]:
    tags = node["tags"]
    source_height = number_or_none(tags.get("height"))
    circumference = number_or_none(tags.get("circumference"))
    record = {
        "id": f"tree-{node['id']}",
        "kind": "tree",
        "osm_node_id": node["id"],
        "catalog_ref": tags.get("ref"),
        "lat": node["lat"],
        "lng": node["lng"],
        "elevation_m": elevation_m,
        "position_source": {
            "provider": "OpenStreetMap",
            "element": f"node/{node['id']}",
            "license": "ODbL-1.0",
            "source_timestamp": node.get("timestamp"),
            "horizontal_accuracy_m": None,
            "accuracy_status": "not_reported_by_source",
            "note": "Coordinate is the mapped OSM node position; source does not report survey/GNSS accuracy.",
        },
        "elevation_source": {
            "provider": "Open-Meteo Elevation API",
            "dataset": "Copernicus DEM 2021 GLO-90",
            "resolution_m": 90,
            "vertical_accuracy_m": None,
            "snapshot": "data/sources/tree-elevation/points.json",
        },
        "species": {
            "scientific": tags.get("species"),
            "de": tags.get("species:de"),
            "en": tags.get("species:en"),
            "genus": tags.get("genus"),
            "genus_de": tags.get("genus:de"),
            "taxon": tags.get("taxon"),
        },
        "leaf_type": tags.get("leaf_type"),
        "leaf_cycle": tags.get("leaf_cycle"),
        "denotation": tags.get("denotation"),
        "circumference_m": circumference,
        "circumference_source": tags.get("source:circumference") if circumference is not None else None,
        "start_date": tags.get("start_date"),
        "height_m": source_height,
        "height_status": "source_reported" if source_height is not None else "unknown_no_measurement_source",
        "height_source": "OpenStreetMap height tag" if source_height is not None else None,
        "description": tags.get("description"),
        "image": tags.get("image"),
        "wikimedia_commons": tags.get("wikimedia_commons"),
        "location_description": tags.get("tree_location:full"),
        "source_refs": [
            "data/sources/osm-wiki-baumkataster.wiki",
            f"https://www.openstreetmap.org/node/{node['id']}",
            "data/sources/tree-elevation/points.json",
        ],
    }
    # Preserve unusual/curatorial tags without pretending they are normalized fields.
    extra_keys = ("old_ref", "note", "memorial", "name", "protected", "website")
    extra = {key: tags[key] for key in extra_keys if key in tags}
    if extra:
        record["source_tags_extra"] = extra
    return record


def main() -> int:
    nodes = source_nodes()
    elevations, elevation_source = elevation_lookup()
    trees = [tree_record(nodes[node_id], elevations[node_id]) for node_id in ids()]

    refs: dict[str, list[str]] = defaultdict(list)
    for tree in trees:
        if tree["catalog_ref"]:
            refs[tree["catalog_ref"]].append(tree["id"])
    duplicate_refs = {ref: members for ref, members in sorted(refs.items()) if len(members) > 1}

    doc = {
        "schema_version": 2,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "catalog_spatial_enrichment_complete",
        "tree_count": len(trees),
        "trees": trees,
        "provenance": {
            "catalog": "data/sources/osm-wiki-baumkataster.wiki",
            "catalog_node_ids": "data/sources/osm-tree-node-ids.txt",
            "osm_node_snapshots": "data/sources/osm-tree-nodes/chunk-*.xml",
            "elevation": "data/sources/tree-elevation/points.json",
            "elevation_dataset": elevation_source.get("dataset"),
            "osm_license": "ODbL-1.0",
        },
        "quality": {
            "stable_id_rule": "tree-<osm-node-id>",
            "duplicate_catalog_refs": duplicate_refs,
            "height_policy": (
                "Only source-reported specimen height may populate height_m. Species maximum/typical heights in descriptions "
                "are not specimen measurements and are never promoted into height_m."
            ),
            "position_accuracy_policy": "Mapped node coordinates are preserved but not labelled exact; source accuracy is unknown unless explicitly reported.",
        },
    }
    (DATA / "trees.json").write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
    print(f"wrote {len(trees)} catalogued trees; duplicate catalog refs: {len(duplicate_refs)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
