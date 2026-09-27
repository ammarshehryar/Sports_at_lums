# Tournament Scheduler

A no-backend, in-browser desktop-style scheduling dashboard. Upload a roster
file, configure venues and tournament dates, and generate a full match
schedule with a built-in analytics dashboard — all client-side, nothing sent
to a server.

## Quick start

```bash
npm install
npm run dev
```

Open the printed local URL.

## How it works

**Left panel (input)**
- Upload an Excel (`.xlsx`/`.xls`) or CSV roster file
- Set the number of venues and name each one
- Set the tournament start/end date
- Set match duration and the break between matches
- Click **Generate Schedule**

**Roster file schema** — exactly three columns are read, header names are
matched flexibly (case/space-insensitive):

| Column | Individual sports | Team sports |
| --- | --- | --- |
| Name | `Participant Name` | `Team Name` |
| `Delegation` | institution/club/house | institution/club/house |
| `Sport` | e.g. Football, Badminton | e.g. Football, Badminton |

No other columns are read. Use **Download blank template** in the app for a
ready-made example file.

**Right panel (output)**
- A sortable, filterable, searchable match schedule table
  (Match #, Sport, Team/Player A & Delegation, Team/Player B & Delegation,
  Venue, Date, Time)
- Export to Excel or PDF
- An analytics dashboard: matches per venue, matches per day, delegation
  distribution, venue utilization, a tournament timeline, and overall stat
  cards

## Scheduling logic

The scheduling engine is a constraint-based system in two independent stages:

**1. Fixture generation (who plays whom).** For each sport, entrants are
split by delegation and paired up by a max-heap greedy matcher
(`core/delegationMatching.js`): at every step it pairs one entrant from each
of the two *largest* remaining delegation groups. This always exhausts
cross-delegation pairings first (Priority 1) and only produces a
same-delegation match once a single delegation is the only one left with
entrants waiting (Priority 2) — which is also mathematically the fewest
same-delegation matches any pairing of the pool could have. One entrant sits
out as a bye if the pool is odd. This produces the maximum possible number
of fixtures for every sport.

**2. Venue/time allocation (where and when).** Matches are placed into
venue-day "sessions" (09:00–19:00 by default) using a constraint-satisfaction
approach: each match's domain is every session's remaining free interval long
enough for the match duration; the earliest available slot is chosen, with
ties broken in favour of whichever venue has hosted the fewest matches so far
so load spreads evenly. Booking a slot carves it (plus the configured break)
out of that venue's free time so it's never offered again — a venue can
never be double-booked by construction. Matches that don't fit anywhere are
flagged as unscheduled so more venues or a wider date range can be added.

## Project layout

- `src/engine/xlsxIO.js` — roster file parsing, template + export workbook building
- `src/engine/matchGenerator.js` — splits the roster by sport and hands each
  sport to the selected fixture format (see `formats/`)
- `src/engine/formats/` — pluggable tournament formats, each exporting
  `generateSport(sportId, entrants, options) -> { rounds, byes, meta }`:
  - `singleRoundDraw.js` — **active default.** One max-diversity round per sport.
  - `roundRobin.js` — every entrant plays every other once (future format)
  - `knockout.js` — single-elimination bracket, Round 1 concrete + later
    rounds symbolic pending results (future format)
  - `swiss.js` — Round 1 draw + a `generateNextRound()` hook for a future
    results-tracking feature (future format)
  - `groupStageKnockout.js` — delegation-spread groups + round robin +
    symbolic knockout stage (future format)
  - `doubleElimination.js` — winners-bracket Round 1 now, losers
    bracket/grand-final scaffolded as documented extension points (future format)
  - `index.js` — the format registry; adding a new format is a two-line change
- `src/engine/core/` — shared low-level building blocks:
  - `delegationMatching.js` — the Priority-1/Priority-2 constraint matcher
  - `venueAllocator.js` — the CSP-based venue/time allocator
  - `delegationDraw.js` — bracket/group seeding with delegation spread + clash repair
  - `roundRobinRotation.js` — circle-method round-robin rotation
- `src/engine/sessionBuilder.js` — turns venue names + date range into bookable sessions
- `src/engine/scheduler.js` — stable import path re-exporting `core/venueAllocator.js`
- `src/engine/reportBuilder.js` — flattens matches + schedule into table rows
- `src/engine/conflictDetection.js` — validates a schedule for venue/entrant
  double-booking (extension point for manual editing)
- `src/engine/refereeAssignment.js` — round-robin referee assignment scaffold (future feature)
- `src/engine/manualEdit.js` — slot-availability check + reschedule commit scaffold (future feature)
- `src/engine/pdfExport.js` — PDF export of the schedule table
- `src/components/` — `LeftPanel`, `ScheduleTable`, `AnalyticsDashboard`, `Header`

The engine and UI are decoupled through plain row objects, so new inputs
(e.g. per-sport durations, per-venue sport restrictions, a format picker) or
new output views can be added without reworking the layout.
