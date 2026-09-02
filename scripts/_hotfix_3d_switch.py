from pathlib import Path

p = Path('src/i18n.js')
s = p.read_text()
s = s.replace(
    "    loadError: 'Kartendaten konnten nicht geladen werden.',\n",
    "    loadError: 'Kartendaten konnten nicht geladen werden.',\n"
    "    terrainWebgl2Unavailable: '3D-Gelände ist in diesem Browser oder Grafikmodus nicht verfügbar (WebGL2 fehlt). Die 2D-Karte bleibt aktiv.',\n"
    "    terrainReducedPower: '3D-Gelände ist im aktuellen Datenspar-/Niedrigleistungsmodus deaktiviert. Die 2D-Karte bleibt aktiv.',\n"
    "    terrainUnavailable: '3D-Gelände konnte nicht gestartet werden. Die 2D-Karte bleibt aktiv.',\n",
    1,
)
s = s.replace(
    "    loadError: 'Map data could not be loaded.',\n",
    "    loadError: 'Map data could not be loaded.',\n"
    "    terrainWebgl2Unavailable: '3D terrain is unavailable in this browser or graphics mode because WebGL2 is unavailable. The 2D map remains active.',\n"
    "    terrainReducedPower: '3D terrain is disabled in the current data-saving/low-power mode. The 2D map remains active.',\n"
    "    terrainUnavailable: '3D terrain could not be started. The 2D map remains active.',\n",
    1,
)
p.write_text(s)

p = Path('src/main.js')
s = p.read_text()
old = """function setStatus(message, transient = false) {
  elements.status.textContent = message;
  if (transient) elements.status.dataset.transient = 'true';
  else delete elements.status.dataset.transient;
}

function spatialPreferenceUrl(preference) {
"""
new = """function setStatus(message, transient = false) {
  elements.status.textContent = message;
  if (transient) elements.status.dataset.transient = 'true';
  else delete elements.status.dataset.transient;
}

function spatialFallbackStatus(reason) {
  if (reason === 'webgl2-unavailable') return i18n.t('terrainWebgl2Unavailable');
  if (reason === 'reduced-power') return i18n.t('terrainReducedPower');
  return i18n.t('terrainUnavailable');
}

function reconcileSpatialFallback(preference) {
  if (preference !== 'terrain' || mapController?.renderer === 'terrain') return false;
  const reason = mapController?.fallbackReason ?? 'terrain-renderer-unavailable';
  syncSpatialPreference('auto');
  elements.rendererSwitch.dataset.fallbackReason = reason;
  setStatus(spatialFallbackStatus(reason), true);
  return true;
}

function spatialPreferenceUrl(preference) {
"""
if old not in s:
    raise SystemExit('main setStatus anchor missing')
s = s.replace(old, new, 1)

old = """  elements.rendererSwitch.dataset.renderer = terrain ? 'terrain' : 'leaflet';
  elements.rendererSwitch.textContent = terrain ? '2D' : '3D';
  elements.rendererSwitch.title = terrain
    ? (i18n.language === 'de' ? 'Zur normalen Karte wechseln' : 'Switch to the standard map')
    : (i18n.language === 'de' ? 'Geländemodus öffnen' : 'Open terrain mode');
}
"""
new = """  elements.rendererSwitch.dataset.renderer = terrain ? 'terrain' : 'leaflet';
  const fallbackReason = terrain ? null : mapController?.fallbackReason;
  if (fallbackReason) elements.rendererSwitch.dataset.fallbackReason = fallbackReason;
  else delete elements.rendererSwitch.dataset.fallbackReason;
  elements.rendererSwitch.textContent = terrain ? '2D' : '3D';
  elements.rendererSwitch.title = terrain
    ? (i18n.language === 'de' ? 'Zur normalen Karte wechseln' : 'Switch to the standard map')
    : fallbackReason
      ? spatialFallbackStatus(fallbackReason)
      : (i18n.language === 'de' ? 'Geländemodus öffnen' : 'Open terrain mode');
}
"""
if old not in s:
    raise SystemExit('renderer switch anchor missing')
s = s.replace(old, new, 1)

old = """      restoreSpatialPresentation();
      syncSpatialPreference(preference);
    } catch (error) {
"""
new = """      restoreSpatialPresentation();
      if (!reconcileSpatialFallback(preference)) syncSpatialPreference(preference);
    } catch (error) {
"""
if old not in s:
    raise SystemExit('switch success anchor missing')
s = s.replace(old, new, 1)

old = """  mapController.fitWorld();
  renderRendererSwitch();
  setStatus(i18n.t('mapHint'));
  restoreDeepLink({ force: true });
"""
new = """  mapController.fitWorld();
  renderRendererSwitch();
  if (!reconcileSpatialFallback(mapController.requestedRenderer)) setStatus(i18n.t('mapHint'));
  restoreDeepLink({ force: true });
"""
if old not in s:
    raise SystemExit('boot anchor missing')
s = s.replace(old, new, 1)
p.write_text(s)

p = Path('tests/e2e/spatial-product-integration.spec.js')
s = p.read_text()
append = r'''

test('unavailable WebGL2 makes an explicit 3D request visible and restores canonical 2D state', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(kind, ...args) {
      if (kind === 'webgl2') return null;
      return original.call(this, kind, ...args);
    };
  });
  await stubThirdPartyMapTiles(page);
  await page.goto('/#place=herkules');
  const map = page.locator('#map');
  const switchButton = page.locator('#renderer-switch');
  await expect(map).toHaveAttribute('data-spatial-renderer', 'leaflet');
  await switchButton.click();
  await expect(map).toHaveAttribute('data-spatial-renderer', 'leaflet');
  await expect(map).toHaveAttribute('data-spatial-fallback-reason', 'webgl2-unavailable');
  await expect(switchButton).toHaveAttribute('data-fallback-reason', 'webgl2-unavailable');
  await expect(switchButton).toBeEnabled();
  await expect(page.locator('#map-status')).toContainText(/WebGL2|3D terrain|3D-Gelände/);
  await expect(page).toHaveURL(/#place=herkules$/);
  await expect(page).not.toHaveURL(/renderer=terrain/);
  await context.close();
});
'''
if "unavailable WebGL2 makes an explicit 3D request visible" not in s:
    s += append
p.write_text(s)
