import { localized } from './i18n.js';

function escapeHtml(value = '') {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function handrailSummary(evidence, language) {
  if (!evidence.handrailTaggedSegments) {
    return language === 'de' ? 'Keine expliziten Handlauf-Tags auf den kartierten Segmenten.' : 'No explicit handrail tags on the mapped segments.';
  }
  const values = evidence.handrailValues.join(', ');
  return language === 'de'
    ? `OSM-Handlauf-Evidenz auf ${evidence.handrailTaggedSegments} Segment(en): ${values}.`
    : `OSM handrail evidence on ${evidence.handrailTaggedSegments} segment(s): ${values}.`;
}

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function segmentEvidence(edge, key) {
  return (edge?.surface_segments ?? []).filter((segment) => segment?.[key] != null);
}

export function routeEvidence(edge) {
  const surfaces = Array.isArray(edge?.surface_mix) ? edge.surface_mix.filter(Boolean) : [];
  const wheelchair = segmentEvidence(edge, 'wheelchair');
  const handrails = segmentEvidence(edge, 'handrail');
  const steps = (edge?.surface_segments ?? []).filter((segment) => segment.steps);
  return {
    distanceM: finite(edge?.distance_m),
    walkingMin: finite(edge?.walking_min),
    ascentM: finite(edge?.ascent_m),
    descentM: finite(edge?.descent_m),
    averageGradePct: finite(edge?.avg_grade_pct),
    surfaces,
    surfaceDistanceM: edge?.surface_distance_m ?? {},
    mappedPathAccessibility: edge?.mapped_path_accessibility ?? edge?.accessibility ?? 'unknown',
    endpointAccessUnknown: edge?.endpoint_access_unknown === true,
    endpointSnapTotalM: finite(edge?.endpoint_snap_total_m),
    containsSteps: edge?.contains_steps === true || steps.length > 0,
    stepDistanceM: finite(edge?.step_distance_m),
    wheelchairValues: [...new Set(wheelchair.map((segment) => segment.wheelchair))],
    wheelchairTaggedSegments: wheelchair.length,
    handrailValues: [...new Set(handrails.map((segment) => segment.handrail))],
    handrailTaggedSegments: handrails.length,
    elevationSamplingM: finite(edge?.elevation_metric_sampling_m),
    elevationProfileM: Array.isArray(edge?.elevation_profile_m) ? edge.elevation_profile_m.filter(Number.isFinite) : [],
  };
}

export function routeProfilePolyline(profile, width = 240, height = 56) {
  const values = (profile ?? []).filter(Number.isFinite);
  if (values.length < 2) return { points: '', min: values[0] ?? null, max: values[0] ?? null };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - ((value - min) / span) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return { points, min, max };
}

function accessLabel(value, language) {
  const labels = {
    de: {
      limited: 'Kartierter Weg: eingeschränkte Zugänglichkeit',
      potentially_step_free_mapped_path: 'Kartierter Weg: möglicherweise stufenfrei',
      steps: 'Kartierter Weg enthält Stufen',
      unknown: 'Kartierter Weg: Zugänglichkeit unbekannt',
    },
    en: {
      limited: 'Mapped path: limited accessibility evidence',
      potentially_step_free_mapped_path: 'Mapped path: potentially step-free',
      steps: 'Mapped path contains steps',
      unknown: 'Mapped path: accessibility unknown',
    },
  };
  return labels[language]?.[value] ?? labels[language]?.unknown ?? labels.en.unknown;
}

function surfaceSummary(evidence, language) {
  if (!evidence.surfaces.length) return language === 'de' ? 'Oberfläche unbekannt' : 'Surface unknown';
  return evidence.surfaces.map((surface) => {
    const distance = evidence.surfaceDistanceM?.[surface];
    return Number.isFinite(distance) ? `${surface} ${Math.round(distance)} m` : surface;
  }).join(' · ');
}

function wheelchairSummary(evidence, language) {
  if (!evidence.wheelchairTaggedSegments) {
    return language === 'de' ? 'Keine expliziten Rollstuhl-Tags auf den kartierten Segmenten.' : 'No explicit wheelchair tags on the mapped segments.';
  }
  const values = evidence.wheelchairValues.join(', ');
  return language === 'de'
    ? `OSM-Rollstuhl-Evidenz auf ${evidence.wheelchairTaggedSegments} Segment(en): ${values}.`
    : `OSM wheelchair evidence on ${evidence.wheelchairTaggedSegments} segment(s): ${values}.`;
}

export function renderRouteDetail(container, { edge, from, to, i18n, onSelectNode, onClose }) {
  const language = i18n.language;
  const evidence = routeEvidence(edge);
  const profile = routeProfilePolyline(evidence.elevationProfileM);
  const fromName = localized(from?.name, language, from?.id ?? edge.from);
  const toName = localized(to?.name, language, to?.id ?? edge.to);
  const profileLabel = language === 'de' ? 'Höhenprofil' : 'Elevation profile';
  const endpointNote = evidence.endpointAccessUnknown
    ? (language === 'de'
      ? `Die Verbindung zwischen Landmarkenpunkt und kartiertem Weg ist nicht auf Barrieren geprüft${evidence.endpointSnapTotalM != null ? ` (${evidence.endpointSnapTotalM.toFixed(1)} m Snap-Distanz)` : ''}.`
      : `The connection between landmark point and mapped path has not been checked for barriers${evidence.endpointSnapTotalM != null ? ` (${evidence.endpointSnapTotalM.toFixed(1)} m snap distance)` : ''}.`)
    : (language === 'de' ? 'Für die Endpunktverbindung liegt kein zusätzlicher Unsicherheitsmarker vor.' : 'No additional endpoint-connection uncertainty flag is present.');
  const stepNote = evidence.containsSteps
    ? (language === 'de' ? `Kartierte Stufen${evidence.stepDistanceM != null ? `: ca. ${Math.round(evidence.stepDistanceM)} m` : ''}.` : `Mapped steps${evidence.stepDistanceM != null ? `: about ${Math.round(evidence.stepDistanceM)} m` : ''}.`)
    : (language === 'de' ? 'Keine kartierten Stufen in dieser Route; das ist kein Nachweis vollständiger Barrierefreiheit.' : 'No mapped steps on this route; this is not proof of full accessibility.');

  container.hidden = false;
  container.innerHTML = `
    <div class="detail-sheet__handle" aria-hidden="true"></div>
    <div class="detail-sheet__header">
      <div><p class="detail-kicker">${language === 'de' ? 'Wegprofil' : 'Route profile'}</p><h2>${escapeHtml(fromName)} → ${escapeHtml(toName)}</h2></div>
      <button class="icon-button" data-action="close-route" type="button" aria-label="${escapeHtml(i18n.t('close'))}">×</button>
    </div>
    <div class="detail-sheet__scroll route-detail">
      <dl class="route-metrics">
        <div><dt>${language === 'de' ? 'Distanz' : 'Distance'}</dt><dd>${evidence.distanceM == null ? '—' : `${Math.round(evidence.distanceM)} m`}</dd></div>
        <div><dt>${language === 'de' ? 'Gehzeit' : 'Walking time'}</dt><dd>${evidence.walkingMin == null ? '—' : `${evidence.walkingMin} ${i18n.t('minutes')}`}</dd></div>
        <div><dt>${language === 'de' ? 'Anstieg' : 'Ascent'}</dt><dd>${evidence.ascentM == null ? '—' : `${evidence.ascentM.toFixed(0)} m`}</dd></div>
        <div><dt>${language === 'de' ? 'Abstieg' : 'Descent'}</dt><dd>${evidence.descentM == null ? '—' : `${evidence.descentM.toFixed(0)} m`}</dd></div>
        <div><dt>${language === 'de' ? 'Ø Steigung' : 'Avg. grade'}</dt><dd>${evidence.averageGradePct == null ? '—' : `${evidence.averageGradePct.toFixed(1)} %`}</dd></div>
      </dl>
      ${profile.points ? `<figure class="route-profile"><figcaption>${profileLabel} · ${profile.min.toFixed(0)}–${profile.max.toFixed(0)} m${evidence.elevationSamplingM ? ` · ${language === 'de' ? 'Metriken ~' : 'metrics ~'}${evidence.elevationSamplingM} m DEM` : ''}</figcaption><svg viewBox="0 0 240 56" role="img" aria-label="${escapeHtml(profileLabel)}"><polyline points="${profile.points}" vector-effect="non-scaling-stroke"></polyline></svg></figure>` : ''}
      <section class="route-evidence" aria-label="${language === 'de' ? 'Wegevidenz' : 'Route evidence'}">
        <h3>${language === 'de' ? 'Oberfläche & Zugang' : 'Surface & access'}</h3>
        <p><strong>${escapeHtml(accessLabel(evidence.mappedPathAccessibility, language))}</strong></p>
        <p>${escapeHtml(surfaceSummary(evidence, language))}</p>
        <p>${escapeHtml(stepNote)}</p>
        <p>${escapeHtml(wheelchairSummary(evidence, language))}</p>
        <p>${escapeHtml(handrailSummary(evidence, language))}</p>
        <p class="uncertainty-note">${escapeHtml(endpointNote)}</p>
        <p class="uncertainty-note">${language === 'de' ? 'Diese Angaben stammen aus kartierten OSM-Wegen und groben Geländedaten; sie ersetzen keine Prüfung vor Ort.' : 'These details come from mapped OSM paths and coarse terrain data; they do not replace on-site verification.'}</p>
      </section>
      <div class="detail-actions">
        <button class="action-button action-button--quiet" type="button" data-route-node="${escapeHtml(from?.id ?? edge.from)}">${language === 'de' ? 'Start öffnen' : 'Open start'}</button>
        <button class="action-button action-button--quiet" type="button" data-route-node="${escapeHtml(to?.id ?? edge.to)}">${language === 'de' ? 'Ziel öffnen' : 'Open destination'}</button>
      </div>
    </div>
  `;
  const closeButton = container.querySelector('[data-action="close-route"]');
  closeButton?.addEventListener('click', () => {
    container.hidden = true;
    onClose?.();
  });
  for (const button of container.querySelectorAll('[data-route-node]')) button.addEventListener('click', () => onSelectNode?.(button.dataset.routeNode));
  closeButton?.focus();
}
