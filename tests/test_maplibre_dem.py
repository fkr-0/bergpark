import importlib.util
import json
from pathlib import Path
import sys
import unittest

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
PIPELINE_DIR = ROOT / "terrain" / "pipeline"
sys.path.insert(0, str(PIPELINE_DIR))
SPEC = importlib.util.spec_from_file_location("maplibre_dem", PIPELINE_DIR / "maplibre_dem.py")
maplibre_dem = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(maplibre_dem)


class MapLibreTerrainDerivativeTests(unittest.TestCase):
    def test_phase3_authority_hashes_remain_immutable(self):
        self.assertEqual(
            maplibre_dem.sha256(ROOT / "terrain/sources/hessen-dgm1.yml"),
            maplibre_dem.EXPECTED_SOURCE_MANIFEST_SHA256,
        )
        self.assertEqual(
            maplibre_dem.sha256(ROOT / "terrain/artifacts/bergpark-dgm1.npz"),
            maplibre_dem.EXPECTED_ARTIFACT_SHA256,
        )
        self.assertEqual(
            maplibre_dem.sha256(ROOT / "terrain/artifacts/bergpark-dgm1.manifest.json"),
            maplibre_dem.EXPECTED_ARTIFACT_MANIFEST_SHA256,
        )

    def test_fixed_park_aoi_is_exactly_60_tiles_across_four_zooms(self):
        source = json.loads((ROOT / "terrain/sources/hessen-dgm1.yml").read_text())
        self.assertEqual(
            maplibre_dem.tile_count(source["runtime_bounds_wgs84"]),
            {13: 4, 14: 4, 15: 12, 16: 40},
        )
        with self.assertRaises(ValueError):
            maplibre_dem.tile_ranges(source["runtime_bounds_wgs84"], [12])
        with self.assertRaises(ValueError):
            maplibre_dem.tile_ranges(source["runtime_bounds_wgs84"], [17])

    def test_terrarium_units_are_metres_with_sub_centimetre_quantization(self):
        elevations = np.asarray([0.0, 214.56399536132812, 325.803, 527.017, 561.9030151367188], dtype=np.float32)
        encoded = maplibre_dem.terrarium_encode(elevations)
        decoded = maplibre_dem.terrarium_decode(encoded)
        error = np.abs(decoded - elevations.astype(np.float64))
        self.assertLessEqual(float(np.max(error)), maplibre_dem.TERRARIUM_QUANTIZATION_M / 2 + 1e-6)
        self.assertEqual(encoded.dtype, np.uint8)
        self.assertEqual(encoded.shape, (5, 3))

    def test_committed_derivative_is_bounded_and_provenance_linked(self):
        result = maplibre_dem.validate_derivative(
            source_manifest_path=ROOT / "terrain/sources/hessen-dgm1.yml",
            artifact_path=ROOT / "terrain/artifacts/bergpark-dgm1.npz",
            artifact_manifest_path=ROOT / "terrain/artifacts/bergpark-dgm1.manifest.json",
            output=ROOT / "public/terrain/dgm1-terrarium",
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["tile_count"], 60)
        self.assertLessEqual(result["tile_bytes"], maplibre_dem.MAX_DERIVATIVE_BYTES)

    def test_renderer_derivative_has_no_network_acquisition_path(self):
        source = (PIPELINE_DIR / "maplibre_dem.py").read_text()
        self.assertNotIn("urlopen(", source)
        self.assertNotIn("requests.get(", source)
        self.assertNotIn("GetCoverage", source)


if __name__ == "__main__":
    unittest.main()
