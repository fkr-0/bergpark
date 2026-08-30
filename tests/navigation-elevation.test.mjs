import test from 'node:test';
import assert from 'node:assert/strict';

import {
  elevationProfilePolyline,
  loadRouteElevationProfile,
  routeElevationSource,
  routeElevationSummary,
  terrainDirection,
} from '../src/elevation/profile.js';
import { discoverMountainRoutes, routeTerrainSummary } from '../src/discovery.js';
import { evaluateRouteProgress, ROUTE_PROGRESS_DEFAULTS } from '../src/navigation/route-progress.js';
import { routeEvidence } from '../src/routes.js';

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

test('route evidence prefers DGM1 but keeps legacy and unknown terrain explicit', () => {
  const dgm1 = routeEvidence({
    id: 'aquaedukt--merkurtempel',
    from: 'aquaedukt',
    to: 'merkurtempel',
    ascent_m: 999,
    descent_m: 999,
    elevation_profile_m: [1, 2],
  });
  assert.equal(dgm1.elevationStatus, 'dgm1');
  assert.notEqual(dgm1.ascentM, 999);
  assert.equal(dgm1.elevationSource.dataset, 'ATKIS-DGM1');
  const dgm1Summary = routeElevationSummary('aquaedukt--merkurtempel');
  assert.equal(dgm1.netGradePct, dgm1Summary.averageGradePct);
  assert.equal(dgm1.startElevationM, dgm1Summary.startElevationM);
  assert.equal(dgm1.endElevationM, dgm1Summary.endElevationM);
  assert.match(routeTerrainSummary(dgm1, 'en'), /net \+8\.6%.*steepest segments.*DGM1/);

  const legacy = routeEvidence({
    id: 'synthetic--legacy',
    from: 'synthetic',
    to: 'legacy',
    ascent_m: 12,
    descent_m: 3,
    avg_grade_pct: 2.5,
    elevation_metric_sampling_m: 90,
    elevation_profile_m: [100, 110, 109],
    elevation_source: { dataset: 'Copernicus DEM 2021 GLO-90' },
  });
  assert.equal(legacy.elevationStatus, 'legacy');
  assert.equal(legacy.elevationSource.dataset, 'Copernicus DEM 2021 GLO-90');
  assert.equal(legacy.minElevationM, 100);
  assert.equal(legacy.maxElevationM, 110);
  assert.equal(legacy.netGradePct, 2.5);
  assert.equal(legacy.maxUphillGradePct, null);

  const unknown = routeEvidence({ id: 'synthetic--unknown', from: 'synthetic', to: 'unknown' });
  assert.equal(unknown.elevationStatus, 'unknown');
  assert.equal(unknown.elevationSource, null);
  assert.equal(unknown.ascentM, null);
  assert.equal(unknown.minElevationM, null);

  const unprovenLegacy = routeEvidence({
    id: 'synthetic--unproven',
    from: 'synthetic',
    to: 'unproven',
    ascent_m: 99,
    descent_m: 12,
    avg_grade_pct: 7,
    elevation_profile_m: [100, 140],
  });
  assert.equal(unprovenLegacy.elevationStatus, 'unknown');
  assert.equal(unprovenLegacy.elevationSource, null);
  assert.equal(unprovenLegacy.ascentM, null);
  assert.deepEqual(unprovenLegacy.elevationProfileM, []);
});

test('mountain discovery filters only existing route IDs by explicit evidence', () => {
  const glo90Source = { dataset: 'Copernicus DEM 2021 GLO-90', provider: 'Open-Meteo Elevation API' };
  const edges = [
    { id: 'origin--up', from: 'origin', to: 'up', walking_min: 5, elevation_profile_m: [100, 112] },
    { id: 'origin--down', from: 'origin', to: 'down', walking_min: 6, elevation_profile_m: [120, 105] },
    { id: 'origin--view', from: 'origin', to: 'view', walking_min: 7, elevation_profile_m: [110, 114] },
    { id: 'origin--water', from: 'origin', to: 'water', walking_min: 8, elevation_profile_m: [110, 109] },
    { id: 'origin--heritage', from: 'origin', to: 'heritage', walking_min: 9, elevation_profile_m: [110, 111] },
  ].map((edge) => ({ ...edge, elevation_source: glo90Source }));
  const graph = {
    outgoing: new Map([['origin', edges]]),
    nodesById: new Map([
      ['up', { id: 'up', name: { en: 'Up' } }],
      ['down', { id: 'down', name: { en: 'Down' } }],
      ['view', { id: 'view', name: { en: 'View' }, type: 'viewpoint' }],
      ['water', { id: 'water', name: { en: 'Water' } }],
      ['heritage', { id: 'heritage', name: { en: 'Heritage' }, osm_tags: { historic: 'yes' } }],
    ]),
    semanticEdges: [{
      from: 'designer',
      to: 'water',
      provenance: { assertion: 'The documented water display is the principal surviving axis.' },
    }],
  };
  assert.deepEqual(discoverMountainRoutes(graph, 'origin', 'en', { filter: 'uphill' }).map(({ id }) => id), ['origin--up', 'origin--view']);
  assert.deepEqual(discoverMountainRoutes(graph, 'origin', 'en', { filter: 'downhill' }).map(({ id }) => id), ['origin--down']);
  assert.deepEqual(discoverMountainRoutes(graph, 'origin', 'en', { filter: 'viewpoint' }).map(({ id }) => id), ['origin--view']);
  assert.deepEqual(discoverMountainRoutes(graph, 'origin', 'en', { filter: 'water-axis' }).map(({ id }) => id), ['origin--water']);
  assert.deepEqual(discoverMountainRoutes(graph, 'origin', 'en', { filter: 'heritage' }).map(({ id }) => id), ['origin--heritage']);
  assert.match(routeTerrainSummary(routeEvidence(edges[0]), 'en'), /uphill.*GLO-90 fallback/);
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
