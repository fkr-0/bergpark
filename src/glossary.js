import { createDestinationIndex, searchDestinationIndex } from './destination-search.js';

function escapeHtml(value = '') {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

export function filterGlossary(nodes, query, language) {
  const index = createDestinationIndex({ entities: nodes, nodeIds: new Set(nodes.map(({ id }) => id)), language });
  return searchDestinationIndex(index, query, language, { limit: Number.POSITIVE_INFINITY }).results.map(({ item }) => item);
}

export function renderGlossary(container, {
  nodes,
  nodeIds,
  trees = [],
  visitorFeatures = [],
  i18n,
  onSelectNode,
  onSelectTree,
  onSelectFeature,
}) {
  const language = i18n.language;
  const previousQuery = container.querySelector('[data-destination-search]')?.value ?? '';
  const index = createDestinationIndex({ entities: nodes, nodeIds, trees, visitorFeatures, language });
  container.innerHTML = `
    <section class="panel-view" aria-labelledby="glossary-title">
      <header class="panel-view__header">
        <div><p class="detail-kicker">${i18n.t('destinationFinder')}</p><h2 id="glossary-title">${i18n.t('index')}</h2></div>
      </header>
      <label class="search-field"><span class="sr-only">${i18n.t('search')}</span><input data-destination-search type="search" placeholder="${i18n.t('searchPlaceholder')}" autocomplete="off" value="${escapeHtml(previousQuery)}"></label>
      <p class="destination-search-summary" role="status"></p>
      <div class="index-list" aria-live="polite"></div>
    </section>
  `;
  const input = container.querySelector('input');
  const summary = container.querySelector('.destination-search-summary');
  const list = container.querySelector('.index-list');

  function update() {
    const matches = searchDestinationIndex(index, input.value, language);
    summary.textContent = i18n.t('destinationResultCount', matches.results.length, matches.total);
    list.innerHTML = matches.results.length
      ? matches.results.map((result) => {
          const idAttribute = result.routeKind === 'place'
            ? `data-node-id="${escapeHtml(result.id)}"`
            : result.routeKind === 'tree'
              ? `data-tree-id="${escapeHtml(result.id)}"`
              : `data-feature-id="${escapeHtml(result.id)}"`;
          const context = [result.context, result.matchLabel && result.matchLabel !== result.context ? result.matchLabel : ''].filter(Boolean).join(' · ');
          return `<button type="button" data-destination-kind="${escapeHtml(result.routeKind)}" data-destination-id="${escapeHtml(result.id)}" data-spatial="${result.spatial ? 'true' : 'false'}" ${idAttribute}>
            <span class="destination-result__main"><strong>${escapeHtml(result.title)}</strong><small>${escapeHtml(result.kindLabel)}</small></span>
            ${context ? `<span class="destination-result__context">${escapeHtml(context)}</span>` : ''}
          </button>`;
        }).join('')
      : `<p class="empty-state">${i18n.t('noResults')}</p>`;
    for (const button of list.querySelectorAll('[data-destination-id]')) {
      button.addEventListener('click', () => {
        const result = index.find(({ id, routeKind }) => id === button.dataset.destinationId && routeKind === button.dataset.destinationKind);
        if (!result) return;
        if (result.routeKind === 'tree') onSelectTree?.(result.id, { source: 'search' });
        else if (result.routeKind === 'feature') onSelectFeature?.(result.item, { source: 'search' });
        else onSelectNode?.(result.id);
      });
    }
  }
  input.addEventListener('input', update);
  update();
}
