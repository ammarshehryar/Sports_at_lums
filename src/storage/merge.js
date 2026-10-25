// merge.js
// Three-way merge for saved fixtures, used when two people save the same
// fixture at the same moment. Given the version both started from (`base`),
// this person's version (`local`) and what the other person saved
// (`remote`), it keeps both sets of changes.
//
// Merging works per item, not per file: any list of objects with an `id`
// (matches, entrants, venues, venue days) is merged entry by entry, and the
// schedule's [matchId, slot] pairs are merged per match. So one person
// recording a result while another moves a team or renames a venue never
// collide. Only when both changed the very same field does one of them win,
// and that is the person saving now (`local`).
//
// One special case: if either side pressed "Generate Schedule" since `base`,
// the schedule is brand new on that side and edits to the old one can't be
// carried over, so the regenerated tournament is taken as a whole.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function isIdList(v) {
  return Array.isArray(v) && v.length > 0 && v.every((x) => isObj(x) && typeof x.id === 'string');
}

function isPairList(v) {
  return Array.isArray(v) && v.length > 0 && v.every((x) => Array.isArray(x) && x.length === 2 && typeof x[0] === 'string');
}

// Lists become keyed maps so they can be merged entry by entry.
function normalize(v) {
  if (isIdList(v)) {
    const items = {};
    for (const x of v) items[x.id] = normalize(x);
    return { __kind: 'ids', order: v.map((x) => x.id), items };
  }
  if (isPairList(v)) {
    const items = {};
    for (const [k, val] of v) items[k] = normalize(val);
    return { __kind: 'pairs', order: v.map((x) => x[0]), items };
  }
  if (Array.isArray(v)) return v.map(normalize);
  if (isObj(v)) {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = normalize(val);
    return out;
  }
  return v;
}

function denormalize(v) {
  if (isObj(v) && v.__kind === 'ids') return v.order.filter((id) => id in v.items).map((id) => denormalize(v.items[id]));
  if (isObj(v) && v.__kind === 'pairs') return v.order.filter((id) => id in v.items).map((id) => [id, denormalize(v.items[id])]);
  if (Array.isArray(v)) return v.map(denormalize);
  if (isObj(v)) {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = denormalize(val);
    return out;
  }
  return v;
}

function mergeOrder(base = [], local = [], remote = [], items) {
  const removed = new Set([...base.filter((id) => !local.includes(id)), ...base.filter((id) => !remote.includes(id))]);
  const out = local.filter((id) => !removed.has(id) && id in items);
  for (const id of remote) if (!out.includes(id) && !removed.has(id) && id in items) out.push(id);
  for (const id of Object.keys(items)) if (!out.includes(id)) out.push(id);
  return out;
}

const MISSING = Symbol('missing');

function merge3(base, local, remote) {
  if (same(local, remote)) return local;
  if (same(base, local)) return remote;
  if (same(base, remote)) return local;

  // Two different keyed lists: merge entry by entry.
  if (isObj(local) && isObj(remote) && local.__kind && local.__kind === remote.__kind) {
    const b = isObj(base) && base.__kind === local.__kind ? base : { order: [], items: {} };
    const items = {};
    const ids = new Set([...Object.keys(b.items), ...Object.keys(local.items), ...Object.keys(remote.items)]);
    for (const id of ids) {
      const r = mergeKey(b.items, local.items, remote.items, id);
      if (r !== MISSING) items[id] = r;
    }
    return { __kind: local.__kind, order: mergeOrder(b.order, local.order, remote.order, items), items };
  }

  // Two plain objects: merge field by field.
  if (isObj(local) && isObj(remote) && !local.__kind && !remote.__kind) {
    const b = isObj(base) && !base.__kind ? base : {};
    const out = {};
    const keys = new Set([...Object.keys(b), ...Object.keys(local), ...Object.keys(remote)]);
    for (const k of keys) {
      const r = mergeKey(b, local, remote, k);
      if (r !== MISSING) out[k] = r;
    }
    return out;
  }

  // Lists of plain values (ids, group members): merge as sets, keeping
  // what either side added and dropping what either side removed.
  const prim = (a) => Array.isArray(a) && a.every((x) => x === null || typeof x !== 'object');
  if (prim(local) && prim(remote)) {
    const b = prim(base) ? base : [];
    const removed = new Set([...b.filter((x) => !local.includes(x)), ...b.filter((x) => !remote.includes(x))]);
    const out = local.filter((x) => !removed.has(x));
    for (const x of remote) if (!out.includes(x) && !removed.has(x)) out.push(x);
    return out;
  }

  // Lists of lists/objects without ids (e.g. a sport's rounds): position by position.
  if (Array.isArray(local) && Array.isArray(remote)) {
    const b = Array.isArray(base) ? base : [];
    const out = [];
    const n = Math.max(b.length, local.length, remote.length);
    for (let i = 0; i < n; i++) {
      const r = mergeKey(b, local, remote, i);
      if (r !== MISSING) out.push(r);
    }
    return out;
  }

  // Same scalar changed differently on both sides: this save wins.
  return local;
}

function mergeKey(b, l, r, k) {
  const inB = k in b;
  const inL = k in l;
  const inR = k in r;
  if (inL && inR) return merge3(inB ? b[k] : undefined, l[k], r[k]);
  if (inL && !inR) return inB && same(b[k], l[k]) ? MISSING : l[k]; // remote deleted it (unless we changed it)
  if (!inL && inR) return inB && same(b[k], r[k]) ? MISSING : r[k]; // we deleted it (unless they changed it)
  return MISSING;
}

/** Merge two saved dashboard states that both started from `base`. */
export function mergeStates(base, local, remote) {
  if (!base || !remote) return local;
  const lt = local?.tournament;
  const rt = remote?.tournament;
  const bt = base?.tournament;
  const genId = (t) => t?.genId ?? null;

  const merged = denormalize(merge3(normalize(base), normalize(local), normalize(remote)));
  if (genId(lt) !== genId(bt)) merged.tournament = lt;
  else if (genId(rt) !== genId(bt)) merged.tournament = rt;
  return merged;
}
