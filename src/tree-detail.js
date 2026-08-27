import { localized } from './i18n.js';
import { treeCatalogueRef, treeLocation, treeSignificance, treeSpecies } from './trees.js';

function escapeHtml(value = '') {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

export function publicHttpUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function firstPublicHttpUrl(values = []) {
  return values.map(publicHttpUrl).find(Boolean) ?? null;
}

function sourceSummary(source) {
  if (!source || typeof source !== 'object') return null;
  return {
    provider: source.provider ?? null,
    element: source.element ?? source.dataset ?? null,
    sourceTimestamp: source.source_timestamp ?? source.retrieved_at ?? null,
    accuracyStatus: source.accuracy_status ?? null,
    resolutionM: Number.isFinite(source.resolution_m) ? source.resolution_m : null,
  };
}

export function treeDetailModel(tree, language = 'de') {
  const species = treeSpecies(tree, language);
  const titleFallback = species && species !== '—' ? species : treeCatalogueRef(tree) || tree?.id || '';
  return {
    id: tree?.id ?? '',
    title: localized(tree?.name, language, titleFallback),
    species,
    scientificName: tree?.species?.scientific ?? tree?.taxon ?? null,
    catalogueRef: treeCatalogueRef(tree) || null,
    location: treeLocation(tree) || null,
    significance: treeSignificance(tree) || null,
    description: localized(tree?.description, language, typeof tree?.description === 'string' ? tree.description : ''),
    imageUrl: tree?.image ?? null,
    commonsCategory: tree?.wikimedia_commons ?? null,
    elevationM: Number.isFinite(tree?.elevation_m) ? tree.elevation_m : null,
    heightM: Number.isFinite(tree?.height_m) ? tree.height_m : null,
    heightStatus: tree?.height_status ?? null,
    positionSource: sourceSummary(tree?.position_source),
    elevationSource: sourceSummary(tree?.elevation_source),
    sourceRefs: Array.isArray(tree?.source_refs) ? tree.source_refs.filter(Boolean) : [],
  };
}

function renderSourceSummary(source, language, kind) {
  if (!source) return '';
  const label = kind === 'position'
    ? (language === 'de' ? 'Positionsquelle' : 'Position source')
    : (language === 'de' ? 'Höhenquelle' : 'Elevation source');
  const parts = [source.provider, source.element].filter(Boolean);
  if (source.resolutionM != null) parts.push(`${source.resolutionM} m ${language === 'de' ? 'Raster' : 'grid'}`);
  if (source.accuracyStatus) parts.push(source.accuracyStatus.replaceAll('_', ' '));
  return parts.length ? `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(parts.join(' · '))}</dd></div>` : '';
}

export function renderTreeDetail(container, { tree, i18n, onClose }) {
  const language = i18n.language;
  const model = treeDetailModel(tree, language);
  const imageUrl = publicHttpUrl(model.imageUrl);
  const sourceLink = firstPublicHttpUrl(model.sourceRefs);
  const unknownHeight = model.heightM == null && model.heightStatus;

  container.hidden = false;
  container.innerHTML = `
    <div class="detail-sheet__handle" aria-hidden="true"></div>
    <div class="detail-sheet__header">
      <div><p class="detail-kicker">${language === 'de' ? 'Katalogbaum' : 'Catalogued tree'}</p><h2>${escapeHtml(model.title)}</h2></div>
      <button class="icon-button" data-action="close-tree" type="button" aria-label="${escapeHtml(i18n.t('close'))}">×</button>
    </div>
    <div class="detail-sheet__scroll tree-detail">
      <dl class="tree-detail__facts">
        ${model.catalogueRef ? `<div><dt>${language === 'de' ? 'Katalog' : 'Catalogue'}</dt><dd>${escapeHtml(model.catalogueRef)}</dd></div>` : ''}
        ${model.species ? `<div><dt>${language === 'de' ? 'Art' : 'Species'}</dt><dd>${escapeHtml(model.species)}${model.scientificName && model.scientificName !== model.species ? `<small>${escapeHtml(model.scientificName)}</small>` : ''}</dd></div>` : ''}
        ${model.location ? `<div><dt>${language === 'de' ? 'Lagebeschreibung' : 'Location note'}</dt><dd>${escapeHtml(model.location)}</dd></div>` : ''}
        ${model.significance ? `<div><dt>${language === 'de' ? 'Katalogstatus' : 'Catalogue status'}</dt><dd>${escapeHtml(model.significance)}</dd></div>` : ''}
        ${model.elevationM != null ? `<div><dt>${language === 'de' ? 'Geländehöhe' : 'Terrain elevation'}</dt><dd>${model.elevationM.toFixed(0)} m</dd></div>` : ''}
        ${model.heightM != null ? `<div><dt>${language === 'de' ? 'Baumhöhe' : 'Tree height'}</dt><dd>${model.heightM.toFixed(1)} m</dd></div>` : ''}
        ${unknownHeight ? `<div><dt>${language === 'de' ? 'Baumhöhe' : 'Tree height'}</dt><dd>${language === 'de' ? 'Nicht aus einer Messquelle belegt' : 'Not established by a measurement source'}</dd></div>` : ''}
      </dl>
      ${model.description ? `<section class="detail-section"><h3>${language === 'de' ? 'Katalogbeschreibung' : 'Catalogue description'}</h3><p>${escapeHtml(model.description)}</p></section>` : ''}
      ${imageUrl ? `<p><a class="tree-image-link" href="${escapeHtml(imageUrl)}" target="_blank" rel="noreferrer">${language === 'de' ? 'Bildnachweis bei Wikimedia Commons öffnen' : 'Open image record on Wikimedia Commons'}</a></p>` : ''}
      <section class="detail-section tree-provenance" aria-label="${language === 'de' ? 'Provenienz' : 'Provenance'}">
        <h3>${language === 'de' ? 'Quelle & Genauigkeit' : 'Source & accuracy'}</h3>
        <dl>${renderSourceSummary(model.positionSource, language, 'position')}${renderSourceSummary(model.elevationSource, language, 'elevation')}</dl>
        <p class="uncertainty-note">${language === 'de'
          ? 'Die Kartenposition und die Geländehöhe stammen aus den angegebenen Quellen. Fehlende Messwerte werden nicht aus Artenbeschreibungen abgeleitet.'
          : 'The mapped position and terrain elevation come from the stated sources. Missing measurements are not inferred from species descriptions.'}</p>
        ${sourceLink ? `<a href="${escapeHtml(sourceLink)}" target="_blank" rel="noreferrer">${language === 'de' ? 'Primären Karten-/Katalogbeleg öffnen' : 'Open primary map/catalogue evidence'}</a>` : ''}
      </section>
    </div>
  `;
  const close = container.querySelector('[data-action="close-tree"]');
  close?.addEventListener('click', () => onClose?.());
  close?.focus();
}
