#!/usr/bin/env python3
"""Validate deterministic graph-side routing over the Phase-8 path topology."""

from __future__ import annotations

import json
import os
import pathlib
from typing import Any

try:
    from .path_routing import (
        POLICY_DEFINITIONS,
        RouteNotFoundError,
        route_document,
    )
except ImportError:
    from path_routing import POLICY_DEFINITIONS, RouteNotFoundError, route_document


ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = pathlib.Path(os.environ.get("BERGPARK_OUTPUT_DATA", str(ROOT / "data"))).resolve()
REPORT_DATA = pathlib.Path(
    os.environ.get("BERGPARK_VALIDATION_OUTPUT_DATA", str(DATA))
).resolve()
PHASE2_DISTANCE_TOLERANCE_M = 0.25


def validate_documents(
    topology: dict[str, Any], edge_doc: dict[str, Any]
) -> tuple[list[dict[str, Any]], list[str], list[str], dict[str, Any]]:
    errors: list[str] = []
    warnings: list[str] = []
    checks: list[dict[str, Any]] = []

    def check(check_id: str, failures: list[Any]) -> None:
        checks.append({"id": check_id, "pass": not failures, "failures": failures[:50]})

    expected_policies = {"shortest", "avoid_known_steps_lower_ascent"}
    policy_failures = sorted(expected_policies - set(POLICY_DEFINITIONS))
    errors.extend(f"missing routing policy: {policy}" for policy in policy_failures)
    check("required_graph_side_policies_present", policy_failures)

    phase2_failures: list[str] = []
    deterministic_failures: list[str] = []
    evidence_failures: list[str] = []
    policy_preference_failures: list[str] = []
    phase2_deltas: list[float] = []
    policy_changed_pairs = 0

    for edge in edge_doc.get("edges", []):
        edge_id = edge.get("id", "<missing-id>")
        try:
            shortest = route_document(topology, edge["from"], edge["to"], policy="shortest")
            shortest_repeat = route_document(
                topology, edge["from"], edge["to"], policy="shortest"
            )
            evidence_route = route_document(
                topology,
                edge["from"],
                edge["to"],
                policy="avoid_known_steps_lower_ascent",
            )
            evidence_repeat = route_document(
                topology,
                edge["from"],
                edge["to"],
                policy="avoid_known_steps_lower_ascent",
            )
        except (KeyError, RouteNotFoundError, ValueError) as exc:
            phase2_failures.append(f"{edge_id}:{type(exc).__name__}:{exc}")
            continue

        delta = abs(float(shortest["distance_m"]) - float(edge["distance_m"]))
        phase2_deltas.append(delta)
        if delta > PHASE2_DISTANCE_TOLERANCE_M:
            phase2_failures.append(
                f"{edge_id}:distance_delta={delta:.3f}m>"
                f"{PHASE2_DISTANCE_TOLERANCE_M:.2f}m"
            )
        if shortest != shortest_repeat or evidence_route != evidence_repeat:
            deterministic_failures.append(edge_id)
        if shortest["segment_ids"] != evidence_route["segment_ids"]:
            policy_changed_pairs += 1
        if evidence_route["known_step_distance_m"] > shortest["known_step_distance_m"] + 1e-9:
            policy_preference_failures.append(edge_id)
        for result in (shortest, evidence_route):
            if result.get("accessibility_status") not in {
                "known_negative_accessibility_evidence",
                "unknown_not_an_accessibility_claim",
            }:
                evidence_failures.append(edge_id)
            if result.get("unknown_access_evidence_distance_m", 0) < 0:
                evidence_failures.append(edge_id)

    errors.extend(f"Phase-2 route reproduction: {failure}" for failure in phase2_failures)
    errors.extend(f"non-deterministic route: {failure}" for failure in deterministic_failures)
    errors.extend(f"unsupported accessibility claim: {failure}" for failure in evidence_failures)
    errors.extend(
        f"avoid-known-steps policy worsened known-step distance: {failure}"
        for failure in policy_preference_failures
    )
    check("phase2_landmark_connections_reproduced", phase2_failures)
    check("route_results_are_deterministic", deterministic_failures)
    check("routing_never_upgrades_unknown_accessibility", evidence_failures)
    check("avoid_known_steps_policy_is_evidence_aware", policy_preference_failures)

    # Every disconnected source component must remain genuinely disconnected
    # from the 30-place component. This validates source separation without
    # fabricating connectors between preserved OSM components.
    components = topology.get("connected_components", [])
    place_components = [component for component in components if component.get("related_place_ids")]
    disconnected_failures: list[str] = []
    disconnected_components_checked = 0
    if len(place_components) != 1 or not place_components[0].get("related_place_ids"):
        disconnected_failures.append("expected exactly one component containing place nodes")
    else:
        anchor = place_components[0]["related_place_ids"][0]
        for component in components:
            if component is place_components[0]:
                continue
            node_ids = component.get("path_node_ids", [])
            if not node_ids:
                disconnected_failures.append(f"{component.get('id')}:empty")
                continue
            disconnected_components_checked += 1
            try:
                route_document(topology, anchor, node_ids[0], policy="shortest")
            except RouteNotFoundError:
                pass
            except (KeyError, ValueError) as exc:
                disconnected_failures.append(
                    f"{component.get('id')}:{type(exc).__name__}:{exc}"
                )
            else:
                disconnected_failures.append(f"{component.get('id')}:unexpected-route")
    errors.extend(f"disconnected component routing: {failure}" for failure in disconnected_failures)
    check("disconnected_source_components_fail_closed", disconnected_failures)

    topology_private_failures = []
    for segment in topology.get("directed_segments", []):
        foot = segment.get("foot")
        access = segment.get("access")
        if segment.get("routing_eligible") is True and (
            foot == "no"
            or (access in {"private", "no"} and foot not in {"yes", "designated", "permissive"})
        ):
            topology_private_failures.append(segment.get("id", "<missing-id>"))
    errors.extend(f"private/no-foot segment is routable: {failure}" for failure in topology_private_failures)
    check("private_and_no_foot_segments_fail_closed", topology_private_failures)

    summary = {
        "phase2_routes_checked": len(edge_doc.get("edges", [])),
        "phase2_max_distance_delta_m": round(max(phase2_deltas, default=0.0), 3),
        "phase2_distance_tolerance_m": PHASE2_DISTANCE_TOLERANCE_M,
        "routing_policies": sorted(POLICY_DEFINITIONS),
        "policy_changed_phase2_pairs": policy_changed_pairs,
        "disconnected_components_checked": disconnected_components_checked,
        "errors": len(errors),
        "warnings": len(warnings),
    }
    return checks, errors, warnings, summary


def main() -> int:
    topology = json.loads((DATA / "path_topology.json").read_text())
    edge_doc = json.loads((DATA / "edges.json").read_text())
    checks, errors, warnings, summary = validate_documents(topology, edge_doc)
    result = {
        "schema_version": 1,
        "generated_at": topology.get("generated_at"),
        "status": "pass" if not errors else "fail",
        "summary": summary,
        "checks": checks,
        "errors": errors,
        "warnings": warnings,
        "notes": [
            "Routing is deterministic graph/domain logic over factual path-segment metadata; it does not alter source facts.",
            "The Phase-2 distance tolerance only accounts for legacy route-distance rounding versus the finer Phase-8 segment serialization.",
            "The avoid-known-steps/lower-ascent policy is a weighting policy, not an accessibility certification; unknown access evidence remains unknown.",
        ],
    }
    REPORT_DATA.mkdir(parents=True, exist_ok=True)
    (REPORT_DATA / "path_routing_validation.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    )
    print(json.dumps(summary, ensure_ascii=False))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
