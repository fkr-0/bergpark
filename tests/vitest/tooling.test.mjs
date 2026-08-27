import { describe, expect, it } from 'vitest';
import { hasInteractiveModel, resolveNodePresentation } from '../../src/presentation.js';

describe('presentation contract', () => {
  it('keeps ordinary nodes lightweight', () => {
    expect(resolveNodePresentation({ id: 'ordinary-place' })).toEqual({
      map: {
        kind: 'pin',
        structure: null,
        modelUrl: null,
        posterUrl: null,
        scale: 1,
      },
      detail: {
        kind: 'standard',
        assetId: null,
        modelUrl: null,
        posterUrl: null,
      },
    });
  });

  it('recognizes the bounded Aquädukt model presentation', () => {
    const presentation = resolveNodePresentation({ id: 'aquaedukt' });
    expect(presentation.map.kind).toBe('structure');
    expect(presentation.detail.kind).toBe('model');
    expect(presentation.detail.modelUrl).toBe('./models/aquaedukt-schematic.gltf');
    expect(hasInteractiveModel({ id: 'aquaedukt' })).toBe(true);
  });
});
