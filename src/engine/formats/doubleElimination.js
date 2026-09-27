// formats/doubleElimination.js
// FUTURE FORMAT SCAFFOLD (not yet wired into the UI's format selector - see
// formats/index.js). A double-elimination bracket needs the same Round 1
// winners-bracket draw as formats/knockout.js, plus a losers bracket that
// re-inserts anyone who drops their first match, plus a grand final between
// the last winners-bracket and losers-bracket survivors. The winners-side
// Round 1 (the only part that doesn't depend on live results) is
// implemented now by delegating to formats/knockout.js; the losers bracket
// and grand final are intentionally left as documented extension points,
// since they can only be built once a results-entry feature exists to
// report who lost each match.

import { generateSport as generateKnockoutSport } from './knockout.js';

export function resetMatchCounter() {
  // knockout.js owns the shared match counter for the winners-bracket draw.
}

export function generateSport(sportId, entrants) {
  const winnersBracket = generateKnockoutSport(sportId, entrants);
  return {
    rounds: winnersBracket.rounds,
    byes: winnersBracket.byes,
    meta: {
      format: 'doubleElimination',
      totalEntrants: entrants.length,
      winnersBracketSize: winnersBracket.meta.bracketSize,
      note: 'Losers bracket + grand final require a results-entry feature and are not yet generated.',
    },
  };
}

/** Extension point: build the losers bracket once round-by-round results exist. */
export function buildLosersBracket(/* sportId, eliminatedByRound, options */) {
  throw new Error('buildLosersBracket() is not implemented yet - requires a results-entry feature.');
}

/** Extension point: pair the winners-bracket champion vs the losers-bracket champion. */
export function buildGrandFinal(/* sportId, winnersBracketChampion, losersBracketChampion */) {
  throw new Error('buildGrandFinal() is not implemented yet - requires a results-entry feature.');
}
