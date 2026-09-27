// formats/swiss.js
// FUTURE FORMAT (not yet wired into the UI's format selector - see
// formats/index.js). Swiss pairing plays entrants of similar record against
// each other round after round, without ever repeating a pairing.
//
// Round 1 has no standings yet, so it's identical to a single-round draw:
// the delegation-diversity matcher (core/delegationMatching.js) is used
// directly. `generateNextRound` is the hook a future results-tracking
// feature calls after each round to produce the next one, pairing entrants
// with the closest win/loss record while still respecting Priority 1 /
// Priority 2 and never repeating an earlier pairing
// (delegationMatching.generateMaxDiversityPairingAvoiding).

import {
  generateMaxDiversityPairing,
  generateMaxDiversityPairingAvoiding,
  pairKey,
} from '../core/delegationMatching.js';

let matchCounter = 0;

export function resetMatchCounter() {
  matchCounter = 0;
}

function nextMatchId() {
  matchCounter += 1;
  return `M${matchCounter}`;
}

function toMatches(sportId, pairs, roundNumber) {
  return pairs.map(({ a, b, sameDelegation }) => ({
    id: nextMatchId(),
    sport: sportId,
    entrantA: a,
    entrantB: b,
    clash: sameDelegation ? a.delegation : null,
    round: roundNumber,
  }));
}

/** Round 1 of a Swiss event: standard max-diversity draw, no history yet. */
export function generateSport(sportId, entrants) {
  const { pairs, byes } = generateMaxDiversityPairing(entrants);
  const matches = toMatches(sportId, pairs, 1);
  return {
    rounds: matches.length ? [matches] : [],
    byes,
    meta: { format: 'swiss', totalEntrants: entrants.length, round: 1 },
  };
}

/**
 * Extension point for a future results-entry feature: given the entrants
 * still in contention, the set of pairs already played (as pairKey strings),
 * and the round number about to be generated, produce the next round.
 * Entrants should already be sorted best-record-first by the caller so
 * near-equal records land next to each other in the pairing queue.
 */
export function generateNextRound(sportId, standingsOrderedEntrants, playedPairs, roundNumber) {
  const { pairs, byes } = generateMaxDiversityPairingAvoiding(standingsOrderedEntrants, playedPairs);
  return { matches: toMatches(sportId, pairs, roundNumber), byes };
}

export { pairKey };
