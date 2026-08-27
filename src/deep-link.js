const DEEP_LINK_KINDS = new Set(['place', 'tree', 'feature']);

export function deepLinkHash(kind, id) {
  if (!DEEP_LINK_KINDS.has(kind) || typeof id !== 'string' || !id) return null;
  return `#${kind}=${encodeURIComponent(id)}`;
}

export function parseDeepLink(hash = '') {
  const match = String(hash).match(/^#(place|tree|feature)=([^&]+)/);
  if (!match) return null;
  try {
    const id = decodeURIComponent(match[2]);
    return id ? { kind: match[1], id } : null;
  } catch {
    return null;
  }
}
