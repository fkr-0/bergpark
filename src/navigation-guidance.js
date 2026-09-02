import { distanceMetres } from './gps.js';

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validPoint(point) {
  return finite(point?.lat) != null && finite(point?.lng ?? point?.lon) != null;
}

function normalizePoint(point) {
  return { lat: Number(point.lat), lng: Number(point.lng ?? point.lon) };
}

export function bearingDegrees(from, to) {
  if (!validPoint(from) || !validPoint(to)) return null;
  const a = normalizePoint(from);
  const b = normalizePoint(to);
  if (distanceMetres(a, b) < 0.5) return null;
  const radians = Math.PI / 180;
  const lat1 = a.lat * radians;
  const lat2 = b.lat * radians;
  const deltaLng = (b.lng - a.lng) * radians;
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function signedTurnDegrees(incomingBearing, outgoingBearing) {
  const incoming = finite(incomingBearing);
  const outgoing = finite(outgoingBearing);
  if (incoming == null || outgoing == null) return null;
  return ((outgoing - incoming + 540) % 360) - 180;
}

function orientedCoordinates(leg) {
  const coordinates = (leg?.segment?.coordinates ?? []).filter(validPoint).map(normalizePoint);
  return leg?.reverse ? [...coordinates].reverse() : coordinates;
}

function legDistanceM(leg) {
  const declared = finite(leg?.segment?.distanceM);
  if (declared != null && declared >= 0) return declared;
  const coordinates = orientedCoordinates(leg);
  let distanceM = 0;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    distanceM += distanceMetres(coordinates[index], coordinates[index + 1]);
  }
  return distanceM;
}

function edgeBearing(coordinates, fromStart) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  if (fromStart) {
    for (let index = 0; index < coordinates.length - 1; index += 1) {
      const bearing = bearingDegrees(coordinates[index], coordinates[index + 1]);
      if (bearing != null) return bearing;
    }
    return null;
  }
  for (let index = coordinates.length - 1; index > 0; index -= 1) {
    const bearing = bearingDegrees(coordinates[index - 1], coordinates[index]);
    if (bearing != null) return bearing;
  }
  return null;
}

function maneuverKind(turnDegrees, enteringSteps) {
  if (enteringSteps) return 'take-steps';
  const absolute = Math.abs(turnDegrees ?? 0);
  if (absolute < 25) return 'continue';
  if (absolute < 55) return turnDegrees < 0 ? 'bear-left' : 'bear-right';
  return turnDegrees < 0 ? 'turn-left' : 'turn-right';
}

/**
 * Derive only graph-backed decision instructions.
 *
 * Degree-2 geometry is treated as path shape, not as a maneuver. A directional
 * instruction is emitted at a real junction (degree >= 3). Entering an
 * explicitly mapped steps segment is independently useful and source-backed,
 * so it may produce an instruction even when the node has degree 2.
 */
export function deriveDecisionManeuvers(route, walkingNetwork) {
  const legs = Array.isArray(route?.segments) ? route.segments : [];
  if (!legs.length) return Object.freeze([]);
  const maneuvers = [];
  let cumulativeM = 0;

  for (let index = 0; index < legs.length - 1; index += 1) {
    const current = legs[index];
    const next = legs[index + 1];
    cumulativeM += legDistanceM(current);
    const nodeId = current?.toId ?? null;
    const degree = finite(walkingNetwork?.nodesById?.get(nodeId)?.degree);
    const enteringSteps = next?.segment?.steps === true && current?.segment?.steps !== true;
    if (!(enteringSteps || (degree != null && degree >= 3))) continue;

    const incomingBearing = edgeBearing(orientedCoordinates(current), false);
    const outgoingBearing = edgeBearing(orientedCoordinates(next), true);
    const turnDegrees = signedTurnDegrees(incomingBearing, outgoingBearing);
    if (!enteringSteps && turnDegrees == null) continue;

    maneuvers.push(Object.freeze({
      kind: maneuverKind(turnDegrees, enteringSteps),
      nodeId,
      distanceFromStartM: cumulativeM,
      incomingBearing,
      outgoingBearing,
      turnDegrees,
      degree,
      nextSegmentId: next?.segment?.id ?? null,
      authority: enteringSteps ? 'mapped-steps' : 'junction-degree',
    }));
  }

  const totalDistanceM = legs.reduce((sum, leg) => sum + legDistanceM(leg), 0);
  maneuvers.push(Object.freeze({
    kind: 'arrive',
    nodeId: route?.segments?.at(-1)?.toId ?? null,
    distanceFromStartM: totalDistanceM,
    incomingBearing: edgeBearing(orientedCoordinates(legs.at(-1)), false),
    outgoingBearing: null,
    turnDegrees: null,
    degree: null,
    nextSegmentId: null,
    authority: 'route-destination',
  }));
  return Object.freeze(maneuvers);
}

export function nextDecisionManeuver(maneuvers, progressM, { passedToleranceM = 8 } = {}) {
  if (!Array.isArray(maneuvers) || !maneuvers.length) return null;
  const progress = Math.max(0, finite(progressM) ?? 0);
  const tolerance = Math.max(0, finite(passedToleranceM) ?? 0);
  const maneuver = maneuvers.find((candidate) => (
    finite(candidate?.distanceFromStartM) != null
    && candidate.distanceFromStartM >= progress - tolerance
  ));
  if (!maneuver) return null;
  return Object.freeze({
    maneuver,
    distanceToM: Math.max(0, maneuver.distanceFromStartM - progress),
  });
}
