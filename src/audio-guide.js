import { localized } from './i18n.js';

const NARRATION_FIELDS = [
  ['description', { de: 'Überblick', en: 'Overview' }],
  ['history', { de: 'Geschichte', en: 'History' }],
  ['architecture', { de: 'Architektur & Gestaltung', en: 'Architecture & design' }],
  ['significance', { de: 'Bedeutung', en: 'Significance' }],
  ['visitorContext', { de: 'Vor Ort', en: 'On site' }],
];

function narrationLanguageTag(language) {
  return language === 'en' ? 'en-GB' : 'de-DE';
}

function explicitLanguageText(value, language) {
  if (typeof value === 'string') return value.trim() ? value.trim() : '';
  if (!value || typeof value !== 'object') return '';
  const exact = value[language];
  return typeof exact === 'string' && exact.trim() ? exact.trim() : '';
}

/** Return whether this node has actual narration copy in the requested language. */
export function narrationLanguageAvailable(node, language = 'de') {
  if (!node?.id || !['de', 'en'].includes(language)) return false;
  return NARRATION_FIELDS.some(([key]) => Boolean(explicitLanguageText(node[key], language)));
}

/**
 * Project existing bilingual editorial authority into one quiet narration descriptor.
 * This function never starts audio, fetches media, or mutates content.
 */
export function createNarrationDescriptor(node, language = 'de') {
  if (!node?.id || !['de', 'en'].includes(language)) return null;
  const title = explicitLanguageText(node.name, language)
    || explicitLanguageText(node.title, language)
    || '';
  const sections = NARRATION_FIELDS
    .map(([key, heading]) => ({
      key,
      heading: localized(heading, language, key),
      text: explicitLanguageText(node[key], language),
    }))
    .filter(({ text }) => Boolean(text));
  // A title by itself is not an audio guide. Do not mislabel fallback copy as
  // translated narration under a different speech locale.
  if (!sections.length) return null;
  const speechParts = [title, ...sections.map(({ text }) => text)].filter(Boolean);
  return Object.freeze({
    id: `narration:${node.id}:${language}`,
    nodeId: node.id,
    language,
    langTag: narrationLanguageTag(language),
    title,
    sections: Object.freeze(sections.map(Object.freeze)),
    speechText: speechParts.join('. '),
    transcript: Object.freeze([
      ...(title ? [{ heading: null, text: title }] : []),
      ...sections.map(({ heading, text }) => ({ heading, text })),
    ].map(Object.freeze)),
  });
}

/**
 * Manual-only browser speech controller. Construction is inert; play() is the sole path
 * to speak(), and a second play always cancels the previous utterance first.
 */
export function createNarrationVariants(node, languages = ['de', 'en']) {
  return Object.freeze(
    [...new Set(languages)]
      .filter((language) => ['de', 'en'].includes(language))
      .filter((language) => narrationLanguageAvailable(node, language))
      .map((language) => createNarrationDescriptor(node, language))
      .filter(Boolean)
      .map(Object.freeze),
  );
}

export function createSpeechNarrator({
  speechSynthesisRef = globalThis.speechSynthesis,
  UtteranceCtor = globalThis.SpeechSynthesisUtterance,
} = {}) {
  let active = null;
  let state = 'idle';
  let generation = 0;

  const supported = Boolean(
    speechSynthesisRef
    && typeof speechSynthesisRef.speak === 'function'
    && typeof speechSynthesisRef.cancel === 'function'
    && typeof UtteranceCtor === 'function',
  );

  function finish(expectedGeneration, nextState, onState) {
    if (!active || active.generation !== expectedGeneration) return;
    active = null;
    state = nextState;
    onState?.(nextState);
  }

  return Object.freeze({
    supported,
    get state() { return state; },
    get activeId() { return active?.id ?? null; },
    play(descriptor, { onState } = {}) {
      if (!supported || !descriptor?.speechText) return false;
      if (active) speechSynthesisRef.cancel();
      const playGeneration = ++generation;

      const utterance = new UtteranceCtor(descriptor.speechText);
      utterance.lang = descriptor.langTag;
      try {
        const voices = speechSynthesisRef.getVoices?.() ?? [];
        const preferred = voices.find((voice) => voice.lang?.toLowerCase().startsWith(descriptor.language));
        if (preferred) utterance.voice = preferred;
      } catch {
        // Voice enumeration is optional. The browser's default voice remains valid.
      }

      active = { id: descriptor.id, generation: playGeneration, utterance };
      state = 'playing';
      onState?.('playing');
      utterance.onend = () => finish(playGeneration, 'idle', onState);
      utterance.onerror = () => finish(playGeneration, 'idle', onState);
      try {
        speechSynthesisRef.speak(utterance);
        return true;
      } catch {
        finish(playGeneration, 'idle', onState);
        return false;
      }
    },
    pause({ onState } = {}) {
      if (!active || state !== 'playing' || typeof speechSynthesisRef.pause !== 'function') return false;
      speechSynthesisRef.pause();
      state = 'paused';
      onState?.('paused');
      return true;
    },
    resume({ onState } = {}) {
      if (!active || state !== 'paused' || typeof speechSynthesisRef.resume !== 'function') return false;
      speechSynthesisRef.resume();
      state = 'playing';
      onState?.('playing');
      return true;
    },
    stop({ onState } = {}) {
      if (!active) return false;
      generation += 1;
      active = null;
      state = 'idle';
      speechSynthesisRef.cancel();
      onState?.('idle');
      return true;
    },
  });
}
