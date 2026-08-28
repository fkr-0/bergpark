import { createHash } from 'node:crypto';

export function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function graphCounts(graph = {}) {
  const keys = [
    'nodes',
    'edges',
    'trees',
    'benches',
    'path_nodes',
    'path_segments',
    'visitor_pois',
    'figures',
    'artworks',
    'collections',
    'semantic_edges',
  ];
  return Object.fromEntries(keys.map((key) => [key, Array.isArray(graph[key]) ? graph[key].length : 0]));
}

export function projectWalkingNetwork(pathTopology = {}, graph = {}, hashes = {}) {
  const seenPairs = new Set();
  const segments = [];

  for (const segment of pathTopology.directed_segments ?? []) {
    if (!Array.isArray(segment.geometry) || segment.geometry.length < 2) continue;
    const pairKey = [segment.from, segment.to].sort().join('|');
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);
    segments.push({
      id: segment.id,
      from: segment.from,
      to: segment.to,
      geometry: segment.geometry,
      distance_m: Number.isFinite(segment.distance_m) ? segment.distance_m : null,
      surface: segment.surface ?? null,
      highway: segment.highway ?? null,
      steps: segment.steps === true,
      routing_eligible: segment.routing_eligible !== false,
      pedestrian_oneway: segment.pedestrian_oneway ?? null,
      accessibility_status: segment.accessibility_status ?? 'unknown',
    });
  }

  return {
    schema_version: 1,
    generated_from: {
      path_topology: {
        schema_version: pathTopology.schema_version ?? null,
        generated_at: pathTopology.generated_at ?? null,
        sha256: hashes.pathTopologySha256 ?? null,
      },
      graph: {
        schema_version: graph.schema_version ?? null,
        generated_at: graph.generated_at ?? null,
        sha256: hashes.graphSha256 ?? null,
        counts: graphCounts(graph),
      },
    },
    status: pathTopology.status ?? 'unknown',
    counts: {
      path_nodes: pathTopology.path_node_count ?? pathTopology.path_nodes?.length ?? 0,
      directed_segments: pathTopology.directed_segment_count ?? pathTopology.directed_segments?.length ?? 0,
      rendered_segments: segments.length,
      connected_components: pathTopology.connected_components?.length ?? 0,
    },
    coverage: pathTopology.coverage ?? null,
    segments,
  };
}
