import { useState } from 'react';

// MultiDatePicker.jsx
// Calendar popover used by VenueSetup to pick a venue's available day(s).
// Clicking a date toggles it in or out of the pending selection - nothing
// is written back to the venue until "Done" is pressed. Works in two modes:
//   mode="multi"  (default) - any number of dates can be selected at once,
//                  used for the "+ Add day(s)" bulk-add flow.
//   mode="single" - selecting a new date replaces whatever was selected
//                  before, used for editing one existing day's date.

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function toISODate(year, month, day) {
  const mm = String(month + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

export default function MultiDatePicker({ initialDates = [], mode = 'multi', onDone, onCancel }) {
  const [selected, setSelected] = useState(() => new Set(initialDates));
  const [view, setView] = useState(() => {
    if (initialDates.length) {
      const [y, m] = initialDates[0].split('-').map(Number);
      return { year: y, month: m - 1 };
    }
    const today = new Date();
    return { year: today.getFullYear(), month: today.getMonth() };
  });

  const toggleDate = (iso) => {
    setSelected((prev) => {
      if (mode === 'single') {
        return prev.has(iso) && prev.size === 1 ? new Set() : new Set([iso]);
      }
      const next = new Set(prev);
      if (next.has(iso)) next.delete(iso);
      else next.add(iso);
      return next;
    });
  };

  const changeMonth = (delta) => {
    setView(({ year, month }) => {
      let m = month + delta;
      let y = year;
      if (m < 0) {
        m = 11;
        y -= 1;
      } else if (m > 11) {
        m = 0;
        y += 1;
      }
      return { year: y, month: m };
    });
  };

  const firstWeekday = new Date(view.year, view.month, 1).getDay();
  const totalDays = daysInMonth(view.year, view.month);
  const cells = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
  for (let d = 1; d <= totalDays; d += 1) cells.push(d);

  const sortedSelected = [...selected].sort();

  return (
    <div className="date-picker-popover">
      <div className="date-picker-header">
        <button className="date-picker-nav" onClick={() => changeMonth(-1)} aria-label="Previous month">
          ‹
        </button>
        <span className="date-picker-month">
          {MONTH_NAMES[view.month]} {view.year}
        </span>
        <button className="date-picker-nav" onClick={() => changeMonth(1)} aria-label="Next month">
          ›
        </button>
      </div>

      <div className="date-picker-weekdays">
        {WEEKDAY_LABELS.map((w, i) => (
          <span key={`${w}-${i}`}>{w}</span>
        ))}
      </div>

      <div className="date-picker-grid">
        {cells.map((d, i) => {
          if (d === null) return <span key={`blank-${i}`} className="date-picker-cell date-picker-cell-empty" />;
          const iso = toISODate(view.year, view.month, d);
          const isSelected = selected.has(iso);
          return (
            <button
              key={iso}
              className={`date-picker-cell${isSelected ? ' date-picker-cell-selected' : ''}`}
              onClick={() => toggleDate(iso)}
            >
              {d}
            </button>
          );
        })}
      </div>

      <div className="date-picker-footer">
        <span className="date-picker-count">
          {selected.size === 0
            ? 'No dates selected'
            : `${selected.size} date${selected.size > 1 ? 's' : ''} selected`}
        </span>
        <div className="date-picker-footer-actions">
          {mode === 'multi' && selected.size > 0 && (
            <button className="date-picker-clear" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => onDone(sortedSelected)}
            disabled={selected.size === 0}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
