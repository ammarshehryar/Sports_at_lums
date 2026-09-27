import { Fragment, useEffect, useMemo, useState } from 'react';

// One click-to-edit cell. Renders as plain text until clicked, then swaps in
// an input (or, with `options`, a <select>) so the row's visual layout never
// shifts except for the one cell actually being edited. Enter/blur commits,
// Escape reverts.
function EditableCell({ value, placeholder, options, datalistId, type = 'text', title, onCommit, locked }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  useEffect(() => {
    if (!editing) setDraft(value ?? '');
  }, [value, editing]);

  const commit = (next) => {
    setEditing(false);
    const finalValue = next ?? draft;
    if (finalValue !== (value ?? '')) onCommit(finalValue);
  };

  const cancel = () => {
    setDraft(value ?? '');
    setEditing(false);
  };

  // Once a winner has been recorded for this match, the row is frozen: no
  // more click-to-edit, just plain read-only text. Prevents someone from
  // quietly changing a team/venue/time after the result is already in.
  if (locked) {
    return (
      <span className="cell-editable cell-locked" title="Locked — clear the result to edit this match again">
        {value || placeholder || '—'}
      </span>
    );
  }

  if (!editing) {
    return (
      <span
        className="cell-editable"
        title={title}
        tabIndex={0}
        role="button"
        onClick={() => setEditing(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') setEditing(true);
        }}
      >
        {value || placeholder || '—'}
      </span>
    );
  }

  if (options) {
    return (
      <select
        autoFocus
        className="cell-input"
        value={draft}
        onChange={(e) => commit(e.target.value)}
        onBlur={() => cancel()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') cancel();
        }}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      autoFocus
      className="cell-input"
      type={type}
      list={datalistId}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') cancel();
      }}
    />
  );
}

// Compact winner picker for one row. Two small toggle pills - click a
// team's pill to record them as the winner; clicking the currently-selected
// pill again clears it. Once the match has already fed into a later round,
// the result is locked and shown read-only so a later change can't quietly
// leave the next round showing a stale name. No "Draw" option: a knockout
// match always needs a definite winner to advance.
function ResultPicker({ row, onSetResult }) {
  if (row.isWalkover) {
    return <span className="result-pill result-pill-bye">Bye</span>;
  }
  if (row.advanced) {
    const winnerName = row.winnerId === row.entrantAId ? row.teamA : row.teamB;
    return <span className="result-pill result-pill-locked">✓ {winnerName}</span>;
  }
  const isA = row.winnerId === row.entrantAId;
  const isB = row.winnerId === row.entrantBId;
  return (
    <div className="result-picker">
      <button
        type="button"
        title={`${row.teamA} wins`}
        className={`result-pill${isA ? ' result-pill-selected' : ''}`}
        onClick={() => onSetResult(row, row.entrantAId)}
      >
        A
      </button>
      <button
        type="button"
        title={`${row.teamB} wins`}
        className={`result-pill${isB ? ' result-pill-selected' : ''}`}
        onClick={() => onSetResult(row, row.entrantBId)}
      >
        B
      </button>
    </div>
  );
}

const COLUMNS = [
  { key: 'matchNumber', label: 'Match #' },
  { key: 'sport', label: 'Sport' },
  { key: 'round', label: 'Round' },
  { key: 'group', label: 'Group' },
  { key: 'teamA', label: 'Team / Player A' },
  { key: 'delegationA', label: 'Delegation A' },
  { key: 'teamB', label: 'Team / Player B' },
  { key: 'delegationB', label: 'Delegation B' },
  { key: 'venue', label: 'Venue' },
  { key: 'date', label: 'Date' },
  { key: 'time', label: 'Time' },
];

const RESULT_COLUMN = { key: 'result', label: 'Result' };

export default function ScheduleTable({
  rows,
  onExportExcel,
  onExportPdf,
  onUpdateRow,
  venueOptions = [],
  dateOptions = [],
  conflictMatchIds,
  onSetResult,
  supportsBracket = false,
}) {
  const [search, setSearch] = useState('');
  const [sportFilter, setSportFilter] = useState('');
  const [venueFilter, setVenueFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [sortKey, setSortKey] = useState('matchNumber');
  const [sortDir, setSortDir] = useState('asc');

  const options = useMemo(() => {
    const uniq = (key) => [...new Set(rows.map((r) => r[key]).filter(Boolean))].sort();
    return { sport: uniq('sport'), venue: uniq('venue'), date: uniq('date'), group: uniq('group') };
  }, [rows]);

  // Suggestions (not hard restrictions) for the free-text name/delegation
  // cells - helps catch a near-duplicate spelling of a team that already
  // exists elsewhere in the schedule.
  const nameSuggestions = useMemo(
    () => [...new Set(rows.flatMap((r) => [r.teamA, r.teamB]))].filter(Boolean).sort(),
    [rows]
  );
  const delegationSuggestions = useMemo(
    () => [...new Set(rows.flatMap((r) => [r.delegationA, r.delegationB]))].filter(Boolean).sort(),
    [rows]
  );

  // Venue/date are constrained to what's actually configured (falling back
  // to whatever already appears in the data, e.g. "Unscheduled") so an edit
  // can't quietly invent a venue/date the scheduler never knew about.
  const venueSelectOptions = useMemo(
    () => [...new Set([...venueOptions, 'Unscheduled', ...options.venue])].filter(Boolean),
    [venueOptions, options.venue]
  );
  const dateSelectOptions = useMemo(
    () => [...new Set([...dateOptions, 'Unscheduled', ...options.date])].filter(Boolean),
    [dateOptions, options.date]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (sportFilter && r.sport !== sportFilter) return false;
      if (venueFilter && r.venue !== venueFilter) return false;
      if (dateFilter && r.date !== dateFilter) return false;
      if (groupFilter && r.group !== groupFilter) return false;
      if (!q) return true;
      return (
        r.teamA.toLowerCase().includes(q) ||
        r.teamB.toLowerCase().includes(q) ||
        r.delegationA.toLowerCase().includes(q) ||
        r.delegationB.toLowerCase().includes(q) ||
        r.sport.toLowerCase().includes(q) ||
        r.venue.toLowerCase().includes(q)
      );
    });
  }, [rows, search, sportFilter, venueFilter, dateFilter, groupFilter]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      let av = a[sortKey];
      let bv = b[sortKey];
      if (sortKey === 'time') {
        av = a.startTime || '';
        bv = b.startTime || '';
      }
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      const cmp = String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  return (
    <section className="card table-card">
      <div className="table-toolbar">
        <input
          className="search-input"
          type="text"
          placeholder="Search team, delegation, sport, venue…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={sportFilter} onChange={(e) => setSportFilter(e.target.value)}>
          <option value="">All sports</option>
          {options.sport.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
        <select value={venueFilter} onChange={(e) => setVenueFilter(e.target.value)}>
          <option value="">All venues</option>
          {options.venue.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
        <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}>
          <option value="">All dates</option>
          {options.date.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
        {options.group.length > 0 && (
          <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
            <option value="">All groups</option>
            {options.group.map((o) => (
              <option key={o} value={o}>Group {o}</option>
            ))}
          </select>
        )}
        <span className="table-count">{sorted.length} of {rows.length} matches</span>
        <div className="table-toolbar-actions">
          <button className="btn btn-outline" onClick={() => onExportExcel(sorted)}>
            Export to Excel
          </button>
          <button className="btn btn-outline" onClick={() => onExportPdf(sorted)}>
            Export to PDF
          </button>
        </div>
      </div>

      <datalist id="schedule-name-options">
        {nameSuggestions.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <datalist id="schedule-delegation-options">
        {delegationSuggestions.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>

      <div className="table-scroll">
        <table className="schedule-table">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} onClick={() => toggleSort(c.key)}>
                  {c.label} {sortKey === c.key ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                </th>
              ))}
              {supportsBracket && <th>{RESULT_COLUMN.label}</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => {
              const conflicted = conflictMatchIds?.has(r.matchId);
              const rowClass = [
                r.unscheduled ? 'row-warning' : '',
                r.isWalkover ? 'row-walkover' : '',
                conflicted ? 'row-conflict' : '',
              ]
                .filter(Boolean)
                .join(' ');
              const edit = (key) => (value) => onUpdateRow?.(r, key, value);
              // Once a winner is picked (or the match is a bye/already advanced),
              // the rest of the row freezes - only the result itself can still
              // change hands, and only up until it feeds into the next round.
              const locked = Boolean(r.winnerId) || r.isWalkover || r.advanced;

              // A thin labeled divider wherever the round changes, so "Round 1
              // ends, Round 2 starts" is visible at a glance. Only makes sense
              // while rows are actually ordered by match # or round - sorted
              // by, say, team name, rounds would be scattered and a divider
              // every few rows would be noise instead of signal.
              const prev = sorted[i - 1];
              const showRoundDivider =
                i > 0 &&
                (sortKey === 'matchNumber' || sortKey === 'round') &&
                r.round &&
                r.round !== prev.round;

              return (
                <Fragment key={r.matchId}>
                  {showRoundDivider && (
                    <tr className="round-divider-row" aria-hidden="true">
                      <td colSpan={COLUMNS.length + (supportsBracket ? 1 : 0)}>
                        <div className="round-divider">
                          <span className="round-divider-line" />
                          <span className="round-divider-label">{r.round}</span>
                          <span className="round-divider-line" />
                        </div>
                      </td>
                    </tr>
                  )}
                    <tr className={rowClass}>
                    <td>{r.matchNumber}</td>
                    <td>{r.sport}</td>
                    <td>{r.round || '—'}</td>
                    <td>
                      <EditableCell value={r.group || ''} placeholder="—" onCommit={edit('group')} locked={locked} />
                    </td>
                    <td>
                      <EditableCell
                        value={r.teamA}
                        datalistId="schedule-name-options"
                        onCommit={edit('teamA')}
                        locked={locked}
                      />
                    </td>
                    <td>
                      <EditableCell
                        value={r.delegationA}
                        datalistId="schedule-delegation-options"
                        onCommit={edit('delegationA')}
                        locked={locked}
                      />
                    </td>
                    <td>
                      <EditableCell
                        value={r.teamB}
                        datalistId="schedule-name-options"
                        onCommit={edit('teamB')}
                        locked={locked}
                      />
                    </td>
                    <td>
                      <EditableCell
                        value={r.delegationB}
                        datalistId="schedule-delegation-options"
                        onCommit={edit('delegationB')}
                        locked={locked}
                      />
                    </td>
                    <td title={conflicted ? 'Double-booked with another match — check venue/time.' : undefined}>
                      <EditableCell value={r.venue} options={venueSelectOptions} onCommit={edit('venue')} locked={locked} />
                    </td>
                    <td title={conflicted ? 'Double-booked with another match — check venue/time.' : undefined}>
                      <EditableCell value={r.date} options={dateSelectOptions} onCommit={edit('date')} locked={locked} />
                    </td>
                    <td title={conflicted ? 'Double-booked with another match — check venue/time.' : undefined}>
                      <EditableCell
                        value={r.startTime}
                        type="time"
                        placeholder="—"
                        onCommit={edit('time')}
                        locked={locked}
                      />
                      {r.startTime ? ` – ${r.endTime}` : ''}
                    </td>
                    {supportsBracket && (
                      <td>
                        <ResultPicker row={r} onSetResult={onSetResult} />
                      </td>
                    )}
                    </tr>
                </Fragment>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + (supportsBracket ? 1 : 0)} className="empty-row">
                  No matches match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
