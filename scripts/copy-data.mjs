import { copyFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

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

console.log(`Copied runtime graph exports: ${source} -> ${target}`);
