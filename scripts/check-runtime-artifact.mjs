import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sha256Buffer, validateRuntimeContract, validateRuntimeLayerDocument } from './runtime-data.mjs';

const dist = resolve('dist');
const dataDir = resolve(dist, 'data');
const manifestPath = resolve(dataDir, 'runtime-manifest.json');
const manifestBuffer = await readFile(manifestPath);
const manifest = validateRuntimeContract(JSON.parse(manifestBuffer.toString('utf8')));

const expectedDataFiles = new Set(['runtime-manifest.json']);
let runtimeDataBytes = 0;
const layers = [];

for (const layer of manifest.layers) {
  if (layer.release_required && layer.available !== true) throw new Error(`Release-required runtime layer is unavailable: ${layer.id}`);
  if (layer.available !== true) continue;
  expectedDataFiles.add(layer.filename);
  const path = resolve(dataDir, layer.filename);
  const buffer = await readFile(path);
  const document = JSON.parse(buffer.toString('utf8'));
  validateRuntimeLayerDocument(layer, document);
  const sha256 = sha256Buffer(buffer);
  if (layer.sha256 !== sha256) throw new Error(`Runtime artifact hash mismatch for ${layer.id}: manifest=${layer.sha256} actual=${sha256}`);
  if (layer.bytes !== buffer.byteLength) throw new Error(`Runtime artifact size mismatch for ${layer.id}: manifest=${layer.bytes} actual=${buffer.byteLength}`);
  runtimeDataBytes += buffer.byteLength;
  layers.push({ id: layer.id, filename: layer.filename, bytes: buffer.byteLength, sha256 });
}

const actualDataFiles = new Set((await readdir(dataDir)).filter((name) => !name.startsWith('.')));
for (const filename of actualDataFiles) {
  if (!expectedDataFiles.has(filename)) throw new Error(`Unexpected data artifact: dist/data/${filename}`);
}
for (const filename of expectedDataFiles) {
  if (!actualDataFiles.has(filename)) throw new Error(`Missing data artifact: dist/data/${filename}`);
}
for (const forbidden of ['graph.json', 'path_topology.json', 'validation.json']) {
  if (actualDataFiles.has(forbidden)) throw new Error(`Aggregate/audit payload must not ship: dist/data/${forbidden}`);
}

const runtimeDataBudget = manifest.budgets?.runtime_data_bytes;
if (runtimeDataBytes > runtimeDataBudget) throw new Error(`Runtime data budget exceeded: ${runtimeDataBytes} > ${runtimeDataBudget}`);

const html = await readFile(resolve(dist, 'index.html'), 'utf8');
const initialAssets = [...new Set([...html.matchAll(/(?:src|href)="([^"]*assets\/[^"]+)"/g)].map((match) => match[1]))];
let initialJsBytes = 0;
let initialCssBytes = 0;
for (const asset of initialAssets) {
  const normalized = asset.replace(/^\.\//, '');
  const bytes = (await stat(resolve(dist, normalized))).size;
  if (normalized.endsWith('.js')) initialJsBytes += bytes;
  if (normalized.endsWith('.css')) initialCssBytes += bytes;
}
if (initialJsBytes > manifest.budgets.initial_js_bytes) throw new Error(`Initial JS budget exceeded: ${initialJsBytes} > ${manifest.budgets.initial_js_bytes}`);
if (initialCssBytes > manifest.budgets.initial_css_bytes) throw new Error(`Initial CSS budget exceeded: ${initialCssBytes} > ${manifest.budgets.initial_css_bytes}`);

console.log(JSON.stringify({
  contract_version: manifest.contract_version,
  release_metadata: manifest.release_metadata ?? null,
  layer_count: layers.length,
  runtime_data_bytes: runtimeDataBytes,
  runtime_data_budget_bytes: runtimeDataBudget,
  initial_js_bytes: initialJsBytes,
  initial_js_budget_bytes: manifest.budgets.initial_js_bytes,
  initial_css_bytes: initialCssBytes,
  initial_css_budget_bytes: manifest.budgets.initial_css_bytes,
  layers,
}, null, 2));
