import { useMemo } from 'react';

/**
 * Derives group membership from the flattened schedule rows: every row that
 * carries a `group` label came from a group-stage round-robin match, so
 * scanning teamA/teamB across all of a group's matches recovers its full
 * member list (each entrant faces every other member of their group).
 */
function buildGroups(rows) {
  const bySport = new Map();

  for (const r of rows) {
    if (!r.group) continue;
    if (!bySport.has(r.sport)) bySport.set(r.sport, new Map());
    const groups = bySport.get(r.sport);
    if (!groups.has(r.group)) groups.set(r.group, new Map());
    const members = groups.get(r.group);
    members.set(`${r.teamA}|${r.delegationA}`, { name: r.teamA, delegation: r.delegationA });
    members.set(`${r.teamB}|${r.delegationB}`, { name: r.teamB, delegation: r.delegationB });
  }

  return [...bySport.entries()].map(([sport, groups]) => ({
    sport,
    groups: [...groups.entries()]
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }))
      .map(([label, members]) => ({
        label,
        members: [...members.values()].sort((a, b) => a.name.localeCompare(b.name)),
      })),
  }));
}

export default function GroupsOverview({ rows }) {
  const sports = useMemo(() => buildGroups(rows), [rows]);

  if (!sports.length) return null;

  return (
    <section className="card groups-card">
      <h2 className="section-title groups-title">Groups</h2>
      <div className="groups-sport-list">
        {sports.map(({ sport, groups }) => (
          <div className="groups-sport-block" key={sport}>
            <h3 className="groups-sport-name">{sport}</h3>
            <div className="groups-grid">
              {groups.map(({ label, members }) => (
                <div className="group-tile" key={label}>
                  <div className="group-tile-head">
                    <span>Group {label}</span>
                    <span className="group-tile-count">{members.length}</span>
                  </div>
                  <ul className="group-member-list">
                    {members.map((m) => (
                      <li key={`${m.name}|${m.delegation}`}>
                        <span className="group-member-name">{m.name}</span>
                        <span className="group-member-delegation">{m.delegation}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
