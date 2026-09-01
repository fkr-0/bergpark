import { createDestinationIndex, searchDestinationIndex } from './destination-search.js';
import { createNetworkDiscoveryIndex, searchNetworkDiscovery } from './discovery.js';
import { createCompanionAlmanac, searchCompanionAlmanac } from './companion-almanac.js';

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
  walkingNetwork = null,
  i18n,
  onSelectNode,
  onSelectTree,
  onSelectFeature,
  onSelectNetwork,
}) {
  const language = i18n.language;
  const previousQuery = container.querySelector('[data-destination-search]')?.value ?? '';
  const previousCategory = container.querySelector('[data-destination-filter]')?.value ?? 'all';
  const previousNetworkQuery = container.querySelector('[data-network-search]')?.value ?? '';
  const previousNetworkKind = container.querySelector('[data-network-filter]')?.value ?? 'all';
  const networkWasOpen = container.querySelector('[data-network-discovery]')?.open ?? false;
  const almanac = createCompanionAlmanac({ entities: nodes, nodeIds, trees, visitorFeatures, language });
  let walkAlmanac = null;
  const ensureWalkAlmanac = () => {
    if (!walkingNetwork) return almanac;
    walkAlmanac ??= createCompanionAlmanac({
      entities: nodes,
      nodeIds,
      trees,
      visitorFeatures,
      walkingNetwork,
      language,
    });
    return walkAlmanac;
  };
  container.innerHTML = `
    <section class="panel-view" aria-labelledby="glossary-title">
      <header class="panel-view__header">
        <div><p class="detail-kicker">${i18n.t('destinationFinder')}</p><h2 id="glossary-title">${i18n.t('almanac')}</h2></div>
      </header>
      <p class="almanac-intro">${escapeHtml(i18n.t('almanacIntro'))}</p>
      <div class="almanac-controls">
        <label class="search-field"><span class="sr-only">${i18n.t('search')}</span><input data-destination-search type="search" placeholder="${i18n.t('searchPlaceholder')}" autocomplete="off" value="${escapeHtml(previousQuery)}"></label>
        <label><span class="sr-only">${escapeHtml(i18n.t('almanacFilter'))}</span><select data-destination-filter aria-label="${escapeHtml(i18n.t('almanacFilter'))}">
          <option value="all">${escapeHtml(i18n.t('almanacAll'))}</option>
          <option value="place">${escapeHtml(i18n.t('almanacPlaces'))}</option>
          <option value="story">${escapeHtml(i18n.t('almanacStories'))}</option>
          <option value="tree">${escapeHtml(i18n.t('almanacTrees'))}</option>
          <option value="feature">${escapeHtml(i18n.t('almanacFeatures'))}</option>
          <option value="walk">${escapeHtml(i18n.t('pathNetwork'))}</option>
        </select></label>
      </div>
      <p class="destination-search-summary" role="status"></p>
      <div class="index-list" aria-live="polite"></div>
      ${walkingNetwork ? `
        <details class="network-discovery" data-network-discovery>
          <summary><span>${escapeHtml(i18n.t('pathNetwork'))}</span><small>${escapeHtml(i18n.t('pathNetworkCount', walkingNetwork.segments?.length ?? 0))}</small></summary>
          <p>${escapeHtml(i18n.t('pathNetworkIntro'))}</p>
          <div class="network-controls">
            <label class="search-field"><span class="sr-only">${escapeHtml(i18n.t('pathNetworkSearch'))}</span><input data-network-search type="search" placeholder="${escapeHtml(i18n.t('pathNetworkSearch'))}" autocomplete="off" value="${escapeHtml(previousNetworkQuery)}"></label>
            <label><span class="sr-only">${escapeHtml(i18n.t('pathNetworkFilter'))}</span><select data-network-filter aria-label="${escapeHtml(i18n.t('pathNetworkFilter'))}">
              <option value="all">${escapeHtml(i18n.t('pathNetworkAll'))}</option>
              <option value="junction">${escapeHtml(i18n.t('pathNetworkJunctions'))}</option>
              <option value="steps">${escapeHtml(i18n.t('pathNetworkSteps'))}</option>
              <option value="path">${escapeHtml(i18n.t('pathNetworkPaths'))}</option>
            </select></label>
          </div>
          <p class="network-search-summary" role="status"></p>
          <div class="network-list" aria-live="polite"></div>
        </details>
      ` : `<p class="network-loading" role="status">${escapeHtml(i18n.t('pathNetworkLoading'))}</p>`}
    </section>
  `;
  const input = container.querySelector('input');
  const filter = container.querySelector('[data-destination-filter]');
  const summary = container.querySelector('.destination-search-summary');
  const list = container.querySelector('.index-list');
  if (filter) filter.value = previousCategory;

  function update() {
    const category = filter?.value ?? 'all';
    const activeAlmanac = category === 'walk' ? ensureWalkAlmanac() : almanac;
    const matches = searchCompanionAlmanac(activeAlmanac, input.value, language, { category });
    summary.textContent = category === 'walk'
      ? (walkingNetwork
        ? i18n.t('pathNetworkResultCount', matches.results.length, matches.total)
        : i18n.t('pathNetworkLoading'))
      : i18n.t('destinationResultCount', matches.results.length, matches.total);
    list.innerHTML = matches.results.length
      ? matches.results.map((result) => {
          const idAttribute = result.routeKind === 'place'
            ? `data-node-id="${escapeHtml(result.id)}"`
            : result.routeKind === 'tree'
              ? `data-tree-id="${escapeHtml(result.id)}"`
              : result.routeKind === 'feature'
                ? `data-feature-id="${escapeHtml(result.id)}"`
                : `data-network-id="${escapeHtml(result.id)}"`;
          const context = [result.context, result.matchLabel && result.matchLabel !== result.context ? result.matchLabel : ''].filter(Boolean).join(' · ');
          return `<button type="button" data-destination-kind="${escapeHtml(result.routeKind)}" data-destination-id="${escapeHtml(result.id)}" data-spatial="${result.spatial ? 'true' : 'false'}" ${idAttribute}>
            <span class="destination-result__main"><strong>${escapeHtml(result.title)}</strong><small>${escapeHtml(result.kindLabel)}</small></span>
            ${context ? `<span class="destination-result__context">${escapeHtml(context)}</span>` : ''}
          </button>`;
        }).join('')
      : `<p class="empty-state">${i18n.t('noResults')}</p>`;
    for (const button of list.querySelectorAll('[data-destination-id]')) {
      button.addEventListener('click', () => {
        const result = activeAlmanac.entries.find(({ id, routeKind }) => id === button.dataset.destinationId && routeKind === button.dataset.destinationKind);
        if (!result) return;
        if (result.routeKind === 'tree') onSelectTree?.(result.id, { source: 'search' });
        else if (result.routeKind === 'feature') onSelectFeature?.(result.item, { source: 'search' });
        else if (result.routeKind === 'network') onSelectNetwork?.(result.networkDiscovery);
        else onSelectNode?.(result.id);
      });
    }
  }
  input.addEventListener('input', update);
  filter?.addEventListener('change', update);
  update();

  const networkDetails = container.querySelector('[data-network-discovery]');
  if (networkDetails) {
    networkDetails.open = networkWasOpen;
    const networkInput = networkDetails.querySelector('[data-network-search]');
    const networkFilter = networkDetails.querySelector('[data-network-filter]');
    const networkSummary = networkDetails.querySelector('.network-search-summary');
    const networkList = networkDetails.querySelector('.network-list');
    networkFilter.value = previousNetworkKind;
    let networkIndex = null;
    let networkInitialized = false;

    const ensureNetworkIndex = () => {
      networkIndex ??= createNetworkDiscoveryIndex(walkingNetwork, language);
      return networkIndex;
    };

    function updateNetwork() {
      const activeNetworkIndex = ensureNetworkIndex();
      const matches = searchNetworkDiscovery(activeNetworkIndex, {
        query: networkInput.value,
        kind: networkFilter.value,
      });
      networkSummary.textContent = i18n.t('pathNetworkResultCount', matches.results.length, matches.total);
      networkList.innerHTML = matches.results.length
        ? matches.results.map((result) => `<button type="button" data-network-id="${escapeHtml(result.id)}">
            <span><strong>${escapeHtml(result.title)}</strong><small>${escapeHtml(result.id)}</small></span>
            <span>${escapeHtml(result.context)}</span>
          </button>`).join('')
        : `<p class="empty-state">${escapeHtml(i18n.t('noResults'))}</p>`;
      for (const button of networkList.querySelectorAll('[data-network-id]')) {
        button.addEventListener('click', () => {
          const result = activeNetworkIndex.find(({ id }) => id === button.dataset.networkId);
          if (result) onSelectNetwork?.(result);
        });
      }
    }
    const initializeNetwork = () => {
      if (networkInitialized) return;
      networkInitialized = true;
      networkInput.addEventListener('input', updateNetwork);
      networkFilter.addEventListener('change', updateNetwork);
      updateNetwork();
    };
    networkDetails.addEventListener('toggle', () => {
      if (networkDetails.open) initializeNetwork();
    });
    if (networkWasOpen) initializeNetwork();
  }
}
