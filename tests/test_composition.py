import json
import pathlib
import shutil
import tempfile
import unittest

from scripts.compose_graph import assert_graph_inputs_current, compose_graph, sha256_file


ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
WORK = ROOT / ".work"
CORE_INPUTS = ("nodes.json", "edges.json", "source_manifest.json")
INDEPENDENT_INPUTS = (
    "trees.json",
    "benches.json",
    "path_topology.json",
    "visitor_pois.json",
    "figures.json",
    "semantic.json",
)


class CompositionTests(unittest.TestCase):
    def setUp(self):
        WORK.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="bergpark-compose-phase4-", dir=WORK)
        self.output = pathlib.Path(self.temp.name)
        for filename in CORE_INPUTS:
            shutil.copy2(DATA / filename, self.output / filename)

    def tearDown(self):
        self.temp.cleanup()

    def test_composer_only_writes_graph_and_is_byte_deterministic(self):
        before = {filename: sha256_file(DATA / filename) for filename in INDEPENDENT_INPUTS}

        first = compose_graph(self.output)
        first_bytes = (self.output / "graph.json").read_bytes()
        second = compose_graph(self.output)
        second_bytes = (self.output / "graph.json").read_bytes()

        self.assertEqual(first_bytes, second_bytes)
        self.assertEqual(first["composition"], second["composition"])
        self.assertEqual(
            before,
            {filename: sha256_file(DATA / filename) for filename in INDEPENDENT_INPUTS},
        )
        self.assertEqual(set(CORE_INPUTS) | {"graph.json"}, {p.name for p in self.output.iterdir()})

    def test_composed_spatial_layers_match_independent_producers_exactly(self):
        graph = compose_graph(self.output)
        benches = json.loads((DATA / "benches.json").read_text())
        topology = json.loads((DATA / "path_topology.json").read_text())
        visitor_pois = json.loads((DATA / "visitor_pois.json").read_text())

        self.assertEqual(benches["benches"], graph["benches"])
        self.assertEqual(topology["path_nodes"], graph["path_nodes"])
        self.assertEqual(topology["directed_segments"], graph["path_segments"])
        self.assertEqual(visitor_pois["pois"], graph["visitor_pois"])
        self.assertEqual(215, len(graph["benches"]))
        self.assertEqual(1408, len(graph["path_nodes"]))
        self.assertEqual(2858, len(graph["path_segments"]))
        self.assertEqual(109, len(graph["visitor_pois"]))
        self.assertEqual("data/benches.json", graph["provenance"]["bench_layer"])
        self.assertEqual("data/path_topology.json", graph["provenance"]["path_topology_layer"])
        self.assertEqual("data/visitor_pois.json", graph["provenance"]["visitor_poi_layer"])
        assert_graph_inputs_current(graph, self.output)

    def test_stale_composition_hash_fails_closed(self):
        graph = compose_graph(self.output)
        shutil.copy2(DATA / "benches.json", self.output / "benches.json")
        benches = json.loads((self.output / "benches.json").read_text())
        benches["status"] = "changed-after-composition"
        (self.output / "benches.json").write_text(json.dumps(benches, ensure_ascii=False, indent=2) + "\n")

        with self.assertRaisesRegex(ValueError, "stale"):
            assert_graph_inputs_current(graph, self.output)

    def test_incompatible_input_schema_fails_before_graph_write(self):
        nodes_path = self.output / "nodes.json"
        nodes = json.loads(nodes_path.read_text())
        nodes["schema_version"] = 99
        nodes_path.write_text(json.dumps(nodes, ensure_ascii=False, indent=2) + "\n")

        with self.assertRaisesRegex(ValueError, "schema_version"):
            compose_graph(self.output)
        self.assertFalse((self.output / "graph.json").exists())

    def test_invalid_place_accuracy_contract_fails_before_graph_write(self):
        nodes_path = self.output / "nodes.json"
        nodes = json.loads(nodes_path.read_text())
        nodes["nodes"][0]["position_source"]["horizontal_accuracy_m"] = -1
        nodes_path.write_text(json.dumps(nodes, ensure_ascii=False, indent=2) + "\n")

        with self.assertRaisesRegex(ValueError, "normalized position/elevation provenance"):
            compose_graph(self.output)
        self.assertFalse((self.output / "graph.json").exists())

    def test_representative_place_cannot_be_mislabeled_as_source_point(self):
        nodes_path = self.output / "nodes.json"
        nodes = json.loads(nodes_path.read_text())
        representative = next(
            node
            for node in nodes["nodes"]
            if node["position_source"]["position_type"] == "representative_point"
        )
        representative["position_source"]["position_type"] = "source_point"
        nodes_path.write_text(json.dumps(nodes, ensure_ascii=False, indent=2) + "\n")

        with self.assertRaisesRegex(ValueError, "normalized position/elevation provenance"):
            compose_graph(self.output)
        self.assertFalse((self.output / "graph.json").exists())

    def test_invalid_tree_common_accuracy_contract_fails_before_graph_write(self):
        tree_path = self.output / "trees.json"
        shutil.copy2(DATA / "trees.json", tree_path)
        trees = json.loads(tree_path.read_text())
        trees["trees"][0]["position_source"]["horizontal_accuracy_m"] = -1
        tree_path.write_text(json.dumps(trees, ensure_ascii=False, indent=2) + "\n")

        with self.assertRaisesRegex(ValueError, "common spatial provenance contract"):
            compose_graph(self.output)
        self.assertFalse((self.output / "graph.json").exists())

    def test_false_exact_bench_position_fails_before_graph_write(self):
        bench_path = self.output / "benches.json"
        shutil.copy2(DATA / "benches.json", bench_path)
        benches = json.loads(bench_path.read_text())
        benches["benches"][0]["position_source"]["accuracy_status"] = "exact_position"
        benches["benches"][0]["position_source"]["horizontal_accuracy_m"] = None
        bench_path.write_text(json.dumps(benches, ensure_ascii=False, indent=2) + "\n")

        with self.assertRaisesRegex(ValueError, "common spatial provenance contract"):
            compose_graph(self.output)
        self.assertFalse((self.output / "graph.json").exists())

    def test_path_representative_point_cannot_be_mislabeled_as_entrance(self):
        path = self.output / "path_topology.json"
        shutil.copy2(DATA / "path_topology.json", path)
        topology = json.loads(path.read_text())
        representative = next(
            row for row in topology["path_nodes"]
            if row["position_source"]["position_type"] == "representative_point"
        )
        representative["position_source"]["method"] = "entrance_node"
        path.write_text(json.dumps(topology, ensure_ascii=False, indent=2) + "\n")

        with self.assertRaisesRegex(ValueError, "common spatial provenance contract"):
            compose_graph(self.output)
        self.assertFalse((self.output / "graph.json").exists())

    def test_terrain_provenance_cannot_be_reused_as_physical_height(self):
        nodes_path = self.output / "nodes.json"
        nodes = json.loads(nodes_path.read_text())
        node = nodes["nodes"][0]
        node["height_m"] = node["elevation_m"]
        node["height_status"] = "source_reported"
        node["height_source"] = dict(node["elevation_source"])
        nodes_path.write_text(json.dumps(nodes, ensure_ascii=False, indent=2) + "\n")

        with self.assertRaisesRegex(ValueError, "common spatial provenance contract|normalized position/elevation provenance"):
            compose_graph(self.output)
        self.assertFalse((self.output / "graph.json").exists())

    def test_unqualified_route_metric_algorithm_fails_before_graph_write(self):
        edges_path = self.output / "edges.json"
        edges = json.loads(edges_path.read_text())
        edges["derived_metric_profile"]["metrics"]["ascent_m"]["algorithm"] = ""
        edges_path.write_text(json.dumps(edges, ensure_ascii=False, indent=2) + "\n")

        with self.assertRaisesRegex(ValueError, "derived metric provenance contract"):
            compose_graph(self.output)
        self.assertFalse((self.output / "graph.json").exists())

    def test_unqualified_path_metric_assumption_fails_before_graph_write(self):
        path = self.output / "path_topology.json"
        shutil.copy2(DATA / "path_topology.json", path)
        topology = json.loads(path.read_text())
        topology["derived_metric_profile"]["metrics"]["avg_grade_pct"]["assumptions"] = ""
        path.write_text(json.dumps(topology, ensure_ascii=False, indent=2) + "\n")

        with self.assertRaisesRegex(ValueError, "derived metric provenance contract"):
            compose_graph(self.output)
        self.assertFalse((self.output / "graph.json").exists())

    def test_duplicate_poi_ids_fail_closed(self):
        benches_path = self.output / "benches.json"
        shutil.copy2(DATA / "benches.json", benches_path)
        benches = json.loads(benches_path.read_text())
        benches["benches"][1]["id"] = benches["benches"][0]["id"]
        benches_path.write_text(json.dumps(benches, ensure_ascii=False, indent=2) + "\n")

        with self.assertRaisesRegex(ValueError, "duplicate ids"):
            compose_graph(self.output)
        self.assertFalse((self.output / "graph.json").exists())

    def test_invalid_visitor_poi_contract_fails_before_graph_write(self):
        visitor_path = self.output / "visitor_pois.json"
        shutil.copy2(DATA / "visitor_pois.json", visitor_path)
        visitor = json.loads(visitor_path.read_text())
        access = next(row for row in visitor["pois"] if row["family"] == "access")
        access["position_source"]["position_type"] = "representative_point"
        visitor_path.write_text(json.dumps(visitor, ensure_ascii=False, indent=2) + "\n")

        with self.assertRaisesRegex(ValueError, "visitor POIs lack normalized"):
            compose_graph(self.output)
        self.assertFalse((self.output / "graph.json").exists())

    def test_stale_visitor_poi_hash_fails_closed(self):
        graph = compose_graph(self.output)
        visitor_path = self.output / "visitor_pois.json"
        shutil.copy2(DATA / "visitor_pois.json", visitor_path)
        visitor = json.loads(visitor_path.read_text())
        visitor["quality"]["transit_note"] += " changed"
        visitor_path.write_text(json.dumps(visitor, ensure_ascii=False, indent=2) + "\n")

        with self.assertRaisesRegex(ValueError, "stale"):
            assert_graph_inputs_current(graph, self.output)

    def test_broken_semantic_provenance_fails_closed(self):
        semantic_path = self.output / "semantic.json"
        shutil.copy2(DATA / "semantic.json", semantic_path)
        semantic = json.loads(semantic_path.read_text())
        semantic["semantic_edges"][0]["provenance"]["qualification"] = ""
        semantic_path.write_text(json.dumps(semantic, ensure_ascii=False, indent=2) + "\n")

        with self.assertRaisesRegex(ValueError, "source/confidence/provenance"):
            compose_graph(self.output)
        self.assertFalse((self.output / "graph.json").exists())


if __name__ == "__main__":
    unittest.main()
