const MAX_MODEL_BYTES = 5 * 1024 * 1024;
const MAX_MODEL_TRIANGLES = 180_000;

function defaultBaseUrl() {
  return globalThis.location?.href ?? globalThis.document?.baseURI ?? 'http://localhost/';
}

/** Resolve a top-level model asset without allowing an origin escape. */
export function resolveSameOriginModelUrl(value, { baseUrl = defaultBaseUrl() } = {}) {
  if (!value) return null;
  const base = new URL(baseUrl, defaultBaseUrl());
  const url = new URL(value, base);
  if (url.origin !== base.origin) throw new Error('3D model assets must be served from the Bergpark origin');
  return url;
}

export function countModelTriangles(object) {
  let triangles = 0;
  object?.traverse?.((child) => {
    const geometry = child.geometry;
    if (!geometry) return;
    if (geometry.index) triangles += geometry.index.count / 3;
    else if (geometry.attributes?.position) triangles += geometry.attributes.position.count / 3;
  });
  return Math.ceil(triangles);
}

/** Dispose one Three object tree, including material-owned textures. */
export function disposeModelObject(object) {
  if (!object?.traverse) return;
  const materials = new Set();
  object.traverse((child) => {
    child.geometry?.dispose?.();
    const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of childMaterials) if (material) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) value?.isTexture && value.dispose?.();
    material.dispose?.();
  }
}

/**
 * Load a same-origin glTF through the single shared Bergpark model safety policy.
 * Secondary resources remain stricter than same-origin-only: they must be embedded
 * data/blob URLs so a model cannot fan out into additional network requests.
 */
export async function loadBoundedGltfModel(THREE, modelUrl, {
  fetchFn = globalThis.fetch?.bind(globalThis),
  baseUrl = defaultBaseUrl(),
  signal,
} = {}) {
  if (!THREE?.LoadingManager) throw new TypeError('Three LoadingManager is unavailable');
  if (typeof fetchFn !== 'function') throw new Error('fetch unavailable for 3D model asset');
  const url = resolveSameOriginModelUrl(modelUrl, { baseUrl });
  if (!url) throw new Error('3D model URL is missing');

  const response = await fetchFn(url, { credentials: 'same-origin', signal });
  if (!response.ok) throw new Error(`3D model request failed: ${response.status}`);
  const reportedBytes = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(reportedBytes) && reportedBytes > MAX_MODEL_BYTES) throw new Error('3D model exceeds byte budget');
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_MODEL_BYTES) throw new Error('3D model exceeds byte budget');

  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const basePath = new URL('./', url).href;
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((resourceUrl) => {
    const resolved = new URL(resourceUrl, basePath);
    if (resolved.protocol === 'data:' || resolved.protocol === 'blob:') return resourceUrl;
    throw new Error('3D models must embed all secondary buffers and textures');
  });
  const loader = new GLTFLoader(manager);
  const gltf = await new Promise((resolve, reject) => loader.parse(buffer, basePath, resolve, reject));
  const triangles = countModelTriangles(gltf.scene);
  if (triangles > MAX_MODEL_TRIANGLES) {
    disposeModelObject(gltf.scene);
    throw new Error('3D model exceeds triangle budget');
  }
  return { object: gltf.scene, source: 'gltf', triangles, bytes: buffer.byteLength };
}

export const modelAssetBudgets = Object.freeze({
  maxBytes: MAX_MODEL_BYTES,
  maxTriangles: MAX_MODEL_TRIANGLES,
});
