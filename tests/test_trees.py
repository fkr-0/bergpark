import json
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


class CatalogTreeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = json.loads((DATA / "trees.json").read_text())
        cls.trees = cls.doc["trees"]

    def test_all_569_catalogued_trees_are_exported(self):
        self.assertEqual(569, len(self.trees))
        self.assertEqual(569, len({tree["id"] for tree in self.trees}))
        self.assertTrue(all(tree["id"] == f"tree-{tree['osm_node_id']}" for tree in self.trees))

    def test_all_trees_have_position_and_terrain_elevation(self):
        for tree in self.trees:
            self.assertIsInstance(tree["lat"], float)
            self.assertIsInstance(tree["lng"], float)
            self.assertIsInstance(tree["elevation_m"], (int, float))
            self.assertIn("horizontal_accuracy_m", tree["position_source"])
            self.assertEqual("not_reported_by_source", tree["position_source"]["accuracy_status"])

    def test_no_species_description_is_misused_as_specimen_height(self):
        # Current source snapshot contains no `height` tags. A future source may
        # legitimately add them; until then every specimen height must remain unknown.
        reported = [tree for tree in self.trees if tree["height_m"] is not None]
        self.assertEqual([], reported)
        self.assertTrue(all(tree["height_status"] == "unknown_no_measurement_source" for tree in self.trees))

    def test_duplicate_catalog_refs_do_not_collide_stable_ids(self):
        duplicate_refs = self.doc["quality"]["duplicate_catalog_refs"]
        self.assertEqual(8, len(duplicate_refs))
        self.assertTrue(all(len(members) == 2 for members in duplicate_refs.values()))
        self.assertTrue(all(len(set(members)) == len(members) for members in duplicate_refs.values()))

    def test_validation_passes(self):
        report = json.loads((DATA / "tree_validation.json").read_text())
        self.assertEqual("pass", report["status"], report["errors"])


if __name__ == "__main__":
    unittest.main()
