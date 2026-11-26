import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { Viewer } from '../../render/scene/Viewer';
import { BrainScan, BRAIN_SCAN_IDS, SCAN_LEGEND } from '../../render/scan/BrainScan';
import { SCAN_STOPS, thermalColor } from '../../render/anatomy/detail/thermal';
import { ANATOMY } from '../../data/anatomy';
import { useStore } from '../store';
import styles from './brainscan.module.css';

/**
 * THE BRAIN SCAN INSET — a small live, turning picture of the brain in the top-right
 * corner, each region coloured by the engine's ACTIVITY INDEX through a thermal palette.
 *
 * It is an activity index, not a temperature, and nothing on the card is in degrees: the
 * caption says so in as many words. The picture itself is drawn by `BrainScan`
 * (src/render/scan), which owns a second small renderer on this card's own canvas so the
 * main viewer's post-processing chain is untouched.
 *
 * WHY SNAPSHOTS GO IN BY `useStore.subscribe` AND NOT THROUGH RENDER. The scan wants every
 * snapshot to interpolate between; React is given them at 10 Hz and would re-render the
 * card (and re-measure it) for no change in what it shows. The card therefore renders
 * once, and a store subscription feeds the renderer directly.
 *
 * THE "FURTHEST ABOVE REST" LINE under the legend is what lets a user track change: it names
 * the region whose activity index is highest above its own resting level (`rest` in the
 * brain atlas) right now, or says "steady" when none is more than 5 points above rest. The
 * selector returns a string, so the card re-renders only when the text itself changes.
 *
 * WHY THE SCAN LIVES ONLY WHILE THE CARD IS SHOWN. `ScanCard` is mounted when the brain is
 * selected or the card is pinned and unmounted otherwise, so the second WebGL context and
 * its geometry are released when nobody is looking at them rather than kept spinning
 * behind a hidden element.
 */

/** Samples of the thermal ramp in the colour bar; sixteen keeps the hue bands of the scan ramp from banding for a gradient. */
const BAR_STOPS = 16;

/** The bar, built once: a CSS gradient of sixteen samples of the very ramp the scan uses. */
const BAR_GRADIENT = (() => {
  const c = new THREE.Color();
  const stops: string[] = [];
  for (let i = 0; i < BAR_STOPS; i++) stops.push(thermalColor(i / (BAR_STOPS - 1), c, SCAN_STOPS).getStyle());
  return `linear-gradient(to right, ${stops.join(', ')})`;
})();

/** Points of activity index above rest below which the line says "steady". */
const STEADY_MARGIN = 0.05;

/**
 * WHY ONLY THE SCAN'S OWN REGIONS. The readout must name what the picture shows. The atlas
 * also holds nerves, vessels, membranes and magnified schematics (137 parts in all), and a
 * schematic's activity can sit above its own rest while the coloured scan, which maps only
 * `BRAIN_SCAN_IDS`, shows nothing there. Naming such a part would send the user looking for
 * a colour that is not on the card, so the readout reads the same level-1 set the scan draws.
 */
const BRAIN_PARTS = (ANATOMY.brain?.parts ?? []).filter((p) => BRAIN_SCAN_IDS.has(p.id));

function topChange(parts: Record<string, number> | undefined): string {
  if (!parts) return 'steady';
  let best = STEADY_MARGIN;
  let text = 'steady';
  for (const p of BRAIN_PARTS) {
    const v = parts['brain.' + p.id];
    if (v === undefined || v !== v) continue;
    if (v - p.rest > best) {
      best = v - p.rest;
      text = `\u25B2 ${p.label} ${Math.round(Math.max(0, Math.min(1, v)) * 100)} %`;
    }
  }
  return text;
}

function ScanCard({ viewer }: { viewer: Viewer }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const change = useStore((s) => topChange(s.snapshot?.anatomy?.parts));
  const pinned = useStore((s) => s.scanPinned);
  const togglePinned = useStore((s) => s.toggleScanPinned);
  const selected = useStore((s) => s.selectedOrgan);
  const setSelected = useStore((s) => s.setSelected);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scan = new BrainScan(canvas, viewer.geometryFactory);
    scan.reducedMotion = useStore.getState().reducedMotion;
    scan.setRunning(true);

    const size = () => {
      const r = canvas.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) scan.setSize(r.width, r.height);
    };
    size();
    const observer = new ResizeObserver(size);
    observer.observe(canvas);

    const current = useStore.getState().snapshot;
    if (current) scan.pushSnapshot(current);
    const unsubscribe = useStore.subscribe((s, prev) => {
      if (s.snapshot && s.snapshot !== prev.snapshot) scan.pushSnapshot(s.snapshot);
      if (s.reducedMotion !== prev.reducedMotion) scan.reducedMotion = s.reducedMotion;
    });

    return () => {
      unsubscribe();
      observer.disconnect();
      scan.setRunning(false);
      scan.dispose();
    };
  }, [viewer]);

  return (
    <aside className={styles.card} aria-label="Brain activity scan" data-scan data-stage-cover>
      <div className={styles.head}>
        <h2 className={styles.title}>Brain activity</h2>
        <button
          className={styles.pin}
          aria-pressed={pinned}
          title="Keep on screen"
          aria-label="Keep the brain scan on screen"
          onClick={() => togglePinned()}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M9 3h6l-1 6 3 3v2h-4v6l-1 1-1-1v-6H7v-2l3-3Z"
              fill={pinned ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        role="img"
        aria-label="Rotating brain, regions coloured by activity index"
        onClick={() => {
          if (selected !== 'brain') setSelected('brain');
        }}
      />
      <div className={styles.bar} style={{ background: BAR_GRADIENT }} aria-hidden="true" />
      <div className={styles.ticks} aria-hidden="true">
        {SCAN_LEGEND.map((l) => (
          <span key={l.label} className={styles.tick} style={{ left: `${l.t * 100}%` }}>
            {l.label}
          </span>
        ))}
      </div>
      <p className={styles.change} aria-live="polite" data-steady={change === 'steady'}>
        {change}
      </p>
      <p className={styles.caption}>activity index, not temperature</p>
    </aside>
  );
}

export function BrainScanInset({ viewerRef, ready }: { viewerRef: React.MutableRefObject<Viewer | null>; ready: boolean }) {
  const show = useStore((s) => s.selectedOrgan === 'brain' || s.scanPinned);
  const viewer = ready ? viewerRef.current : null;
  if (!show || !viewer) return null;
  return <ScanCard viewer={viewer} />;
}
