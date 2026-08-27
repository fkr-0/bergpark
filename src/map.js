import L from 'leaflet';
import { localized } from './i18n.js';

const PARK_CENTER = [51.3167, 9.4167];

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function markerIcon(category = 'landmark') {
  const glyph = ['waterfeature', 'lake', 'pond'].includes(category) ? '≈' : ['castle', 'palace'].includes(category) ? '♜' : '●';
  return L.divIcon({
    className: 'bergpark-marker-wrap',
    html: `<span class="bergpark-marker bergpark-marker--${escapeHtml(category)}" aria-hidden="true"><span>${glyph}</span></span>`,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
    popupAnchor: [0, -19],
  });
}

function popupHtml(node, language) {
  const title = localized(node.name, language, node.title ?? node.id);
  const summary = localized(node.description, language, localized(node.summary, language));
  const category = node.type ?? node.category ?? (language === 'de' ? 'Ort' : 'Place');
  return `
    <article class="marker-popup">
      <p class="marker-popup__kind">${escapeHtml(category)}</p>
      <h2>${escapeHtml(title)}</h2>
      ${summary ? `<p>${escapeHtml(summary)}</p>` : ''}
      <button type="button" data-map-details="${escapeHtml(node.id)}">${language === 'de' ? 'Details öffnen' : 'Open details'}</button>
    </article>
  `;
}

function routeStyle(active = false) {
  return active
    ? { weight: 6, opacity: 0.9, lineCap: 'round', lineJoin: 'round', className: 'active-route-line' }
    : { weight: 2, opacity: 0.28, lineCap: 'round', lineJoin: 'round', className: 'network-route-line' };
}

export function createBergparkMap(element, graph, { language = 'de', onSelectNode, onLocationError } = {}) {
  const { nodes, edges } = graph;
  let currentLanguage = language;
  const map = L.map(element, {
    center: PARK_CENTER,
    zoom: 15,
    zoomControl: false,
    preferCanvas: true,
  });

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });
  const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17,
    attribution: 'Map data &copy; OpenStreetMap contributors, SRTM | Map style &copy; OpenTopoMap',
  });
  osm.addTo(map);
  L.control.layers({ OpenStreetMap: osm, OpenTopoMap: topo }, null, { position: 'topright' }).addTo(map);

  const networkLayer = L.layerGroup().addTo(map);
  const markerLayer = L.layerGroup().addTo(map);
  const routeLayer = L.layerGroup().addTo(map);
  const userLayer = L.layerGroup().addTo(map);
  const markers = new Map();

  const uniqueEdges = new Map();
  for (const edge of edges) {
    if (!Array.isArray(edge.path_coordinates) || edge.path_coordinates.length < 2) continue;
    const key = [edge.from, edge.to].sort().join('--');
    if (!uniqueEdges.has(key)) uniqueEdges.set(key, edge);
  }
  for (const edge of uniqueEdges.values()) {
    L.polyline(edge.path_coordinates, routeStyle(false))
      .bindTooltip(`${Math.round(edge.distance_m)} m · ${edge.walking_min} min`, { sticky: true })
      .addTo(networkLayer);
  }

  for (const node of nodes) {
    const category = node.type ?? node.category ?? 'landmark';
    const title = localized(node.name, currentLanguage, node.title ?? node.id);
    const marker = L.marker([node.lat, node.lng ?? node.lon], {
      icon: markerIcon(category),
      title,
      alt: title,
      riseOnHover: true,
    });
    marker.bindPopup(popupHtml(node, currentLanguage), { maxWidth: 320 });
    marker.on('popupopen', ({ popup }) => {
      popup.getElement()?.querySelector('[data-map-details]')?.addEventListener('click', () => onSelectNode?.(node.id));
    });
    marker.on('click', () => onSelectNode?.(node.id));
    marker.addTo(markerLayer);
    markers.set(node.id, marker);
  }

  map.on('locationerror', (event) => onLocationError?.(event));

  function showUserPosition(position) {
    userLayer.clearLayers();
    const latlng = [position.lat, position.lng];
    L.circle(latlng, {
      radius: Math.min(position.accuracy ?? 0, 150),
      className: 'user-accuracy',
    }).addTo(userLayer);
    L.circleMarker(latlng, { radius: 8, className: 'user-location' })
      .bindTooltip(currentLanguage === 'de' ? 'Dein Standort' : 'Your location')
      .addTo(userLayer);
  }

  return {
    map,
    showNode(id, { zoom = true, popup = false } = {}) {
      const marker = markers.get(id);
      if (!marker) return false;
      if (zoom) map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 16), { duration: 0.6 });
      if (popup) marker.openPopup();
      return true;
    },
    showRoute(edge) {
      routeLayer.clearLayers();
      if (!edge?.path_coordinates?.length) return false;
      const route = L.polyline(edge.path_coordinates, routeStyle(true)).addTo(routeLayer);
      route.bindTooltip(`${Math.round(edge.distance_m)} m · ${edge.walking_min} min`);
      map.fitBounds(route.getBounds(), { paddingTopLeft: [24, 130], paddingBottomRight: [24, 110], maxZoom: 17 });
      return true;
    },
    clearRoute() {
      routeLayer.clearLayers();
    },
    showUserPosition,
    fitPark() {
      if (!nodes.length) return;
      map.fitBounds(L.latLngBounds(nodes.map((node) => [node.lat, node.lng ?? node.lon])), { padding: [36, 36], maxZoom: 16 });
    },
    updateLanguage(nextLanguage) {
      currentLanguage = nextLanguage;
      for (const node of nodes) {
        const marker = markers.get(node.id);
        if (!marker) continue;
        const title = localized(node.name, currentLanguage, node.id);
        marker.options.title = title;
        marker.options.alt = title;
        marker.getElement()?.setAttribute('aria-label', title);
        marker.getElement()?.setAttribute('title', title);
        marker.setPopupContent(popupHtml(node, currentLanguage));
      }
    },
    invalidateSize() {
      map.invalidateSize();
    },
  };
}
