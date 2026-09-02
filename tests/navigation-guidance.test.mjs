import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bearingDegrees,
  deriveDecisionManeuvers,
  nextDecisionManeuver,
  signedTurnDegrees,
} from '../src/navigation-guidance.js';

function leg(id, fromId, toId, coordinates, { steps = false, distanceM = 40 } = {}) {
  return {
    fromId,
    toId,
    reverse: false,
    segment: { id, fromId, toId, coordinates, steps, distanceM },
  };
}

function network(degrees) {
  return {
    nodesById: new Map(Object.entries(degrees).map(([id, degree]) => [id, { id, degree }])),
  };
}

test('bearing and signed turn classification use clockwise-positive navigation bearings', () => {
  const east = bearingDegrees({ lat: 51.31, lng: 9.40 }, { lat: 51.31, lng: 9.41 });
  const north = bearingDegrees({ lat: 51.31, lng: 9.41 }, { lat: 51.32, lng: 9.41 });
  assert.ok(Math.abs(east - 90) < 1);
  assert.ok(Math.abs(north) < 1 || Math.abs(north - 360) < 1);
  assert.ok(signedTurnDegrees(east, north) < -80, 'east to north is a left turn');
});

test('a degree-3 junction produces a directional maneuver', () => {
  const route = {
    segments: [
      leg('a-b', 'a', 'b', [{ lat: 51.31, lng: 9.40 }, { lat: 51.31, lng: 9.41 }]),
      leg('b-c', 'b', 'c', [{ lat: 51.31, lng: 9.41 }, { lat: 51.32, lng: 9.41 }]),
    ],
  };
  const maneuvers = deriveDecisionManeuvers(route, network({ a: 1, b: 3, c: 1 }));
  assert.equal(maneuvers[0].kind, 'turn-left');
  assert.equal(maneuvers[0].authority, 'junction-degree');
  assert.equal(maneuvers[0].nodeId, 'b');
  assert.equal(maneuvers.at(-1).kind, 'arrive');
});

test('a degree-2 bend does not fabricate a turn instruction', () => {
  const route = {
    segments: [
      leg('a-b', 'a', 'b', [{ lat: 51.31, lng: 9.40 }, { lat: 51.31, lng: 9.41 }]),
      leg('b-c', 'b', 'c', [{ lat: 51.31, lng: 9.41 }, { lat: 51.32, lng: 9.41 }]),
    ],
  };
  const maneuvers = deriveDecisionManeuvers(route, network({ a: 1, b: 2, c: 1 }));
  assert.deepEqual(maneuvers.map(({ kind }) => kind), ['arrive']);
});

test('entering explicitly mapped steps is a source-backed maneuver even at degree 2', () => {
  const route = {
    segments: [
      leg('a-b', 'a', 'b', [{ lat: 51.31, lng: 9.40 }, { lat: 51.31, lng: 9.41 }]),
      leg('b-c', 'b', 'c', [{ lat: 51.31, lng: 9.41 }, { lat: 51.311, lng: 9.411 }], { steps: true }),
    ],
  };
  const maneuvers = deriveDecisionManeuvers(route, network({ a: 1, b: 2, c: 1 }));
  assert.equal(maneuvers[0].kind, 'take-steps');
  assert.equal(maneuvers[0].authority, 'mapped-steps');
});

test('next maneuver advances only after a bounded passed-point tolerance', () => {
  const maneuvers = [
    { kind: 'turn-right', distanceFromStartM: 100 },
    { kind: 'arrive', distanceFromStartM: 220 },
  ];
  assert.equal(nextDecisionManeuver(maneuvers, 95).maneuver.kind, 'turn-right');
  assert.equal(nextDecisionManeuver(maneuvers, 105).maneuver.kind, 'turn-right');
  assert.equal(nextDecisionManeuver(maneuvers, 110).maneuver.kind, 'arrive');
  assert.equal(nextDecisionManeuver(maneuvers, 110).distanceToM, 110);
});
