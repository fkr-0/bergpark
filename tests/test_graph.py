import json
import os
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = pathlib.Path(os.environ.get("BERGPARK_OUTPUT_DATA", str(ROOT / "data"))).resolve()


class GraphExportTests(unittest.TestCase):
    def test_validation_passes(self):
        report = json.loads((DATA / "validation.json").read_text())
        self.assertEqual("pass", report["status"], report.get("errors"))

    def test_core_places_are_present(self):
        doc = json.loads((DATA / "nodes.json").read_text())
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
        doc = json.loads((DATA / "nodes.json").read_text())
        nodes = {n["id"]: n for n in doc["nodes"]}
        self.assertLess(nodes["herkules"]["lng"], nodes["schloss"]["lng"])
        self.assertLess(nodes["herkules"]["lng"], 9.400)

    def test_phase2_elevation_and_segments_are_present(self):
        nodes = json.loads((DATA / "nodes.json").read_text())["nodes"]
        edges = json.loads((DATA / "edges.json").read_text())["edges"]
        self.assertTrue(all(isinstance(n.get("elevation_m"), (int, float)) for n in nodes))
        self.assertTrue(all(e.get("surface_segments") for e in edges))
        self.assertTrue(all(len(e["elevation_profile_m"]) == len(e["path_coordinates"]) for e in edges))
        self.assertTrue(all(e["elevation_metric_sampling_m"] == 90 for e in edges))
        labels = {e["accessibility"] for e in edges}
        self.assertNotIn("stairs_only", labels)
        self.assertNotIn("potentially_step_free", labels)
        segment_keys = {"access", "foot", "handrail", "osm_way_direction", "osm_incline", "route_incline"}
        self.assertTrue(all(segment_keys <= set(e["surface_segments"][0]) for e in edges))
        for edge in edges:
            if edge["mapped_path_accessibility"] == "potentially_step_free_mapped_path" and edge["endpoint_access_unknown"]:
                self.assertEqual("endpoint_access_unknown", edge["accessibility"])

    def test_reverse_edges_swap_elevation_metrics(self):
        edges = json.loads((DATA / "edges.json").read_text())["edges"]
        by_pair = {(e["from"], e["to"]): e for e in edges}
        for edge in edges:
            reverse = by_pair[(edge["to"], edge["from"])]
            self.assertAlmostEqual(edge["elevation_delta_m"], -reverse["elevation_delta_m"], places=1)
            self.assertAlmostEqual(edge["ascent_m"], reverse["descent_m"], places=1)


    def test_reverse_edges_reverse_surface_traversal(self):
        edges = json.loads((DATA / "edges.json").read_text())["edges"]
        by_pair = {(e["from"], e["to"]): e for e in edges}
        for edge in edges:
            reverse = by_pair[(edge["to"], edge["from"])]
            forward_segments = edge["surface_segments"]
            reverse_segments = reverse["surface_segments"]
            self.assertEqual(
                [s["osm_way_id"] for s in forward_segments],
                list(reversed([s["osm_way_id"] for s in reverse_segments])),
            )
            for forward, backward in zip(forward_segments, reversed(reverse_segments)):
                directions = {forward["osm_way_direction"], backward["osm_way_direction"]}
                if "unknown" not in directions:
                    self.assertEqual({"forward", "reverse"}, directions)
                if forward["route_incline"] in {"up", "down"}:
                    self.assertEqual(
                        "down" if forward["route_incline"] == "up" else "up",
                        backward["route_incline"],
                    )

    def test_watercourse_reference_is_a_separate_audit(self):
        manifest = json.loads((DATA / "source_manifest.json").read_text())
        audit = manifest["watercourse_reference_audit"]
        self.assertEqual(2300, audit["source"]["published_reference"]["visitor_route_distance_m"])
        self.assertIn("do not force", audit["purpose"])
        self.assertNotIn("distance_difference_m", audit)
        self.assertIsInstance(audit["graph_dem_context"]["herkules_to_schloss_endpoint_drop_m"], (int, float))


if __name__ == "__main__":
    unittest.main()

