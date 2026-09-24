import { useStore } from '../store';
import styles from './timescale.module.css';

/**
 * TIME SCALE (spec 4.1, 8.2).
 *
 * The worker scales the NUMBER of fixed steps it takes, never `dt`, so switching
 * from 1x to 300x cannot produce a discontinuity in any state variable. Every
 * integrator sees the same 10 ms step it always saw; there are simply more of them
 * per wall-clock second.
 *
 * 300x is what turns "wait four hours for an oral dose to distribute" into
 * forty-eight seconds, which is the difference between a demo and a toy you can
 * actually learn from.
 */

const SCALES = [1, 5, 30, 300] as const;

export function TimeScaleControl() {
  const timeScale = useStore((s) => s.timeScale);
  const setTimeScale = useStore((s) => s.setTimeScale);
  const snapshot = useStore((s) => s.snapshot);

  const elapsed = snapshot?.t ?? 0;
  const hh = Math.floor(elapsed / 3600);
  const mm = Math.floor((elapsed % 3600) / 60);
  const ss = Math.floor(elapsed % 60);

  return (
    <div className={styles.wrap} role="group" aria-label="Simulation speed">
      <span className={styles.clock} aria-label={`Simulated time ${hh} hours ${mm} minutes ${ss} seconds`}>
        {hh > 0 ? `${hh}:` : ''}
        {String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}
      </span>
      {SCALES.map((x) => (
        <button
          key={x}
          className={timeScale === x ? styles.active : styles.button}
          onClick={() => setTimeScale(x)}
          aria-pressed={timeScale === x}
          aria-label={`${x} times real time`}
        >
          {x}&times;
        </button>
      ))}
    </div>
  );
}
