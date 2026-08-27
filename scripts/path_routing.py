"""Deterministic graph-side routing over ``data/path_topology.json``.

Factual segment metadata is never rewritten into accessibility claims.  Route
policies are explicit weighting functions over those facts, and every returned
route carries an evidence summary that keeps unknown access/terrain evidence
visible.
"""

from __future__ import annotations

import heapq
import json
import pathlib
from collections import defaultdict
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
PEDESTRIAN_EXCEPTIONS = {"yes", "designated", "permissive"}

POLICY_DEFINITIONS: dict[str, dict[str, Any]] = {
    "shortest": {
        "description": "Minimize source-polyline walking distance only.",
        "cost_tuple": ["distance_m"],
        "unknown_access_policy": "unknown remains unknown; routability is not accessibility",
    },
    "avoid_known_steps_lower_ascent": {
        "description": (
            "Lexicographically minimize known step distance, then an evidence-aware ascent score, "
            "then distance. Unknown short-segment ascent is assigned a conservative weighting "
            "penalty but is never converted into a factual ascent value."
        ),
        "cost_tuple": ["known_step_distance_m", "ascent_evidence_score", "distance_m"],
        "unknown_ascent_weight_per_m": 0.10,
        "unknown_access_policy": "unknown remains unknown; this policy is not an accessible-route profile",
    },
}


class RouteNotFoundError(RuntimeError):
    pass


class InvalidTopologyError(RuntimeError):
    pass


def _add_cost(a: tuple[float, ...], b: tuple[float, ...]) -> tuple[float, ...]:
    return tuple(x + y for x, y in zip(a, b))


def _segment_allowed(segment: dict[str, Any]) -> bool:
    if segment.get("routing_eligible") is not True:
        return False
    if segment.get("foot") == "no":
        return False
    if segment.get("access") in {"private", "no"} and segment.get("foot") not in PEDESTRIAN_EXCEPTIONS:
        return False
    for evidence in segment.get("barrier_evidence", []):
        if evidence.get("foot") == "no":
            return False
        if evidence.get("access") in {"private", "no"} and evidence.get("foot") not in PEDESTRIAN_EXCEPTIONS:
            return False
    return True


def _segment_cost(segment: dict[str, Any], policy: str) -> tuple[float, ...]:
    distance = float(segment["distance_m"])
    if policy == "shortest":
        return (distance,)
    if policy == "avoid_known_steps_lower_ascent":
        known_step_distance = distance if segment.get("steps") is True else 0.0
        ascent = segment.get("ascent_m")
        if isinstance(ascent, (int, float)):
            ascent_score = float(ascent)
        else:
            # This is route weighting only. The route summary still reports the
            # source terrain metric as unknown for this distance.
            ascent_score = distance * float(
                POLICY_DEFINITIONS[policy]["unknown_ascent_weight_per_m"]
            )
        return (known_step_distance, ascent_score, distance)
    raise ValueError(f"unknown routing policy {policy!r}")


def _resolve_endpoint(node_ids: set[str], value: str) -> str:
    if value in node_ids:
        return value
    place_path_id = f"pathnode-place-{value}"
    if place_path_id in node_ids:
        return place_path_id
    osm_path_id = f"pathnode-osm-{value}"
    if osm_path_id in node_ids:
        return osm_path_id
    raise KeyError(f"unknown topology endpoint {value!r}")


def route_document(
    topology: dict[str, Any],
    start: str,
    end: str,
    *,
    policy: str = "shortest",
) -> dict[str, Any]:
    if policy not in POLICY_DEFINITIONS:
        raise ValueError(f"unknown routing policy {policy!r}")
    nodes = {node["id"]: node for node in topology.get("path_nodes", [])}
    if not nodes:
        raise InvalidTopologyError("topology has no path nodes")
    start_id = _resolve_endpoint(set(nodes), start)
    end_id = _resolve_endpoint(set(nodes), end)
    if start_id == end_id:
        zero = tuple(0.0 for _ in POLICY_DEFINITIONS[policy]["cost_tuple"])
        return _summarize_route(topology, start_id, end_id, policy, [], [start_id], zero)

    segments_by_id: dict[str, dict[str, Any]] = {}
    outgoing: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for segment in topology.get("directed_segments", []):
        segment_id = segment.get("id")
        if not segment_id or segment_id in segments_by_id:
            raise InvalidTopologyError(f"duplicate or missing segment id {segment_id!r}")
        if segment.get("from") not in nodes or segment.get("to") not in nodes:
            raise InvalidTopologyError(f"segment endpoint missing: {segment_id}")
        segments_by_id[segment_id] = segment
        if _segment_allowed(segment):
            outgoing[segment["from"]].append(segment)
    for rows in outgoing.values():
        rows.sort(key=lambda segment: segment["id"])

    width = len(_segment_cost(next(iter(segments_by_id.values())), policy)) if segments_by_id else 1
    zero = tuple(0.0 for _ in range(width))
    # Full segment-ID signatures are retained only for deterministic equal-cost
    # tie breaking. The network is small enough that this remains bounded.
    best: dict[str, tuple[tuple[float, ...], tuple[str, ...]]] = {start_id: (zero, ())}
    heap: list[tuple[tuple[float, ...], tuple[str, ...], str, tuple[str, ...]]] = [
        (zero, (), start_id, (start_id,))
    ]
    while heap:
        cost, signature, node_id, node_path = heapq.heappop(heap)
        if best.get(node_id) != (cost, signature):
            continue
        if node_id == end_id:
            route_segments = [segments_by_id[segment_id] for segment_id in signature]
            return _summarize_route(
                topology,
                start_id,
                end_id,
                policy,
                route_segments,
                list(node_path),
                cost,
            )
        for segment in outgoing.get(node_id, []):
            next_id = segment["to"]
            candidate_cost = _add_cost(cost, _segment_cost(segment, policy))
            candidate_signature = signature + (segment["id"],)
            candidate_key = (candidate_cost, candidate_signature)
            if next_id not in best or candidate_key < best[next_id]:
                best[next_id] = candidate_key
                heapq.heappush(
                    heap,
                    (
                        candidate_cost,
                        candidate_signature,
                        next_id,
                        node_path + (next_id,),
                    ),
                )

    raise RouteNotFoundError(f"no {policy} route from {start_id} to {end_id}")


def _summarize_route(
    topology: dict[str, Any],
    start_id: str,
    end_id: str,
    policy: str,
    segments: list[dict[str, Any]],
    node_ids: list[str],
    cost: tuple[float, ...],
) -> dict[str, Any]:
    distance = round(sum(float(segment["distance_m"]) for segment in segments), 2)
    known_ascent = round(
        sum(float(segment["ascent_m"]) for segment in segments if isinstance(segment.get("ascent_m"), (int, float))),
        1,
    )
    known_descent = round(
        sum(float(segment["descent_m"]) for segment in segments if isinstance(segment.get("descent_m"), (int, float))),
        1,
    )
    terrain_unknown_distance = round(
        sum(float(segment["distance_m"]) for segment in segments if segment.get("ascent_m") is None),
        2,
    )
    known_step_distance = round(
        sum(float(segment["distance_m"]) for segment in segments if segment.get("steps") is True),
        2,
    )
    unknown_access_distance = round(
        sum(
            float(segment["distance_m"])
            for segment in segments
            if segment.get("accessibility_status")
            in {"unknown_not_field_verified", "unknown_unmapped_connector"}
        ),
        2,
    )
    negative_evidence = sorted(
        {
            segment.get("accessibility_status")
            for segment in segments
            if segment.get("accessibility_status", "").startswith("known_")
        }
    )
    if negative_evidence:
        accessibility = "known_negative_accessibility_evidence"
    else:
        accessibility = "unknown_not_an_accessibility_claim"

    return {
        "policy": policy,
        "policy_definition": POLICY_DEFINITIONS[policy],
        "from": start_id,
        "to": end_id,
        "node_ids": node_ids,
        "segment_ids": [segment["id"] for segment in segments],
        "distance_m": distance,
        "known_ascent_m": known_ascent,
        "known_descent_m": known_descent,
        "terrain_unknown_distance_m": terrain_unknown_distance,
        "known_step_distance_m": known_step_distance,
        "unknown_access_evidence_distance_m": unknown_access_distance,
        "accessibility_status": accessibility,
        "negative_accessibility_evidence": negative_evidence,
        "cost_tuple": [round(value, 6) for value in cost],
        "topology_status": topology.get("status"),
    }


def load_topology(path: pathlib.Path | None = None) -> dict[str, Any]:
    source = path or (DATA / "path_topology.json")
    return json.loads(source.read_text())


def route(start: str, end: str, *, policy: str = "shortest", path: pathlib.Path | None = None) -> dict[str, Any]:
    return route_document(load_topology(path), start, end, policy=policy)
