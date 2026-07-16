/**
 * getByPath.js — minimal JSON-path resolver (Phase 3, F7.3).
 *
 * Reproduces the subset of `lodash.get` semantics the inbound webhook mapping
 * needs, without pulling a dependency (pre-flight: "do NOT pull full lodash").
 * Supports dot paths and bracket indexing:
 *
 *   getByPath({ contact: { email: 'a@b.c' } }, 'contact.email')   // 'a@b.c'
 *   getByPath({ items: [{ id: 7 }] },          'items[0].id')      // 7
 *   getByPath({ 'odd.key': 1 },                ['odd.key'])        // 1 (array path)
 *
 * Returns `undefined` when any segment is missing (the caller treats `undefined`
 * as "path resolved to nothing" → leaves the column unset and logs a warning,
 * per AC5). Never throws on a malformed path.
 */

/** Split a string path into segments: `a.b[0].c` → ['a','b','0','c']. */
const toSegments = (path) => {
  if (Array.isArray(path)) return path.map(String);
  if (typeof path !== 'string' || path.length === 0) return [];
  const out = [];
  // Match `.prop`, leading `prop`, or `[index]` / `["key"]` chunks.
  const re = /[^.[\]]+|\[(?:"([^"]*)"|'([^']*)'|([^\]]*))\]/g;
  let m;
  while ((m = re.exec(path)) !== null) {
    if (m[1] !== undefined) out.push(m[1]);
    else if (m[2] !== undefined) out.push(m[2]);
    else if (m[3] !== undefined) out.push(m[3]);
    else out.push(m[0]);
  }
  return out;
};

const getByPath = (obj, path) => {
  const segments = toSegments(path);
  if (segments.length === 0) return undefined;
  let cur = obj;
  for (const seg of segments) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur;
};

module.exports = { getByPath, toSegments };
