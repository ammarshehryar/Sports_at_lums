// reportBuilder.js
// Flattens generated matches + their scheduled venue/time slot into plain
// row objects used by the schedule table, the exports, and the analytics
// dashboard.

import { lockedResultIds } from './tournament.js';

function roundLabel(round, roundIdx) {
  if (round.some((m) => m.group)) return `Group Round ${roundIdx + 1}`;
  const n = round.length;
  if (n === 1) return 'Final';
  if (n === 2) return 'Semifinal';
  if (n === 4) return 'Quarterfinal';
  return `Round ${roundIdx + 1}`;
}

export function buildScheduleRows(matchesBySport, scheduled, unscheduledIds) {
  // First pass: match numbers, so a projected slot can read
  // "Winner of Match 3" using the number people actually see.
  const numberById = new Map();
  let n = 0;
  for (const rounds of Object.values(matchesBySport)) {
    for (const round of rounds) for (const m of round) numberById.set(m.id, ++n);
  }
  const locked = lockedResultIds(matchesBySport);
  const display = (e) =>
    e?.isPlaceholder && e.sourceMatchId ? `Winner of Match ${numberById.get(e.sourceMatchId) ?? e.sourceMatchId}` : e?.name ?? '';

  const rows = [];
  for (const [sport, rounds] of Object.entries(matchesBySport)) {
    rounds.forEach((round, roundIdx) => {
      const label = roundLabel(round, roundIdx);
      for (const m of round) {
        const slot = scheduled.get(m.id);
        const isUnscheduled = unscheduledIds.includes(m.id);
        rows.push({
          matchId: m.id,
          matchNumber: numberById.get(m.id),
          sport,
          round: label,
          teamA: display(m.entrantA),
          entrantAId: m.entrantA.id,
          delegationA: m.entrantA.delegation || '',
          teamB: display(m.entrantB),
          entrantBId: m.entrantB.id,
          delegationB: m.entrantB.delegation || '',
          placeholderA: !!m.entrantA.isPlaceholder,
          placeholderB: !!m.entrantB.isPlaceholder,
          group: m.group || null,
          venue: slot?.venueName ?? (isUnscheduled ? 'Unscheduled' : ''),
          date: slot?.day ?? (isUnscheduled ? '—' : ''),
          startTime: slot?.startLabel ?? '',
          endTime: slot?.endLabel ?? '',
          clash: m.clash || '',
          unscheduled: isUnscheduled,
          isWalkover: !!m.isWalkover,
          isProjected: !!m.isProjected,
          winnerId: m.winnerId || null,
          advanced: locked.has(m.id),
        });
      }
    });
  }
  return rows;
}
