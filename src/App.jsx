import { useCallback, useMemo, useRef, useState } from 'react';
import Header from './components/Header.jsx';
import LeftPanel from './components/LeftPanel.jsx';
import ScheduleTable from './components/ScheduleTable.jsx';
import GroupsOverview from './components/GroupsOverview.jsx';
import AnalyticsDashboard from './components/AnalyticsDashboard.jsx';
import LandingPage from './components/LandingPage.jsx';
import PasswordGate, { isUnlocked } from './components/PasswordGate.jsx';
import { parseRosterFile, workbookFromSheets, triggerDownload } from './engine/xlsxIO.js';
import { exportScheduleToPdf } from './engine/pdfExport.js';
import { flattenVenues } from './engine/venueSetupIO.js';
import { buildAllMatches } from './engine/matchGenerator.js';
import { buildSessions, scheduleRounds, tournamentStart } from './engine/scheduler.js';
import { buildScheduleRows } from './engine/reportBuilder.js';
import { applyRowEdit, findMatchById } from './engine/manualEdit.js';
import { getConflictedMatchIds } from './engine/conflictDetection.js';
import { advanceRound, canAdvance, getBracketStatus } from './engine/bracketProgression.js';
import './styles/app.css';

export default function App() {
  const [unlocked, setUnlocked] = useState(isUnlocked);
  const [showDashboard, setShowDashboard] = useState(false);

  const [fileName, setFileName] = useState('');
  const [entrants, setEntrants] = useState([]);
  const [parseErrors, setParseErrors] = useState([]);

  // Venues are configured in-app as a list of venue "cards", each with its
  // own sport restriction and one or more real day/open/close/break windows
  // (VenueSetup.jsx) — replacing the old flat name-list + single global
  // date-range inputs with something that actually reflects when a venue is
  // available.
  const [venues, setVenues] = useState([]);
  const [matchDuration, setMatchDuration] = useState(30);
  const [breakDuration, setBreakDuration] = useState(10);

  // Tournament stage format: 'knockout' keeps the existing behaviour exactly
  // as-is (one delegation-spread round per sport). 'groupStage' routes
  // through formats/groupStageKnockout.js — entrants are auto-split into
  // delegation-spread groups (same delegation only ever lands together as a
  // last resort), each group plays a round robin, then group winners meet
  // in a knockout stage.
  const [stageFormat, setStageFormat] = useState('knockout');
  const [groupSizeMode, setGroupSizeMode] = useState('numGroups'); // 'numGroups' | 'groupSize'
  const [numGroups, setNumGroups] = useState(4);
  const [groupSize, setGroupSize] = useState(4);

  const [generating, setGenerating] = useState(false);
  // The live, editable bracket: { matchesBySport, scheduled, unscheduled }.
  // Kept as the source of truth instead of a flat rows array so that an
  // inline edit (rename a player, move a match) can be applied once to the
  // actual match/entrant objects and have it reflected everywhere that
  // entrant or match appears - see engine/manualEdit.js.
  const [genResult, setGenResult] = useState(null);
  const [genSummary, setGenSummary] = useState(null);
  const [genError, setGenError] = useState('');

  // The venue/day free-time bookkeeping (engine/core/venueAllocator.js)
  // built once per "Generate Schedule" click and then re-used, still
  // carrying every earlier round's bookings, by every later "Generate Next
  // Round" call - so round 2 books into whatever capacity is left instead
  // of starting from a blank slate (which would double-book round 1).
  const sessionsRef = useRef(null);

  // Per-sport "how far the most recently scheduled round for this sport
  // reaches" (abs minutes), returned as `lastRoundEnd` by scheduleRounds().
  // BUG FIX: this is the "rising earliest floor between rounds" that
  // core/venueAllocator.js's own docstring says the caller must supply so a
  // sport's next round can never be offered a slot before its previous
  // round has finished. Without it, "Generate Next Round" was booking the
  // new round from the tournament's global start time again - so as soon as
  // a sport had any spare venue capacity, its semifinal (say) would land at
  // the exact same time as the quarterfinal that was still deciding who
  // plays in it. Keyed by sport id, updated after every schedule/reschedule.
  const lastRoundEndBySport = useRef({});

  const scheduleRows = useMemo(
    () => (genResult ? buildScheduleRows(genResult.matchesBySport, genResult.scheduled, genResult.unscheduled) : []),
    [genResult]
  );

  const conflictMatchIds = useMemo(
    () => (genResult ? getConflictedMatchIds(genResult.matchesBySport, genResult.scheduled) : new Set()),
    [genResult]
  );

  const handleFile = useCallback(async (file) => {
    setFileName(file.name);
    const { entrants: parsed, errors } = await parseRosterFile(file);
    setParseErrors(errors);
    setEntrants(parsed);
    setGenResult(null);
    setGenSummary(null);
    sessionsRef.current = null;
    lastRoundEndBySport.current = {};
  }, []);

  const rosterSummary = useMemo(() => {
    if (!entrants.length) return null;
    const sports = new Set(entrants.map((e) => e.sport));
    return { entrantCount: entrants.length, sportCount: sports.size };
  }, [entrants]);

  const sportOptions = useMemo(() => [...new Set(entrants.map((e) => e.sport))], [entrants]);

  const flatVenueRows = useMemo(() => flattenVenues(venues), [venues]);

  // Options offered when editing the Venue/Date cells in the schedule table -
  // kept to what's actually configured so a typo can't silently create a
  // phantom venue/date the scheduler never knew about.
  const venueNameOptions = useMemo(
    () => [...new Set(flatVenueRows.map((v) => v.venueName))].sort(),
    [flatVenueRows]
  );
  const dateOptions = useMemo(
    () => [...new Set(flatVenueRows.map((v) => v.day))].filter(Boolean).sort(),
    [flatVenueRows]
  );

  const canGenerate = entrants.length > 0 && flatVenueRows.length > 0 && matchDuration > 0;

  const handleUpdateRow = useCallback(
    (row, key, value) => {
      setGenResult((prev) => {
        if (!prev) return prev;
        applyRowEdit(prev, row, key, value, matchDuration);
        // matchesBySport/scheduled/unscheduled are mutated in place (see
        // manualEdit.js); returning a new wrapper object is what actually
        // triggers React to re-render and recompute scheduleRows/conflicts.
        return { matchesBySport: prev.matchesBySport, scheduled: prev.scheduled, unscheduled: prev.unscheduled };
      });
    },
    [matchDuration]
  );

  // Records who won one match. `value` is the winning entrant's id. Clicking
  // an already-selected result again clears it back to undecided (which also
  // unfreezes the row for editing again). Once a match has fed into a later
  // round (`advanced`), its result is locked - changing it after the fact
  // would silently leave the next round showing a stale name.
  const handleSetResult = useCallback((row, value) => {
    setGenResult((prev) => {
      if (!prev) return prev;
      const match = findMatchById(prev.matchesBySport, row.matchId);
      if (!match || match.advanced) return prev;
      match.winnerId = match.winnerId === value ? null : value;
      return { matchesBySport: prev.matchesBySport, scheduled: prev.scheduled, unscheduled: prev.unscheduled };
    });
  }, []);

  // Builds the next round for every sport whose current round is fully
  // resolved, then books the new matches into whatever venue/day capacity
  // is still free.
  const handleGenerateNextRound = useCallback(() => {
    setGenResult((prev) => {
      if (!prev || !sessionsRef.current) return prev;
      const createdIds = advanceRound(prev.matchesBySport);
      if (!createdIds.length) return prev;

      const bySport = {};
      for (const id of createdIds) {
        const m = findMatchById(prev.matchesBySport, id);
        if (!m) continue;
        (bySport[m.sport] ||= []).push(m);
      }
      const tournamentStartAbs = tournamentStart(sessionsRef.current);
      for (const [sport, matches] of Object.entries(bySport)) {
        // Floor this new round to right after that SAME sport's previous
        // round finished - never the tournament's global start - so a
        // semifinal can't get scheduled before its own quarterfinal ends.
        const floor = lastRoundEndBySport.current[sport] ?? tournamentStartAbs;
        const { scheduled: sch, unscheduled: unsch, lastRoundEnd } = scheduleRounds(
          sessionsRef.current,
          sport,
          [matches],
          { durationMinutes: matchDuration, bufferMinutes: breakDuration },
          floor
        );
        for (const [id, v] of sch) prev.scheduled.set(id, v);
        prev.unscheduled.push(...unsch);
        lastRoundEndBySport.current[sport] = lastRoundEnd;
      }
      return { matchesBySport: prev.matchesBySport, scheduled: prev.scheduled, unscheduled: prev.unscheduled };
    });
  }, [matchDuration, breakDuration]);

  // Only the default single-elimination "Knockout" stage format has a
  // well-defined "winner of this match advances" rule - "Group Stage"
  // routes its knockout round through group standings instead, which this
  // feature doesn't (yet) resolve, so it's scoped out here.
  const supportsBracket = stageFormat === 'knockout';

  const bracketStatus = useMemo(
    () => (genResult && supportsBracket ? getBracketStatus(genResult.matchesBySport) : {}),
    [genResult, supportsBracket]
  );
  const canAdvanceRound = useMemo(
    () => (genResult && supportsBracket ? canAdvance(genResult.matchesBySport) : false),
    [genResult, supportsBracket]
  );
  const pendingResultCount = useMemo(
    () =>
      Object.values(bracketStatus).reduce((n, s) => n + (s.isFinal ? 0 : s.unresolved.length), 0),
    [bracketStatus]
  );
  const champions = useMemo(
    () =>
      Object.entries(bracketStatus)
        .filter(([, s]) => s.champion)
        .map(([sport, s]) => ({ sport, name: s.champion.name })),
    [bracketStatus]
  );
  const stillPlayingCount = useMemo(
    () => Object.values(bracketStatus).filter((s) => !s.isFinal).length,
    [bracketStatus]
  );

  const handleGenerate = useCallback(() => {
    if (!canGenerate) {
      setGenError('Please upload a roster and add at least one venue with a valid day/time window first.');
      return;
    }
    setGenError('');
    setGenerating(true);
    try {
      const sessions = buildSessions(flatVenueRows);
      sessionsRef.current = sessions;
      const start = tournamentStart(sessions);

      const formatName = stageFormat === 'groupStage' ? 'groupStageKnockout' : 'singleRoundDraw';
      const formatOptions =
        stageFormat === 'groupStage'
          ? groupSizeMode === 'groupSize'
            ? { groupSize: Math.max(2, Number(groupSize) || 4) }
            : { numGroups: Math.max(2, Number(numGroups) || 4) }
          : {};

      const { order, matchesBySport } = buildAllMatches(entrants, formatName, formatOptions);
      const settings = { durationMinutes: matchDuration, bufferMinutes: breakDuration };

      const scheduled = new Map();
      const unscheduled = [];
      lastRoundEndBySport.current = {};
      for (const sportId of order) {
        const { scheduled: sch, unscheduled: unsch, lastRoundEnd } = scheduleRounds(
          sessions,
          sportId,
          matchesBySport[sportId],
          settings,
          start
        );
        for (const [id, v] of sch) scheduled.set(id, v);
        unscheduled.push(...unsch);
        lastRoundEndBySport.current[sportId] = lastRoundEnd;
      }

      setGenResult({ matchesBySport, scheduled, unscheduled });
      const sports = new Set(entrants.map((e) => e.sport));
      const matchCount = Object.values(matchesBySport).reduce((n, rounds) => n + rounds.flat().length, 0);
      setGenSummary({ entrantCount: entrants.length, sportCount: sports.size, matchCount });
    } finally {
      setGenerating(false);
    }
  }, [canGenerate, flatVenueRows, entrants, matchDuration, breakDuration, stageFormat, groupSizeMode, numGroups, groupSize]);

  const handleExportExcel = useCallback((rows) => {
    const sheetRows = rows.map((r) => ({
      'Match #': r.matchNumber,
      Sport: r.sport,
      Group: r.group ? `Group ${r.group}` : '',
      'Team/Player A': r.teamA,
      'Delegation A': r.delegationA,
      'Team/Player B': r.teamB,
      'Delegation B': r.delegationB,
      Venue: r.venue,
      Date: r.date,
      Time: r.startTime ? `${r.startTime} - ${r.endTime}` : '',
    }));
    const wb = workbookFromSheets({ Schedule: sheetRows });
    triggerDownload(wb, 'tournament-schedule.xlsx');
  }, []);

  const handleExportPdf = useCallback((rows) => {
    exportScheduleToPdf(rows, 'tournament-schedule.pdf');
  }, []);

  const hasSchedule = scheduleRows.length > 0;

  // Recomputed from the live bracket (not just at generate time) so an
  // inline edit that schedules or un-schedules a match keeps this banner
  // honest instead of showing a stale count from the last generate.
  const unscheduledCount = genResult ? genResult.unscheduled.length : 0;

  if (!unlocked) {
    return <PasswordGate onUnlock={() => setUnlocked(true)} />;
  }

  if (!showDashboard) {
    return <LandingPage onOpenDashboard={() => setShowDashboard(true)} />;
  }

  return (
    <div className="app-shell">
      <Header summary={genSummary} onBack={() => setShowDashboard(false)} />
      <div className="app-body">
        <LeftPanel
          fileName={fileName}
          onFile={handleFile}
          parseErrors={parseErrors}
          rosterSummary={rosterSummary}
          sportOptions={sportOptions}
          venues={venues}
          onVenuesChange={setVenues}
          matchDuration={matchDuration}
          onMatchDurationChange={setMatchDuration}
          breakDuration={breakDuration}
          onBreakDurationChange={setBreakDuration}
          stageFormat={stageFormat}
          onStageFormatChange={setStageFormat}
          groupSizeMode={groupSizeMode}
          onGroupSizeModeChange={setGroupSizeMode}
          numGroups={numGroups}
          onNumGroupsChange={setNumGroups}
          groupSize={groupSize}
          onGroupSizeChange={setGroupSize}
          onGenerate={handleGenerate}
          canGenerate={canGenerate}
          generating={generating}
        />

        <main className="right-panel">
          {genError && <div className="banner banner-warning">{genError}</div>}
          {!genError && hasSchedule && unscheduledCount > 0 && (
            <div className="banner banner-warning">
              {unscheduledCount} match(es) are unscheduled — add more venue-day capacity, or set a venue/date/time
              on those rows directly in the table below.
            </div>
          )}

          {!hasSchedule && !genError && (
            <div className="empty-state card">
              <h2>No schedule generated yet</h2>
              <p>
                Upload a roster file, set up your venues' real availability on the left, then click
                <strong> Generate Schedule</strong> to see the match table and analytics here.
              </p>
            </div>
          )}

          {supportsBracket && hasSchedule && stillPlayingCount > 0 && (
            <div className="card bracket-progress-card">
              <div className="bracket-progress-info">
                {pendingResultCount > 0 ? (
                  <span>
                    {pendingResultCount} result{pendingResultCount === 1 ? '' : 's'} still needed before the next
                    round can be generated.
                  </span>
                ) : (
                  <span>All results are in — ready to generate the next round.</span>
                )}
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!canAdvanceRound}
                onClick={handleGenerateNextRound}
              >
                Generate Next Round
              </button>
            </div>
          )}

          {supportsBracket && champions.length > 0 && (
            <div className="banner banner-success">
              {champions.map((c) => `🏆 ${c.sport}: ${c.name}`).join('   ·   ')}
            </div>
          )}

          {hasSchedule && (
            <>
              <ScheduleTable
                rows={scheduleRows}
                onExportExcel={handleExportExcel}
                onExportPdf={handleExportPdf}
                onUpdateRow={handleUpdateRow}
                venueOptions={venueNameOptions}
                dateOptions={dateOptions}
                conflictMatchIds={conflictMatchIds}
                onSetResult={handleSetResult}
                supportsBracket={supportsBracket}
              />
              <GroupsOverview rows={scheduleRows} />
              <AnalyticsDashboard
                rows={scheduleRows}
                venueRows={flatVenueRows}
                matchDuration={matchDuration}
                breakDuration={breakDuration}
              />
            </>
          )}
        </main>
      </div>
    </div>
  );
}
