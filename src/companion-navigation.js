function normalizedTarget(target) {
  if (!target?.kind || !target?.id) throw new TypeError('Companion target requires kind and id');
  return Object.freeze({ ...target, kind: String(target.kind), id: String(target.id) });
}

function sameTarget(left, right) {
  return Boolean(left && right && left.kind === right.kind && left.id === right.id);
}

function boundedMetadata(metadata = {}) {
  return Object.freeze({
    source: metadata.source ?? null,
    relationKey: metadata.relationKey ?? null,
    sourceIds: Object.freeze([...(metadata.sourceIds ?? [])]),
    sourceRefs: Object.freeze([...(metadata.sourceRefs ?? [])]),
    provenance: metadata.provenance ?? null,
  });
}

/**
 * Small integration-neutral history for route → entity → related → audio journeys.
 * It stores canonical targets and evidence metadata only; the browser/history owner
 * decides how or whether to wire snapshots into URLs and focus restoration.
 */
export function createCompanionTrail({ initial = null, maxDepth = 12 } = {}) {
  const boundedDepth = Number.isFinite(maxDepth) ? Math.max(1, Math.floor(maxDepth)) : 12;
  let current = initial ? normalizedTarget(initial) : null;
  let history = [];

  function snapshot() {
    return Object.freeze({
      current,
      canGoBack: history.length > 0,
      returnTo: history.at(-1)?.target ?? null,
      path: Object.freeze([...history.map(({ target }) => target), ...(current ? [current] : [])]),
    });
  }

  function visit(target, metadata = {}) {
    const next = normalizedTarget(target);
    const from = current;
    const evidence = boundedMetadata(metadata);
    if (from && !sameTarget(from, next)) {
      history.push(Object.freeze({ target: from, evidence }));
      if (history.length > boundedDepth) history = history.slice(-boundedDepth);
    }
    current = next;
    return Object.freeze({
      from,
      to: next,
      returnTo: from,
      evidence,
      snapshot: snapshot(),
    });
  }

  function back() {
    if (!history.length) return null;
    const from = current;
    const frame = history.pop();
    current = frame.target;
    return Object.freeze({
      from,
      to: current,
      returnTo: history.at(-1)?.target ?? null,
      evidence: Object.freeze({ ...frame.evidence, source: 'return' }),
      snapshot: snapshot(),
    });
  }

  function reset(target = null) {
    history = [];
    current = target ? normalizedTarget(target) : null;
    return snapshot();
  }

  return Object.freeze({ visit, back, reset, snapshot });
}
