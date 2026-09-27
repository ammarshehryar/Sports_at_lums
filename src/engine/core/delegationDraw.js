// core/delegationDraw.js
// Places entrants into a bracket (or groups) so that entrants from the same
// delegation are spread across the draw as far apart as mathematically
// possible, then repairs any accidental early-round same-delegation clash.
// Used by formats/roundRobin.js (seeding order), formats/knockout.js
// (bracket draw) and formats/groupStageKnockout.js (group assignment).

/**
 * Interleave entrants by delegation using a snake draft, so consecutive
 * picks come from different delegations wherever possible. Because
 * standardSeedOrder maps consecutive ranks to different bracket
 * halves/quarters/eighths, feeding draft order straight into rank order is
 * what actually spreads delegations across the bracket.
 */
export function snakeDraftOrder(entrants) {
  const byDelegation = new Map();
  for (const e of entrants) {
    if (!byDelegation.has(e.delegation)) byDelegation.set(e.delegation, []);
    byDelegation.get(e.delegation).push(e);
  }
  // Largest delegations draft first so they get interleaved earliest,
  // when there's the most room to spread them out. Ties broken by first
  // appearance in the input for determinism.
  const firstSeen = new Map();
  entrants.forEach((e, i) => {
    if (!firstSeen.has(e.delegation)) firstSeen.set(e.delegation, i);
  });
  const delegations = [...byDelegation.keys()].sort((a, b) => {
    const diff = byDelegation.get(b).length - byDelegation.get(a).length;
    if (diff !== 0) return diff;
    return firstSeen.get(a) - firstSeen.get(b);
  });

  const order = [];
  let forward = true;
  const queues = delegations.map((d) => [...byDelegation.get(d)]);
  while (queues.some((q) => q.length > 0)) {
    const iter = forward ? queues : [...queues].reverse();
    for (const q of iter) {
      if (q.length > 0) order.push(q.shift());
    }
    forward = !forward;
  }
  return order;
}

/**
 * Assign 1-based ranks to every entrant. Explicitly seeded entrants take
 * the lowest ranks (in seed order, compacted to 1..k). Everyone else fills
 * the remaining ranks in delegation-spread draft order.
 */
export function assignRanks(entrants) {
  const seeded = entrants
    .filter((e) => e.seed != null && !Number.isNaN(Number(e.seed)))
    .sort((a, b) => Number(a.seed) - Number(b.seed));
  const unseeded = entrants.filter((e) => !seeded.includes(e));

  const rankToEntrant = new Map();
  const seededRanks = new Set();
  seeded.forEach((e, i) => {
    const rank = i + 1;
    rankToEntrant.set(rank, e);
    seededRanks.add(rank);
  });

  const draftOrder = snakeDraftOrder(unseeded);
  draftOrder.forEach((e, i) => {
    rankToEntrant.set(seeded.length + i + 1, e);
  });

  return { rankToEntrant, seededRanks, entrantCount: entrants.length };
}

/**
 * Lay entrants into bracket slots using the standard seed order. A slot
 * whose rank exceeds the entrant count has no entrant, i.e. it's a BYE -
 * and because of how the seeding chart is built, byes land opposite the
 * top-ranked entrants automatically (rank 1 gets the first bye, etc).
 */
export function buildRound1Slots(seedOrder, rankToEntrant, entrantCount) {
  return seedOrder.map((rank, slot) => {
    if (rank <= entrantCount) {
      return { slot, rank, type: 'entrant', entrant: rankToEntrant.get(rank) };
    }
    return { slot, rank, type: 'bye' };
  });
}

/**
 * Scan round-1 real matches (entrant vs entrant, not vs a bye) for
 * same-delegation clashes and try to swap them away. Only unseeded
 * entrants are ever moved, to keep seeded entrants' bracket integrity
 * intact. A swap is only performed if it removes the clash on both sides
 * without creating a new one. Anything left over is returned as a flagged,
 * unavoidable clash (e.g. one delegation is >50% of the field).
 *
 * Later rounds are NOT repaired here: who a team faces in round 2+ depends
 * on round-1 results, so it isn't knowable (or fixable) at draw time
 * unless both feeder slots are byes - a rare edge case handled by the
 * scheduler advancing bye-winners without a same-delegation check needed,
 * since no match is actually played there either.
 */
export function repairRound1Clashes({ seedOrder, rankToEntrant, entrantCount, seededRanks }) {
  const isMovable = (slot) => !seededRanks.has(slot.rank);

  // Real (entrant vs entrant, non-bye) pairs, recomputed fresh from the
  // CURRENT rankToEntrant state every time it's called - swaps mutate
  // rankToEntrant, so any pair list captured before a swap goes stale.
  const currentRealPairs = () => {
    const slots = buildRound1Slots(seedOrder, rankToEntrant, entrantCount);
    const pairs = [];
    for (let i = 0; i < slots.length; i += 2) pairs.push([slots[i], slots[i + 1]]);
    return pairs.filter(([a, b]) => a.type === 'entrant' && b.type === 'entrant');
  };

  let resolvedCount = 0;
  let changed = true;
  let guard = 0;
  const guardLimit = seedOrder.length * 2;

  // Fixed-point loop: each pass looks for one fixable clash, fixes it, then
  // restarts from fresh (live) state. Bounded so a pathological input can
  // never spin forever.
  while (changed && guard < guardLimit) {
    changed = false;
    guard += 1;
    const pairs = currentRealPairs();

    for (let i = 0; i < pairs.length; i++) {
      const [a, b] = pairs[i];
      if (a.entrant.delegation !== b.entrant.delegation) continue;

      const moveSide = isMovable(b) ? b : isMovable(a) ? a : null;
      if (!moveSide) continue; // both sides seeded - can't touch either, leave for final report
      const stableSide = moveSide === b ? a : b;

      let fixed = false;
      for (let j = 0; j < pairs.length && !fixed; j++) {
        if (j === i) continue;
        const [c, d] = pairs[j];
        for (const candidate of [c, d]) {
          if (!isMovable(candidate)) continue;
          const candidatePartner = candidate === c ? d : c;
          const wouldFixOriginal = stableSide.entrant.delegation !== candidate.entrant.delegation;
          const wouldNotClashElsewhere = candidatePartner.entrant.delegation !== moveSide.entrant.delegation;
          if (wouldFixOriginal && wouldNotClashElsewhere) {
            const tmp = rankToEntrant.get(moveSide.rank);
            rankToEntrant.set(moveSide.rank, rankToEntrant.get(candidate.rank));
            rankToEntrant.set(candidate.rank, tmp);
            fixed = true;
            resolvedCount += 1;
            break;
          }
        }
      }
      if (fixed) {
        changed = true;
        break; // restart the outer while loop against fresh, live pairs
      }
    }
  }

  const clashes = currentRealPairs()
    .filter(([a, b]) => a.entrant.delegation === b.entrant.delegation)
    .map(([a, b]) => ({ slotA: a.slot, slotB: b.slot, delegation: a.entrant.delegation, resolved: false }));

  const finalSlots = buildRound1Slots(seedOrder, rankToEntrant, entrantCount);
  return { slots: finalSlots, clashes, resolvedCount };
}

/**
 * Distribute entrants across `numGroups` groups so that entrants from the
 * same delegation are spread across different groups as Priority 1, and
 * groups stay evenly sized as Priority 2. A same-delegation pairing in one
 * group only ever happens when there's truly no group left without that
 * delegation (e.g. one delegation alone is bigger than numGroups, or bigger
 * than everyone else combined) - the fewest-same-delegation-clashes
 * arrangement mathematically possible for the given group count.
 *
 * Algorithm: process delegations largest-first (biggest delegations have
 * the least room to maneuver later, so they get first pick of an empty
 * group). Place each of a delegation's entrants one at a time into
 * whichever group currently holds the fewest members of that delegation;
 * ties broken by smallest current group size, then group order, so the
 * result stays balanced instead of dumping everything left over into one
 * group.
 */
export function assignGroups(entrants, numGroups) {
  const byDelegation = new Map();
  for (const e of entrants) {
    if (!byDelegation.has(e.delegation)) byDelegation.set(e.delegation, []);
    byDelegation.get(e.delegation).push(e);
  }

  const firstSeen = new Map();
  entrants.forEach((e, i) => {
    if (!firstSeen.has(e.delegation)) firstSeen.set(e.delegation, i);
  });
  const delegations = [...byDelegation.keys()].sort((a, b) => {
    const diff = byDelegation.get(b).length - byDelegation.get(a).length;
    if (diff !== 0) return diff;
    return firstSeen.get(a) - firstSeen.get(b);
  });

  const groups = Array.from({ length: numGroups }, () => []);
  const delegationCountByGroup = Array.from({ length: numGroups }, () => new Map());

  for (const delegation of delegations) {
    for (const entrant of byDelegation.get(delegation)) {
      let best = 0;
      for (let g = 1; g < numGroups; g++) {
        const curCount = delegationCountByGroup[g].get(delegation) || 0;
        const bestCount = delegationCountByGroup[best].get(delegation) || 0;
        const better =
          curCount < bestCount || (curCount === bestCount && groups[g].length < groups[best].length);
        if (better) best = g;
      }
      groups[best].push(entrant);
      delegationCountByGroup[best].set(delegation, (delegationCountByGroup[best].get(delegation) || 0) + 1);
    }
  }

  const clashes = [];
  groups.forEach((group, gi) => {
    const seen = new Map();
    for (const e of group) {
      if (seen.has(e.delegation)) {
        clashes.push({ group: gi, delegation: e.delegation, resolved: false });
      }
      seen.set(e.delegation, true);
    }
  });

  return { groups, clashes };
}
