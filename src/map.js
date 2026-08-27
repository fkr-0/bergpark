import L from 'leaflet';

const PARK_CENTER = [51.3167, 9.4167];

function markerIcon(category = 'landmark') {
  const glyph = category === 'water' ? '≈' : category === 'castle' ? '♜' : '●';
  return L.divIcon({
    className: 'bergpark-marker-wrap',
    html: `<span class="bergpark-marker bergpark-marker--${category}" aria-hidden="true">${glyph}</span>`,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
    popupAnchor: [0, -19],
  });
}

export function createBergparkMap(element, nodes) {
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

  for (const node of nodes) {
    const marker = L.marker([node.lat, node.lon], {
      icon: markerIcon(node.category),
      title: node.title,
      alt: node.title,
      riseOnHover: true,
    });
    marker.bindPopup(`
      <article class="marker-popup">
        <p class="marker-popup__kind">${node.kind ?? node.category ?? 'Ort'}</p>
        <h2>${node.title}</h2>
        <p>${node.summary ?? ''}</p>
        <button type="button" disabled aria-label="Details folgen in Phase 2">Details · bald verfügbar</button>
      </article>
    `, { maxWidth: 300 });
    marker.addTo(map);
  }

  let userMarker;
  let accuracyCircle;
  map.on('locationfound', ({ latlng, accuracy }) => {
    if (userMarker) map.removeLayer(userMarker);
    if (accuracyCircle) map.removeLayer(accuracyCircle);
    userMarker = L.circleMarker(latlng, { radius: 8, className: 'user-location' }).addTo(map).bindPopup('Dein Standort');
    accuracyCircle = L.circle(latlng, { radius: Math.min(accuracy, 150), className: 'user-accuracy' }).addTo(map);
  });
  map.on('locationerror', () => {
    document.querySelector('.map-hint').textContent = 'Standort nicht verfügbar — die Karte funktioniert weiterhin manuell.';
  });

  return {
    locate() {
      map.locate({ setView: true, maxZoom: 17, enableHighAccuracy: true, timeout: 10000 });
    },
    map,
  };
}
