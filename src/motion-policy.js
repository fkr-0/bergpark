export function prefersReducedMotion(matchMedia = globalThis.matchMedia?.bind(globalThis)) {
  if (typeof matchMedia !== 'function') return false;
  return Boolean(matchMedia('(prefers-reduced-motion: reduce)')?.matches);
}

export function moveLeafletCamera(map, target, zoom, { duration = 0.35, matchMedia } = {}) {
  if (prefersReducedMotion(matchMedia)) {
    map.setView(target, zoom, { animate: false });
    return 'immediate';
  }
  map.flyTo(target, zoom, { duration });
  return 'animated';
}

export function moveMapLibreCamera(map, options, { duration = 0.35, matchMedia } = {}) {
  const camera = { ...options };
  if (prefersReducedMotion(matchMedia)) {
    map.jumpTo(camera);
    return 'immediate';
  }
  map.easeTo({ ...camera, duration: Math.max(0, duration) * 1000, essential: false });
  return 'animated';
}
