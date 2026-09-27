// refereeAssignment.js
// FUTURE FEATURE SCAFFOLD - not yet wired into the UI (no referee input
// exists on the left panel yet). Given the bookings list produced by
// conflictDetection.buildBookingsList() and a pool of referee names,
// assigns one referee per match so that no referee is double-booked at an
// overlapping time. Referees are cycled in round-robin order (least
// recently used first) so workload spreads evenly, same fairness idea as
// the venue allocator's least-booked tie-break.

function overlaps(a, b) {
  return a.startAbs < b.endAbs && b.startAbs < a.endAbs;
}

/**
 * @param {Array} bookings   from conflictDetection.buildBookingsList()
 * @param {string[]} refereeNames
 * @returns {{ assignments: Map<string,string>, unassigned: string[] }}
 *          assignments: matchId -> refereeName
 *          unassigned:  matchId list where every referee was already busy
 */
export function assignReferees(bookings, refereeNames) {
  if (!refereeNames.length) {
    return { assignments: new Map(), unassigned: bookings.map((b) => b.matchId) };
  }

  const sorted = [...bookings].sort((a, b) => a.startAbs - b.startAbs);
  const busyUntilByReferee = new Map(refereeNames.map((r) => [r, []])); // list of {startAbs, endAbs}
  const lastUsedOrder = [...refereeNames]; // front = least recently used

  const assignments = new Map();
  const unassigned = [];

  for (const booking of sorted) {
    const freeReferee = lastUsedOrder.find((ref) => {
      const busy = busyUntilByReferee.get(ref);
      return !busy.some((iv) => overlaps(iv, booking));
    });

    if (!freeReferee) {
      unassigned.push(booking.matchId);
      continue;
    }

    assignments.set(booking.matchId, freeReferee);
    busyUntilByReferee.get(freeReferee).push({ startAbs: booking.startAbs, endAbs: booking.endAbs });
    // Move this referee to the back of the queue - least-recently-used next time.
    lastUsedOrder.splice(lastUsedOrder.indexOf(freeReferee), 1);
    lastUsedOrder.push(freeReferee);
  }

  return { assignments, unassigned };
}
