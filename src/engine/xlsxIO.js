// xlsxIO.js
// Reads the uploaded roster file (Excel or CSV). The file only ever
// contains, per row: a participant/team name column, a Delegation column,
// and a Sport column. Nothing else is required or expected — venues,
// dates, and match timing are all configured inside the app.

import * as XLSX from 'xlsx';

function normalizeHeader(h) {
  return String(h || '').replace(/[\s_-]+/g, '').toLowerCase();
}

// Accepts either "Participant Name" (individual sports) or "Team Name"
// (team sports) as the name column, plus common variants.
const NAME_HEADER_ALIASES = ['participantname', 'teamname', 'name', 'player', 'participant', 'team'];
const DELEGATION_HEADER_ALIASES = ['delegation', 'institution', 'club', 'school'];
const SPORT_HEADER_ALIASES = ['sport', 'event', 'game'];

function buildHeaderMap(row) {
  const map = {};
  for (const key of Object.keys(row)) {
    map[normalizeHeader(key)] = key;
  }
  return map;
}

function findValue(row, headerMap, aliases) {
  for (const alias of aliases) {
    if (headerMap[alias] != null) return row[headerMap[alias]];
  }
  return '';
}

/** Parse roster rows (already turned into plain objects) into engine-ready entrant records. */
function parseEntrantsRows(rawRows) {
  const errors = [];
  const entrants = [];
  rawRows.forEach((row, i) => {
    const headerMap = buildHeaderMap(row);
    const name = String(findValue(row, headerMap, NAME_HEADER_ALIASES) || '').trim();
    const delegation = String(findValue(row, headerMap, DELEGATION_HEADER_ALIASES) || '').trim();
    const sport = String(findValue(row, headerMap, SPORT_HEADER_ALIASES) || '').trim();

    if (!name || !delegation || !sport) {
      errors.push(`Row ${i + 2}: Name, Delegation and Sport are all required — row skipped`);
      return;
    }
    entrants.push({ id: `E${i + 1}`, name, delegation, sport });
  });
  return { entrants, errors };
}

function fileToRows(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true, raw: false });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = wb.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

/** Parse an uploaded .xlsx/.xls/.csv roster file. Returns {entrants, errors}. */
export async function parseRosterFile(file) {
  try {
    const buf = await file.arrayBuffer();
    const rows = fileToRows(buf);
    if (!rows.length) {
      return { entrants: [], errors: ['The file has no data rows.'] };
    }
    const { entrants, errors } = parseEntrantsRows(rows);
    return { entrants, errors };
  } catch (e) {
    return { entrants: [], errors: [`Could not read file: ${e.message}`] };
  }
}

/** Build a workbook from a plain object of {SheetName: [rowObject, ...]}. */
export function workbookFromSheets(sheetsObj) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheetsObj)) {
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }
  return wb;
}

export function triggerDownload(workbook, filename) {
  XLSX.writeFile(workbook, filename);
}

/** A blank roster template matching the exact three-column schema the app expects. */
export function buildTemplateWorkbook() {
  const sheets = {
    'Read Me': [
      { Notes: 'One row per participant (individual sports) or per team (team sports).' },
      { Notes: 'Column 1: "Participant Name" for individual sports, or "Team Name" for team sports.' },
      { Notes: 'Column 2: "Delegation" — the institution/club/house the entrant represents.' },
      { Notes: 'Column 3: "Sport" — e.g. Football, Badminton, Chess.' },
      { Notes: 'No other columns are read. Venues, dates and match timing are set up in the app.' },
    ],
    Roster: [
      { 'Team Name': 'SDSB Strikers', Delegation: 'SDSB', Sport: 'Football' },
      { 'Team Name': 'SBASSE United', Delegation: 'SBASSE', Sport: 'Football' },
      { 'Team Name': 'MGSHSS FC', Delegation: 'MGSHSS', Sport: 'Football' },
      { 'Participant Name': 'Ali Raza', Delegation: 'SSE', Sport: 'Badminton' },
      { 'Participant Name': 'Bilal Khan', Delegation: 'SSE', Sport: 'Badminton' },
      { 'Participant Name': 'Sara Ahmed', Delegation: 'LAW', Sport: 'Badminton' },
    ],
  };
  return workbookFromSheets(sheets);
}
