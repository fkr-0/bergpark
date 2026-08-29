import assert from 'node:assert/strict';
import test from 'node:test';
import { deepLinkHash, parseDeepLink } from '../src/deep-link.js';
import { createSpatialWorld, createWalkingNetworkDescriptor, spatialPosition } from '../src/spatial-world.js';

test('SpatialWorld keeps canonical identity with WGS84 lng/lat descriptors and provenance', () => {
  const graph = {
    nodes: [{
      id: 'herkules',
      lat: 51.3161,
      lng: 9.3932,
      elevation_m: 530,
      position_source: { provider: 'OpenStreetMap', element: 'relation/164756' },
      elevation_source: { provider: 'Open-Meteo Elevation API', dataset: 'Copernicus DEM 2021 GLO-90', resolution_m: 90 },
      leafletMarker: { rendererHandle: true },
    }],
    edges: [{ id: 'herkules--kaskaden', from: 'herkules', to: 'kaskaden', distance_m: 100, walking_min: 2, path_coordinates: [[51.3161, 9.3932], [51.3159, 9.3963]] }],
    trees: [{ id: 'tree-1', lat: 51.31, lng: 9.4, elevation_m: 300 }],
    visitorLayers: { features: [{ id: 'bench-1', layerKind: 'bench', lat: 51.32, lng: 9.41 }] },
  };
  const world = createSpatialWorld(graph);
  const place = world.placesById.get('herkules');
  assert.equal(world.crs, 'EPSG:4326');
  assert.equal(world.coordinateOrder, 'lng-lat');
  assert.deepEqual([place.position.lng, place.position.lat], [9.3932, 51.3161]);
  assert.equal(place.position.elevationM, 530);
  assert.equal(place.position.provenance.position.provider, 'OpenStreetMap');
  assert.deepEqual(place.deepLink, { kind: 'place', id: 'herkules' });
  assert.deepEqual(parseDeepLink(deepLinkHash(place.deepLink.kind, place.deepLink.id)), place.deepLink);
  assert.deepEqual(world.routesById.get('herkules--kaskaden').coordinates[0], { lng: 9.3932, lat: 51.3161 });
  assert.equal(world.treesById.get('tree-1').deepLink.id, 'tree-1');
  assert.equal(world.visitorFeaturesById.get('bench-1').deepLink.id, 'bench-1');
  assert.doesNotMatch(JSON.stringify(world), /leaflet|maplibregl|THREE|rendererHandle/);
});

test('SpatialWorld never invents elevation and rejects incomplete coordinates', () => {
  assert.deepEqual(spatialPosition({ lat: 51, lng: 9 }), { lng: 9, lat: 51 });
  assert.equal(spatialPosition({ lat: 51 }), null);
  assert.equal(spatialPosition({ lat: '', lng: 9 }), null);
});

test('walking-network descriptor converts legacy lat/lng tuples at the renderer boundary', () => {
  const network = createWalkingNetworkDescriptor({
    counts: { path_nodes: 2, directed_segments: 1 },
    segments: [{
      id: 'pathseg-a--b',
      from: 'pathnode-a',
      to: 'pathnode-b',
      steps: true,
      surface: 'stone_steps',
      highway: 'steps',
      distance_m: 42,
      accessibility_status: 'known_steps',
      geometry: [[51.31, 9.41], [51.32, 9.42]],
    }],
  });
  assert.deepEqual(network.segments[0].coordinates, [{ lng: 9.41, lat: 51.31 }, { lng: 9.42, lat: 51.32 }]);
  assert.equal(network.segments[0].id, 'pathseg-a--b');
  assert.equal(network.segments[0].steps, true);
  assert.equal(network.segments[0].surface, 'stone_steps');
  assert.equal(network.nodesById.get('pathnode-a').degree, 1);
  assert.deepEqual(network.nodesById.get('pathnode-b').position, { lng: 9.42, lat: 51.32 });
});
