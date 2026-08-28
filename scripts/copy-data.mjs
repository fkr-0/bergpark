import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { projectWalkingNetwork, sha256Buffer } from './runtime-data.mjs';

const source = resolve('data');
const target = resolve('public/data');
const runtimeFiles = [
  'nodes.json',
  'nodes.de.json',
  'nodes.en.json',
  'sources.json',
  'edges.json',
  'trees.json',
  'figures.json',
  'semantic.json',
  'benches.json',
  'visitor_pois.json',
];

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });

for (const filename of runtimeFiles) {
  try {
    await copyFile(resolve(source, filename), resolve(target, filename));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

const [pathTopologyBuffer, graphBuffer] = await Promise.all([
  readFile(resolve(source, 'path_topology.json')),
  readFile(resolve(source, 'graph.json')),
]);
const walkingNetwork = projectWalkingNetwork(
  JSON.parse(pathTopologyBuffer.toString('utf8')),
  JSON.parse(graphBuffer.toString('utf8')),
  {
    pathTopologySha256: sha256Buffer(pathTopologyBuffer),
    graphSha256: sha256Buffer(graphBuffer),
  },
);
await writeFile(resolve(target, 'walking-network.json'), JSON.stringify(walkingNetwork));

console.log(`Copied runtime graph exports: ${source} -> ${target}`);
