import { useEffect, useState } from 'react';
import logo from '../assets/logo.png';
import { listFixtures, createFixture, deleteFixture, usingCloud } from '../storage/fixtureStore.js';

const NAME_KEY = 'sal-your-name';

function readName() {
  try {
    return localStorage.getItem(NAME_KEY) || '';
  } catch {
    return '';
  }
}

function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * Shown between the landing page and the dashboard: pick up a saved fixture
 * where it was left, or start a new one (asks what the fixture is and who
 * is making it, then creates the record so every change after that saves).
 */
export default function FixturePicker({ onOpen, onBack }) {
  const [fixtures, setFixtures] = useState(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [yourName, setYourName] = useState(readName);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    setError('');
    listFixtures()
      .then(setFixtures)
      .catch((e) => {
        setFixtures([]);
        setError(e.message);
      });
  };

  useEffect(refresh, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim() || !yourName.trim()) return;
    setBusy(true);
    setError('');
    try {
      try {
        localStorage.setItem(NAME_KEY, yourName.trim());
      } catch {
        /* convenience only */
      }
      const rec = await createFixture(name.trim(), yourName.trim());
      onOpen(rec.id);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const handleDelete = async (f) => {
    if (!window.confirm(`Delete "${f.name}"? This can't be undone.`)) return;
    try {
      await deleteFixture(f.id);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="picker-shell">
      <header className="picker-header">
        <button className="btn btn-ghost btn-sm" onClick={onBack}>
          ← Home
        </button>
        <img src={logo} alt="" className="app-logo" />
        <h1 className="app-title">Sports at LUMS</h1>
      </header>

      <main className="picker-main">
        <section className="card picker-card">
          <h2 className="picker-title">Start a new fixture</h2>
          <form className="picker-form" onSubmit={handleCreate}>
            <label className="field">
              <span>Which fixture are you making?</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Home Fixtures 2026, Football"
                autoFocus
              />
            </label>
            <label className="field">
              <span>Your name</span>
              <input value={yourName} onChange={(e) => setYourName(e.target.value)} placeholder="e.g. Ammar" />
            </label>
            <button className="btn btn-generate btn-block" disabled={busy || !name.trim() || !yourName.trim()}>
              {busy ? 'Creating…' : 'Create and open'}
            </button>
          </form>
        </section>

        <section className="card picker-card">
          <div className="picker-list-head">
            <h2 className="picker-title">Saved fixtures</h2>
            <span className={`save-pill ${usingCloud ? 'save-pill-ok' : 'save-pill-local'}`}>
              {usingCloud ? 'Shared database' : 'Saved in this browser only'}
            </span>
          </div>
          {error && <div className="banner banner-warning">{error}</div>}
          {fixtures === null && <p className="empty-note">Loading…</p>}
          {fixtures?.length === 0 && !error && <p className="empty-note">Nothing saved yet. Start one on the left.</p>}
          {fixtures?.length > 0 && (
            <ul className="picker-list">
              {fixtures.map((f) => (
                <li key={f.id} className="picker-item">
                  <button className="picker-open" onClick={() => onOpen(f.id)}>
                    <span className="picker-item-name">{f.name}</span>
                    <span className="picker-item-meta">
                      {f.created_by} · updated {formatWhen(f.updated_at)}
                    </span>
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(f)}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
