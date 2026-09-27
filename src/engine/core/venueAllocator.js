// core/venueAllocator.js
// Constraint-satisfaction venue/time allocator.
//
// Framed as a CSP:
//   Variables:   one per real match that needs a slot
//   Domain:      every (venue, day) session's still-free time intervals,
//                filtered down to those long enough to fit the match
//                duration at-or-after the earliest time it's allowed to
//                start
//   Constraints: (1) a venue can host only one match at a time - enforced
//                    by carving the chosen interval (plus the break/buffer)
//                    out of that session's free list the moment it's used,
//                    so it can never be offered again for an overlapping
//                    time; (2) a round can't start until the previous round
//                    in that sport has finished - enforced by the caller
//                    passing a rising `earliest` floor between rounds.
//   Selection heuristic: most-constrained-first - matches are placed one at
//                a time, each taking the earliest slot its domain offers
//                (a match that must fit before other work can proceed
//                shouldn't be made to wait for a "nicer" slot); ties
//                between multiple venues offering that same earliest start
//                are broken by picking whichever venue currently has the
//                FEWEST matches booked, so load spreads evenly across every
//                venue instead of always filling one before touching the
//                next.
//
// This replaces a naive nested-loop "for each match, for each venue, for
// each timeslot" search: free time is tracked as a small set of intervals
// per venue-day (not a slot-by-slot grid), so placing a match is a direct
// interval lookup rather than a scan over every possible minute.

export function parseDayTimeToMinutes(day, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const base = new Date(`${day}T00:00:00`).getTime() / 60000;
  return base + h * 60 + m;
}

export function minutesToLabel(absMinutes) {
  const d = new Date(absMinutes * 60000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function subtractInterval(freeList, bs, be) {
  const result = [];
  for (const iv of freeList) {
    if (be <= iv.start || bs >= iv.end) {
      result.push(iv);
      continue;
    }
    if (bs > iv.start) result.push({ start: iv.start, end: Math.min(bs, iv.end) });
    if (be < iv.end) result.push({ start: Math.max(be, iv.start), end: iv.end });
  }
  return result.filter((iv) => iv.end > iv.start);
}

/** Build one free-interval "session" per venue x day row from the Venues sheet. */
export function buildSessions(venues) {
  return venues
    .map((v) => {
      const dayStartAbs = parseDayTimeToMinutes(v.day, v.dayStart);
      const dayEndAbs = parseDayTimeToMinutes(v.day, v.dayEnd);
      let free = [{ start: dayStartAbs, end: dayEndAbs }];
      if (v.breakStart && v.breakEnd) {
        const bs = parseDayTimeToMinutes(v.day, v.breakStart);
        const be = parseDayTimeToMinutes(v.day, v.breakEnd);
        free = subtractInterval(free, bs, be);
      }
      return {
        venueName: v.venueName,
        sport: v.sport,
        day: v.day,
        dayStartAbs,
        free,
        bookedCount: 0, // used for the even-spread tie-break
      };
    })
    .sort((a, b) => a.dayStartAbs - b.dayStartAbs || a.venueName.localeCompare(b.venueName));
}

export function tournamentStart(sessions) {
  return sessions.length ? Math.min(...sessions.map((s) => s.dayStartAbs)) : 0;
}

// Strip a trailing " (M)"/" (F)" gender suffix so a venue entered once under
// the bare sport name (e.g. "Cricket") still covers matches from both the
// "Cricket (M)" and "Cricket (F)" brackets the engine splits out.
function baseSportName(sportId) {
  return String(sportId || '').replace(/\s*\((M|F)\)$/i, '').trim();
}

function supportsSport(session, sportId) {
  if (session.sport === 'ALL' || session.sport === sportId) return true;
  return session.sport === baseSportName(sportId);
}

/**
 * CSP domain lookup for one match: among every session that can host this
 * sport, find the earliest usable start; break ties by preferring the
 * least-booked venue so far (even spread), then by venue name for
 * determinism.
 */
function findBestSlot(sessions, sportId, duration, earliestPossibleAbs) {
  let best = null;
  for (const session of sessions) {
    if (!supportsSport(session, sportId)) continue;
    for (const iv of session.free) {
      const usableStart = Math.max(iv.start, earliestPossibleAbs);
      if (usableStart + duration > iv.end) continue;
      if (
        !best ||
        usableStart < best.usableStart ||
        (usableStart === best.usableStart &&
          (session.bookedCount < best.session.bookedCount ||
            (session.bookedCount === best.session.bookedCount &&
              session.venueName < best.session.venueName)))
      ) {
        best = { session, iv, usableStart };
      }
    }
  }
  return best;
}

function occupy(session, iv, usableStart, duration, buffer) {
  const occupiedEnd = Math.min(usableStart + duration + buffer, iv.end);
  const idx = session.free.indexOf(iv);
  const replacement = [];
  if (usableStart > iv.start) replacement.push({ start: iv.start, end: usableStart });
  if (occupiedEnd < iv.end) replacement.push({ start: occupiedEnd, end: iv.end });
  session.free.splice(idx, 1, ...replacement);
  session.bookedCount += 1;
}

/**
 * Schedule a sequence of rounds for one sport against a shared, mutable
 * `sessions` array (as built by buildSessions). Each round is an array of
 * match objects; matches with `isWalkover: true` or `isPending: true` are
 * skipped (they book no time slot - a walkover has no real match to play,
 * and a pending match, e.g. a later knockout round, can't be given a real
 * opponent yet). Returns the Map of matchId -> {venueName, day, startLabel,
 * endLabel, startAbs, endAbs}, a list of unscheduled match ids (venue
 * capacity ran out), and the abs-minute end of the last scheduled round.
 */
export function scheduleRounds(sessions, sportId, rounds, settings, earliestStart) {
  const duration = settings?.durationMinutes ?? 30;
  const buffer = settings?.bufferMinutes ?? 0;
  const scheduled = new Map();
  const unscheduled = [];
  let earliest = earliestStart;

  for (const round of rounds) {
    let maxEnd = earliest;
    const realMatches = round.filter((m) => !m.isWalkover && !m.isPending);
    for (const match of realMatches) {
      const slot = findBestSlot(sessions, sportId, duration, earliest);
      if (!slot) {
        unscheduled.push(match.id);
        continue;
      }
      const endAbs = slot.usableStart + duration;
      occupy(slot.session, slot.iv, slot.usableStart, duration, buffer);
      scheduled.set(match.id, {
        venueName: slot.session.venueName,
        day: slot.session.day,
        startAbs: slot.usableStart,
        endAbs,
        startLabel: minutesToLabel(slot.usableStart),
        endLabel: minutesToLabel(endAbs),
      });
      if (endAbs > maxEnd) maxEnd = endAbs;
    }
    earliest = maxEnd;
  }

  return { scheduled, unscheduled, lastRoundEnd: earliest };
}

/**
 * Convenience wrapper: schedule several sports' full round lists in one
 * pass, sharing the same venue sessions, each sport starting from the
 * overall tournament start.
 */
export function scheduleAllSports(sessions, sportsRoundsMap, matchSettingsMap) {
  const start = tournamentStart(sessions);
  const allScheduled = new Map();
  const allUnscheduled = [];
  const lastRoundEndBySport = {};

  for (const [sportId, rounds] of Object.entries(sportsRoundsMap)) {
    const { scheduled, unscheduled, lastRoundEnd } = scheduleRounds(
      sessions,
      sportId,
      rounds,
      matchSettingsMap[sportId],
      start
    );
    for (const [id, v] of scheduled) allScheduled.set(id, v);
    allUnscheduled.push(...unscheduled);
    lastRoundEndBySport[sportId] = lastRoundEnd;
  }

  return { scheduled: allScheduled, unscheduled: allUnscheduled, lastRoundEndBySport };
}
