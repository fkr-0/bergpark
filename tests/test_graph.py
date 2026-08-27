import json
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class GraphExportTests(unittest.TestCase):
    def test_validation_passes(self):
        report = json.loads((ROOT / "data" / "validation.json").read_text())
        self.assertEqual("pass", report["status"], report.get("errors"))

    def test_core_places_are_present(self):
        doc = json.loads((ROOT / "data" / "nodes.json").read_text())
        ids = {node["id"] for node in doc["nodes"]}
        required = {
            "herkules",
            "schloss",
            "loewenburg",
            "kaskaden",
            "grosse-fontaene",
            "steinhofer-wasserfall",
            "teufelsbruecke",
            "aquaedukt",
        }
        self.assertTrue(required <= ids)

    def test_herkules_is_west_of_palace(self):
        doc = json.loads((ROOT / "data" / "nodes.json").read_text())
        nodes = {n["id"]: n for n in doc["nodes"]}
        self.assertLess(nodes["herkules"]["lng"], nodes["schloss"]["lng"])
        self.assertLess(nodes["herkules"]["lng"], 9.400)


if __name__ == "__main__":
    unittest.main()

