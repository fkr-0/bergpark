import {
  countModelTriangles,
  disposeModelObject,
  loadBoundedGltfModel,
  modelAssetBudgets,
} from './model-assets.js';

const TEXT = {
  de: {
    eyebrow: 'Schematische 3D-Ansicht',
    loading: '3D-Ansicht wird geladen …',
    ready: '3D-Ansicht bereit',
    unavailable: 'Die interaktive 3D-Ansicht ist auf diesem Gerät nicht verfügbar.',
    fallback: 'Die normale Karte und die redaktionellen Ortsinformationen bleiben vollständig nutzbar.',
    close: '3D-Ansicht schließen',
    rotatePause: 'Drehung pausieren',
    rotateResume: 'Drehung fortsetzen',
    reset: 'Ansicht zurücksetzen',
    instructions: 'Ziehen zum Drehen, Mausrad oder Trackpad zum Zoomen. Die Darstellung ist schematisch und nicht maßstäblich.',
    canvas: (title) => `Interaktives schematisches 3D-Modell von ${title}`,
  },
  en: {
    eyebrow: 'Schematic 3D view',
    loading: 'Loading 3D view …',
    ready: '3D view ready',
    unavailable: 'The interactive 3D view is unavailable on this device.',
    fallback: 'The normal map and editorial place information remain fully usable.',
    close: 'Close 3D view',
    rotatePause: 'Pause rotation',
    rotateResume: 'Resume rotation',
    reset: 'Reset view',
    instructions: 'Drag to rotate; use the mouse wheel or trackpad to zoom. This representation is schematic and not to scale.',
    canvas: (title) => `Interactive schematic 3D model of ${title}`,
  },
};

function strings(language) {
  return TEXT[language] ?? TEXT.de;
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function safeDomId(value) {
  return String(value ?? 'landmark').replace(/[^a-zA-Z0-9_-]/g, '-');
}

export function supportsInteractive3d() {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!context) return false;
    context.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function addBox(THREE, group, material, size, position, rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  group.add(mesh);
  return mesh;
}

function addCylinder(THREE, group, material, radiusTop, radiusBottom, height, segments, position) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), material);
  mesh.position.set(...position);
  group.add(mesh);
  return mesh;
}

function createPalette(THREE) {
  return {
    stone: new THREE.MeshStandardMaterial({ color: 0x9a8a6b, roughness: 0.84, metalness: 0.02 }),
    stoneDark: new THREE.MeshStandardMaterial({ color: 0x5d594c, roughness: 0.92, metalness: 0.01 }),
    sandstone: new THREE.MeshStandardMaterial({ color: 0xb39a69, roughness: 0.88, metalness: 0.01 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x51483f, roughness: 0.78, metalness: 0.03 }),
    bronze: new THREE.MeshStandardMaterial({ color: 0x55614f, roughness: 0.68, metalness: 0.18 }),
    water: new THREE.MeshPhysicalMaterial({ color: 0x4f93ab, transparent: true, opacity: 0.68, roughness: 0.18, metalness: 0, transmission: 0.08 }),
    lawn: new THREE.MeshStandardMaterial({ color: 0x4f6d50, roughness: 1, metalness: 0 }),
  };
}

function buildHercules(THREE, palette) {
  const group = new THREE.Group();
  addBox(THREE, group, palette.lawn, [7.2, 0.18, 6.4], [0, -0.09, 0]);
  addBox(THREE, group, palette.stoneDark, [5.8, 0.42, 4.8], [0, 0.21, 0]);
  addBox(THREE, group, palette.stone, [5.1, 0.38, 4.15], [0, 0.61, 0]);
  addBox(THREE, group, palette.sandstone, [4.35, 0.34, 3.5], [0, 0.97, 0]);
  addCylinder(THREE, group, palette.stone, 1.15, 1.35, 2.7, 8, [0, 2.46, 0]);
  addCylinder(THREE, group, palette.sandstone, 0.75, 1.28, 1.55, 4, [0, 4.55, 0]);
  addCylinder(THREE, group, palette.bronze, 0.22, 0.27, 1.3, 10, [0, 5.95, 0]);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), palette.bronze);
  head.position.set(0, 6.72, 0);
  group.add(head);
  addBox(THREE, group, palette.bronze, [1.0, 0.14, 0.14], [0.34, 6.2, 0], [0, 0, -0.45]);
  return group;
}

function buildPalace(THREE, palette) {
  const group = new THREE.Group();
  addBox(THREE, group, palette.lawn, [9.5, 0.16, 6.2], [0, -0.08, 0]);
  addBox(THREE, group, palette.stoneDark, [8.6, 0.3, 3.7], [0, 0.15, 0]);
  addBox(THREE, group, palette.sandstone, [4.0, 2.4, 2.8], [0, 1.5, 0]);
  addBox(THREE, group, palette.stone, [2.35, 1.85, 2.45], [-3.05, 1.25, 0]);
  addBox(THREE, group, palette.stone, [2.35, 1.85, 2.45], [3.05, 1.25, 0]);
  addBox(THREE, group, palette.roof, [4.25, 0.36, 3.05], [0, 2.88, 0], [0, 0, 0]);
  addBox(THREE, group, palette.roof, [2.55, 0.3, 2.7], [-3.05, 2.28, 0]);
  addBox(THREE, group, palette.roof, [2.55, 0.3, 2.7], [3.05, 2.28, 0]);
  for (const x of [-1.3, -0.65, 0, 0.65, 1.3]) {
    addCylinder(THREE, group, palette.stoneDark, 0.1, 0.12, 1.45, 12, [x, 1.15, 1.52]);
  }
  addBox(THREE, group, palette.sandstone, [3.35, 0.22, 0.95], [0, 2.0, 1.45]);
  return group;
}

function buildLoewenburg(THREE, palette) {
  const group = new THREE.Group();
  addBox(THREE, group, palette.lawn, [8.0, 0.16, 6.6], [0, -0.08, 0]);
  addBox(THREE, group, palette.stoneDark, [5.8, 1.45, 2.4], [0, 1.0, 0]);
  addBox(THREE, group, palette.stone, [2.25, 3.1, 2.0], [0.5, 2.0, 0]);
  for (const [x, z, h] of [[-2.8, -1.15, 3.25], [-2.8, 1.15, 3.75], [2.8, -1.15, 3.55], [2.8, 1.15, 3.15]]) {
    addCylinder(THREE, group, palette.stone, 0.55, 0.68, h, 10, [x, h / 2, z]);
    addCylinder(THREE, group, palette.roof, 0, 0.76, 1.05, 10, [x, h + 0.5, z]);
  }
  addCylinder(THREE, group, palette.roof, 0, 1.45, 1.35, 4, [0.5, 4.15, 0]);
  return group;
}

function buildGreatFountain(THREE, palette) {
  const group = new THREE.Group();
  addCylinder(THREE, group, palette.lawn, 4.5, 4.5, 0.12, 48, [0, -0.06, 0]);
  addCylinder(THREE, group, palette.stone, 3.55, 3.75, 0.38, 48, [0, 0.18, 0]);
  addCylinder(THREE, group, palette.water, 3.25, 3.25, 0.09, 48, [0, 0.42, 0]);
  addCylinder(THREE, group, palette.water, 0.11, 0.19, 5.2, 18, [0, 3.0, 0]);
  addCylinder(THREE, group, palette.water, 0.035, 0.075, 2.4, 12, [-0.85, 1.55, 0.3]);
  addCylinder(THREE, group, palette.water, 0.035, 0.075, 2.15, 12, [0.85, 1.42, -0.25]);
  return group;
}

const PROCEDURAL_BUILDERS = {
  hercules: buildHercules,
  'wilhelmshoehe-palace': buildPalace,
  loewenburg: buildLoewenburg,
  'great-fountain': buildGreatFountain,
};

function fitCamera(THREE, object, camera, controls) {
  const bounds = new THREE.Box3().setFromObject(object);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z, 1);
  const distance = maxDimension * 1.55;
  controls.target.copy(center);
  camera.position.set(center.x + distance * 0.72, center.y + distance * 0.58, center.z + distance * 0.82);
  camera.near = Math.max(0.02, distance / 100);
  camera.far = distance * 12;
  camera.updateProjectionMatrix();
  controls.minDistance = maxDimension * 0.55;
  controls.maxDistance = maxDimension * 4.2;
  controls.update();
  controls.saveState();
}

function buildProceduralModel(THREE, assetId) {
  const builder = PROCEDURAL_BUILDERS[assetId];
  if (!builder) throw new Error(`No procedural 3D asset registered for ${assetId}`);
  const palette = createPalette(THREE);
  const object = builder(THREE, palette);
  const triangles = countModelTriangles(object);
  return { object, source: 'procedural', triangles, bytes: 0 };
}

async function resolveModel(THREE, presentation) {
  if (presentation.detail.modelUrl) return loadBoundedGltfModel(THREE, presentation.detail.modelUrl);
  return buildProceduralModel(THREE, presentation.detail.assetId);
}

export function createLandmarkModelViewer({ parent, nodeId, title, presentation, language = 'de', onClose } = {}) {
  if (!parent) throw new Error('3D viewer requires a parent element');
  const previousFocus = document.activeElement;
  const titleId = `landmark-model-title-${safeDomId(nodeId)}`;
  const root = document.createElement('section');
  root.className = 'landmark-model-viewer';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', titleId);
  root.dataset.state = 'loading';
  root.dataset.modelAsset = presentation.detail.assetId ?? presentation.detail.modelUrl ?? '';
  root.dataset.pointerInteractions = '0';

  root.innerHTML = `
    <div class="landmark-model-viewer__card">
      <header class="landmark-model-viewer__header">
        <div>
          <p class="landmark-model-viewer__eyebrow"></p>
          <h2 id="${escapeHtml(titleId)}">${escapeHtml(title)}</h2>
        </div>
        <button type="button" class="landmark-model-viewer__close" data-model-close></button>
      </header>
      <div class="landmark-model-viewer__stage" role="img">
        <canvas class="landmark-model-viewer__canvas" data-model-canvas></canvas>
        <div class="landmark-model-viewer__status" data-model-status role="status"></div>
        <div class="landmark-model-viewer__fallback" data-model-fallback hidden>
          <strong data-model-fallback-title></strong>
          <span data-model-fallback-copy></span>
        </div>
      </div>
      <div class="landmark-model-viewer__controls">
        <button type="button" data-model-rotate disabled></button>
        <button type="button" data-model-reset disabled></button>
      </div>
      <p class="landmark-model-viewer__instructions" data-model-instructions></p>
    </div>
  `;
  parent.append(root);

  const canvas = root.querySelector('[data-model-canvas]');
  const stage = root.querySelector('.landmark-model-viewer__stage');
  const status = root.querySelector('[data-model-status]');
  const fallback = root.querySelector('[data-model-fallback]');
  const fallbackTitle = root.querySelector('[data-model-fallback-title]');
  const fallbackCopy = root.querySelector('[data-model-fallback-copy]');
  const closeButton = root.querySelector('[data-model-close]');
  const rotateButton = root.querySelector('[data-model-rotate]');
  const resetButton = root.querySelector('[data-model-reset]');
  const eyebrow = root.querySelector('.landmark-model-viewer__eyebrow');
  const instructions = root.querySelector('[data-model-instructions]');

  let currentLanguage = language;
  let currentTitle = title;
  let destroyed = false;
  let scene = null;
  let model = null;
  let renderer = null;
  let camera = null;
  let controls = null;
  let resizeObserver = null;
  let autoRotate = false;

  function renderStrings() {
    const t = strings(currentLanguage);
    eyebrow.textContent = t.eyebrow;
    root.querySelector(`#${titleId}`).textContent = currentTitle;
    closeButton.textContent = '×';
    closeButton.setAttribute('aria-label', t.close);
    status.textContent = root.dataset.state === 'ready' ? t.ready : t.loading;
    fallbackTitle.textContent = t.unavailable;
    fallbackCopy.textContent = t.fallback;
    instructions.textContent = t.instructions;
    canvas.setAttribute('aria-label', t.canvas(currentTitle));
    stage.setAttribute('aria-label', t.canvas(currentTitle));
    rotateButton.textContent = autoRotate ? t.rotatePause : t.rotateResume;
    rotateButton.setAttribute('aria-pressed', String(autoRotate));
    resetButton.textContent = t.reset;
  }

  function close() {
    if (destroyed) return;
    destroyed = true;
    renderer?.setAnimationLoop?.(null);
    resizeObserver?.disconnect?.();
    controls?.dispose?.();
    model && disposeModelObject(model);
    renderer?.dispose?.();
    document.removeEventListener('keydown', onKeyDown);
    canvas.removeEventListener('pointerdown', recordPointerInteraction);
    canvas.removeEventListener('wheel', recordPointerInteraction);
    // Chromium may retain a disposed WebGL canvas internally. Detach it from the
    // modal subtree so that browser-level context retention cannot retain the
    // complete viewer DOM through the canvas parent/listener chain.
    root.replaceChildren();
    root.remove();
    queueMicrotask(() => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
      onClose?.();
    });
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...root.querySelectorAll('button:not([disabled]):not([hidden]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((element) => !element.closest('[hidden]'));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function recordPointerInteraction() {
    root.dataset.pointerInteractions = String(Number(root.dataset.pointerInteractions ?? 0) + 1);
  }

  closeButton.addEventListener('click', close);
  document.addEventListener('keydown', onKeyDown);
  canvas.addEventListener('pointerdown', recordPointerInteraction);
  canvas.addEventListener('wheel', recordPointerInteraction, { passive: true });

  renderStrings();
  closeButton.focus();

  const ready = (async () => {
    try {
      if (!supportsInteractive3d()) throw new Error('WebGL unavailable');
      const THREE = await import('three');
      const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
      if (destroyed) return false;

      scene = new THREE.Scene();
      scene.background = new THREE.Color(0xe9eadf);
      camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      scene.add(new THREE.HemisphereLight(0xf6f2de, 0x405346, 2.3));
      const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
      keyLight.position.set(6, 9, 7);
      scene.add(keyLight);
      const fillLight = new THREE.DirectionalLight(0xc9dfed, 1.1);
      fillLight.position.set(-6, 4, -5);
      scene.add(fillLight);

      const resolved = await resolveModel(THREE, presentation);
      if (destroyed) {
        disposeModelObject(resolved.object);
        return false;
      }
      model = resolved.object;
      scene.add(model);

      controls = new OrbitControls(camera, canvas);
      controls.enableDamping = true;
      controls.dampingFactor = 0.075;
      controls.enablePan = false;
      controls.rotateSpeed = 0.65;
      controls.zoomSpeed = 0.8;
      fitCamera(THREE, model, camera, controls);

      autoRotate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      controls.autoRotate = autoRotate;
      controls.autoRotateSpeed = 0.72;
      rotateButton.disabled = false;
      resetButton.disabled = false;
      renderStrings();

      rotateButton.addEventListener('click', () => {
        autoRotate = !autoRotate;
        controls.autoRotate = autoRotate;
        renderStrings();
      });
      resetButton.addEventListener('click', () => controls.reset());

      const resize = () => {
        if (destroyed) return;
        const rect = stage.getBoundingClientRect();
        const width = Math.max(1, Math.floor(rect.width));
        const height = Math.max(1, Math.floor(rect.height));
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(stage);
      resize();

      root.dataset.state = 'ready';
      root.dataset.modelSource = resolved.source;
      root.dataset.modelTriangles = String(resolved.triangles);
      root.dataset.modelBytes = String(resolved.bytes);
      status.textContent = strings(currentLanguage).ready;
      status.classList.add('sr-only');

      renderer.setAnimationLoop(() => {
        controls.update();
        renderer.render(scene, camera);
      });
      return true;
    } catch (error) {
      console.warn('Bergpark 3D viewer fallback:', error);
      if (destroyed) return false;
      root.dataset.state = 'fallback';
      root.dataset.modelError = error instanceof Error ? error.message : String(error);
      canvas.hidden = true;
      status.hidden = true;
      fallback.hidden = false;
      rotateButton.hidden = true;
      resetButton.hidden = true;
      renderStrings();
      return false;
    }
  })();

  return {
    element: root,
    ready,
    close,
    destroy: close,
    setLanguage(nextLanguage, nextTitle = currentTitle) {
      currentLanguage = nextLanguage;
      currentTitle = nextTitle;
      renderStrings();
    },
  };
}

export const modelViewerBudgets = modelAssetBudgets;
