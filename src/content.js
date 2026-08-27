import { localized } from './i18n.js';
import { semanticRelationLabel } from './semantic.js';

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderSemanticLinks(node, graph, language) {
  const relations = graph.semanticRelationsByEntity?.get(node.id) ?? [];
  if (!relations.length) return '';
  const rows = relations.map((edge) => {
    const otherId = edge.from === node.id ? edge.to : edge.from;
    const other = graph.entitiesById.get(otherId) ?? graph.nodesById.get(otherId);
    if (!other) return '';
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
  }).filter(Boolean).join('');
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

export function stopNarration() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

export function narrateNode(node, language) {
  if (!('speechSynthesis' in window)) return false;
  stopNarration();
  const title = localized(node.name, language, node.title ?? node.id);
  const pieces = [
    title,
    localized(node.description, language),
    localized(node.history, language),
    localized(node.architecture, language),
    localized(node.significance, language),
    localized(node.visitorContext, language),
  ].filter(Boolean);
  const utterance = new SpeechSynthesisUtterance(pieces.join('. '));
  utterance.lang = language === 'de' ? 'de-DE' : 'en-GB';
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find((voice) => voice.lang.toLowerCase().startsWith(language));
  if (preferred) utterance.voice = preferred;
  window.speechSynthesis.speak(utterance);
  return true;
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
  const outgoing = graph.outgoing.get(node.id) ?? [];

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
      <div class="detail-actions">
        <button class="action-button" data-action="narrate" type="button">◉ ${escapeHtml(i18n.t('listen'))}</button>
        <button class="action-button action-button--quiet" data-action="stop-narration" type="button">■ ${escapeHtml(i18n.t('stopAudio'))}</button>
      </div>
      ${renderGallery(node, language)}
      ${sections.map(({ heading, text }) => `<section class="detail-section"><h3>${escapeHtml(heading)}</h3><p>${escapeHtml(text)}</p></section>`).join('')}
      ${renderArtworks(node, language)}
      ${renderSemanticFacts(node, graph, language)}
      ${renderSemanticLinks(node, graph, language)}
      ${renderVisitInfo(node, language)}
      ${outgoing.length ? `
        <section class="detail-section">
          <h3>${escapeHtml(i18n.t('nearby'))}</h3>
          <div class="connection-list">
            ${outgoing.map((edge) => {
              const target = graph.nodesById.get(edge.to);
              if (!target) return '';
              const targetName = localized(target.name, language, target.id);
              return `<article class="connection-card">
                <button type="button" data-node-id="${escapeHtml(target.id)}"><strong>${escapeHtml(targetName)}</strong><span>${Math.round(edge.distance_m)} ${escapeHtml(i18n.t('metres'))} · ${edge.walking_min} ${escapeHtml(i18n.t('minutes'))}</span></button>
                <button type="button" class="route-button" data-route-to="${escapeHtml(target.id)}">${escapeHtml(i18n.t('navigate'))}</button>
              </article>`;
            }).join('')}
          </div>
        </section>
      ` : ''}
      ${renderSources(node, language, i18n.t.bind(i18n))}
    </div>
  `;

  container.querySelector('[data-action="close-detail"]')?.addEventListener('click', () => {
    stopNarration();
    container.hidden = true;
  });
  container.querySelector('[data-action="narrate"]')?.addEventListener('click', () => narrateNode(node, language));
  container.querySelector('[data-action="stop-narration"]')?.addEventListener('click', stopNarration);
  for (const button of container.querySelectorAll('[data-node-id]')) {
    button.addEventListener('click', () => onSelectNode?.(button.dataset.nodeId));
  }
  for (const button of container.querySelectorAll('[data-semantic-id]')) {
    button.addEventListener('click', () => onSelectNode?.(button.dataset.semanticId));
  }
  for (const button of container.querySelectorAll('[data-route-to]')) {
    button.addEventListener('click', () => onNavigate?.(node.id, button.dataset.routeTo));
  }
}
