import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceMetres, evaluateProximity, nearestNode } from '../src/gps.js';
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

test('GPS proximity requires the accuracy circle to fit inside the entry radius', () => {
  const node = {
    id: 'landmark',
    lat: 51.3167,
    lng: 9.4167,
    position_source: { position_type: 'representative_point' },
  };
  const precise = evaluateProximity({ lat: 51.31671, lng: 9.4167, accuracy: 5 }, [node]);
  assert.equal(precise.status, 'entered');
  assert.equal(precise.node.id, 'landmark');
  assert.equal(precise.referenceType, 'representative_point');

  const ambiguous = evaluateProximity({ lat: 51.31682, lng: 9.4167, accuracy: 20 }, [node]);
  assert.equal(ambiguous.status, 'outside');
  assert.equal(ambiguous.node, null);
});

test('GPS proximity hysteresis retains a place until the fix is clearly outside', () => {
  const node = { id: 'a', lat: 51.3167, lng: 9.4167 };
  const retained = evaluateProximity(
    { lat: 51.31706, lng: 9.4167, accuracy: 10 },
    [node],
    { activeNodeId: 'a', enterRadiusM: 30, exitRadiusM: 45 },
  );
  assert.equal(retained.status, 'retained');
  assert.equal(retained.node.id, 'a');

  const exited = evaluateProximity(
    { lat: 51.31725, lng: 9.4167, accuracy: 5 },
    [node],
    { activeNodeId: 'a', enterRadiusM: 30, exitRadiusM: 45 },
  );
  assert.equal(exited.status, 'outside');
  assert.equal(exited.exitedNodeId, 'a');
});

test('poor or missing GPS accuracy cannot trigger or flap proximity state', () => {
  const node = { id: 'a', lat: 51.3167, lng: 9.4167 };
  const poorEntry = evaluateProximity({ lat: 51.3167, lng: 9.4167, accuracy: 120 }, [node]);
  assert.equal(poorEntry.status, 'uncertain');
  assert.equal(poorEntry.node, null);

  const poorActiveFix = evaluateProximity(
    { lat: 51.318, lng: 9.4167, accuracy: 120 },
    [node],
    { activeNodeId: 'a' },
  );
  assert.equal(poorActiveFix.status, 'uncertain');
  assert.equal(poorActiveFix.node.id, 'a');

  const missingAccuracy = evaluateProximity({ lat: 51.3167, lng: 9.4167 }, [node]);
  assert.equal(missingAccuracy.status, 'uncertain');
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
