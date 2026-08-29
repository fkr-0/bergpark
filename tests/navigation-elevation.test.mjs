import test from 'node:test';
import assert from 'node:assert/strict';

import {
  elevationProfilePolyline,
  loadRouteElevationProfile,
  routeElevationSource,
  routeElevationSummary,
  terrainDirection,
} from '../src/elevation/profile.js';
import { evaluateRouteProgress, ROUTE_PROGRESS_DEFAULTS } from '../src/navigation/route-progress.js';

test('DGM1 navigation derivative preserves qualified terrain provenance', () => {
  const source = routeElevationSource();
  assert.equal(source.dataset, 'ATKIS-DGM1');
  assert.equal(source.verticalReference, 'DHHN2016_NH');
  assert.equal(source.gridSpacingM, 1);
  assert.equal(source.heightAccuracyM95PctUpTo, 0.3);
  assert.equal(source.interpolation, 'bilinear-cell-centres-v1');
  assert.match(source.terrainSemantics, /bare-earth terrain/);
  assert.match(source.coverageSemantics, /endpoint snap connectors are excluded/);
  assert.match(source.uncertaintySemantics, /no combined calibrated error bound/);
});

test('all canonical route summaries use bounded equal-distance sampling', async () => {
  const profile = await loadRouteElevationProfile('aquaedukt--merkurtempel');
  const summary = routeElevationSummary('aquaedukt--merkurtempel');
  assert.ok(summary);
  assert.ok(profile);
  assert.equal(profile.distancesM.length, summary.sampleCount);
  assert.equal(profile.elevationsM.length, summary.sampleCount);
  assert.ok(summary.effectiveSpacingM <= 20);
  assert.equal(profile.distancesM[0], 0);
  assert.ok(Math.abs(profile.distancesM.at(-1) - summary.mappedPathDistanceM) <= 0.02);
  for (let index = 1; index < profile.distancesM.length; index += 1) {
    assert.ok(profile.distancesM[index] > profile.distancesM[index - 1]);
    assert.ok(profile.distancesM[index] - profile.distancesM[index - 1] <= 20.01);
  }
});

test('direction reversal swaps DGM1 ascent/descent and profile endpoints', async () => {
  const forwardSummary = routeElevationSummary('aquaedukt--merkurtempel');
  const reverseSummary = routeElevationSummary('merkurtempel--aquaedukt');
  const forward = await loadRouteElevationProfile('aquaedukt--merkurtempel');
  const reverse = await loadRouteElevationProfile('merkurtempel--aquaedukt');
  assert.ok(forwardSummary && reverseSummary && forward && reverse);
  assert.ok(Math.abs(forwardSummary.ascentM - reverseSummary.descentM) <= 0.03);
  assert.ok(Math.abs(forwardSummary.descentM - reverseSummary.ascentM) <= 0.03);
  assert.ok(Math.abs(forwardSummary.elevationDeltaM + reverseSummary.elevationDeltaM) <= 0.03);
  assert.ok(Math.abs(forward.elevationsM[0] - reverse.elevationsM.at(-1)) <= 0.02);
  assert.ok(Math.abs(forward.elevationsM.at(-1) - reverse.elevationsM[0]) <= 0.02);
});

test('distance-aware profile plotting respects nonuniform distance axes', () => {
  const plotted = elevationProfilePolyline({
    distancesM: [0, 10, 40],
    elevationsM: [300, 310, 320],
  }, 200, 50);
  const [first, middle, last] = plotted.points.split(' ');
  assert.match(first, /^0\.0,/);
  assert.match(middle, /^50\.0,/);
  assert.match(last, /^200\.0,/);
  assert.equal(plotted.distanceM, 40);
  assert.equal(plotted.min, 300);
  assert.equal(plotted.max, 320);
});

test('terrain direction is conservative around a two metre deadband', () => {
  assert.equal(terrainDirection({ elevationDeltaM: 8 }), 'uphill');
  assert.equal(terrainDirection({ elevationDeltaM: -8 }), 'downhill');
  assert.equal(terrainDirection({ elevationDeltaM: 1.9 }), 'level');
  assert.equal(terrainDirection(null), 'unknown');
});

test('route progress reuses GPS accuracy-circle entry and exit hysteresis', () => {
  assert.deepEqual(ROUTE_PROGRESS_DEFAULTS, { enterRadiusM: 30, exitRadiusM: 45, maxAccuracyM: 50 });
  const route = [[51.31, 9.4], [51.31, 9.402]];
  const onRoute = evaluateRouteProgress({ lat: 51.31, lng: 9.401, accuracy: 5 }, route);
  assert.equal(onRoute.state, 'on-route');
  assert.equal(onRoute.active, true);
  assert.ok(onRoute.progressM > 50);
  assert.ok(onRoute.remainingM > 0);

  const poorAccuracy = evaluateRouteProgress(
    { lat: 51.31, lng: 9.401, accuracy: 60 },
    route,
    { active: true, previousProgressM: onRoute.progressM },
  );
  assert.equal(poorAccuracy.state, 'uncertain');
  assert.equal(poorAccuracy.active, true);
  assert.equal(poorAccuracy.progressM, onRoute.progressM);

  const retained = evaluateRouteProgress(
    { lat: 51.31036, lng: 9.401, accuracy: 10 },
    route,
    { active: true, previousProgressM: onRoute.progressM },
  );
  assert.equal(retained.state, 'retained');
  assert.equal(retained.active, true);

  const outside = evaluateRouteProgress(
    { lat: 51.311, lng: 9.401, accuracy: 5 },
    route,
    { active: true, previousProgressM: onRoute.progressM },
  );
  assert.equal(outside.state, 'outside');
  assert.equal(outside.active, false);
});
