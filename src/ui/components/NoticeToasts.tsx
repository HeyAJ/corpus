import { useEffect, useRef, useState } from 'react';
import type { EngineNotice } from '../../bridge/types';
import { useStore } from '../store';
import styles from './notices.module.css';

/**
 * ENGINE NOTICES, as toasts.
 *
 * The engine talks back — most importantly, it REFUSES things, and a refused dose is
 * the one event that used to vanish without trace. The worker silently rejects any dose
 * that is not a declared preset, and from the interface a refused dose looked exactly
 * like a broken drug: you pressed the button, nothing happened, and nothing said why.
 * The engine now writes those messages into `snapshot.notices`; this surfaces them.
 *
 * A notice is shown once, for a fixed WALL-CLOCK span, not a simulated one — otherwise
 * at 300× a message would flash past in a tenth of a second, which is exactly when you
 * are least able to catch it. Each id is shown once and then held for a few real
 * seconds regardless of how fast the body's clock is running, then it clears itself.
 */

const HOLD_MS = 5000;
const EMPTY: EngineNotice[] = [];

export function NoticeToasts() {
  const notices = useStore((s) => s.snapshot?.notices ?? EMPTY);
  const [shown, setShown] = useState<EngineNotice[]>([]);
  const seen = useRef<Set<number>>(new Set());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    for (const n of notices) {
      if (seen.current.has(n.id)) continue;
      seen.current.add(n.id);
      setShown((prev) => [...prev.slice(-3), n]);
      const timer = setTimeout(() => {
        setShown((prev) => prev.filter((x) => x.id !== n.id));
      }, HOLD_MS);
      timers.current.push(timer);
    }
  }, [notices]);

  useEffect(() => {
    const t = timers.current;
    return () => t.forEach(clearTimeout);
  }, []);

  if (shown.length === 0) return null;

  return (
    <div className={styles.toasts} role="status" aria-live="assertive">
      {shown.map((n) => (
        <span key={n.id} className={`${styles.toast} ${styles[`tone_${n.tone}`] ?? ''}`}>
          {n.text}
        </span>
      ))}
    </div>
  );
}
