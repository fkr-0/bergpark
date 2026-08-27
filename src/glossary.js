import { localized } from './i18n.js';

function escapeHtml(value = '') {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function normalize(value) {
  return value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase();
}

export function filterGlossary(nodes, query, language) {
  const needle = normalize(query.trim());
  return nodes
    .filter((node) => {
      if (!needle) return true;
      const haystack = [
        localized(node.name, language),
        localized(node.description, language),
        node.type,
        ...(node.aliases ?? []),
        ...(node.searchTerms ?? []),
        ...(node.roles ?? []),
        node.object_type,
      ].filter(Boolean).join(' ');
      return normalize(haystack).includes(needle);
    })
    .sort((a, b) => localized(a.name, language).localeCompare(localized(b.name, language), language));
}

export function renderGlossary(container, { nodes, i18n, onSelectNode }) {
  const language = i18n.language;
  container.innerHTML = `
    <section class="panel-view" aria-labelledby="glossary-title">
      <header class="panel-view__header">
        <div><p class="detail-kicker">A–Z</p><h2 id="glossary-title">${i18n.t('index')}</h2></div>
      </header>
      <label class="search-field"><span class="sr-only">${i18n.t('search')}</span><input type="search" placeholder="${i18n.t('searchPlaceholder')}" autocomplete="off"></label>
      <div class="index-list" aria-live="polite"></div>
    </section>
  `;
  const input = container.querySelector('input');
  const list = container.querySelector('.index-list');

  function update() {
    const matches = filterGlossary(nodes, input.value, language);
    list.innerHTML = matches.length
      ? matches.map((node) => `<button type="button" data-node-id="${escapeHtml(node.id)}"><span>${escapeHtml(localized(node.name, language, node.id))}</span><small>${escapeHtml((node.type ?? '').replaceAll('_', ' '))}${node.roles?.length ? ` · ${escapeHtml(node.roles.join(', ').replaceAll('_', ' '))}` : ''}</small></button>`).join('')
      : `<p class="empty-state">${i18n.t('noResults')}</p>`;
    for (const button of list.querySelectorAll('[data-node-id]')) {
      button.addEventListener('click', () => onSelectNode(button.dataset.nodeId));
    }
  }
  input.addEventListener('input', update);
  update();
}
