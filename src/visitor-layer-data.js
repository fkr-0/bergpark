function coordinate(feature) {
  const lat = Number(feature?.lat);
  const lng = Number(feature?.lng ?? feature?.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
}

function normalizeFeature(feature, layerKind) {
  return {
    ...feature,
    layerKind,
    sourceRefs: Array.isArray(feature?.source_refs) ? feature.source_refs.filter(Boolean) : [],
  };
}

export function normalizeVisitorLayerData(benchesDoc, poisDoc) {
  const benches = (benchesDoc?.benches ?? []).map((feature) => normalizeFeature(feature, 'bench'));
  const pois = (poisDoc?.pois ?? []).map((feature) => normalizeFeature(feature, feature.family ?? 'visitor_poi'));
  return {
    benches,
    pois,
    features: [...benches, ...pois],
    status: {
      benches: benchesDoc?.status ?? 'unavailable',
      pois: poisDoc?.status ?? 'unavailable',
    },
  };
}

export function clusterVisitorFeatures(features, zoom = 15) {
  const valid = (features ?? []).filter((feature) => coordinate(feature));
  if (zoom >= 17) {
    return valid.map((feature) => {
      const [lat, lng] = coordinate(feature);
      return { kind: 'feature', feature, count: 1, lat, lng };
    });
  }
  const cellSize = zoom <= 14 ? 0.004 : zoom === 15 ? 0.002 : 0.001;
  const buckets = new Map();
  for (const feature of valid) {
    const [lat, lng] = coordinate(feature);
    const key = `${Math.floor(lat / cellSize)}:${Math.floor(lng / cellSize)}`;
    const bucket = buckets.get(key) ?? { kind: 'cluster', features: [], count: 0, lat: 0, lng: 0 };
    bucket.features.push(feature);
    bucket.count += 1;
    bucket.lat += lat;
    bucket.lng += lng;
    buckets.set(key, bucket);
  }
  return [...buckets.values()].map((bucket) => ({ ...bucket, lat: bucket.lat / bucket.count, lng: bucket.lng / bucket.count }));
}
