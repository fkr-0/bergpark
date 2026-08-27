import json
import pathlib
import unittest
from collections import Counter

from scripts.build_visitor_pois import build_document, selection_sha256, source_candidates
from scripts.validate_visitor_pois import validate_document


ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


class VisitorPoiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = json.loads((DATA / "visitor_pois.json").read_text())
        cls.pois = cls.doc["pois"]
        cls.by_id = {row["id"]: row for row in cls.pois}

    def test_snapshot_selection_has_expected_current_tranche(self):
        self.assertEqual(109, len(self.pois))
        self.assertEqual(
            {
                "access": 68,
                "toilet": 9,
                "drinking_water": 1,
                "viewpoint": 13,
                "shelter": 1,
                "transit": 6,
                "artwork": 11,
            },
            dict(Counter(row["family"] for row in self.pois)),
        )
        self.assertEqual(100, sum(row["scope"]["relation"] == "inside_park" for row in self.pois))
        self.assertEqual(8, sum(row["scope"]["relation"] == "boundary_external" for row in self.pois))
        self.assertEqual(1, sum(row["scope"]["relation"] == "external_relevant" for row in self.pois))

    def test_ids_and_source_elements_are_unique_and_source_derived(self):
        ids = [row["id"] for row in self.pois]
        elements = [(row["osm_element"]["type"], row["osm_element"]["id"]) for row in self.pois]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(len(elements), len(set(elements)))
        for row in self.pois:
            element = row["osm_element"]
            self.assertEqual(
                f"visitor-poi-osm-{element['type']}-{element['id']}",
                row["id"],
            )

    def test_common_spatial_contract_and_height_separation(self):
        for row in self.pois:
            self.assertIsInstance(row["lat"], (int, float))
            self.assertIsInstance(row["lng"], (int, float))
            self.assertIsInstance(row["elevation_m"], (int, float))
            self.assertIn(row["scope"]["relation"], {"inside_park", "boundary_external", "external_relevant"})
            self.assertIn("horizontal_accuracy_m", row["position_source"])
            self.assertIn("vertical_accuracy_m", row["elevation_source"])
            self.assertEqual("ODbL-1.0", row["position_source"]["license"])
            self.assertEqual("Copernicus DEM 2021 GLO-90", row["elevation_source"]["dataset"])
            self.assertEqual("not_reported_in_project_source", row["elevation_source"]["accuracy_status"])
            self.assertIsNone(row["height_m"])
            self.assertEqual("unknown_no_measurement_source", row["height_status"])
            self.assertIsNone(row["height_source"])

    def test_access_points_are_mapped_nodes_not_representative_centroids(self):
        access = [row for row in self.pois if row["family"] == "access"]
        self.assertTrue(access)
        for row in access:
            self.assertEqual("node", row["osm_element"]["type"])
            self.assertEqual("source_node", row["position_source"]["method"])
            self.assertEqual("source_point", row["position_source"]["position_type"])
            self.assertTrue({"entrance", "barrier"} & set(row["source_tags"]))

    def test_toilet_accessibility_is_source_evidence_not_inference(self):
        toilets = [row for row in self.pois if row["family"] == "toilet"]
        self.assertEqual(9, len(toilets))
        wheelchair_values = Counter(row["source_tags"].get("wheelchair") for row in toilets)
        self.assertEqual(6, wheelchair_values["yes"])
        self.assertEqual(3, wheelchair_values["no"])
        tagged = self.by_id["visitor-poi-osm-node-1759866066"]
        self.assertEqual("yes", tagged["source_tags"]["toilets:wheelchair"])
        self.assertEqual("yes", tagged["source_tags"]["wheelchair"])

    def test_external_and_transit_representative_points_are_explicit(self):
        viewpoint = self.by_id["visitor-poi-osm-node-5762435318"]
        self.assertEqual("Blick zum Herkules", viewpoint["name"])
        self.assertEqual("external_relevant", viewpoint["scope"]["relation"])
        self.assertGreater(viewpoint["scope"]["boundary_distance_m"], 100)

        transit = [row for row in self.pois if row["family"] == "transit"]
        self.assertEqual({"Herkules", "Wilhelmshöhe (Park)"}, {row["name"] for row in transit})
        representative = [row for row in transit if row["osm_element"]["type"] == "way"]
        self.assertEqual(5, len(representative))
        for row in representative:
            self.assertEqual("bounds_midpoint", row["position_source"]["method"])
            self.assertEqual("representative_point", row["position_source"]["position_type"])
            self.assertNotEqual("access", row["family"])

    def test_elevation_snapshot_is_bound_to_exact_selection(self):
        elevation = json.loads((DATA / "sources" / "visitor-poi-elevation" / "points.json").read_text())
        candidates = source_candidates()
        self.assertEqual(selection_sha256(candidates), elevation["selection_input_sha256"])
        self.assertEqual(109, elevation["poi_count"])
        points = {row["poi_id"]: row for row in elevation["points"]}
        self.assertEqual({row["id"] for row in candidates}, set(points))
        for row in candidates:
            point = points[row["id"]]
            self.assertEqual(row["lat"], point["lat"])
            self.assertEqual(row["lng"], point["lng"])

    def test_builder_and_validator_match_preserved_sources_exactly(self):
        self.assertEqual(self.doc, build_document())
        checks, errors = validate_document(self.doc)
        self.assertEqual([], errors)
        self.assertTrue(all(check["pass"] for check in checks))
        coverage = self.doc["quality"]["coverage_note"].lower()
        self.assertIn("absence", coverage)
        self.assertIn("not evidence", coverage)


if __name__ == "__main__":
    unittest.main()
