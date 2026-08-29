import { localized } from './i18n.js';
import { semanticRelationLabel } from './semantic.js';
import { createNarrationDescriptor, createSpeechNarrator } from './audio-guide.js';
import { connectedRouteOptions, routeAccessSummary, routeSurfaceSummary } from './discovery.js';

const speechNarrator = createSpeechNarrator();

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderArtworkContext(node, graph, language) {
  const context = localizedStructured(node.artworkContext, language, null);
  if (!context || typeof context !== 'object') return '';
  const artwork = context.semanticArtworkId ? graph?.entitiesById?.get(context.semanticArtworkId) : null;
  const artworkName = artwork ? localized(artwork.name, language, artwork.id) : null;
  const heading = language === 'de' ? 'Werkbezug' : 'Artwork context';
  const status = context.attributionStatus?.replaceAll('-', ' ');
  return `<section class="detail-section artwork-context"><h3>${heading}</h3>
    ${artworkName ? `<button type="button" class="semantic-link" data-semantic-id="${escapeHtml(artwork.id)}"><strong>${escapeHtml(artworkName)}</strong></button>` : ''}
    ${context.attribution ? `<p>${escapeHtml(context.attribution)}</p>` : ''}
    ${status ? `<small>${escapeHtml(status)}</small>` : ''}
  </section>`;
}

function renderSemanticLinks(node, graph, language) {
  const relations = graph.semanticRelationsByEntity?.get(node.id) ?? [];
  if (!relations.length) return '';
  const orderedRelations = relations
    .map((edge, index) => {
      const otherId = edge.from === node.id ? edge.to : edge.from;
      const other = graph.entitiesById.get(otherId) ?? graph.nodesById.get(otherId);
      return other ? { edge, other, index } : null;
    })
    .filter(Boolean)
    .sort((left, right) => {
      const leftPerson = left.other.kind === 'historical_figure' || left.other.type === 'historical_figure' ? 0 : 1;
      const rightPerson = right.other.kind === 'historical_figure' || right.other.type === 'historical_figure' ? 0 : 1;
      return leftPerson - rightPerson || left.index - right.index;
    });
  const rows = orderedRelations.map(({ edge, other }) => {
    const direction = edge.from === node.id ? 'outgoing' : 'incoming';
    const relation = semanticRelationLabel(edge, language);
    const otherName = localized(other.name, language, other.id);
    const phrase = direction === 'outgoing'
      ? `${relation} ${otherName}`
      : `${otherName} · ${relation}`;
    const evidence = [
      edge.confidence ? `${language === 'de' ? 'Evidenz' : 'Evidence'}: ${edge.confidence}` : '',
      edge.provenance?.assertion ? `${language === 'de' ? 'Beleg' : 'Assertion'}: ${edge.provenance.assertion}` : '',
      edge.provenance?.qualification ? `${language === 'de' ? 'Einordnung' : 'Qualification'}: ${edge.provenance.qualification}` : '',
      edge.sources?.length
        ? `${language === 'de' ? 'Quelle' : 'Source'}: ${edge.sources.map((source) => localized(source.title, language, source.publisher ?? source.id)).join('; ')}`
        : '',
    ].filter(Boolean);
    return `<button type="button" class="semantic-link" data-semantic-id="${escapeHtml(other.id)}"><strong>${escapeHtml(phrase)}</strong>${evidence.map((line) => `<small>${escapeHtml(line)}</small>`).join('')}</button>`;
  }).join('');
  return rows ? `<section class="detail-section"><h3>${language === 'de' ? 'Historische Bezüge' : 'Historical connections'}</h3><div class="semantic-links">${rows}</div></section>` : '';
}

function renderSemanticFacts(node, graph, language) {
  const entityName = (id) => {
    const entity = graph?.entitiesById?.get(id) ?? graph?.nodesById?.get(id);
    return entity ? localized(entity.name, language, id) : id;
  };
  const facts = [];
  if (node.roles?.length) facts.push([language === 'de' ? 'Rollen' : 'Roles', node.roles.join(', ').replaceAll('_', ' ')]);
  if (node.object_type) facts.push([language === 'de' ? 'Objekttyp' : 'Object type', node.object_type.replaceAll('_', ' ')]);
  if (node.creator_id) facts.push([language === 'de' ? 'Urheber' : 'Creator', entityName(node.creator_id)]);
  if (node.current_place_id) facts.push([language === 'de' ? 'Ortsbezug' : 'Place reference', entityName(node.current_place_id)]);
  if (!facts.length) return '';
  return `<section class="detail-section semantic-facts"><h3>${language === 'de' ? 'Einordnung' : 'Context'}</h3><dl>${facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl></section>`;
}

function safeImageUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.href);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function contentSections(node, language) {
  const candidates = [
    ['history', language === 'de' ? 'Geschichte' : 'History'],
    ['architecture', language === 'de' ? 'Architektur & Gestaltung' : 'Architecture & design'],
    ['significance', language === 'de' ? 'Bedeutung' : 'Significance'],
    ['restorationHistory', language === 'de' ? 'Erhaltung & Restaurierung' : 'Conservation & restoration'],
    ['visitorContext', language === 'de' ? 'Vor Ort' : 'On site'],
  ];
  return candidates
    .map(([key, heading]) => ({ heading, text: localized(node[key], language) }))
    .filter(({ text }) => Boolean(text));
}

function localizedStructured(value, language, fallback) {
  if (!value) return fallback;
  if (Array.isArray(value)) return value;
  return value[language] ?? value.de ?? value.en ?? fallback;
}

export function stopNarration(options = {}) {
  return speechNarrator.stop(options);
}

export function narrateNode(node, language, options = {}) {
  const descriptor = createNarrationDescriptor(node, language);
  return speechNarrator.play(descriptor, options);
}

function narrationTranscriptMarkup(descriptor, i18n) {
  if (!descriptor?.transcript?.length) return '';
  return `<details class="narration-transcript" data-narration-transcript>
    <summary>${escapeHtml(i18n.t('transcript'))}</summary>
    <div>${descriptor.transcript.map(({ heading, text }) => `${heading ? `<h3>${escapeHtml(heading)}</h3>` : ''}<p>${escapeHtml(text)}</p>`).join('')}</div>
  </details>`;
}

function compactRouteMetrics(evidence, i18n) {
  const values = [];
  if (evidence.walkingMin != null) values.push(`${evidence.walkingMin} ${i18n.t('minutes')}`);
  if (evidence.distanceM != null) values.push(`${Math.round(evidence.distanceM)} ${i18n.t('metres')}`);
  if (evidence.ascentM != null) values.push(`↑ ${Math.round(evidence.ascentM)} ${i18n.t('metres')}`);
  return values.join(' · ');
}

function routeCardsMarkup(options, language, i18n) {
  return options.map((option) => `<article class="connection-card" data-route-option="${escapeHtml(option.id)}">
    <button type="button" data-node-id="${escapeHtml(option.toId)}">
      <strong>${escapeHtml(option.title)}</strong>
      <span class="route-option__metrics">${escapeHtml(compactRouteMetrics(option.evidence, i18n))}</span>
      <span class="route-option__evidence">${escapeHtml(routeAccessSummary(option.evidence, language))} · ${escapeHtml(routeSurfaceSummary(option.evidence, language))}</span>
    </button>
    <button type="button" class="route-button" data-route-to="${escapeHtml(option.toId)}">${escapeHtml(i18n.t('navigate'))}</button>
  </article>`).join('');
}

function renderGallery(node, language) {
  const gallery = localizedStructured(node.images, language, node.gallery ?? []);
  const items = (Array.isArray(gallery) ? gallery : []).slice(0, 8);
  if (!items.length) return '';
  return `
    <div class="detail-gallery" aria-label="${language === 'de' ? 'Bildergalerie' : 'Image gallery'}">
      ${items.map((image) => {
        const safeSrc = safeImageUrl(image.src ?? image.url);
        const pageUrl = safeImageUrl(image.pageUrl);
        const caption = localized(image.caption, language, localized(image.alt, language, localized(node.name, language)));
        if (safeSrc) {
          return `<figure>
            <img src="${escapeHtml(safeSrc)}" alt="${escapeHtml(caption)}" loading="lazy" decoding="async">
            ${caption || image.credit ? `<figcaption>${escapeHtml(caption || localized(image.credit, language, image.credit))}</figcaption>` : ''}
          </figure>`;
        }
        if (pageUrl) {
          return `<a class="gallery-placeholder" href="${escapeHtml(pageUrl)}" target="_blank" rel="noreferrer"><span aria-hidden="true">▧</span><strong>${escapeHtml(caption)}</strong><small>Wikimedia Commons</small></a>`;
        }
        return '';
      }).join('')}
    </div>
  `;
}

function renderArtworks(node, language) {
  const artworks = localizedStructured(node.artworks, language, []);
  if (!Array.isArray(artworks) || !artworks.length) return '';
  return `<section class="detail-section"><h3>${language === 'de' ? 'Kunst & Figuren' : 'Art & figures'}</h3><div class="artwork-list">${artworks.map((artwork) => `
    <article><strong>${escapeHtml(artwork.name ?? artwork.id ?? '')}</strong>${artwork.artist ? `<span>${escapeHtml(artwork.artist)}</span>` : ''}${artwork.date ? `<small>${escapeHtml(artwork.date)}</small>` : ''}${artwork.description ? `<p>${escapeHtml(artwork.description)}</p>` : ''}</article>
  `).join('')}</div></section>`;
}

function renderVisitInfo(node, language) {
  const info = localizedStructured(node.visitInfo, language, null);
  if (!info || typeof info !== 'object') return '';
  const labels = language === 'de'
    ? { hours: 'Öffnungszeiten', fee: 'Eintritt', accessibility: 'Barrierefreiheit', verifiedOn: 'Geprüft' }
    : { hours: 'Opening hours', fee: 'Admission', accessibility: 'Accessibility', verifiedOn: 'Verified' };
  const rows = Object.entries(labels).filter(([key]) => info[key]).map(([key, label]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(info[key])}</dd></div>`).join('');
  return rows ? `<section class="detail-section visit-info"><h3>${language === 'de' ? 'Besuch' : 'Visit'}</h3><dl>${rows}</dl></section>` : '';
}

function renderSources(node, language, t) {
  const sources = Array.isArray(node.sources) ? node.sources : [];
  if (!sources.length && !node.coordinate_source) return '';
  const items = sources.map((source) => {
    const label = localized(source.title, language, source.id ?? source.url ?? t('source'));
    const href = safeImageUrl(source.url);
    return `<li>${href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>` : escapeHtml(label)}</li>`;
  });
  if (node.coordinate_source) {
    const source = node.coordinate_source;
    items.push(`<li>${escapeHtml(source.provider ?? 'OpenStreetMap')} · ${escapeHtml(source.element ?? '')}</li>`);
  }
  return `<details class="detail-sources"><summary>${escapeHtml(t('source'))}</summary><ul>${items.join('')}</ul></details>`;
}

export function renderNodeDetail(container, { node, graph, i18n, onNavigate, onSelectNode }) {
  if (!node) {
    container.hidden = true;
    container.innerHTML = '';
    return;
  }
  const language = i18n.language;
  const title = localized(node.name, language, node.title ?? node.id);
  const description = localized(node.description, language, localized(node.summary, language));
  const sections = contentSections(node, language);
  const narrationDescriptor = createNarrationDescriptor(node, language);
  const routeOptions = connectedRouteOptions(graph, node.id, language);

  container.hidden = false;
  container.innerHTML = `
    <div class="detail-sheet__handle" aria-hidden="true"></div>
    <div class="detail-sheet__header">
      <div>
        <p class="detail-kicker">${escapeHtml(node.type ?? node.category ?? (language === 'de' ? 'Ort' : 'Place'))}</p>
        <h2>${escapeHtml(title)}</h2>
      </div>
      <button class="icon-button" data-action="close-detail" type="button" aria-label="${escapeHtml(i18n.t('close'))}">×</button>
    </div>
    <div class="detail-sheet__scroll">
      ${description ? `<p class="detail-lead">${escapeHtml(description)}</p>` : ''}
      ${narrationDescriptor ? `<section class="audio-guide" aria-label="${escapeHtml(i18n.t('audioGuide'))}">
        <div class="detail-actions">
          <button class="action-button" data-action="narrate" type="button" aria-pressed="false"${speechNarrator.supported ? '' : ' disabled'}>◉ ${escapeHtml(i18n.t('listen'))}</button>
          <button class="action-button action-button--quiet" data-action="stop-narration" type="button" hidden>■ ${escapeHtml(i18n.t('stopAudio'))}</button>
        </div>
        <p class="sr-only" data-narration-status role="status">${escapeHtml(speechNarrator.supported ? i18n.t('audioReady') : i18n.t('audioUnavailable'))}</p>
        ${narrationTranscriptMarkup(narrationDescriptor, i18n)}
      </section>` : ''}
      ${renderGallery(node, language)}
      ${sections.map(({ heading, text }) => `<section class="detail-section"><h3>${escapeHtml(heading)}</h3><p>${escapeHtml(text)}</p></section>`).join('')}
      ${renderArtworks(node, language)}
      ${renderArtworkContext(node, graph, language)}
      ${renderSemanticFacts(node, graph, language)}
      ${renderSemanticLinks(node, graph, language)}
      ${renderVisitInfo(node, language)}
      ${routeOptions.length ? `
        <section class="detail-section">
          <div class="route-comparison__heading"><div><h3>${escapeHtml(i18n.t('nearby'))}</h3><p>${escapeHtml(i18n.t('routeComparisonNote'))}</p></div>
            <label>${escapeHtml(i18n.t('sortRoutes'))}<select data-route-sort>
              <option value="time">${escapeHtml(i18n.t('sortByTime'))}</option>
              <option value="distance">${escapeHtml(i18n.t('sortByDistance'))}</option>
              <option value="ascent">${escapeHtml(i18n.t('sortByAscent'))}</option>
            </select></label>
          </div>
          <div class="connection-list" data-route-options>${routeCardsMarkup(routeOptions, language, i18n)}</div>
        </section>
      ` : ''}
      ${renderSources(node, language, i18n.t.bind(i18n))}
    </div>
  `;

  const setNarrationState = (state) => {
    const play = container.querySelector('[data-action="narrate"]');
    const stop = container.querySelector('[data-action="stop-narration"]');
    const status = container.querySelector('[data-narration-status]');
    if (play) play.setAttribute('aria-pressed', state === 'playing' ? 'true' : 'false');
    if (stop) stop.hidden = state !== 'playing';
    if (status) status.textContent = state === 'playing' ? i18n.t('audioPlaying') : i18n.t('audioReady');
  };
  container.querySelector('[data-action="close-detail"]')?.addEventListener('click', () => {
    stopNarration({ onState: setNarrationState });
    container.hidden = true;
  });
  container.querySelector('[data-action="narrate"]')?.addEventListener('click', () => {
    if (!narrateNode(node, language, { onState: setNarrationState })) {
      const status = container.querySelector('[data-narration-status]');
      if (status) status.textContent = i18n.t('audioUnavailable');
    }
  });
  container.querySelector('[data-action="stop-narration"]')?.addEventListener('click', () => stopNarration({ onState: setNarrationState }));

  const bindRouteButtons = (scope) => {
    for (const button of scope.querySelectorAll('[data-node-id]')) {
      button.addEventListener('click', () => onSelectNode?.(button.dataset.nodeId));
    }
    for (const button of scope.querySelectorAll('[data-route-to]')) {
      button.addEventListener('click', () => onNavigate?.(node.id, button.dataset.routeTo));
    }
  };
  bindRouteButtons(container);
  const routeSort = container.querySelector('[data-route-sort]');
  routeSort?.addEventListener('change', () => {
    const routeList = container.querySelector('[data-route-options]');
    if (!routeList) return;
    routeList.innerHTML = routeCardsMarkup(
      connectedRouteOptions(graph, node.id, language, { sort: routeSort.value }),
      language,
      i18n,
    );
    bindRouteButtons(routeList);
  });
  for (const button of container.querySelectorAll('[data-semantic-id]')) {
    button.addEventListener('click', () => onSelectNode?.(button.dataset.semanticId));
  }
}
