"""Shared Phase-7 spatial provenance and derived-metric validation helpers.

The helpers are deliberately dependency-free and validate evidence shape rather
than inventing precision.  They are used by layer validators and the
composition gate so malformed provenance fails before graph.json is written.
"""

from __future__ import annotations

import math
from typing import Any, Iterable

POSITION_TYPES = {"source_point", "representative_point"}
REPRESENTATIVE_METHODS = {
    "source_centroid",
    "bounds_midpoint",
    "geometry_mean",
    "route_geometry_coordinate",
}
SOURCE_POINT_METHODS = {"source_node", "entrance_node", "field_observation"}


def valid_optional_accuracy(value: Any) -> bool:
    return value is None or (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and value >= 0
    )


def _nonempty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _has_source_reference(position: dict[str, Any]) -> bool:
    if _nonempty_string(position.get("element")):
        return True
    elements = position.get("elements")
    if isinstance(elements, list) and elements and all(_nonempty_string(value) for value in elements):
        return True
    return any(
        _nonempty_string(position.get(key))
        for key in ("document_ref", "source")
    )


def validate_position_source(position: Any, *, label: str) -> list[str]:
    failures: list[str] = []
    if not isinstance(position, dict):
        return [f"{label}: position_source must be an object"]

    provider = position.get("provider")
    method = position.get("method")
    point_role = position.get("position_type")
    accuracy = position.get("horizontal_accuracy_m")
    status = position.get("accuracy_status")

    if not _nonempty_string(provider):
        failures.append(f"{label}: position provider missing")
    if not _has_source_reference(position):
        failures.append(f"{label}: exact source element/document reference missing")
    if not _nonempty_string(method):
        failures.append(f"{label}: derivation method missing")
    if point_role not in POSITION_TYPES:
        failures.append(f"{label}: position_type must be source_point or representative_point")
    if "horizontal_accuracy_m" not in position or not valid_optional_accuracy(accuracy):
        failures.append(f"{label}: horizontal_accuracy_m must be numeric >= 0 or null")
    if not _nonempty_string(status):
        failures.append(f"{label}: accuracy_status missing")

    if isinstance(status, str) and "exact" in status.lower() and accuracy is None:
        failures.append(f"{label}: exactness cannot be claimed without numeric accuracy evidence")
    if point_role == "representative_point":
        if method in SOURCE_POINT_METHODS:
            failures.append(f"{label}: representative point cannot use a source/access-point method")
        if isinstance(status, str) and status == "not_reported_by_source":
            failures.append(f"{label}: representative point must disclose derivation in accuracy_status")
    if point_role == "source_point" and method in REPRESENTATIVE_METHODS:
        failures.append(f"{label}: derived representative method cannot be labelled source_point")
    if method == "entrance_node" and point_role != "source_point":
        failures.append(f"{label}: entrance_node must remain a source-backed point")

    if "retrieved_at" in position and position.get("retrieved_at") is not None and not _nonempty_string(position.get("retrieved_at")):
        failures.append(f"{label}: retrieved_at must be a timestamp string or null")
    if position.get("retrieved_at") is None and "retrieved_at" in position:
        retrieval_status = position.get("retrieval_status")
        if not _nonempty_string(retrieval_status):
            failures.append(f"{label}: null retrieved_at requires explicit retrieval_status")
    return failures


def validate_elevation_source(elevation: Any, *, label: str) -> list[str]:
    failures: list[str] = []
    if not isinstance(elevation, dict):
        return [f"{label}: elevation_source must be an object"]
    if not _nonempty_string(elevation.get("provider")):
        failures.append(f"{label}: elevation provider missing")
    if not _nonempty_string(elevation.get("dataset")):
        failures.append(f"{label}: elevation dataset missing")
    resolution = elevation.get("resolution_m")
    if (
        not isinstance(resolution, (int, float))
        or isinstance(resolution, bool)
        or not math.isfinite(resolution)
        or resolution <= 0
    ):
        failures.append(f"{label}: terrain resolution_m must be positive numeric")
    if "vertical_accuracy_m" not in elevation or not valid_optional_accuracy(elevation.get("vertical_accuracy_m")):
        failures.append(f"{label}: vertical_accuracy_m must be numeric >= 0 or null")
    if not _nonempty_string(elevation.get("accuracy_status")):
        failures.append(f"{label}: elevation accuracy_status missing")
    if not _nonempty_string(elevation.get("snapshot")):
        failures.append(f"{label}: elevation snapshot reference missing")
    if "retrieved_at" in elevation and elevation.get("retrieved_at") is not None and not _nonempty_string(elevation.get("retrieved_at")):
        failures.append(f"{label}: elevation retrieved_at must be a timestamp string or null")
    return failures


def validate_physical_height(row: dict[str, Any], *, label: str) -> list[str]:
    """Validate height only when the entity publishes a physical-height contract."""
    if not any(key in row for key in ("height_m", "height_status", "height_source")):
        return []
    failures: list[str] = []
    height = row.get("height_m")
    height_status = row.get("height_status")
    height_source = row.get("height_source")
    if height is None:
        if height_status != "unknown_no_measurement_source" or height_source is not None:
            failures.append(f"{label}: unknown physical height must remain null with unknown status/source")
        return failures
    if (
        not isinstance(height, (int, float))
        or isinstance(height, bool)
        or not math.isfinite(height)
        or height < 0
    ):
        failures.append(f"{label}: height_m must be a non-negative number or null")
    if not isinstance(height_source, dict):
        failures.append(f"{label}: source-reported height requires structured height_source")
    else:
        if height_source.get("measurement_kind") != "physical_height":
            failures.append(f"{label}: height_source must explicitly identify physical_height")
        elevation_source = row.get("elevation_source")
        if isinstance(elevation_source, dict) and height_source == elevation_source:
            failures.append(f"{label}: terrain elevation provenance cannot be reused as physical height provenance")
    if not _nonempty_string(height_status) or height_status == "unknown_no_measurement_source":
        failures.append(f"{label}: numeric height requires a sourced height status")
    return failures


def validate_spatial_entity(row: dict[str, Any], *, label: str | None = None) -> list[str]:
    row_id = row.get("id", "<missing-id>")
    label = label or str(row_id)
    failures: list[str] = []
    for key in ("lat", "lng", "elevation_m"):
        value = row.get(key)
        if (
            not isinstance(value, (int, float))
            or isinstance(value, bool)
            or not math.isfinite(value)
        ):
            failures.append(f"{label}: {key} must be finite numeric")
    failures.extend(validate_position_source(row.get("position_source"), label=label))
    failures.extend(validate_elevation_source(row.get("elevation_source"), label=label))
    failures.extend(validate_physical_height(row, label=label))
    return failures


def validate_metric_profile(
    profile: Any,
    *,
    label: str,
    required_metrics: Iterable[str],
) -> list[str]:
    failures: list[str] = []
    if not isinstance(profile, dict):
        return [f"{label}: derived_metric_profile must be an object"]
    if not _nonempty_string(profile.get("profile_id")):
        failures.append(f"{label}: metric profile_id missing")
    if not _nonempty_string(profile.get("applies_to")):
        failures.append(f"{label}: metric applies_to missing")
    if profile.get("source_vs_derived_policy") != "source_facts_are_preserved; derived_values_require_declared_algorithm_and_inputs":
        failures.append(f"{label}: source-vs-derived policy missing or incompatible")
    metrics = profile.get("metrics")
    if not isinstance(metrics, dict):
        return failures + [f"{label}: metrics map missing"]
    for metric in required_metrics:
        definition = metrics.get(metric)
        metric_label = f"{label}.{metric}"
        if not isinstance(definition, dict):
            failures.append(f"{metric_label}: definition missing")
            continue
        if definition.get("kind") not in {"derived", "derived_summary", "source_qualified_derived"}:
            failures.append(f"{metric_label}: derived kind missing")
        if not _nonempty_string(definition.get("algorithm")):
            failures.append(f"{metric_label}: algorithm missing")
        inputs = definition.get("source_fields")
        if not isinstance(inputs, list) or not inputs or not all(_nonempty_string(value) for value in inputs):
            failures.append(f"{metric_label}: source_fields missing")
        if not _nonempty_string(definition.get("assumptions")):
            failures.append(f"{metric_label}: assumptions missing")
    return failures
