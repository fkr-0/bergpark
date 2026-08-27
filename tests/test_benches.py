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
            self.assertEqual("not_reported_by_source", bench["position_source"]["accuracy_status"])

    def test_validation_passes(self):
        report = json.loads((DATA / "bench_validation.json").read_text())
        self.assertEqual("pass", report["status"], report["errors"])


if __name__ == "__main__":
    unittest.main()
