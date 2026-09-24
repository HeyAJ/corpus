import { useEffect, useRef } from 'react';
import { readTrend, trendFor } from '../trends';
import styles from './components.module.css';

/**
 * A sixty-second trend, drawn small enough to sit inside a metric chip.
 *
 * TWO RULES, both about not lying at this size.
 *
 * 1. The vertical axis spans the window's own minimum and maximum, with a floor on
 *    how small that span may be. Without the floor, a heart rate that wandered
 *    between 71 and 72 would be drawn as a dramatic mountain range, because
 *    autoscaling turns any variation into full-scale variation. The floor is
 *    expressed in the metric's own units and passed in by the caller, who is the only
 *    one who knows what "a meaningful change" means for it.
 *
 * 2. It never renders at all with fewer than two samples. A single point drawn as a
 *    flat line reads as "steady", which is a claim, and at that moment the truth is
 *    "not known yet".
 *
 * The shape is decoration in the accessibility sense — `trendWord` in trends.ts says
 * the same thing in words, and that is what the chip's aria-label carries.
 */

export interface SparklineProps {
  /** Key into the trend store. */
  trendKey: string;
  width?: number;
  height?: number;
  /** Smallest vertical span worth drawing, in the metric's units. */
  minSpan: number;
  color?: string;
}

export function Sparkline({ trendKey, width = 44, height = 14, minSpan, color }: SparklineProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scratch = useRef(new Float32Array(240));
  const series = trendFor(trendKey);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const n = readTrend(trendKey, scratch.current);
    if (n < 2 || !series) return;

    const mid = (series.min + series.max) / 2;
    const span = Math.max(series.max - series.min, minSpan);
    const lo = mid - span / 2;

    const pad = 1.5;
    const plotH = height - pad * 2;
    const x = (i: number) => (i / (n - 1)) * width;
    const y = (v: number) => pad + plotH - ((v - lo) / span) * plotH;

    ctx.beginPath();
    ctx.moveTo(x(0), y(scratch.current[0]));
    for (let i = 1; i < n; i++) ctx.lineTo(x(i), y(scratch.current[i]));
    ctx.strokeStyle = color ?? 'rgba(20, 20, 20, 0.45)';
    ctx.lineWidth = 1.25;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // A dot on the newest sample: the eye needs to know which end is now.
    ctx.fillStyle = color ?? 'rgba(20, 20, 20, 0.7)';
    ctx.beginPath();
    ctx.arc(x(n - 1), y(scratch.current[n - 1]), 1.5, 0, Math.PI * 2);
    ctx.fill();
  }, [trendKey, width, height, minSpan, color, series]);

  if (!series) return null;

  return (
    <canvas
      ref={canvasRef}
      className={styles.sparkline}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}
