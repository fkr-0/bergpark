export function absoluteHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function firstAbsoluteHttpUrl(values = []) {
  return (Array.isArray(values) ? values : []).map(absoluteHttpUrl).find(Boolean) ?? null;
}
