export const SPATIAL3D_RUNTIME_MODES = Object.freeze({
  FULL: 'full',
  CUE: 'cue',
  HIDDEN: 'hidden',
});

export const SPATIAL3D_HIGHLIGHT_STATES = Object.freeze({
  NONE: 'none',
  SELECTED: 'selected',
  FOCUSED: 'focused',
  SELECTED_FOCUSED: 'selected-focused',
});

const MODE_SCALE = Object.freeze({
  full: 1,
  cue: 0.72,
  hidden: 1,
});

const HIGHLIGHT_SCALE = Object.freeze({
  none: 1,
  selected: 1.08,
  focused: 1.14,
  'selected-focused': 1.2,
});

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : null;
}

function canonicalEntityId(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizedLod(lod) {
  const fullWithinM = finiteNonNegative(lod?.fullWithinM) ?? 0;
  const cueWithinM = Math.max(fullWithinM, finiteNonNegative(lod?.cueWithinM) ?? fullWithinM);
  const hideBeyondM = Math.max(cueWithinM, finiteNonNegative(lod?.hideBeyondM) ?? cueWithinM);
  return Object.freeze({ fullWithinM, cueWithinM, hideBeyondM });
}

function normalizeView(view) {
  return Object.freeze({
    distanceM: finiteNonNegative(view?.distanceM),
    inView: view?.inView !== false,
  });
}

function viewEntries(viewByEntityId) {
  if (viewByEntityId instanceof Map) return [...viewByEntityId.entries()];
  if (!viewByEntityId || typeof viewByEntityId !== 'object') return [];
  return Object.entries(viewByEntityId);
}

/**
 * Snapshot ephemeral renderer inputs so later caller mutation cannot alter policy state.
 * Canonical selected/focused identity remains external authority; this is presentation only.
 */
export function normalizeSpatial3dRuntimeInputs(inputs = {}) {
  const viewByEntityId = Object.create(null);
  for (const [entityId, view] of viewEntries(inputs.viewByEntityId)) {
    const canonicalId = canonicalEntityId(entityId);
    if (canonicalId) viewByEntityId[canonicalId] = normalizeView(view);
  }
  return Object.freeze({
    selectedEntityId: canonicalEntityId(inputs.selectedEntityId),
    focusedEntityId: canonicalEntityId(inputs.focusedEntityId),
    reducedMotion: inputs.reducedMotion === true,
    lowPower: inputs.lowPower === true,
    viewByEntityId: Object.freeze(viewByEntityId),
  });
}

function highlightState(entityId, inputs) {
  const selected = inputs.selectedEntityId === entityId;
  const focused = inputs.focusedEntityId === entityId;
  if (selected && focused) return SPATIAL3D_HIGHLIGHT_STATES.SELECTED_FOCUSED;
  if (focused) return SPATIAL3D_HIGHLIGHT_STATES.FOCUSED;
  if (selected) return SPATIAL3D_HIGHLIGHT_STATES.SELECTED;
  return SPATIAL3D_HIGHLIGHT_STATES.NONE;
}

/**
 * Resolve one immutable runtime presentation decision from descriptor policy plus
 * ephemeral renderer state. The descriptor and canonical world are never mutated.
 *
 * The `hideBeyondM` band is a hard cap. Selected/focused entities may retain a cue
 * between `cueWithinM` and that cap, but no interaction state can bypass the cap.
 */
export function resolveSpatial3dRuntimePolicy(descriptor, rawInputs = {}) {
  const entityId = canonicalEntityId(descriptor?.entityId);
  if (!entityId) throw new TypeError('spatial3d runtime policy requires a canonical entityId');
  const normalized = rawInputs?.viewByEntityId
    && Object.isFrozen(rawInputs)
    && Object.isFrozen(rawInputs.viewByEntityId)
    && Object.getPrototypeOf(rawInputs.viewByEntityId) === null;
  const inputs = normalized ? rawInputs : normalizeSpatial3dRuntimeInputs(rawInputs);
  const lod = normalizedLod(descriptor?.lod);
  const view = inputs.viewByEntityId[entityId] ?? Object.freeze({ distanceM: null, inView: true });
  const highlight = highlightState(entityId, inputs);
  const highlighted = highlight !== SPATIAL3D_HIGHLIGHT_STATES.NONE;

  let mode = SPATIAL3D_RUNTIME_MODES.FULL;
  let reason = 'distance-unavailable-preserve-full';
  if (!view.inView) {
    mode = SPATIAL3D_RUNTIME_MODES.HIDDEN;
    reason = 'outside-view';
  } else if (view.distanceM != null) {
    if (view.distanceM <= lod.fullWithinM) {
      mode = SPATIAL3D_RUNTIME_MODES.FULL;
      reason = 'within-full';
    } else if (view.distanceM <= lod.cueWithinM) {
      mode = SPATIAL3D_RUNTIME_MODES.CUE;
      reason = 'within-cue';
    } else if (view.distanceM <= lod.hideBeyondM && highlighted) {
      mode = SPATIAL3D_RUNTIME_MODES.CUE;
      reason = 'interaction-retained-cue';
    } else {
      mode = SPATIAL3D_RUNTIME_MODES.HIDDEN;
      reason = view.distanceM > lod.hideBeyondM ? 'beyond-hard-cap' : 'culled-fringe';
    }
  }

  if (mode === SPATIAL3D_RUNTIME_MODES.FULL && (inputs.reducedMotion || inputs.lowPower)) {
    mode = SPATIAL3D_RUNTIME_MODES.CUE;
    reason = inputs.lowPower ? 'power-downgrade' : 'reduced-motion-downgrade';
  }

  const scale = MODE_SCALE[mode] * HIGHLIGHT_SCALE[highlight];
  return Object.freeze({
    entityId,
    mode,
    visible: mode !== SPATIAL3D_RUNTIME_MODES.HIDDEN,
    highlight,
    selected: inputs.selectedEntityId === entityId,
    focused: inputs.focusedEntityId === entityId,
    scale,
    reason,
    distanceM: view.distanceM,
    inView: view.inView,
    lod,
  });
}

export function spatial3dRuntimeDecisionSignature(decision) {
  const mode = decision?.mode ?? SPATIAL3D_RUNTIME_MODES.HIDDEN;
  if (mode === SPATIAL3D_RUNTIME_MODES.HIDDEN) return SPATIAL3D_RUNTIME_MODES.HIDDEN;
  return `${mode}:${decision?.highlight ?? 'none'}:${decision?.scale ?? 1}`;
}
