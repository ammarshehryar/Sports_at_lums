// formats/knockout.js
// FUTURE FORMAT (not yet wired into the UI's format selector - see
// formats/index.js). Single-elimination bracket.
//
// Round 1 is fully concrete: entrants are seeded with a delegation-spread
// draft (core/delegationDraw.js), which also repairs any same-delegation
// Round-1 pairing that can be avoided by swapping unseeded entrants -
// exactly the Priority 1 / Priority 2 rule applied to a knockout draw.
// Byes awarded by the seeding chart advance automatically with no match.
//
// Rounds 2+ genuinely cannot be generated in advance - who plays in the
// quarter-final depends on who wins the first round, which isn't known
// until results are recorded (a future "Manual Fixture Editing" /
// results-entry feature). Those rounds are represented symbolically here
// (placeholder "entrants" like "Winner of M3") so the bracket's full shape
// is still visible immediately, and so a later results-tracking pass has
// somewhere to slot the real winner in.

import { assignRanks, repairRound1Clashes } from '../core/delegationDraw.js';

let matchCounter = 0;

export function resetMatchCounter() {
  matchCounter = 0;
}

function nextMatchId() {
  matchCounter += 1;
  return `M${matchCounter}`;
}

/** Standard bracket seed order (1 vs N, spreads seeds 1/2 to opposite halves, etc). */
function standardSeedOrder(size) {
  let order = [1, 2];
  while (order.length < size) {
    const next = [];
    const sum = order.length * 2 + 1;
    for (const seed of order) {
      next.push(seed, sum - seed);
    }
    order = next;
  }
  return order;
}

function nextPowerOfTwo(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function placeholderEntrant(label) {
  return { id: `TBD:${label}`, name: label, delegation: null, isPlaceholder: true };
}

export function generateSport(sportId, entrants) {
  const bracketSize = nextPowerOfTwo(Math.max(entrants.length, 1));
  const seedOrder = standardSeedOrder(bracketSize);
  const { rankToEntrant, seededRanks } = assignRanks(entrants);
  const { slots, clashes } = repairRound1Clashes({
    seedOrder,
    rankToEntrant,
    entrantCount: entrants.length,
    seededRanks,
  });

  // Round 1: real matches (skip byes - those advance automatically).
  const round1 = [];
  const advancing = new Array(bracketSize / 2).fill(null); // who is in slot-pair i for round 2
  for (let i = 0; i < slots.length; i += 2) {
    const s1 = slots[i];
    const s2 = slots[i + 1];
    const pairIndex = i / 2;
    if (s1.type === 'entrant' && s2.type === 'entrant') {
      const match = {
        id: nextMatchId(),
        sport: sportId,
        entrantA: s1.entrant,
        entrantB: s2.entrant,
        clash: s1.entrant.delegation === s2.entrant.delegation ? s1.entrant.delegation : null,
        round: 1,
      };
      round1.push(match);
      advancing[pairIndex] = placeholderEntrant(`Winner of ${match.id}`);
    } else {
      // One (or both) sides is a bye - the entrant present advances with no match played.
      advancing[pairIndex] = s1.type === 'entrant' ? s1.entrant : s2.type === 'entrant' ? s2.entrant : null;
    }
  }

  const rounds = round1.length ? [round1] : [];

  // Rounds 2+: symbolic only, since real pairings depend on Round 1 results.
  let current = advancing;
  while (current.length > 1) {
    const round = [];
    const next = [];
    for (let i = 0; i < current.length; i += 2) {
      const a = current[i];
      const b = current[i + 1];
      if (a && b) {
        const match = {
          id: nextMatchId(),
          sport: sportId,
          entrantA: a,
          entrantB: b,
          clash: null,
          round: rounds.length + 1,
          isPending: true, // depends on a previous round's result
        };
        round.push(match);
        next.push(placeholderEntrant(`Winner of ${match.id}`));
      } else {
        next.push(a || b || null);
      }
    }
    if (round.length) rounds.push(round);
    current = next;
  }

  return {
    rounds,
    byes: [],
    meta: {
      format: 'knockout',
      totalEntrants: entrants.length,
      bracketSize,
      unresolvedClashes: clashes.filter((c) => !c.resolved).length,
    },
  };
}
