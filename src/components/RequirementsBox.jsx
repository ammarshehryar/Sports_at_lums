import { useMemo, useRef, useState } from 'react';
import { askRequirementsAI } from '../storage/ai.js';
import { describeRule } from '../engine/constraints.js';

const EXAMPLES = [
  'GIKI can’t play any match between 2pm and 4pm',
  'LUMS A is unavailable on 31 October',
  'Court 2 is closed on Saturday morning',
  'Every team needs at least 60 minutes between matches',
];

/**
 * The AI requirements box. Plain-language requirements go to Claude, which
 * returns structured rules (shown as chips); the scheduler then moves every
 * fixture that breaks one. Chips can be removed with ×.
 */
export default function RequirementsBox({ rules, onRulesChange, entrants, venueRows, fixtureName, hasSchedule, rows }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]); // [{role:'user'|'ai'|'error', text}]
  const logRef = useRef(null);

  const context = useMemo(() => {
    const sports = [...new Set(entrants.map((e) => e.sport))];
    const teamsBySport = {};
    for (const e of entrants) (teamsBySport[e.sport] ||= []).push(e.name);
    return {
      fixtureName: fixtureName || '',
      today: new Date().toISOString().slice(0, 10),
      sports,
      delegations: [...new Set(entrants.map((e) => e.delegation).filter(Boolean))],
      teamsBySport: Object.fromEntries(Object.entries(teamsBySport).map(([k, v]) => [k, v.slice(0, 120)])),
      venues: [...new Set(venueRows.map((v) => v.venueName))],
      venueDays: venueRows.map((v) => ({ venue: v.venueName, date: v.day, open: v.dayStart, close: v.dayEnd, sport: v.sport })),
      matchCount: rows.length,
    };
  }, [entrants, venueRows, fixtureName, rows.length]);

  const push = (entry) => {
    setLog((prev) => [...prev.slice(-11), entry]);
    setTimeout(() => logRef.current?.scrollTo({ top: 1e6, behavior: 'smooth' }), 30);
  };

  const describeMoves = (res) => {
    if (!hasSchedule || !res) return '';
    const parts = [];
    if (res.moved?.length) parts.push(`${res.moved.length} fixture${res.moved.length === 1 ? '' : 's'} moved to fit`);
    if (res.failed?.length) parts.push(`${res.failed.length} couldn't fit anywhere and are now unscheduled`);
    return parts.length ? ` ${parts.join('; ')}.` : ' No fixtures needed to move.';
  };

  const send = async (e) => {
    e?.preventDefault();
    const message = text.trim();
    if (!message || busy) return;
    setText('');
    push({ role: 'user', text: message });
    setBusy(true);
    try {
      const history = log.filter((l) => l.role !== 'error').slice(-6);
      const { reply, add, remove } = await askRequirementsAI({ message, history, context, rules });
      const stamp = Date.now().toString(36);
      const removeSet = new Set(remove);
      const next = [
        ...rules.filter((r) => !removeSet.has(r.id)),
        ...add.map((r, i) => ({ ...r, id: r.id && !rules.some((x) => x.id === r.id) ? r.id : `r${stamp}${i}`, text: message })),
      ];
      const changed = add.length || remove.length;
      const res = changed ? onRulesChange(next) : null;
      push({ role: 'ai', text: `${reply || 'Done.'}${changed ? describeMoves(res) : ''}` });
    } catch (err) {
      push({ role: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const removeRule = (id) => {
    const res = onRulesChange(rules.filter((r) => r.id !== id));
    if (hasSchedule) push({ role: 'ai', text: `Requirement removed.${describeMoves(res)}` });
  };

  return (
    <section className="card req-card">
      <div className="req-head">
        <h2 className="section-title">Requirements</h2>
        <span className="field-hint req-hint">
          Type any scheduling requirement in plain words. The AI turns it into a rule and the fixtures adjust.
        </span>
      </div>

      {rules.length > 0 && (
        <ul className="req-chips">
          {rules.map((r) => (
            <li key={r.id} className="req-chip" title={r.text || ''}>
              <span>{describeRule(r)}</span>
              <button type="button" aria-label="Remove requirement" onClick={() => removeRule(r.id)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {log.length > 0 && (
        <div className="req-log" ref={logRef}>
          {log.map((l, i) => (
            <p key={i} className={`req-msg req-msg-${l.role}`}>
              {l.text}
            </p>
          ))}
          {busy && <p className="req-msg req-msg-ai req-thinking">Thinking…</p>}
        </div>
      )}

      <form className="req-form" onSubmit={send}>
        <textarea
          className="req-input"
          rows={2}
          value={text}
          placeholder={`e.g. ${EXAMPLES[0]}`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) send(e);
          }}
          disabled={busy}
        />
        <button className="btn btn-primary" disabled={busy || !text.trim()}>
          {busy ? 'Working…' : 'Send'}
        </button>
      </form>
      {log.length === 0 && rules.length === 0 && (
        <div className="req-examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" className="req-example" onClick={() => setText(ex)}>
              {ex}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
