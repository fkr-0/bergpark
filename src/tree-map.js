import L from 'leaflet';
import { localized } from './i18n.js';
import { markerKeyboardActivation } from './leaflet-keyboard.js';
import { clusterTrees } from './trees.js';

function coordinate(tree) {
  const rawLat = tree?.lat;
  const rawLng = tree?.lng ?? tree?.lon;
  if (rawLat == null || rawLng == null || rawLat === '' || rawLng === '') return null;
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
}

export function createTreeMapLayer(map, trees, { language = 'de', onSelectTree } = {}) {
  const layer = L.layerGroup().addTo(map);
  let currentTrees = trees ?? [];
  let currentLanguage = language;
  let visible = false;

  function inViewport(tree) {
    const point = coordinate(tree);
    if (!point) return false;
    return map.getBounds().pad(0.15).contains(point);
  }

  function render() {
    layer.clearLayers();
    if (!visible || !currentTrees.length) return;
    const visibleTrees = currentTrees.filter(inViewport);
    const zoom = map.getZoom();
    const features = clusterTrees(visibleTrees, visibleTrees.length > 250 && zoom >= 17 ? 16 : zoom);
    for (const feature of features) {
      if (feature.kind === 'tree') {
        const tree = feature.tree;
        const label = localized(tree.name, currentLanguage, tree.species?.[currentLanguage] ?? tree.species?.scientific ?? tree.catalog_ref ?? tree.id);
        const icon = L.divIcon({
          className: 'tree-map-point',
          html: `<span class="sr-only">${String(label).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</span>`,
          iconSize: [12, 12],
          iconAnchor: [6, 6],
        });
        const activateTree = () => onSelectTree?.(tree.id, { source: 'map' });
        L.marker([feature.lat, feature.lng], { icon, title: label, alt: label, keyboard: true })
          .bindTooltip(label)
          .on('click', activateTree)
          .on('keydown', markerKeyboardActivation(activateTree))
          .addTo(layer);
      } else {
        const label = currentLanguage === 'de'
          ? `${feature.count} ${feature.count === 1 ? 'Baum' : 'Bäume'}`
          : `${feature.count} ${feature.count === 1 ? 'tree' : 'trees'}`;
        const size = Math.min(34, 20 + Math.round(Math.log2(feature.count + 1) * 2));
        const icon = L.divIcon({
          className: 'tree-map-cluster',
          html: `<span aria-hidden="true">${feature.count}</span><span class="sr-only">${label}</span>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        });
        const activateCluster = () => map.flyTo([feature.lat, feature.lng], Math.min(18, zoom + 2), { duration: 0.35 });
        L.marker([feature.lat, feature.lng], { icon, title: label, alt: label, keyboard: true })
          .bindTooltip(label)
          .on('click', activateCluster)
          .on('keydown', markerKeyboardActivation(activateCluster))
          .addTo(layer);
      }
    }
  }

  map.on('zoomend moveend', render);
  return {
    setVisible(nextVisible) { visible = Boolean(nextVisible); render(); },
    setTrees(nextTrees) { currentTrees = nextTrees ?? []; render(); },
    updateLanguage(nextLanguage) { currentLanguage = nextLanguage; render(); },
    render,
    destroy() { map.off('zoomend moveend', render); layer.remove(); },
  };
}
