// manualEdit.js
// Backs the schedule table's inline editing. A person can click any cell
// and change it; this module is where that edit actually gets applied to
// the live bracket data (`matchesBySport` + `scheduled`), not just to one
// row on screen.
//
// The key trick: entrant objects are never cloned anywhere upstream
// (matchGenerator.js / the format modules / the roster itself all pass the
// same entrant object by reference). So a single match's entrantA/entrantB
// IS the same object that appears in every other round that entrant plays
// in, and IS the same object sitting in the original roster array. Mutating
// entrant.name or entrant.delegation in place therefore updates every match
// row for that person/team everywhere in the bracket - and keeps the
// original roster correct too, for if the schedule gets regenerated later -
// with no separate "find every other row and rewrite it" pass needed.

import { parseDayTimeToMinutes, minutesToLabel } from './core/venueAllocator.js';

function overlaps(a, b) {
  return a.startAbs < b.endAbs && b.startAbs < a.endAbs;
}

/** Find a match object anywhere in matchesBySport by its id. */
export function findMatchById(matchesBySport, matchId) {
  for (const rounds of Object.values(matchesBySport)) {
    for (const round of rounds) {
      const m = round.find((mm) => mm.id === matchId);
      if (m) return m;
    }
  }
  return null;
}

/**
 * Apply one inline-table edit to the live bracket state, in place.
 *
 * `row` is the currently-displayed (possibly stale-in-other-fields) row for
 * this match - used so that editing just the venue, say, still has the
 * row's current date/time to build a full slot from. `key` is the column
 * being edited ('teamA' | 'teamB' | 'delegationA' | 'delegationB' | 'group'
 * | 'venue' | 'date' | 'time'), `value` is the new raw value, and
 * `matchDuration` is the tournament's configured match length in minutes
 * (used to recompute the end time whenever the start moves).
 *
 * Returns { ok, conflict } - `ok` is false only if the match itself
 * couldn't be found (shouldn't normally happen). `conflict` is set on a
 * reschedule that lands on top of another already-booked match at that
 * venue - the edit is still applied (a manual override might be
 * intentional, e.g. two named courts that are really one physical venue),
 * but the caller can use this to flag the row instead of silently
 * accepting a double-booking.
 */
export function applyRowEdit(genResult, row, key, value, matchDuration) {
  const { matchesBySport, scheduled, unscheduled } = genResult;
  const match = findMatchById(matchesBySport, row.matchId);
  if (!match) return { ok: false, conflict: false };

  const trimmed = typeof value === 'string' ? value.trim() : value;

  if (key === 'teamA' || key === 'teamB') {
    const entrant = key === 'teamA' ? match.entrantA : match.entrantB;
    if (entrant && trimmed) entrant.name = trimmed;
  } else if (key === 'delegationA' || key === 'delegationB') {
    const entrant = key === 'delegationA' ? match.entrantA : match.entrantB;
    if (entrant) entrant.delegation = trimmed;
  } else if (key === 'group') {
    match.group = trimmed || null;
  } else if (key === 'venue' || key === 'date' || key === 'time') {
    const nextVenue = key === 'venue' ? trimmed : row.venue;
    const nextDate = key === 'date' ? trimmed : row.date;
    const nextStart = key === 'time' ? trimmed : row.startTime;

    const stillUnscheduled =
      !nextVenue || !nextDate || !nextStart || nextVenue === 'Unscheduled' || nextDate === 'Unscheduled';

    if (stillUnscheduled) {
      scheduled.delete(row.matchId);
      if (!unscheduled.includes(row.matchId)) unscheduled.push(row.matchId);
      return { ok: true, conflict: false };
    }

    const startAbs = parseDayTimeToMinutes(nextDate, nextStart);
    const endAbs = startAbs + Math.max(1, Number(matchDuration) || 30);
    scheduled.set(row.matchId, {
      venueName: nextVenue,
      day: nextDate,
      startAbs,
      endAbs,
      startLabel: nextStart,
      endLabel: minutesToLabel(endAbs),
    });
    const idx = unscheduled.indexOf(row.matchId);
    if (idx !== -1) unscheduled.splice(idx, 1);

    const clash = [...scheduled.entries()].some(
      ([id, slot]) =>
        id !== row.matchId && slot.venueName === nextVenue && overlaps(slot, { startAbs, endAbs })
    );
    return { ok: true, conflict: clash };
  }

  return { ok: true, conflict: false };
}

/** Every OTHER match currently booked into `sessions`, as {venueName, day, startAbs, endAbs}. */
function otherBookings(scheduled, excludeMatchId) {
  const list = [];
  for (const [matchId, slot] of scheduled) {
    if (matchId === excludeMatchId) continue;
    list.push({ matchId, ...slot });
  }
  return list;
}

/**
 * Would moving `matchId` to (venueName, day, startAbs) for `durationMinutes`
 * collide with any other currently-scheduled match at that venue?
 * (Venue-open-hours / break-window checks are handled separately by the
 * session's free-interval list already built by buildSessions - callers
 * that also want that check should intersect the requested window against
 * `sessions` before calling this.)
 */
export function isSlotAvailable(scheduled, matchId, venueName, day, startAbs, durationMinutes) {
  const candidate = { startAbs, endAbs: startAbs + durationMinutes };
  return !otherBookings(scheduled, matchId).some(
    (b) => b.venueName === venueName && b.day === day && overlaps(b, candidate)
  );
}

/**
 * Commit a manual move: updates the `scheduled` map in place. Callers
 * should run conflictDetection.detectConflicts() afterwards (or check
 * isSlotAvailable() beforehand, as above) since this function itself does
 * not re-validate - it only writes the new slot.
 */
export function rescheduleMatch(scheduled, matchId, venueName, day, startAbs, durationMinutes) {
  const endAbs = startAbs + durationMinutes;
  const pad = (n) => String(n).padStart(2, '0');
  const toLabel = (abs) => {
    const d = new Date(abs * 60000);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  scheduled.set(matchId, {
    venueName,
    day,
    startAbs,
    endAbs,
    startLabel: toLabel(startAbs),
    endLabel: toLabel(endAbs),
  });
  return scheduled.get(matchId);
}
