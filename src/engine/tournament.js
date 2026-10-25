// tournament.js
// One place for everything that changes a generated tournament after the
// fact, so App.jsx only has to call a function and re-render:
//
//  1. The two-round model. Every knockout sport is generated as Round 1
//     (real fixtures) PLUS a projected Round 2 ("Winner of Match 1 vs
//     Winner of Match 2") that already has its own venue, date and time,
//     booked after Round 1 finishes. A projected slot fills in with the real
//     name the moment a feeder result is recorded. As soon as a round's
//     feeder results are all in, the round after it is projected and
//     booked automatically, so there are always two rounds on the board
//     until the final.
//
//  2. Editable groups (group stage). Group membership is the source of
//     truth: moving, swapping, removing or adding a team rebuilds that
//     sport's round robin. Fixtures between teams who are still together
//     keep their id, slot and everything else; fixtures that no longer make
//     sense are deleted; new pairings take over the freed slots where the
//     teams are free, and otherwise get booked into open venue time.
//
//  3. Save/restore. Matches share entrant objects by reference (manual
//     edits rely on that, see manualEdit.js), so the saved form stores
//     roster entrants as {ref: id} and relinks them on load.

import { buildSessions, scheduleRounds, tournamentStart, subtractInterval } from './core/venueAllocator.js';
import { buildAllMatches } from './matchGenerator.js';
import { generateRoundRobin } from './core/roundRobinRotation.js';

// ---------- ids ----------

export function makeIdFactory(matchesBySport) {
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

export function findMatch(matchesBySport, id) {
  for (const rounds of Object.values(matchesBySport)) {
    for (const round of rounds) {
      const m = round.find((x) => x.id === id);
      if (m) return m;
    }
  }
  return null;
}

function allMatches(matchesBySport) {
  return Object.values(matchesBySport).flatMap((rounds) => rounds.flat());
}

// ---------- sessions (venue free time) ----------

/**
 * Fresh venue/day free-time sessions with every currently booked slot (plus
 * the break after it) carved back out. Rebuilt on demand rather than kept
 * around, so it is always right after deletions, manual moves, venue edits,
 * or reopening a saved fixture.
 */
export function rebuildSessions(flatVenueRows, scheduled, bufferMinutes = 0) {
  const sessions = buildSessions(flatVenueRows);
  for (const slot of scheduled.values()) {
    for (const s of sessions) {
      if (s.venueName !== slot.venueName || s.day !== slot.day) continue;
      s.free = subtractInterval(s.free, slot.startAbs, slot.endAbs + bufferMinutes);
      s.bookedCount += 1;
    }
  }
  return sessions;
}

function roundEnd(round, scheduled, fallback) {
  let end = fallback;
  for (const m of round) {
    const slot = scheduled.get(m.id);
    if (slot && slot.endAbs > end) end = slot.endAbs;
  }
  return end;
}

function bookRound(state, sport, round, floor, ctx) {
  const sessions = rebuildSessions(ctx.flatVenueRows, state.scheduled, ctx.settings.bufferMinutes);
  const { scheduled, unscheduled } = scheduleRounds(sessions, sport, [round], ctx.settings, floor);
  for (const [id, v] of scheduled) state.scheduled.set(id, v);
  for (const id of unscheduled) if (!state.unscheduled.includes(id)) state.unscheduled.push(id);
}

function unbook(state, id) {
  state.scheduled.delete(id);
  const i = state.unscheduled.indexOf(id);
  if (i !== -1) state.unscheduled.splice(i, 1);
}

// ---------- results and projected rounds ----------

export function matchWinner(m) {
  if (!m) return null;
  if (m.isWalkover) return m.entrantA;
  if (!m.winnerId || m.winnerId === 'draw') return null;
  if (m.entrantA?.isPlaceholder || m.entrantB?.isPlaceholder) return null;
  if (m.winnerId === m.entrantA.id) return m.entrantA;
  if (m.winnerId === m.entrantB.id) return m.entrantB;
  return null;
}

function placeholderFor(sourceMatchId) {
  return { id: `TBD:${sourceMatchId}`, name: `Winner of ${sourceMatchId}`, delegation: '', isPlaceholder: true, sourceMatchId };
}

/** Projected match for every adjacent pair of matches in `round`. */
function projectRound(sport, round, nextId) {
  const out = [];
  for (let i = 0; i + 1 < round.length; i += 2) {
    out.push({
      id: nextId(),
      sport,
      entrantA: placeholderFor(round[i].id),
      entrantB: placeholderFor(round[i + 1].id),
      sourceA: round[i].id,
      sourceB: round[i + 1].id,
      clash: null,
      isProjected: true,
    });
  }
  return out;
}

/**
 * Fill every projected slot whose feeder match now has a winner (and put the
 * placeholder back if that result was cleared). If the entrant in a slot
 * changes, any winner recorded on the projected match itself is dropped,
 * since it would point at someone who is no longer in that match.
 */
export function syncProjected(matchesBySport) {
  for (const rounds of Object.values(matchesBySport)) {
    for (const round of rounds) {
      for (const m of round) {
        if (!m.sourceA && !m.sourceB) continue;
        for (const side of ['A', 'B']) {
          const src = m[`source${side}`];
          if (!src) continue;
          const w = matchWinner(findMatch(matchesBySport, src));
          const next = w || placeholderFor(src);
          if (m[`entrant${side}`]?.id !== next.id) {
            m[`entrant${side}`] = next;
            m.winnerId = null;
          }
        }
        const a = m.entrantA;
        const b = m.entrantB;
        m.clash = !a.isPlaceholder && !b.isPlaceholder && a.delegation && a.delegation === b.delegation ? a.delegation : null;
      }
    }
  }
}

/** Ids of matches whose winner feeds a match that already has a result (their result is frozen). */
export function lockedResultIds(matchesBySport) {
  const locked = new Set();
  for (const m of allMatches(matchesBySport)) {
    if (!m.winnerId) continue;
    if (m.sourceA) locked.add(m.sourceA);
    if (m.sourceB) locked.add(m.sourceB);
  }
  return locked;
}

/**
 * For every knockout sport: once every match feeding the latest projected
 * round has a result, project and book the round after it. Loops so a run of
 * walkovers can cascade. Returns the ids created.
 */
export function autoAdvance(state, ctx) {
  const created = [];
  const nextId = makeIdFactory(state.matchesBySport);
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const [sport, rounds] of Object.entries(state.matchesBySport)) {
      const last = rounds[rounds.length - 1];
      if (!last || last.length < 2) continue;
      if (!last.every((m) => m.sourceA && m.sourceB)) continue; // only bracket rounds
      const feeders = last.flatMap((m) => [m.sourceA, m.sourceB]).map((id) => findMatch(state.matchesBySport, id));
      if (!feeders.every((f) => matchWinner(f))) continue;
      const next = projectRound(sport, last, nextId);
      if (!next.length) continue;
      rounds.push(next);
      const floor = roundEnd(last, state.scheduled, tournamentStart(buildSessions(ctx.flatVenueRows)));
      bookRound(state, sport, next, floor, ctx);
      created.push(...next.map((m) => m.id));
      progressed = true;
    }
  }
  syncProjected(state.matchesBySport);
  return created;
}

export function setResult(state, matchId, winnerId, ctx) {
  const m = findMatch(state.matchesBySport, matchId);
  if (!m || m.isWalkover) return false;
  if (m.entrantA.isPlaceholder || m.entrantB.isPlaceholder) return false;
  if (lockedResultIds(state.matchesBySport).has(matchId)) return false;
  m.winnerId = m.winnerId === winnerId ? null : winnerId;
  syncProjected(state.matchesBySport);
  autoAdvance(state, ctx);
  return true;
}

/** Per sport: champion once the final has a result, and how many results are still open. */
export function bracketStatus(matchesBySport) {
  const status = {};
  for (const [sport, rounds] of Object.entries(matchesBySport)) {
    const last = rounds[rounds.length - 1] || [];
    const isBracket = rounds.length > 0 && rounds.every((r, i) => i === 0 || r.every((m) => m.sourceA));
    if (!isBracket) continue;
    const isFinal = last.length === 1;
    const champion = isFinal ? matchWinner(last[0]) : null;
    const open = rounds.flat().filter((m) => !m.isWalkover && !matchWinner(m)).length;
    status[sport] = { isFinal, champion, open };
  }
  return status;
}

// ---------- generation ----------

export function generateTournament({ entrants, stageFormat, formatOptions, flatVenueRows, settings }) {
  const formatName = stageFormat === 'groupStage' ? 'groupStageKnockout' : 'singleRoundDraw';
  const { order, matchesBySport, metaBySport } = buildAllMatches(entrants, formatName, formatOptions);

  // Two-round model for knockout: add the projected Round 2 right away.
  if (formatName === 'singleRoundDraw') {
    const nextId = makeIdFactory(matchesBySport);
    for (const sport of order) {
      const raw = matchesBySport[sport][0];
      if (!raw) continue;
      // Spread walkovers through the draw so a walk-in team meets a real
      // match winner in Round 2 rather than another walk-in team.
      const real = raw.filter((m) => !m.isWalkover);
      const walk = raw.filter((m) => m.isWalkover);
      const r1 = [];
      while (real.length || walk.length) {
        if (real.length) r1.push(real.shift());
        if (walk.length) r1.push(walk.shift());
      }
      matchesBySport[sport][0] = r1;
      if (r1.length >= 2) matchesBySport[sport].push(projectRound(sport, r1, nextId));
    }
    syncProjected(matchesBySport);
  }

  const groupsBySport = {};
  for (const sport of order) {
    if (metaBySport[sport]?.groups) {
      groupsBySport[sport] = { groups: metaBySport[sport].groups, unassigned: [] };
    }
  }

  const sessions = buildSessions(flatVenueRows);
  const start = tournamentStart(sessions);
  const scheduled = new Map();
  const unscheduled = [];
  for (const sport of order) {
    const res = scheduleRounds(sessions, sport, matchesBySport[sport], settings, start);
    for (const [id, v] of res.scheduled) scheduled.set(id, v);
    unscheduled.push(...res.unscheduled);
  }

  const genId = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const state = { genId, matchesBySport, scheduled, unscheduled, groupsBySport };
  // A first round that is all walkovers (tiny pools) resolves itself.
  autoAdvance(state, { flatVenueRows, settings });
  return state;
}

// ---------- editable groups ----------

const pairKey = (a, b) => [a, b].sort().join('|');

function overlaps(a, b) {
  return a.startAbs < b.endAbs && b.startAbs < a.endAbs;
}

function entrantBusy(state, entrantIds, slot, ignoreIds) {
  for (const m of allMatches(state.matchesBySport)) {
    if (ignoreIds.has(m.id)) continue;
    const s = state.scheduled.get(m.id);
    if (!s || !overlaps(s, slot)) continue;
    if (entrantIds.includes(m.entrantA?.id) || entrantIds.includes(m.entrantB?.id)) return true;
  }
  return false;
}

/**
 * Replace one sport's group membership and rebuild its group fixtures.
 * `groups` is [{label, memberIds}], `unassigned` is [entrantId] (teams taken
 * out of every group, kept so they can be added back). Returns a summary
 * {kept, removed, added} for the UI.
 */
export function applyGroupEdit(state, sport, groups, unassigned, entrants, ctx) {
  const byId = new Map(entrants.map((e) => [e.id, e]));
  const rounds = state.matchesBySport[sport] || [];
  const groupRounds = rounds.filter((r) => r.some((m) => m.group));
  const koRounds = rounds.filter((r) => !r.some((m) => m.group));

  const existing = new Map();
  for (const m of groupRounds.flat()) existing.set(pairKey(m.entrantA.id, m.entrantB.id), m);

  const nextId = makeIdFactory(state.matchesBySport);
  const newRounds = [];
  const added = [];
  let kept = 0;
  for (const g of groups) {
    const members = g.memberIds.map((id) => byId.get(id)).filter(Boolean);
    if (members.length < 2) continue;
    generateRoundRobin(members).forEach((day, mi) => {
      newRounds[mi] = newRounds[mi] || [];
      for (const [a, b] of day) {
        const key = pairKey(a.id, b.id);
        let m = existing.get(key);
        if (m) {
          existing.delete(key);
          m.group = g.label;
          kept += 1;
        } else {
          m = {
            id: nextId(),
            sport,
            entrantA: a,
            entrantB: b,
            clash: a.delegation === b.delegation ? a.delegation : null,
            group: g.label,
          };
          added.push(m);
        }
        newRounds[mi].push(m);
      }
    });
  }

  // Fixtures that no longer exist give their slots back.
  const freedSlots = [];
  for (const m of existing.values()) {
    const slot = state.scheduled.get(m.id);
    if (slot) freedSlots.push(slot);
    unbook(state, m.id);
  }
  freedSlots.sort((a, b) => a.startAbs - b.startAbs);

  state.matchesBySport[sport] = [...newRounds.filter((r) => r && r.length), ...koRounds];
  state.groupsBySport[sport] = { groups, unassigned };

  // New pairings take a freed slot first (a swap keeps the same times and
  // venues), as long as neither team is already playing then.
  const needBooking = [];
  const ignore = new Set();
  for (const m of added) {
    const idx = freedSlots.findIndex((s) => !entrantBusy(state, [m.entrantA.id, m.entrantB.id], s, ignore));
    if (idx === -1) {
      needBooking.push(m);
      continue;
    }
    state.scheduled.set(m.id, freedSlots[idx]);
    freedSlots.splice(idx, 1);
  }
  if (needBooking.length) {
    const start = tournamentStart(buildSessions(ctx.flatVenueRows));
    bookRound(state, sport, needBooking, start, ctx);
  }

  // The knockout stage must still start after the last group game.
  if (koRounds.length) {
    const groupEnd = roundEnd(state.matchesBySport[sport].filter((r) => r.some((m) => m.group)).flat(), state.scheduled, 0);
    let floor = groupEnd;
    for (const r of koRounds) {
      const starts = r.map((m) => state.scheduled.get(m.id)?.startAbs).filter((x) => x != null);
      if (starts.length && Math.min(...starts) < floor) {
        r.forEach((m) => unbook(state, m.id));
        bookRound(state, sport, r, floor, ctx);
      }
      floor = roundEnd(r, state.scheduled, floor);
    }
  }

  return { kept, removed: existing.size, added: added.length };
}

// ---------- save / restore ----------

function packEntrant(e, rosterIds) {
  if (e && rosterIds.has(e.id) && !e.isPlaceholder) return { ref: e.id };
  return e ? { ...e } : e;
}

export function serializeTournament(state, entrants) {
  if (!state) return null;
  const rosterIds = new Set(entrants.map((e) => e.id));
  const matchesBySport = {};
  for (const [sport, rounds] of Object.entries(state.matchesBySport)) {
    matchesBySport[sport] = rounds.map((round) =>
      round.map((m) => ({ ...m, entrantA: packEntrant(m.entrantA, rosterIds), entrantB: packEntrant(m.entrantB, rosterIds) }))
    );
  }
  return {
    genId: state.genId || null,
    matchesBySport,
    scheduled: [...state.scheduled.entries()],
    unscheduled: [...state.unscheduled],
    groupsBySport: state.groupsBySport || {},
  };
}

export function deserializeTournament(saved, entrants) {
  if (!saved) return null;
  const byId = new Map(entrants.map((e) => [e.id, e]));
  const unpack = (e) => (e && e.ref ? byId.get(e.ref) || { id: e.ref, name: '(missing)', delegation: '' } : e);
  const matchesBySport = {};
  for (const [sport, rounds] of Object.entries(saved.matchesBySport || {})) {
    matchesBySport[sport] = rounds.map((round) =>
      round.map((m) => ({ ...m, entrantA: unpack(m.entrantA), entrantB: unpack(m.entrantB) }))
    );
  }
  syncProjected(matchesBySport);
  return {
    genId: saved.genId || null,
    matchesBySport,
    scheduled: new Map(saved.scheduled || []),
    unscheduled: saved.unscheduled || [],
    groupsBySport: saved.groupsBySport || {},
  };
}
