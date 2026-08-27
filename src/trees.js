import { localized } from './i18n.js';

export const TREE_PAGE_SIZE = 60;

function escapeHtml(value = '') {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

export function treeResultPage(trees, limit = TREE_PAGE_SIZE) {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : TREE_PAGE_SIZE;
  const total = trees?.length ?? 0;
  const visible = (trees ?? []).slice(0, safeLimit);
  return { visible, total, hasMore: visible.length < total };
}

function coordinate(tree) {
  const rawLat = tree?.lat;
  const rawLng = tree?.lng ?? tree?.lon;
  if (rawLat == null || rawLng == null || rawLat === '' || rawLng === '') return null;
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
}

export function clusterTrees(trees, zoom = 15) {
  const valid = (trees ?? []).filter((tree) => coordinate(tree));
  if (zoom >= 17) return valid.map((tree) => {
    const [lat, lng] = coordinate(tree);
    return { kind: 'tree', tree, count: 1, lat, lng };
  });
  const cellSize = zoom <= 14 ? 0.004 : zoom === 15 ? 0.002 : 0.001;
  const buckets = new Map();
  for (const tree of valid) {
    const [lat, lng] = coordinate(tree);
    const key = `${Math.floor(lat / cellSize)}:${Math.floor(lng / cellSize)}`;
    const bucket = buckets.get(key) ?? { kind: 'cluster', trees: [], count: 0, lat: 0, lng: 0 };
    bucket.trees.push(tree);
    bucket.count += 1;
    bucket.lat += lat;
    bucket.lng += lng;
    buckets.set(key, bucket);
  }
  return [...buckets.values()].map((bucket) => ({ ...bucket, lat: bucket.lat / bucket.count, lng: bucket.lng / bucket.count }));
}

export function treeSpecies(tree, language) {
  if (typeof tree.species === 'string') return tree.species;
  return localized(tree.species, language, tree.species?.scientific ?? tree.species_de ?? tree.species_en ?? tree.taxon ?? '—');
}

export function treeLocation(tree) {
  return tree.location_description ?? tree.location?.description ?? tree.location ?? tree.park_sector ?? tree.sector ?? '';
}

const TREE_SECTOR_RULES = [
  ['loewenburg', /löwenburg|loewenburg|burgweg|burgwiese/i],
  ['water-axis', /herkules|kaskad|fontän|fontaen|neptun|aquädukt|aquaedukt|wasserfall/i],
  ['palace-lac', /schloss wilhelmshöhe|schloss wilhelmshoehe|bowlinggreen|\blac\b/i],
  ['apolloberg', /apolloberg|gewächshaus|gewaechshaus/i],
  ['mulang', /mulang|chines/i],
  ['north-east', /tulpenallee|gärtnerei|gaertnerei|waldschule|nordost|nordöst/i],
  ['roseninsel', /roseninsel/i],
];

export function treeSector(tree) {
  const explicit = tree.park_sector ?? tree.sector;
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  const location = treeLocation(tree);
  for (const [sector, pattern] of TREE_SECTOR_RULES) if (pattern.test(location)) return sector;
  return 'other-park';
}

export function treeSectorLabel(sector, language = 'de') {
  const labels = {
    'loewenburg': { de: 'Löwenburg & Burgwiesen', en: 'Löwenburg & castle meadows' },
    'water-axis': { de: 'Wasserkünste & Kaskaden', en: 'Water features & cascades' },
    'palace-lac': { de: 'Schloss, Bowlinggreen & Lac', en: 'Palace, Bowling Green & Lac' },
    'apolloberg': { de: 'Apolloberg & Gewächshaus', en: 'Apolloberg & greenhouse' },
    'mulang': { de: 'Mulang', en: 'Mulang' },
    'north-east': { de: 'Nordostpark & Tulpenallee', en: 'North-east park & Tulpenallee' },
    'roseninsel': { de: 'Roseninsel', en: 'Rose Island' },
    'other-park': { de: 'Weitere Parkbereiche', en: 'Other park areas' },
  };
  return localized(labels[sector], language, sector);
}

export function treeSignificance(tree) {
  return tree.significance ?? tree.denotation ?? 'catalogued';
}

export function treeCatalogueRef(tree) {
  return tree.catalog_ref ?? tree.catalogue_ref ?? tree.catalogRef ?? '';
}

export function treeDatasetState(trees, status = '') {
  if (!(trees ?? []).length) return 'pending';
  const normalized = String(status).toLowerCase();
  if (normalized.includes('complete') || normalized.includes('ready')) return 'ready';
  return 'partial';
}

export function filterTrees(trees, { query = '', species = 'all', location = 'all', significance = 'all', language = 'de' }) {
  const needle = query.trim().toLocaleLowerCase();
  return trees.filter((tree) => {
    const speciesName = treeSpecies(tree, language);
    const locationName = treeLocation(tree);
    const matchesQuery = !needle || [speciesName, localized(tree.name, language), localized(tree.description, language), treeCatalogueRef(tree), locationName]
      .filter(Boolean).join(' ').toLocaleLowerCase().includes(needle);
    const matchesSpecies = species === 'all' || speciesName === species;
    const matchesLocation = location === 'all' || treeSector(tree) === location;
    const matchesSignificance = significance === 'all' || treeSignificance(tree) === significance;
    return matchesQuery && matchesSpecies && matchesLocation && matchesSignificance;
  });
}

export function renderTreeExplorer(container, { trees, metadata, i18n, onSelectTree, onFilterChange }) {
  if (!trees.length) {
    onFilterChange?.([]);
    container.innerHTML = `<section class="panel-view empty-view"><div class="empty-view__glyph">♧</div><h2>${i18n.t('trees')}</h2><p>${i18n.t('treePending')}</p><small>${metadata.treeStatus ?? ''}</small></section>`;
    return;
  }
  const language = i18n.language;
  const species = [...new Set(trees.map((tree) => treeSpecies(tree, language)).filter(Boolean))].sort((a, b) => a.localeCompare(b, language));
  const sectors = [...new Set(trees.map(treeSector))].sort((a, b) => treeSectorLabel(a, language).localeCompare(treeSectorLabel(b, language), language));
  const significances = [...new Set(trees.map(treeSignificance))].sort();
  const partial = treeDatasetState(trees, metadata.treeStatus) === 'partial';

  container.innerHTML = `
    <section class="panel-view" aria-labelledby="trees-title">
      <header class="panel-view__header"><div><p class="detail-kicker">${trees.length}</p><h2 id="trees-title">${i18n.t('trees')}</h2></div></header>
      ${partial ? `<p class="dataset-status" role="status">${i18n.t('treePartial')}</p>` : ''}
      <div class="tree-filters">
        <input type="search" data-filter="query" placeholder="${i18n.t('treeSearch')}">
        <select data-filter="species" aria-label="${i18n.t('species')}"><option value="all">${i18n.t('allSpecies')}</option>${species.map((name) => `<option>${escapeHtml(name)}</option>`).join('')}</select>
        <select data-filter="location" aria-label="${i18n.t('treeLocation')}"><option value="all">${i18n.t('allTreeLocations')}</option>${sectors.map((sector) => `<option value="${escapeHtml(sector)}">${escapeHtml(treeSectorLabel(sector, language))}</option>`).join('')}</select>
        <select data-filter="significance" aria-label="${i18n.t('significance')}"><option value="all">${i18n.t('allSignificance')}</option>${significances.map((value) => `<option>${escapeHtml(value)}</option>`).join('')}</select>
      </div>
      <div class="tree-list" aria-live="polite"></div>
    </section>
  `;

  const list = container.querySelector('.tree-list');
  const controls = Object.fromEntries([...container.querySelectorAll('[data-filter]')].map((element) => [element.dataset.filter, element]));
  let visibleLimit = TREE_PAGE_SIZE;
  function update({ resetLimit = false } = {}) {
    if (resetLimit) visibleLimit = TREE_PAGE_SIZE;
    const matches = filterTrees(trees, {
      query: controls.query.value,
      species: controls.species.value,
      location: controls.location.value,
      significance: controls.significance.value,
      language,
    });
    onFilterChange?.(matches);
    const page = treeResultPage(matches, visibleLimit);
    list.innerHTML = matches.length ? `
      <p class="tree-results-summary" role="status">${escapeHtml(i18n.t('treeResultCount', page.visible.length, page.total))}</p>
      ${page.visible.map((tree) => `
      <button type="button" data-tree-id="${escapeHtml(tree.id)}">
        <strong>${escapeHtml(localized(tree.name, language, treeSpecies(tree, language)))}</strong>
        <span>${escapeHtml(treeSpecies(tree, language))}</span>
        <small>${escapeHtml(treeCatalogueRef(tree) || treeSignificance(tree))}</small>
        ${treeLocation(tree) ? `<span>${escapeHtml(treeLocation(tree))}</span>` : ''}
      </button>
      `).join('')}
      ${page.hasMore ? `<button class="tree-more-button" type="button" data-action="more-trees">${escapeHtml(i18n.t('moreTrees'))}</button>` : ''}
    ` : `<p class="empty-state">${i18n.t('noResults')}</p>`;
    for (const button of list.querySelectorAll('[data-tree-id]')) button.addEventListener('click', () => onSelectTree?.(button.dataset.treeId, { source: 'list' }));
    list.querySelector('[data-action="more-trees"]')?.addEventListener('click', () => {
      visibleLimit += TREE_PAGE_SIZE;
      update();
      list.querySelector('[data-action="more-trees"]')?.focus();
    });
  }
  for (const control of Object.values(controls)) {
    control.addEventListener(control.tagName === 'INPUT' ? 'input' : 'change', () => update({ resetLimit: true }));
  }
  update();
}
