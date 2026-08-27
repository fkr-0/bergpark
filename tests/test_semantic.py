import json
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


def load(name):
    return json.loads((DATA / name).read_text())


class SemanticGraphTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.nodes = load("nodes.json")["nodes"]
        cls.trees = load("trees.json").get("trees", [])
        cls.benches = load("benches.json").get("benches", [])
        cls.path_topology = load("path_topology.json")
        cls.figures = load("figures.json").get("figures", [])
        cls.semantic = load("semantic.json")
        cls.graph = load("graph.json")
        cls.sources = {source["id"] for source in cls.semantic.get("sources", [])}
        cls.artworks = cls.semantic.get("artworks", [])
        cls.collections = cls.semantic.get("collections", [])
        cls.edges = cls.semantic.get("semantic_edges", [])
        cls.entities = {
            row["id"]
            for rows in (
                cls.nodes,
                cls.trees,
                cls.benches,
                cls.path_topology.get("path_nodes", []),
                cls.figures,
                cls.artworks,
                cls.collections,
            )
            for row in rows
        }

    def test_relations_reference_entities_and_sources(self):
        seen_ids = set()
        seen_relations = set()
        for edge in self.edges:
            self.assertNotIn(edge["id"], seen_ids)
            seen_ids.add(edge["id"])
            key = (edge["from"], edge["relation"], edge["to"])
            self.assertNotIn(key, seen_relations)
            seen_relations.add(key)
            self.assertIn(edge["from"], self.entities)
            self.assertIn(edge["to"], self.entities)
            self.assertIn(edge["confidence"], {"high", "medium", "low"})
            self.assertTrue(edge["source_ids"])
            self.assertTrue(set(edge["source_ids"]) <= self.sources)
            self.assertTrue(edge["provenance"]["basis"])
            self.assertTrue(edge["provenance"]["assertion"])
            self.assertTrue(edge["provenance"]["qualification"])

    def test_required_historical_relations_are_explicit(self):
        relations = {(e["from"], e["relation"], e["to"]) for e in self.edges}
        required = {
            ("person-landgraf-karl-von-hessen-kassel", "commissioned", "herkules"),
            ("person-giovanni-francesco-guerniero", "lead_designer_of", "herkules"),
            ("person-giovanni-francesco-guerniero", "lead_designer_of", "kaskaden"),
            ("person-heinrich-christoph-jussow", "designed", "loewenburg"),
            ("person-heinrich-christoph-jussow", "designed", "aquaedukt"),
            (
                "person-heinrich-christoph-jussow",
                "planned_landscape_setting_for",
                "teufelsbruecke",
            ),
            ("person-rembrandt-van-rijn", "created", "artwork-der-segen-jakobs"),
            (
                "artwork-der-segen-jakobs",
                "member_of_collection",
                "collection-gemaeldegalerie-alte-meister",
            ),
            ("collection-gemaeldegalerie-alte-meister", "located_at", "schloss"),
        }
        self.assertTrue(required <= relations)

    def test_teufelsbruecke_relation_is_phase_qualified(self):
        jussow_edges = [
            edge
            for edge in self.edges
            if edge["from"] == "person-heinrich-christoph-jussow"
            and edge["to"] == "teufelsbruecke"
        ]
        self.assertEqual(1, len(jussow_edges))
        edge = jussow_edges[0]
        self.assertEqual("planned_landscape_setting_for", edge["relation"])
        qualification = edge["provenance"]["qualification"].lower()
        self.assertIn("present bridge", qualification)
        self.assertIn("authorship", qualification)
        self.assertFalse(
            any(
                candidate["from"] == "person-heinrich-christoph-jussow"
                and candidate["to"] == "teufelsbruecke"
                and candidate["relation"] == "designed"
                for candidate in self.edges
            )
        )

    def test_artwork_and_collection_are_first_class_entities(self):
        artwork = next(row for row in self.artworks if row["id"] == "artwork-der-segen-jakobs")
        collection = next(
            row
            for row in self.collections
            if row["id"] == "collection-gemaeldegalerie-alte-meister"
        )
        self.assertEqual("artwork", artwork["kind"])
        self.assertEqual("person-rembrandt-van-rijn", artwork["creator_id"])
        self.assertEqual("collection", collection["kind"])
        self.assertEqual("schloss", collection["current_place_id"])
        self.assertIn(artwork["id"], self.entities)
        self.assertIn(collection["id"], self.entities)

    def test_semantic_entities_have_bilingual_names(self):
        for row in self.figures + self.artworks + self.collections:
            self.assertTrue(row["name"]["de"], row["id"])
            self.assertTrue(row["name"]["en"], row["id"])

    def test_graph_composes_curated_layers_without_spatial_regression(self):
        self.assertEqual(30, len(self.graph["nodes"]))
        self.assertEqual(122, len(self.graph["edges"]))
        self.assertEqual(load("nodes.json")["nodes"], self.graph["nodes"])
        self.assertEqual(load("edges.json")["edges"], self.graph["edges"])
        self.assertEqual(
            {row["id"] for row in self.trees},
            {row["id"] for row in self.graph["trees"]},
        )
        self.assertEqual(self.benches, self.graph["benches"])
        self.assertEqual(self.path_topology["path_nodes"], self.graph["path_nodes"])
        self.assertEqual(self.path_topology["directed_segments"], self.graph["path_segments"])
        self.assertEqual(
            {row["id"] for row in self.figures},
            {row["id"] for row in self.graph["figures"]},
        )
        self.assertEqual(
            {row["id"] for row in self.artworks},
            {row["id"] for row in self.graph["artworks"]},
        )
        self.assertEqual(
            {row["id"] for row in self.collections},
            {row["id"] for row in self.graph["collections"]},
        )
        self.assertEqual(
            {row["id"] for row in self.edges},
            {row["id"] for row in self.graph["semantic_edges"]},
        )
        self.assertEqual(
            "data/semantic.json#sources",
            self.graph["provenance"]["semantic_source_registry"],
        )
        self.assertEqual("scripts/compose_graph.py", self.graph["composition"]["builder"])
        self.assertEqual(9, len(self.graph["composition"]["inputs"]))
        self.assertIn(
            "data/visitor_pois.json",
            {record["path"] for record in self.graph["composition"]["inputs"]},
        )

    def test_phase2_route_semantics_survive_composition(self):
        segment_keys = {
            "access",
            "foot",
            "handrail",
            "osm_way_direction",
            "osm_incline",
            "route_incline",
        }
        for edge in self.graph["edges"]:
            self.assertIn("mapped_path_accessibility", edge)
            self.assertIn("endpoint_access_unknown", edge)
            self.assertTrue(edge["surface_segments"])
            self.assertTrue(segment_keys <= set(edge["surface_segments"][0]))
            self.assertEqual(90, edge["elevation_metric_sampling_m"])


if __name__ == "__main__":
    unittest.main()
