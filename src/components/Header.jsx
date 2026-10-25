import logo from '../assets/logo.png';
import { usingCloud } from '../storage/fixtureStore.js';

const SAVE_LABEL = {
  loading: 'Opening…',
  idle: '',
  saving: 'Saving…',
  saved: usingCloud ? 'All changes saved' : 'Saved in this browser',
  error: 'Not saved',
};

export default function Header({ summary, onBack, fixture, saveStatus, saveError }) {
  return (
    <header className="app-header">
      <div className="app-header-left">
        {onBack && (
          <button className="btn btn-ghost btn-sm header-back-btn" onClick={onBack}>
            ← Fixtures
          </button>
        )}
        <img src={logo} alt="" className="app-logo" />
        <div className="app-title-block">
          <h1 className="app-title">{fixture?.name || 'Sports at LUMS'}</h1>
          <p className="app-subtitle">
            {fixture ? `Made by ${fixture.created_by}` : 'Tournament scheduling dashboard'}
            {SAVE_LABEL[saveStatus] && (
              <span className={`save-pill save-pill-${saveStatus}`} title={saveError || undefined}>
                {SAVE_LABEL[saveStatus]}
              </span>
            )}
          </p>
        </div>
      </div>
      {summary && (
        <div className="app-header-stats">
          <span>{summary.entrantCount} entrants</span>
          <span className="dot">•</span>
          <span>{summary.sportCount} sports</span>
          <span className="dot">•</span>
          <span>{summary.matchCount} matches</span>
        </div>
      )}
    </header>
  );
}
