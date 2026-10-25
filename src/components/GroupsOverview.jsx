import { useMemo } from 'react';

/**
 * Editable group-stage groups. Every team has one dropdown to move it to
 * another group, swap it with a team in another group, or take it out of
 * the groups altogether (it then waits under "Not in a group" and can be
 * added back). Each change goes straight to onEdit, which rebuilds that
 * sport's fixtures (engine/tournament.js applyGroupEdit), so the schedule
 * above always matches what's shown here.
 */
export default function GroupsOverview({ groupsBySport, entrants, onEdit, lastEdit }) {
  const byId = useMemo(() => new Map(entrants.map((e) => [e.id, e])), [entrants]);
  const sports = Object.entries(groupsBySport || {});
  if (!sports.length) return null;

  const apply = (sport, { groups, unassigned }, action) => {
    const next = groups.map((g) => ({ ...g, memberIds: [...g.memberIds] }));
    let pool = [...unassigned];
    const { type, id, target } = action;
    const fromIdx = next.findIndex((g) => g.memberIds.includes(id));
    if (type === 'move' || type === 'add') {
      if (fromIdx !== -1) next[fromIdx].memberIds = next[fromIdx].memberIds.filter((x) => x !== id);
      pool = pool.filter((x) => x !== id);
      next.find((g) => g.label === target).memberIds.push(id);
    } else if (type === 'swap') {
      const toIdx = next.findIndex((g) => g.memberIds.includes(target));
      if (fromIdx === -1 || toIdx === -1) return;
      next[fromIdx].memberIds = next[fromIdx].memberIds.map((x) => (x === id ? target : x));
      next[toIdx].memberIds = next[toIdx].memberIds.map((x) => (x === target ? id : x));
    } else if (type === 'remove') {
      if (fromIdx !== -1) next[fromIdx].memberIds = next[fromIdx].memberIds.filter((x) => x !== id);
      pool.push(id);
    }
    onEdit(sport, next, pool);
  };

  const onSelect = (sport, data, id) => (e) => {
    const v = e.target.value;
    e.target.value = '';
    if (!v) return;
    const [type, target] = v.split('::');
    apply(sport, data, { type, id, target });
  };

  return (
    <section className="card groups-card">
      <div className="groups-head">
        <h2 className="section-title groups-title">Groups</h2>
        <span className="field-hint groups-hint">
          Move, swap or remove a team and its fixtures update automatically.
        </span>
      </div>
      {lastEdit && <p className="groups-last-edit">{lastEdit}</p>}
      <div className="groups-sport-list">
        {sports.map(([sport, data]) => (
          <div className="groups-sport-block" key={sport}>
            <h3 className="groups-sport-name">{sport}</h3>
            <div className="groups-grid">
              {data.groups.map((g) => (
                <div className="group-tile" key={g.label}>
                  <div className="group-tile-head">
                    <span>Group {g.label}</span>
                    <span className="group-tile-count">{g.memberIds.length}</span>
                  </div>
                  <ul className="group-member-list">
                    {g.memberIds.map((id) => {
                      const e = byId.get(id);
                      if (!e) return null;
                      return (
                        <li key={id}>
                          <span className="group-member-text">
                            <span className="group-member-name">{e.name}</span>
                            <span className="group-member-delegation">{e.delegation}</span>
                          </span>
                          <select
                            className="group-member-action"
                            defaultValue=""
                            aria-label={`Change group for ${e.name}`}
                            onChange={onSelect(sport, data, id)}
                          >
                            <option value="">Change…</option>
                            <optgroup label="Move to">
                              {data.groups
                                .filter((o) => o.label !== g.label)
                                .map((o) => (
                                  <option key={o.label} value={`move::${o.label}`}>
                                    Group {o.label}
                                  </option>
                                ))}
                            </optgroup>
                            <optgroup label="Swap with">
                              {data.groups
                                .filter((o) => o.label !== g.label)
                                .flatMap((o) =>
                                  o.memberIds.map((oid) => (
                                    <option key={oid} value={`swap::${oid}`}>
                                      {byId.get(oid)?.name} (Group {o.label})
                                    </option>
                                  ))
                                )}
                            </optgroup>
                            <option value="remove::">Remove from groups</option>
                          </select>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
            {data.unassigned.length > 0 && (
              <div className="group-unassigned">
                <span className="group-unassigned-title">Not in a group</span>
                <ul className="group-member-list">
                  {data.unassigned.map((id) => {
                    const e = byId.get(id);
                    if (!e) return null;
                    return (
                      <li key={id}>
                        <span className="group-member-text">
                          <span className="group-member-name">{e.name}</span>
                          <span className="group-member-delegation">{e.delegation}</span>
                        </span>
                        <select
                          className="group-member-action"
                          defaultValue=""
                          aria-label={`Add ${e.name} to a group`}
                          onChange={onSelect(sport, data, id)}
                        >
                          <option value="">Add to…</option>
                          {data.groups.map((o) => (
                            <option key={o.label} value={`add::${o.label}`}>
                              Group {o.label}
                            </option>
                          ))}
                        </select>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
