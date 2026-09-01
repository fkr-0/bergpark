#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re


def replace_once(path: Path, old: str, new: str) -> None:
    source = path.read_text()
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, found {count}: {old[:120]!r}')
    path.write_text(source.replace(old, new, 1))


def patch_sources() -> None:
    pipeline = Path('terrain/pipeline/maplibre_dem.py')
    replace_once(pipeline, 'The only supported pyramid is the fixed Bergpark z14-z16 AOI.', 'The only supported pyramid is the fixed Bergpark z13-z16 AOI.')
    replace_once(pipeline, 'ZOOMS = (14, 15, 16)', 'ZOOMS = (13, 14, 15, 16)')
    replace_once(pipeline, 'if counts != {14: 4, 15: 12, 16: 40}:', 'if counts != {13: 4, 14: 4, 15: 12, 16: 40}:')
    replace_once(pipeline, 'if not isinstance(tiles, list) or len(tiles) != 56:', 'if not isinstance(tiles, list) or len(tiles) != 60:')
    replace_once(pipeline, 'raise ValueError("bounded derivative must contain exactly 56 tiles")', 'raise ValueError("bounded derivative must contain exactly 60 tiles")')

    py_test = Path('tests/test_maplibre_dem.py')
    replace_once(py_test, 'def test_fixed_park_aoi_is_exactly_56_tiles_across_three_zooms(self):', 'def test_fixed_park_aoi_is_exactly_60_tiles_across_four_zooms(self):')
    replace_once(py_test, '{14: 4, 15: 12, 16: 40},', '{13: 4, 14: 4, 15: 12, 16: 40},')
    replace_once(py_test, 'maplibre_dem.tile_ranges(source["runtime_bounds_wgs84"], [13])', 'maplibre_dem.tile_ranges(source["runtime_bounds_wgs84"], [12])')
    replace_once(py_test, 'self.assertEqual(result["tile_count"], 56)', 'self.assertEqual(result["tile_count"], 60)')

    renderer = Path('src/maplibre-map.js')
    replace_once(
        renderer,
        "if (JSON.stringify(manifest.zooms) !== JSON.stringify([14, 15, 16])) throw new Error('terrain zoom pyramid is not the bounded z14-z16 authority');",
        "if (JSON.stringify(manifest.zooms) !== JSON.stringify([13, 14, 15, 16])) throw new Error('terrain zoom pyramid is not the bounded z13-z16 authority');",
    )
    replace_once(
        renderer,
        "if (manifest.tile_count !== 56 || manifest.tile_bytes > manifest.max_derivative_bytes) throw new Error('terrain derivative exceeds bounded tile/size contract');",
        "if (manifest.tile_count !== 60 || manifest.tile_bytes > manifest.max_derivative_bytes) throw new Error('terrain derivative exceeds bounded tile/size contract');",
    )
    replace_once(
        renderer,
        '  const [minzoom, , maxzoom] = manifest.zooms;\n',
        '  const minzoom = manifest.zooms[0];\n  const maxzoom = manifest.zooms.at(-1);\n',
    )

    js_test = Path('tests/maplibre-terrain.test.mjs')
    replace_once(js_test, '  assert.equal(dem.minzoom, 14);', '  assert.equal(dem.minzoom, 13);')

    readme = Path('terrain/README.md')
    replace_once(readme, 'emits only the canonical park\nAOI at Web-Mercator zooms **14, 15 and 16**:', 'emits only the canonical park\nAOI at Web-Mercator zooms **13, 14, 15 and 16**:')
    replace_once(
        readme,
        '- z14: 4 tiles\n- z15: 12 tiles\n- z16: 40 tiles\n- total: **56** 256×256 RGB Terrarium PNG tiles',
        '- z13: 4 tiles\n- z14: 4 tiles\n- z15: 12 tiles\n- z16: 40 tiles\n- total: **60** 256×256 RGB Terrarium PNG tiles',
    )
    marker = 'The renderer bounds remain the canonical runtime bbox `[9.385, 51.307, 9.425, 51.323]`.\n'
    replacement = (
        'MapLibre 6.6 terrain renders through 512 px internal terrain tiles while this authority uses 256 px DEM tiles; '
        'its terrain manager therefore requests the DEM at `terrain_zoom - 1`. The z13 parent level is required so the '
        'park overview can render real relief instead of a flat missing-parent mesh. It is generated from the same immutable '
        'Phase-3 Float32 authority and does not expand the renderer bounds.\n\n' + marker
    )
    replace_once(readme, marker, replacement)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def finalize_docs() -> None:
    manifest_path = Path('public/terrain/dgm1-terrarium/manifest.json')
    manifest = json.loads(manifest_path.read_text())
    if manifest.get('zooms') != [13, 14, 15, 16] or manifest.get('tile_count') != 60:
        raise SystemExit('rebuilt manifest does not contain the z13-z16 60-tile authority')
    tile_bytes = int(manifest['tile_bytes'])
    mib = tile_bytes / (1024 * 1024)
    manifest_hash = sha256(manifest_path)

    readme = Path('terrain/README.md')
    source = readme.read_text()
    source, count = re.subn(
        r'- tile bytes: \*\*[\d,]+ bytes\*\* \(about [\d.]+ MiB\)',
        f'- tile bytes: **{tile_bytes:,} bytes** (about {mib:.2f} MiB)',
        source,
        count=1,
    )
    if count != 1:
        raise SystemExit('terrain README tile-byte line was not uniquely replaceable')
    source, count = re.subn(
        r'- manifest SHA256: `[0-9a-f]{64}`',
        f'- manifest SHA256: `{manifest_hash}`',
        source,
        count=1,
    )
    if count != 1:
        raise SystemExit('terrain README manifest hash line was not uniquely replaceable')
    readme.write_text(source)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--finalize-docs', action='store_true')
    args = parser.parse_args()
    if args.finalize_docs:
        finalize_docs()
    else:
        patch_sources()


if __name__ == '__main__':
    main()
