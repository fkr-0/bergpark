import { setWorkerUrl } from 'maplibre-gl';
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

let configured = false;

export function configureMapLibreWorker() {
  if (!configured) {
    setWorkerUrl(mapLibreWorkerUrl);
    configured = true;
  }
  return mapLibreWorkerUrl;
}
