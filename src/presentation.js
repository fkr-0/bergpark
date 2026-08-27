const PRESENTATION_OVERRIDES = {
  herkules: {
    map: { kind: 'structure', structure: 'hercules', scale: 1.18 },
    detail: { kind: 'model', assetId: 'hercules' },
  },
  'schloss-wilhelmshoehe': {
    map: { kind: 'structure', structure: 'palace', scale: 1.14 },
    detail: { kind: 'model', assetId: 'wilhelmshoehe-palace' },
  },
  schloss: {
    map: { kind: 'structure', structure: 'palace', scale: 1.14 },
    detail: { kind: 'model', assetId: 'wilhelmshoehe-palace' },
  },
  loewenburg: {
    map: { kind: 'structure', structure: 'castle', scale: 1.12 },
    detail: { kind: 'model', assetId: 'loewenburg' },
  },
  'grosse-fontaene': {
    map: { kind: 'structure', structure: 'fountain', scale: 1.08 },
    detail: { kind: 'model', assetId: 'great-fountain' },
  },
  aquaedukt: {
    map: { kind: 'structure', structure: 'aqueduct', scale: 1.1 },
    detail: { kind: 'model', assetId: 'aqueduct-gltf-v1', modelUrl: './models/aquaedukt-schematic.gltf' },
  },
};

const VALID_MAP_KINDS = new Set(['pin', 'structure', 'model']);
const VALID_DETAIL_KINDS = new Set(['standard', 'embedded-visual', 'model-ready', 'model']);

function finiteScale(value) {
  return Number.isFinite(value) ? Math.min(1.6, Math.max(0.7, value)) : 1;
}

export function resolveNodePresentation(node) {
  const override = PRESENTATION_OVERRIDES[node?.id] ?? {};
  const source = node?.presentation ?? {};
  const map = { ...(override.map ?? {}), ...(source.map ?? {}) };
  const detail = { ...(override.detail ?? {}), ...(source.detail ?? {}) };

  const mapKind = VALID_MAP_KINDS.has(map.kind) ? map.kind : 'pin';
  const detailKind = VALID_DETAIL_KINDS.has(detail.kind) ? detail.kind : 'standard';

  return {
    map: {
      kind: mapKind,
      structure: typeof map.structure === 'string' ? map.structure : null,
      modelUrl: typeof map.modelUrl === 'string' ? map.modelUrl : null,
      posterUrl: typeof map.posterUrl === 'string' ? map.posterUrl : null,
      scale: finiteScale(map.scale),
    },
    detail: {
      kind: detailKind,
      assetId: typeof detail.assetId === 'string' ? detail.assetId : null,
      modelUrl: typeof detail.modelUrl === 'string' ? detail.modelUrl : null,
      posterUrl: typeof detail.posterUrl === 'string' ? detail.posterUrl : null,
    },
  };
}

export function markerPresentationClass(node) {
  const presentation = resolveNodePresentation(node);
  return `bergpark-marker-presentation--${presentation.map.kind}`;
}

export function hasInteractiveModel(node) {
  const detail = resolveNodePresentation(node).detail;
  return detail.kind === 'model' && Boolean(detail.assetId || detail.modelUrl);
}

export function structureGlyph(structure) {
  switch (structure) {
    case 'hercules': return '⚑';
    case 'palace': return '▥';
    case 'castle': return '♜';
    case 'fountain': return '≋';
    case 'aqueduct': return '∩';
    default: return '◆';
  }
}

export function presentationRegistrySnapshot() {
  return structuredClone(PRESENTATION_OVERRIDES);
}
