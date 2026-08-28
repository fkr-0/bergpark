import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { clusterTrees, TREE_PAGE_SIZE, treeDatasetState, treeResultPage } from '../src/trees.js';
import { normalizeSemanticData, semanticRelationLabel } from '../src/semantic.js';
import { routeEvidence, routeProfilePolyline } from '../src/routes.js';
import { treeDetailModel } from '../src/tree-detail.js';
import { clusterVisitorFeatures, normalizeVisitorLayerData } from '../src/visitor-layer-data.js';

test('tree LOD is deterministic and expands to individual records at close zoom', () => {
  const trees = [
    { id: 'a', lat: 51.31, lng: 9.41 },
    { id: 'b', lat: 51.3102, lng: 9.4102 },
    { id: 'invalid', lat: null, lng: 9.4 },
  ];
  const clustered = clusterTrees(trees, 15);
  assert.equal(clustered.length, 1);
  assert.equal(clustered[0].count, 2);
  assert.deepEqual(clusterTrees(trees, 17).map((feature) => feature.tree.id), ['a', 'b']);
});

test('tree explorer paging keeps the initial mobile DOM bounded and deterministic', () => {
  const trees = Array.from({ length: 137 }, (_, index) => ({ id: `tree-${index}` }));
  const first = treeResultPage(trees);
  const second = treeResultPage(trees, TREE_PAGE_SIZE * 2);
  assert.equal(first.visible.length, 60);
  assert.equal(first.total, 137);
  assert.equal(first.hasMore, true);
  assert.equal(second.visible.length, 120);
  assert.equal(second.hasMore, true);
  assert.deepEqual(second.visible.slice(0, 2).map(({ id }) => id), ['tree-0', 'tree-1']);
  assert.equal(treeResultPage(trees, 999).hasMore, false);
});

test('tree dataset state is explicit for empty, partial, and complete fixtures', () => {
  assert.equal(treeDatasetState([], 'catalog_spatial_enrichment_complete'), 'pending');
  assert.equal(treeDatasetState([{ id: 'a' }], 'partial'), 'partial');
  assert.equal(treeDatasetState([{ id: 'a' }], 'catalog_spatial_enrichment_complete'), 'ready');
});

test('tree detail model preserves complete, partial, and missing fields without inference', () => {
  const complete = treeDetailModel({
    id: 'tree-a',
    catalog_ref: '358',
    species: { de: 'Eiche', scientific: 'Quercus robur' },
    location_description: 'Lac',
    description: 'Katalogtext',
    elevation_m: 311,
    height_m: null,
    height_status: 'unknown_no_measurement_source',
    position_source: { provider: 'OpenStreetMap', element: 'node/1', accuracy_status: 'not_reported_by_source' },
    elevation_source: { provider: 'DEM', dataset: 'grid', resolution_m: 90 },
    image: 'https://commons.wikimedia.org/wiki/File:A.jpg',
  }, 'de');
  assert.equal(complete.catalogueRef, '358');
  assert.equal(complete.scientificName, 'Quercus robur');
  assert.equal(complete.heightM, null);
  assert.equal(complete.positionSource.accuracyStatus, 'not_reported_by_source');

  const partial = treeDetailModel({ id: 'tree-b', species_de: 'Buche' }, 'de');
  assert.equal(partial.species, 'Buche');
  assert.equal(partial.catalogueRef, null);
  assert.equal(partial.positionSource, null);
  assert.equal(treeDetailModel({ id: 'tree-c' }, 'en').title, 'tree-c');
});

test('visitor layer adapter is selective and clusters map features deterministically', () => {
  const layers = normalizeVisitorLayerData(
    { status: 'ready', benches: [{ id: 'b', lat: 51.31, lng: 9.41, source_refs: [] }] },
    { status: 'ready', pois: [{ id: 'p', family: 'toilet', lat: 51.3101, lng: 9.4101, source_refs: [] }] },
  );
  assert.deepEqual(layers.features.map(({ layerKind }) => layerKind), ['bench', 'toilet']);
  assert.equal(clusterVisitorFeatures(layers.features, 15).length, 1);
  assert.equal(clusterVisitorFeatures(layers.features, 17).length, 2);
  assert.equal(normalizeVisitorLayerData(null, null).status.benches, 'unavailable');
});

test('semantic adapter exposes figures/artworks/collections and bidirectional cross-links', () => {
  const figures = { figures: [{ id: 'person-a', kind: 'historical_figure', name: { de: 'A', en: 'A' }, source_ids: ['s'] }] };
  const semantic = {
    sources: [{ id: 's', title: 'Source' }],
    artworks: [{ id: 'art-a', kind: 'artwork', name: { de: 'Werk', en: 'Work' }, source_ids: ['s'] }],
    collections: [],
    semantic_edges: [{ id: 'r', from: 'person-a', to: 'place-a', relation: 'designed', confidence: 'high', source_ids: ['s'] }],
  };
  const normalized = normalizeSemanticData(figures, semantic);
  assert.deepEqual(normalized.entities.map(({ id }) => id), ['person-a', 'art-a']);
  assert.equal(normalized.entities[0].sources[0].title, 'Source');
  assert.equal(normalized.relationsByEntity.get('place-a')[0].id, 'r');
  assert.equal(semanticRelationLabel(semantic.semantic_edges[0], 'en'), 'designed');
});

test('route evidence keeps mapped-path and endpoint uncertainty distinct', () => {
  const edge = {
    distance_m: 300,
    walking_min: 5,
    ascent_m: 12,
    descent_m: 3,
    avg_grade_pct: 3,
    surface_mix: ['gravel', 'unknown'],
    mapped_path_accessibility: 'potentially_step_free_mapped_path',
    endpoint_access_unknown: true,
    endpoint_snap_total_m: 22.4,
    contains_steps: false,
    elevation_profile_m: [300, 306, 312],
    elevation_metric_sampling_m: 90,
    surface_segments: [{ wheelchair: 'yes', handrail: null, steps: false }],
  };
  const evidence = routeEvidence(edge);
  assert.equal(evidence.mappedPathAccessibility, 'potentially_step_free_mapped_path');
  assert.equal(evidence.endpointAccessUnknown, true);
  assert.deepEqual(evidence.wheelchairValues, ['yes']);
  assert.equal(routeProfilePolyline(edge.elevation_profile_m).points.split(' ').length, 3);
});

test('production copy excludes aggregate and audit-only payloads', async () => {
  const copyScript = await readFile(new URL('../scripts/copy-data.mjs', import.meta.url), 'utf8');
  const runtimeFiles = copyScript.match(/const runtimeFiles = \[([\s\S]*?)\n\];/)?.[1] ?? '';
  assert.doesNotMatch(runtimeFiles, /'graph\.json'/);
  assert.doesNotMatch(runtimeFiles, /'validation\.json'/);
  assert.match(runtimeFiles, /'semantic\.json'/);
  assert.match(runtimeFiles, /'trees\.json'/);
  assert.match(runtimeFiles, /'benches\.json'/);
  assert.match(runtimeFiles, /'visitor_pois\.json'/);
  assert.doesNotMatch(runtimeFiles, /'path_topology\.json'/);
  assert.match(copyScript, /writeFile\(resolve\(target, 'walking-network\.json'\)/);
});

test('service worker installs built assets, refreshes data online, and bounds visited tiles', async () => {
  const serviceWorker = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.match(serviceWorker, /pathname\.includes\('\/assets\/'\)/);
  assert.match(serviceWorker, /networkFirstData/);
  assert.match(serviceWorker, /while \(keys\.length > 80\)/);
  assert.match(serviceWorker, /bergpark-shell-v5/);
  assert.match(serviceWorker, /\.\/data\/benches\.json/);
  assert.match(serviceWorker, /\.\/data\/visitor_pois\.json/);
  assert.match(serviceWorker, /\.\/data\/walking-network\.json/);
  assert.match(serviceWorker, /cacheFirstStatic/);
  assert.match(serviceWorker, /networkFirstNavigation/);
  const runtimeData = serviceWorker.match(/const RUNTIME_DATA = \[([\s\S]*?)\n\];/)?.[1] ?? '';
  assert.doesNotMatch(runtimeData, /tile\.(?:openstreetmap|opentopomap)/);
});
