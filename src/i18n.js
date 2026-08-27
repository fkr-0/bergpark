const STORAGE_KEY = 'bergpark-language';

const messages = {
  de: {
    appTitle: 'Bergpark Wilhelmshöhe',
    heritage: 'UNESCO-Welterbe · Kassel',
    skipMap: 'Zur Karte springen',
    mapRegion: 'Interaktive Karte des Bergparks',
    mainNavigation: 'Hauptnavigation',
    locate: 'Standort',
    locateLabel: 'Eigenen Standort anzeigen',
    map: 'Karte',
    index: 'Index',
    trees: 'Bäume',
    mapHint: 'Tippe auf einen Ort, um ihn zu entdecken.',
    loading: 'Besucherdaten werden geladen …',
    loadError: 'Kartendaten konnten nicht geladen werden.',
    gpsUnavailable: 'Standort nicht verfügbar — die Karte funktioniert weiterhin manuell.',
    gpsWatching: 'GPS-Navigation aktiv',
    nearPlace: (name) => `In der Nähe: ${name}`,
    listen: 'Anhören',
    stopAudio: 'Stopp',
    navigate: 'Weg anzeigen',
    nearby: 'Weiter in der Nähe',
    minutes: 'Min.',
    metres: 'm',
    search: 'Orte durchsuchen',
    searchPlaceholder: 'Name, Bauwerk, Wasserkunst …',
    noResults: 'Keine passenden Einträge.',
    allSpecies: 'Alle Arten',
    treeLocation: 'Ort / Parkbereich',
    allTreeLocations: 'Alle Orte / Parkbereiche',
    significance: 'Bedeutung',
    allSignificance: 'Alle Bedeutungen',
    species: 'Art',
    treeSearch: 'Baumsammlung durchsuchen',
    treePending: 'Der Baumkatalog wird aus dem Bergpark-Graph geladen, sobald die katalogisierte Baumschicht verfügbar ist.',
    treePartial: 'Der Baumkatalog ist teilweise verfügbar. Filter und Karte zeigen nur die aktuell geladenen, quellenbasierten Einträge.',
    treeResultCount: (visible, total) => `${visible} von ${total} Bäumen angezeigt`,
    moreTrees: 'Weitere Bäume anzeigen',
    close: 'Schließen',
    details: 'Details',
    source: 'Quelle',
    routeUnknown: 'Für diese Verbindung liegt noch keine Fußwegroute vor.',
  },
  en: {
    appTitle: 'Bergpark Wilhelmshöhe',
    heritage: 'UNESCO World Heritage · Kassel',
    skipMap: 'Skip to map',
    mapRegion: 'Interactive map of Bergpark Wilhelmshöhe',
    mainNavigation: 'Main navigation',
    locate: 'Location',
    locateLabel: 'Show my location',
    map: 'Map',
    index: 'Index',
    trees: 'Trees',
    mapHint: 'Tap a place to discover it.',
    loading: 'Loading visitor data …',
    loadError: 'Map data could not be loaded.',
    gpsUnavailable: 'Location is unavailable — the map still works manually.',
    gpsWatching: 'GPS navigation active',
    nearPlace: (name) => `Nearby: ${name}`,
    listen: 'Listen',
    stopAudio: 'Stop',
    navigate: 'Show route',
    nearby: 'Continue nearby',
    minutes: 'min',
    metres: 'm',
    search: 'Search places',
    searchPlaceholder: 'Name, building, water feature …',
    noResults: 'No matching entries.',
    allSpecies: 'All species',
    treeLocation: 'Location / park sector',
    allTreeLocations: 'All locations / park sectors',
    significance: 'Significance',
    allSignificance: 'All significance levels',
    species: 'Species',
    treeSearch: 'Search the tree collection',
    treePending: 'The tree catalogue will load from Bergpark Graph as soon as the catalogued tree layer is available.',
    treePartial: 'The tree catalogue is partially available. Filters and map show only the currently loaded, source-backed entries.',
    treeResultCount: (visible, total) => `Showing ${visible} of ${total} trees`,
    moreTrees: 'Show more trees',
    close: 'Close',
    details: 'Details',
    source: 'Source',
    routeUnknown: 'No walking route is available for this connection yet.',
  },
};

export function createI18n(initialLanguage) {
  let language = initialLanguage ?? localStorage.getItem(STORAGE_KEY) ?? 'de';
  if (!(language in messages)) language = 'de';
  const listeners = new Set();

  return {
    get language() {
      return language;
    },
    t(key, ...args) {
      const value = messages[language][key] ?? messages.de[key] ?? key;
      return typeof value === 'function' ? value(...args) : value;
    },
    setLanguage(nextLanguage) {
      if (!(nextLanguage in messages) || nextLanguage === language) return;
      language = nextLanguage;
      localStorage.setItem(STORAGE_KEY, language);
      document.documentElement.lang = language;
      for (const listener of listeners) listener(language);
    },
    toggle() {
      this.setLanguage(language === 'de' ? 'en' : 'de');
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function localized(value, language = 'de', fallback = '') {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return fallback;
  return value[language] ?? value.de ?? value.en ?? fallback;
}
