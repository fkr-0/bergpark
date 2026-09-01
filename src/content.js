import { localized } from './i18n.js';
import { semanticRelationLabel } from './semantic.js';
import { createNarrationDescriptor, createNarrationVariants, createSpeechNarrator } from './audio-guide.js';
import { relatedJourneyBuckets } from './related-journey.js';
import './companion.css';
import {
  discoverMountainRoutes,
  routeAccessSummary,
  routeSurfaceSummary,
  routeTerrainSummary,
} from './discovery.js';

const speechNarrator = createSpeechNarrator();

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function walkingRoutePlannerMarkup(routePlanner, language) {
  if (!routePlanner) return '';
  const heading = language === 'de' ? 'Route im kartierten Wegenetz' : 'Route through the mapped network';
  const caveat = language === 'de'
    ? 'Berechnet über den begrenzten erhaltenen Phase-8-Quell-Snapshot; keine physisch vollständige Parkinventur.'
    : 'Computed over the bounded preserved Phase-8 source snapshot; not a physically complete park inventory.';
  if (routePlanner.state === 'loading') {
    return `<section class="detail-section walking-route-planner" data-walking-route-planner="loading"><h3>${heading}</h3><p>${language === 'de' ? 'Das detaillierte Wegenetz wird nachgeladen …' : 'The detailed walking network is loading …'}</p><p class="uncertainty-note">${caveat}</p></section>`;
  }
  if (routePlanner.state !== 'ready') {
    return `<section class="detail-section walking-route-planner" data-walking-route-planner="unavailable"><h3>${heading}</h3><p role="status">${language === 'de' ? 'Das detaillierte Wegenetz ist derzeit nicht verfügbar.' : 'The detailed walking network is currently unavailable.'}</p><p class="uncertainty-note">${caveat}</p></section>`;
  }
  const destinations = routePlanner.destinations ?? [];
  return `<section class="detail-section walking-route-planner" data-walking-route-planner="ready">
    <h3>${heading}</h3>
    <p>${language === 'de' ? 'Wähle ein kanonisches Parkziel und eine explizite Gewichtungspolitik.' : 'Choose a canonical park destination and an explicit weighting policy.'}</p>
    ${destinations.length ? `<form data-walking-route-form>
      <label>${language === 'de' ? 'Ziel' : 'Destination'}<select data-walking-route-to>${destinations.map((destination) => `<option value="${escapeHtml(destination.id)}">${escapeHtml(destination.title)}</option>`).join('')}</select></label>
      <label>${language === 'de' ? 'Profil' : 'Profile'}<select data-walking-route-profile>
        <option value="shortest">${language === 'de' ? 'Kürzeste kartierte Distanz' : 'Shortest mapped distance'}</option>
        <option value="avoid-mapped-steps">${language === 'de' ? 'Kartierte Stufen meiden' : 'Avoid mapped steps'}</option>
      </select></label>
      <button class="action-button" type="submit">${language === 'de' ? 'Route berechnen' : 'Compute route'}</button>
    </form>` : `<p>${language === 'de' ? 'Für diesen Ort sind keine weiteren verankerten Parkziele verfügbar.' : 'No other anchored park destinations are available from this place.'}</p>`}
    <p class="uncertainty-note">${caveat}</p>
    ${routePlanner.errorText ? `<p class="walking-route-planner__error" data-walking-route-error role="status">${escapeHtml(routePlanner.errorText)}</p>` : ''}
  </section>`;
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

export function pauseNarration(options = {}) {
  return speechNarrator.pause(options);
}

export function resumeNarration(options = {}) {
  return speechNarrator.resume(options);
}

function narrationTranscriptMarkup(descriptor, i18n, { hidden = false } = {}) {
  if (!descriptor?.transcript?.length) return '';
  return `<details class="narration-transcript" data-narration-transcript data-transcript-language="${escapeHtml(descriptor.language)}" lang="${escapeHtml(descriptor.language)}"${hidden ? ' hidden' : ''}>
    <summary>${escapeHtml(i18n.t('transcript'))}</summary>
    <div>${descriptor.transcript.map(({ heading, text }) => `${heading ? `<h3>${escapeHtml(heading)}</h3>` : ''}<p>${escapeHtml(text)}</p>`).join('')}</div>
  </details>`;
}

function renderRelatedJourney(node, graph, language) {
  const { semantic, nearby } = relatedJourneyBuckets(graph, node.id, language, { limit: 8 });
  if (!semantic.length && !nearby.length) return '';
  const renderItem = (item) => {
    const evidence = item.source === 'semantic'
      ? item.provenance?.assertion ?? ''
      : [item.evidence?.distanceM != null ? `${Math.round(item.evidence.distanceM)} m` : '', item.context].filter(Boolean).join(' · ');
    return `<button type="button" class="journey-link" data-related-id="${escapeHtml(item.id)}" data-related-source="${escapeHtml(item.source)}" data-related-relation="${escapeHtml(item.relationKey ?? '')}">
      <span class="journey-link__main"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.relation)}${item.context && item.source === 'semantic' ? ` · ${escapeHtml(item.context)}` : ''}</small></span>
      ${evidence ? `<span class="journey-link__evidence">${escapeHtml(evidence)}</span>` : ''}
    </button>`;
  };
  return `${semantic.length ? `<section class="detail-section related-journey"><h3>${language === 'de' ? 'Verbundenes Wissen' : 'Related knowledge'}</h3><div class="journey-links">${semantic.map(renderItem).join('')}</div></section>` : ''}
    ${nearby.length ? `<section class="detail-section related-journey"><h3>${language === 'de' ? 'Weitergehen' : 'Continue walking'}</h3><div class="journey-links">${nearby.map(renderItem).join('')}</div></section>` : ''}`;
}

function compactRouteMetrics(evidence, i18n) {
  const values = [];
  if (evidence.walkingMin != null) values.push(`${evidence.walkingMin} ${i18n.t('minutes')}`);
  if (evidence.distanceM != null) values.push(`${Math.round(evidence.distanceM)} ${i18n.t('metres')}`);
  if (evidence.ascentM != null) values.push(`↑ ${Math.round(evidence.ascentM)} ${i18n.t('metres')}`);
  if (evidence.descentM != null) values.push(`↓ ${Math.round(evidence.descentM)} ${i18n.t('metres')}`);
  return values.join(' · ');
}

function routeCardsMarkup(options, language, i18n) {
  return options.map((option) => `<article class="connection-card" data-route-option="${escapeHtml(option.id)}">
    <button type="button" data-node-id="${escapeHtml(option.toId)}">
      <strong>${escapeHtml(option.title)}</strong>
      <span class="route-option__metrics">${escapeHtml(compactRouteMetrics(option.evidence, i18n))}</span>
      <span class="route-option__terrain">${escapeHtml(routeTerrainSummary(option.evidence, language))}</span>
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

export function renderNodeDetail(container, { node, graph, i18n, onNavigate, onSelectNode, routePlanner = null, onPlanWalkingRoute }) {
  if (!node) {
    container.hidden = true;
    container.innerHTML = '';
    return;
  }
  const language = i18n.language;
  const title = localized(node.name, language, node.title ?? node.id);
  const description = localized(node.description, language, localized(node.summary, language));
  const sections = contentSections(node, language);
  const narrationVariants = createNarrationVariants(node);
  const narrationDescriptor = narrationVariants.find((variant) => variant.language === language) ?? narrationVariants[0] ?? null;
  const routeOptions = discoverMountainRoutes(graph, node.id, language);

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
          <button class="action-button" data-action="narrate" type="button" aria-pressed="false"${speechNarrator.supported ? '' : ' disabled'}>▶ ${escapeHtml(i18n.t('listen'))}</button>
          <button class="action-button action-button--quiet" data-action="pause-narration" type="button" hidden>Ⅱ ${escapeHtml(i18n.t('pauseAudio'))}</button>
          <button class="action-button action-button--quiet" data-action="resume-narration" type="button" hidden>▶ ${escapeHtml(i18n.t('resumeAudio'))}</button>
          <button class="action-button action-button--quiet" data-action="stop-narration" type="button" hidden>■ ${escapeHtml(i18n.t('stopAudio'))}</button>
        </div>
        ${narrationVariants.length > 1 ? `<label class="audio-language"><span>${escapeHtml(i18n.t('audioLanguage'))}</span><select data-audio-language>${narrationVariants.map((variant) => `<option value="${escapeHtml(variant.language)}"${variant.language === narrationDescriptor.language ? ' selected' : ''}>${variant.language === 'de' ? 'Deutsch' : 'English'}</option>`).join('')}</select></label>` : narrationDescriptor.language !== language ? `<p class="audio-language audio-language--static"><span>${escapeHtml(i18n.t('audioLanguage'))}</span><strong lang="${escapeHtml(narrationDescriptor.language)}">${narrationDescriptor.language === 'de' ? 'Deutsch' : 'English'}</strong></p>` : ''}
        <p class="sr-only" data-narration-status role="status">${escapeHtml(speechNarrator.supported ? i18n.t('audioReady') : i18n.t('audioUnavailable'))}</p>
        ${narrationVariants.map((variant) => narrationTranscriptMarkup(variant, i18n, { hidden: variant.language !== narrationDescriptor.language })).join('')}
      </section>` : ''}
      ${renderGallery(node, language)}
      ${sections.map(({ heading, text }) => `<section class="detail-section"><h3>${escapeHtml(heading)}</h3><p>${escapeHtml(text)}</p></section>`).join('')}
      ${renderArtworks(node, language)}
      ${renderArtworkContext(node, graph, language)}
      ${renderSemanticFacts(node, graph, language)}
      ${renderSemanticLinks(node, graph, language)}
      ${renderRelatedJourney(node, graph, language)}
      ${renderVisitInfo(node, language)}
      ${walkingRoutePlannerMarkup(routePlanner, language)}
      ${routeOptions.length ? `
        <section class="detail-section">
          <div class="route-comparison__heading"><div><h3>${escapeHtml(i18n.t('nearby'))}</h3><p>${escapeHtml(i18n.t('routeComparisonNote'))}</p></div>
            <div class="route-comparison__controls">
              <label>${language === 'de' ? 'Gelände-Ziel' : 'Mountain focus'}<select data-route-filter>
                <option value="nearby">${language === 'de' ? 'Alle direkten Wege' : 'All direct walks'}</option>
                <option value="uphill">${language === 'de' ? 'Bergauf' : 'Uphill'}</option>
                <option value="downhill">${language === 'de' ? 'Bergab' : 'Downhill'}</option>
                <option value="viewpoint">${language === 'de' ? 'Aussichtspunkt' : 'Viewpoint'}</option>
                <option value="water-axis">${language === 'de' ? 'Belegte Wasserachse' : 'Evidenced water axis'}</option>
                <option value="heritage">${language === 'de' ? 'Historisch kartiert' : 'Mapped heritage'}</option>
              </select></label>
              <label>${escapeHtml(i18n.t('sortRoutes'))}<select data-route-sort>
                <option value="time">${escapeHtml(i18n.t('sortByTime'))}</option>
                <option value="distance">${escapeHtml(i18n.t('sortByDistance'))}</option>
                <option value="ascent">${escapeHtml(i18n.t('sortByAscent'))}</option>
                <option value="descent">${language === 'de' ? 'Wenigster Abstieg' : 'Least descent'}</option>
              </select></label>
            </div>
          </div>
          <div class="connection-list" data-route-options>${routeCardsMarkup(routeOptions, language, i18n)}</div>
          <p class="route-comparison__empty" data-route-empty hidden>${language === 'de' ? 'Für diesen direkten Anschluss liegt kein Ziel mit dieser belegten Eigenschaft vor.' : 'No directly connected destination has this evidenced property.'}</p>
        </section>
      ` : ''}
      ${renderSources(node, language, i18n.t.bind(i18n))}
    </div>
  `;

  const setNarrationState = (state) => {
    const play = container.querySelector('[data-action="narrate"]');
    const pause = container.querySelector('[data-action="pause-narration"]');
    const resume = container.querySelector('[data-action="resume-narration"]');
    const stop = container.querySelector('[data-action="stop-narration"]');
    const status = container.querySelector('[data-narration-status]');
    if (play) play.setAttribute('aria-pressed', state === 'playing' ? 'true' : 'false');
    if (pause) pause.hidden = state !== 'playing';
    if (resume) resume.hidden = state !== 'paused';
    if (stop) stop.hidden = !['playing', 'paused'].includes(state);
    if (status) status.textContent = state === 'playing'
      ? i18n.t('audioPlaying')
      : state === 'paused'
        ? i18n.t('audioPaused')
        : i18n.t('audioReady');
  };
  container.querySelector('[data-action="close-detail"]')?.addEventListener('click', () => {
    stopNarration({ onState: setNarrationState });
    container.hidden = true;
  });
  container.querySelector('[data-action="narrate"]')?.addEventListener('click', () => {
    const selectedLanguage = container.querySelector('[data-audio-language]')?.value ?? language;
    if (!narrateNode(node, selectedLanguage, { onState: setNarrationState })) {
      const status = container.querySelector('[data-narration-status]');
      if (status) status.textContent = i18n.t('audioUnavailable');
    }
  });
  container.querySelector('[data-action="pause-narration"]')?.addEventListener('click', () => pauseNarration({ onState: setNarrationState }));
  container.querySelector('[data-action="resume-narration"]')?.addEventListener('click', () => resumeNarration({ onState: setNarrationState }));
  container.querySelector('[data-action="stop-narration"]')?.addEventListener('click', () => stopNarration({ onState: setNarrationState }));
  const audioLanguage = container.querySelector('[data-audio-language]');
  const syncTranscriptLanguage = () => {
    const selectedLanguage = audioLanguage?.value ?? narrationDescriptor?.language;
    for (const transcript of container.querySelectorAll('[data-transcript-language]')) {
      transcript.hidden = transcript.dataset.transcriptLanguage !== selectedLanguage;
    }
  };
  audioLanguage?.addEventListener('change', () => {
    stopNarration({ onState: setNarrationState });
    syncTranscriptLanguage();
  });
  syncTranscriptLanguage();

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
  const routeFilter = container.querySelector('[data-route-filter]');
  const refreshRouteOptions = () => {
    const routeList = container.querySelector('[data-route-options]');
    if (!routeList) return;
    const options = discoverMountainRoutes(graph, node.id, language, {
      sort: routeSort?.value ?? 'time',
      filter: routeFilter?.value ?? 'nearby',
    });
    routeList.innerHTML = routeCardsMarkup(options, language, i18n);
    const empty = container.querySelector('[data-route-empty]');
    if (empty) empty.hidden = options.length > 0;
    bindRouteButtons(routeList);
  };
  routeSort?.addEventListener('change', refreshRouteOptions);
  routeFilter?.addEventListener('change', refreshRouteOptions);
  container.querySelector('[data-walking-route-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const destination = container.querySelector('[data-walking-route-to]')?.value;
    const profile = container.querySelector('[data-walking-route-profile]')?.value ?? 'shortest';
    if (destination) onPlanWalkingRoute?.(node.id, destination, profile);
  });
  for (const button of container.querySelectorAll('[data-semantic-id]')) {
    button.addEventListener('click', () => onSelectNode?.(button.dataset.semanticId));
  }
  for (const button of container.querySelectorAll('[data-related-id]')) {
    button.addEventListener('click', () => onSelectNode?.(button.dataset.relatedId, {
      source: 'related-journey',
      returnTo: { kind: graph?.nodesById?.has(node.id) ? 'place' : 'story', id: node.id },
      relationKey: button.dataset.relatedRelation || null,
    }));
  }
}
