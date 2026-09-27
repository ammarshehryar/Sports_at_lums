// reportBuilder.js
// Flattens generated matches + their scheduled venue/time slot into plain
// row objects used by the schedule table, the exports, and the analytics
// dashboard.

function roundLabel(matchCount, roundIdx) {
  if (matchCount === 1) return 'Final';
  if (matchCount === 2) return 'Semifinal';
  if (matchCount === 4) return 'Quarterfinal';
  return `Round ${roundIdx + 1}`;
}

export function buildScheduleRows(matchesBySport, scheduled, unscheduledIds) {
  const rows = [];
  let matchNumber = 0;
  for (const [sport, rounds] of Object.entries(matchesBySport)) {
    rounds.forEach((round, roundIdx) => {
      const label = roundLabel(round.length, roundIdx);
      for (const m of round) {
        matchNumber += 1;
        const slot = scheduled.get(m.id);
        const isUnscheduled = unscheduledIds.includes(m.id);
        rows.push({
          matchId: m.id,
          matchNumber,
          sport,
          round: label,
          teamA: m.entrantA.name,
          entrantAId: m.entrantA.id,
          delegationA: m.entrantA.delegation,
          teamB: m.entrantB.name,
          entrantBId: m.entrantB.id,
          delegationB: m.entrantB.delegation,
          group: m.group || null,
          venue: slot?.venueName ?? (isUnscheduled ? 'Unscheduled' : ''),
          date: slot?.day ?? (isUnscheduled ? '—' : ''),
          startTime: slot?.startLabel ?? '',
          endTime: slot?.endLabel ?? '',
          clash: m.clash || '',
          unscheduled: isUnscheduled,
          isWalkover: !!m.isWalkover,
          winnerId: m.winnerId || null,
          advanced: !!m.advanced,
        });
      }
    });
  }
  return rows;
}
