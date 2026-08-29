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

/**
 * Project existing bilingual editorial authority into one quiet narration descriptor.
 * This function never starts audio, fetches media, or mutates content.
 */
export function createNarrationDescriptor(node, language = 'de') {
  if (!node?.id) return null;
  const title = localized(node.name, language, node.title ?? node.id);
  const sections = NARRATION_FIELDS
    .map(([key, heading]) => ({
      key,
      heading: localized(heading, language, key),
      text: localized(node[key], language),
    }))
    .filter(({ text }) => Boolean(text));
  if (!title && !sections.length) return null;
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
export function createSpeechNarrator({
  speechSynthesisRef = globalThis.speechSynthesis,
  UtteranceCtor = globalThis.SpeechSynthesisUtterance,
} = {}) {
  let active = null;
  let state = 'idle';

  const supported = Boolean(
    speechSynthesisRef
    && typeof speechSynthesisRef.speak === 'function'
    && typeof speechSynthesisRef.cancel === 'function'
    && typeof UtteranceCtor === 'function',
  );

  function finish(expectedId, nextState, onState) {
    if (!active || active.id !== expectedId) return;
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

      const utterance = new UtteranceCtor(descriptor.speechText);
      utterance.lang = descriptor.langTag;
      try {
        const voices = speechSynthesisRef.getVoices?.() ?? [];
        const preferred = voices.find((voice) => voice.lang?.toLowerCase().startsWith(descriptor.language));
        if (preferred) utterance.voice = preferred;
      } catch {
        // Voice enumeration is optional. The browser's default voice remains valid.
      }

      active = { id: descriptor.id, utterance };
      state = 'playing';
      onState?.('playing');
      utterance.onend = () => finish(descriptor.id, 'idle', onState);
      utterance.onerror = () => finish(descriptor.id, 'idle', onState);
      speechSynthesisRef.speak(utterance);
      return true;
    },
    stop({ onState } = {}) {
      if (!active) return false;
      active = null;
      state = 'idle';
      speechSynthesisRef.cancel();
      onState?.('idle');
      return true;
    },
  });
}
