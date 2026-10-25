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
} from './engine/tournament.js';
import { loadFixture, saveFixture } from './storage/fixtureStore.js';
import './styles/app.css';

const SAVE_DELAY_MS = 800;

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

  const skipNextSave = useRef(false);
  const touch = useCallback(() => setVersion((v) => v + 1), []);

  const flatVenueRows = useMemo(() => flattenVenues(venues), [venues]);
  const ctx = useMemo(
    () => ({ flatVenueRows, settings: { durationMinutes: matchDuration, bufferMinutes: breakDuration } }),
    [flatVenueRows, matchDuration, breakDuration]
  );

  // ---------- open / save ----------

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
  };

  const openFixture = useCallback(async (id) => {
    setLoaded(false);
    setSaveStatus('idle');
    setSaveError('');
    resetDashboard();
    setScreen('dashboard');
    try {
      const rec = await loadFixture(id);
      if (!rec) throw new Error('That fixture could not be found.');
      setFixture({ id: rec.id, name: rec.name, created_by: rec.created_by });
      const s = rec.state || {};
      const ents = s.entrants || [];
      setFileName(s.fileName || '');
      setEntrants(ents);
      setVenues(s.venues || []);
      if (s.matchDuration) setMatchDuration(s.matchDuration);
      if (s.breakDuration != null) setBreakDuration(s.breakDuration);
      if (s.stageFormat) setStageFormat(s.stageFormat);
      if (s.groupSizeMode) setGroupSizeMode(s.groupSizeMode);
      if (s.numGroups) setNumGroups(s.numGroups);
      if (s.groupSize) setGroupSize(s.groupSize);
      setGenResult(deserializeTournament(s.tournament, ents));
      setGenSummary(s.genSummary || null);
      skipNextSave.current = true; // just loaded: nothing new to write back
      setLoaded(true);
    } catch (e) {
      setSaveStatus('error');
      setSaveError(e.message);
      setScreen('picker');
    }
  }, []);

  useEffect(() => {
    if (!loaded || !fixture) return undefined;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      setSaveStatus('saved');
      return undefined;
    }
    setSaveStatus('saving');
    const t = setTimeout(() => {
      const state = {
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
      };
      saveFixture(fixture.id, state)
        .then(() => {
          setSaveStatus('saved');
          setSaveError('');
        })
        .catch((e) => {
          setSaveStatus('error');
          setSaveError(e.message);
        });
    }, SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [loaded, fixture, fileName, entrants, venues, matchDuration, breakDuration, stageFormat, groupSizeMode, numGroups, groupSize, genSummary, genResult, version]);

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
