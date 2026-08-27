import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceMetres, nearestNode } from '../src/gps.js';
import { localized } from '../src/i18n.js';
import { filterGlossary } from '../src/glossary.js';
import { filterTrees } from '../src/trees.js';
import { edgeBetween } from '../src/data.js';

test('distanceMetres produces plausible park-scale distances', () => {
  const hercules = { lat: 51.31723, lng: 9.3905 };
  const palace = { lat: 51.31498, lng: 9.41593 };
  const distance = distanceMetres(hercules, palace);
  assert.ok(distance > 1_700 && distance < 1_900, `unexpected distance ${distance}`);
});

test('nearestNode honors the 30 metre geofence', () => {
  const nodes = [
    { id: 'a', lat: 51.3167, lng: 9.4167 },
    { id: 'b', lat: 51.3175, lng: 9.4167 },
  ];
  assert.equal(nearestNode({ lat: 51.31671, lng: 9.4167 }, nodes, 30)?.node.id, 'a');
  assert.equal(nearestNode({ lat: 51.3171, lng: 9.4167 }, nodes, 30), null);
});

test('localized falls back predictably between languages', () => {
  assert.equal(localized({ de: 'Schloss', en: 'Palace' }, 'en'), 'Palace');
  assert.equal(localized({ de: 'Schloss' }, 'en'), 'Schloss');
});

test('glossary search is diacritic-insensitive', () => {
  const nodes = [
    { id: 'a', name: { de: 'Aquädukt', en: 'Aqueduct' }, type: 'waterfeature' },
    { id: 'b', name: { de: 'Löwenburg', en: 'Löwenburg' }, type: 'castle' },
  ];
  assert.deepEqual(filterGlossary(nodes, 'aquadukt', 'de').map(({ id }) => id), ['a']);
  assert.deepEqual(filterGlossary(nodes, 'castle', 'en').map(({ id }) => id), ['b']);
});

test('glossary search discovers semantic roles and object types', () => {
  const nodes = [
    { id: 'person', name: { de: 'Person', en: 'Person' }, type: 'historical_figure', roles: ['architect'], searchTerms: ['architect'] },
    { id: 'art', name: { de: 'Werk', en: 'Work' }, type: 'artwork', object_type: 'painting', searchTerms: ['painting'] },
  ];
  assert.deepEqual(filterGlossary(nodes, 'architect', 'de').map(({ id }) => id), ['person']);
  assert.deepEqual(filterGlossary(nodes, 'painting', 'en').map(({ id }) => id), ['art']);
});

test('tree filters combine species and significance', () => {
  const trees = [
    { id: 'oak', species: { de: 'Stieleiche', en: 'Pedunculate oak' }, significance: 'landmark' },
    { id: 'beech', species: { de: 'Rotbuche', en: 'European beech' }, significance: 'catalogued' },
  ];
  assert.deepEqual(filterTrees(trees, { species: 'Stieleiche', significance: 'landmark', language: 'de' }).map(({ id }) => id), ['oak']);
});

test('tree filters combine location with legacy catalogue schema variants', () => {
  const trees = [
    { id: 'a', species_de: 'Eiche', location_description: 'Südtor der Löwenburg', catalogue_ref: '10', denotation: 'landmark' },
    { id: 'b', species: { de: 'Eiche', scientific: 'Quercus robur' }, location: 'Kaskaden', catalog_ref: '11', denotation: 'landmark' },
  ];
  assert.deepEqual(filterTrees(trees, { query: '10', location: 'loewenburg', significance: 'landmark', language: 'de' }).map(({ id }) => id), ['a']);
});

test('edgeBetween resolves directed graph routes', () => {
  const graph = { outgoing: new Map([['a', [{ from: 'a', to: 'b', distance_m: 100 }]]]) };
  assert.equal(edgeBetween(graph, 'a', 'b').distance_m, 100);
  assert.equal(edgeBetween(graph, 'b', 'a'), null);
});
