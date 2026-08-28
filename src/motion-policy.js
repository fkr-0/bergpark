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
