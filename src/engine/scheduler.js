// scheduler.js
// Public entry point for venue/time allocation. The actual constraint-
// satisfaction implementation lives in core/venueAllocator.js; this file
// just re-exports it so the app's import path (`./engine/scheduler.js`)
// doesn't need to change if the allocator internals evolve.

export {
  buildSessions,
  tournamentStart,
  scheduleRounds,
  scheduleAllSports,
  parseDayTimeToMinutes,
  minutesToLabel,
} from './core/venueAllocator.js';
