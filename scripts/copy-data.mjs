import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  projectWalkingNetwork,
  releaseMetadataFromEnv,
  sha256Buffer,
  validateRuntimeContract,
  validateRuntimeLayerDocument,
} from './runtime-data.mjs';

const contractPath = resolve('runtime/runtime-data-manifest.json');
const target = resolve('public/data');

async function readJsonBuffer(path) {
  const buffer = await readFile(path);
  let document;
  try {
    document = JSON.parse(buffer.toString('utf8'));
  } catch (error) {
    throw new Error(`Invalid JSON in ${path}: ${error.message}`);
  }
  return { buffer, document };
}

const contract = validateRuntimeContract(JSON.parse(await readFile(contractPath, 'utf8')));
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });

const publishedLayers = [];
for (const layer of contract.layers) {
  try {
    let outputBuffer;
    let outputDocument;

    if (layer.producer === 'copy') {
      const source = await readJsonBuffer(resolve(layer.source));
      outputBuffer = source.buffer;
      outputDocument = source.document;
    } else if (layer.producer === 'walking-network') {
      const [pathTopology, graph] = await Promise.all(layer.source_inputs.map((path) => readJsonBuffer(resolve(path))));
      outputDocument = projectWalkingNetwork(pathTopology.document, graph.document, {
        pathTopologySha256: sha256Buffer(pathTopology.buffer),
        graphSha256: sha256Buffer(graph.buffer),
      });
      outputBuffer = Buffer.from(JSON.stringify(outputDocument));
    } else {
      throw new Error(`Unsupported runtime producer: ${layer.producer}`);
    }

    validateRuntimeLayerDocument(layer, outputDocument);
    await writeFile(resolve(target, layer.filename), outputBuffer);
    publishedLayers.push({
      ...layer,
      available: true,
      bytes: outputBuffer.byteLength,
      sha256: sha256Buffer(outputBuffer),
    });
  } catch (error) {
    if (layer.release_required) throw new Error(`Required runtime layer ${layer.id} could not be published: ${error.message}`);
    publishedLayers.push({ ...layer, available: false, unavailable_reason: error.message });
  }
}

const runtimeManifest = {
  ...contract,
  release_metadata: releaseMetadataFromEnv(),
  layers: publishedLayers,
};
await writeFile(resolve(target, 'runtime-manifest.json'), `${JSON.stringify(runtimeManifest, null, 2)}\n`);

const runtimeBytes = publishedLayers.reduce((sum, layer) => sum + (layer.bytes ?? 0), 0);
console.log(`Published ${publishedLayers.filter((layer) => layer.available).length}/${publishedLayers.length} runtime layers (${runtimeBytes} bytes) -> ${target}`);
