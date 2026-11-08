import { useMemo, useState } from 'react';

/**
 * Editable group-stage groups. Each team is a plain text field:
 *  - type over a name to rename that team (fixtures stay, the name changes
 *    everywhere); typing the name of a team from another group swaps the two
 *  - × removes the team from its group (its fixtures are deleted)
 *  - "Add team" puts a team in the group (an existing one by name, or a new
 *    one) and creates its fixtures
 * Each change goes to onChange, which rebuilds that sport's fixtures.
 */

function NameField({ value, onCommit, placeholder, listId, clearAfter }) {
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setDraft(value);
  }
  const commit = () => {
    const next = draft.trim();
    if (!next || next === value) {
      setDraft(value);
      return;
    }
    onCommit(next);
    if (clearAfter) setDraft('');
  };
  return (
    <input
      className="group-name-input"
      value={draft}
      placeholder={placeholder}
      list={listId}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export default function GroupsOverview({ groupsBySport, entrants, onChange, lastEdit, standings, onPickWinner }) {
  const byId = useMemo(() => new Map(entrants.map((e) => [e.id, e])), [entrants]);
  const sports = Object.entries(groupsBySport || {});
  if (!sports.length) return null;

  return (
    <section className="card groups-card">
      <div className="groups-head">
        <h2 className="section-title groups-title">Groups</h2>
        <span className="field-hint groups-hint">
          Rename, add or remove teams. Their fixtures update automatically.
        </span>
      </div>
      {lastEdit && <p className="groups-last-edit">{lastEdit}</p>}
      <div className="groups-sport-list">
        {sports.map(([sport, data]) => {
          const listId = `teams-${sport.replace(/\W+/g, '-')}`;
          return (
            <div className="groups-sport-block" key={sport}>
              <h3 className="groups-sport-name">{sport}</h3>
              <datalist id={listId}>
                {entrants
                  .filter((e) => e.sport === sport)
                  .map((e) => (
                    <option key={e.id} value={e.name} />
                  ))}
              </datalist>
              <div className="groups-grid">
                {data.groups.map((g) => {
                  const st = standings ? standings(sport, g.label) : { rows: [], tied: [] };
                  const winsOf = new Map(st.rows.map((r) => [r.id, r.wins]));
                  return (
                  <div className="group-tile" key={g.label}>
                    <div className="group-tile-head">
                      <span>Group {g.label}</span>
                      <span className="group-tile-count">{g.memberIds.length}</span>
                    </div>
                    {st.complete && st.winner && g.memberIds.length > 1 && (
                      <p className="group-winner-line">Winner: {byId.get(st.winner)?.name}</p>
                    )}
                    {st.complete && !st.winner && st.tied.length > 1 && (
                      <label className="group-tie">
                        <span>Tied on wins and head to head. Pick the winner:</span>
                        <select defaultValue="" onChange={(e) => e.target.value && onPickWinner?.(sport, g.label, e.target.value)}>
                          <option value="">Choose…</option>
                          {st.tied.map((id) => (
                            <option key={id} value={id}>
                              {byId.get(id)?.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <ul className="group-member-list">
                      {g.memberIds.map((id) => {
                        const e = byId.get(id);
                        if (!e) return null;
                        return (
                          <li key={id} className="group-member-row">
                            <NameField
                              value={e.name}
                              listId={listId}
                              onCommit={(name) => onChange(sport, { type: 'rename', id, name })}
                            />
                            <span className="group-wins" title="Wins so far">
                              {winsOf.get(id) ?? 0}W
                            </span>
                            <button
                              type="button"
                              className="group-remove"
                              title={`Remove ${e.name} and its fixtures`}
                              aria-label={`Remove ${e.name}`}
                              onClick={() => onChange(sport, { type: 'remove', id })}
                            >
                              ×
                            </button>
                          </li>
                        );
                      })}
                      <li className="group-member-row group-add-row">
                        <NameField
                          value=""
                          placeholder="+ Add team"
                          listId={listId}
                          clearAfter
                          onCommit={(name) => onChange(sport, { type: 'add', label: g.label, name })}
                        />
                      </li>
                    </ul>
                  </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
