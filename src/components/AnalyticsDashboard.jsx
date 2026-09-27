import { useMemo } from 'react';

const PALETTE = ['#e0203f', '#c9a24a', '#ff3355', '#8c1023', '#e8c877', '#7a0a1c', '#b8102a', '#f3d29b'];

function colorFor(i) {
  return PALETTE[i % PALETTE.length];
}

function StatCard({ label, value }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function BarChart({ data }) {
  const width = 480;
  const height = 220;
  const padding = { top: 10, right: 10, bottom: 34, left: 34 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const max = Math.max(1, ...data.map((d) => d.value));
  const barWidth = data.length ? innerW / data.length : innerW;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label="Matches per venue">
      {[0, 0.5, 1].map((t) => (
        <line
          key={t}
          x1={padding.left}
          x2={width - padding.right}
          y1={padding.top + innerH * (1 - t)}
          y2={padding.top + innerH * (1 - t)}
          stroke="var(--border)"
          strokeWidth="1"
        />
      ))}
      {data.map((d, i) => {
        const h = (d.value / max) * innerH;
        const x = padding.left + i * barWidth + barWidth * 0.18;
        const w = barWidth * 0.64;
        const y = padding.top + innerH - h;
        return (
          <g key={d.label}>
            <rect x={x} y={y} width={w} height={h} rx="4" fill={colorFor(i)} />
            <text x={x + w / 2} y={padding.top + innerH + 16} textAnchor="middle" className="chart-axis-label">
              {d.label.length > 10 ? `${d.label.slice(0, 9)}…` : d.label}
            </text>
            <text x={x + w / 2} y={y - 6} textAnchor="middle" className="chart-value-label">
              {d.value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function LineChart({ data }) {
  const width = 480;
  const height = 220;
  const padding = { top: 16, right: 16, bottom: 34, left: 34 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const max = Math.max(1, ...data.map((d) => d.value));
  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;

  const points = data.map((d, i) => {
    const x = padding.left + i * stepX;
    const y = padding.top + innerH - (d.value / max) * innerH;
    return { x, y, ...d };
  });
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const area = `${path} L ${points[points.length - 1]?.x ?? padding.left} ${padding.top + innerH} L ${padding.left} ${padding.top + innerH} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label="Matches per day">
      {[0, 0.5, 1].map((t) => (
        <line
          key={t}
          x1={padding.left}
          x2={width - padding.right}
          y1={padding.top + innerH * (1 - t)}
          y2={padding.top + innerH * (1 - t)}
          stroke="var(--border)"
          strokeWidth="1"
        />
      ))}
      {points.length > 0 && <path d={area} fill="var(--accent-glow)" opacity="0.12" />}
      {points.length > 0 && <path d={path} fill="none" stroke="var(--accent-bright)" strokeWidth="2.5" />}
      {points.map((p) => (
        <g key={p.label}>
          <circle cx={p.x} cy={p.y} r="3.5" fill="var(--accent-bright)" />
          <text x={p.x} y={padding.top + innerH + 16} textAnchor="middle" className="chart-axis-label">
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

function PieChart({ data }) {
  const size = 200;
  const r = 84;
  const cx = size / 2;
  const cy = size / 2;
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  let angle = -90;

  const slices = data.map((d, i) => {
    const sweep = (d.value / total) * 360;
    const start = angle;
    const end = angle + sweep;
    angle = end;
    const large = sweep > 180 ? 1 : 0;
    const toXY = (a) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
    const [x1, y1] = toXY(start);
    const [x2, y2] = toXY(end);
    const path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
    return { path, color: colorFor(i), ...d };
  });

  return (
    <div className="pie-wrap">
      <svg viewBox={`0 0 ${size} ${size}`} className="chart-svg pie-svg" role="img" aria-label="Delegation distribution">
        {slices.map((s) => (
          <path key={s.label} d={s.path} fill={s.color} stroke="var(--surface)" strokeWidth="2" />
        ))}
      </svg>
      <ul className="pie-legend">
        {slices.map((s) => (
          <li key={s.label}>
            <span className="legend-dot" style={{ background: s.color }} />
            {s.label} <span className="legend-value">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProgressBars({ data }) {
  return (
    <div className="progress-list">
      {data.map((d, i) => (
        <div className="progress-row" key={d.label}>
          <div className="progress-row-head">
            <span>{d.label}</span>
            <span>{d.percent}%</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${Math.min(100, d.percent)}%`, background: colorFor(i) }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function parseTimeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function GanttTimeline({ days, dayBoundsMin }) {
  if (!days.length) return <p className="empty-note">No scheduled matches yet.</p>;
  const width = 700;
  const rowH = 28;
  const padding = { top: 10, right: 100, bottom: 10, left: 100 };
  const [dayStartMin, dayEndMin] = dayBoundsMin;
  const innerW = width - padding.left - padding.right;
  const scaleX = (minutes) => padding.left + ((minutes - dayStartMin) / (dayEndMin - dayStartMin || 1)) * innerW;
  const height = padding.top + padding.bottom + days.length * rowH;
  const hourTicks = [];
  for (let h = Math.ceil(dayStartMin / 60); h <= Math.floor(dayEndMin / 60); h += 2) hourTicks.push(h);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label="Tournament timeline">
      {hourTicks.map((h) => (
        <line
          key={h}
          x1={scaleX(h * 60)}
          x2={scaleX(h * 60)}
          y1={padding.top}
          y2={height - padding.bottom}
          stroke="var(--border)"
        />
      ))}
      {hourTicks.map((h) => (
        <text key={h} x={scaleX(h * 60)} y={height - 2} textAnchor="middle" className="chart-axis-label">
          {h}:00
        </text>
      ))}
      {days.map((d, i) => {
        const y = padding.top + i * rowH;
        const x1 = scaleX(d.startMin);
        const x2 = scaleX(d.endMin);
        return (
          <g key={d.date}>
            <text x={padding.left - 10} y={y + rowH / 2 + 4} textAnchor="end" className="chart-axis-label">
              {d.date}
            </text>
            <rect x={x1} y={y + 5} width={Math.max(2, x2 - x1)} height={rowH - 12} rx="5" fill={colorFor(i)} />
            <text x={x2 + 8} y={y + rowH / 2 + 4} className="chart-value-label">
              {d.count} matches
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function AnalyticsDashboard({ rows, venueRows, matchDuration, breakDuration }) {
  const stats = useMemo(() => {
    const venues = new Set(rows.map((r) => r.venue).filter((v) => v && v !== 'Unscheduled'));
    const delegations = new Set(rows.flatMap((r) => [r.delegationA, r.delegationB]).filter(Boolean));
    const days = new Set(rows.map((r) => r.date).filter((d) => d && d !== '—'));
    const totalMatches = rows.length;
    const dayCount = days.size || 1;
    return {
      totalMatches,
      totalVenues: venues.size,
      totalDelegations: delegations.size,
      tournamentDays: days.size,
      avgPerDay: Math.round((totalMatches / dayCount) * 10) / 10,
    };
  }, [rows]);

  const matchesPerVenue = useMemo(() => {
    const counts = new Map();
    for (const r of rows) {
      if (!r.venue || r.venue === 'Unscheduled') continue;
      counts.set(r.venue, (counts.get(r.venue) || 0) + 1);
    }
    return [...counts.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [rows]);

  const matchesPerDay = useMemo(() => {
    const counts = new Map();
    for (const r of rows) {
      if (!r.date || r.date === '—') continue;
      counts.set(r.date, (counts.get(r.date) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, value]) => ({ label: label.slice(5), value }));
  }, [rows]);

  const delegationDistribution = useMemo(() => {
    const counts = new Map();
    for (const r of rows) {
      if (r.delegationA) counts.set(r.delegationA, (counts.get(r.delegationA) || 0) + 1);
      if (r.delegationB) counts.set(r.delegationB, (counts.get(r.delegationB) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [rows]);

  const venueUtilization = useMemo(() => {
    if (!venueRows?.length) return [];
    const slotMinutes = (matchDuration || 30) + (breakDuration || 0);
    const availableMinutesByVenue = new Map();
    for (const v of venueRows) {
      const open = parseTimeToMinutes(v.dayStart);
      const close = parseTimeToMinutes(v.dayEnd);
      let minutes = Math.max(0, close - open);
      if (v.breakStart && v.breakEnd) {
        minutes -= Math.max(0, parseTimeToMinutes(v.breakEnd) - parseTimeToMinutes(v.breakStart));
      }
      availableMinutesByVenue.set(v.venueName, (availableMinutesByVenue.get(v.venueName) || 0) + minutes);
    }
    return [...availableMinutesByVenue.entries()].map(([name, totalMinutes]) => {
      const capacity = Math.max(1, Math.floor(totalMinutes / slotMinutes));
      const used = rows.filter((r) => r.venue === name).length;
      return { label: name, percent: Math.round((used / capacity) * 100) };
    });
  }, [rows, venueRows, matchDuration, breakDuration]);

  const dayBoundsMin = useMemo(() => {
    if (!venueRows?.length) return [9 * 60, 19 * 60];
    let min = Infinity;
    let max = -Infinity;
    for (const v of venueRows) {
      min = Math.min(min, parseTimeToMinutes(v.dayStart));
      max = Math.max(max, parseTimeToMinutes(v.dayEnd));
    }
    return [min, max];
  }, [venueRows]);

  const timeline = useMemo(() => {
    const byDay = new Map();
    for (const r of rows) {
      if (!r.date || r.date === '—' || !r.startTime) continue;
      const [sh, sm] = r.startTime.split(':').map(Number);
      const [eh, em] = r.endTime.split(':').map(Number);
      const startMin = sh * 60 + sm;
      const endMin = eh * 60 + em;
      if (!byDay.has(r.date)) byDay.set(r.date, { date: r.date, startMin, endMin, count: 0 });
      const entry = byDay.get(r.date);
      entry.startMin = Math.min(entry.startMin, startMin);
      entry.endMin = Math.max(entry.endMin, endMin);
      entry.count += 1;
    }
    return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [rows]);

  return (
    <section className="analytics-section">
      <h2 className="section-title">Analytics Dashboard</h2>

      <div className="stat-grid">
        <StatCard label="Total Matches" value={stats.totalMatches} />
        <StatCard label="Total Venues" value={stats.totalVenues} />
        <StatCard label="Total Delegations" value={stats.totalDelegations} />
        <StatCard label="Tournament Days" value={stats.tournamentDays} />
        <StatCard label="Avg Matches / Day" value={stats.avgPerDay} />
      </div>

      <div className="chart-grid">
        <div className="card chart-card">
          <h3 className="chart-title">Matches per Venue</h3>
          {matchesPerVenue.length ? <BarChart data={matchesPerVenue} /> : <p className="empty-note">No data yet.</p>}
        </div>
        <div className="card chart-card">
          <h3 className="chart-title">Matches per Day</h3>
          {matchesPerDay.length ? <LineChart data={matchesPerDay} /> : <p className="empty-note">No data yet.</p>}
        </div>
        <div className="card chart-card">
          <h3 className="chart-title">Delegation Distribution</h3>
          {delegationDistribution.length ? (
            <PieChart data={delegationDistribution} />
          ) : (
            <p className="empty-note">No data yet.</p>
          )}
        </div>
        <div className="card chart-card">
          <h3 className="chart-title">Venue Utilization</h3>
          {venueUtilization.length ? <ProgressBars data={venueUtilization} /> : <p className="empty-note">No data yet.</p>}
        </div>
        <div className="card chart-card chart-card-wide">
          <h3 className="chart-title">Tournament Timeline</h3>
          <GanttTimeline days={timeline} dayBoundsMin={dayBoundsMin} />
        </div>
      </div>
    </section>
  );
}
