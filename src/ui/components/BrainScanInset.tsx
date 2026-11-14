import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Viewer } from '../../render/scene/Viewer';
import { BrainScan } from '../../render/scan/BrainScan';
import { thermalColor } from '../../render/anatomy/detail/thermal';
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
 * WHY THE SCAN LIVES ONLY WHILE THE CARD IS SHOWN. `ScanCard` is mounted when the brain is
 * selected or the card is pinned and unmounted otherwise, so the second WebGL context and
 * its geometry are released when nobody is looking at them rather than kept spinning
 * behind a hidden element.
 */

/** Samples of the thermal ramp in the colour bar; eight is smooth enough for a gradient. */
const BAR_STOPS = 8;

/** The bar, built once: a CSS gradient of eight samples of the very ramp the scan uses. */
const BAR_GRADIENT = (() => {
  const c = new THREE.Color();
  const stops: string[] = [];
  for (let i = 0; i < BAR_STOPS; i++) stops.push(thermalColor(i / (BAR_STOPS - 1), c).getStyle());
  return `linear-gradient(to right, ${stops.join(', ')})`;
})();

function ScanCard({ viewer }: { viewer: Viewer }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [legend, setLegend] = useState<{ low: string; high: string }>({ low: '', high: '' });
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
    const first = scan.legend[0];
    const last = scan.legend[scan.legend.length - 1];
    setLegend({ low: first?.label ?? '', high: last?.label ?? '' });

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
    <aside className={styles.card} aria-label="Brain activity scan" data-scan>
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
      <div className={styles.ends} aria-hidden="true">
        <span>{legend.low}</span>
        <span>{legend.high}</span>
      </div>
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
