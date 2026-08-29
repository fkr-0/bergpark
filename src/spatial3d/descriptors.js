import { resolveNodePresentation } from '../presentation.js';

export const SPATIAL3D_DESCRIPTOR_VERSION = 1;

const CURATED_POLICY = Object.freeze({
  aquaedukt: Object.freeze({
    representation: 'gltf',
    assetId: 'aqueduct-gltf-v1',
    modelUrl: './models/aquaedukt-schematic.gltf',
    metresPerModelUnit: 1,
    terrainOffsetM: 0.35,
    headingDeg: 0,
    priority: 100,
    lod: Object.freeze({ fullWithinM: 950, cueWithinM: 1800, hideBeyondM: 2600 }),
    provenance: Object.freeze({
      kind: 'existing-bounded-asset',
      representationAccuracy: 'schematic-not-surveyed-reconstruction',
      assetAuthority: 'canonical-presentation',
    }),
  }),
  herkules: Object.freeze({
    representation: 'procedural-cue',
    cueKind: 'heritage',
    terrainOffsetM: 0.2,
    priority: 90,
    lod: Object.freeze({ fullWithinM: 700, cueWithinM: 1700, hideBeyondM: 2500 }),
  }),
  schloss: Object.freeze({
    representation: 'procedural-cue',
    cueKind: 'heritage',
    terrainOffsetM: 0.2,
    priority: 85,
    lod: Object.freeze({ fullWithinM: 650, cueWithinM: 1600, hideBeyondM: 2400 }),
  }),
  loewenburg: Object.freeze({
    representation: 'procedural-cue',
    cueKind: 'heritage',
    terrainOffsetM: 0.2,
    priority: 80,
    lod: Object.freeze({ fullWithinM: 600, cueWithinM: 1500, hideBeyondM: 2300 }),
  }),
  'grosse-fontaene': Object.freeze({
    representation: 'procedural-cue',
    cueKind: 'water',
    terrainOffsetM: 0.08,
    priority: 75,
    lod: Object.freeze({ fullWithinM: 550, cueWithinM: 1400, hideBeyondM: 2200 }),
  }),
});

const PROCEDURAL_PROVENANCE = Object.freeze({
  kind: 'deterministic-spatial-cue',
  representationAccuracy: 'abstract-location-cue-not-monument-reconstruction',
  assetAuthority: 'renderer-presentation-only',
});

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clonePosition(position) {
  const lng = finite(position?.lng);
  const lat = finite(position?.lat);
  if (lng == null || lat == null) return null;
  const result = { lng, lat };
  const elevationM = finite(position?.elevationM);
  if (elevationM != null) result.elevationM = elevationM;
  if (position?.provenance) result.provenance = position.provenance;
  return Object.freeze(result);
}

function presentationMatchesPolicy(node, policy) {
  if (policy.representation !== 'gltf') return true;
  const detail = resolveNodePresentation(node).detail;
  return detail.kind === 'model'
    && detail.assetId === policy.assetId
    && detail.modelUrl === policy.modelUrl;
}

/**
 * Create an immutable, renderer-neutral spatial-3D descriptor.
 *
 * The descriptor snapshots only canonical identity/position plus presentation policy.
 * It never contains MapLibre or Three instances and it never writes sampled terrain
 * elevation back into SpatialWorld.
 */
export function createSpatial3dDescriptor(node, world) {
  const entityId = typeof node?.id === 'string' ? node.id : null;
  const policy = entityId ? CURATED_POLICY[entityId] : null;
  const canonical = entityId ? world?.placesById?.get?.(entityId) : null;
  const position = clonePosition(canonical?.position);
  if (!policy || !canonical || !position || !presentationMatchesPolicy(node, policy)) return null;

  const descriptor = {
    version: SPATIAL3D_DESCRIPTOR_VERSION,
    entityId,
    canonicalKind: canonical.kind,
    position,
    representation: policy.representation,
    terrainOffsetM: policy.terrainOffsetM,
    orientation: Object.freeze({ headingDeg: policy.headingDeg ?? 0, pitchDeg: 0, rollDeg: 0 }),
    priority: policy.priority,
    lod: policy.lod,
    deepLink: canonical.deepLink ?? Object.freeze({ kind: 'place', id: entityId }),
    provenance: policy.provenance ?? PROCEDURAL_PROVENANCE,
  };

  if (policy.assetId) descriptor.assetId = policy.assetId;
  if (policy.modelUrl) descriptor.modelUrl = policy.modelUrl;
  if (policy.metresPerModelUnit) descriptor.metresPerModelUnit = policy.metresPerModelUnit;
  if (policy.cueKind) descriptor.cueKind = policy.cueKind;
  return Object.freeze(descriptor);
}

/** Build the bounded curated family without promoting it to canonical content authority. */
export function createSpatial3dFamily(nodes, world) {
  const byId = new Map((nodes ?? []).map((node) => [node.id, node]));
  const descriptors = Object.keys(CURATED_POLICY)
    .map((id) => createSpatial3dDescriptor(byId.get(id), world))
    .filter(Boolean)
    .sort((left, right) => right.priority - left.priority || left.entityId.localeCompare(right.entityId));
  return Object.freeze(descriptors);
}

export function spatial3dCuratedIds() {
  return Object.freeze(Object.keys(CURATED_POLICY));
}

export function spatial3dDescriptorPolicySnapshot() {
  return structuredClone(CURATED_POLICY);
}
