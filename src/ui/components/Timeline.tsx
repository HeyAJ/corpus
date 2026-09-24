import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { readTrend, trendFor } from '../trends';
import styles from './timeline.module.css';

/**
 * THE SESSION TIMELINE.
 *
 * The one thing a physiology simulator most needs and most often lacks: a record that
 * puts what you did on the same axis as what happened. Without it the interface can
 * show that mean pressure is 96 and rising, but not that it started rising ninety
 * seconds after a dose — and the second fact is the entire subject.
 *
 * Two layers over one shared time axis:
 *
 *   - a mean arterial pressure trace and a heart rate trace over the last minute,
 *     read from the same rolling buffers the sparklines use;
 *   - a tick for every administration, meal and procedure, at the simulated second
 *     it happened.
 *
 * SIMULATED TIME, NOT WALL-CLOCK TIME. At sixty times speed a minute of simulated
 * physiology passes in a second of real time, and a timeline drawn on wall-clock time
 * would compress exactly the part worth looking at. Everything here — the trend
 * buffers and the event stamps alike — is indexed on the body's clock.
 *
 * It collapses to a single strip of ticks, because most of the time the answer is
 * "nothing has happened yet" and that should take up almost no room.
 */

const WINDOW_S = 60;

function timeAgo(seconds: number): string {
  if (seconds < 1) return 'now';
  if (seconds < 60) return `${seconds.toFixed(0)} s ago`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(0)} min ago`;
  return `${(seconds / 3600).toFixed(1)} h ago`;
}

const KIND_CLASS: Record<string, string> = {
  drug: styles.markDrug,
  food: styles.markFood,
  procedure: styles.markProcedure,
  state: styles.markState,
};

export function Timeline() {
  const events = useStore((s) => s.events);
  const snapshot = useStore((s) => s.snapshot);
  const [open, setOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scratch = useRef(new Float32Array(240));

  const now = snapshot?.t ?? 0;

  // Only the events inside the drawn window get a tick; the rest stay in the list.
  const visible = useMemo(
    () => events.filter((e) => now - e.t <= WINDOW_S && now - e.t >= 0),
    [events, now],
  );

  const map = trendFor('map');
  const hr = trendFor('hr');

  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const pad = 3;
    const plotH = height - pad * 2;

    const drawSeries = (key: string, stroke: string, minSpan: number) => {
      const s = trendFor(key);
      if (!s) return;
      const n = readTrend(key, scratch.current);
      if (n < 2) return;
      const mid = (s.min + s.max) / 2;
      const span = Math.max(s.max - s.min, minSpan);
      const lo = mid - span / 2;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * width;
        const y = pad + plotH - ((scratch.current[i] - lo) / span) * plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.4;
      ctx.lineJoin = 'round';
      ctx.stroke();
    };

    // Each trace keeps its own vertical scale. They are different quantities in
    // different units, and forcing them onto one axis would imply a comparison that
    // does not exist; what the shared axis is for is TIME.
    drawSeries('map', 'rgba(200, 67, 58, 0.85)', 12);
    drawSeries('hr', 'rgba(56, 198, 244, 0.85)', 10);
  }, [open, map, hr, now]);

  if (events.length === 0) return null;

  return (
    <section
      className={`${styles.wrap} ${open ? styles.wrapOpen : ''}`}
      data-timeline
      aria-label="Session timeline"
    >
      <button
        className={styles.toggle}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className={styles.toggleLabel}>Timeline</span>
        <span className={styles.toggleCount}>{events.length}</span>
      </button>

      <div className={styles.track} aria-hidden="true">
        {open && <canvas ref={canvasRef} className={styles.canvas} />}
        {visible.map((e) => (
          <span
            key={e.id}
            className={`${styles.mark} ${KIND_CLASS[e.kind] ?? ''}`}
            style={{ left: `${Math.max(0, Math.min(100, ((WINDOW_S - (now - e.t)) / WINDOW_S) * 100))}%` }}
            title={`${e.label} — ${timeAgo(now - e.t)}`}
          />
        ))}
      </div>

      {open && (
        <>
          <div className={styles.legend} aria-hidden="true">
            <span className={styles.legendMap}>mean pressure</span>
            <span className={styles.legendHr}>heart rate</span>
            <span className={styles.legendSpan}>last {WINDOW_S} s of simulated time</span>
          </div>

          {/* The record proper. Colour and position carry none of this on their own. */}
          <ol className={styles.list}>
            {events.slice().reverse().slice(0, 12).map((e) => (
              <li key={e.id} className={styles[`tone_${e.tone}`]}>
                <span className={styles.listTime}>{timeAgo(now - e.t)}</span>
                <span className={styles.listLabel}>{e.label}</span>
                {e.detail && <span className={styles.listDetail}>{e.detail}</span>}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
