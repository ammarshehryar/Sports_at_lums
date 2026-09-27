// formats/index.js
// Registry of pluggable fixture-generation formats. Every module exports
// `generateSport(sportId, entrants, options) -> { rounds, byes, meta }` and
// (optionally) `resetMatchCounter()`. Adding a new format to the app is a
// two-line change: write the module, then add it to FORMATS below.
//
// Only 'singleRoundDraw' is currently wired into the UI (via
// matchGenerator.js's default parameter) - the rest are ready to use as
// soon as a format-selector control is added to the left panel.

import * as singleRoundDraw from './singleRoundDraw.js';
import * as roundRobin from './roundRobin.js';
import * as knockout from './knockout.js';
import * as swiss from './swiss.js';
import * as groupStageKnockout from './groupStageKnockout.js';
import * as doubleElimination from './doubleElimination.js';

export const FORMATS = {
  singleRoundDraw,
  roundRobin,
  knockout,
  swiss,
  groupStageKnockout,
  doubleElimination,
};

export function getFormat(name) {
  return FORMATS[name] || FORMATS.singleRoundDraw;
}

export function listFormats() {
  return Object.keys(FORMATS);
}
