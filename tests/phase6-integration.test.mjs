import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { projectWalkingNetwork, sha256Buffer } from '../scripts/runtime-data.mjs';
import { createWalkingNetworkDescriptor } from '../src/spatial-world.js';
import { planWalkingRoute } from '../src/walking-router.js';

async function readJson(path) {
  const buffer = await readFile(new URL(path, import.meta.url));
  return { buffer, json: JSON.parse(buffer.toString('utf8')) };
}

test('Phase-8 walking topology projects every unique segment without shipping audit payloads', async () => {
  const [topology, graph] = await Promise.all([
    readJson('../data/path_topology.json'),
    readJson('../data/graph.json'),
  ]);
  const projected = projectWalkingNetwork(topology.json, graph.json, {
    pathTopologySha256: sha256Buffer(topology.buffer),
    graphSha256: sha256Buffer(graph.buffer),
  });
  const uniquePairs = new Set(topology.json.directed_segments.map((segment) => [segment.from, segment.to].sort().join('|')));

  assert.equal(projected.counts.path_nodes, topology.json.path_nodes.length);
  assert.equal(projected.counts.directed_segments, topology.json.directed_segments.length);
  assert.equal(projected.counts.rendered_segments, uniquePairs.size);
  assert.equal(projected.segments.length, uniquePairs.size);
  assert.equal(projected.generated_from.path_topology.sha256, sha256Buffer(topology.buffer));
  assert.equal(projected.generated_from.graph.sha256, sha256Buffer(graph.buffer));
  assert.equal(projected.generated_from.graph.counts.path_nodes, graph.json.path_nodes.length);
  assert.ok(projected.segments.every((segment) => segment.geometry.length >= 2));
  assert.ok(projected.segments.some((segment) => segment.steps));
  assert.equal(Object.keys(projected.place_anchors).length, graph.json.nodes.length);
  assert.equal(projected.place_anchors.herkules.path_node_id, 'pathnode-place-herkules');
  assert.ok(projected.segments.some((segment) => segment.source_kind === 'representative_point_snap_connector' && segment.steps === null));
  assert.ok(!('path_nodes' in projected), 'runtime projection must not duplicate the 26 MB graph audit payload');

  const descriptor = createWalkingNetworkDescriptor(projected);
  const route = planWalkingRoute(descriptor, 'herkules', 'schloss', 'shortest');
  assert.equal(route.ok, true);
  assert.ok(route.segments.length > 2, 'visitor route must traverse multiple Phase-8 topology segments');
  assert.ok(route.distanceM > 0);
  assert.ok(route.evidence.endpointUnknownSegments >= 2, 'canonical place snaps must remain explicit endpoint unknowns');
  assert.equal(route.coverage.physical_inventory_claim, false);
});

test('Phase-3 bilingual knowledge and cultural semantics remain complete for the web consumer', async () => {
  const [de, en, figures, semantic] = await Promise.all([
    readJson('../data/nodes.de.json'),
    readJson('../data/nodes.en.json'),
    readJson('../data/figures.json'),
    readJson('../data/semantic.json'),
  ]);

  assert.deepEqual(Object.keys(de.json).sort(), Object.keys(en.json).sort());
  assert.equal(Object.keys(de.json).length, 121);
  assert.ok(figures.json.figures.length >= 22, 'Phase-3 figure baseline must remain available');
  assert.ok(semantic.json.artworks.length >= 11, 'Phase-3 artwork baseline must remain available');
  assert.ok(semantic.json.collections.length >= 3, 'Phase-3 collection baseline must remain available');
  assert.ok(semantic.json.semantic_edges.length >= 48, 'Phase-3 semantic-edge baseline must remain available');
  assert.equal(de.json.flora.artworkContext.semanticArtworkId, 'artwork-flora-farnesina');
  assert.equal(en.json.flora.artworkContext.semanticArtworkId, 'artwork-flora-farnesina');
  assert.match(de.json.flora.artworkContext.attribution, /Heyd/);
  assert.match(en.json.flora.artworkContext.attribution, /Heyd/);
});
