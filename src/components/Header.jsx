import logo from '../assets/logo.png';

export default function Header({ summary, onBack }) {
  return (
    <header className="app-header">
      <div className="app-header-left">
        {onBack && (
          <button className="btn btn-ghost btn-sm header-back-btn" onClick={onBack}>
            ← Home
          </button>
        )}
        <img src={logo} alt="" className="app-logo" />
        <div className="app-title-block">
          <h1 className="app-title">Sports at LUMS</h1>
          <p className="app-subtitle">Tournament scheduling dashboard</p>
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
