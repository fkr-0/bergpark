import { MercatorCoordinate } from 'maplibre-gl';
import { disposeModelObject, loadBoundedGltfModel } from './model-assets.js';
import { resolveNodePresentation } from './presentation.js';

export const SHARED_DEPTH_HERITAGE_ID = 'aquaedukt';
export const SHARED_DEPTH_LAYER_ID = 'terrain-heritage-aquaedukt';
export const SHARED_DEPTH_ASSET_ID = 'aqueduct-gltf-v1';
export const SHARED_DEPTH_DISPLAY_OFFSET_M = 0.35;
export const SHARED_DEPTH_MODEL_METRES_PER_UNIT = 1;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function sharedDepthHeritageSpec(node) {
  if (node?.id !== SHARED_DEPTH_HERITAGE_ID) return null;
  const presentation = resolveNodePresentation(node);
  if (presentation.detail.kind !== 'model'
    || presentation.detail.assetId !== SHARED_DEPTH_ASSET_ID
    || presentation.detail.modelUrl !== './models/aquaedukt-schematic.gltf') return null;
  return Object.freeze({
    nodeId: SHARED_DEPTH_HERITAGE_ID,
    assetId: SHARED_DEPTH_ASSET_ID,
    modelUrl: presentation.detail.modelUrl,
    // The existing asset is explicitly schematic rather than a surveyed
    // reconstruction. Keep its world conversion simple and explicit instead
    // of reusing the unrelated 2D marker scale as physical geometry.
    metresPerModelUnit: SHARED_DEPTH_MODEL_METRES_PER_UNIT,
    displayOffsetM: SHARED_DEPTH_DISPLAY_OFFSET_M,
  });
}

/**
 * Derive ephemeral display altitude from MapLibre's committed 1x terrain.
 * The returned value is presentation-only; SpatialWorld and graph data are never changed.
 */
export function terrainAwareHeritagePlacement(world, map, {
  nodeId = SHARED_DEPTH_HERITAGE_ID,
  displayOffsetM = SHARED_DEPTH_DISPLAY_OFFSET_M,
} = {}) {
  const descriptor = world?.placesById?.get?.(nodeId);
  const lng = finite(descriptor?.position?.lng);
  const lat = finite(descriptor?.position?.lat);
  if (lng == null || lat == null || typeof map?.queryTerrainElevation !== 'function') return null;
  let terrainElevationM = null;
  try {
    terrainElevationM = finite(map.queryTerrainElevation([lng, lat]));
  } catch {
    terrainElevationM = null;
  }
  if (terrainElevationM == null) return null;
  return Object.freeze({
    nodeId,
    lng,
    lat,
    altitudeM: terrainElevationM + displayOffsetM,
    displayOffsetM,
  });
}

export function createMercatorModelMatrix(THREE, placement, {
  metresPerModelUnit = SHARED_DEPTH_MODEL_METRES_PER_UNIT,
  mercatorCoordinate = MercatorCoordinate,
} = {}) {
  if (!THREE?.Matrix4 || !THREE?.Vector3) throw new TypeError('Three matrix primitives are unavailable');
  if (!placement) return null;
  const coordinate = mercatorCoordinate.fromLngLat([placement.lng, placement.lat], placement.altitudeM);
  const metres = coordinate.meterInMercatorCoordinateUnits() * metresPerModelUnit;
  const rotation = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  return new THREE.Matrix4()
    .makeTranslation(coordinate.x, coordinate.y, coordinate.z)
    .scale(new THREE.Vector3(metres, -metres, metres))
    .multiply(rotation);
}

function defaultRendererFactory(THREE, map, gl) {
  const renderer = new THREE.WebGLRenderer({
    canvas: map.getCanvas(),
    context: gl,
    antialias: true,
    alpha: true,
  });
  // MapLibre owns the framebuffer, dimensions, camera and clear operations.
  renderer.autoClear = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One-object MapLibre custom layer using the map's WebGL2 context, camera and depth buffer.
 * It never creates a canvas, navigation camera, RAF, or Three animation loop.
 */
export function createMapLibreHeritageSharedDepthLayer({
  node,
  world: initialWorld,
  onStateChange = () => {},
  threeLoader = () => import('three'),
  modelLoader = loadBoundedGltfModel,
  rendererFactory = defaultRendererFactory,
  mercatorCoordinate = MercatorCoordinate,
} = {}) {
  const spec = sharedDepthHeritageSpec(node);
  if (!spec) throw new Error('shared-depth heritage spike is authorized only for the Aquaedukt glTF presentation');
  if (!initialWorld?.placesById?.has?.(spec.nodeId)) throw new Error('Aquaedukt is missing from canonical SpatialWorld');

  let world = initialWorld;
  let map = null;
  let gl = null;
  let THREE = null;
  let scene = null;
  let camera = null;
  let renderer = null;
  let model = null;
  let modelMatrix = null;
  let placement = null;
  let attached = false;
  let disposed = false;
  let contextLost = false;
  let terrainAvailable = true;
  let generation = 0;
  let abortController = null;
  let modelMetadata = null;
  let state = 'created';
  let hasRendered = false;

  function emit(nextState, extra = {}) {
    state = nextState;
    onStateChange(Object.freeze({
      state: nextState,
      nodeId: spec.nodeId,
      assetId: spec.assetId,
      layerId: SHARED_DEPTH_LAYER_ID,
      renderingMode: '3d',
      animation: 'none',
      displayOffsetM: spec.displayOffsetM,
      modelMetresPerUnit: spec.metresPerModelUnit,
      ...(modelMetadata ?? {}),
      ...extra,
    }));
  }

  function releaseGraphics() {
    abortController?.abort?.();
    abortController = null;
    if (model) disposeModelObject(model);
    model = null;
    modelMatrix = null;
    placement = null;
    scene = null;
    camera = null;
    // Never force context loss: MapLibre owns this shared WebGL2 context.
    renderer?.dispose?.();
    renderer = null;
    THREE = null;
    modelMetadata = null;
    hasRendered = false;
  }

  function refreshPlacement() {
    if (!attached || disposed || contextLost || !terrainAvailable || !THREE || !model || !map) return false;
    const next = terrainAwareHeritagePlacement(world, map, {
      nodeId: spec.nodeId,
      displayOffsetM: spec.displayOffsetM,
    });
    if (!next) {
      placement = null;
      modelMatrix = null;
      if (state !== 'waiting-terrain') emit('waiting-terrain');
      return false;
    }
    const changed = !placement
      || placement.lng !== next.lng
      || placement.lat !== next.lat
      || placement.altitudeM !== next.altitudeM;
    placement = next;
    if (changed || !modelMatrix) {
      modelMatrix = createMercatorModelMatrix(THREE, placement, {
        metresPerModelUnit: spec.metresPerModelUnit,
        mercatorCoordinate,
      });
      map.triggerRepaint?.();
    }
    if (state !== 'ready') emit('ready');
    return true;
  }

  async function initialize() {
    if (!attached || disposed || contextLost || !terrainAvailable) return;
    const attempt = ++generation;
    abortController?.abort?.();
    abortController = new AbortController();
    emit('loading', { rendered: false });
    try {
      const nextThree = await threeLoader();
      if (attempt !== generation || !attached || disposed || contextLost || !terrainAvailable) return;
      const resolved = await modelLoader(nextThree, spec.modelUrl, { signal: abortController.signal });
      if (attempt !== generation || !attached || disposed || contextLost || !terrainAvailable) {
        disposeModelObject(resolved.object);
        return;
      }

      THREE = nextThree;
      model = resolved.object;
      scene = new THREE.Scene();
      camera = new THREE.Camera();
      scene.add(model);
      renderer = rendererFactory(THREE, map, gl);
      renderer.autoClear = false;
      modelMetadata = Object.freeze({
        modelSource: resolved.source,
        modelBytes: resolved.bytes,
        modelTriangles: resolved.triangles,
      });
      if (!refreshPlacement()) emit('waiting-terrain');
    } catch (error) {
      if (attempt !== generation || disposed || !attached) return;
      if (error?.name === 'AbortError') return;
      releaseGraphics();
      emit('unavailable', { reason: errorMessage(error) });
    }
  }

  function onIdle() {
    refreshPlacement();
  }

  function onContextLost() {
    if (!attached || disposed) return;
    contextLost = true;
    generation += 1;
    releaseGraphics();
    emit('context-lost');
  }

  function onContextRestored() {
    if (!attached || disposed || !contextLost) return;
    contextLost = false;
    emit('restoring');
    void initialize();
  }

  function detach() {
    if (!attached) return;
    map?.off?.('idle', onIdle);
    map?.off?.('webglcontextlost', onContextLost);
    map?.off?.('webglcontextrestored', onContextRestored);
    attached = false;
    generation += 1;
    releaseGraphics();
    map = null;
    gl = null;
    if (!disposed) emit('removed');
  }

  const layer = {
    id: SHARED_DEPTH_LAYER_ID,
    type: 'custom',
    renderingMode: '3d',
    onAdd(nextMap, nextGl) {
      if (disposed) throw new Error('shared-depth heritage layer was disposed');
      if (attached) detach();
      map = nextMap;
      gl = nextGl;
      attached = true;
      contextLost = false;
      map.on?.('idle', onIdle);
      map.on?.('webglcontextlost', onContextLost);
      map.on?.('webglcontextrestored', onContextRestored);
      void initialize();
    },
    render(_sharedGl, options) {
      if (!attached || disposed || contextLost || !terrainAvailable || !renderer || !scene || !camera || !modelMatrix) return;
      const projection = options?.defaultProjectionData?.mainMatrix ?? options?.modelViewProjectionMatrix;
      if (!projection) return;
      camera.projectionMatrix.fromArray(projection).multiply(modelMatrix);
      camera.projectionMatrixInverse?.copy?.(camera.projectionMatrix)?.invert?.();
      renderer.resetState?.();
      try {
        renderer.render(scene, camera);
        if (!hasRendered) {
          hasRendered = true;
          emit('ready', { rendered: true });
        }
      } finally {
        // Three and MapLibre share one context; leave no cached Three state behind.
        renderer.resetState?.();
      }
    },
    onRemove() {
      detach();
    },
    setWorld(nextWorld) {
      world = nextWorld;
      return refreshPlacement();
    },
    setTerrainAvailable(available) {
      const next = available === true;
      if (terrainAvailable === next) return;
      terrainAvailable = next;
      generation += 1;
      releaseGraphics();
      if (!terrainAvailable) {
        emit('terrain-unavailable');
      } else if (attached && !disposed && !contextLost) {
        void initialize();
      }
    },
    refreshPlacement,
    dispose() {
      if (disposed) return;
      detach();
      disposed = true;
      emit('disposed');
    },
    debugState() {
      return Object.freeze({
        state,
        attached,
        disposed,
        contextLost,
        terrainAvailable,
        hasRenderer: Boolean(renderer),
        hasModel: Boolean(model),
        hasPlacement: Boolean(placement),
        hasRendered,
      });
    },
  };

  return layer;
}
