import json
import os
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = pathlib.Path(os.environ.get("BERGPARK_OUTPUT_DATA", str(ROOT / "data"))).resolve()


class PathTopologyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = json.loads((DATA / "path_topology.json").read_text())
        cls.nodes = cls.doc["path_nodes"]
        cls.segments = cls.doc["directed_segments"]

    def test_nodes_have_position_elevation_and_next_functions(self):
        self.assertGreater(len(self.nodes), 100)
        for node in self.nodes:
            self.assertIsInstance(node["lat"], float)
            self.assertIsInstance(node["lng"], float)
            self.assertIsInstance(node["elevation_m"], (int, float))
            self.assertIn(node["position_source"]["position_type"], {"source_point", "representative_point"})
            self.assertIn("horizontal_accuracy_m", node["position_source"])
            self.assertIn("accuracy_status", node["elevation_source"])
            self.assertIsInstance(node["next_segment_ids"], list)

    def test_place_path_nodes_preserve_position_role(self):
        place_nodes = [node for node in self.nodes if node["related_place_ids"]]
        self.assertEqual(30, len(place_nodes))
        self.assertEqual(6, sum(node["position_source"]["position_type"] == "source_point" for node in place_nodes))
        self.assertEqual(24, sum(node["position_source"]["position_type"] == "representative_point" for node in place_nodes))
        self.assertTrue(all(node["position_source"]["kind"] == "place_position" for node in place_nodes))

    def test_derived_metric_profile_declares_short_segment_uncertainty(self):
        profile = self.doc["derived_metric_profile"]
        self.assertEqual("directed_segments[*]", profile["applies_to"])
        self.assertIn("90 m", profile["metrics"]["avg_grade_pct"]["assumptions"])
        short = [segment for segment in self.segments if segment["distance_m"] < 90]
        self.assertTrue(short)
        self.assertTrue(all(segment["terrain_metric_status"] == "below_dem_horizontal_resolution" for segment in short))
        self.assertTrue(all(segment["avg_grade_pct"] is None for segment in short))

    def test_segments_are_unique_and_reference_nodes(self):
        node_ids = {node["id"] for node in self.nodes}
        segment_ids = [segment["id"] for segment in self.segments]
        self.assertEqual(len(self.segments), len(set(segment_ids)))
        self.assertTrue(all(segment["from"] in node_ids and segment["to"] in node_ids for segment in self.segments))

    def test_phase8_complete_preserved_source_scope_is_explicitly_bounded(self):
        self.assertEqual("qualified_complete_preserved_source_scope", self.doc["status"])
        coverage = self.doc["coverage"]
        self.assertEqual("complete_preserved_source_scope_not_physical_inventory", coverage["status"])
        self.assertFalse(coverage["physical_inventory_claim"])
        self.assertEqual("way/608171475", coverage["boundary_element"])
        self.assertEqual("source_boundary_explicitly_not_fully_checked", coverage["boundary_quality_status"])
        self.assertEqual(955, coverage["included_walkable_ways"])
        self.assertEqual(41, coverage["excluded_touching_ways"])
        self.assertEqual(11, coverage["final_connected_components"])
        self.assertEqual(self.doc["path_node_count"], coverage["final_path_nodes"])
        self.assertEqual(self.doc["directed_segment_count"], coverage["final_directed_segments"])

    def test_phase7_projection_is_preserved_inside_expanded_topology(self):
        legacy = [
            segment
            for segment in self.segments
            if segment["source_kind"] in {
                "osm_walkable_adjacency",
                "representative_point_snap_connector",
            }
        ]
        self.assertEqual(2858, len(legacy))
        self.assertEqual(60, sum(s["source_kind"] == "representative_point_snap_connector" for s in legacy))
        route_ids = {
            route_id
            for segment in legacy
            for route_id in segment.get("route_edge_ids", [])
        }
        phase2_ids = {edge["id"] for edge in json.loads((DATA / "edges.json").read_text())["edges"]}
        self.assertEqual(phase2_ids, route_ids)

    def test_every_routable_segment_has_reverse_or_source_backed_oneway_reason(self):
        by_id = {segment["id"]: segment for segment in self.segments}
        failures = []
        for segment in self.segments:
            if segment.get("routing_eligible") is not True:
                continue
            reverse_id = segment.get("reverse_segment_id")
            if reverse_id:
                reverse = by_id.get(reverse_id)
                if not reverse or reverse.get("from") != segment["to"] or reverse.get("to") != segment["from"]:
                    failures.append(segment["id"])
            elif not segment.get("one_way_reason"):
                failures.append(segment["id"])
        self.assertEqual([], failures)

    def test_private_and_no_foot_source_facts_never_leak_into_routing(self):
        leaked = []
        for segment in self.segments:
            if segment.get("routing_eligible") is not True:
                continue
            if segment.get("foot") == "no":
                leaked.append(segment["id"])
            if segment.get("access") in {"private", "no"} and segment.get("foot") not in {"yes", "designated", "permissive"}:
                leaked.append(segment["id"])
        self.assertEqual([], leaked)

    def test_unmapped_snap_connectors_do_not_guess_accessibility(self):
        connectors = [s for s in self.segments if s["source_kind"] == "representative_point_snap_connector"]
        self.assertGreater(len(connectors), 0)
        for segment in connectors:
            self.assertEqual("unknown_unmapped_connector", segment["accessibility_status"])
            self.assertIsNone(segment["surface"])
            self.assertIsNone(segment["steps"])
            self.assertIsNone(segment["access"])

    def test_validation_passes(self):
        report = json.loads((DATA / "path_topology_validation.json").read_text())
        self.assertEqual("pass", report["status"], report["errors"])


if __name__ == "__main__":
    unittest.main()
