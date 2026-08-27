import json
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


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
        pairs = {(segment["from"], segment["to"]) for segment in self.segments}
        self.assertEqual(len(self.segments), len(pairs))
        self.assertTrue(all(segment["from"] in node_ids and segment["to"] in node_ids for segment in self.segments))

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
