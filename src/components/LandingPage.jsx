import heroImage from '../assets/hero-court.jpg';

export default function LandingPage({ onOpenDashboard }) {
  return (
    <div className="landing-shell">
      <div className="landing-bg" style={{ '--hero-image': `url(${heroImage})` }} />
      <div className="landing-content">
        <p className="landing-eyebrow">LUMS Society</p>
        <h1 className="landing-title">
          SPORTS
          <span className="landing-title-accent">AT LUMS</span>
        </h1>
        <p className="landing-subtitle">Tournament scheduling, made effortless.</p>
        <button className="btn-cta" onClick={onOpenDashboard}>
          Enter Dashboard →
        </button>
      </div>
    </div>
  );
}
