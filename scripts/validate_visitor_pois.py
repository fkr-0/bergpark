#!/usr/bin/env python3
"""Validate the common typed Phase-6 visitor POI document."""

from __future__ import annotations

import json
import os
import pathlib
from collections import Counter
from datetime import datetime, timezone
from typing import Any

try:
    from .build_visitor_pois import FAMILIES, build_document, selection_sha256, source_candidates
except ImportError:
    from build_visitor_pois import FAMILIES, build_document, selection_sha256, source_candidates


ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = pathlib.Path(os.environ.get("BERGPARK_OUTPUT_DATA", str(ROOT / "data"))).resolve()


def valid_optional_accuracy(value: Any) -> bool:
    return value is None or (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and value >= 0
    )


def validate_document(doc: dict[str, Any]) -> tuple[list[dict[str, Any]], list[str]]:
    checks: list[dict[str, Any]] = []
    errors: list[str] = []

    schema_ok = doc.get("schema_version") == 1 and doc.get("status") == "qualified_preserved_snapshot_tranche"
    checks.append({"id": "visitor_poi_schema_and_status", "pass": schema_ok, "failures": [] if schema_ok else ["schema/status"]})
    if not schema_ok:
        errors.append("visitor POI schema/status incompatible")

    pois = doc.get("pois")
    if not isinstance(pois, list):
        return checks, errors + ["visitor_pois.json pois must be a list"]

    ids = [row.get("id") for row in pois]
    elements = [
        (row.get("osm_element", {}).get("type"), row.get("osm_element", {}).get("id"))
        for row in pois
    ]
    identity_failures = []
    if len(ids) != len(set(ids)):
        identity_failures.append("duplicate_ids")
    if len(elements) != len(set(elements)):
        identity_failures.append("duplicate_osm_elements")
    for row in pois:
        element = row.get("osm_element", {})
        expected_id = f"visitor-poi-osm-{element.get('type')}-{element.get('id')}"
        if row.get("id") != expected_id:
            identity_failures.append(row.get("id", "<missing-id>"))
    checks.append({"id": "visitor_poi_ids_stable_unique", "pass": not identity_failures, "failures": identity_failures})
    errors.extend(f"invalid visitor POI identity: {failure}" for failure in identity_failures)

    family_counts = {family: 0 for family in FAMILIES}
    family_counts.update(Counter(row.get("family") for row in pois))
    count_ok = (
        doc.get("poi_count") == len(pois)
        and doc.get("family_counts") == family_counts
        and set(family_counts) == set(FAMILIES)
        and None not in family_counts
    )
    checks.append({"id": "visitor_poi_family_counts_match", "pass": count_ok, "failures": [] if count_ok else [family_counts]})
    if not count_ok:
        errors.append("visitor POI declared family counts do not match rows")

    spatial_failures = []
    scope_failures = []
    access_failures = []
    height_failures = []
    for row in pois:
        row_id = row.get("id", "<missing-id>")
        position = row.get("position_source")
        elevation = row.get("elevation_source")
        scope = row.get("scope")
        if (
            not isinstance(row.get("lat"), (int, float))
            or isinstance(row.get("lat"), bool)
            or not isinstance(row.get("lng"), (int, float))
            or isinstance(row.get("lng"), bool)
            or not isinstance(row.get("elevation_m"), (int, float))
            or isinstance(row.get("elevation_m"), bool)
            or not isinstance(position, dict)
            or not isinstance(elevation, dict)
            or not isinstance(scope, dict)
        ):
            spatial_failures.append(row_id)
            continue
        element_type = row.get("osm_element", {}).get("type")
        expected_method = "source_node" if element_type == "node" else "bounds_midpoint"
        expected_position_type = "source_point" if element_type == "node" else "representative_point"
        expected_accuracy_status = (
            "not_reported_by_source" if element_type == "node" else "derived_representative_point"
        )
        if (
            position.get("provider") != "OpenStreetMap"
            or position.get("element") != f"{element_type}/{row.get('osm_element', {}).get('id')}"
            or not position.get("snapshot")
            or not position.get("snapshot_refs")
            or position.get("method") != expected_method
            or position.get("position_type") != expected_position_type
            or position.get("accuracy_status") != expected_accuracy_status
            or "horizontal_accuracy_m" not in position
            or not valid_optional_accuracy(position.get("horizontal_accuracy_m"))
            or position.get("license") != "ODbL-1.0"
            or elevation.get("dataset") != "Copernicus DEM 2021 GLO-90"
            or elevation.get("resolution_m") != 90
            or "vertical_accuracy_m" not in elevation
            or not valid_optional_accuracy(elevation.get("vertical_accuracy_m"))
            or elevation.get("accuracy_status") != "not_reported_in_project_source"
            or elevation.get("snapshot") != "data/sources/visitor-poi-elevation/points.json"
        ):
            spatial_failures.append(row_id)
        if scope.get("relation") not in {"inside_park", "boundary_external", "external_relevant"}:
            scope_failures.append(row_id)
        elif scope.get("relation") != "inside_park" and not isinstance(scope.get("boundary_distance_m"), (int, float)):
            scope_failures.append(row_id)
        if row.get("family") == "access":
            tags = row.get("source_tags", {})
            if (
                element_type != "node"
                or position.get("position_type") != "source_point"
                or ("entrance" not in tags and "barrier" not in tags)
            ):
                access_failures.append(row_id)
        if (
            row.get("height_m") is not None
            or row.get("height_status") != "unknown_no_measurement_source"
            or row.get("height_source") is not None
        ):
            height_failures.append(row_id)

    checks.append({"id": "visitor_poi_common_spatial_contract", "pass": not spatial_failures, "failures": sorted(set(spatial_failures))})
    errors.extend(f"invalid visitor POI spatial provenance: {row_id}" for row_id in sorted(set(spatial_failures)))
    checks.append({"id": "visitor_poi_scope_explicit", "pass": not scope_failures, "failures": sorted(set(scope_failures))})
    errors.extend(f"invalid visitor POI scope: {row_id}" for row_id in sorted(set(scope_failures)))
    checks.append({"id": "access_points_are_source_nodes", "pass": not access_failures, "failures": sorted(set(access_failures))})
    errors.extend(f"access POI is inferred or lacks source access tag: {row_id}" for row_id in sorted(set(access_failures)))
    checks.append({"id": "physical_height_not_derived_from_terrain", "pass": not height_failures, "failures": sorted(set(height_failures))})
    errors.extend(f"visitor POI physical height improperly promoted: {row_id}" for row_id in sorted(set(height_failures)))

    candidates = source_candidates()
    expected = build_document()
    exact_failures = []
    if doc.get("pois") != expected.get("pois"):
        exact_failures.append("source_derived_rows")
    if doc.get("provenance") != expected.get("provenance"):
        exact_failures.append("provenance")
    if doc.get("quality") != expected.get("quality"):
        exact_failures.append("quality")
    if doc.get("provenance", {}).get("selection_input_sha256") != selection_sha256(candidates):
        exact_failures.append("selection_input_sha256")
    checks.append({"id": "visitor_poi_rows_match_preserved_sources", "pass": not exact_failures, "failures": exact_failures})
    errors.extend(f"visitor POI source-derived layer mismatch: {failure}" for failure in exact_failures)

    coverage = doc.get("quality", {}).get("coverage_note", "").lower()
    coverage_ok = "absence" in coverage and "not evidence" in coverage and "snapshot" in coverage
    checks.append({"id": "snapshot_absence_not_physical_absence", "pass": coverage_ok, "failures": [] if coverage_ok else ["coverage_note"]})
    if not coverage_ok:
        errors.append("visitor POI coverage note overclaims physical completeness")

    return checks, errors


def main() -> int:
    doc = json.loads((DATA / "visitor_pois.json").read_text())
    checks, errors = validate_document(doc)
    pois = doc.get("pois", []) if isinstance(doc, dict) else []
    family_counts = Counter(row.get("family") for row in pois if isinstance(row, dict))
    scope_counts = Counter(row.get("scope", {}).get("relation") for row in pois if isinstance(row, dict))
    summary = {
        "visitor_pois": len(pois),
        "families": {family: family_counts.get(family, 0) for family in FAMILIES},
        "inside_park": scope_counts.get("inside_park", 0),
        "boundary_external": scope_counts.get("boundary_external", 0),
        "external_relevant": scope_counts.get("external_relevant", 0),
        "source_points": sum(row.get("position_source", {}).get("position_type") == "source_point" for row in pois),
        "representative_points": sum(row.get("position_source", {}).get("position_type") == "representative_point" for row in pois),
        "errors": len(errors),
    }
    result = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "pass" if not errors else "fail",
        "summary": summary,
        "checks": checks,
        "errors": errors,
        "known_limits": [
            "The layer is a source-grounded tranche from preserved OSM snapshots, not a claim of complete physical POI inventory.",
            "Missing wheelchair/access/barrier tags remain unknown; absence of a negative tag is not positive accessibility evidence.",
            "Transit platform-way coordinates are representative display/indexing points and are not visitor entrances.",
            "GLO-90 terrain elevation is approximate and is never used as object physical height.",
        ],
    }
    (DATA / "visitor_poi_validation.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(summary, ensure_ascii=False))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
