// sessionBuilder.js
// Turns the left-panel inputs (venue names, tournament start/end date) into
// the venue x day "session" rows the scheduler engine expects. Each venue
// is open every day of the tournament window, from DAY_START to DAY_END,
// and can host any sport.

export const DAY_START = '09:00';
export const DAY_END = '19:00';

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toDateOnly(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Every calendar day from start to end (inclusive), as YYYY-MM-DD strings. */
export function dateRange(startDate, endDate) {
  const start = toDateOnly(startDate);
  const end = toDateOnly(endDate);
  const days = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    days.push(formatDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/** Build one venue-day row per (venue, day) combination. `sport: 'ALL'` lets
 *  every sport draw from the same shared venue pool. */
export function buildVenueRows(venueNames, startDate, endDate) {
  const days = dateRange(startDate, endDate);
  const rows = [];
  for (const day of days) {
    for (const venueName of venueNames) {
      rows.push({
        venueName,
        sport: 'ALL',
        day,
        dayStart: DAY_START,
        dayEnd: DAY_END,
        breakStart: '',
        breakEnd: '',
      });
    }
  }
  return rows;
}
