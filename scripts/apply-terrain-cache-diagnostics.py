#!/usr/bin/env python3
from pathlib import Path

path = Path('src/maplibre-map.js')
text = path.read_text()
needle = "    element.dataset.spatialTerrainDebugCanvasHeight = String(canvas.clientHeight);\n"
insert = needle + """    const terrainSource = map.getSource(TERRAIN_SOURCE_ID);
    const terrainManager = map.style?.tileManagers?.[TERRAIN_SOURCE_ID];
    const tileSnapshot = (tile) => ({
      z: tile?.tileID?.canonical?.z,
      x: tile?.tileID?.canonical?.x,
      y: tile?.tileID?.canonical?.y,
      overscaledZ: tile?.tileID?.overscaledZ,
      state: tile?.state,
      dem: Boolean(tile?.dem),
      actor: Boolean(tile?.actor),
      aborted: Boolean(tile?.aborted),
    });
    const inViewTiles = terrainManager?._inViewTiles?.getAllTiles?.() ?? [];
    const outOfViewTiles = Object.values(terrainManager?._outOfViewCache?.data ?? {})
      .flatMap((entries) => entries.map(({ value }) => value));
    element.dataset.spatialTerrainDebugRawSourceLoaded = String(terrainSource?.loaded?.() ?? false);
    element.dataset.spatialTerrainDebugSourceMinZoom = String(terrainSource?.minzoom);
    element.dataset.spatialTerrainDebugSourceMaxZoom = String(terrainSource?.maxzoom);
    element.dataset.spatialTerrainDebugSourceTileSize = String(terrainSource?.tileSize);
    element.dataset.spatialTerrainDebugManagerSourceLoaded = String(terrainManager?._sourceLoaded);
    element.dataset.spatialTerrainDebugManagerSourceErrored = String(terrainManager?._sourceErrored);
    element.dataset.spatialTerrainDebugManagerUpdated = String(terrainManager?._updated);
    element.dataset.spatialTerrainDebugManagerUsed = String(terrainManager?.used);
    element.dataset.spatialTerrainDebugManagerUsedForTerrain = String(terrainManager?.usedForTerrain);
    element.dataset.spatialTerrainDebugManagerTileSize = String(terrainManager?.tileSize);
    element.dataset.spatialTerrainDebugInViewTiles = JSON.stringify(inViewTiles.map(tileSnapshot));
    element.dataset.spatialTerrainDebugOutOfViewTiles = JSON.stringify(outOfViewTiles.map(tileSnapshot));
"""
if text.count(needle) != 1:
    raise SystemExit(f'expected one diagnostic insertion point, got {text.count(needle)}')
path.write_text(text.replace(needle, insert))
