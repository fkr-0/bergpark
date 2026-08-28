import L from 'leaflet';
import { markerKeyboardActivation } from './leaflet-keyboard.js';
import { moveLeafletCamera } from './motion-policy.js';
import { firstAbsoluteHttpUrl } from './public-url.js';
import { clusterVisitorFeatures } from './visitor-layer-data.js';

function escapeHtml(value = '') {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function coordinate(feature) {
  const lat = Number(feature?.lat);
  const lng = Number(feature?.lng ?? feature?.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
}

const FAMILY_LABELS = {
  bench: { de: 'Bänke', en: 'Benches' },
  access: { de: 'Zugänge & Barrieren', en: 'Access & barriers' },
  toilet: { de: 'Toiletten', en: 'Toilets' },
  drinking_water: { de: 'Trinkwasser', en: 'Drinking water' },
  viewpoint: { de: 'Aussichtspunkte', en: 'Viewpoints' },
  shelter: { de: 'Unterstände', en: 'Shelters' },
  transit: { de: 'ÖPNV-Zugänge', en: 'Transit access' },
  artwork: { de: 'Kunstobjekte', en: 'Artworks' },
};

export function visitorFamilyLabel(kind, language = 'de') {
  return FAMILY_LABELS[kind]?.[language] ?? String(kind ?? 'visitor_poi').replaceAll('_', ' ');
}

export function visitorFeatureLabel(feature, language = 'de') {
  if (feature?.name) return feature.name;
  const family = visitorFamilyLabel(feature?.layerKind ?? feature?.family ?? 'visitor_poi', language);
  const sourceId = feature?.osm_node_id ?? feature?.osm_element?.id;
  return sourceId ? `${family} · ${sourceId}` : family;
}

export function createVisitorLayerController(map, layerData, { language = 'de', onSelectFeature } = {}) {
  const layer = L.layerGroup().addTo(map);
  let currentLanguage = language;
  let activeKinds = new Set();
  let focusedFeatures = null;

  function render() {
    layer.clearLayers();
    if (!activeKinds.size) return;
    const bounds = map.getBounds().pad(0.15);
    const zoom = map.getZoom();
    const source = focusedFeatures ?? layerData.features;
    const visible = source.filter((feature) => {
      const point = coordinate(feature);
      return activeKinds.has(feature.layerKind) && point && bounds.contains(point);
    });
    if (focusedFeatures && (zoom < 19 || !visible.length)) {
      focusedFeatures = null;
      render();
      return;
    }
    const effectiveZoom = visible.length > 180 && zoom >= 17 ? 16 : zoom;
    for (const item of clusterVisitorFeatures(visible, effectiveZoom)) {
      if (item.kind === 'feature') {
        const feature = item.feature;
        const label = visitorFeatureLabel(feature, currentLanguage);
        const icon = L.divIcon({
          className: `visitor-map-point visitor-map-point--${escapeHtml(feature.layerKind)}`,
          html: `<span aria-hidden="true">•</span><span class="sr-only">${escapeHtml(label)}</span>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });
        const activateFeature = () => onSelectFeature?.(feature);
        L.marker([item.lat, item.lng], { icon, title: label, alt: label, keyboard: true })
          .bindTooltip(label)
          .on('click', activateFeature)
          .on('keydown', markerKeyboardActivation(activateFeature))
          .addTo(layer);
      } else {
        const label = currentLanguage === 'de' ? `${item.count} Besucherobjekte` : `${item.count} visitor features`;
        const size = Math.min(36, 22 + Math.round(Math.log2(item.count + 1) * 2));
        const icon = L.divIcon({
          className: 'visitor-map-cluster',
          html: `<span aria-hidden="true">${item.count}</span><span class="sr-only">${escapeHtml(label)}</span>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        });
        const activateCluster = () => {
          if (zoom >= 19 && item.features?.length && item.features.length <= 180) {
            focusedFeatures = item.features;
            render();
            return;
          }
          focusedFeatures = null;
          moveLeafletCamera(map, [item.lat, item.lng], Math.min(19, zoom + 2), { duration: 0.35 });
        };
        L.marker([item.lat, item.lng], { icon, title: label, alt: label, keyboard: true })
          .on('click', activateCluster)
          .on('keydown', markerKeyboardActivation(activateCluster))
          .addTo(layer);
      }
    }
  }

  map.on('zoomend moveend', render);
  return {
    setActiveKinds(kinds) { focusedFeatures = null; activeKinds = new Set(kinds ?? []); render(); },
    updateLanguage(nextLanguage) { currentLanguage = nextLanguage; render(); },
    render,
    destroy() { map.off('zoomend moveend', render); layer.remove(); },
  };
}

export function renderVisitorLayerControl(container, { layerData, i18n, selectedKinds = [], onChange }) {
  const language = i18n.language;
  const selected = new Set(selectedKinds);
  const availableKinds = [
    ...(layerData.benches.length ? ['bench'] : []),
    ...[...new Set(layerData.pois.map((feature) => feature.layerKind))].sort(),
  ];
  container.innerHTML = `
    <summary>${escapeHtml(i18n.t('visitorLayers'))}</summary>
    <div class="visitor-layer-control__body">
      ${availableKinds.map((kind) => `<label><input type="checkbox" value="${escapeHtml(kind)}"${selected.has(kind) ? ' checked' : ''}> <span>${escapeHtml(visitorFamilyLabel(kind, language))}</span></label>`).join('')}
      ${layerData.status.benches === 'unavailable' ? `<p>${escapeHtml(i18n.t('benchesUnavailable'))}</p>` : ''}
      ${layerData.status.pois === 'unavailable' ? `<p>${escapeHtml(i18n.t('poisUnavailable'))}</p>` : ''}
      <small>${escapeHtml(i18n.t('visitorLayerScope'))}</small>
    </div>
  `;
  const emit = () => onChange?.([...container.querySelectorAll('input:checked')].map((input) => input.value));
  for (const input of container.querySelectorAll('input')) input.addEventListener('change', emit);
  emit();
}

export function renderVisitorFeatureDetail(container, { feature, i18n, onClose }) {
  const language = i18n.language;
  const kind = feature.layerKind ?? feature.family ?? 'visitor_poi';
  const label = visitorFeatureLabel(feature, language);
  const position = feature.position_source ?? {};
  const elevation = feature.elevation_source ?? {};
  const sourceLink = firstAbsoluteHttpUrl(feature.sourceRefs);
  const facts = kind === 'bench'
    ? [
        [language === 'de' ? 'Rückenlehne' : 'Backrest', feature.backrest],
        [language === 'de' ? 'Armlehne' : 'Armrest', feature.armrest],
        [language === 'de' ? 'Sitze' : 'Seats', feature.seats],
        [language === 'de' ? 'Material' : 'Material', feature.material],
        [language === 'de' ? 'Überdacht' : 'Covered', feature.covered],
      ]
    : Object.entries(feature.source_tags ?? {}).slice(0, 8).map(([key, value]) => [key.replaceAll('_', ' '), value]);
  const presentFacts = facts.filter(([, value]) => value != null && value !== '');
  container.hidden = false;
  container.innerHTML = `
    <div class="detail-sheet__handle" aria-hidden="true"></div>
    <div class="detail-sheet__header">
      <div><p class="detail-kicker">${escapeHtml(visitorFamilyLabel(kind, language))}</p><h2>${escapeHtml(label)}</h2></div>
      <button class="icon-button" data-action="close-visitor-feature" type="button" aria-label="${escapeHtml(i18n.t('close'))}">×</button>
    </div>
    <div class="detail-sheet__scroll visitor-feature-detail">
      ${presentFacts.length ? `<dl>${presentFacts.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>` : ''}
      ${Number.isFinite(feature.elevation_m) ? `<p><strong>${language === 'de' ? 'Geländehöhe' : 'Terrain elevation'}:</strong> ${feature.elevation_m.toFixed(0)} m</p>` : ''}
      <section class="detail-section tree-provenance"><h3>${language === 'de' ? 'Quelle & Abdeckung' : 'Source & coverage'}</h3>
        <p>${escapeHtml([position.provider, position.element, position.accuracy_status?.replaceAll('_', ' ')].filter(Boolean).join(' · '))}</p>
        ${elevation.provider ? `<p>${escapeHtml([elevation.provider, elevation.dataset, elevation.resolution_m ? `${elevation.resolution_m} m` : null].filter(Boolean).join(' · '))}</p>` : ''}
        <p class="uncertainty-note">${escapeHtml(i18n.t('visitorLayerScope'))}</p>
        ${sourceLink ? `<a href="${escapeHtml(sourceLink)}" target="_blank" rel="noreferrer">${language === 'de' ? 'Quellbeleg öffnen' : 'Open source evidence'}</a>` : ''}
      </section>
    </div>`;
  const close = container.querySelector('[data-action="close-visitor-feature"]');
  close?.addEventListener('click', () => onClose?.());
  close?.focus();
}
