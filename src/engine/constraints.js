// constraints.js
// Scheduling requirements ("rules") typed into the AI box and turned into
// structured objects, then enforced here, deterministically. The AI only
// translates text into rules; it never edits fixtures itself.
//
// Rule kinds (every field other than `id` and `kind` is optional unless
// noted; dates are YYYY-MM-DD, times HH:MM 24h):
//
//  unavailable    { target, sport, date, from, to }
//                 target ({type:'delegation'|'team', name}) can't play then.
//                 No date = every day; no from/to = the whole day.
//  onlyWindow     { target, sport, date, from, to }
//                 matches of target (or of sport, if no target) must fall
//                 inside this window on that date / every day.
//  venueClosed    { venue (required), date, from, to }
//  venueForSport  { sport (required), venues (required, list) }
//  minRest        { target, minutes (required) }  gap between a team's matches
//  maxPerDay      { target, sport, max (required) }  matches per team per day
//
// A rule with no target applies to every team.

import { parseDayTimeToMinutes, minutesToLabel } from './core/venueAllocator.js';

const norm = (x) => String(x ?? '').trim().toLowerCase();

const dayStartAbs = (day) => parseDayTimeToMinutes(day, '00:00');
const tod = (slot) => slot.startAbs - dayStartAbs(slot.day); // minute of day
const hm = (t) => {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : null;
};

function sportMatches(ruleSport, sport) {
  if (!ruleSport) return true;
  const a = norm(ruleSport);
  const b = norm(sport);
  return a === b || b.replace(/\s*\((m|f)\)$/, '') === a;
}

function entrantMatches(target, e) {
  if (!target || !e || e.isPlaceholder || e.isWalkin) return false;
  if (target.type === 'team') return norm(e.name) === norm(target.name);
  return norm(e.delegation) === norm(target.name);
}

function matchInvolves(target, m) {
  return entrantMatches(target, m.entrantA) || entrantMatches(target, m.entrantB);
}

/** Does [slot.start, slot.end) overlap the rule's date/time window? */
function inWindow(rule, slot) {
  if (rule.date && rule.date !== slot.day) return false;
  const from = hm(rule.from) ?? 0;
  const to = hm(rule.to) ?? 24 * 60;
  const s = tod(slot);
  const e = s + (slot.endAbs - slot.startAbs);
  return s < to && e > from;
}

/** Is the whole slot inside the rule's window? */
function insideWindow(rule, slot) {
  if (rule.date && rule.date !== slot.day) return true; // window only constrains its own date
  const from = hm(rule.from) ?? 0;
  const to = hm(rule.to) ?? 24 * 60;
  const s = tod(slot);
  const e = s + (slot.endAbs - slot.startAbs);
  return s >= from && e <= to;
}

function teamsOf(m) {
  return [m.entrantA, m.entrantB].filter((e) => e && !e.isPlaceholder && !e.isWalkin);
}

/**
 * Build an accept(match, slot) check for the allocator from the rules and
 * the current bookings (state.scheduled), so a match is only ever placed
 * where every requirement holds.
 */
export function makeAccept(state, rules, ignoreIds = new Set()) {
  if (!rules?.length) return null;
  const byId = new Map();
  for (const rounds of Object.values(state.matchesBySport)) for (const r of rounds) for (const m of r) byId.set(m.id, m);

  return (match, slot) => {
    for (const r of rules) {
      if (r.kind === 'unavailable') {
        if (!sportMatches(r.sport, match.sport)) continue;
        if (r.target ? matchInvolves(r.target, match) : false) {
          if (inWindow(r, slot)) return false;
        }
      } else if (r.kind === 'onlyWindow') {
        if (!sportMatches(r.sport, match.sport)) continue;
        if (r.target && !matchInvolves(r.target, match)) continue;
        if (!insideWindow(r, slot)) return false;
      } else if (r.kind === 'venueClosed') {
        if (norm(r.venue) === norm(slot.venueName) && inWindow(r, slot)) return false;
      } else if (r.kind === 'venueForSport') {
        if (sportMatches(r.sport, match.sport) && r.venues?.length && !r.venues.some((v) => norm(v) === norm(slot.venueName)))
          return false;
      } else if (r.kind === 'minRest' || r.kind === 'maxPerDay') {
        const teams = teamsOf(match).filter((t) => !r.target || entrantMatches(r.target, t));
        if (!teams.length) continue;
        if (r.kind === 'maxPerDay' && !sportMatches(r.sport, match.sport)) continue;
        for (const t of teams) {
          let sameDay = 0;
          for (const [id, s] of state.scheduled) {
            if (id === match.id || ignoreIds.has(id)) continue;
            const other = byId.get(id);
            if (!other || !teamsOf(other).some((x) => x.id === t.id)) continue;
            if (r.kind === 'minRest') {
              const gap = Number(r.minutes) || 0;
              if (s.startAbs < slot.endAbs + gap && slot.startAbs < s.endAbs + gap) return false;
            } else if (s.day === slot.day && (!r.sport || sportMatches(r.sport, other.sport))) {
              sameDay += 1;
            }
          }
          if (r.kind === 'maxPerDay' && sameDay + 1 > (Number(r.max) || 1)) return false;
        }
      }
    }
    return true;
  };
}

/** Closed-venue windows as [{venueName, day?, startAbs, endAbs}] for carving out free time. */
export function closedWindows(rules, flatVenueRows) {
  const out = [];
  for (const r of rules || []) {
    if (r.kind !== 'venueClosed') continue;
    const days = r.date ? [r.date] : [...new Set(flatVenueRows.map((v) => v.day))];
    for (const day of days) {
      out.push({
        venueName: r.venue,
        day,
        startAbs: dayStartAbs(day) + (hm(r.from) ?? 0),
        endAbs: dayStartAbs(day) + (hm(r.to) ?? 24 * 60),
      });
    }
  }
  return out;
}

/** Ids of scheduled matches that currently break at least one rule. */
export function findViolations(state, rules) {
  const bad = new Set();
  if (!rules?.length) return bad;
  for (const rounds of Object.values(state.matchesBySport)) {
    for (const round of rounds) {
      for (const m of round) {
        const slot = state.scheduled.get(m.id);
        if (!slot) continue;
        const accept = makeAccept(state, rules, bad);
        if (!accept(m, slot)) bad.add(m.id);
      }
    }
  }
  return bad;
}

/** Plain-English one-liner for a rule chip. */
export function describeRule(r) {
  const who = r.target ? `${r.target.name}${r.target.type === 'delegation' ? ' (delegation)' : ''}` : 'All teams';
  const sport = r.sport ? ` in ${r.sport}` : '';
  const when = () => {
    const parts = [];
    if (r.date) {
      const [y, mo, d] = r.date.split('-').map(Number);
      parts.push(new Date(y, mo - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }));
    } else parts.push('every day');
    if (r.from || r.to) parts.push(`${r.from || 'start'} to ${r.to || 'close'}`);
    else parts.push('all day');
    return parts.join(', ');
  };
  switch (r.kind) {
    case 'unavailable':
      return `${who}${sport} can't play ${when()}`;
    case 'onlyWindow':
      return `${r.target ? who : r.sport || 'All matches'}${r.target ? sport : ''} only ${when()}`;
    case 'venueClosed':
      return `${r.venue} closed ${when()}`;
    case 'venueForSport':
      return `${r.sport} only at ${(r.venues || []).join(', ')}`;
    case 'minRest':
      return `${who} need ${r.minutes} min between matches`;
    case 'maxPerDay':
      return `${who}${sport} max ${r.max} match${Number(r.max) === 1 ? '' : 'es'} a day`;
    default:
      return r.text || 'Requirement';
  }
}

export { minutesToLabel };
