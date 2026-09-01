from pathlib import Path

path = Path('src/maplibre-map.js')
source = path.read_text()


def replace_once(old: str, new: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'expected exactly one match, found {count}: {old[:100]!r}')
    source = source.replace(old, new, 1)


replace_once(
    "const TERRAIN_PATH = 'terrain/dgm1-terrarium/';\n",
    """const TERRAIN_PATH = 'terrain/dgm1-terrarium/';
const TERRAIN_SOURCE_ID = 'terrain-dem';
const HILLSHADE_SOURCE_ID = 'terrain-hillshade-dem';

// Side-on cascades acceptance control derived from the user-visible regression
// evidence: Neptunbassin is the lower/eastern end; Herkules is upper/western.
export const CASCADES_TERRAIN_CONTROL = Object.freeze({
  lower: Object.freeze({ id: 'neptunbassin', lng: 9.397959, lat: 51.315852 }),
  upper: Object.freeze({ id: 'herkules', lng: 9.3932069, lat: 51.3161018 }),
  minRiseM: 60,
});
""",
)

replace_once(
    "function assetBaseUrl(baseUrl = null) {\n",
    """export function terrainRiseSanity(lowerElevation, upperElevation, minRiseM = CASCADES_TERRAIN_CONTROL.minRiseM) {
  const lowerM = finite(lowerElevation);
  const upperM = finite(upperElevation);
  const riseM = lowerM == null || upperM == null ? null : upperM - lowerM;
  return {
    ok: riseM != null && riseM >= minRiseM,
    lowerM,
    upperM,
    riseM,
    minRiseM,
  };
}

function assetBaseUrl(baseUrl = null) {
""",
)

replace_once(
    """      'terrain-dem': {
        type: 'raster-dem',
        tiles: [tileUrl],
        tileSize: manifest.tile_size,
        encoding: manifest.encoding,
        minzoom,
        maxzoom,
        bounds: manifest.renderer_bounds_wgs84,
        attribution: terrainAttribution(manifest),
      },
""",
    """      // Terrain mesh and hillshade intentionally use independent raster-dem
      // source caches backed by the same immutable local DGM1 bytes. This follows
      // MapLibre's 3D-terrain pattern and prevents mesh/hillshade cache crosstalk.
      [TERRAIN_SOURCE_ID]: {
        type: 'raster-dem',
        tiles: [tileUrl],
        tileSize: manifest.tile_size,
        encoding: manifest.encoding,
        minzoom,
        maxzoom,
        bounds: manifest.renderer_bounds_wgs84,
        attribution: terrainAttribution(manifest),
      },
      [HILLSHADE_SOURCE_ID]: {
        type: 'raster-dem',
        tiles: [tileUrl],
        tileSize: manifest.tile_size,
        encoding: manifest.encoding,
        minzoom,
        maxzoom,
        bounds: manifest.renderer_bounds_wgs84,
      },
""",
)

replace_once(
    "terrain: { source: 'terrain-dem', exaggeration: manifest.terrain_exaggeration },",
    "terrain: { source: TERRAIN_SOURCE_ID, exaggeration: manifest.terrain_exaggeration },",
)
replace_once(
    """        id: 'terrain-hillshade',
        type: 'hillshade',
        source: 'terrain-dem',
""",
    """        id: 'terrain-hillshade',
        type: 'hillshade',
        source: HILLSHADE_SOURCE_ID,
""",
)

replace_once(
    "  let terrainEnabled = true;\n  let destroyed = false;",
    "  let terrainEnabled = true;\n  let terrainVerified = false;\n  let destroyed = false;",
)

replace_once(
    "  map.addControl(new NavigationControl({ showCompass: true, showZoom: true, visualizePitch: true }), 'bottom-right');\n",
    """  map.addControl(new NavigationControl({ showCompass: true, showZoom: true, visualizePitch: true }), 'bottom-right');

  function activateTerrain() {
    if (!terrainEnabled || destroyed) return false;
    try {
      map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: manifest.terrain_exaggeration });
      terrainVerified = false;
      element.dataset.spatialTerrainReady = 'pending';
      element.dataset.spatialTerrainVerified = 'pending';
      return true;
    } catch {
      return false;
    }
  }

  function verifyTerrainRise() {
    if (!terrainEnabled || terrainVerified || destroyed || typeof map.queryTerrainElevation !== 'function') return false;
    const lower = map.queryTerrainElevation(
      [CASCADES_TERRAIN_CONTROL.lower.lng, CASCADES_TERRAIN_CONTROL.lower.lat],
      { exaggerated: false },
    );
    const upper = map.queryTerrainElevation(
      [CASCADES_TERRAIN_CONTROL.upper.lng, CASCADES_TERRAIN_CONTROL.upper.lat],
      { exaggerated: false },
    );
    const sanity = terrainRiseSanity(lower, upper);
    // A control tile may not be resident yet. Stay pending instead of producing a
    // false failure; source errors still go through the existing fail-closed path.
    if (sanity.lowerM == null || sanity.upperM == null) return false;

    element.dataset.spatialTerrainLowerM = sanity.lowerM.toFixed(3);
    element.dataset.spatialTerrainUpperM = sanity.upperM.toFixed(3);
    element.dataset.spatialTerrainRiseM = sanity.riseM.toFixed(3);
    if (!sanity.ok) {
      terrainEnabled = false;
      try { map.setTerrain(null); } catch { /* flat fallback remains usable */ }
      element.dataset.spatialTerrainState = 'flat-fallback';
      element.dataset.spatialTerrainReady = 'flat';
      element.dataset.spatialTerrainVerified = 'failed';
      element.dataset.spatialTerrainError = 'terrain-elevation-direction-invalid';
      heritageLayer?.setTerrainAvailable?.(false);
      disableHeritageLayer('terrain-unavailable', 'terrain-elevation-direction-invalid');
      return false;
    }

    terrainVerified = true;
    element.dataset.spatialTerrainReady = 'true';
    element.dataset.spatialTerrainVerified = 'cascades-rise';
    delete element.dataset.spatialTerrainError;
    if (typeof map.setCenterElevation === 'function') {
      const centerElevation = map.queryTerrainElevation(map.getCenter(), { exaggerated: false });
      if (Number.isFinite(centerElevation)) map.setCenterElevation(centerElevation);
    }
    return true;
  }
""",
)

replace_once(
    "  element.dataset.spatialTerrainState = 'terrain';\n",
    "  element.dataset.spatialTerrainState = 'terrain';\n  element.dataset.spatialTerrainReady = 'pending';\n  element.dataset.spatialTerrainVerified = 'pending';\n",
)

replace_once(
    """  map.on('webglcontextlost', () => {
    if (destroyed || heritageDisabled) return;
    heritageContextLost = true;
""",
    """  map.on('webglcontextlost', () => {
    if (destroyed || heritageDisabled) return;
    heritageContextLost = true;
    terrainVerified = false;
    element.dataset.spatialTerrainReady = 'pending';
    element.dataset.spatialTerrainVerified = 'pending';
""",
)
replace_once(
    """  map.on('webglcontextrestored', () => {
    if (destroyed || heritageDisabled) return;
    heritageContextLost = false;
""",
    """  map.on('webglcontextrestored', () => {
    if (destroyed || heritageDisabled) return;
    heritageContextLost = false;
    terrainVerified = false;
""",
)

replace_once(
    """  map.on('style.load', () => {
    syncSources();
    void ensureHeritageLayer();
  });
  map.on('load', () => {
    syncSources();
    void ensureHeritageLayer();
  });
  map.once('idle', () => {
    if (!destroyed) element.dataset.spatialTerrainReady = terrainEnabled ? 'true' : 'flat';
  });
""",
    """  map.on('style.load', () => {
    if (terrainEnabled) activateTerrain();
    syncSources();
    void ensureHeritageLayer();
  });
  map.on('load', () => {
    if (terrainEnabled) activateTerrain();
    syncSources();
    void ensureHeritageLayer();
  });
  map.on('idle', () => {
    if (!destroyed && terrainEnabled && !terrainVerified) verifyTerrainRise();
  });
""",
)

path.write_text(source)

Path('tests/terrain-relief-guard.test.mjs').write_text(r'''import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildTerrainStyle,
  CASCADES_TERRAIN_CONTROL,
  terrainRiseSanity,
} from '../src/maplibre-map.js';

const manifestUrl = new URL('../public/terrain/dgm1-terrarium/manifest.json', import.meta.url);

test('terrain mesh and hillshade have independent DEM source caches', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  const style = buildTerrainStyle(manifest, { baseUrl: 'https://example.test/' });
  const terrain = style.sources['terrain-dem'];
  const hillshade = style.sources['terrain-hillshade-dem'];
  assert.equal(style.terrain.source, 'terrain-dem');
  assert.equal(style.layers.find(({ id }) => id === 'terrain-hillshade').source, 'terrain-hillshade-dem');
  assert.notEqual(terrain, hillshade);
  assert.deepEqual(terrain.tiles, hillshade.tiles);
  assert.equal(terrain.encoding, 'terrarium');
  assert.equal(hillshade.encoding, 'terrarium');
});

test('side-view cascades control rejects flat or inverted terrain', () => {
  assert.deepEqual(CASCADES_TERRAIN_CONTROL.lower, { id: 'neptunbassin', lng: 9.397959, lat: 51.315852 });
  assert.deepEqual(CASCADES_TERRAIN_CONTROL.upper, { id: 'herkules', lng: 9.3932069, lat: 51.3161018 });
  assert.equal(CASCADES_TERRAIN_CONTROL.minRiseM, 60);
  assert.equal(terrainRiseSanity(405, 510).ok, true);
  assert.equal(terrainRiseSanity(405, 450).ok, false);
  assert.equal(terrainRiseSanity(510, 405).ok, false);
  assert.equal(terrainRiseSanity(null, 510).ok, false);
});
''')

Path('tests/e2e/terrain-relief-regression.spec.js').write_text(r'''import { expect, test } from '@playwright/test';
import { stubThirdPartyMapTiles } from './test-support.js';

test('DGM1 runtime mesh proves the side-view cascades rise before terrain is ready', async ({ page }) => {
  await stubThirdPartyMapTiles(page);
  await page.goto('/?renderer=terrain');
  const map = page.locator('#map');
  await expect(map).toHaveAttribute('data-spatial-renderer', 'terrain');
  await expect(map).toHaveAttribute('data-spatial-terrain-state', 'terrain');
  await expect(map).toHaveAttribute('data-spatial-terrain-ready', 'true', { timeout: 20_000 });
  await expect(map).toHaveAttribute('data-spatial-terrain-verified', 'cascades-rise');

  const measured = await map.evaluate((element) => ({
    lower: Number(element.dataset.spatialTerrainLowerM),
    upper: Number(element.dataset.spatialTerrainUpperM),
    rise: Number(element.dataset.spatialTerrainRiseM),
  }));
  expect(measured.lower).toBeGreaterThan(150);
  expect(measured.upper).toBeGreaterThan(measured.lower);
  expect(measured.rise).toBeGreaterThanOrEqual(60);
  expect(measured.rise).toBeCloseTo(measured.upper - measured.lower, 2);

  const localDemRequests = await page.evaluate(() => performance.getEntriesByType('resource')
    .filter(({ name }) => /\/terrain\/dgm1-terrarium\/(?:14|15|16)\/\d+\/\d+\.png$/.test(name)).length);
  expect(localDemRequests).toBeGreaterThan(0);
});
''')
