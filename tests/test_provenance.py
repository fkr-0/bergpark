import copy
import json
import pathlib
import unittest

from scripts.provenance_contract import (
    validate_metric_profile,
    validate_spatial_entity,
)


ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


def load(name):
    return json.loads((DATA / name).read_text())


class ProvenanceContractTests(unittest.TestCase):
    def test_all_coordinate_bearing_canonical_layers_follow_common_contract(self):
        groups = (
            ("place", load("nodes.json")["nodes"]),
            ("tree", load("trees.json")["trees"]),
            ("bench", load("benches.json")["benches"]),
            ("path_node", load("path_topology.json")["path_nodes"]),
            ("visitor_poi", load("visitor_pois.json")["pois"]),
        )
        failures = []
        for label, rows in groups:
            for row in rows:
                failures.extend(
                    validate_spatial_entity(row, label=f"{label}:{row['id']}")
                )
        self.assertEqual([], failures)

    def test_semantic_entities_have_no_unqualified_partial_coordinates(self):
        semantic = load("semantic.json")
        for group in ("artworks", "collections"):
            for row in semantic[group]:
                spatial_keys = {"lat", "lng", "elevation_m", "position_source", "elevation_source"}
                present = spatial_keys & set(row)
                self.assertEqual(set(), present, row["id"])

    def test_path_place_nodes_preserve_source_vs_representative_role(self):
        nodes = [
            row
            for row in load("path_topology.json")["path_nodes"]
            if row["related_place_ids"]
        ]
        self.assertEqual(30, len(nodes))
        self.assertEqual(
            6,
            sum(row["position_source"]["position_type"] == "source_point" for row in nodes),
        )
        self.assertEqual(
            24,
            sum(row["position_source"]["position_type"] == "representative_point" for row in nodes),
        )
        self.assertTrue(all(row["position_source"]["kind"] == "place_position" for row in nodes))

    def test_route_and_path_metric_profiles_are_machine_readable(self):
        edges = load("edges.json")
        topology = load("path_topology.json")
        edge_failures = validate_metric_profile(
            edges["derived_metric_profile"],
            label="edges",
            required_metrics=(
                "distance_m",
                "elevation_delta_m",
                "ascent_m",
                "descent_m",
                "avg_grade_pct",
                "walking_min",
                "surface",
                "mapped_path_accessibility",
                "endpoint_snap_total_m",
                "accessibility",
            ),
        )
        path_failures = validate_metric_profile(
            topology["derived_metric_profile"],
            label="path_topology",
            required_metrics=(
                "distance_m",
                "elevation_delta_m",
                "ascent_m",
                "descent_m",
                "avg_grade_pct",
                "surface",
                "access",
                "accessibility_status",
            ),
        )
        self.assertEqual([], edge_failures + path_failures)
        self.assertIn("90 m", edges["derived_metric_profile"]["metrics"]["ascent_m"]["assumptions"])
        self.assertIn("90 m", topology["derived_metric_profile"]["metrics"]["avg_grade_pct"]["assumptions"])

    def test_negative_accuracy_fails_closed(self):
        row = copy.deepcopy(load("benches.json")["benches"][0])
        row["position_source"]["horizontal_accuracy_m"] = -0.1
        failures = validate_spatial_entity(row, label="mutated-bench")
        self.assertTrue(any("horizontal_accuracy_m" in failure for failure in failures))

    def test_nonfinite_accuracy_fails_closed(self):
        row = copy.deepcopy(load("benches.json")["benches"][0])
        row["position_source"]["horizontal_accuracy_m"] = float("inf")
        failures = validate_spatial_entity(row, label="mutated-bench")
        self.assertTrue(any("horizontal_accuracy_m" in failure for failure in failures))

    def test_false_exactness_without_numeric_accuracy_fails_closed(self):
        row = copy.deepcopy(load("trees.json")["trees"][0])
        row["position_source"]["accuracy_status"] = "exact_position"
        row["position_source"]["horizontal_accuracy_m"] = None
        failures = validate_spatial_entity(row, label="mutated-tree")
        self.assertTrue(any("exactness" in failure for failure in failures))

    def test_representative_point_cannot_be_conflated_with_entrance(self):
        row = copy.deepcopy(
            next(
                item
                for item in load("visitor_pois.json")["pois"]
                if item["position_source"]["position_type"] == "representative_point"
            )
        )
        row["position_source"]["method"] = "entrance_node"
        failures = validate_spatial_entity(row, label="mutated-representative")
        self.assertTrue(any("representative point" in failure for failure in failures))

    def test_terrain_elevation_cannot_be_reused_as_physical_height(self):
        row = copy.deepcopy(load("nodes.json")["nodes"][0])
        row["height_m"] = row["elevation_m"]
        row["height_status"] = "source_reported"
        row["height_source"] = copy.deepcopy(row["elevation_source"])
        failures = validate_spatial_entity(row, label="mutated-place")
        self.assertTrue(any("physical_height" in failure or "terrain elevation" in failure for failure in failures))

    def test_short_path_grade_uncertainty_remains_explicit(self):
        segments = load("path_topology.json")["directed_segments"]
        short = [row for row in segments if row["distance_m"] < 90]
        self.assertTrue(short)
        for row in short:
            self.assertEqual("below_dem_horizontal_resolution", row["terrain_metric_status"])
            self.assertIsNone(row["ascent_m"])
            self.assertIsNone(row["descent_m"])
            self.assertIsNone(row["avg_grade_pct"])


if __name__ == "__main__":
    unittest.main()
