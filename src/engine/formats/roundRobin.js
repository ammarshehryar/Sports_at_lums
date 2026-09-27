// formats/roundRobin.js
// FUTURE FORMAT (not yet wired into the UI's format selector - see
// formats/index.js). Every entrant in a sport plays every other entrant
// exactly once, across multiple matchdays (circle method). Because every
// pair must eventually meet, Priority 1 / Priority 2 can only influence
// *when* a same-delegation match happens, not *whether* it happens - so
// entrants are seeded into the rotation with a delegation-spreading draft,
// which pushes every unavoidable same-delegation match as late as
// mathematically possible and keeps early matchdays cross-delegation only.

import { generateRoundRobin } from '../core/roundRobinRotation.js';
import { snakeDraftOrder } from '../core/delegationDraw.js';

let matchCounter = 0;

export function resetMatchCounter() {
  matchCounter = 0;
}

function nextMatchId() {
  matchCounter += 1;
  return `M${matchCounter}`;
}

export function generateSport(sportId, entrants) {
  const ordered = snakeDraftOrder(entrants);
  const rotationRounds = generateRoundRobin(ordered);
  const rounds = rotationRounds.map((matchday) =>
    matchday.map(([a, b]) => ({
      id: nextMatchId(),
      sport: sportId,
      entrantA: a,
      entrantB: b,
      clash: a.delegation === b.delegation ? a.delegation : null,
    }))
  );
  const fixtureCount = rounds.reduce((sum, r) => sum + r.length, 0);
  return {
    rounds,
    byes: [],
    meta: { format: 'roundRobin', totalEntrants: entrants.length, fixtureCount, matchdays: rounds.length },
  };
}
