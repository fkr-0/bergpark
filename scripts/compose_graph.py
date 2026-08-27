"""Compose independently owned Bergpark graph layers into data/graph.json.

This module is intentionally composition-only: it reads validated canonical
layers and writes only graph.json. It never regenerates or rewrites nodes,
edges, trees, benches, path topology, figures, semantic data, content, or source
registries.
"""

from __future__ import annotations

import hashlib
import json
import os
import pathlib
from dataclasses import dataclass
from typing import Any

try:
    from .provenance_contract import (
        validate_elevation_source,
        validate_metric_profile,
        validate_spatial_entity,
    )
except ImportError:  # Direct `python scripts/compose_graph.py` execution.
    from provenance_contract import (
        validate_elevation_source,
        validate_metric_profile,
        validate_spatial_entity,
    )


ROOT = pathlib.Path(__file__).resolve().parents[1]
CANONICAL_DATA = ROOT / "data"
COMPOSITION_SCHEMA_VERSION = 1
GRAPH_SCHEMA_VERSION = 1


@dataclass(frozen=True)
class LayerSpec:
    filename: str
    schema_version: int
    required_lists: tuple[str, ...]
    allow_canonical_fallback: bool = True

    @property
    def logical_path(self) -> str:
        return f"data/{self.filename}"


LAYER_SPECS = (
    LayerSpec("nodes.json", 2, ("nodes",), False),
    LayerSpec("edges.json", 1, ("edges",), False),
    LayerSpec("trees.json", 2, ("trees",)),
    LayerSpec("benches.json", 1, ("benches",)),
    LayerSpec("path_topology.json", 1, ("path_nodes", "directed_segments")),
    LayerSpec("visitor_pois.json", 1, ("pois",)),
    LayerSpec("figures.json", 1, ("figures",)),
    LayerSpec("semantic.json", 1, ("sources", "artworks", "collections", "semantic_edges")),
    LayerSpec("source_manifest.json", 1, (), False),
)


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def resolve_layer_path(data_dir: pathlib.Path, spec: LayerSpec) -> pathlib.Path:
    candidate = data_dir / spec.filename
    if candidate.is_file():
        return candidate
    if spec.allow_canonical_fallback:
        canonical = CANONICAL_DATA / spec.filename
        if canonical.is_file():
            return canonical
    raise FileNotFoundError(f"missing required composition input {spec.logical_path}")


def load_layer(data_dir: pathlib.Path, spec: LayerSpec) -> tuple[dict[str, Any], pathlib.Path]:
    path = resolve_layer_path(data_dir, spec)
    doc = json.loads(path.read_text())
    if not isinstance(doc, dict):
        raise TypeError(f"{spec.logical_path} must contain a JSON object")
    actual_schema = doc.get("schema_version")
    if actual_schema != spec.schema_version:
        raise ValueError(
            f"{spec.logical_path} schema_version {actual_schema!r} is incompatible; "
            f"expected {spec.schema_version}"
        )
    for key in spec.required_lists:
        if not isinstance(doc.get(key), list):
            raise ValueError(f"{spec.logical_path} must contain list field {key!r}")
    return doc, path


def _check_declared_count(doc: dict[str, Any], count_key: str, rows_key: str, logical_path: str) -> None:
    if count_key not in doc:
        raise ValueError(f"{logical_path} must declare {count_key}")
    if doc[count_key] != len(doc[rows_key]):
        raise ValueError(
            f"{logical_path} declares {count_key}={doc[count_key]!r} but contains "
            f"{len(doc[rows_key])} rows"
        )


def _unique_ids(rows: list[dict[str, Any]], label: str) -> set[str]:
    ids = [row.get("id") for row in rows]
    if any(not isinstance(row_id, str) or not row_id for row_id in ids):
        raise ValueError(f"{label} contains a missing or non-string id")
    if len(ids) != len(set(ids)):
        raise ValueError(f"{label} contains duplicate ids")
    return set(ids)


def _valid_optional_accuracy(value: Any) -> bool:
    return value is None or (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and value >= 0
    )


def _validate_place_positions(nodes: list[dict[str, Any]]) -> None:
    allowed_methods = {
        "source_node": ("source_point", "not_reported_by_source"),
        "source_centroid": ("representative_point", "derived_representative_point"),
        "bounds_midpoint": ("representative_point", "derived_representative_point"),
        "geometry_mean": ("representative_point", "derived_representative_point"),
    }
    legacy_method_map = {
        "osm_node": "source_node",
        "osm_center": "source_centroid",
        "osm_bounds_midpoint": "bounds_midpoint",
        "osm_geometry_mean": "geometry_mean",
    }
    failures = []
    for node in nodes:
        position = node.get("position_source")
        elevation = node.get("elevation_source")
        legacy = node.get("coordinate_source")
        if (
            not isinstance(node.get("lat"), (int, float))
            or isinstance(node.get("lat"), bool)
            or not isinstance(node.get("lng"), (int, float))
            or isinstance(node.get("lng"), bool)
            or not isinstance(node.get("elevation_m"), (int, float))
            or isinstance(node.get("elevation_m"), bool)
            or not isinstance(position, dict)
            or not isinstance(elevation, dict)
            or not isinstance(legacy, dict)
        ):
            failures.append(node.get("id", "<missing-id>"))
            continue

        method = position.get("method")
        expected_role_status = allowed_methods.get(method)
        if (
            not position.get("provider")
            or not position.get("element")
            or not position.get("snapshot")
            or not expected_role_status
            or position.get("position_type") != expected_role_status[0]
            or position.get("accuracy_status") != expected_role_status[1]
            or "horizontal_accuracy_m" not in position
            or not _valid_optional_accuracy(position.get("horizontal_accuracy_m"))
            or legacy.get("provider") != position.get("provider")
            or legacy.get("element") != position.get("element")
            or legacy_method_map.get(node.get("coordinate_method")) != method
            or not node.get("coordinate_confidence")
            or not elevation.get("provider")
            or not elevation.get("dataset")
            or not isinstance(elevation.get("resolution_m"), (int, float))
            or "vertical_accuracy_m" not in elevation
            or not _valid_optional_accuracy(elevation.get("vertical_accuracy_m"))
            or not elevation.get("accuracy_status")
            or (
                node.get("height_m") is None
                and (
                    node.get("height_status") != "unknown_no_measurement_source"
                    or node.get("height_source") is not None
                )
            )
            or (
                node.get("height_m") is not None
                and (
                    not isinstance(node.get("height_m"), (int, float))
                    or isinstance(node.get("height_m"), bool)
                    or not isinstance(node.get("height_source"), dict)
                )
            )
        ):
            failures.append(node.get("id", "<missing-id>"))
    if failures:
        raise ValueError(
            f"place nodes lack normalized position/elevation provenance: {failures[:10]}"
        )


def _validate_visitor_pois(doc: dict[str, Any]) -> None:
    pois = doc["pois"]
    allowed_families = {
        "access",
        "toilet",
        "drinking_water",
        "viewpoint",
        "shelter",
        "transit",
        "artwork",
    }
    family_counts = {family: 0 for family in allowed_families}
    failures = []
    for poi in pois:
        row_id = poi.get("id", "<missing-id>")
        family = poi.get("family")
        element = poi.get("osm_element")
        position = poi.get("position_source")
        elevation = poi.get("elevation_source")
        scope = poi.get("scope")
        if family in family_counts:
            family_counts[family] += 1
        else:
            failures.append(row_id)
            continue
        if not isinstance(element, dict) or not isinstance(position, dict) or not isinstance(elevation, dict) or not isinstance(scope, dict):
            failures.append(row_id)
            continue
        element_type = element.get("type")
        expected_id = f"visitor-poi-osm-{element_type}-{element.get('id')}"
        expected_method = "source_node" if element_type == "node" else "bounds_midpoint"
        expected_position_type = "source_point" if element_type == "node" else "representative_point"
        expected_accuracy_status = "not_reported_by_source" if element_type == "node" else "derived_representative_point"
        if (
            poi.get("kind") != "visitor_poi"
            or row_id != expected_id
            or element_type not in {"node", "way"}
            or not element.get("id")
            or not element.get("version")
            or not element.get("timestamp")
            or not isinstance(poi.get("lat"), (int, float))
            or isinstance(poi.get("lat"), bool)
            or not isinstance(poi.get("lng"), (int, float))
            or isinstance(poi.get("lng"), bool)
            or not isinstance(poi.get("elevation_m"), (int, float))
            or isinstance(poi.get("elevation_m"), bool)
            or position.get("provider") != "OpenStreetMap"
            or position.get("element") != f"{element_type}/{element.get('id')}"
            or not position.get("snapshot")
            or not position.get("snapshot_refs")
            or position.get("source_version") != element.get("version")
            or position.get("source_timestamp") != element.get("timestamp")
            or position.get("method") != expected_method
            or position.get("position_type") != expected_position_type
            or position.get("accuracy_status") != expected_accuracy_status
            or "horizontal_accuracy_m" not in position
            or not _valid_optional_accuracy(position.get("horizontal_accuracy_m"))
            or position.get("license") != "ODbL-1.0"
            or elevation.get("dataset") != "Copernicus DEM 2021 GLO-90"
            or elevation.get("resolution_m") != 90
            or "vertical_accuracy_m" not in elevation
            or not _valid_optional_accuracy(elevation.get("vertical_accuracy_m"))
            or elevation.get("accuracy_status") != "not_reported_in_project_source"
            or elevation.get("snapshot") != "data/sources/visitor-poi-elevation/points.json"
            or scope.get("relation") not in {"inside_park", "boundary_external", "external_relevant"}
            or poi.get("height_m") is not None
            or poi.get("height_status") != "unknown_no_measurement_source"
            or poi.get("height_source") is not None
            or not poi.get("source_refs")
        ):
            failures.append(row_id)
        if family == "access" and (
            element_type != "node"
            or position.get("position_type") != "source_point"
            or not ({"entrance", "barrier"} & set(poi.get("source_tags", {})))
        ):
            failures.append(row_id)
    if doc.get("poi_count") != len(pois) or doc.get("family_counts") != family_counts:
        failures.append("declared-counts")
    status = doc.get("status")
    if not isinstance(status, str) or not status or "pending" in status.lower():
        failures.append("status")
    coverage = doc.get("quality", {}).get("coverage_note", "").lower()
    if "absence" not in coverage or "not evidence" not in coverage:
        failures.append("coverage-note")
    if failures:
        raise ValueError(f"visitor POIs lack normalized source/spatial contract: {sorted(set(failures))[:10]}")


def validate_layer_compatibility(docs: dict[str, dict[str, Any]]) -> None:
    nodes = docs["nodes.json"]["nodes"]
    edges = docs["edges.json"]["edges"]
    trees = docs["trees.json"]["trees"]
    benches = docs["benches.json"]["benches"]
    path_nodes = docs["path_topology.json"]["path_nodes"]
    path_segments = docs["path_topology.json"]["directed_segments"]
    visitor_pois = docs["visitor_pois.json"]["pois"]
    figures = docs["figures.json"]["figures"]
    semantic = docs["semantic.json"]
    artworks = semantic["artworks"]
    collections = semantic["collections"]
    semantic_edges = semantic["semantic_edges"]

    _validate_place_positions(nodes)
    _validate_visitor_pois(docs["visitor_pois.json"])

    spatial_failures: list[str] = []
    for label, rows in (
        ("place", nodes),
        ("tree", trees),
        ("bench", benches),
        ("path_node", path_nodes),
        ("visitor_poi", visitor_pois),
    ):
        for row in rows:
            spatial_failures.extend(
                validate_spatial_entity(row, label=f"{label}:{row.get('id', '<missing-id>')}")
            )
    if spatial_failures:
        raise ValueError(f"common spatial provenance contract failed: {spatial_failures[:10]}")

    edge_metric_failures = validate_metric_profile(
        docs["edges.json"].get("derived_metric_profile"),
        label="data/edges.json",
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
    path_metric_failures = validate_metric_profile(
        docs["path_topology.json"].get("derived_metric_profile"),
        label="data/path_topology.json",
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
    for label, profile in (
        ("data/edges.json.derived_metric_profile", docs["edges.json"].get("derived_metric_profile")),
        ("data/path_topology.json.derived_metric_profile", docs["path_topology.json"].get("derived_metric_profile")),
    ):
        terrain = profile.get("terrain_source") if isinstance(profile, dict) else None
        path_metric_failures.extend(validate_elevation_source(terrain, label=f"{label}.terrain_source"))
    metric_failures = edge_metric_failures + path_metric_failures
    if metric_failures:
        raise ValueError(f"derived metric provenance contract failed: {metric_failures[:10]}")

    if any(edge.get("elevation_metric_sampling_m") != 90 for edge in edges):
        raise ValueError("walking edges must preserve ~90 m GLO-90 gross ascent/descent sampling")
    path_terrain_failures = []
    for segment in path_segments:
        if segment.get("distance_m", 0) < 90:
            if segment.get("terrain_metric_status") != "below_dem_horizontal_resolution" or any(
                segment.get(key) is not None for key in ("ascent_m", "descent_m", "avg_grade_pct")
            ):
                path_terrain_failures.append(segment.get("id", "<missing-id>"))
        elif segment.get("terrain_metric_status") != "coarse_glo90_endpoint_estimate":
            path_terrain_failures.append(segment.get("id", "<missing-id>"))
    if path_terrain_failures:
        raise ValueError(f"path terrain metrics overstate DEM precision: {path_terrain_failures[:10]}")

    _check_declared_count(docs["trees.json"], "tree_count", "trees", "data/trees.json")
    _check_declared_count(docs["benches.json"], "bench_count", "benches", "data/benches.json")
    _check_declared_count(
        docs["path_topology.json"], "path_node_count", "path_nodes", "data/path_topology.json"
    )
    _check_declared_count(
        docs["path_topology.json"],
        "directed_segment_count",
        "directed_segments",
        "data/path_topology.json",
    )

    for filename in ("trees.json", "benches.json", "path_topology.json"):
        status = docs[filename].get("status")
        if not isinstance(status, str) or not status or "pending" in status.lower():
            raise ValueError(f"data/{filename} has no qualified non-pending status")

    node_ids = _unique_ids(nodes, "place nodes")
    walk_edge_ids = _unique_ids(edges, "walking edges")
    tree_ids = _unique_ids(trees, "trees")
    bench_ids = _unique_ids(benches, "benches")
    path_node_ids = _unique_ids(path_nodes, "path nodes")
    visitor_poi_ids = _unique_ids(visitor_pois, "visitor POIs")
    figure_ids = _unique_ids(figures, "figures")
    artwork_ids = _unique_ids(artworks, "artworks")
    collection_ids = _unique_ids(collections, "collections")
    semantic_edge_ids = _unique_ids(semantic_edges, "semantic edges")
    path_segment_ids = _unique_ids(path_segments, "path segments")

    entity_groups = [
        node_ids,
        tree_ids,
        bench_ids,
        path_node_ids,
        visitor_poi_ids,
        figure_ids,
        artwork_ids,
        collection_ids,
    ]
    all_entity_ids: set[str] = set()
    for group in entity_groups:
        overlap = all_entity_ids & group
        if overlap:
            raise ValueError(f"duplicate entity ids across layers: {sorted(overlap)[:10]}")
        all_entity_ids |= group

    bad_walk_refs = sorted(
        {
            endpoint
            for edge in edges
            for endpoint in (edge.get("from"), edge.get("to"))
            if endpoint not in node_ids
        }
    )
    if bad_walk_refs:
        raise ValueError(f"walking edges reference unknown place ids: {bad_walk_refs[:10]}")

    bad_semantic_refs = sorted(
        {
            endpoint
            for edge in semantic_edges
            for endpoint in (edge.get("from"), edge.get("to"))
            if endpoint not in all_entity_ids
        }
    )
    if bad_semantic_refs:
        raise ValueError(f"semantic edges reference unknown entity ids: {bad_semantic_refs[:10]}")

    semantic_sources = semantic["sources"]
    source_ids = _unique_ids(semantic_sources, "semantic sources")
    bad_sources = [
        source.get("id", "<missing-id>")
        for source in semantic_sources
        if not source.get("publisher") or not source.get("url")
    ]
    if bad_sources:
        raise ValueError(f"semantic sources lack publisher/url provenance: {bad_sources[:10]}")
    for label, rows in (("figures", figures), ("artworks", artworks), ("collections", collections)):
        bad_entity_sources = [
            row["id"]
            for row in rows
            if not row.get("source_ids") or any(ref not in source_ids for ref in row["source_ids"])
        ]
        if bad_entity_sources:
            raise ValueError(f"{label} reference unresolved semantic sources: {bad_entity_sources[:10]}")
    bad_semantic_provenance = []
    for edge in semantic_edges:
        provenance = edge.get("provenance", {})
        if (
            not edge.get("relation")
            or edge.get("confidence") not in {"high", "medium", "low"}
            or not edge.get("source_ids")
            or any(ref not in source_ids for ref in edge["source_ids"])
            or not provenance.get("basis")
            or not provenance.get("assertion")
            or not provenance.get("qualification")
        ):
            bad_semantic_provenance.append(edge["id"])
    if bad_semantic_provenance:
        raise ValueError(
            f"semantic edges lack source/confidence/provenance: {bad_semantic_provenance[:10]}"
        )

    bad_path_refs = sorted(
        {
            endpoint
            for segment in path_segments
            for endpoint in (segment.get("from"), segment.get("to"))
            if endpoint not in path_node_ids
        }
    )
    if bad_path_refs:
        raise ValueError(f"path segments reference unknown path-node ids: {bad_path_refs[:10]}")

    referenced_segment_ids = {
        segment_id
        for node in path_nodes
        for key in ("next_segment_ids", "previous_segment_ids")
        for segment_id in node.get(key, [])
    }
    unknown_segment_ids = sorted(referenced_segment_ids - path_segment_ids)
    if unknown_segment_ids:
        raise ValueError(f"path nodes reference unknown segment ids: {unknown_segment_ids[:10]}")

    edge_id_overlap = (
        (walk_edge_ids & path_segment_ids)
        | (walk_edge_ids & semantic_edge_ids)
        | (path_segment_ids & semantic_edge_ids)
    )
    if edge_id_overlap:
        raise ValueError(f"duplicate edge/segment ids across layers: {sorted(edge_id_overlap)[:10]}")

    for label, rows in (("trees", trees), ("benches", benches), ("path nodes", path_nodes), ("visitor POIs", visitor_pois)):
        missing_position = [
            row["id"]
            for row in rows
            if not isinstance(row.get("lat"), (int, float))
            or not isinstance(row.get("lng"), (int, float))
            or not isinstance(row.get("elevation_m"), (int, float))
            or not isinstance(row.get("position_source"), dict)
            or not isinstance(row.get("elevation_source"), dict)
        ]
        if missing_position:
            raise ValueError(f"{label} lack spatial provenance: {missing_position[:10]}")

    for label, rows in (("trees", trees), ("benches", benches)):
        missing_refs = [row["id"] for row in rows if not row.get("source_refs")]
        if missing_refs:
            raise ValueError(f"{label} lack source_refs provenance: {missing_refs[:10]}")

    bad_segment_provenance = []
    for segment in path_segments:
        source_kind = segment.get("source_kind")
        if not source_kind:
            bad_segment_provenance.append(segment["id"])
        elif source_kind == "representative_point_snap_connector":
            if (
                segment.get("accessibility_status") != "unknown_unmapped_connector"
                or any(segment.get(key) is not None for key in ("surface", "steps", "access"))
            ):
                bad_segment_provenance.append(segment["id"])
        elif not segment.get("osm_way_ids"):
            bad_segment_provenance.append(segment["id"])
    if bad_segment_provenance:
        raise ValueError(f"path segments lack source provenance: {bad_segment_provenance[:10]}")


def composition_input_records(data_dir: pathlib.Path) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]]]:
    docs: dict[str, dict[str, Any]] = {}
    records: list[dict[str, Any]] = []
    for spec in LAYER_SPECS:
        doc, path = load_layer(data_dir, spec)
        docs[spec.filename] = doc
        records.append(
            {
                "path": spec.logical_path,
                "schema_version": spec.schema_version,
                "sha256": sha256_file(path),
                "size_bytes": path.stat().st_size,
            }
        )
    validate_layer_compatibility(docs)
    return docs, records


def input_set_sha256(records: list[dict[str, Any]]) -> str:
    canonical = json.dumps(records, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def assert_graph_inputs_current(graph: dict[str, Any], data_dir: pathlib.Path) -> list[dict[str, Any]]:
    _, current_records = composition_input_records(data_dir)
    composition = graph.get("composition")
    if not isinstance(composition, dict):
        raise ValueError("graph.json has no composition metadata")
    if composition.get("schema_version") != COMPOSITION_SCHEMA_VERSION:
        raise ValueError("graph.json composition schema is incompatible")
    recorded = composition.get("inputs")
    if recorded != current_records:
        raise ValueError("graph.json is stale: composition input hashes do not match current layers")
    expected_set_hash = input_set_sha256(current_records)
    if composition.get("input_set_sha256") != expected_set_hash:
        raise ValueError("graph.json composition input-set hash is invalid")
    return current_records


def _deterministic_generated_at(docs: dict[str, dict[str, Any]]) -> str | None:
    timestamps = [doc.get("generated_at") for doc in docs.values() if isinstance(doc.get("generated_at"), str)]
    return max(timestamps) if timestamps else None


def compose_graph(data_dir: pathlib.Path | None = None) -> dict[str, Any]:
    data_dir = (data_dir or CANONICAL_DATA).resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    docs, records = composition_input_records(data_dir)

    nodes_doc = docs["nodes.json"]
    semantic_doc = docs["semantic.json"]
    topology_doc = docs["path_topology.json"]
    generated_at = _deterministic_generated_at(docs)

    graph = {
        "schema_version": GRAPH_SCHEMA_VERSION,
        "generated_at": generated_at,
        "bbox": nodes_doc.get("bbox"),
        "nodes": nodes_doc["nodes"],
        "edges": docs["edges.json"]["edges"],
        "trees": docs["trees.json"]["trees"],
        "benches": docs["benches.json"]["benches"],
        "path_nodes": topology_doc["path_nodes"],
        "path_segments": topology_doc["directed_segments"],
        "visitor_pois": docs["visitor_pois.json"]["pois"],
        "figures": docs["figures.json"]["figures"],
        "artworks": semantic_doc["artworks"],
        "collections": semantic_doc["collections"],
        "semantic_edges": semantic_doc["semantic_edges"],
        "composition": {
            "schema_version": COMPOSITION_SCHEMA_VERSION,
            "builder": "scripts/compose_graph.py",
            "generated_at_policy": "latest_generated_at_from_hashed_inputs",
            "input_set_sha256": input_set_sha256(records),
            "inputs": records,
        },
        "provenance": {
            "coordinate_primary": "OpenStreetMap",
            "path_primary": "OpenStreetMap",
            "elevation_primary": "Open-Meteo / Copernicus DEM GLO-90",
            "semantic_source_registry": "data/semantic.json#sources",
            "semantic_evidence_guardrails": semantic_doc.get(
                "evidence_guardrails", "data/semantic_source_manifest.json"
            ),
            "semantic_source_ids": [source.get("id") for source in semantic_doc["sources"]],
            "bench_layer": "data/benches.json",
            "path_topology_layer": "data/path_topology.json",
            "path_topology_scope": topology_doc.get("status"),
            "visitor_poi_layer": "data/visitor_pois.json",
            "visitor_poi_scope": docs["visitor_pois.json"].get("status"),
            "osm_license": "ODbL-1.0",
            "source_snapshots": [
                "data/sources/osm-pois.json",
                "data/sources/osm-map/sw.xml",
                "data/sources/osm-map/nw.xml",
                "data/sources/osm-map/se.xml",
                "data/sources/osm-map/ne.xml",
                "data/sources/elevation/points.json",
                "data/sources/path-topology-elevation/points.json",
                "data/sources/visitor-poi-elevation/points.json",
                "data/sources/commons-geotag-audit.json",
            ],
        },
    }

    output = data_dir / "graph.json"
    output.write_text(json.dumps(graph, ensure_ascii=False, indent=2) + "\n")
    return graph


def main() -> None:
    data_dir = pathlib.Path(
        os.environ.get("BERGPARK_OUTPUT_DATA", str(CANONICAL_DATA))
    ).resolve()
    graph = compose_graph(data_dir)
    summary = {
        "places": len(graph["nodes"]),
        "walking_edges": len(graph["edges"]),
        "trees": len(graph["trees"]),
        "benches": len(graph["benches"]),
        "path_nodes": len(graph["path_nodes"]),
        "path_segments": len(graph["path_segments"]),
        "visitor_pois": len(graph["visitor_pois"]),
        "visitor_poi_families": {
            family: sum(poi.get("family") == family for poi in graph["visitor_pois"])
            for family in sorted({poi.get("family") for poi in graph["visitor_pois"]})
        },
        "figures": len(graph["figures"]),
        "artworks": len(graph["artworks"]),
        "collections": len(graph["collections"]),
        "semantic_edges": len(graph["semantic_edges"]),
        "input_set_sha256": graph["composition"]["input_set_sha256"],
    }
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
