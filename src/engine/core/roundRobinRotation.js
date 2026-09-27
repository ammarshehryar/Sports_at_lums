// core/roundRobinRotation.js
// Low-level circle-method round-robin fixture generator for group-stage
// play. Used by formats/roundRobin.js and formats/groupStageKnockout.js.
// Returns an array of "matchdays", each an array of [entrantA, entrantB]
// pairs. If the group has an odd number of entrants, one entrant sits out
// (a bye) each matchday - that's not a schedule event, just a rest day.

export function generateRoundRobin(entrants) {
  let list = [...entrants];
  if (list.length % 2 !== 0) list.push(null); // phantom bye
  const n = list.length;
  const rounds = [];

  for (let r = 0; r < n - 1; r++) {
    const matchday = [];
    for (let i = 0; i < n / 2; i++) {
      const home = list[i];
      const away = list[n - 1 - i];
      if (home && away) matchday.push([home, away]);
    }
    rounds.push(matchday);
    const fixed = list[0];
    const rest = list.slice(1);
    rest.unshift(rest.pop());
    list = [fixed, ...rest];
  }
  return rounds;
}
