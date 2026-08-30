import { localized } from './i18n.js';
import {
  elevationProfilePolyline,
  elevationUnknownsLabel,
  loadRouteElevationProfile,
  routeElevationSource,
  routeElevationSummary,
} from './elevation/profile.js';

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

function isGlo90Source(source) {
  const identity = `${source?.dataset ?? ''} ${source?.provider ?? ''}`;
  return /(?:copernicus.*glo[- ]?90|glo[- ]?90)/i.test(identity);
}

function elevationConfidenceSummary(evidence, language) {
  if (evidence.elevationStatus === 'dgm1') {
    const accuracy = finite(evidence.elevationSource?.heightAccuracyM95PctUpTo);
    if (language === 'de') {
      return accuracy == null
        ? 'DGM1-Quelle qualifiziert; kombinierter Routenfehler unbekannt (keine kalibrierte Schranke).'
        : `DGM1-Quellgenauigkeit bis ${accuracy} m (95 %); kombinierter Routenfehler unbekannt (keine kalibrierte Schranke).`;
    }
    return accuracy == null
      ? 'DGM1 source qualified; combined route error is unknown (no calibrated bound).'
      : `DGM1 source accuracy up to ${accuracy} m (95%); combined route error is unknown (no calibrated bound).`;
  }
  if (evidence.elevationStatus === 'legacy') {
    return language === 'de'
      ? 'GLO-90 ist ein grober Fallback; im Projekt ist keine vertikale Genauigkeit für diese Route ausgewiesen.'
      : 'GLO-90 is a coarse fallback; no vertical accuracy is stated for this route in the project.';
  }
  return language === 'de' ? 'Geländemetriken bleiben unbekannt.' : 'Terrain metrics remain unknown.';
}

export function routeEvidence(edge) {
  const surfaces = Array.isArray(edge?.surface_mix) ? edge.surface_mix.filter(Boolean) : [];
  const wheelchair = segmentEvidence(edge, 'wheelchair');
  const handrails = segmentEvidence(edge, 'handrail');
  const steps = (edge?.surface_segments ?? []).filter((segment) => segment.steps);
  const routeId = edge?.id ?? (edge?.from && edge?.to ? `${edge.from}--${edge.to}` : null);
  const dgm1 = routeId ? routeElevationSummary(routeId) : null;
  const legacyProfile = Array.isArray(edge?.elevation_profile_m) ? edge.elevation_profile_m.filter(Number.isFinite) : [];
  const legacySource = edge?.elevation_source ?? null;
  const hasGlo90Fallback = legacyProfile.length > 1 && isGlo90Source(legacySource);
  const elevationStatus = dgm1 ? 'dgm1' : (hasGlo90Fallback ? 'legacy' : 'unknown');
  const elevationSource = dgm1 ? routeElevationSource() : (hasGlo90Fallback ? legacySource : null);
  const legacyMetric = (value) => elevationStatus === 'legacy' ? finite(value) : null;
  const legacyStartElevation = elevationStatus === 'legacy' ? finite(legacyProfile[0]) : null;
  const legacyEndElevation = elevationStatus === 'legacy' ? finite(legacyProfile.at(-1)) : null;
  const netGradePct = dgm1 ? finite(dgm1.averageGradePct) : legacyMetric(edge?.avg_grade_pct);
  return {
    routeId,
    distanceM: finite(edge?.distance_m),
    walkingMin: finite(edge?.walking_min),
    ascentM: dgm1 ? finite(dgm1.ascentM) : legacyMetric(edge?.ascent_m),
    descentM: dgm1 ? finite(dgm1.descentM) : legacyMetric(edge?.descent_m),
    netGradePct,
    averageGradePct: netGradePct,
    elevationDeltaM: dgm1
      ? finite(dgm1.elevationDeltaM)
      : (legacyStartElevation != null && legacyEndElevation != null ? legacyEndElevation - legacyStartElevation : null),
    startElevationM: dgm1 ? finite(dgm1.startElevationM) : legacyStartElevation,
    endElevationM: dgm1 ? finite(dgm1.endElevationM) : legacyEndElevation,
    minElevationM: dgm1
      ? finite(dgm1.minElevationM)
      : (elevationStatus === 'legacy' ? Math.min(...legacyProfile) : null),
    maxElevationM: dgm1
      ? finite(dgm1.maxElevationM)
      : (elevationStatus === 'legacy' ? Math.max(...legacyProfile) : null),
    maxUphillGradePct: dgm1 ? finite(dgm1.maxUphillGradePct) : null,
    maxDownhillGradePct: dgm1 ? finite(dgm1.maxDownhillGradePct) : null,
    mappedPathDistanceM: dgm1 ? finite(dgm1.mappedPathDistanceM) : null,
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
    elevationStatus,
    elevationSource,
    elevationSamplingM: dgm1 ? finite(dgm1.effectiveSpacingM) : legacyMetric(edge?.elevation_metric_sampling_m),
    elevationProfileM: elevationStatus === 'legacy' ? legacyProfile : [],
  };
}

export function routeProfilePolyline(profile, width = 240, height = 56) {
  return elevationProfilePolyline(profile, width, height);
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
  const legacyProfile = evidence.elevationStatus === 'legacy'
    ? routeProfilePolyline(evidence.elevationProfileM)
    : { points: '', min: evidence.minElevationM, max: evidence.maxElevationM };
  const fromName = localized(from?.name, language, from?.id ?? edge.from);
  const toName = localized(to?.name, language, to?.id ?? edge.to);
  const profileLabel = language === 'de' ? 'Höhenprofil' : 'Elevation profile';
  const sourceLabel = evidence.elevationStatus === 'dgm1'
    ? (language === 'de' ? 'ATKIS-DGM1 · DHHN2016_NH · Gelände' : 'ATKIS-DGM1 · DHHN2016_NH · terrain')
    : evidence.elevationStatus === 'legacy'
      ? (language === 'de' ? 'Fallback: Copernicus GLO-90 · grobes Gelände' : 'Fallback: Copernicus GLO-90 · coarse terrain')
      : (language === 'de' ? 'Keine Geländehöhen verfügbar' : 'No terrain elevation available');
  const terrainRange = evidence.minElevationM != null && evidence.maxElevationM != null
    ? `${evidence.minElevationM.toFixed(0)}–${evidence.maxElevationM.toFixed(0)} m`
    : '—';
  const steepParts = [];
  if (evidence.maxUphillGradePct > 0) {
    steepParts.push(language === 'de'
      ? `bergauf ${evidence.maxUphillGradePct.toFixed(1)} %`
      : `uphill ${evidence.maxUphillGradePct.toFixed(1)}%`);
  }
  if (evidence.maxDownhillGradePct < 0) {
    steepParts.push(language === 'de'
      ? `bergab ${Math.abs(evidence.maxDownhillGradePct).toFixed(1)} %`
      : `downhill ${Math.abs(evidence.maxDownhillGradePct).toFixed(1)}%`);
  }
  const steepText = steepParts.length
    ? (language === 'de'
      ? `Steilste ~${Math.round(evidence.elevationSamplingM ?? 20)}-m-Segmente: ${steepParts.join(', ')}.`
      : `Steepest ~${Math.round(evidence.elevationSamplingM ?? 20)} m segments: ${steepParts.join(', ')}.`)
    : (language === 'de' ? 'Kurzsegment-Steigungen sind für diese Quelle nicht qualifiziert.' : 'Short-segment grades are not qualified for this source.');
  const confidenceNote = elevationConfidenceSummary(evidence, language);
  const unknownsNote = evidence.elevationStatus === 'dgm1'
    ? elevationUnknownsLabel(language)
    : (language === 'de'
      ? 'Die Geländedaten sind keine Aussage über Barrieren, Wegzustand oder individuelle Anstrengung.'
      : 'Terrain data do not establish barriers, path condition or individual effort.');
  const profileDistanceText = evidence.mappedPathDistanceM == null
    ? ''
    : (language === 'de'
      ? `profilierter kartierter Weg ${Math.round(evidence.mappedPathDistanceM)} m; `
      : `profiled mapped path ${Math.round(evidence.mappedPathDistanceM)} m; `);
  const endpointElevationText = evidence.startElevationM == null || evidence.endElevationM == null
    ? ''
    : (language === 'de'
      ? `Start ${evidence.startElevationM.toFixed(0)} m, Ende ${evidence.endElevationM.toFixed(0)} m; `
      : `start ${evidence.startElevationM.toFixed(0)} m, end ${evidence.endElevationM.toFixed(0)} m; `);
  const netGradeText = evidence.netGradePct == null
    ? (language === 'de' ? 'Netto-Steigung unbekannt' : 'net grade unknown')
    : (language === 'de' ? `Netto-Steigung ${evidence.netGradePct.toFixed(1)} %` : `net grade ${evidence.netGradePct.toFixed(1)}%`);
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
        <div><dt>${language === 'de' ? 'Planzeit' : 'Plan time'}</dt><dd>${evidence.walkingMin == null ? '—' : `${evidence.walkingMin} ${i18n.t('minutes')}*`}</dd></div>
        <div><dt>${language === 'de' ? 'Anstieg' : 'Ascent'}</dt><dd>${evidence.ascentM == null ? '—' : `${evidence.ascentM.toFixed(0)} m`}</dd></div>
        <div><dt>${language === 'de' ? 'Abstieg' : 'Descent'}</dt><dd>${evidence.descentM == null ? '—' : `${evidence.descentM.toFixed(0)} m`}</dd></div>
        <div><dt>${language === 'de' ? 'Netto-Steigung' : 'Net grade'}</dt><dd>${evidence.netGradePct == null ? '—' : `${evidence.netGradePct.toFixed(1)} %`}</dd></div>
        <div><dt>${language === 'de' ? 'Geländehöhe' : 'Terrain range'}</dt><dd>${terrainRange}</dd></div>
      </dl>
      ${evidence.elevationStatus !== 'unknown' ? `<figure class="route-profile" data-route-profile="${escapeHtml(evidence.routeId ?? '')}">
        <figcaption>${escapeHtml(profileLabel)} · ${terrainRange} · ${escapeHtml(sourceLabel)}</figcaption>
        <div data-route-profile-graphic${evidence.elevationStatus === 'dgm1' ? ' hidden' : ''}>${legacyProfile.points ? `<svg viewBox="0 0 240 56" aria-hidden="true" focusable="false"><polyline points="${legacyProfile.points}" vector-effect="non-scaling-stroke"></polyline></svg>` : ''}</div>
        ${evidence.elevationStatus === 'dgm1' ? `<button type="button" class="action-button action-button--quiet route-profile__toggle" data-route-profile-load aria-expanded="false">${language === 'de' ? 'Höhenprofil laden' : 'Load elevation profile'}</button>` : ''}
        <p class="route-profile__text">${language === 'de'
    ? `Textfassung: ${profileDistanceText}${endpointElevationText}Bereich ${terrainRange}; Anstieg ${evidence.ascentM == null ? 'unbekannt' : `${evidence.ascentM.toFixed(0)} m`}; Abstieg ${evidence.descentM == null ? 'unbekannt' : `${evidence.descentM.toFixed(0)} m`}; ${netGradeText}. ${steepText}`
    : `Text equivalent: ${profileDistanceText}${endpointElevationText}range ${terrainRange}; ascent ${evidence.ascentM == null ? 'unknown' : `${evidence.ascentM.toFixed(0)} m`}; descent ${evidence.descentM == null ? 'unknown' : `${evidence.descentM.toFixed(0)} m`}; ${netGradeText}. ${steepText}`}</p>
        <p class="uncertainty-note">${escapeHtml(confidenceNote)}</p>
        <p class="uncertainty-note">${escapeHtml(unknownsNote)}</p>
      </figure>` : `<section class="route-profile route-profile--unavailable"><h3>${escapeHtml(profileLabel)}</h3><p>${escapeHtml(sourceLabel)}</p></section>`}
      <section class="route-evidence" aria-label="${language === 'de' ? 'Wegevidenz' : 'Route evidence'}">
        <h3>${language === 'de' ? 'Oberfläche & Zugang' : 'Surface & access'}</h3>
        <p><strong>${escapeHtml(accessLabel(evidence.mappedPathAccessibility, language))}</strong></p>
        <p>${escapeHtml(surfaceSummary(evidence, language))}</p>
        <p>${escapeHtml(stepNote)}</p>
        <p>${escapeHtml(wheelchairSummary(evidence, language))}</p>
        <p>${escapeHtml(handrailSummary(evidence, language))}</p>
        <p class="uncertainty-note">${escapeHtml(endpointNote)}</p>
        <p class="uncertainty-note">${language === 'de' ? '* Planzeit ist nur eine bestehende Strecken-/Anstiegs-Näherung; sie ist keine kalibrierte Aussage zu individueller Gehfähigkeit oder Energie.' : '* Plan time is only the existing distance/ascent approximation; it is not a calibrated statement about individual walking ability or energy.'}</p>
      </section>
      <div class="detail-actions">
        <button class="action-button action-button--quiet" type="button" data-route-node="${escapeHtml(from?.id ?? edge.from)}">${language === 'de' ? 'Start öffnen' : 'Open start'}</button>
        <button class="action-button action-button--quiet" type="button" data-route-node="${escapeHtml(to?.id ?? edge.to)}">${language === 'de' ? 'Ziel öffnen' : 'Open destination'}</button>
      </div>
    </div>
  `;
  if (evidence.elevationStatus === 'dgm1' && evidence.routeId) {
    const renderedRouteId = evidence.routeId;
    const profileButton = container.querySelector('[data-route-profile-load]');
    const graphic = container.querySelector('[data-route-profile-graphic]');
    let profileLoaded = false;
    profileButton?.addEventListener('click', async () => {
      if (!graphic) return;
      if (profileLoaded) {
        graphic.hidden = !graphic.hidden;
        profileButton.setAttribute('aria-expanded', graphic.hidden ? 'false' : 'true');
        profileButton.textContent = graphic.hidden
          ? (language === 'de' ? 'Höhenprofil anzeigen' : 'Show elevation profile')
          : (language === 'de' ? 'Höhenprofil ausblenden' : 'Hide elevation profile');
        return;
      }
      profileButton.disabled = true;
      profileButton.textContent = language === 'de' ? 'Höhenprofil wird geladen…' : 'Loading elevation profile…';
      try {
        const distanceProfile = await loadRouteElevationProfile(renderedRouteId);
        const figure = container.querySelector('[data-route-profile]');
        if (!figure || figure.dataset.routeProfile !== renderedRouteId || !distanceProfile) throw new Error('profile unavailable');
        const plot = routeProfilePolyline(distanceProfile);
        if (!plot.points) throw new Error('profile unavailable');
        graphic.innerHTML = `<svg viewBox="0 0 240 56" aria-hidden="true" focusable="false"><polyline points="${plot.points}" vector-effect="non-scaling-stroke"></polyline></svg>`;
        profileLoaded = true;
        graphic.hidden = false;
        profileButton.disabled = false;
        profileButton.setAttribute('aria-expanded', 'true');
        profileButton.textContent = language === 'de' ? 'Höhenprofil ausblenden' : 'Hide elevation profile';
      } catch {
        profileButton.textContent = language === 'de' ? 'Höhenprofil nicht verfügbar' : 'Elevation profile unavailable';
        profileButton.setAttribute('aria-expanded', 'false');
      }
    });
  }
  const closeButton = container.querySelector('[data-action="close-route"]');
  closeButton?.addEventListener('click', () => {
    container.hidden = true;
    onClose?.();
  });
  for (const button of container.querySelectorAll('[data-route-node]')) button.addEventListener('click', () => onSelectNode?.(button.dataset.routeNode));
  closeButton?.focus();
}
