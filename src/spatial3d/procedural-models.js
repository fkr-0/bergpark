import { countModelTriangles, loadBoundedGltfModel } from '../model-assets.js';

function cueMaterial(THREE, cueKind) {
  if (cueKind === 'water') {
    return new THREE.MeshBasicMaterial({ color: 0x4f8795, transparent: true, opacity: 0.82 });
  }
  return new THREE.MeshBasicMaterial({ color: 0x7d765f, transparent: true, opacity: 0.88 });
}

function createHeritageCue(THREE, descriptor) {
  const group = new THREE.Group();
  group.name = `spatial-cue:${descriptor.entityId}`;
  const material = cueMaterial(THREE, 'heritage');
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.12, 12), material);
  base.position.y = 0.06;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 2.2, 8), material);
  stem.position.y = 1.22;
  const cap = new THREE.Mesh(new THREE.OctahedronGeometry(0.34, 0), material);
  cap.position.y = 2.55;
  group.add(base, stem, cap);
  return group;
}

function createWaterCue(THREE, descriptor) {
  const group = new THREE.Group();
  group.name = `spatial-cue:${descriptor.entityId}`;
  const material = cueMaterial(THREE, 'water');
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.65, 1.65, 0.08, 24), material);
  disc.position.y = 0.04;
  const center = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 1.35, 10), material);
  center.position.y = 0.72;
  group.add(disc, center);
  return group;
}

export function createProceduralSpatialCue(THREE, descriptor) {
  if (!THREE?.Group || !THREE?.Mesh) throw new TypeError('Three primitives are unavailable for spatial cue');
  if (descriptor?.representation !== 'procedural-cue') throw new Error('descriptor is not a procedural spatial cue');
  const object = descriptor.cueKind === 'water'
    ? createWaterCue(THREE, descriptor)
    : createHeritageCue(THREE, descriptor);
  return {
    object,
    source: 'procedural-cue',
    triangles: countModelTriangles(object),
    bytes: 0,
    provenance: descriptor.provenance,
  };
}

/** Resolve one descriptor to ephemeral Three state without changing descriptor authority. */
export async function loadSpatial3dObject(THREE, descriptor, {
  signal,
  modelLoader = loadBoundedGltfModel,
} = {}) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (descriptor?.representation === 'gltf') {
    const resolved = await modelLoader(THREE, descriptor.modelUrl, { signal });
    return { ...resolved, provenance: descriptor.provenance };
  }
  if (descriptor?.representation === 'procedural-cue') return createProceduralSpatialCue(THREE, descriptor);
  throw new Error(`Unsupported spatial3d representation: ${descriptor?.representation ?? 'missing'}`);
}
