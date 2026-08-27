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
            self.assertIsInstance(node["next_segment_ids"], list)

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
