import json
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


class BenchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = json.loads((DATA / "benches.json").read_text())
        cls.benches = cls.doc["benches"]

    def test_snapshot_has_215_unique_benches(self):
        self.assertEqual(215, len(self.benches))
        self.assertEqual(215, len({b["id"] for b in self.benches}))

    def test_each_bench_is_spatially_provenanced(self):
        for bench in self.benches:
            self.assertEqual(bench["id"], f"bench-{bench['osm_node_id']}")
            self.assertIsInstance(bench["elevation_m"], (int, float))
            self.assertEqual("source_node", bench["position_source"]["method"])
            self.assertEqual("source_point", bench["position_source"]["position_type"])
            self.assertTrue(bench["position_source"]["snapshot"].startswith("data/sources/osm-map/"))
            self.assertEqual("not_reported_by_source", bench["position_source"]["accuracy_status"])
            self.assertIsNone(bench["elevation_source"]["vertical_accuracy_m"])
            self.assertEqual("not_reported_in_project_source", bench["elevation_source"]["accuracy_status"])
            self.assertIsNone(bench["height_m"])
            self.assertEqual("unknown_no_measurement_source", bench["height_status"])
            self.assertIsNone(bench["height_source"])

    def test_validation_passes(self):
        report = json.loads((DATA / "bench_validation.json").read_text())
        self.assertEqual("pass", report["status"], report["errors"])


if __name__ == "__main__":
    unittest.main()
