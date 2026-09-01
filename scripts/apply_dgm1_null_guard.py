from pathlib import Path

path = Path('src/maplibre-map.js')
source = path.read_text()
old = """  const lowerM = finite(lowerElevation);
  const upperM = finite(upperElevation);
"""
new = """  const lowerM = lowerElevation == null ? null : finite(lowerElevation);
  const upperM = upperElevation == null ? null : finite(upperElevation);
"""
if source.count(old) != 1:
    raise SystemExit(f'expected one terrainRiseSanity numeric-coercion block, found {source.count(old)}')
path.write_text(source.replace(old, new, 1))
