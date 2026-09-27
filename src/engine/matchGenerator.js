// matchGenerator.js
// Builds the raw fixture list (before venue/time scheduling) for every
// sport found in the roster. The actual pairing logic lives in
// formats/ (pluggable per tournament format) and, underneath that, in the
// constraint-based matcher in core/delegationMatching.js. This file's job
// is just to split the roster by sport and hand each sport's entrant pool
// to the selected format.

import { getFormat } from './formats/index.js';

/** Group flat entrant rows by sport, preserving first-seen sport order. */
export function groupBySport(entrants) {
  const order = [];
  const bySport = new Map();
  for (const e of entrants) {
    if (!bySport.has(e.sport)) {
      bySport.set(e.sport, []);
      order.push(e.sport);
    }
    bySport.get(e.sport).push(e);
  }
  return { order, bySport };
}

/**
 * Build fixtures for every sport present in the roster.
 *
 * @param {Array} entrants  flat roster rows: { id, name, delegation, sport }
 * @param {string} [formatName] which formats/ module to use per sport
 *        (defaults to 'singleRoundDraw', the format currently active in the
 *        UI - see formats/index.js for the full registry).
 * @param {object} [options]  passed through to the format's generateSport()
 *
 * Returns:
 *   order:          sport ids in first-seen order
 *   matchesBySport: { [sportId]: rounds[] }  (rounds is an array of
 *                   matchday arrays, each match already carrying entrantA,
 *                   entrantB and a `clash` flag - same shape every format
 *                   produces, so the scheduler and report builder are
 *                   format-agnostic)
 *   byesBySport:    { [sportId]: entrant[] } entrants left without an
 *                   opponent this round, if any
 *   metaBySport:    { [sportId]: object } format-specific summary info
 */
export function buildAllMatches(entrants, formatName = 'singleRoundDraw', options = {}) {
  const format = getFormat(formatName);
  format.resetMatchCounter?.();

  const { order, bySport } = groupBySport(entrants);
  const matchesBySport = {};
  const byesBySport = {};
  const metaBySport = {};

  for (const sportId of order) {
    const { rounds, byes, meta } = format.generateSport(sportId, bySport.get(sportId), options);
    matchesBySport[sportId] = rounds;
    byesBySport[sportId] = byes || [];
    metaBySport[sportId] = meta || {};
  }

  return { order, matchesBySport, byesBySport, metaBySport };
}
