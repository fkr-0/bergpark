import math
from pathlib import Path
import unittest

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
TERRAIN_ROOT = ROOT / "public" / "terrain" / "dgm1-terrarium"
TILE_SIZE = 256
ZOOM = 16

# Canonical visitor-place coordinates from data/nodes.json. The operator-provided
# side-view evidence looks from the Neptunbecken end towards the Herkules end of
# the cascade axis. The upper end must therefore decode materially higher.
CONTROLS = {
    "neptunbecken": (51.3149902, 9.3984822),
    "kaskaden": (51.3159319, 9.3963653),
    "herkules": (51.3161018, 9.3932069),
}


def tile_fraction(lat_deg: float, lon_deg: float, zoom: int = ZOOM) -> tuple[float, float]:
    n = float(1 << zoom)
    lat = math.radians(max(-85.05112878, min(85.05112878, lat_deg)))
    x = (lon_deg + 180.0) / 360.0 * n
    y = (1.0 - math.asinh(math.tan(lat)) / math.pi) * 0.5 * n
    return x, y


def decode_terrarium(rgb: tuple[int, int, int]) -> float:
    red, green, blue = rgb
    return red * 256.0 + green + blue / 256.0 - 32768.0


def sample_nearest(lat: float, lon: float) -> float:
    x, y = tile_fraction(lat, lon)
    tile_x = math.floor(x)
    tile_y = math.floor(y)
    pixel_x = min(TILE_SIZE - 1, max(0, round((x - tile_x) * TILE_SIZE - 0.5)))
    pixel_y = min(TILE_SIZE - 1, max(0, round((y - tile_y) * TILE_SIZE - 0.5)))
    tile_path = TERRAIN_ROOT / str(ZOOM) / str(tile_x) / f"{tile_y}.png"
    with Image.open(tile_path) as image:
        return decode_terrarium(image.convert("RGB").getpixel((pixel_x, pixel_y)))


class CascadesTerrainContractTests(unittest.TestCase):
    def test_side_view_axis_rises_from_neptunbecken_to_herkules(self):
        elevations = {name: sample_nearest(*coordinate) for name, coordinate in CONTROLS.items()}
        rise = elevations["herkules"] - elevations["neptunbecken"]

        self.assertGreater(
            elevations["kaskaden"],
            elevations["neptunbecken"],
            msg=f"cascade direction inverted/flat in shipped DEM pixels: {elevations}",
        )
        self.assertGreater(
            elevations["herkules"],
            elevations["kaskaden"],
            msg=f"Herkules end is not uphill in shipped DEM pixels: {elevations}",
        )
        self.assertGreaterEqual(
            rise,
            40.0,
            msg=f"operator side-view should show a material climb; decoded controls={elevations}, rise={rise:.3f} m",
        )


if __name__ == "__main__":
    unittest.main()
