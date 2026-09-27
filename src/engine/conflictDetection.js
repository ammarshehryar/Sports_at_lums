// conflictDetection.js
// Validation pass over a generated schedule. The venue allocator
// (core/venueAllocator.js) can't produce venue double-bookings by
// construction, but this module exists as an independent second check -
// useful right now as a safety net, and essential once "Manual Fixture
// Editing" lets a person drag a match to an arbitrary new slot (where
// nothing upstream guarantees non-overlap any more).
//
// Two conflict types are checked:
//   'venue'    - two matches booked at the same venue with overlapping time
//   'entrant'  - the same entrant (by id) booked into two overlapping
//                matches, even across different sports/venues - a person
//                or team can't physically be in two matches at once.

/** Flatten {matchesBySport, scheduled} into one list of booked matches. */
export function buildBookingsList(matchesBySport, scheduled) {
  const bookings = [];
  for (const [sport, rounds] of Object.entries(matchesBySport)) {
    for (const round of rounds) {
      for (const m of round) {
        const slot = scheduled.get(m.id);
        if (!slot) continue; // unscheduled or pending - nothing to conflict-check yet
        bookings.push({
          matchId: m.id,
          sport,
          entrantAId: m.entrantA?.id,
          entrantBId: m.entrantB?.id,
          venueName: slot.venueName,
          day: slot.day,
          startAbs: slot.startAbs,
          endAbs: slot.endAbs,
        });
      }
    }
  }
  return bookings;
}

function overlaps(a, b) {
  return a.startAbs < b.endAbs && b.startAbs < a.endAbs;
}

/** Convenience wrapper for the schedule table: which match ids currently
 *  have a venue or entrant double-booking, after manual edits? */
export function getConflictedMatchIds(matchesBySport, scheduled) {
  const bookings = buildBookingsList(matchesBySport, scheduled);
  const conflicts = detectConflicts(bookings);
  const ids = new Set();
  for (const c of conflicts) {
    ids.add(c.matchA);
    ids.add(c.matchB);
  }
  return ids;
}

export function detectConflicts(bookings) {
  const conflicts = [];
  for (let i = 0; i < bookings.length; i++) {
    for (let j = i + 1; j < bookings.length; j++) {
      const a = bookings[i];
      const b = bookings[j];
      if (!overlaps(a, b)) continue;

      if (a.venueName === b.venueName) {
        conflicts.push({ type: 'venue', matchA: a.matchId, matchB: b.matchId, venueName: a.venueName });
      }

      const entrantsA = [a.entrantAId, a.entrantBId];
      const entrantsB = [b.entrantAId, b.entrantBId];
      const sharedEntrant = entrantsA.find((id) => id && entrantsB.includes(id));
      if (sharedEntrant) {
        conflicts.push({ type: 'entrant', matchA: a.matchId, matchB: b.matchId, entrantId: sharedEntrant });
      }
    }
  }
  return conflicts;
}
