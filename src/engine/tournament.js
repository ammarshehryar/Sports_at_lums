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
//  3. Results everywhere. Winners can be recorded on every match, group
//     games included. A group's winner (most wins, then head to head, then
//     a manual pick if still tied) fills its "Winner of Group X" knockout
//     slot, and the knockout then runs round by round to the final.
//
//  4. Mirror swaps. Typing another team's name into a first-round fixture
//     swaps the two positions (walkovers included), and time slots follow.
//
//  5. Requirements (constraints.js). Every booking respects them, and
//     enforceRules() moves any fixture that breaks one.
//
//  6. Save/restore. Matches share entrant objects by reference (manual
//     edits rely on that, see manualEdit.js), so the saved form stores
//     roster entrants as {ref: id} and relinks them on load.

import { buildSessions, scheduleRounds, tournamentStart, subtractInterval } from './core/venueAllocator.js';
import { buildAllMatches } from './matchGenerator.js';
import { generateRoundRobin } from './core/roundRobinRotation.js';
import { makeAccept, closedWindows, findViolations } from './constraints.js';

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
export function rebuildSessions(flatVenueRows, scheduled, bufferMinutes = 0, rules = []) {
  const sessions = buildSessions(flatVenueRows);
  for (const w of closedWindows(rules, flatVenueRows)) {
    for (const s of sessions) {
      if (s.day === w.day && s.venueName.trim().toLowerCase() === String(w.venueName).trim().toLowerCase()) {
        s.free = subtractInterval(s.free, w.startAbs, w.endAbs);
      }
    }
  }
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
  const sessions = rebuildSessions(ctx.flatVenueRows, state.scheduled, ctx.settings.bufferMinutes, ctx.rules);
  const settings = { ...ctx.settings, accept: makeAccept(state, ctx.rules) };
  const { scheduled, unscheduled } = scheduleRounds(sessions, sport, [round], settings, floor);
  for (const [id, v] of scheduled) state.scheduled.set(id, v);
  for (const id of unscheduled) if (!state.unscheduled.includes(id)) state.unscheduled.push(id);
}

function unbook(state, id) {
  state.scheduled.delete(id);
  const i = state.unscheduled.indexOf(id);
  if (i !== -1) state.unscheduled.splice(i, 1);
}

// ---------- results and projected rounds ----------

const isGroupSrc = (src) => typeof src === 'string' && src.startsWith('group:');

export function matchWinner(m) {
  if (!m) return null;
  const a = m.entrantA;
  const b = m.entrantB;
  if (m.isWalkover || a?.isWalkin || b?.isWalkin) {
    const real = a?.isWalkin ? b : a;
    return real && !real.isWalkin && !real.isPlaceholder ? real : null;
  }
  if (!m.winnerId || m.winnerId === 'draw') return null;
  if (a?.isPlaceholder || b?.isPlaceholder) return null;
  if (m.winnerId === a.id) return a;
  if (m.winnerId === b.id) return b;
  return null;
}

/**
 * Standings for one group: wins per team from recorded results. The winner
 * is known once every group match has a result: most wins, then wins in
 * matches among the tied teams, then a manual pick (groupsBySport[sport]
 * .winners[label]) if it is still level.
 */
export function groupStandings(state, sport, label) {
  const info = state.groupsBySport?.[sport];
  const group = info?.groups?.find((g) => g.label === label);
  if (!group) return { rows: [], complete: false, winner: null, tied: [] };
  const rounds = state.matchesBySport[sport] || [];
  const matches = rounds.flat().filter((m) => m.group === label);
  const wins = new Map(group.memberIds.map((id) => [id, 0]));
  const played = new Map(group.memberIds.map((id) => [id, 0]));
  let complete = true;
  for (const m of matches) {
    const w = matchWinner(m);
    if (!w) {
      complete = false;
      continue;
    }
    for (const e of [m.entrantA, m.entrantB]) if (played.has(e.id)) played.set(e.id, played.get(e.id) + 1);
    if (wins.has(w.id)) wins.set(w.id, wins.get(w.id) + 1);
  }
  const rows = group.memberIds.map((id) => ({ id, wins: wins.get(id), played: played.get(id) }));
  if (!group.memberIds.length) return { rows, complete: false, winner: null, tied: [] };
  if (group.memberIds.length === 1) return { rows, complete: true, winner: group.memberIds[0], tied: [] };
  if (!complete) return { rows, complete, winner: null, tied: [] };

  const max = Math.max(...rows.map((r) => r.wins));
  let tied = rows.filter((r) => r.wins === max).map((r) => r.id);
  if (tied.length > 1) {
    const h2h = new Map(tied.map((id) => [id, 0]));
    for (const m of matches) {
      if (!h2h.has(m.entrantA.id) || !h2h.has(m.entrantB.id)) continue;
      const w = matchWinner(m);
      if (w) h2h.set(w.id, h2h.get(w.id) + 1);
    }
    const best = Math.max(...h2h.values());
    tied = tied.filter((id) => h2h.get(id) === best);
  }
  if (tied.length === 1) return { rows, complete, winner: tied[0], tied: [] };
  const pick = info.winners?.[label];
  return { rows, complete, winner: tied.includes(pick) ? pick : null, tied };
}

function resolveSource(state, sport, src, entrantsById) {
  if (isGroupSrc(src)) {
    const { winner } = groupStandings(state, sport, src.slice(6));
    return winner ? entrantsById.get(winner) || null : null;
  }
  return matchWinner(findMatch(state.matchesBySport, src));
}

function placeholderFor(src) {
  if (isGroupSrc(src)) {
    const label = src.slice(6);
    return { id: `TBD:${src}`, name: `Winner of Group ${label}`, delegation: '', isPlaceholder: true, sourceGroup: label };
  }
  return { id: `TBD:${src}`, name: `Winner of ${src}`, delegation: '', isPlaceholder: true, sourceMatchId: src };
}

function walkinOpponent() {
  return { id: 'WALKIN', name: 'Walkin match', delegation: '', isWalkin: true };
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

function entrantsIndex(state) {
  const byId = new Map();
  for (const rounds of Object.values(state.matchesBySport)) {
    for (const r of rounds) for (const m of r) for (const e of [m.entrantA, m.entrantB]) if (e && !e.isPlaceholder) byId.set(e.id, e);
  }
  return byId;
}

/**
 * Fill every projected slot whose feeder (a match, or a whole group) now has
 * a winner, and put the placeholder back if that result was cleared. If the
 * entrant in a slot changes, a winner recorded on the projected match
 * itself is dropped, since it would point at someone no longer in it.
 */
export function syncProjected(state) {
  const byId = entrantsIndex(state);
  for (const [sport, rounds] of Object.entries(state.matchesBySport)) {
    for (const round of rounds) {
      for (const m of round) {
        if (!m.sourceA && !m.sourceB) continue;
        for (const side of ['A', 'B']) {
          const src = m[`source${side}`];
          if (!src) continue;
          const w = resolveSource(state, sport, src, byId);
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

/** Ids of matches whose result feeds a match that already has a result (their result is frozen). */
export function lockedResultIds(matchesBySport) {
  const locked = new Set();
  const all = allMatches(matchesBySport);
  for (const m of all) {
    if (!m.winnerId) continue;
    for (const src of [m.sourceA, m.sourceB]) {
      if (!src) continue;
      if (isGroupSrc(src)) {
        const label = src.slice(6);
        for (const g of all) if (g.sport === m.sport && g.group === label) locked.add(g.id);
      } else locked.add(src);
    }
  }
  return locked;
}

/** Earliest a match may start: after its feeders (or the whole group stage) finish. */
function floorFor(state, m, ctx) {
  const start = tournamentStart(buildSessions(ctx.flatVenueRows));
  let floor = start;
  const rounds = state.matchesBySport[m.sport] || [];
  for (const src of [m.sourceA, m.sourceB]) {
    if (!src) continue;
    if (isGroupSrc(src)) {
      floor = roundEnd(rounds.flat().filter((g) => g.group), state.scheduled, floor);
    } else {
      const f = findMatch(state.matchesBySport, src);
      if (f) floor = roundEnd([f, ...feedersDeep(state, f)], state.scheduled, floor);
    }
  }
  return floor;
}

function feedersDeep(state, m) {
  const out = [];
  for (const src of [m.sourceA, m.sourceB]) {
    if (!src || isGroupSrc(src)) continue;
    const f = findMatch(state.matchesBySport, src);
    if (f) out.push(f, ...feedersDeep(state, f));
  }
  return out;
}

/**
 * Once every feeder of the latest knockout round has a winner, project and
 * book the round after it. Loops so a run of walkovers can cascade. Works
 * the same for a straight knockout and for the knockout after groups.
 */
export function autoAdvance(state, ctx) {
  const created = [];
  const nextId = makeIdFactory(state.matchesBySport);
  let progressed = true;
  while (progressed) {
    progressed = false;
    syncProjected(state);
    for (const [sport, rounds] of Object.entries(state.matchesBySport)) {
      const last = rounds[rounds.length - 1];
      if (!last || last.length < 2) continue;
      if (!last.every((m) => m.sourceA || m.sourceB)) continue; // only knockout rounds
      if (!last.every((m) => matchWinner(m) || (!m.entrantA.isPlaceholder && !m.entrantB.isPlaceholder))) continue;
      const next = projectRound(sport, last, nextId);
      if (!next.length) continue;
      rounds.push(next);
      const floor = roundEnd(last, state.scheduled, floorFor(state, last[0], ctx));
      bookRound(state, sport, next, floor, ctx);
      created.push(...next.map((m) => m.id));
      progressed = true;
    }
  }
  syncProjected(state);
  return created;
}

export function setResult(state, matchId, winnerId, ctx) {
  const m = findMatch(state.matchesBySport, matchId);
  if (!m || m.isWalkover || m.entrantA.isWalkin || m.entrantB.isWalkin) return false;
  if (m.entrantA.isPlaceholder || m.entrantB.isPlaceholder) return false;
  if (lockedResultIds(state.matchesBySport).has(matchId)) return false;
  m.winnerId = m.winnerId === winnerId ? null : winnerId;
  syncProjected(state);
  autoAdvance(state, ctx);
  return true;
}

/** Manual pick for a group that is level after head to head. */
export function setGroupWinner(state, sport, label, entrantId, ctx) {
  const info = state.groupsBySport?.[sport];
  if (!info) return;
  info.winners = { ...(info.winners || {}), [label]: entrantId };
  syncProjected(state);
  autoAdvance(state, ctx);
}

/** Per sport: champion once the final has a result, and how many results are still open. */
export function bracketStatus(state) {
  const status = {};
  for (const [sport, rounds] of Object.entries(state.matchesBySport)) {
    const last = rounds[rounds.length - 1] || [];
    const isFinal = last.length === 1 && !last[0].group;
    const champion = isFinal ? matchWinner(last[0]) : null;
    const open = rounds.flat().filter((m) => !m.isWalkover && !matchWinner(m)).length;
    status[sport] = { isFinal, champion, open };
  }
  return status;
}

// ---------- mirror swaps (schedule table team cells) ----------

const WALKIN_WORDS = /^(walk ?in( match)?|walkover|bye|w\/o)$/i;
const normName = (x) => String(x ?? '').trim().toLowerCase();

function syncWalkover(m) {
  m.isWalkover = !!(m.entrantA?.isWalkin || m.entrantB?.isWalkin);
  const a = m.entrantA;
  const b = m.entrantB;
  m.clash = !m.isWalkover && a.delegation && a.delegation === b.delegation ? a.delegation : null;
}

/**
 * Typing `name` into a team cell of a fixture.
 *  - It's another team in this sport's draw: the two swap places (the
 *    mirror replacement), walkovers included.
 *  - It's "Walkin match"/"bye": swaps with a walkover slot, if there is one.
 *  - It's a new name: renames this team, or, on a walk-in slot, adds a new
 *    team there and turns the walkover into a real fixture.
 * Group-stage fixtures are handled by the group editor instead (App.jsx).
 * Returns { ok, message, newEntrant? }.
 */
export function replaceTeam(state, matchId, side, name, entrants, ctx) {
  const m = findMatch(state.matchesBySport, matchId);
  if (!m) return { ok: false, message: 'Match not found.' };
  const key = `entrant${side}`;
  const cur = m[key];
  if (m[`source${side}`]) return { ok: false, message: 'This slot is filled by an earlier result, so it can only change there.' };
  const locked = lockedResultIds(state.matchesBySport);
  const wantWalkin = WALKIN_WORDS.test(name.trim());

  // Every fixed (not result-fed) position in this sport.
  const positions = [];
  for (const round of state.matchesBySport[m.sport] || []) {
    for (const x of round) {
      if (x.group) continue;
      for (const sd of ['A', 'B']) {
        if (x[`source${sd}`]) continue;
        positions.push({ match: x, side: sd, entrant: x[`entrant${sd}`] });
      }
    }
  }
  const target = positions.find((p) =>
    p.match === m && p.side === side
      ? false
      : wantWalkin
        ? p.entrant?.isWalkin
        : !p.entrant?.isWalkin && !p.entrant?.isPlaceholder && normName(p.entrant?.name) === normName(name)
  );

  if (!target) {
    if (wantWalkin) return { ok: false, message: 'There is no walkover slot in this draw to swap with.' };
    // Another team of this sport that isn't in the draw: put it here.
    const outside = entrants.find((e) => e.sport === m.sport && normName(e.name) === normName(name));
    if (outside && outside.id !== cur.id) {
      if (m.winnerId) return { ok: false, message: 'Clear this match\'s result first.' };
      const wasWalk = m.isWalkover;
      m[key] = outside;
      syncWalkover(m);
      if (wasWalk && !m.isWalkover) bookOne(state, m, ctx);
      syncProjected(state);
      autoAdvance(state, ctx);
      return { ok: true, message: `${outside.name} replaced ${cur.isWalkin ? 'the walkover' : cur.name}.` };
    }
    if (cur.isWalkin) {
      const newEntrant = {
        id: `N${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
        name: name.trim(),
        delegation: '',
        sport: m.sport,
      };
      m[key] = newEntrant;
      syncWalkover(m);
      bookOne(state, m, ctx);
      syncProjected(state);
      autoAdvance(state, ctx);
      return { ok: true, message: `Added ${newEntrant.name}; the walkover is now a real fixture.`, newEntrant };
    }
    cur.name = name.trim();
    return { ok: true, message: `Renamed to ${cur.name}.` };
  }

  const other = target.match;
  if (m.winnerId || other.winnerId || locked.has(m.id) || locked.has(other.id)) {
    return { ok: false, message: 'One of these fixtures already has a result. Clear it first, then swap.' };
  }
  const tKey = `entrant${target.side}`;
  const mine = m[key];
  const theirs = other[tKey];
  const wasWalk = new Map([[m, !!m.isWalkover], [other, !!other.isWalkover]]);
  m[key] = theirs;
  other[tKey] = mine;
  for (const x of [m, other]) {
    if (x.entrantA.isWalkin && x.entrantB.isWalkin) {
      // Would leave a walkover against a walkover: undo.
      m[key] = mine;
      other[tKey] = theirs;
      return { ok: false, message: 'That swap would leave a fixture with no teams.' };
    }
    syncWalkover(x);
  }

  // Slots follow: a fixture that became a walkover frees its slot, and a
  // walkover that became real takes that slot (or the next free one).
  const freed = [];
  for (const x of [m, other]) {
    if (!wasWalk.get(x) && x.isWalkover) {
      const slot = state.scheduled.get(x.id);
      if (slot) freed.push(slot);
      unbook(state, x.id);
    }
  }
  for (const x of [m, other]) {
    if (wasWalk.get(x) && !x.isWalkover) {
      if (freed.length) state.scheduled.set(x.id, freed.shift());
      else bookOne(state, x, ctx);
    }
  }
  syncProjected(state);
  autoAdvance(state, ctx);
  const label = (e) => (e.isWalkin ? 'the walkover' : e.name);
  return { ok: true, message: `Swapped ${label(mine)} and ${label(theirs)}.` };
}

function bookOne(state, m, ctx) {
  unbook(state, m.id);
  bookRound(state, m.sport, [m], floorFor(state, m, ctx), ctx);
}

// ---------- requirements ----------

/**
 * Move every fixture that breaks a requirement (or now starts before the
 * matches feeding it have finished) to the earliest slot where everything
 * holds. Returns { moved: [{id, from, to}], failed: [id] }.
 */
export function enforceRules(state, ctx) {
  const moved = [];
  const failed = [];
  // A rule removed later shouldn't leave fixtures stranded: retry the unscheduled ones.
  for (const id of [...state.unscheduled]) {
    const m = findMatch(state.matchesBySport, id);
    if (m && !m.isWalkover) {
      bookOne(state, m, ctx);
      if (state.scheduled.has(id)) moved.push({ id, from: null, to: state.scheduled.get(id) });
    }
  }
  for (let pass = 0; pass < 4; pass++) {
    const bad = findViolations(state, ctx.rules || []);
    for (const rounds of Object.values(state.matchesBySport)) {
      for (const round of rounds) {
        for (const m of round) {
          const slot = state.scheduled.get(m.id);
          if (slot && (m.sourceA || m.sourceB) && slot.startAbs < floorFor(state, m, ctx)) bad.add(m.id);
        }
      }
    }
    if (!bad.size) break;
    const ordered = [...bad]
      .map((id) => ({ id, m: findMatch(state.matchesBySport, id), from: state.scheduled.get(id) }))
      .filter((x) => x.m)
      .sort((a, b) => (a.from?.startAbs ?? 0) - (b.from?.startAbs ?? 0));
    for (const { id, m, from } of ordered) {
      bookOne(state, m, ctx);
      const to = state.scheduled.get(id);
      if (to) moved.push({ id, from, to });
      else if (!failed.includes(id)) failed.push(id);
    }
  }
  // Report each fixture once, with where it started and where it ended up.
  const byId = new Map();
  for (const x of moved) byId.set(x.id, { id: x.id, from: byId.get(x.id)?.from ?? x.from, to: x.to });
  return { moved: [...byId.values()].filter((x) => state.scheduled.get(x.id)), failed: failed.filter((id) => !state.scheduled.has(id)) };
}

// ---------- generation ----------

export function generateTournament({ entrants, stageFormat, formatOptions, flatVenueRows, settings, rules = [] }) {
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
  }

  const groupsBySport = {};
  for (const sport of order) {
    if (metaBySport[sport]?.groups) {
      groupsBySport[sport] = { groups: metaBySport[sport].groups, unassigned: [], winners: {} };
    }
  }

  // Group stage: knockout fed by group winners ("Winner of Group A"),
  // padded to a full bracket with walkovers so it always reaches a final.
  if (formatName === 'groupStageKnockout') {
    const nextId = makeIdFactory(matchesBySport);
    for (const sport of order) {
      const groupRounds = matchesBySport[sport].filter((r) => !r.some((m) => m.stage === 'knockout'));
      const labels = (groupsBySport[sport]?.groups || []).filter((g) => g.memberIds.length).map((g) => g.label);
      matchesBySport[sport] = groupRounds;
      if (labels.length < 2) continue;
      let size = 1;
      while (size < labels.length) size *= 2;
      const walkovers = size - labels.length;
      const realPairs = size / 2 - walkovers;
      const real = [];
      const walk = [];
      for (let i = 0; i < realPairs; i++) {
        const [x, y] = [labels[2 * i], labels[2 * i + 1]];
        real.push({ id: nextId(), sport, entrantA: placeholderFor(`group:${x}`), entrantB: placeholderFor(`group:${y}`), sourceA: `group:${x}`, sourceB: `group:${y}`, clash: null, isProjected: true });
      }
      for (const x of labels.slice(2 * realPairs)) {
        walk.push({ id: nextId(), sport, entrantA: placeholderFor(`group:${x}`), entrantB: walkinOpponent(), sourceA: `group:${x}`, clash: null, isProjected: true, isWalkover: true });
      }
      const ko = [];
      while (real.length || walk.length) {
        if (real.length) ko.push(real.shift());
        if (walk.length) ko.push(walk.shift());
      }
      matchesBySport[sport].push(ko);
    }
  }

  const sessions = rebuildSessions(flatVenueRows, new Map(), settings.bufferMinutes, rules);
  const start = tournamentStart(buildSessions(flatVenueRows));
  const scheduled = new Map();
  const unscheduled = [];
  const draft = { matchesBySport, scheduled, groupsBySport };
  for (const sport of order) {
    const res = scheduleRounds(sessions, sport, matchesBySport[sport], { ...settings, accept: makeAccept(draft, rules) }, start);
    for (const [id, v] of res.scheduled) scheduled.set(id, v);
    unscheduled.push(...res.unscheduled);
  }

  const genId = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const state = { genId, matchesBySport, scheduled, unscheduled, groupsBySport };
  const ctx = { flatVenueRows, settings, rules };
  syncProjected(state);
  // A first round that is all walkovers (tiny pools) resolves itself.
  autoAdvance(state, ctx);
  if (rules.length) enforceRules(state, ctx);
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
  state.groupsBySport[sport] = { ...(state.groupsBySport[sport] || {}), groups, unassigned };

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

  syncProjected(state);
  autoAdvance(state, ctx);
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
  const state = {
    genId: saved.genId || null,
    matchesBySport,
    scheduled: new Map(saved.scheduled || []),
    unscheduled: saved.unscheduled || [],
    groupsBySport: saved.groupsBySport || {},
  };
  syncProjected(state);
  return state;
}
