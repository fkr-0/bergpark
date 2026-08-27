import { localized } from './i18n.js';

function escapeHtml(value = '') {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function treeSpecies(tree, language) {
  return localized(tree.species, language, tree.species_de ?? tree.species_en ?? tree.taxon ?? '—');
}

export function filterTrees(trees, { query = '', species = 'all', significance = 'all', language = 'de' }) {
  const needle = query.trim().toLocaleLowerCase();
  return trees.filter((tree) => {
    const speciesName = treeSpecies(tree, language);
    const matchesQuery = !needle || [speciesName, localized(tree.name, language), localized(tree.description, language), tree.catalogue_ref]
      .filter(Boolean).join(' ').toLocaleLowerCase().includes(needle);
    const matchesSpecies = species === 'all' || speciesName === species;
    const treeSignificance = tree.significance ?? tree.denotation ?? 'catalogued';
    const matchesSignificance = significance === 'all' || treeSignificance === significance;
    return matchesQuery && matchesSpecies && matchesSignificance;
  });
}

export function renderTreeExplorer(container, { trees, metadata, i18n, onSelectTree }) {
  if (!trees.length) {
    container.innerHTML = `<section class="panel-view empty-view"><div class="empty-view__glyph">♧</div><h2>${i18n.t('trees')}</h2><p>${i18n.t('treePending')}</p><small>${metadata.treeStatus ?? ''}</small></section>`;
    return;
  }
  const language = i18n.language;
  const species = [...new Set(trees.map((tree) => treeSpecies(tree, language)).filter(Boolean))].sort((a, b) => a.localeCompare(b, language));
  const significances = [...new Set(trees.map((tree) => tree.significance ?? tree.denotation ?? 'catalogued'))].sort();

  container.innerHTML = `
    <section class="panel-view" aria-labelledby="trees-title">
      <header class="panel-view__header"><div><p class="detail-kicker">${trees.length}</p><h2 id="trees-title">${i18n.t('trees')}</h2></div></header>
      <div class="tree-filters">
        <input type="search" data-filter="query" placeholder="${i18n.t('treeSearch')}">
        <select data-filter="species" aria-label="${i18n.t('species')}"><option value="all">${i18n.t('allSpecies')}</option>${species.map((name) => `<option>${escapeHtml(name)}</option>`).join('')}</select>
        <select data-filter="significance" aria-label="${i18n.t('significance')}"><option value="all">${i18n.t('allSignificance')}</option>${significances.map((value) => `<option>${escapeHtml(value)}</option>`).join('')}</select>
      </div>
      <div class="tree-list" aria-live="polite"></div>
    </section>
  `;

  const list = container.querySelector('.tree-list');
  const controls = Object.fromEntries([...container.querySelectorAll('[data-filter]')].map((element) => [element.dataset.filter, element]));
  function update() {
    const matches = filterTrees(trees, {
      query: controls.query.value,
      species: controls.species.value,
      significance: controls.significance.value,
      language,
    });
    list.innerHTML = matches.length ? matches.map((tree) => `
      <button type="button" data-tree-id="${escapeHtml(tree.id)}">
        <strong>${escapeHtml(localized(tree.name, language, treeSpecies(tree, language)))}</strong>
        <span>${escapeHtml(treeSpecies(tree, language))}</span>
        <small>${escapeHtml(tree.catalogue_ref ?? tree.significance ?? tree.denotation ?? '')}</small>
      </button>
    `).join('') : `<p class="empty-state">${i18n.t('noResults')}</p>`;
    for (const button of list.querySelectorAll('[data-tree-id]')) button.addEventListener('click', () => onSelectTree?.(button.dataset.treeId));
  }
  for (const control of Object.values(controls)) control.addEventListener(control.tagName === 'INPUT' ? 'input' : 'change', update);
  update();
}
