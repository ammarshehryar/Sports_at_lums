import { useState } from 'react';
import logo from '../assets/logo.png';
import heroImage from '../assets/hero-court.jpg';

const SITE_PASSWORD = 'amaritron';
const STORAGE_KEY = 'sfl-unlocked';

export function isUnlocked() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export default function PasswordGate({ onUnlock }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (value.trim().toLowerCase() === SITE_PASSWORD) {
      try {
        sessionStorage.setItem(STORAGE_KEY, 'true');
      } catch {
        /* ignore storage failures, still unlock for this session */
      }
      setError('');
      onUnlock();
    } else {
      setError('Incorrect password. Please try again.');
      setValue('');
    }
  };

  return (
    <div className="gate-shell">
      <div className="gate-bg" style={{ '--hero-image': `url(${heroImage})` }} />
      <div className="gate-card">
        <img src={logo} alt="" className="gate-crest" />
        <h1 className="gate-title">Sports at LUMS</h1>
        <p className="gate-subtitle">Enter the access password to continue</p>
        <form className="gate-form" onSubmit={handleSubmit}>
          <input
            type="password"
            className="gate-input"
            placeholder="Password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            autoComplete="off"
          />
          <p className="gate-error">{error}</p>
          <button type="submit" className="gate-submit">
            Unlock
          </button>
        </form>
      </div>
    </div>
  );
}
