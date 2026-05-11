import { useState } from 'react';
import { useInterval } from '../hooks/useInterval';
import { isAdmin } from '../hooks/useRoles';

const INTERVALS = [
  { minutes: 0, label: 'OFF' },
  { minutes: 1, label: '1 min' },
  { minutes: 5, label: '5 min' },
  { minutes: 10, label: '10 min' },
  { minutes: 15, label: '15 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1h' },
];

export default function RefreshBar({ onRefresh, user }) {
  const [intervalMin, setIntervalMin] = useState(5);
  const canChange = isAdmin(user);

  const delayMs = intervalMin > 0 ? intervalMin * 60 * 1000 : null;
  useInterval(onRefresh, delayMs);

  return (
    <div className="refresh-bar">
      <span className="label">Auto-actualizar:</span>
      {INTERVALS.map(({ minutes, label }) => {
        const isActive = intervalMin === minutes;
        return (
          <button
            key={minutes}
            className={`interval-btn ${isActive ? (minutes === 0 ? 'off active' : 'active') : ''} ${!canChange ? 'disabled' : ''}`}
            onClick={() => canChange && setIntervalMin(minutes)}
            disabled={!canChange}
            style={!canChange ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
          >
            {label}
          </button>
        );
      })}
      {!canChange && <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginLeft: 4 }}>(solo admins)</span>}
    </div>
  );
}
