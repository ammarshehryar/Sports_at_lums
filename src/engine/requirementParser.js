// requirementParser.js
// The free, built-in assistant behind the Requirements box. Reads a plain
// English requirement and turns it into the same structured rules the AI
// would (see constraints.js), using the tournament's own lists of
// delegations, teams, sports, venues and dates to recognise names. No
// external service, no cost. When the optional AI server function is set up
// (supabase/functions/fixture-ai) it is used instead.
//
// Understands, in any wording close to these:
//   "GIKI can't play between 2 and 4pm on Saturday"
//   "LUMS A is unavailable on 31 October" / "... on day 2" / "... tomorrow"
//   "NUST only plays after 3pm" / "Badminton only in the morning"
//   "Court 2 is closed on Friday morning"
//   "Football only at Field 1 and Field 2"
//   "Every team needs 60 minutes between matches" / "LSE needs a 1 hour gap"
//   "No team plays more than 2 matches a day"
//   "Remove the GIKI rule" / "Clear all requirements" / "Undo the last one"

import { describeRule } from './constraints.js';

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, a: 1, an: 1, single: 1 };
const ORDINAL = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, last: -1, final: -1 };

const pad = (n) => String(n).padStart(2, '0');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hhmm = (mins) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;

function findNames(text, names) {
  // Longest first so "LUMS A" wins over "LUMS"; each match consumes its text.
  const found = [];
  let rest = ` ${text} `;
  for (const n of [...new Set(names)].filter(Boolean).sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`(^|[^a-z0-9])${esc(n.toLowerCase())}(?=[^a-z0-9]|$)`, 'i');
    if (re.test(rest)) {
      found.push(n);
      rest = rest.replace(re, '$1 ');
    }
  }
  return { found, rest };
}

function toMinutes(h, m, ap, fallbackAp) {
  let hour = Number(h);
  const min = Number(m || 0);
  const mer = ap || fallbackAp;
  if (mer === 'pm' && hour < 12) hour += 12;
  if (mer === 'am' && hour === 12) hour = 0;
  return hour * 60 + min;
}

/** {from, to} in HH:MM, or {} when the sentence names no time. */
function parseTimes(t) {
  const range = t.match(
    /(?:between|from)?\s*(\d{1,2})(?::|\.)?(\d{2})?\s*(am|pm)?\s*(?:-|–|to|till|until|and)\s*(\d{1,2})(?::|\.)?(\d{2})?\s*(am|pm)?/
  );
  if (range && (range[3] || range[6] || /between|from/.test(range[0]) || range[2] || range[5])) {
    const [, h1, m1, ap1, h2, m2, ap2] = range;
    let a1 = ap1;
    let a2 = ap2;
    if (!a1 && a2) a1 = Number(h1) <= Number(h2) || Number(h2) === 12 ? (Number(h1) === 12 ? 'pm' : a2) : 'am';
    if (a1 && !a2) a2 = Number(h2) < Number(h1) ? 'pm' : a1;
    if (!a1 && !a2) {
      // "2 to 4": small hours mean afternoon at a sports event.
      a1 = Number(h1) < 8 ? 'pm' : 'am';
      a2 = Number(h2) < 8 || Number(h2) < Number(h1) ? 'pm' : a1 === 'pm' ? 'pm' : Number(h2) === 12 ? 'pm' : 'am';
    }
    return { from: hhmm(toMinutes(h1, m1, a1)), to: hhmm(toMinutes(h2, m2, a2)) };
  }
  const single = t.match(/\b(after|from|past|before|until|till|by)\s+(\d{1,2})(?::|\.)?(\d{2})?\s*(am|pm)?/);
  if (single) {
    const [, word, h, m, ap] = single;
    const mins = toMinutes(h, m, ap, Number(h) < 8 ? 'pm' : undefined);
    return /after|from|past/.test(word) ? { from: hhmm(mins) } : { to: hhmm(mins) };
  }
  if (/\bmorning\b/.test(t)) return { to: '12:00' };
  if (/\bafternoon\b/.test(t)) return { from: '12:00', to: '17:00' };
  if (/\b(evening|night)\b/.test(t)) return { from: '17:00' };
  if (/\b(noon|lunch)\b/.test(t)) return { from: '12:00', to: '14:00' };
  return {};
}

/** Dates (YYYY-MM-DD) the sentence points at, matched against the tournament's days. */
function parseDates(t, days, today) {
  const sorted = [...new Set(days)].sort();
  const out = new Set();
  for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) out.add(`${m[1]}-${m[2]}-${m[3]}`);
  const monthRe = MONTHS.join('|');
  const pushDM = (d, mo) => {
    const mi = MONTHS.indexOf(mo.slice(0, 3));
    const hit = sorted.find((x) => Number(x.slice(5, 7)) === mi + 1 && Number(x.slice(8, 10)) === Number(d));
    if (hit) out.add(hit);
    else {
      const year = (sorted[0] || today).slice(0, 4);
      out.add(`${year}-${pad(mi + 1)}-${pad(d)}`);
    }
  };
  for (const m of t.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthRe})[a-z]*`, 'g'))) pushDM(m[1], m[2]);
  for (const m of t.matchAll(new RegExp(`\\b(${monthRe})[a-z]*\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'g'))) pushDM(m[2], m[1]);
  for (const m of t.matchAll(/\b(\d{1,2})[/.](\d{1,2})\b/g)) {
    const hit = sorted.find((x) => Number(x.slice(8, 10)) === Number(m[1]) && Number(x.slice(5, 7)) === Number(m[2]));
    if (hit) out.add(hit);
  }
  WEEKDAYS.forEach((w, i) => {
    if (new RegExp(`\\b${w}s?\\b|\\b${w.slice(0, 3)}\\b`).test(t)) {
      for (const d of sorted) {
        const [y, mo, dd] = d.split('-').map(Number);
        if (new Date(y, mo - 1, dd).getDay() === i) out.add(d);
      }
    }
  });
  for (const m of t.matchAll(/\bday\s*(\d+)\b/g)) if (sorted[Number(m[1]) - 1]) out.add(sorted[Number(m[1]) - 1]);
  for (const m of t.matchAll(/\b(first|second|third|fourth|fifth|last|final)\s+day\b/g)) {
    const n = ORDINAL[m[1]];
    const d = n === -1 ? sorted[sorted.length - 1] : sorted[n - 1];
    if (d) out.add(d);
  }
  if (/\btoday\b/.test(t)) out.add(today);
  if (/\btomorrow\b/.test(t)) {
    const [y, mo, dd] = today.split('-').map(Number);
    const d = new Date(y, mo - 1, dd + 1);
    out.add(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }
  return [...out];
}

function parseNumber(s) {
  if (s == null) return null;
  if (/^\d+$/.test(s)) return Number(s);
  return WORD_NUM[s] ?? null;
}

/** Split a message into requirement-sized sentences. */
function clauses(text) {
  const t = text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\bcan ?not\b/g, "can't")
    .replace(/\bdo not\b/g, "don't");
  const parts = t.split(/[.;\n]+|\balso\b/).flatMap((p) => p.split(/,?\s+and\s+(?=[a-z][\w ]*\b(?:is|are|can't|cannot|won't|only|needs?|closed|unavailable|should|must|has|have)\b)/));
  return parts.map((p) => p.trim()).filter((p) => p.length > 2);
}

export function parseRequirement(message, context, existingRules) {
  const days = (context.venueDays || []).map((v) => v.date);
  const today = context.today || new Date().toISOString().slice(0, 10);
  const teams = Object.values(context.teamsBySport || {}).flat();
  const add = [];
  const remove = [];
  const notes = [];

  for (const c of clauses(message)) {
    // ---- removing rules ----
    if (/\b(remove|cancel|delete|undo|clear|forget|drop|scrap)\b/.test(c)) {
      if (/\b(all|every|everything)\b/.test(c)) {
        remove.push(...existingRules.map((r) => r.id));
        continue;
      }
      if (/\b(last|latest|previous)\b/.test(c) && existingRules.length) {
        remove.push(existingRules[existingRules.length - 1].id);
        continue;
      }
      const hits = existingRules.filter((r) => {
        const d = describeRule(r).toLowerCase();
        return c
          .replace(/\b(remove|cancel|delete|undo|clear|forget|drop|scrap|the|rule|requirement|for|about|on|one)\b/g, ' ')
          .split(/\s+/)
          .filter((w) => w.length > 2)
          .some((w) => d.includes(w));
      });
      if (hits.length) remove.push(...hits.map((r) => r.id));
      else notes.push(`I couldn't tell which requirement to remove from "${c}".`);
      continue;
    }

    const venueHit = findNames(c, context.venues || []);
    const sportHit = findNames(venueHit.rest, context.sports || []);
    const teamHit = findNames(sportHit.rest, teams);
    const delHit = findNames(teamHit.rest, context.delegations || []);
    const targets = [
      ...teamHit.found.map((name) => ({ type: 'team', name })),
      ...delHit.found.map((name) => ({ type: 'delegation', name })),
    ];
    const sport = sportHit.found[0];
    const times = parseTimes(c);
    const dates = parseDates(c, days, today);
    const allDay = /\b(all|whole|entire|full)\s+day\b/.test(c);
    const win = allDay ? {} : times;
    const forDates = (base) => (dates.length ? dates.map((date) => ({ ...base, date })) : [base]);

    const restM = c.match(/\b(\d+|an?|one|two)\s*(hours?|hrs?|h|minutes?|mins?|m)\b(?=.*\b(rest|gap|break|between|apart|recover))|\b(rest|gap|break)\b.*?(\d+|an?|one|two)\s*(hours?|hrs?|minutes?|mins?)/);
    const maxM = c.match(/(?:max(?:imum)?|at most|more than|only|up to)\s+(\d+|one|two|three|four|a|single)\s+(?:match|matches|game|games)\s+(?:a|per|each|in a)\s+day/);
    const negative = /\b(can't|won't|don't|not|no|unavailable|busy|away|off|avoid|never|without|isn't|aren't|exempt|excluded?)\b/.test(c);
    const closedWord = /\b(closed|shut|unavailable|not available|blocked|booked|maintenance|reserved|out of use|occupied)\b/.test(c);
    const onlyWord = /\b(only|just|exclusively|must|should)\b/.test(c);

    if (restM) {
      const n = parseNumber(restM[1] ?? restM[5]) ?? 1;
      const unit = restM[2] ?? restM[6];
      const minutes = /^h/.test(unit) ? n * 60 : n;
      if (targets.length) for (const target of targets) add.push({ kind: 'minRest', target, minutes });
      else add.push({ kind: 'minRest', minutes });
      continue;
    }
    if (maxM) {
      const max = parseNumber(maxM[1]) ?? 1;
      const base = { kind: 'maxPerDay', max, ...(sport ? { sport } : {}) };
      if (targets.length) for (const target of targets) add.push({ ...base, target });
      else add.push(base);
      continue;
    }
    if (venueHit.found.length && !targets.length && sport && onlyWord && !negative) {
      add.push({ kind: 'venueForSport', sport, venues: venueHit.found });
      continue;
    }
    if (venueHit.found.length && !targets.length && (closedWord || negative)) {
      for (const venue of venueHit.found) add.push(...forDates({ kind: 'venueClosed', venue, ...win }));
      continue;
    }
    if (targets.length && negative) {
      if (!dates.length && !win.from && !win.to) {
        notes.push(`For "${c}", when can't they play? Add a time, a day or "all day".`);
        continue;
      }
      for (const target of targets) add.push(...forDates({ kind: 'unavailable', target, ...(sport ? { sport } : {}), ...win }));
      continue;
    }
    if ((targets.length || sport) && onlyWord && (win.from || win.to || dates.length)) {
      const base = { kind: 'onlyWindow', ...(sport ? { sport } : {}), ...win };
      if (targets.length) for (const target of targets) add.push(...forDates({ ...base, target }));
      else add.push(...forDates(base));
      continue;
    }
    if (targets.length && (dates.length || win.from || win.to) && /\b(away|leaving|travel|exam|prayer|busy|class|event)\b/.test(c)) {
      for (const target of targets) add.push(...forDates({ kind: 'unavailable', target, ...win }));
      continue;
    }
    notes.push(
      targets.length || venueHit.found.length || sport
        ? `I recognised ${[...targets.map((x) => x.name), ...venueHit.found, sport].filter(Boolean).join(', ')} in "${c}", but not what should happen. Try "can't play between 2 and 4pm on Saturday" or "only at Field 1".`
        : `I didn't recognise a team, delegation, sport or venue in "${c}". Names must match the roster or venue list.`
    );
  }

  const lines = [];
  if (add.length) lines.push(`Added: ${add.map((r) => describeRule(r)).join('; ')}.`);
  if (remove.length) lines.push(`Removed ${remove.length} requirement${remove.length === 1 ? '' : 's'}.`);
  lines.push(...notes);
  return { reply: lines.join(' ') || 'Tell me a requirement, for example "GIKI can’t play between 2 and 4pm on Saturday".', add, remove };
}
