import copy
import json
import os
import pathlib
import unittest

from scripts.path_routing import RouteNotFoundError, route_document


ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = pathlib.Path(os.environ.get("BERGPARK_OUTPUT_DATA", str(ROOT / "data"))).resolve()


class PathRoutingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.topology = json.loads((DATA / "path_topology.json").read_text())
        cls.edges = json.loads((DATA / "edges.json").read_text())["edges"]

    def test_shortest_reproduces_all_phase2_connections_with_rounding_tolerance(self):
        for edge in self.edges:
            result = route_document(
                self.topology, edge["from"], edge["to"], policy="shortest"
            )
            self.assertLessEqual(
                abs(result["distance_m"] - edge["distance_m"]),
                0.25,
                edge["id"],
            )
            self.assertEqual("pathnode-place-" + edge["from"], result["from"])
            self.assertEqual("pathnode-place-" + edge["to"], result["to"])

    def test_policies_are_deterministic_and_do_not_claim_accessibility(self):
        for policy in ("shortest", "avoid_known_steps_lower_ascent"):
            first = route_document(self.topology, "herkules", "schloss", policy=policy)
            second = route_document(self.topology, "herkules", "schloss", policy=policy)
            self.assertEqual(first, second)
            self.assertIn(
                first["accessibility_status"],
                {
                    "known_negative_accessibility_evidence",
                    "unknown_not_an_accessibility_claim",
                },
            )

    def test_avoid_known_steps_policy_can_choose_a_step_free_weighted_alternative(self):
        shortest = route_document(
            self.topology, "aquaedukt", "neuer-wasserfall", policy="shortest"
        )
        evidence = route_document(
            self.topology,
            "aquaedukt",
            "neuer-wasserfall",
            policy="avoid_known_steps_lower_ascent",
        )
        self.assertGreater(shortest["known_step_distance_m"], 0)
        self.assertEqual(0, evidence["known_step_distance_m"])
        self.assertGreater(evidence["distance_m"], shortest["distance_m"])
        self.assertNotEqual(shortest["segment_ids"], evidence["segment_ids"])

    def test_disconnected_preserved_source_component_fails_closed(self):
        disconnected = next(
            component
            for component in self.topology["connected_components"]
            if not component["related_place_ids"]
        )
        with self.assertRaises(RouteNotFoundError):
            route_document(
                self.topology,
                "herkules",
                disconnected["path_node_ids"][0],
                policy="shortest",
            )

    def test_private_and_no_foot_segments_are_never_traversed(self):
        base = {
            "status": "test",
            "path_nodes": [{"id": "a"}, {"id": "b"}],
            "directed_segments": [
                {
                    "id": "blocked",
                    "from": "a",
                    "to": "b",
                    "distance_m": 1.0,
                    "routing_eligible": True,
                    "access": "private",
                    "foot": None,
                    "barrier_evidence": [],
                    "steps": False,
                    "ascent_m": None,
                    "descent_m": None,
                    "accessibility_status": "unknown_not_field_verified",
                }
            ],
        }
        with self.assertRaises(RouteNotFoundError):
            route_document(base, "a", "b")
        no_foot = copy.deepcopy(base)
        no_foot["directed_segments"][0]["access"] = None
        no_foot["directed_segments"][0]["foot"] = "no"
        with self.assertRaises(RouteNotFoundError):
            route_document(no_foot, "a", "b")

    def test_unknown_access_remains_unknown_even_when_route_exists(self):
        topology = {
            "status": "test",
            "path_nodes": [{"id": "a"}, {"id": "b"}],
            "directed_segments": [
                {
                    "id": "unknown",
                    "from": "a",
                    "to": "b",
                    "distance_m": 10.0,
                    "routing_eligible": True,
                    "access": None,
                    "foot": None,
                    "barrier_evidence": [],
                    "steps": False,
                    "ascent_m": None,
                    "descent_m": None,
                    "accessibility_status": "unknown_not_field_verified",
                }
            ],
        }
        result = route_document(topology, "a", "b")
        self.assertEqual("unknown_not_an_accessibility_claim", result["accessibility_status"])
        self.assertEqual(10.0, result["unknown_access_evidence_distance_m"])

    def test_routing_validation_report_passes(self):
        report = json.loads((DATA / "path_routing_validation.json").read_text())
        self.assertEqual("pass", report["status"], report["errors"])
        self.assertEqual(122, report["summary"]["phase2_routes_checked"])
        self.assertLessEqual(report["summary"]["phase2_max_distance_delta_m"], 0.25)


if __name__ == "__main__":
    unittest.main()
