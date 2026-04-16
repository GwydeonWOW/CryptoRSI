import { useState } from 'react';
import { useInterval } from '../hooks/useInterval';

const INTERVALS = [
  { minutes: 0, label: 'OFF' },
  { minutes: 1, label: '1 min' },
  { minutes: 5, label: '5 min' },
  { minutes: 10, label: '10 min' },
  { minutes: 15, label: '15 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1h' },
];

export default function RefreshBar({ onRefresh }) {
  const [intervalMin, setIntervalMin] = useState(5);

  const delayMs = intervalMin > 0 ? intervalMin * 60 * 1000 : null;
  useInterval(onRefresh, delayMs);

  return (
    <div className="refresh-bar">
      <span className="label">Auto-actualizar:</span>
      {INTERVALS.map(({ minutes, label }) => (
        <button
          key={minutes}
          className={`interval-btn ${intervalMin === minutes ? (minutes === 0 ? 'off active' : 'active') : ''}`}
          onClick={() => setIntervalMin(minutes)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
