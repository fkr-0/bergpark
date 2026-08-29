import { localized } from './i18n.js';

const SEMANTIC_TYPES = new Set(['historical_figure', 'artwork', 'collection']);

const FEATURE_KIND_LABELS = {
  bench: { de: 'Bank', en: 'Bench' },
  access: { de: 'Zugang', en: 'Access point' },
  toilet: { de: 'Toilette', en: 'Toilet' },
  drinking_water: { de: 'Trinkwasser', en: 'Drinking water' },
  viewpoint: { de: 'Aussichtspunkt', en: 'Viewpoint' },
  shelter: { de: 'Unterstand', en: 'Shelter' },
  transit: { de: 'ÖPNV-Zugang', en: 'Transit access' },
  artwork: { de: 'Kunstobjekt', en: 'Artwork' },
};

const ROLE_LABELS = {
  architect: { de: 'Architekt', en: 'Architect' },
  court_architect: { de: 'Hofarchitekt', en: 'Court architect' },
  restoration_architect: { de: 'Restaurierungsarchitekt', en: 'Restoration architect' },
  hydraulic_engineer: { de: 'Wasserbauingenieur', en: 'Hydraulic engineer' },
  waterworks_designer: { de: 'Planer der Wasserkünste', en: 'Waterworks designer' },
  landscape_designer: { de: 'Landschaftsgestalter', en: 'Landscape designer' },
  garden_inspector: { de: 'Garteninspektor', en: 'Garden inspector' },
  court_gardener: { de: 'Hofgärtner', en: 'Court gardener' },
  sculptor: { de: 'Bildhauer', en: 'Sculptor' },
  court_sculptor: { de: 'Hofbildhauer', en: 'Court sculptor' },
  painter: { de: 'Maler', en: 'Painter' },
  artist: { de: 'Künstler', en: 'Artist' },
  collector: { de: 'Sammler', en: 'Collector' },
  patron: { de: 'Auftraggeber', en: 'Patron' },
  landgrave: { de: 'Landgraf', en: 'Landgrave' },
  elector: { de: 'Kurfürst', en: 'Elector' },
  king_of_westphalia: { de: 'König von Westphalen', en: 'King of Westphalia' },
};

const OBJECT_TYPE_LABELS = {
  painting: { de: 'Gemälde', en: 'Painting' },
  garden_sculpture: { de: 'Gartenskulptur', en: 'Garden sculpture' },
  monumental_sculpture: { de: 'Monumentalskulptur', en: 'Monumental sculpture' },
  architectural_drawing: { de: 'Architekturzeichnung', en: 'Architectural drawing' },
  architectural_model: { de: 'Architekturmodell', en: 'Architectural model' },
};

const SOURCE_ORDER = {
  place: 0,
  content: 1,
  semantic: 2,
  tree: 3,
  feature: 4,
};

export const DEFAULT_DESTINATION_RESULT_LIMIT = 80;
export const DESTINATION_CATEGORIES = Object.freeze(['all', 'place', 'story', 'tree', 'feature']);

export function normalizeSearchText(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .trim();
}

export function destinationCategory(result) {
  if (result?.routeKind === 'tree') return 'tree';
  if (result?.routeKind === 'feature') return 'feature';
  if (result?.sourceKind === 'place') return 'place';
  return 'story';
}

function coordinate(item) {
  const rawLat = item?.lat;
  const rawLng = item?.lng ?? item?.lon;
  if (rawLat == null || rawLng == null || rawLat === '' || rawLng === '') return null;
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function calmPlaceKind(type, language) {
  const normalized = String(type ?? '').toLocaleLowerCase().replaceAll('_', '-');
  const direct = {
    palace: { de: 'Schloss', en: 'Palace' },
    castle: { de: 'Burg', en: 'Castle' },
    temple: { de: 'Tempel', en: 'Temple' },
    bridge: { de: 'Brücke', en: 'Bridge' },
    viewpoint: { de: 'Aussichtspunkt', en: 'Viewpoint' },
    monument: { de: 'Denkmal', en: 'Monument' },
    ruin: { de: 'Ruine', en: 'Ruin' },
    grotto: { de: 'Grotte', en: 'Grotto' },
    building: { de: 'Bauwerk', en: 'Building' },
    village: { de: 'Historischer Ort', en: 'Historic place' },
  }[normalized];
  if (direct) return localized(direct, language, normalized);
  if (/(water|fountain|basin|reservoir|lake|pond|hydraulic)/.test(normalized)) return language === 'de' ? 'Wasserkunst' : 'Water feature';
  if (/(restaurant|hotel|visitor-center|visitor-facility|visitor-service)/.test(normalized)) return language === 'de' ? 'Besucherort' : 'Visitor place';
  if (/(sculpture|monument)/.test(normalized)) return language === 'de' ? 'Denkmal & Kunst' : 'Monument & art';
  if (/(building|castle|palace|tower|chapel|pavilion|greenhouse|hut|cellar|farm|museum|bridge)/.test(normalized)) return language === 'de' ? 'Historisches Bauwerk' : 'Historic structure';
  if (/(landscape|park)/.test(normalized)) return language === 'de' ? 'Parkbereich' : 'Park area';
  return language === 'de' ? 'Ort' : 'Place';
}

function semanticKind(type, language) {
  if (type === 'historical_figure') return language === 'de' ? 'Person' : 'Person';
  if (type === 'artwork') return language === 'de' ? 'Kunstwerk' : 'Artwork';
  if (type === 'collection') return language === 'de' ? 'Sammlung' : 'Collection';
  return language === 'de' ? 'Inhalt' : 'Story & context';
}

function roleLabel(role, language) {
  const known = ROLE_LABELS[role];
  if (known) return localized(known, language, role);
  if (language === 'en') return String(role).replaceAll('_', ' ');
  if (String(role).includes('architect')) return 'Architekt';
  if (String(role).includes('designer')) return 'Gestaltung';
  if (String(role).includes('sculptor')) return 'Bildhauer';
  if (String(role).includes('gardener')) return 'Gärtner';
  return 'Historische Rolle';
}

function objectTypeLabel(type, language) {
  const known = OBJECT_TYPE_LABELS[type];
  if (known) return localized(known, language, type);
  return type ? (language === 'de' ? 'Kunstobjekt' : String(type).replaceAll('_', ' ')) : '';
}

function visitorKindLabel(kind, language) {
  return localized(FEATURE_KIND_LABELS[kind], language, language === 'de' ? 'Besucherhinweis' : 'Visitor feature');
}

function treeSpecies(tree, language) {
  if (typeof tree?.species === 'string') return tree.species;
  return localized(tree?.species, language, tree?.species?.scientific ?? tree?.species_de ?? tree?.species_en ?? tree?.taxon ?? '');
}

function treeCatalogueRef(tree) {
  return tree?.catalog_ref ?? tree?.catalogue_ref ?? tree?.catalogRef ?? '';
}

function treeLocation(tree) {
  return tree?.location_description ?? tree?.location?.description ?? tree?.location ?? tree?.park_sector ?? tree?.sector ?? '';
}

function featureSourceId(feature) {
  return feature?.osm_node_id ?? feature?.osm_element?.id ?? feature?.id?.replace(/^bench-/, '') ?? '';
}

function facet(values, label) {
  return {
    values: values.flat().filter((value) => value != null && value !== ''),
    label: label || null,
  };
}

function entityResult(entity, nodeIds, language) {
  const type = entity?.type ?? entity?.kind ?? 'entity';
  const semantic = SEMANTIC_TYPES.has(type);
  const sourceKind = semantic ? 'semantic' : nodeIds.has(entity.id) ? 'place' : 'content';
  const kindLabel = semantic ? semanticKind(type, language) : calmPlaceKind(type, language);
  const roles = entity?.roles ?? [];
  const objectType = entity?.object_type;
  const title = localized(entity?.name, language, entity?.title ?? entity?.id ?? '');
  const roleFacets = roles.map((role) => facet([role, roleLabel(role, language)], roleLabel(role, language)));
  const objectFacet = objectType ? facet([objectType, objectTypeLabel(objectType, language)], objectTypeLabel(objectType, language)) : null;
  const context = semantic && roles.length
    ? roleLabel(roles[0], language)
    : semantic && objectType
      ? objectTypeLabel(objectType, language)
      : '';
  const point = coordinate(entity);
  return {
    id: entity.id,
    routeKind: 'place',
    sourceKind,
    title,
    kindLabel,
    context,
    coordinate: point,
    spatial: Boolean(point),
    item: entity,
    facets: [facet([type, kindLabel], kindLabel), ...roleFacets, ...(objectFacet ? [objectFacet] : [])],
    keywords: [
      entity.id,
      ...(entity?.aliases ?? []),
      ...(entity?.searchTerms ?? []),
      ...(entity?.tags ?? []),
      entity?.creator_id,
      entity?.current_place_id,
    ].filter(Boolean),
    body: [
      localized(entity?.description, language),
      localized(entity?.summary, language),
      localized(entity?.history, language),
      localized(entity?.architecture, language),
      localized(entity?.significance, language),
      localized(entity?.visitorContext, language),
    ].filter(Boolean),
  };
}

function treeResult(tree, language) {
  const species = treeSpecies(tree, language);
  const catalogueRef = treeCatalogueRef(tree);
  const title = localized(tree?.name, language, species || catalogueRef || tree?.id || '');
  const contextParts = [catalogueRef ? `${language === 'de' ? 'Katalog' : 'Catalogue'} ${catalogueRef}` : '', species && species !== title ? species : ''].filter(Boolean);
  const point = coordinate(tree);
  return {
    id: tree.id,
    routeKind: 'tree',
    sourceKind: 'tree',
    title,
    kindLabel: language === 'de' ? 'Katalogbaum' : 'Catalogued tree',
    context: contextParts.join(' · '),
    coordinate: point,
    spatial: Boolean(point),
    item: tree,
    facets: [facet(['tree', 'baum', 'catalogued tree', 'Katalogbaum'], language === 'de' ? 'Katalogbaum' : 'Catalogued tree')],
    keywords: [tree.id, catalogueRef, species, tree?.species?.scientific, treeLocation(tree), tree?.significance, tree?.denotation].filter(Boolean),
    body: [localized(tree?.description, language)].filter(Boolean),
  };
}

function featureResult(feature, language) {
  const kind = feature?.layerKind ?? feature?.family ?? 'visitor_poi';
  const kindLabel = visitorKindLabel(kind, language);
  const sourceId = featureSourceId(feature);
  const title = localized(feature?.name, language, feature?.name ?? `${kindLabel}${sourceId ? ` · ${sourceId}` : ''}`);
  const point = coordinate(feature);
  return {
    id: feature.id,
    routeKind: 'feature',
    sourceKind: 'feature',
    title,
    kindLabel,
    context: sourceId && !title.includes(String(sourceId)) ? String(sourceId) : '',
    coordinate: point,
    spatial: Boolean(point),
    item: feature,
    facets: [facet([kind, kindLabel], kindLabel)],
    keywords: [feature.id, sourceId, ...Object.values(feature?.source_tags ?? {})].filter(Boolean),
    body: [],
  };
}

export function createDestinationIndex({ entities = [], nodeIds = new Set(), trees = [], visitorFeatures = [], language = 'de' } = {}) {
  const ids = nodeIds instanceof Set ? nodeIds : new Set(nodeIds ?? []);
  const results = [
    ...entities.filter((entity) => entity?.id).map((entity) => entityResult(entity, ids, language)),
    ...trees.filter((tree) => tree?.id).map((tree) => treeResult(tree, language)),
    ...visitorFeatures.filter((feature) => feature?.id).map((feature) => featureResult(feature, language)),
  ];
  const unique = new Map();
  for (const result of results) unique.set(`${result.routeKind}:${result.id}`, result);
  return [...unique.values()];
}

function fieldMatch(value, needle) {
  const normalized = normalizeSearchText(value);
  if (!normalized) return null;
  if (normalized === needle) return 0;
  if (normalized.startsWith(needle)) return 1;
  if (normalized.includes(needle)) return 2;
  return null;
}

function bestScore(result, needle) {
  let best = null;
  const consider = (score, matchLabel = null) => {
    if (score == null) return;
    if (!best || score < best.score) best = { score, matchLabel };
  };

  consider(fieldMatch(result.title, needle), null);
  for (const facetEntry of result.facets ?? []) {
    for (const value of facetEntry.values) {
      const match = fieldMatch(value, needle);
      consider(match == null ? null : 3 + match, facetEntry.label);
    }
  }
  for (const value of result.keywords ?? []) {
    const match = fieldMatch(value, needle);
    consider(match == null ? null : 7 + match, null);
  }
  for (const value of result.body ?? []) {
    const match = fieldMatch(value, needle);
    consider(match == null ? null : 20 + match, null);
  }
  return best;
}

function compareResults(a, b, language) {
  if (a.score !== b.score) return a.score - b.score;
  const sourceDelta = (SOURCE_ORDER[a.sourceKind] ?? 99) - (SOURCE_ORDER[b.sourceKind] ?? 99);
  if (sourceDelta) return sourceDelta;
  return a.title.localeCompare(b.title, language);
}

export function searchDestinationIndex(index, query = '', language = 'de', {
  limit = DEFAULT_DESTINATION_RESULT_LIMIT,
  category = 'all',
} = {}) {
  const needle = normalizeSearchText(query);
  const normalizedCategory = DESTINATION_CATEGORIES.includes(category) ? category : 'all';
  const ranked = [];
  for (const result of index ?? []) {
    if (normalizedCategory !== 'all' && destinationCategory(result) !== normalizedCategory) continue;
    const match = needle ? bestScore(result, needle) : { score: 50, matchLabel: null };
    if (!match) continue;
    ranked.push({ ...result, score: match.score, matchLabel: match.matchLabel });
  }
  ranked.sort((a, b) => compareResults(a, b, language));
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : ranked.length;
  return {
    total: ranked.length,
    results: ranked.slice(0, safeLimit),
    limited: ranked.length > safeLimit,
  };
}
