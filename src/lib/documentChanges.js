// A field-level edit preserves independent changes made by another device.
export function documentChanges(before, after, prefix = []) {
  const result = [];
  for (const key of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    if (!prefix.length && ['updatedAt','version'].includes(key)) continue;
    const a = before?.[key]; const b = after?.[key];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) result.push(...documentChanges(a,b,[...prefix,key]));
    else result.push({ path: [...prefix,key], before: a, after: b });
  }
  return result;
}
export function applyDocumentChanges(current, changes) {
  const next = structuredClone(current);
  for (const change of changes) {
    let parent = next;
    for (const key of change.path.slice(0,-1)) parent = parent[key] ??= {};
    const key = change.path.at(-1);
    if (JSON.stringify(parent[key]) !== JSON.stringify(change.before) && JSON.stringify(parent[key]) !== JSON.stringify(change.after)) {
      throw new Error('Otro dispositivo cambió el mismo dato. Recargá antes de guardar.');
    }
    if (change.after === undefined) delete parent[key]; else parent[key] = change.after;
  }
  return next;
}
