const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const MAP_TILE_PATTERN = /https:\/\/[^/]*tile\.(openstreetmap|opentopomap)\.org\//;

export function isThirdPartyMapTileUrl(value) {
  return MAP_TILE_PATTERN.test(String(value ?? ''));
}

export async function stubThirdPartyMapTiles(page) {
  await page.route(MAP_TILE_PATTERN, (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: TRANSPARENT_PNG,
  }));
}

export function captureRuntimeErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}
