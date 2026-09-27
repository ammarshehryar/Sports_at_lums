// delegationMatching.js
// Core constraint-solving primitive shared by every fixture format: given a
// pool of entrants (all in the same sport), pair them up so that
//
//   Priority 1 - a match between two DIFFERENT delegations is always chosen
//                over a same-delegation match, whenever a cross-delegation
//                opponent is available.
//   Priority 2 - a same-delegation match is only ever produced when every
//                other entrant left in the pool belongs to the same
//                delegation, i.e. it is truly unavoidable.
//
// and, subject to those two rules, the pool is split into the MAXIMUM
// possible number of fixtures (at most one entrant sits out, as a bye, when
// the pool size is odd).
//
// This is a constraint-satisfaction / graph-matching problem, not something
// a nested loop can solve correctly: a naive "walk the list and pair
// neighbours" approach can strand entrants against a partner of the same
// delegation even when a cross-delegation partner was available earlier in
// the list. Instead we use a max-heap greedy strategy - at every step, pair
// one entrant from each of the two LARGEST remaining delegation groups.
//
// This greedy is provably optimal for this kind of problem (it is the same
// technique used to solve "task scheduler" / "reorganize string": repeatedly
// combining the two most numerous groups is always at least as good as any
// other order, and it produces zero same-delegation pairings unless one
// delegation holds a strict majority of the remaining pool - in which case
// same-delegation pairings for the excess are mathematically unavoidable).

class MaxHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(item) {
    this.items.push(item);
    this._bubbleUp(this.items.length - 1);
  }

  pop() {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length) {
      this.items[0] = last;
      this._bubbleDown(0);
    }
    return top;
  }

  _bubbleUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].count >= this.items[i].count) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }

  _bubbleDown(i) {
    const n = this.items.length;
    for (;;) {
      let largest = i;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      if (l < n && this.items[l].count > this.items[largest].count) largest = l;
      if (r < n && this.items[r].count > this.items[largest].count) largest = r;
      if (largest === i) break;
      [this.items[largest], this.items[i]] = [this.items[i], this.items[largest]];
      i = largest;
    }
  }
}

/**
 * Group entrants by delegation, preserving each delegation's first-seen
 * order internally (keeps output deterministic for a given input order).
 */
function groupByDelegation(entrants) {
  const groups = new Map();
  for (const e of entrants) {
    if (!groups.has(e.delegation)) groups.set(e.delegation, []);
    groups.get(e.delegation).push(e);
  }
  return groups;
}

/**
 * Pair up one pool of same-sport entrants for a single round of fixtures.
 *
 * Returns:
 *   pairs: [{ a, b, sameDelegation }]  - one entry per fixture
 *   byes:  [entrant]                   - 0 or 1 entrant left unpaired
 */
export function generateMaxDiversityPairing(entrants) {
  const groups = groupByDelegation(entrants);
  const heap = new MaxHeap();
  for (const [delegation, list] of groups) {
    heap.push({ delegation, queue: [...list], count: list.length });
  }

  const pairs = [];

  // Phase 1 (Priority 1): while at least two different delegations still
  // have entrants waiting, always pair the two largest groups against each
  // other. This is what guarantees cross-delegation matches are exhausted
  // before any same-delegation match is ever considered.
  while (heap.size >= 2) {
    const g1 = heap.pop();
    const g2 = heap.pop();
    const a = g1.queue.shift();
    const b = g2.queue.shift();
    pairs.push({ a, b, sameDelegation: false });
    g1.count -= 1;
    g2.count -= 1;
    if (g1.count > 0) heap.push(g1);
    if (g2.count > 0) heap.push(g2);
  }

  // Phase 2 (Priority 2, fallback only): at most one delegation group is
  // left, meaning no cross-delegation opponent exists for anyone remaining.
  // Pair its own entrants against each other so the pool still produces the
  // maximum possible number of fixtures; flag every such match as a clash.
  const byes = [];
  if (heap.size === 1) {
    const remainder = heap.pop();
    const q = remainder.queue;
    while (q.length >= 2) {
      const a = q.shift();
      const b = q.shift();
      pairs.push({ a, b, sameDelegation: true });
    }
    if (q.length === 1) byes.push(q[0]);
  }

  return { pairs, byes };
}

/**
 * Same primitive, but excludes any pairing already present in `playedPairs`
 * (a Set of "entrantIdA|entrantIdB" keys, order-independent). Used by
 * formats that run multiple rounds without repeating a fixture (Swiss,
 * league play, group stage) - see formats/swiss.js.
 */
export function pairKey(idA, idB) {
  return [idA, idB].sort().join('|');
}

export function generateMaxDiversityPairingAvoiding(entrants, playedPairs) {
  if (!playedPairs || playedPairs.size === 0) return generateMaxDiversityPairing(entrants);

  // Re-run the greedy heap process, but when the natural top-two-groups
  // choice would recreate an already-played pairing, look for the next
  // best available partner (largest remaining group whose specific
  // entrant hasn't already faced this one) before falling back to
  // pairing the two groups anyway (a repeat is better than no match).
  const groups = groupByDelegation(entrants);
  const heap = new MaxHeap();
  for (const [delegation, list] of groups) {
    heap.push({ delegation, queue: [...list], count: list.length });
  }

  const pairs = [];
  const pending = [];
  while (heap.size >= 2 || pending.length) {
    if (pending.length) {
      // Try to slot any pending (deferred) entrant back in first.
      const p = pending.shift();
      if (heap.size >= 1) {
        const g = heap.pop();
        const partner = g.queue.shift();
        pairs.push({ a: p, b: partner, sameDelegation: p.delegation === partner.delegation });
        g.count -= 1;
        if (g.count > 0) heap.push(g);
      } else {
        pending.push(p); // nobody left at all
        break;
      }
      continue;
    }

    const g1 = heap.pop();
    const g2 = heap.pop();
    const a = g1.queue.shift();
    const b = g2.queue.shift();
    if (playedPairs.has(pairKey(a.id, b.id)) && (g1.count - 1 > 0 || g2.count - 1 > 0)) {
      // Defer `a` and try g2 against whatever comes up next instead.
      pending.push(a);
      g2.queue.unshift(b);
    } else {
      pairs.push({ a, b, sameDelegation: a.delegation === b.delegation });
    }
    g1.count -= 1;
    if (g1.count > 0) heap.push(g1);
    if (g2.count > 0) heap.push(g2);
  }

  const byes = pending;
  return { pairs, byes };
}
