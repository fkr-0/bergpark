from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'anchor missing in {path}: {old[:160]!r}')
    p.write_text(text.replace(old, new, 1))


def replace_between(path, start, end, replacement):
    p = Path(path)
    text = p.read_text()
    left = text.find(start)
    if left < 0:
        raise SystemExit(f'start anchor missing in {path}: {start!r}')
    right = text.find(end, left + len(start))
    if right < 0:
        raise SystemExit(f'end anchor missing in {path}: {end!r}')
    p.write_text(text[:left] + replacement + text[right:])


# Bilingual navigation/action/maneuver copy.
replace_once(
    'src/i18n.js',
    "    setPositionDone: 'Simulierte Position gesetzt.',\n",
    "    setPositionDone: 'Simulierte Position gesetzt — ziehe den Marker, um den Weg interaktiv abzulaufen.',\n",
)
replace_once(
    'src/i18n.js',
    "    expandHeader: 'Kopfbereich ausklappen',\n",
    "    expandHeader: 'Kopfbereich ausklappen',\n"
    "    startNavigation: 'Navigation starten',\n"
    "    endNavigation: 'Navigation beenden',\n"
    "    navigationWaiting: 'Standort wird gesucht …',\n"
    "    startNavigationHint: 'Starte die Navigation, um Standort und Live-Hinweise gemeinsam zu aktivieren.',\n"
    "    cameraFollowPause: 'Kartenfolge pausieren',\n"
    "    cameraFollowResume: 'Position wieder folgen',\n"
    "    cameraFollowPaused: 'Kartenfolge pausiert',\n"
    "    maneuverContinue: 'Geradeaus weiter',\n"
    "    maneuverBearLeft: 'Links halten',\n"
    "    maneuverBearRight: 'Rechts halten',\n"
    "    maneuverTurnLeft: 'Links abbiegen',\n"
    "    maneuverTurnRight: 'Rechts abbiegen',\n"
    "    maneuverTakeSteps: 'Den Stufen folgen',\n"
    "    maneuverArrive: 'Ziel erreicht',\n"
    "    nextManeuver: (distance, instruction) => `In ${distance}: ${instruction}`,\n",
)
replace_once(
    'src/i18n.js',
    "    setPositionDone: 'Simulated position set.',\n",
    "    setPositionDone: 'Simulated position set — drag the marker to walk the route interactively.',\n",
)
replace_once(
    'src/i18n.js',
    "    expandHeader: 'Expand header',\n",
    "    expandHeader: 'Expand header',\n"
    "    startNavigation: 'Start navigation',\n"
    "    endNavigation: 'End navigation',\n"
    "    navigationWaiting: 'Finding your location …',\n"
    "    startNavigationHint: 'Start navigation to activate location and live guidance together.',\n"
    "    cameraFollowPause: 'Pause map following',\n"
    "    cameraFollowResume: 'Follow position again',\n"
    "    cameraFollowPaused: 'Map following paused',\n"
    "    maneuverContinue: 'Continue straight',\n"
    "    maneuverBearLeft: 'Keep left',\n"
    "    maneuverBearRight: 'Keep right',\n"
    "    maneuverTurnLeft: 'Turn left',\n"
    "    maneuverTurnRight: 'Turn right',\n"
    "    maneuverTakeSteps: 'Take the steps',\n"
    "    maneuverArrive: 'Destination reached',\n"
    "    nextManeuver: (distance, instruction) => `In ${distance}: ${instruction}`,\n",
)

# Main orchestration: one navigation action, route maneuvers, explicit camera-follow state.
replace_once(
    'src/main.js',
    "import { navigationSummary } from './guidance-surface.js';\n",
    "import { navigationSummary } from './guidance-surface.js';\n"
    "import { bearingDegrees, deriveDecisionManeuvers, nextDecisionManeuver } from './navigation-guidance.js';\n",
)
replace_once(
    'src/main.js',
    '''        <button id="locate" class="locate-button" type="button">\n          <span aria-hidden="true">◎</span><span data-i18n="locate"></span>\n        </button>\n        <button id="header-toggle" class="icon-button header-toggle" type="button" aria-expanded="true"><span aria-hidden="true">⌃</span></button>\n''',
    '''        <button id="locate" class="locate-button" type="button">\n          <span aria-hidden="true">◎</span><span data-i18n="locate"></span>\n        </button>\n        <button id="navigation-action" class="navigation-action" type="button" hidden></button>\n        <button id="camera-follow" class="icon-button camera-follow" type="button" aria-pressed="true" hidden><span aria-hidden="true">◎</span><span class="sr-only"></span></button>\n        <button id="header-toggle" class="icon-button header-toggle" type="button" aria-expanded="true"><span aria-hidden="true">⌃</span></button>\n''',
)
replace_once(
    'src/main.js',
    "  setPosition: document.querySelector('#set-position'),\n  map: document.querySelector('#map'),\n",
    "  setPosition: document.querySelector('#set-position'),\n"
    "  navigationAction: document.querySelector('#navigation-action'),\n"
    "  cameraFollow: document.querySelector('#camera-follow'),\n"
    "  map: document.querySelector('#map'),\n",
)
replace_once(
    'src/main.js',
    "let guideUserCollapsed = false;\n",
    "let guideUserCollapsed = false;\n"
    "let navigationActive = false;\n"
    "let navigationStartedGps = false;\n"
    "let navigationCameraFollowing = false;\n",
)

replace_between(
    'src/main.js',
    "function currentRouteForGuidance() {\n",
    "function acknowledgeGuideIntro() {\n",
    r'''function currentRouteForGuidance() {
  if (currentRoute?.kind === 'network') {
    return {
      coordinates: currentRoute.route.coordinates,
      distanceM: currentRoute.route.distanceM,
      walkingMin: currentRoute.route.walkingMin,
    };
  }
  if (currentRoute?.kind === 'direct') {
    const descriptor = currentRoute.edge?.id ? spatialWorld?.routesById?.get(currentRoute.edge.id) : null;
    return descriptor ? {
      coordinates: descriptor.coordinates,
      distanceM: currentRoute.edge.distance_m,
      walkingMin: currentRoute.edge.walking_min,
    } : null;
  }
  return null;
}

function maneuverInstruction(maneuver) {
  const keys = {
    continue: 'maneuverContinue',
    'bear-left': 'maneuverBearLeft',
    'bear-right': 'maneuverBearRight',
    'turn-left': 'maneuverTurnLeft',
    'turn-right': 'maneuverTurnRight',
    'take-steps': 'maneuverTakeSteps',
    arrive: 'maneuverArrive',
  };
  return i18n.t(keys[maneuver?.kind] ?? 'followRoute');
}

function currentNavigationSnapshot() {
  const route = currentRouteForGuidance();
  if (!route || !latestUserPosition) {
    return { route, summary: null, progressM: null, nextManeuver: null, routeBearing: null };
  }
  const summary = navigationSummary({
    position: latestUserPosition,
    coordinates: route.coordinates,
    routeDistanceM: route.distanceM,
    walkingMin: route.walkingMin,
  });
  if (!summary) return { route, summary: null, progressM: null, nextManeuver: null, routeBearing: null };
  const progressM = Number.isFinite(route.distanceM)
    ? route.distanceM * summary.progressFraction
    : summary.progressM;
  const maneuvers = currentRoute?.kind === 'network' && walkingNetworkDescriptor
    ? deriveDecisionManeuvers(currentRoute.route, walkingNetworkDescriptor)
    : [];
  const nextManeuver = nextDecisionManeuver(maneuvers, progressM);
  const routeBearing = bearingDegrees(
    route.coordinates?.[summary.segmentIndex],
    route.coordinates?.[summary.segmentIndex + 1],
  );
  return { route, summary, progressM, nextManeuver, routeBearing };
}

function renderNavigationControls(route, snapshot) {
  const hasRoute = Boolean(route);
  elements.locate.hidden = hasRoute;
  elements.navigationAction.hidden = !hasRoute;
  if (hasRoute) {
    elements.navigationAction.textContent = i18n.t(navigationActive ? 'endNavigation' : 'startNavigation');
    elements.navigationAction.setAttribute('aria-label', elements.navigationAction.textContent);
  }

  const canFollow = navigationActive && Boolean(snapshot?.summary);
  elements.cameraFollow.hidden = !canFollow;
  elements.cameraFollow.setAttribute('aria-pressed', String(canFollow && navigationCameraFollowing));
  elements.cameraFollow.classList.toggle('is-active', canFollow && navigationCameraFollowing);
  const followLabel = i18n.t(navigationCameraFollowing ? 'cameraFollowPause' : 'cameraFollowResume');
  elements.cameraFollow.setAttribute('aria-label', followLabel);
  elements.cameraFollow.title = followLabel;
  const hiddenLabel = elements.cameraFollow.querySelector('.sr-only');
  if (hiddenLabel) hiddenLabel.textContent = followLabel;

  elements.map.dataset.navigationState = hasRoute ? (navigationActive ? 'active' : 'preview') : 'idle';
  elements.map.dataset.navigationCamera = navigationActive
    ? (navigationCameraFollowing ? 'following' : 'free')
    : 'inactive';
  if (snapshot?.summary && Number.isFinite(snapshot.progressM)) {
    elements.map.dataset.navigationProgressM = snapshot.progressM.toFixed(1);
    elements.map.dataset.navigationOffRouteM = snapshot.summary.offRouteM.toFixed(1);
  } else {
    delete elements.map.dataset.navigationProgressM;
    delete elements.map.dataset.navigationOffRouteM;
  }
  const next = snapshot?.nextManeuver?.maneuver;
  if (next) elements.map.dataset.nextManeuver = next.kind;
  else delete elements.map.dataset.nextManeuver;
}

function renderGuidanceSurface() {
  if (!elements.topbar) return;
  const snapshot = currentNavigationSnapshot();
  const { route, summary, nextManeuver } = snapshot;
  const targetLabel = currentTargetLabel();
  let mode = guideIntroAcknowledged ? 'compact' : 'welcome';
  let kicker = i18n.t('heritage');
  let title = i18n.t('appTitle');
  let detail = '';

  if (route) {
    if (navigationActive && summary) {
      mode = 'navigation';
      kicker = i18n.t('navigation');
      const parts = [];
      if (summary.offRoute) {
        title = i18n.t('returnToRoute');
      } else if (nextManeuver) {
        const { maneuver, distanceToM } = nextManeuver;
        if (maneuver.kind === 'arrive' && distanceToM <= 20) {
          title = i18n.t('maneuverArrive');
        } else if (distanceToM <= 90) {
          title = maneuverInstruction(maneuver);
        } else {
          title = i18n.t('followRoute');
          parts.push(i18n.t('nextManeuver', formatGuidanceDistance(distanceToM), maneuverInstruction(maneuver)));
        }
      } else {
        title = i18n.t('followRoute');
      }
      if (targetLabel) parts.push(targetLabel);
      const remaining = formatGuidanceDistance(summary.remainingM);
      if (remaining) parts.push(`${i18n.t('remaining')} ${remaining}`);
      if (Number.isFinite(summary.remainingWalkingMin)) parts.push(`ca. ${Math.max(1, Math.ceil(summary.remainingWalkingMin))} ${i18n.t('minutes')}`);
      if (summary.offRoute) parts.push(`${formatGuidanceDistance(summary.offRouteM)} ${i18n.language === 'de' ? 'von der Route' : 'from route'}`);
      if (!navigationCameraFollowing) parts.push(i18n.t('cameraFollowPaused'));
      detail = parts.join(' · ');
    } else if (navigationActive) {
      mode = 'route';
      kicker = i18n.t('navigation');
      title = i18n.t('navigationWaiting');
      detail = targetLabel ?? i18n.t('locationForGuidance');
    } else {
      mode = 'route';
      kicker = i18n.t('route');
      title = targetLabel ?? i18n.t('route');
      const parts = [
        formatGuidanceDistance(route.distanceM),
        Number.isFinite(route.walkingMin) ? `${route.walkingMin} ${i18n.t('minutes')}` : null,
        i18n.t('startNavigationHint'),
      ].filter(Boolean);
      detail = parts.join(' · ');
    }
  } else if (targetLabel) {
    mode = 'target';
    kicker = i18n.t('destination');
    title = targetLabel;
  } else if (latestUserPosition) {
    mode = 'position';
    kicker = i18n.t(positionSource === 'simulated' ? 'positionSimulated' : 'positionGps');
    title = i18n.t(positionSource === 'simulated' ? 'positionSimulated' : 'positionGps');
    detail = i18n.t('mapHint');
  }

  elements.topbar.dataset.guideMode = mode;
  elements.topbar.classList.toggle('is-user-collapsed', guideUserCollapsed);
  elements.guideKicker.textContent = kicker;
  elements.guideTitle.textContent = title;
  elements.guideDetail.textContent = detail;
  elements.guideDetail.hidden = !detail;
  renderNavigationControls(route, snapshot);
  const visuallyCompact = mode === 'compact' || guideUserCollapsed;
  elements.shell?.style.setProperty('--guide-map-control-offset', visuallyCompact ? '68px' : '150px');
  elements.headerToggle.hidden = mode === 'compact';
  elements.headerToggle.setAttribute('aria-expanded', String(!visuallyCompact));
  elements.headerToggle.setAttribute('aria-label', i18n.t(visuallyCompact ? 'expandHeader' : 'collapseHeader'));
  elements.headerToggle.querySelector('[aria-hidden="true"]').textContent = visuallyCompact ? '⌄' : '⌃';
}

''',
)

replace_between(
    'src/main.js',
    "function applyUserPosition(position, source = 'gps') {\n",
    "function renderChrome() {\n",
    r'''function applyUserPosition(position, source = 'gps', { renderMap = true, expand = false, followCamera = true } = {}) {
  if (!Number.isFinite(position?.lat) || !Number.isFinite(position?.lng)) return false;
  const sourceChanged = positionSource !== source || !latestUserPosition;
  latestUserPosition = { ...position, simulated: source === 'simulated' };
  positionSource = source;
  elements.map.dataset.positionSource = source;
  if (renderMap) mapController?.setUserPosition(latestUserPosition);
  if (sourceChanged || expand) guideUserCollapsed = false;
  if (!guideIntroAcknowledged) rememberGuideIntro();
  renderGuidanceSurface();
  if (followCamera) followNavigationPosition();
  return true;
}

function clearUserPosition() {
  latestUserPosition = null;
  positionSource = null;
  delete elements.map.dataset.positionSource;
  mapController?.setUserPosition(null);
  renderGuidanceSurface();
}

function followNavigationPosition({ force = false } = {}) {
  if (!navigationActive || !latestUserPosition || (!navigationCameraFollowing && !force)) return false;
  const snapshot = currentNavigationSnapshot();
  if (!snapshot.summary) return false;
  const movingHeading = Number.isFinite(latestUserPosition.heading)
    && Number.isFinite(latestUserPosition.speed)
    && latestUserPosition.speed >= 0.8
    ? latestUserPosition.heading
    : null;
  const bearing = snapshot.summary.offRoute ? null : (movingHeading ?? snapshot.routeBearing);
  const followed = mapController?.followPosition(latestUserPosition, {
    minZoom: 17,
    bearing,
    duration: force ? 0.2 : 0.35,
  }) ?? false;
  if (followed) elements.map.dataset.navigationCamera = 'following';
  return followed;
}

function handleMapInteraction() {
  if (!navigationActive || !navigationCameraFollowing) return;
  navigationCameraFollowing = false;
  elements.map.dataset.navigationCamera = 'free';
  renderGuidanceSurface();
}

function handleSimulatedPositionChange(position, { final = false } = {}) {
  if (positionSource !== 'simulated') return;
  if (!applyUserPosition({ ...position, accuracy: 0 }, 'simulated', { renderMap: false, expand: false, followCamera: false })) return;
  if (final) mapController?.setUserPosition(latestUserPosition);
}

function handleMapPositionSelect(position) {
  acknowledgeGuideIntro();
  if (!manualPositionPickActive) return;
  setPositionPickActive(false);
  if (!applyUserPosition({ ...position, accuracy: 0 }, 'simulated', { expand: true })) return;
  if (!(navigationActive && navigationCameraFollowing)) {
    mapController?.focusPosition(position, { minZoom: 16, duration: 0.25 });
  }
  setStatus(i18n.t('setPositionDone'), true);
}

function startNavigation() {
  if (!currentRoute || navigationActive) return false;
  navigationActive = true;
  navigationCameraFollowing = true;
  navigationStartedGps = false;

  if (!(positionSource === 'simulated' && latestUserPosition)) {
    if (!gps?.active) {
      if (!gps?.start()) {
        navigationActive = false;
        navigationCameraFollowing = false;
        setStatus(i18n.t('gpsUnavailable'), true);
        renderGuidanceSurface();
        return false;
      }
      navigationStartedGps = true;
      elements.locate.classList.add('is-active');
      setStatus(i18n.t('gpsWatching'), true);
    }
  }

  guideUserCollapsed = false;
  acknowledgeGuideIntro();
  followNavigationPosition({ force: true });
  return true;
}

function endNavigation() {
  const stopOwnedGps = navigationStartedGps;
  navigationActive = false;
  navigationCameraFollowing = false;
  navigationStartedGps = false;
  if (stopOwnedGps && gps?.active) {
    gps.stop();
    elements.locate.classList.remove('is-active');
    if (positionSource === 'gps') clearUserPosition();
  }
  renderGuidanceSurface();
}

''',
)

# Existing route/selection transitions explicitly terminate an active navigation session.
replace_once(
    'src/main.js',
    "function showDetail(node, { focusClose = false } = {}) {\n  stopNarration();\n  currentRoute = null;\n",
    "function showDetail(node, { focusClose = false } = {}) {\n  stopNarration();\n  if (navigationActive && currentRoute) endNavigation();\n  currentRoute = null;\n",
)
replace_once(
    'src/main.js',
    "function selectTree(id, context = {}) {\n  const tree = graph?.trees.find((candidate) => candidate.id === id);\n  if (!tree) return;\n  currentNodeId = null;\n  currentRoute = null;\n",
    "function selectTree(id, context = {}) {\n  const tree = graph?.trees.find((candidate) => candidate.id === id);\n  if (!tree) return;\n  if (navigationActive && currentRoute) endNavigation();\n  currentNodeId = null;\n  currentRoute = null;\n",
)
replace_once(
    'src/main.js',
    "function selectVisitorFeature(feature, { historyMode = 'push' } = {}) {\n  if (!feature) return;\n",
    "function selectVisitorFeature(feature, { historyMode = 'push' } = {}) {\n  if (!feature) return;\n  if (navigationActive && currentRoute) endNavigation();\n",
)
replace_once(
    'src/main.js',
    "function showRoute(fromId, toId) {\n  const edge = edgeBetween(graph, fromId, toId);\n",
    "function showRoute(fromId, toId) {\n  if (navigationActive) endNavigation();\n  const edge = edgeBetween(graph, fromId, toId);\n",
)
replace_once(
    'src/main.js',
    "function showWalkingRoute(fromId, toId, profileId = 'shortest', { historyMode = 'push' } = {}) {\n  const source = graph?.nodesById.get(fromId);\n",
    "function showWalkingRoute(fromId, toId, profileId = 'shortest', { historyMode = 'push' } = {}) {\n  if (navigationActive) endNavigation();\n  const source = graph?.nodesById.get(fromId);\n",
)
replace_once(
    'src/main.js',
    "function closeRouteDetail() {\n  const source = currentRoute ? graph.nodesById.get(currentRoute.fromId) : null;\n  const routeKind = currentRoute?.kind;\n  currentRoute = null;\n",
    "function closeRouteDetail() {\n  const source = currentRoute ? graph.nodesById.get(currentRoute.fromId) : null;\n  const routeKind = currentRoute?.kind;\n  if (navigationActive) endNavigation();\n  currentRoute = null;\n",
)

# GPS no longer hijacks an active route by opening nearby-place detail.
replace_between(
    'src/main.js',
    "function setupGps() {\n",
    "function restoreDeepLink({ force = false } = {}) {\n",
    r'''function setupGps() {
  gps = createGpsNavigator({
    nodes: graph.nodes,
    radiusM: 30,
    onPosition(position) {
      applyUserPosition(position, 'gps');
    },
    onEnter(node) {
      if (navigationActive) {
        setStatus(i18n.t('nearPlace', localized(node.name, i18n.language, node.id)), true);
        return;
      }
      selectNode(node.id, { source: 'gps' });
    },
    onError() {
      setStatus(i18n.t('gpsUnavailable'), true);
      elements.locate.classList.remove('is-active');
      if (navigationActive && navigationStartedGps) {
        navigationActive = false;
        navigationStartedGps = false;
        navigationCameraFollowing = false;
        renderGuidanceSurface();
      }
    },
  });

  elements.locate.addEventListener('click', () => {
    if (currentRoute) {
      startNavigation();
      return;
    }
    if (gps.active) {
      gps.stop();
      elements.locate.classList.remove('is-active');
      clearUserPosition();
      setStatus(i18n.t('mapHint'));
      return;
    }
    setPositionPickActive(false);
    if (positionSource === 'simulated') clearUserPosition();
    if (!gps.start()) {
      setStatus(i18n.t('gpsUnavailable'), true);
      return;
    }
    navigationStartedGps = false;
    acknowledgeGuideIntro();
    elements.locate.classList.add('is-active');
    setStatus(i18n.t('gpsWatching'), true);
  });
}

''',
)

# Every renderer construction receives the same simulation and interaction seams.
p = Path('src/main.js')
s = p.read_text()
old = "        onMapPositionSelect: handleMapPositionSelect,\n        onLocationError: () => setStatus(i18n.t('gpsUnavailable'), true),\n"
new = "        onMapPositionSelect: handleMapPositionSelect,\n        onSimulatedPositionChange: handleSimulatedPositionChange,\n        onMapInteraction: handleMapInteraction,\n        onLocationError: () => setStatus(i18n.t('gpsUnavailable'), true),\n"
count = s.count(old)
if count != 2:
    raise SystemExit(f'expected 2 renderer-switch callback anchors, got {count}')
s = s.replace(old, new)
old_boot = "    onMapPositionSelect: handleMapPositionSelect,\n    onLocationError: () => setStatus(i18n.t('gpsUnavailable'), true),\n"
new_boot = "    onMapPositionSelect: handleMapPositionSelect,\n    onSimulatedPositionChange: handleSimulatedPositionChange,\n    onMapInteraction: handleMapInteraction,\n    onLocationError: () => setStatus(i18n.t('gpsUnavailable'), true),\n"
if old_boot not in s:
    raise SystemExit('boot renderer callback anchor missing')
s = s.replace(old_boot, new_boot, 1)
p.write_text(s)

# Restore an active follow session after renderer changes without fighting route fitBounds.
replace_once(
    'src/main.js',
    "    if (rendered) renderCurrentWalkingRoute();\n    return;\n",
    "    if (rendered) {\n      renderCurrentWalkingRoute();\n      if (navigationActive && navigationCameraFollowing && latestUserPosition) requestAnimationFrame(() => followNavigationPosition({ force: true }));\n    }\n    return;\n",
)
replace_once(
    'src/main.js',
    "    if (routeDescriptor && mapController.showRoute(routeDescriptor)) {\n      renderRouteDetail(elements.detail, {\n",
    "    if (routeDescriptor && mapController.showRoute(routeDescriptor)) {\n      if (navigationActive && navigationCameraFollowing && latestUserPosition) requestAnimationFrame(() => followNavigationPosition({ force: true }));\n      renderRouteDetail(elements.detail, {\n",
)

# Unified navigation and explicit camera-follow controls.
replace_once(
    'src/main.js',
    "elements.setPosition.addEventListener('click', () => {\n  acknowledgeGuideIntro();\n  if (gps?.active) {\n    gps.stop();\n    elements.locate.classList.remove('is-active');\n  }\n  const next = !manualPositionPickActive;\n  setPositionPickActive(next);\n  setStatus(next ? i18n.t('setPositionPrompt') : i18n.t('mapHint'), next);\n});\n",
    "elements.setPosition.addEventListener('click', () => {\n"
    "  acknowledgeGuideIntro();\n"
    "  if (gps?.active) {\n"
    "    gps.stop();\n"
    "    navigationStartedGps = false;\n"
    "    elements.locate.classList.remove('is-active');\n"
    "    if (positionSource === 'gps') clearUserPosition();\n"
    "  }\n"
    "  if (navigationActive) navigationCameraFollowing = false;\n"
    "  const next = !manualPositionPickActive;\n"
    "  setPositionPickActive(next);\n"
    "  setStatus(next ? i18n.t('setPositionPrompt') : i18n.t('mapHint'), next);\n"
    "  renderGuidanceSurface();\n"
    "});\n"
    "elements.navigationAction.addEventListener('click', () => {\n"
    "  if (navigationActive) endNavigation();\n"
    "  else startNavigation();\n"
    "});\n"
    "elements.cameraFollow.addEventListener('click', () => {\n"
    "  if (!navigationActive || !latestUserPosition) return;\n"
    "  navigationCameraFollowing = !navigationCameraFollowing;\n"
    "  if (navigationCameraFollowing) followNavigationPosition({ force: true });\n"
    "  renderGuidanceSurface();\n"
    "});\n",
)

# E2E: one route-start action, manual-pan suspension, explicit recenter, draggable simulation.
p = Path('tests/e2e/walking-routing.spec.js')
s = p.read_text()
if 'navigation start unifies location and camera follow' not in s:
    s += r'''

test('navigation start unifies location and camera follow while desktop simulation remains draggable', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await openGuide(page, '/#route=herkules&to=schloss&profile=shortest');
  await expect(page.locator('[data-walking-route-result]')).toBeVisible({ timeout: 10_000 });

  const map = page.locator('#map');
  const positionButton = page.locator('#set-position');
  await positionButton.click();
  await map.click({ position: { x: 760, y: 400 } });
  await expect(map).toHaveAttribute('data-position-source', 'simulated');
  await expect(page.locator('.simulated-position-marker')).toBeVisible();

  const navigationAction = page.locator('#navigation-action');
  await expect(navigationAction).toBeVisible();
  await expect(page.locator('#locate')).toBeHidden();
  await navigationAction.click();
  await expect(map).toHaveAttribute('data-navigation-state', 'active');
  await expect(page.locator('#guide-surface')).toHaveAttribute('data-guide-mode', 'navigation');

  const follow = page.locator('#camera-follow');
  await expect(follow).toBeVisible();
  await expect(follow).toHaveAttribute('aria-pressed', 'true');

  const mapBox = await map.boundingBox();
  if (!mapBox) throw new Error('map unavailable');
  await page.mouse.move(mapBox.x + 500, mapBox.y + 450);
  await page.mouse.down();
  await page.mouse.move(mapBox.x + 570, mapBox.y + 450, { steps: 8 });
  await page.mouse.up();
  await expect(follow).toHaveAttribute('aria-pressed', 'false');
  await expect(map).toHaveAttribute('data-navigation-camera', 'free');

  await follow.click();
  await expect(follow).toHaveAttribute('aria-pressed', 'true');
  await expect(map).toHaveAttribute('data-navigation-camera', 'following');

  const marker = page.locator('.simulated-position-marker').first();
  const beforeProgress = await map.getAttribute('data-navigation-progress-m');
  const markerBox = await marker.boundingBox();
  if (!markerBox) throw new Error('simulated marker unavailable');
  await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(markerBox.x + markerBox.width / 2 + 90, markerBox.y + markerBox.height / 2 + 20, { steps: 10 });
  await page.mouse.up();
  await expect(follow).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => map.getAttribute('data-navigation-progress-m')).not.toBe(beforeProgress);
});
'''
p.write_text(s)

# Record the successor contract alongside the first adaptive-header tranche.
p = Path('docs/ux/navigation-guidance-v2.md')
p.write_text(r'''# Navigation guidance v2

Status: implementation authority for the second adaptive-guidance tranche.

## Decision instructions

Maneuvers are derived from the published walking graph, not from arbitrary polyline bends. A route boundary becomes a directional instruction only when its path node is a real junction (`degree >= 3`). A degree-2 bend remains geometry and does not fabricate a turn. Entering a segment explicitly mapped with `steps=true` may independently produce a sourced steps instruction. Arrival is route-destination authority.

The current instruction vocabulary is deliberately bounded: continue, keep left/right, turn left/right, take the steps, arrive. Street/path names are not invented because the runtime projection does not yet carry a qualified naming contract.

## Navigation session

A route starts as a preview. The route surface exposes one `Start navigation` action. If a simulated desktop position already exists, it becomes the navigation position immediately. Otherwise that same action starts geolocation. The ordinary location control is hidden while a route is active so route-start and location are not competing concepts.

Ending navigation stops geolocation only when navigation itself started it. A location watch that pre-existed navigation remains visitor-owned.

## Camera follow

Navigation follows position by default. User pan/zoom/rotate/pitch is an explicit transfer of camera authority to the visitor and suspends follow indefinitely; there is no surprise timed snap-back. A visible follow/recenter control restores camera following explicitly. Programmatic route fitting and position updates do not count as user interaction.

MapLibre may align bearing with a trustworthy route segment (or a moving GPS heading); Leaflet follows position without pretending to rotate its north-up renderer.

## Desktop simulation

A simulated position is draggable in both renderer adapters. Dragging updates the shared application position continuously, so remaining distance, off-route state and next-decision guidance update while the marker moves. Dragging also suspends camera follow so the map never moves underneath the pointer. Drag end commits the renderer position state through the same shared position authority.
''')
