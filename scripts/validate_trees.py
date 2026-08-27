#!/usr/bin/env python3
"""Validate the standalone catalogued-tree export."""

from __future__ import annotations

import json
import os
import pathlib
from collections import defaultdict
from datetime import datetime, timezone

try:
    from .provenance_contract import validate_spatial_entity
except ImportError:
    from provenance_contract import validate_spatial_entity


ROOT = pathlib.Path(__file__).resolve().parents[1]
CANONICAL_DATA = ROOT / "data"
DATA = pathlib.Path(os.environ.get("BERGPARK_OUTPUT_DATA", str(CANONICAL_DATA))).resolve()
REPORT_DATA = pathlib.Path(os.environ.get("BERGPARK_VALIDATION_OUTPUT_DATA", str(DATA))).resolve()
ID_FILE = CANONICAL_DATA / "sources" / "osm-tree-node-ids.txt"
TREE_RESEARCH_BBOX = {"south": 51.30, "west": 9.38, "north": 51.33, "east": 9.435}


def main() -> int:
    doc = json.loads((DATA / "trees.json").read_text())
    trees = doc["trees"]
    catalog_ids = {line.strip() for line in ID_FILE.read_text().splitlines() if line.strip()}
    checks = []
    errors = []

    ids = [tree["id"] for tree in trees]
    osm_ids = [str(tree["osm_node_id"]) for tree in trees]
    checks.append({"id": "catalog_tree_count", "pass": len(trees) == 569, "actual": len(trees)})
    checks.append({"id": "stable_ids_unique", "pass": len(ids) == len(set(ids)) == 569})
    checks.append({"id": "all_catalog_osm_nodes_present", "pass": set(osm_ids) == catalog_ids})
    if len(trees) != 569:
        errors.append(f"tree count is {len(trees)}, expected 569")
    if len(ids) != len(set(ids)):
        errors.append("duplicate stable tree ids")
    if set(osm_ids) != catalog_ids:
        errors.append("tree OSM-node set differs from catalog-node set")

    spatial_bad = []
    common_provenance_bad = []
    elevation_bad = []
    height_bad = []
    for tree in trees:
        if not (
            TREE_RESEARCH_BBOX["south"] <= tree["lat"] <= TREE_RESEARCH_BBOX["north"]
            and TREE_RESEARCH_BBOX["west"] <= tree["lng"] <= TREE_RESEARCH_BBOX["east"]
        ):
            spatial_bad.append(tree["id"])
        if validate_spatial_entity(tree, label=f"tree:{tree['id']}"):
            common_provenance_bad.append(tree["id"])
        if not isinstance(tree.get("elevation_m"), (int, float)):
            elevation_bad.append(tree["id"])
        if tree.get("height_m") is None and tree.get("height_status") != "unknown_no_measurement_source":
            height_bad.append(tree["id"])
        if tree.get("height_m") is not None and tree.get("height_status") != "source_reported":
            height_bad.append(tree["id"])
    for check_id, failures in (
        ("coordinates_in_research_bbox", spatial_bad),
        ("common_spatial_provenance", common_provenance_bad),
        ("elevation_present", elevation_bad),
        ("height_provenance_consistent", height_bad),
    ):
        checks.append({"id": check_id, "pass": not failures, "failures": failures})
        errors.extend(f"{check_id}: {tree_id}" for tree_id in failures)

    refs: dict[str, list[str]] = defaultdict(list)
    for tree in trees:
        if tree.get("catalog_ref"):
            refs[tree["catalog_ref"]].append(tree["id"])
    duplicate_refs = {ref: members for ref, members in refs.items() if len(members) > 1}
    checks.append(
        {
            "id": "duplicate_catalog_refs_preserved_as_non_unique_metadata",
            "pass": duplicate_refs == doc.get("quality", {}).get("duplicate_catalog_refs", {}),
            "duplicate_ref_count": len(duplicate_refs),
        }
    )
    if duplicate_refs != doc.get("quality", {}).get("duplicate_catalog_refs", {}):
        errors.append("duplicate catalog ref audit differs from exported quality metadata")

    species_count = sum(bool(tree.get("species", {}).get("scientific")) for tree in trees)
    circumference_count = sum(tree.get("circumference_m") is not None for tree in trees)
    height_count = sum(tree.get("height_m") is not None for tree in trees)
    result = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "pass" if not errors else "fail",
        "summary": {
            "catalog_trees": len(trees),
            "species_identified": species_count,
            "circumference_reported": circumference_count,
            "specimen_height_reported": height_count,
            "duplicate_catalog_refs": len(duplicate_refs),
            "errors": len(errors),
        },
        "checks": checks,
        "errors": errors,
        "notes": [
            "The source snapshots contain no specimen height tags at this revision; height_m remains null rather than deriving height from species descriptions.",
            "GLO-90 terrain elevation is approximate and is not the physical height of a tree.",
        ],
    }
    REPORT_DATA.mkdir(parents=True, exist_ok=True)
    (REPORT_DATA / "tree_validation.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result["summary"], ensure_ascii=False))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
