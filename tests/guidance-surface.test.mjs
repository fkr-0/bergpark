import assert from 'node:assert/strict';
import test from 'node:test';
import { navigationSummary, projectPositionOnRoute } from '../src/guidance-surface.js';

test('route projection reports remaining distance along the route rather than crow-flight distance', () => {
  const coordinates = [
    { lat: 51.315, lng: 9.395 },
    { lat: 51.315, lng: 9.400 },
    { lat: 51.320, lng: 9.400 },
  ];
  const projection = projectPositionOnRoute({ lat: 51.315, lng: 9.3975 }, coordinates);
  assert.ok(projection);
  assert.ok(projection.progressFraction > 0.15 && projection.progressFraction < 0.3);
  assert.ok(projection.remainingM > 500);
  assert.ok(projection.offRouteM < 2);
});

test('navigation summary scales geometry progress to the published route distance and walking estimate', () => {
  const coordinates = [
    { lat: 51.315, lng: 9.395 },
    { lat: 51.315, lng: 9.405 },
  ];
  const summary = navigationSummary({
    position: { lat: 51.315, lng: 9.400 },
    coordinates,
    routeDistanceM: 1000,
    walkingMin: 12,
  });
  assert.ok(summary);
  assert.ok(Math.abs(summary.remainingM - 500) < 10);
  assert.ok(Math.abs(summary.remainingWalkingMin - 6) < 0.2);
  assert.equal(summary.offRoute, false);
});

test('navigation summary identifies a materially off-route position without inventing a maneuver', () => {
  const summary = navigationSummary({
    position: { lat: 51.316, lng: 9.400 },
    coordinates: [
      { lat: 51.315, lng: 9.395 },
      { lat: 51.315, lng: 9.405 },
    ],
  });
  assert.ok(summary);
  assert.equal(summary.offRoute, true);
  assert.ok(summary.offRouteM > 100);
});
