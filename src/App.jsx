import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Header from './components/Header.jsx';
import LeftPanel from './components/LeftPanel.jsx';
import ScheduleTable from './components/ScheduleTable.jsx';
import GroupsOverview from './components/GroupsOverview.jsx';
import AnalyticsDashboard from './components/AnalyticsDashboard.jsx';
import LandingPage from './components/LandingPage.jsx';
import FixturePicker from './components/FixturePicker.jsx';
import PasswordGate, { isUnlocked } from './components/PasswordGate.jsx';
import { parseRosterFile, workbookFromSheets, triggerDownload } from './engine/xlsxIO.js';
import { exportScheduleToPdf } from './engine/pdfExport.js';
import { flattenVenues } from './engine/venueSetupIO.js';
import { buildScheduleRows } from './engine/reportBuilder.js';
import { applyRowEdit } from './engine/manualEdit.js';
import { getConflictedMatchIds } from './engine/conflictDetection.js';
import {
  generateTournament,
  setResult,
  applyGroupEdit,
  bracketStatus,
  serializeTournament,
  deserializeTournament,
  autoAdvance,
} from './engine/tournament.js';
import { loadFixture, saveFixture, getFixtureRev } from './storage/fixtureStore.js';
import { mergeStates } from './storage/merge.js';
import './styles/app.css';

const SAVE_DELAY_MS = 800;
const POLL_MS = 4000;

export default function App() {
  const [unlocked, setUnlocked] = useState(isUnlocked);
  const [screen, setScreen] = useState('landing'); // 'landing' | 'picker' | 'dashboard'

  // Which saved fixture is open, and whether its saved state has finished
  // loading (nothing is written back until it has, so opening a fixture can
  // never overwrite it with a blank dashboard).
  const [fixture, setFixture] = useState(null); // { id, name, created_by }
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | saving | saved | error
  const [saveError, setSaveError] = useState('');

  const [fileName, setFileName] = useState('');
  const [entrants, setEntrants] = useState([]);
  const [parseErrors, setParseErrors] = useState([]);
  const [venues, setVenues] = useState([]);
  const [matchDuration, setMatchDuration] = useState(30);
  const [breakDuration, setBreakDuration] = useState(10);
  const [stageFormat, setStageFormat] = useState('knockout');
  const [groupSizeMode, setGroupSizeMode] = useState('numGroups');
  const [numGroups, setNumGroups] = useState(4);
  const [groupSize, setGroupSize] = useState(4);

  const [generating, setGenerating] = useState(false);
  // The live tournament: { matchesBySport, scheduled, unscheduled, groupsBySport }.
  // Engine functions mutate it in place; `version` is bumped after each
  // change so React re-renders and autosave fires.
  const [genResult, setGenResult] = useState(null);
  const [version, setVersion] = useState(0);
  const [genSummary, setGenSummary] = useState(null);
  const [genError, setGenError] = useState('');
  const [groupEditNote, setGroupEditNote] = useState('');

  const touch = useCallback(() => setVersion((v) => v + 1), []);

  const flatVenueRows = useMemo(() => flattenVenues(venues), [venues]);
  const ctx = useMemo(
    () => ({ flatVenueRows, settings: { durationMinutes: matchDuration, bufferMinutes: breakDuration } }),
    [flatVenueRows, matchDuration, breakDuration]
  );

  // ---------- open / save / live sync ----------
  //
  // synced = what this screen and the database last agreed on: its version
  // number (rev), the saved state (the base for merging) and that state as
  // JSON (to tell whether there are unsaved local edits).
  const synced = useRef({ rev: 0, state: null, json: '' });
  const rebaseNext = useRef(false); // after loading a state, adopt it as "saved" without writing
  const saving = useRef(false);
  const [remoteNote, setRemoteNote] = useState('');

  const currentState = useMemo(
    () =>
      loaded
        ? {
            version: 1,
            fileName,
            entrants,
            venues,
            matchDuration,
            breakDuration,
            stageFormat,
            groupSizeMode,
            numGroups,
            groupSize,
            genSummary,
            tournament: serializeTournament(genResult, entrants),
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loaded, fileName, entrants, venues, matchDuration, breakDuration, stageFormat, groupSizeMode, numGroups, groupSize, genSummary, genResult, version]
  );
  const currentRef = useRef(null);
  currentRef.current = currentState;

  const resetDashboard = () => {
    setFileName('');
    setEntrants([]);
    setParseErrors([]);
    setVenues([]);
    setMatchDuration(30);
    setBreakDuration(10);
    setStageFormat('knockout');
    setGroupSizeMode('numGroups');
    setNumGroups(4);
    setGroupSize(4);
    setGenResult(null);
    setGenSummary(null);
    setGenError('');
    setGroupEditNote('');
    setRemoteNote('');
  };

  // Put a saved state on screen (on open, or when someone else's changes come in).
  const applyState = useCallback(
    (s = {}) => {
      const ents = s.entrants || [];
      setFileName(s.fileName || '');
      setEntrants(ents);
      setVenues(s.venues || []);
      setMatchDuration(s.matchDuration || 30);
      setBreakDuration(s.breakDuration ?? 10);
      setStageFormat(s.stageFormat || 'knockout');
      setGroupSizeMode(s.groupSizeMode || 'numGroups');
      setNumGroups(s.numGroups || 4);
      setGroupSize(s.groupSize || 4);
      const t = deserializeTournament(s.tournament, ents);
      // If merging finished a round (two people each recorded its last
      // results), draw the next round now. That's a real change, so let it save.
      let advanced = 0;
      if (t) {
        advanced = autoAdvance(t, {
          flatVenueRows: flattenVenues(s.venues || []),
          settings: { durationMinutes: s.matchDuration || 30, bufferMinutes: s.breakDuration ?? 10 },
        }).length;
      }
      setGenResult(t);
      setGenSummary(s.genSummary || null);
      rebaseNext.current = advanced === 0;
      touch();
    },
    [touch]
  );

  const openFixture = useCallback(
    async (id) => {
      setLoaded(false);
      setSaveStatus('idle');
      setSaveError('');
      resetDashboard();
      setScreen('dashboard');
      try {
        const rec = await loadFixture(id);
        if (!rec) throw new Error('That fixture could not be found.');
        setFixture({ id: rec.id, name: rec.name, created_by: rec.created_by });
        synced.current = { rev: rec.rev ?? 0, state: rec.state || {}, json: '' };
        applyState(rec.state || {});
        setLoaded(true);
      } catch (e) {
        setSaveStatus('error');
        setSaveError(e.message);
        setScreen('picker');
      }
    },
    [applyState]
  );

  // Save local edits. If someone else saved first, fetch theirs, merge both
  // sets of changes, save the merge, and show it.
  const flush = useCallback(async () => {
    if (!fixture || saving.current) return;
    let local = currentRef.current;
    if (!local || JSON.stringify(local) === synced.current.json) {
      setSaveStatus('saved');
      return;
    }
    saving.current = true;
    setSaveStatus('saving');
    let merged = false;
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const res = await saveFixture(fixture.id, local, synced.current.rev);
        if (res.ok) {
          const json = JSON.stringify(local);
          synced.current = { rev: res.rev, state: local, json };
          if (merged) {
            applyState(local);
            setRemoteNote("Merged with someone else's changes");
          }
          setSaveStatus('saved');
          setSaveError('');
          break;
        }
        if (!res.conflict) throw new Error('This fixture no longer exists.');
        const rec = await loadFixture(fixture.id);
        if (!rec) throw new Error('This fixture was deleted by someone else.');
        local = mergeStates(synced.current.state, local, rec.state || {});
        merged = true;
        synced.current = { rev: rec.rev ?? 0, state: rec.state || {}, json: JSON.stringify(rec.state || {}) };
        if (attempt === 3) throw new Error('Too many people saving at once. Your change will retry.');
      }
    } catch (e) {
      setSaveStatus('error');
      setSaveError(e.message);
    } finally {
      saving.current = false;
    }
  }, [fixture, applyState]);

  // Autosave shortly after any change.
  useEffect(() => {
    if (!loaded || !fixture || !currentState) return undefined;
    const json = JSON.stringify(currentState);
    if (rebaseNext.current) {
      rebaseNext.current = false;
      synced.current = { ...synced.current, json };
      setSaveStatus('saved');
      return undefined;
    }
    if (json === synced.current.json) return undefined;
    setSaveStatus('saving');
    const t = setTimeout(flush, SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [loaded, fixture, currentState, flush]);

  // Live refresh: every few seconds, pull in changes others have saved, and
  // retry a save that failed (e.g. after the internet dropped).
  useEffect(() => {
    if (!loaded || !fixture) return undefined;
    let stopped = false;
    const tick = async () => {
      if (stopped || saving.current) return;
      const dirty = JSON.stringify(currentRef.current) !== synced.current.json;
      try {
        if (dirty) {
          await flush();
          return;
        }
        const rev = await getFixtureRev(fixture.id);
        if (stopped || rev == null || rev <= synced.current.rev || saving.current) return;
        const rec = await loadFixture(fixture.id);
        if (stopped || !rec || JSON.stringify(currentRef.current) !== synced.current.json) return;
        synced.current = { rev: rec.rev ?? 0, state: rec.state || {}, json: '' };
        applyState(rec.state || {});
        setRemoteNote('Updated with changes from someone else');
      } catch {
        /* offline for a moment: try again next tick */
      }
    };
    const iv = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(iv);
    };
  }, [loaded, fixture, flush, applyState]);

  useEffect(() => {
    if (!remoteNote) return undefined;
    const t = setTimeout(() => setRemoteNote(''), 4000);
    return () => clearTimeout(t);
  }, [remoteNote]);

  // ---------- derived ----------

  const scheduleRows = useMemo(
    () => (genResult ? buildScheduleRows(genResult.matchesBySport, genResult.scheduled, genResult.unscheduled) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [genResult, version]
  );

  const conflictMatchIds = useMemo(
    () => (genResult ? getConflictedMatchIds(genResult.matchesBySport, genResult.scheduled) : new Set()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [genResult, version]
  );

  const rosterSummary = useMemo(() => {
    if (!entrants.length) return null;
    const sports = new Set(entrants.map((e) => e.sport));
    return { entrantCount: entrants.length, sportCount: sports.size };
  }, [entrants]);

  const sportOptions = useMemo(() => [...new Set(entrants.map((e) => e.sport))], [entrants]);
  const venueNameOptions = useMemo(() => [...new Set(flatVenueRows.map((v) => v.venueName))].sort(), [flatVenueRows]);
  const dateOptions = useMemo(
    () => [...new Set(flatVenueRows.map((v) => v.day))].filter(Boolean).sort(),
    [flatVenueRows]
  );

  const canGenerate = entrants.length > 0 && flatVenueRows.length > 0 && matchDuration > 0;

  // ---------- actions ----------

  const handleFile = useCallback(async (file) => {
    setFileName(file.name);
    const { entrants: parsed, errors } = await parseRosterFile(file);
    setParseErrors(errors);
    setEntrants(parsed);
    setGenResult(null);
    setGenSummary(null);
  }, []);

  const handleUpdateRow = useCallback(
    (row, key, value) => {
      if (!genResult) return;
      applyRowEdit(genResult, row, key, value, matchDuration);
      touch();
    },
    [genResult, matchDuration, touch]
  );

  const handleSetResult = useCallback(
    (row, value) => {
      if (!genResult) return;
      if (setResult(genResult, row.matchId, value, ctx)) touch();
    },
    [genResult, ctx, touch]
  );

  const handleGroupEdit = useCallback(
    (sport, groups, unassigned) => {
      if (!genResult) return;
      const { removed, added } = applyGroupEdit(genResult, sport, groups, unassigned, entrants, ctx);
      const parts = [];
      if (removed) parts.push(`${removed} fixture${removed === 1 ? '' : 's'} removed`);
      if (added) parts.push(`${added} fixture${added === 1 ? '' : 's'} added`);
      setGroupEditNote(`${sport}: ${parts.length ? parts.join(', ') : 'no fixture changes'}.`);
      touch();
    },
    [genResult, entrants, ctx, touch]
  );

  const handleGenerate = useCallback(() => {
    if (!canGenerate) {
      setGenError('Please upload a roster and add at least one venue with a valid day/time window first.');
      return;
    }
    if (genResult && !window.confirm('Generate a new schedule? This replaces the current fixtures and results.')) return;
    setGenError('');
    setGenerating(true);
    try {
      const formatOptions =
        stageFormat === 'groupStage'
          ? groupSizeMode === 'groupSize'
            ? { groupSize: Math.max(2, Number(groupSize) || 4) }
            : { numGroups: Math.max(2, Number(numGroups) || 4) }
          : {};
      const result = generateTournament({ entrants, stageFormat, formatOptions, flatVenueRows, settings: ctx.settings });
      setGenResult(result);
      setGroupEditNote('');
      const sports = new Set(entrants.map((e) => e.sport));
      const matchCount = Object.values(result.matchesBySport).reduce((n, rounds) => n + rounds.flat().length, 0);
      setGenSummary({ entrantCount: entrants.length, sportCount: sports.size, matchCount });
    } finally {
      setGenerating(false);
    }
  }, [canGenerate, genResult, flatVenueRows, entrants, ctx, stageFormat, groupSizeMode, numGroups, groupSize]);

  const handleExportExcel = useCallback(
    (rows) => {
      const sheetRows = rows.map((r) => ({
        'Match #': r.matchNumber,
        Sport: r.sport,
        Round: r.round,
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
      triggerDownload(wb, `${fixture?.name || 'tournament'}-schedule.xlsx`);
    },
    [fixture]
  );

  const handleExportPdf = useCallback(
    (rows) => exportScheduleToPdf(rows, `${fixture?.name || 'tournament'}-schedule.pdf`),
    [fixture]
  );

  // ---------- bracket status ----------

  const supportsBracket = stageFormat === 'knockout';
  const status = useMemo(
    () => (genResult && supportsBracket ? bracketStatus(genResult.matchesBySport) : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [genResult, supportsBracket, version]
  );
  const champions = Object.entries(status)
    .filter(([, s]) => s.champion)
    .map(([sport, s]) => ({ sport, name: s.champion.name }));
  const openResults = Object.values(status).reduce((n, s) => n + (s.champion ? 0 : s.open), 0);

  const hasSchedule = scheduleRows.length > 0;
  const unscheduledCount = genResult ? genResult.unscheduled.length : 0;

  // ---------- screens ----------

  if (!unlocked) return <PasswordGate onUnlock={() => setUnlocked(true)} />;
  if (screen === 'landing') return <LandingPage onOpenDashboard={() => setScreen('picker')} />;
  if (screen === 'picker') return <FixturePicker onOpen={openFixture} onBack={() => setScreen('landing')} />;

  return (
    <div className="app-shell">
      <Header
        summary={genSummary && { ...genSummary, matchCount: scheduleRows.length }}
        onBack={() => setScreen('picker')}
        fixture={fixture}
        saveStatus={loaded ? saveStatus : 'loading'}
        saveError={saveError}
        remoteNote={remoteNote}
      />
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
          canGenerate={canGenerate && loaded}
          generating={generating}
        />

        <main className="right-panel">
          {genError && <div className="banner banner-warning">{genError}</div>}
          {!loaded && <div className="empty-state card"><h2>Opening fixture…</h2></div>}
          {loaded && !genError && hasSchedule && unscheduledCount > 0 && (
            <div className="banner banner-warning">
              {unscheduledCount} match(es) are unscheduled. Add more venue-day capacity, or set a venue/date/time on
              those rows directly in the table below.
            </div>
          )}

          {loaded && !hasSchedule && !genError && (
            <div className="empty-state card">
              <h2>No schedule generated yet</h2>
              <p>
                Upload a roster file, set up your venues' real availability on the left, then click
                <strong> Generate Schedule</strong>. You'll get Round 1 plus a projected Round 2 with venues and times,
                and everything you do here is saved automatically.
              </p>
            </div>
          )}

          {supportsBracket && hasSchedule && openResults > 0 && (
            <div className="card bracket-progress-card">
              <div className="bracket-progress-info">
                Record winners with the A / B buttons. Projected slots fill in by themselves, and the next round is
                drawn and booked as soon as a round's results are in. {openResults} result
                {openResults === 1 ? '' : 's'} still to record.
              </div>
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
              <GroupsOverview
                groupsBySport={genResult?.groupsBySport}
                entrants={entrants}
                onEdit={handleGroupEdit}
                lastEdit={groupEditNote}
              />
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
