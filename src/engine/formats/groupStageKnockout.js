// formats/groupStageKnockout.js
// FUTURE FORMAT (not yet wired into the UI's format selector - see
// formats/index.js). Splits entrants into delegation-spread groups, plays a
// full round robin inside each group, then a knockout stage among the
// group leaders. Since group-stage results (and therefore who "leads" each
// group) aren't known until results are recorded, the knockout stage is
// left symbolic ("Winner of Group A") - the same pattern used by
// formats/knockout.js for its rounds 2+.

import { assignGroups } from '../core/delegationDraw.js';
import { generateRoundRobin } from '../core/roundRobinRotation.js';

let matchCounter = 0;

export function resetMatchCounter() {
  matchCounter = 0;
}

function nextMatchId() {
  matchCounter += 1;
  return `M${matchCounter}`;
}

function placeholderEntrant(label) {
  return { id: `TBD:${label}`, name: label, delegation: null, isPlaceholder: true };
}

const GROUP_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Groups can be sized two ways (set on the dashboard's Group Stage panel):
 *  - a fixed number of groups (`options.numGroups`) — entrants are spread
 *    evenly across that many groups, or
 *  - a target group size (`options.groupSize`) — the number of groups is
 *    derived per sport as ceil(entrantCount / groupSize), so a sport with
 *    fewer entrants still gets sensibly-sized groups.
 * If neither is given, defaults to roughly 4 entrants/group.
 */
export function generateSport(sportId, entrants, options = {}) {
  let numGroups;
  if (options.numGroups) {
    numGroups = Math.max(2, Math.round(options.numGroups));
  } else if (options.groupSize) {
    numGroups = Math.max(2, Math.ceil(entrants.length / Math.max(1, Math.round(options.groupSize))));
  } else {
    numGroups = Math.max(2, Math.ceil(entrants.length / 4));
  }
  // Never make more groups than there are entrants to put in them.
  numGroups = Math.max(2, Math.min(numGroups, entrants.length || numGroups));

  const { groups, clashes } = assignGroups(entrants, numGroups);

  const rounds = [];
  const groupWinners = [];
  groups.forEach((group, gi) => {
    if (group.length < 2) {
      if (group.length === 1) groupWinners.push(group[0]);
      return;
    }
    const rotation = generateRoundRobin(group);
    rotation.forEach((matchday, mi) => {
      rounds[mi] = rounds[mi] || [];
      for (const [a, b] of matchday) {
        rounds[mi].push({
          id: nextMatchId(),
          sport: sportId,
          entrantA: a,
          entrantB: b,
          clash: a.delegation === b.delegation ? a.delegation : null,
          group: GROUP_LABELS[gi] || `G${gi + 1}`,
        });
      }
    });
    groupWinners.push(placeholderEntrant(`Winner of Group ${GROUP_LABELS[gi] || gi + 1}`));
  });

  // Knockout stage among group winners - symbolic, pending group results.
  const knockoutRound = [];
  for (let i = 0; i < groupWinners.length; i += 2) {
    const a = groupWinners[i];
    const b = groupWinners[i + 1];
    if (a && b) {
      knockoutRound.push({
        id: nextMatchId(),
        sport: sportId,
        entrantA: a,
        entrantB: b,
        clash: null,
        isPending: true,
        stage: 'knockout',
      });
    }
  }
  if (knockoutRound.length) rounds.push(knockoutRound);

  return {
    rounds: rounds.filter((r) => r.length),
    byes: [],
    meta: {
      format: 'groupStageKnockout',
      totalEntrants: entrants.length,
      numGroups: groups.length,
      unresolvedGroupClashes: clashes.filter((c) => !c.resolved).length,
    },
  };
}
