import { MercatorCoordinate } from 'maplibre-gl';
import { disposeModelObject, loadBoundedGltfModel } from './model-assets.js';
import { resolveNodePresentation } from './presentation.js';
import { createSpatial3dDescriptor, createSpatial3dFamily } from './spatial3d/descriptors.js';
import { loadSpatial3dObject } from './spatial3d/procedural-models.js';

export const SHARED_DEPTH_HERITAGE_ID = 'aquaedukt';
export const SHARED_DEPTH_LAYER_ID = 'terrain-heritage-aquaedukt';
export const SPATIAL3D_FAMILY_LAYER_ID = 'terrain-heritage-spatial3d';
export const SHARED_DEPTH_ASSET_ID = 'aqueduct-gltf-v1';
export const SHARED_DEPTH_DISPLAY_OFFSET_M = 0.35;
export const SHARED_DEPTH_MODEL_METRES_PER_UNIT = 1;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function degrees(value) {
  return (finite(value) ?? 0) * Math.PI / 180;
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

export function terrainAwareSpatial3dPlacement(world, map, descriptor) {
  if (!descriptor?.entityId) return null;
  return terrainAwareHeritagePlacement(world, map, {
    nodeId: descriptor.entityId,
    displayOffsetM: descriptor.terrainOffsetM ?? 0,
  });
}

export function createMercatorModelMatrix(THREE, placement, {
  metresPerModelUnit = SHARED_DEPTH_MODEL_METRES_PER_UNIT,
  orientation = null,
  mercatorCoordinate = MercatorCoordinate,
} = {}) {
  if (!THREE?.Matrix4 || !THREE?.Vector3) throw new TypeError('Three matrix primitives are unavailable');
  if (!placement) return null;
  const coordinate = mercatorCoordinate.fromLngLat([placement.lng, placement.lat], placement.altitudeM);
  const metres = coordinate.meterInMercatorCoordinateUnits() * metresPerModelUnit;
  const modelToMap = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  const heading = new THREE.Matrix4().makeRotationY(degrees(orientation?.headingDeg));
  const pitch = new THREE.Matrix4().makeRotationX(degrees(orientation?.pitchDeg));
  const roll = new THREE.Matrix4().makeRotationZ(degrees(orientation?.rollDeg));
  modelToMap.multiply(heading).multiply(pitch).multiply(roll);
  return new THREE.Matrix4()
    .makeTranslation(coordinate.x, coordinate.y, coordinate.z)
    .scale(new THREE.Vector3(metres, -metres, metres))
    .multiply(modelToMap);
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

function resolveFamilyDescriptors(node, nodes, world) {
  if (Array.isArray(nodes) && nodes.length) {
    const family = createSpatial3dFamily(nodes, world);
    if (family.length) return family;
  }
  const descriptor = createSpatial3dDescriptor(node, world);
  return descriptor ? Object.freeze([descriptor]) : Object.freeze([]);
}

/**
 * Bounded MapLibre custom layer using the map's WebGL2 context, camera and depth buffer.
 * One layer owns one Three scene containing ephemeral objects derived from renderer-neutral
 * descriptors. It never creates a canvas, navigation camera, RAF, or Three animation loop.
 *
 * Passing only `node` preserves the Phase-5 Aquaedukt API. A later integration owner may
 * pass `nodes` to opt into the curated descriptor family without changing canonical data.
 */
export function createMapLibreHeritageSharedDepthLayer({
  node,
  nodes,
  world: initialWorld,
  onStateChange = () => {},
  threeLoader = () => import('three'),
  modelLoader = loadBoundedGltfModel,
  objectLoader = loadSpatial3dObject,
  rendererFactory = defaultRendererFactory,
  mercatorCoordinate = MercatorCoordinate,
} = {}) {
  const descriptors = resolveFamilyDescriptors(node, nodes, initialWorld);
  if (!descriptors.length) throw new Error('shared-depth heritage layer requires an authorized spatial3d descriptor');
  const primaryDescriptor = descriptors.find(({ entityId }) => entityId === SHARED_DEPTH_HERITAGE_ID) ?? descriptors[0];
  const layerId = descriptors.length > 1 ? SPATIAL3D_FAMILY_LAYER_ID : SHARED_DEPTH_LAYER_ID;
  const records = new Map(descriptors.map((descriptor) => [descriptor.entityId, {
    descriptor,
    object: null,
    modelMatrix: null,
    placement: null,
    metadata: null,
    error: null,
    state: 'created',
  }]));

  let world = initialWorld;
  let map = null;
  let gl = null;
  let THREE = null;
  let scene = null;
  let camera = null;
  let renderer = null;
  let attached = false;
  let disposed = false;
  let contextLost = false;
  let terrainAvailable = true;
  let generation = 0;
  let abortController = null;
  let state = 'created';
  let hasRendered = false;

  const values = () => [...records.values()];
  const loadedRecords = () => values().filter(({ object }) => Boolean(object));
  const failedRecords = () => values().filter(({ error }) => Boolean(error));
  const placedRecords = () => values().filter(({ object, modelMatrix }) => Boolean(object && modelMatrix));

  function failureSnapshot() {
    return Object.freeze(failedRecords().map(({ descriptor, error }) => Object.freeze({
      entityId: descriptor.entityId,
      reason: errorMessage(error),
    })));
  }

  function objectSnapshot() {
    return Object.freeze(values().map(({ descriptor, metadata, error, state: objectState, placement }) => Object.freeze({
      entityId: descriptor.entityId,
      representation: descriptor.representation,
      state: objectState,
      source: metadata?.modelSource ?? null,
      bytes: metadata?.modelBytes ?? null,
      triangles: metadata?.modelTriangles ?? null,
      provenance: metadata?.modelProvenance ?? descriptor.provenance,
      displayOffsetM: descriptor.terrainOffsetM ?? 0,
      metresPerModelUnit: descriptor.metresPerModelUnit ?? 1,
      orientation: descriptor.orientation,
      placement,
      error: error ? errorMessage(error) : null,
    })));
  }

  function emit(nextState, extra = {}) {
    state = nextState;
    const primary = records.get(primaryDescriptor.entityId);
    const primaryMetadata = primary?.metadata ?? {};
    onStateChange(Object.freeze({
      state: nextState,
      nodeId: primaryDescriptor.entityId,
      entityIds: Object.freeze(descriptors.map(({ entityId }) => entityId)),
      loadedEntityIds: Object.freeze(loadedRecords().map(({ descriptor }) => descriptor.entityId)),
      failedEntityIds: Object.freeze(failedRecords().map(({ descriptor }) => descriptor.entityId)),
      layerId,
      renderingMode: '3d',
      animation: 'none',
      displayOffsetM: primaryDescriptor.terrainOffsetM ?? 0,
      modelMetresPerUnit: primaryDescriptor.metresPerModelUnit ?? 1,
      objectCount: loadedRecords().length,
      placedObjectCount: placedRecords().length,
      failureCount: failedRecords().length,
      objects: objectSnapshot(),
      ...(primaryMetadata ?? {}),
      ...extra,
    }));
  }

  function resetRecord(record) {
    if (record.object) disposeModelObject(record.object);
    record.object = null;
    record.modelMatrix = null;
    record.placement = null;
    record.metadata = null;
    record.error = null;
    record.state = 'created';
  }

  function releaseGraphics() {
    abortController?.abort?.();
    abortController = null;
    for (const record of values()) resetRecord(record);
    scene = null;
    camera = null;
    // Never force context loss: MapLibre owns this shared WebGL2 context.
    renderer?.dispose?.();
    renderer = null;
    THREE = null;
    hasRendered = false;
  }

  function refreshRecordPlacement(record) {
    if (!attached || disposed || contextLost || !terrainAvailable || !THREE || !record.object || !map) return false;
    const next = terrainAwareSpatial3dPlacement(world, map, record.descriptor);
    if (!next) {
      record.placement = null;
      record.modelMatrix = null;
      record.object.visible = false;
      return false;
    }
    const changed = !record.placement
      || record.placement.lng !== next.lng
      || record.placement.lat !== next.lat
      || record.placement.altitudeM !== next.altitudeM;
    record.placement = next;
    record.object.visible = true;
    if (changed || !record.modelMatrix) {
      record.modelMatrix = createMercatorModelMatrix(THREE, next, {
        metresPerModelUnit: record.descriptor.metresPerModelUnit ?? 1,
        orientation: record.descriptor.orientation,
        mercatorCoordinate,
      });
      record.object.matrixAutoUpdate = false;
      record.object.matrix.copy(record.modelMatrix);
      record.object.matrixWorldNeedsUpdate = true;
      map.triggerRepaint?.();
    }
    return true;
  }

  function refreshPlacements({ emitState = true } = {}) {
    if (!attached || disposed || contextLost || !terrainAvailable || !THREE || !map) return false;
    for (const record of loadedRecords()) refreshRecordPlacement(record);
    const loaded = loadedRecords().length;
    const placed = placedRecords().length;
    if (emitState) {
      if (loaded === 0) {
        if (state !== 'loading') emit('loading', { rendered: false });
      } else if (placed === 0) {
        if (state !== 'waiting-terrain') emit('waiting-terrain', { rendered: false });
      } else if (state !== 'ready') {
        emit('ready', { rendered: hasRendered, partial: failedRecords().length > 0 });
      }
    }
    return placed > 0;
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
      THREE = nextThree;
      scene = new THREE.Scene();
      camera = new THREE.Camera();
      camera.matrixAutoUpdate = false;
      camera.matrixWorld.identity();
      camera.matrixWorldInverse.identity();
      renderer = rendererFactory(THREE, map, gl);
      renderer.autoClear = false;

      await Promise.all(descriptors.map(async (descriptor) => {
        const record = records.get(descriptor.entityId);
        record.state = 'loading';
        try {
          const resolved = await objectLoader(nextThree, descriptor, {
            signal: abortController.signal,
            modelLoader,
          });
          if (attempt !== generation || !attached || disposed || contextLost || !terrainAvailable) {
            disposeModelObject(resolved.object);
            return;
          }
          record.object = resolved.object;
          record.state = 'ready';
          record.metadata = Object.freeze({
            modelSource: resolved.source,
            modelBytes: resolved.bytes,
            modelTriangles: resolved.triangles,
            modelProvenance: resolved.provenance ?? descriptor.provenance,
          });
          scene.add(record.object);
          refreshRecordPlacement(record);
        } catch (error) {
          if (attempt !== generation || disposed || !attached || error?.name === 'AbortError') return;
          record.error = error;
          record.state = 'unavailable';
        }
      }));

      if (attempt !== generation || !attached || disposed || contextLost || !terrainAvailable) return;
      if (!loadedRecords().length) {
        const failures = failureSnapshot();
        const failedEntityIds = Object.freeze(failures.map(({ entityId }) => entityId));
        const objects = objectSnapshot();
        const reason = failures[0]?.reason ?? 'spatial3d objects unavailable';
        releaseGraphics();
        emit('unavailable', {
          reason,
          failures,
          failedEntityIds,
          failureCount: failures.length,
          objects,
          rendered: false,
        });
        return;
      }
      refreshPlacements();
    } catch (error) {
      if (attempt !== generation || disposed || !attached || error?.name === 'AbortError') return;
      releaseGraphics();
      emit('unavailable', { reason: errorMessage(error), rendered: false });
    }
  }

  function onIdle() {
    refreshPlacements();
  }

  function onContextLost() {
    if (!attached || disposed) return;
    contextLost = true;
    generation += 1;
    releaseGraphics();
    emit('context-lost', { rendered: false });
  }

  function onContextRestored() {
    if (!attached || disposed || !contextLost) return;
    contextLost = false;
    emit('restoring', { rendered: false });
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
    if (!disposed) emit('removed', { rendered: false });
  }

  const layer = {
    id: layerId,
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
      if (!attached || disposed || contextLost || !terrainAvailable || !renderer || !scene || !camera || !placedRecords().length) return;
      const projection = options?.defaultProjectionData?.mainMatrix ?? options?.modelViewProjectionMatrix;
      if (!projection) return;
      camera.projectionMatrix.fromArray(projection);
      camera.projectionMatrixInverse?.copy?.(camera.projectionMatrix)?.invert?.();
      scene.updateMatrixWorld?.(true);
      renderer.resetState?.();
      try {
        renderer.render(scene, camera);
        if (!hasRendered) {
          hasRendered = true;
          emit('ready', { rendered: true, partial: failedRecords().length > 0 });
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
      return refreshPlacements();
    },
    setTerrainAvailable(available) {
      const next = available === true;
      if (terrainAvailable === next) return;
      terrainAvailable = next;
      generation += 1;
      releaseGraphics();
      if (!terrainAvailable) {
        emit('terrain-unavailable', { rendered: false });
      } else if (attached && !disposed && !contextLost) {
        void initialize();
      }
    },
    refreshPlacement() {
      return refreshPlacements();
    },
    refreshPlacements,
    dispose() {
      if (disposed) return;
      detach();
      disposed = true;
      emit('disposed', { rendered: false });
    },
    debugState() {
      return Object.freeze({
        state,
        attached,
        disposed,
        contextLost,
        terrainAvailable,
        hasRenderer: Boolean(renderer),
        hasModel: loadedRecords().length > 0,
        hasPlacement: placedRecords().length > 0,
        hasRendered,
        entityIds: Object.freeze(descriptors.map(({ entityId }) => entityId)),
        objectCount: loadedRecords().length,
        placedObjectCount: placedRecords().length,
        failureCount: failedRecords().length,
        failures: failureSnapshot(),
        objects: objectSnapshot(),
      });
    },
  };

  return layer;
}
