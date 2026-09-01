#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_one(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one replacement, found {count}: {old!r}")
    target.write_text(text.replace(old, new))


# The z13 DEM parent is valid for terrain render tiles at z14+. MapLibre 6.6
# internally uses 512 px terrain tiles for a 256 px raster-dem source and asks
# for source zoom = terrain zoom - 1. Keep the camera floor at z14 so it can
# never request an unavailable z12 parent.
replace_one(
    "terrain/pipeline/maplibre_dem.py",
    '            "min_zoom": 13.0,',
    '            "min_zoom": 14.0,',
)
replace_one(
    "terrain/pipeline/maplibre_dem.py",
    '    if manifest.get("zooms") != list(ZOOMS):\n        raise ValueError("renderer derivative zoom pyramid drifted")\n',
    '    if manifest.get("zooms") != list(ZOOMS):\n        raise ValueError("renderer derivative zoom pyramid drifted")\n'
    '    camera = manifest.get("camera", {})\n'
    '    if float(camera.get("min_zoom", -1)) < ZOOMS[0] + 1:\n'
    '        raise ValueError("terrain camera can request below MapLibre DEM parent level")\n',
)

manifest_path = ROOT / "public/terrain/dgm1-terrarium/manifest.json"
manifest = json.loads(manifest_path.read_text())
if manifest.get("zooms") != [13, 14, 15, 16] or manifest.get("tile_count") != 60:
    raise RuntimeError("unexpected committed terrain derivative contract")
manifest["camera"]["min_zoom"] = 14.0
manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=False) + "\n")
manifest_sha = hashlib.sha256(manifest_path.read_bytes()).hexdigest()

replace_one(
    "src/maplibre-map.js",
    "  if (!(camera.min_zoom >= 12 && camera.max_zoom <= 19 && camera.min_zoom < camera.max_zoom)) throw new Error('terrain camera zoom limits are unsafe');",
    "  if (!(camera.min_zoom >= manifest.zooms[0] + 1 && camera.max_zoom <= 19 && camera.min_zoom < camera.max_zoom)) throw new Error('terrain camera zoom limits cannot satisfy MapLibre DEM parent loading');",
)

replace_one(
    "tests/e2e/phase4-maplibre-terrain.spec.js",
    "  await expect(map).toHaveAttribute('data-terrain-tile-count', '56');\n  await expect(map).toHaveAttribute('data-terrain-zooms', '14,15,16');",
    "  await expect(map).toHaveAttribute('data-terrain-tile-count', '60');\n  await expect(map).toHaveAttribute('data-terrain-zooms', '13,14,15,16');",
)

replace_one(
    "tests/maplibre-terrain.test.mjs",
    "  assert.equal(dem.minzoom, 13);\n  assert.equal(dem.maxzoom, 16);",
    "  assert.equal(dem.minzoom, 13);\n  assert.equal(dem.maxzoom, 16);\n  assert.ok(terrain.camera.min_zoom >= dem.minzoom + 1);",
)

replace_one(
    "tests/test_maplibre_dem.py",
    '        self.assertEqual(result["tile_count"], 60)\n        self.assertLessEqual(result["tile_bytes"], maplibre_dem.MAX_DERIVATIVE_BYTES)',
    '        self.assertEqual(result["tile_count"], 60)\n'
    '        manifest = json.loads((ROOT / "public/terrain/dgm1-terrarium/manifest.json").read_text())\n'
    '        self.assertGreaterEqual(manifest["camera"]["min_zoom"], manifest["zooms"][0] + 1)\n'
    '        self.assertLessEqual(result["tile_bytes"], maplibre_dem.MAX_DERIVATIVE_BYTES)',
)

readme = ROOT / "terrain/README.md"
text = readme.read_text()
text, n = re.subn(r"- manifest SHA256: `[0-9a-f]{64}`", f"- manifest SHA256: `{manifest_sha}`", text, count=1)
if n != 1:
    raise RuntimeError("terrain/README.md: manifest hash line not found")
old_note = (
    "MapLibre 6.6 terrain renders through 512 px internal terrain tiles while this authority uses 256 px DEM tiles; "
    "its terrain manager therefore requests the DEM at `terrain_zoom - 1`. The z13 parent level is required so the "
    "park overview can render real relief instead of a flat missing-parent mesh. It is generated from the same immutable "
    "Phase-3 Float32 authority and does not expand the renderer bounds."
)
new_note = (
    "MapLibre 6.6 terrain renders through 512 px internal terrain tiles while this authority uses 256 px DEM tiles; "
    "its terrain manager therefore requests the DEM at `terrain_zoom - 1`. The z13 parent level supports terrain render "
    "tiles from z14 upward, so the runtime camera floor is z14 (initial z14.75). This keeps the overview on real relief "
    "without adding an unnecessary z12 derivative. The parent level is generated from the same immutable Phase-3 Float32 "
    "authority and does not expand the renderer bounds."
)
if old_note not in text:
    raise RuntimeError("terrain/README.md: MapLibre parent-level note not found")
readme.write_text(text.replace(old_note, new_note))

replace_one(
    "reimagined.md",
    "- deterministically derive only 56 Terrarium tiles at z14-z16 from the immutable Phase-3\n"
    "  intermediate (4,670,817 tile bytes; manifest SHA256\n"
    "  `2d48c4f1c14958304e6fe8c5ec3b6174b4687ba2e7f61b659f8f0fade3d38417`);",
    "- deterministically derive 60 Terrarium tiles at z13-z16 from the immutable Phase-3\n"
    f"  intermediate (4,817,250 tile bytes; manifest SHA256 `{manifest_sha}`); the z13 parent\n"
    "  supports MapLibre's one-level DEM parent lookup while the terrain camera is floored at z14;",
)

replace_one(
    "scripts/perf/browser-profile.mjs",
    r"/\\/terrain\\/dgm1-terrarium\\/(?:14|15|16)\\/[0-9]+\\/[0-9]+\\.png$/",
    r"/\\/terrain\\/dgm1-terrarium\\/(?:13|14|15|16)\\/[0-9]+\\/[0-9]+\\.png$/",
)

print(json.dumps({"ok": True, "manifest_sha256": manifest_sha}, indent=2))
