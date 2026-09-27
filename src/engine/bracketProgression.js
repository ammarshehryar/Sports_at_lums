// bracketProgression.js
// Turns one round's recorded results into the next round's fixtures, for
// the knockout schedule built on formats/singleRoundDraw.js's round 1 (that
// format already pads every sport's entrant pool up to a proper bracket
// size with walk-in byes - see that file's header comment - so every round
// this module produces is guaranteed to have an even number of players and
// needs no bye-handling of its own).
//
// Each sport's bracket advances independently: the winners of adjacent
// matches (in the order the round was originally generated in) play each
// other next, round after round, until that sport is down to a single
// match - its final. A walkover match resolves itself automatically (the
// real entrant, never the placeholder "Walkin match" opponent); every real
// match needs an explicit winner recorded first. A 'draw' is a valid interim
// marking - it shows up in the table - but it never advances anyone on its
// own; the match stays "unresolved" for bracket purposes until an actual
// winner is picked.

import { findMatchById } from './manualEdit.js';

export { findMatchById };

export function matchWinner(match) {
  if (match.isWalkover) return match.entrantA;
  if (!match.winnerId || match.winnerId === 'draw') return null;
  return match.winnerId === match.entrantA.id ? match.entrantA : match.entrantB;
}

export function isMatchResolved(match) {
  return !!match.isWalkover || !!matchWinner(match);
}

/**
 * Per-sport snapshot of where each bracket currently stands:
 *  - latest:     that sport's most recently generated round (match array)
 *  - unresolved: matches in `latest` still missing a winner
 *  - isFinal:    true once `latest` is down to a single match (no further
 *                round to generate for this sport, win or lose)
 *  - champion:   the winning entrant, once isFinal and that one match is
 *                resolved - otherwise null
 */
export function getBracketStatus(matchesBySport) {
  const status = {};
  for (const [sport, rounds] of Object.entries(matchesBySport)) {
    const latest = rounds[rounds.length - 1] || [];
    const unresolved = latest.filter((m) => !isMatchResolved(m));
    const isFinal = latest.length === 1;
    const champion = isFinal && unresolved.length === 0 ? matchWinner(latest[0]) : null;
    status[sport] = { latest, unresolved, isFinal, champion, roundCount: rounds.length };
  }
  return status;
}

/** Is there at least one sport ready to advance right now (not already down
 *  to a final, and every match in its latest round resolved)? */
export function canAdvance(matchesBySport) {
  const status = Object.values(getBracketStatus(matchesBySport));
  const stillPlaying = status.filter((s) => !s.isFinal);
  if (stillPlaying.length === 0) return false;
  return stillPlaying.every((s) => s.unresolved.length === 0);
}

function makeIdFactory(matchesBySport) {
  let max = 0;
  for (const rounds of Object.values(matchesBySport)) {
    for (const round of rounds) {
      for (const m of round) {
        const n = parseInt(String(m.id).replace(/^M/, ''), 10);
        if (Number.isFinite(n) && n > max) max = n;
      }
    }
  }
  let counter = max;
  return () => {
    counter += 1;
    return `M${counter}`;
  };
}

/**
 * Advance every sport that's ready. Mutates `matchesBySport` in place -
 * pushes one new round array for each sport whose latest round had more
 * than one match and every match in it resolved - and flags each of that
 * round's matches `advanced: true` (so the table can lock their result
 * once it's actually been used to seed the next round). Returns the flat
 * list of newly created match ids, so the caller knows what still needs a
 * venue/time slot.
 */
export function advanceRound(matchesBySport) {
  const nextId = makeIdFactory(matchesBySport);
  const created = [];
  const status = getBracketStatus(matchesBySport);

  for (const [sport, s] of Object.entries(status)) {
    if (s.isFinal || s.unresolved.length > 0 || s.latest.length === 0) continue;
    const winners = s.latest.map((m) => matchWinner(m));
    const newRound = [];
    for (let i = 0; i < winners.length; i += 2) {
      const a = winners[i];
      const b = winners[i + 1];
      if (!a || !b) continue; // shouldn't happen - round 1 always pads to a power of two
      newRound.push({
        id: nextId(),
        sport,
        entrantA: a,
        entrantB: b,
        clash: a.delegation && a.delegation === b.delegation ? a.delegation : null,
      });
    }
    if (newRound.length) {
      matchesBySport[sport].push(newRound);
      created.push(...newRound.map((m) => m.id));
      s.latest.forEach((m) => {
        m.advanced = true;
      });
    }
  }

  return created;
}
