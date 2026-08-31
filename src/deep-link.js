const DEEP_LINK_KINDS = new Set(['place', 'tree', 'feature']);

export function deepLinkHash(kind, id) {
  if (!DEEP_LINK_KINDS.has(kind) || typeof id !== 'string' || !id) return null;
  return `#${kind}=${encodeURIComponent(id)}`;
}

export function routeDeepLinkHash(fromId, toId, profile = 'shortest') {
  if (![fromId, toId, profile].every((value) => typeof value === 'string' && value)) return null;
  const params = new URLSearchParams({ route: fromId, to: toId, profile });
  return `#${params.toString()}`;
}

export function parseDeepLink(hash = '') {
  if (String(hash).startsWith('#route=')) {
    const params = new URLSearchParams(String(hash).slice(1));
    const fromId = params.get('route');
    const toId = params.get('to');
    const profile = params.get('profile') || 'shortest';
    return fromId && toId && profile ? { kind: 'route', fromId, toId, profile } : null;
  }
  const match = String(hash).match(/^#(place|tree|feature)=([^&]+)/);
  if (!match) return null;
  try {
    const id = decodeURIComponent(match[2]);
    return id ? { kind: match[1], id } : null;
  } catch {
    return null;
  }
}
