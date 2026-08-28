import importlib.util
import json
import math
from pathlib import Path
import tempfile
import unittest

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "terrain" / "pipeline" / "dgm1.py"
SPEC = importlib.util.spec_from_file_location("bergpark_dgm1", MODULE_PATH)
DGM1 = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(DGM1)


class Dgm1PipelineTests(unittest.TestCase):
    def test_runtime_aoi_is_bounded_and_stable(self):
        bounds = DGM1.native_bounds_from_graph(ROOT / "data" / "graph.json")
        self.assertEqual(bounds, DGM1.EXPECTED_BOUNDS)
        self.assertEqual((bounds[2] - bounds[0], bounds[3] - bounds[1]), DGM1.EXPECTED_SIZE)
        self.assertLess((bounds[2] - bounds[0]) * (bounds[3] - bounds[1]), 7_000_000)

    def test_unbounded_acquisition_margin_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "AOI margin"):
            DGM1.native_bounds_from_graph(ROOT / "data" / "graph.json", margin_m=100_000)

    def test_coordinate_round_trip_is_sub_cell(self):
        for lat, lon in ((51.3161018, 9.3932069), (51.3149835, 9.4159308), (51.3114009, 9.4087631)):
            e, n = DGM1.utm32_forward(lat, lon)
            lat2, lon2 = DGM1.utm32_inverse(e, n)
            error_m = math.hypot(
                (lat2 - lat) * 111320.0,
                (lon2 - lon) * 111320.0 * math.cos(math.radians(lat)),
            )
            self.assertLess(error_m, 0.02)

    def test_deterministic_npz_is_byte_stable_and_lossless(self):
        grid = np.array([[214.5, 215.25], [330.125, 561.875]], dtype=np.float32)
        with tempfile.TemporaryDirectory(dir=ROOT / ".work") as td:
            a = Path(td) / "a.npz"
            b = Path(td) / "b.npz"
            DGM1.write_deterministic_npz(a, grid)
            DGM1.write_deterministic_npz(b, grid)
            self.assertEqual(DGM1.sha256(a), DGM1.sha256(b))
            self.assertTrue(np.array_equal(grid, DGM1.load_intermediate(a)))

    def test_source_semantics_reject_nodata_mismatch(self):
        info = {
            "format": "TIFF",
            "mode": "F",
            "bits_per_sample": (32,),
            "sample_format": (3,),
            "pixel_scale": (1.0, 1.0, 0.0),
            "geo_key_directory": (1, 1, 0, 1, 3072, 0, 1, 25832),
            "nodata": -32768.0,
        }
        with self.assertRaisesRegex(ValueError, "NoData"):
            DGM1.assert_source_semantics(info)

    def test_manifest_is_canonical_json_yaml_subset(self):
        payload = {"vertical_reference": "DHHN2016_NH", "source_crs": "EPSG:25832", "schema_version": 1}
        encoded = DGM1.canonical_json(payload)
        self.assertEqual(json.loads(encoded), payload)
        self.assertTrue(encoded.endswith(b"\n"))


if __name__ == "__main__":
    unittest.main()
