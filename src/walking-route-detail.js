import { localized } from './i18n.js';

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function profileText(route, language) {
  if (route.profileId === 'avoid-mapped-steps') {
    return language === 'de'
      ? 'Profil „kartierte Stufen meiden“: Segmente mit explizit kartierten Stufen werden ausgeschlossen; unbekannte Stufen, Oberflächen und Barrieren bleiben zulässig und ausdrücklich unbekannt.'
      : '“Avoid mapped steps” profile: segments explicitly tagged as steps are excluded; unknown steps, surfaces and barriers remain allowed and explicitly unknown.';
  }
  return language === 'de'
    ? 'Profil „kürzeste kartierte Distanz“: Gewicht ist ausschließlich die veröffentlichte Segmentdistanz; Zugänglichkeit verändert das Gewicht nicht.'
    : '“Shortest mapped distance” profile: weight is only the published segment distance; accessibility evidence does not change the weight.';
}

function surfaceText(route, language) {
  const entries = Object.entries(route.evidence.surfaceDistanceM ?? {})
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  if (!entries.length) return language === 'de' ? 'Oberflächen unbekannt.' : 'Surfaces unknown.';
  return entries.map(([surface, distance]) => `${surface}: ${Math.round(distance)} m`).join(' · ');
}

function stepsText(route, language) {
  const evidence = route.evidence;
  if (evidence.mappedStepSegments > 0) {
    return language === 'de'
      ? `${evidence.mappedStepSegments} Segment(e) mit kartierten Stufen, zusammen ca. ${Math.round(evidence.mappedStepDistanceM)} m; ${evidence.stepUnknownSegments} Segment(e) ohne belastbare Stufenangabe.`
      : `${evidence.mappedStepSegments} segment(s) with mapped steps, about ${Math.round(evidence.mappedStepDistanceM)} m total; ${evidence.stepUnknownSegments} segment(s) lack reliable step evidence.`;
  }
  return language === 'de'
    ? `Keine kartierten Stufen auf dieser Auswahl; ${evidence.stepUnknownSegments} Segment(e) haben unbekannte Stufenevidenz. Das ist kein Nachweis einer stufenfreien Route.`
    : `No mapped steps on this selection; ${evidence.stepUnknownSegments} segment(s) have unknown step evidence. This is not proof of a step-free route.`;
}

function barrierText(route, language) {
  const evidence = route.evidence;
  const known = evidence.knownBarrierConstraintSegments;
  const unknown = evidence.barrierUnverifiedSegments;
  if (language === 'de') {
    return `${known ? `${known} Segment(e) mit kartierter Barrieren-/Mobilitätseinschränkung. ` : 'Keine kartierte Barrieren-/Mobilitätseinschränkung auf der Auswahl. '}${unknown} Segment(e) bleiben hinsichtlich Barrieren bzw. Zugänglichkeit nicht vor Ort verifiziert.`;
  }
  return `${known ? `${known} segment(s) carry mapped barrier/mobility-constraint evidence. ` : 'No mapped barrier/mobility constraint appears on the selection. '}${unknown} segment(s) remain not field-verified for barriers or accessibility.`;
}

function endpointText(route, language) {
  const evidence = route.evidence;
  if (!evidence.endpointUnknownSegments) {
    return language === 'de'
      ? 'Für die Endpunktverbindungen liegt kein zusätzlicher unbekannter Snap-Connector vor.'
      : 'No additional unknown snap connector is present at the endpoints.';
  }
  return language === 'de'
    ? `${evidence.endpointUnknownSegments} Endpunkt-Connector(en), zusammen ca. ${evidence.endpointUnknownDistanceM.toFixed(1)} m, sind nur geometrisch gesnappt; Oberfläche, Stufen und Barrieren sind dort unbekannt.`
    : `${evidence.endpointUnknownSegments} endpoint connector(s), about ${evidence.endpointUnknownDistanceM.toFixed(1)} m total, are geometric snaps only; surface, steps and barriers there are unknown.`;
}

function coverageText(language) {
  if (language === 'de') {
    return 'Die Route nutzt ausschließlich den begrenzten, erhaltenen Phase-8-Quell-Snapshot. Er ist keine physisch vollständige Parkinventur; fehlende Wege oder Merkmale dürfen nicht als vor Ort nicht vorhanden interpretiert werden.';
  }
  return 'This route uses only the bounded preserved Phase-8 source snapshot. It is not a physically complete park inventory; missing paths or features must not be interpreted as absent on site.';
}

export function renderWalkingRouteDetail(container, { route, from, to, i18n, onSelectNode, onClose }) {
  const language = i18n.language;
  const fromName = localized(from?.name, language, from?.id ?? route.fromId);
  const toName = localized(to?.name, language, to?.id ?? route.toId);
  const coverage = route.coverage ?? {};
  container.hidden = false;
  container.innerHTML = `
    <div class="detail-sheet__handle" aria-hidden="true"></div>
    <div class="detail-sheet__header">
      <div><p class="detail-kicker">${language === 'de' ? 'Wegenetz-Route' : 'Walking-network route'}</p><h2>${escapeHtml(fromName)} → ${escapeHtml(toName)}</h2></div>
      <button class="icon-button" data-action="close-walking-route" type="button" aria-label="${escapeHtml(i18n.t('close'))}">×</button>
    </div>
    <div class="detail-sheet__scroll route-detail walking-route-detail" data-walking-route-result="${escapeHtml(route.id)}">
      <dl class="route-metrics">
        <div><dt>${language === 'de' ? 'Kartierte Distanz' : 'Mapped distance'}</dt><dd>${Math.round(route.distanceM)} m</dd></div>
        <div><dt>${language === 'de' ? 'Segmente' : 'Segments'}</dt><dd>${route.segments.length}</dd></div>
        <div><dt>${language === 'de' ? 'Profil' : 'Profile'}</dt><dd>${route.profileId === 'avoid-mapped-steps' ? (language === 'de' ? 'Kartierte Stufen meiden' : 'Avoid mapped steps') : (language === 'de' ? 'Kürzeste Distanz' : 'Shortest distance')}</dd></div>
      </dl>
      <section class="route-evidence">
        <h3>${language === 'de' ? 'Profilpolitik' : 'Profile policy'}</h3>
        <p data-walking-route-policy>${escapeHtml(profileText(route, language))}</p>
      </section>
      <section class="route-evidence">
        <h3>${language === 'de' ? 'Oberfläche, Stufen & Barrieren' : 'Surface, steps & barriers'}</h3>
        <p>${escapeHtml(surfaceText(route, language))}</p>
        <p data-walking-route-steps>${escapeHtml(stepsText(route, language))}</p>
        <p data-walking-route-barriers>${escapeHtml(barrierText(route, language))}</p>
        <p data-walking-route-endpoints class="uncertainty-note">${escapeHtml(endpointText(route, language))}</p>
      </section>
      <section class="route-evidence walking-route-coverage">
        <h3>${language === 'de' ? 'Quellabdeckung' : 'Source coverage'}</h3>
        <p data-walking-route-coverage>${escapeHtml(coverageText(language))}</p>
        ${coverage.intended_source_scope ? `<details><summary>${language === 'de' ? 'Erhaltener Quellumfang' : 'Preserved source scope'}</summary><p>${escapeHtml(coverage.intended_source_scope)}</p>${coverage.boundary_source_note ? `<p class="uncertainty-note">${escapeHtml(coverage.boundary_source_note)}</p>` : ''}</details>` : ''}
      </section>
      <div class="detail-actions">
        <button class="action-button action-button--quiet" type="button" data-walking-route-node="${escapeHtml(route.fromId)}">${language === 'de' ? 'Start öffnen' : 'Open start'}</button>
        <button class="action-button action-button--quiet" type="button" data-walking-route-node="${escapeHtml(route.toId)}">${language === 'de' ? 'Ziel öffnen' : 'Open destination'}</button>
      </div>
    </div>
  `;
  const close = container.querySelector('[data-action="close-walking-route"]');
  close?.addEventListener('click', () => {
    container.hidden = true;
    onClose?.();
  });
  for (const button of container.querySelectorAll('[data-walking-route-node]')) {
    button.addEventListener('click', () => onSelectNode?.(button.dataset.walkingRouteNode));
  }
  close?.focus();
}
