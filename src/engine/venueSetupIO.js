// venueSetupIO.js
// Pure helpers backing the in-app VenueSetup screen (Change 2): building
// blank venue/day rows, grouping a flat Venues-sheet row list into the
// venue-card shape the UI edits, and flattening that shape back into the
// {venueName, sport, day, dayStart, dayEnd, breakStart, breakEnd} rows
// buildSessions() expects. Kept out of VenueSetup.jsx itself so that file
// only exports the component (keeps fast-refresh happy).

let idCounter = 0;
function makeId() {
  idCounter += 1;
  return `v${idCounter}-${Date.now().toString(36)}`;
}

export function emptyDay() {
  return {
    id: makeId(),
    day: '',
    dayStart: '09:00',
    dayEnd: '18:00',
    breakEnabled: false,
    breakStart: '13:00',
    breakEnd: '14:00',
  };
}

export function makeVenue(name, sport) {
  return { id: makeId(), venueName: name, sport, days: [emptyDay()] };
}

/** Group flat {venueName, sport, day, dayStart, dayEnd, breakStart, breakEnd} rows
 *  (e.g. parsed from an uploaded Venues sheet) into the venue-card shape VenueSetup edits. */
export function groupVenueRows(rows) {
  const map = new Map();
  rows.forEach((r) => {
    const key = `${r.venueName}::${r.sport}`;
    if (!map.has(key)) map.set(key, { id: makeId(), venueName: r.venueName, sport: r.sport, days: [] });
    map.get(key).days.push({
      id: makeId(),
      day: r.day,
      dayStart: r.dayStart,
      dayEnd: r.dayEnd,
      breakEnabled: !!(r.breakStart && r.breakEnd),
      breakStart: r.breakStart || '13:00',
      breakEnd: r.breakEnd || '14:00',
    });
  });
  return [...map.values()];
}

/** Flatten the venue-card shape back into the flat row shape buildSessions() expects.
 *  Rows missing a day/start/end are dropped silently (incomplete, not invalid — the
 *  person is probably still filling them in). */
export function flattenVenues(venues) {
  const flat = [];
  venues.forEach((v) => {
    const venueName = v.venueName.trim();
    if (!venueName) return;
    v.days.forEach((d) => {
      if (!d.day || !d.dayStart || !d.dayEnd) return;
      flat.push({
        venueName,
        sport: v.sport,
        day: d.day,
        dayStart: d.dayStart,
        dayEnd: d.dayEnd,
        breakStart: d.breakEnabled ? d.breakStart : '',
        breakEnd: d.breakEnabled ? d.breakEnd : '',
      });
    });
  });
  return flat;
}
