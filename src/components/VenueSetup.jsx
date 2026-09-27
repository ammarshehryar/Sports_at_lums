import { useState } from 'react';
import { emptyDay, makeVenue } from '../engine/venueSetupIO.js';
import MultiDatePicker from './MultiDatePicker.jsx';

/**
 * Replaces the old "number of venues + flat name list" input with a proper
 * per-venue availability builder: each venue can have several day windows
 * (date + open/close time + an optional break), matching how tournament
 * venues actually work — a court might only be free 9am-1pm on day one but
 * all day on day two, or close for Friday prayer / lunch.
 *
 * Dates themselves are picked from a calendar (MultiDatePicker) rather than
 * typed one at a time. The "📅 Add day(s)" button sits right in the venue's
 * header - no need to scroll down - and opens the calendar in multi-select
 * mode so several days can be chosen together and confirmed with one "Done"
 * click. Each existing row's date is itself the calendar trigger: clicking
 * it reopens the same calendar in single-select mode to correct just that
 * one date. Rows are always listed in date order, however they were added.
 */
function formatDisplayDate(iso) {
  if (!iso) return 'No date set';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

// Days are always shown chronologically, regardless of the order they were
// added in - so picking the 20th and then going back to add the 5th doesn't
// leave the list looking jumbled. Anything without a date yet sorts first,
// so it stays visible instead of getting lost among set dates.
function sortDays(days) {
  return [...days].sort((a, b) => (a.day || '').localeCompare(b.day || ''));
}

export default function VenueSetup({ sports, venues, onChange }) {
  const [quickName, setQuickName] = useState('Venue');
  const [quickCount, setQuickCount] = useState(1);
  // { venueId, dayId } identifies which picker is open: dayId === null means
  // the venue's bulk "+ Add day(s)" picker; otherwise it's that one row's
  // own date field, clicked directly to change just that date. Only one
  // picker is open at a time.
  const [picker, setPicker] = useState(null);

  const addVenues = () => {
    const count = Math.max(1, Number(quickCount) || 1);
    const baseName = quickName.trim() || 'Venue';
    const startIdx = venues.length + 1;
    const additions = Array.from({ length: count }, (_, i) =>
      makeVenue(count === 1 ? baseName : `${baseName} ${startIdx + i}`, sports[0] || 'ALL')
    );
    onChange([...venues, ...additions]);
    setQuickCount(1);
  };

  const updateVenue = (id, patch) => onChange(venues.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  const removeVenue = (id) => onChange(venues.filter((v) => v.id !== id));
  const updateDay = (venueId, dayId, patch) =>
    onChange(
      venues.map((v) =>
        v.id !== venueId ? v : { ...v, days: v.days.map((d) => (d.id === dayId ? { ...d, ...patch } : d)) }
      )
    );
  const removeDay = (venueId, dayId) =>
    onChange(venues.map((v) => (v.id !== venueId ? v : { ...v, days: v.days.filter((d) => d.id !== dayId) })));

  const closePicker = () => setPicker(null);

  const handlePickerDone = (dates) => {
    if (!picker) return;
    const { venueId, dayId } = picker;

    if (dayId) {
      // Editing one existing row's date.
      const newDate = dates[0];
      if (newDate) updateDay(venueId, dayId, { day: newDate });
    } else {
      // Bulk "+ Add day(s)": add one row per newly-picked date (skipping
      // any already on this venue), dropping the venue's unset placeholder
      // row if one is still sitting there.
      onChange(
        venues.map((v) => {
          if (v.id !== venueId) return v;
          const existing = new Set(v.days.map((d) => d.day).filter(Boolean));
          const additions = dates.filter((d) => !existing.has(d)).map((d) => ({ ...emptyDay(), day: d }));
          if (!additions.length) return v;
          const kept = v.days.filter((d) => d.day);
          return { ...v, days: [...kept, ...additions] };
        })
      );
    }
    closePicker();
  };

  return (
    <section className="input-card">
      <h2 className="input-card-title">Venues</h2>
      <p className="field-hint venue-setup-hint">
        Add each court or ground, which sport it hosts, and every day it's actually open — including the exact
        hours and any lunch/prayer break. This is what the scheduler uses to place matches for real.
      </p>

      <div className="venue-quick-add">
        <input
          className="venue-quick-input"
          value={quickName}
          onChange={(e) => setQuickName(e.target.value)}
          placeholder="Venue name"
        />
        <input
          className="venue-quick-input venue-quick-count"
          type="number"
          min="1"
          value={quickCount}
          onChange={(e) => setQuickCount(e.target.value)}
        />
        <button className="btn btn-sm" onClick={addVenues}>
          + Add venue{Number(quickCount) > 1 ? 's' : ''}
        </button>
      </div>

      {venues.length === 0 && <p className="empty-note">No venues yet — add at least one above.</p>}

      {venues.map((v) => (
        <div className="venue-card" key={v.id}>
          <div className="venue-card-header">
            <label className="field venue-name-field">
              <span>Name</span>
              <input value={v.venueName} onChange={(e) => updateVenue(v.id, { venueName: e.target.value })} />
            </label>
            <label className="field venue-sport-field">
              <span>Sport</span>
              <select value={v.sport} onChange={(e) => updateVenue(v.id, { sport: e.target.value })}>
                <option value="ALL">All sports</option>
                {sports.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn btn-outline btn-sm venue-add-day-btn"
              onClick={() => setPicker({ venueId: v.id, dayId: null })}
            >
              <span aria-hidden="true">📅</span> Add day(s)
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => removeVenue(v.id)}>
              Remove
            </button>
          </div>

          {picker?.venueId === v.id && picker?.dayId === null && (
            <MultiDatePicker mode="multi" initialDates={[]} onDone={handlePickerDone} onCancel={closePicker} />
          )}

          {sortDays(v.days).map((d) => (
            <div key={d.id}>
              <div className="venue-day-row">
                <button
                  type="button"
                  className="venue-day-date-field venue-day-date-button"
                  onClick={() => setPicker({ venueId: v.id, dayId: d.id })}
                >
                  <span className="venue-day-date-label">Day</span>
                  <span className="venue-day-date-display">
                    <span className="venue-day-date-icon" aria-hidden="true">📅</span>
                    <span className="venue-day-date-value">{formatDisplayDate(d.day)}</span>
                  </span>
                </button>
                <label>
                  <span>Open</span>
                  <input
                    type="time"
                    value={d.dayStart}
                    onChange={(e) => updateDay(v.id, d.id, { dayStart: e.target.value })}
                  />
                </label>
                <label>
                  <span>Close</span>
                  <input
                    type="time"
                    value={d.dayEnd}
                    onChange={(e) => updateDay(v.id, d.id, { dayEnd: e.target.value })}
                  />
                </label>
                <label className="venue-break-toggle">
                  <input
                    type="checkbox"
                    checked={d.breakEnabled}
                    onChange={(e) => updateDay(v.id, d.id, { breakEnabled: e.target.checked })}
                  />
                  <span>Break</span>
                </label>
                {d.breakEnabled && (
                  <>
                    <label>
                      <span>From</span>
                      <input
                        type="time"
                        value={d.breakStart}
                        onChange={(e) => updateDay(v.id, d.id, { breakStart: e.target.value })}
                      />
                    </label>
                    <label>
                      <span>To</span>
                      <input
                        type="time"
                        value={d.breakEnd}
                        onChange={(e) => updateDay(v.id, d.id, { breakEnd: e.target.value })}
                      />
                    </label>
                  </>
                )}
                {v.days.length > 1 && (
                  <button className="btn btn-ghost btn-sm" onClick={() => removeDay(v.id, d.id)}>
                    Remove day
                  </button>
                )}
              </div>

              {picker?.venueId === v.id && picker?.dayId === d.id && (
                <MultiDatePicker
                  mode="single"
                  initialDates={d.day ? [d.day] : []}
                  onDone={handlePickerDone}
                  onCancel={closePicker}
                />
              )}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
