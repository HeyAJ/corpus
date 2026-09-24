import { useEffect, useMemo, useRef } from 'react';
import receptorsFile from '../../data/receptors.json';
import type { ReceptorsFile } from '../../data/pharma-types';
import type { ReceptorSnapshot } from '../../bridge/types';
import { useStore } from '../store';
import { DotMatrix } from '../components/primitives';
import styles from './receptors.module.css';

/**
 * RECEPTOR PANEL (spec 8.5).
 *
 * The only dark surface in the application, matching the reference.
 *
 *  - a 60-second rolling multi-series chart, one line per active receptor
 *  - a dot-matrix occupancy bar, 20 columns at 5 % each
 *  - rows sorted by current occupancy, descending, with a 500 ms reorder tween so
 *    rows slide rather than teleport
 *
 * The reference sorts by target class instead. Occupancy-descending is more useful
 * — the thing that is happening is at the top — and does not change the look, so we
 * take the spec's version. Recorded in docs/DECISIONS.md.
 *
 * Only receptors with a ligand present are listed. A panel of thirty rows at zero
 * teaches nothing; the rows that appear are the ones the drug is actually touching.
 */

const RECEPTORS = (receptorsFile as unknown as ReceptorsFile).receptors;

const GROUP_COLOR: Record<string, string> = {
  adrenergic: '#ff2d6b',
  transporter: '#f0284c',
  'trace-amine': '#ff2d6b',
  serotonergic: '#e24be8',
  histaminergic: '#8b5cf6',
  dopaminergic: '#ff7a3d',
  cholinergic: '#38c6f4',
  opioid: '#ff2d6b',
  'amino-acid': '#7fd6ee',
  peptide: '#f0b24b',
  cannabinoid: '#9ad14a',
  metabolic: '#f2f2f2',
};

const HISTORY_SECONDS = 60;
const HISTORY_SAMPLES = HISTORY_SECONDS * 4; // snapshots are 20 Hz; keep every 5th
const ROW_HEIGHT = 44;

export function ReceptorPanel() {
  const open = useStore((s) => s.receptorPanelOpen);
  const toggle = useStore((s) => s.toggleReceptorPanel);
  const snapshot = useStore((s) => s.snapshot);

  const history = useRef<Map<string, number[]>>(new Map());
  const sampleCounter = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const active = useMemo(() => {
    if (!snapshot) return [] as ReceptorSnapshot[];
    return snapshot.receptors
      .filter((r) => r.occupancy > 0.0015 || history.current.has(r.receptorId))
      .sort((a, b) => b.occupancy - a.occupancy);
  }, [snapshot]);

  // Record history at 4 Hz: 60 s of 20 Hz data is 1200 points per series, which is
  // more resolution than a 300 px chart can show and four times the memory.
  useEffect(() => {
    if (!snapshot) return;
    sampleCounter.current += 1;
    if (sampleCounter.current % 5 !== 0) return;
    for (const r of snapshot.receptors) {
      if (r.occupancy <= 0.0015 && !history.current.has(r.receptorId)) continue;
      const series = history.current.get(r.receptorId) ?? [];
      series.push(r.occupancy);
      if (series.length > HISTORY_SAMPLES) series.shift();
      history.current.set(r.receptorId, series);
    }
  }, [snapshot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !open) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Autoscale to the tallest series so a 5 % occupancy curve is still legible.
    let peak = 0.05;
    for (const series of history.current.values()) {
      for (const v of series) if (v > peak) peak = v;
    }

    for (const [id, series] of history.current) {
      if (series.length < 2) continue;
      const def = RECEPTORS.find((r) => r.id === id);
      ctx.strokeStyle = GROUP_COLOR[def?.group ?? 'metabolic'] ?? '#f2f2f2';
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const step = width / Math.max(1, HISTORY_SAMPLES - 1);
      const offset = width - (series.length - 1) * step;
      for (let i = 0; i < series.length; i++) {
        const x = offset + i * step;
        const y = height - 6 - (series[i] / peak) * (height - 12);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, [snapshot, open]);

  if (!open) return null;

  return (
    <div className={styles.card} role="region" aria-label="Receptor occupancy"
      data-panel="receptors">
      <div className={styles.titleRow}>
        <h2 className={styles.title}>Receptors</h2>
        <button className={styles.close} onClick={toggle} aria-label="Close receptor panel">
          {'×'}
        </button>
      </div>

      <div className={styles.well}>
        <canvas ref={canvasRef} className={styles.chart} aria-hidden="true" />
        {active.length === 0 && (
          <p className={styles.wellEmpty}>No ligand bound. Administer something to see occupancy.</p>
        )}
      </div>

      <div className={styles.rows} style={{ height: Math.max(ROW_HEIGHT, active.length * ROW_HEIGHT) }}>
        {active.map((r, i) => {
          const def = RECEPTORS.find((x) => x.id === r.receptorId);
          const color = GROUP_COLOR[def?.group ?? 'metabolic'] ?? '#f2f2f2';
          return (
            <div
              key={r.receptorId}
              className={styles.row}
              /* Absolute position + a 500 ms transform transition is what makes rows
                 slide past each other on reorder instead of jumping (spec 8.5). */
              style={{ transform: `translateY(${i * ROW_HEIGHT}px)` }}
            >
              <span className={styles.receptorPill} style={{ background: color }}>
                {r.label}
              </span>
              <span className={styles.occupancyValue}>{(r.occupancy * 100).toFixed(0)}%</span>
              <DotMatrix value={r.occupancy} color="#ffffff" label={r.label} />
            </div>
          );
        })}
      </div>

      <p className={styles.footnote}>
        Occupancy is integrated from binding kinetics, not equilibrium: the rise has a real time
        constant set by each ligand{'’'}s measured affinity.
      </p>
    </div>
  );
}
