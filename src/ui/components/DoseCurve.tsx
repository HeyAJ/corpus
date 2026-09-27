import { useEffect, useMemo, useRef, useState } from 'react';
import type { Prediction } from '../../sim/pharma/predict';
import styles from './components.module.css';

/**
 * PREDICTED PLASMA CURVE.
 *
 * Hand-rolled Canvas2D, like every other chart here. It redraws only when the
 * prediction changes, which while dragging the dose slider is at most once per
 * pointer event — cheap enough that it does not need the sweep treatment the
 * waveform strip uses.
 *
 * WHY THE PREVIOUS CURVE STAYS ON SCREEN. Dragging the slider redraws the curve, and
 * a curve that simply replaces itself tells you the new shape but not the change. A
 * ghost of the reference dose, held underneath in a lighter stroke, turns the control
 * into a comparison: this is what one times does, and this is what you are asking for.
 * That is the entire reason to draw a curve rather than print a number.
 *
 * The vertical axis is SHARED between the two curves and fixed by whichever is
 * taller, so a taller curve looks taller. Auto-scaling each curve to fill the box
 * would make every dose look identical, which is the single easiest way to build a
 * chart that lies.
 */

export interface DoseCurveProps {
  prediction: Prediction;
  /** The reference dose's curve, drawn underneath for comparison. */
  reference?: Prediction | null;
  /**
   * Fixed width in CSS pixels, or omitted to FILL THE CONTAINER. The fixed 420 px it
   * used to be drawn at was wider than a phone's drawer, so on a phone the chart ran
   * off the right edge and was clipped (2026-09-26). Omitted, the figure measures its
   * own box with a ResizeObserver and redraws at that width, so the same chart is
   * 330 px in a phone sheet and 700 px on a desktop, at full resolution on both.
   */
  width?: number;
  height: number;
  color: string;
  /** Accessible text equivalent; colour and shape are never the only signal. */
  label: string;
}

function niceTime(min: number): string {
  if (min >= 1440) return `${(min / 1440).toFixed(0)} d`;
  if (min >= 120) return `${(min / 60).toFixed(0)} h`;
  if (min >= 1) return `${min.toFixed(0)} min`;
  return `${(min * 60).toFixed(0)} s`;
}

export function DoseCurve({ prediction, reference, width: fixedWidth, height, color, label }: DoseCurveProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const figureRef = useRef<HTMLElement | null>(null);
  const [measured, setMeasured] = useState(0);
  const width = fixedWidth ?? measured;

  useEffect(() => {
    if (fixedWidth !== undefined) return;
    const el = figureRef.current;
    if (!el) return;
    // Whole pixels only: a sub-pixel change would redraw the canvas for nothing, and
    // an open drawer animating its height would otherwise do that every frame.
    const read = () => setMeasured(Math.floor(el.clientWidth));
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fixedWidth]);

  const scale = useMemo(() => {
    const yMax = Math.max(prediction.peak, reference?.peak ?? 0) * 1.12;
    const xMax = Math.max(
      prediction.points.length > 0 ? prediction.points[prediction.points.length - 1].t : 1,
      reference && reference.points.length > 0 ? reference.points[reference.points.length - 1].t : 1,
    );
    return { yMax: yMax > 0 ? yMax : 1, xMax: xMax > 0 ? xMax : 1 };
  }, [prediction, reference]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const padL = 2;
    const padR = 2;
    const padT = 4;
    const padB = 12;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const x = (t: number) => padL + (t / scale.xMax) * plotW;
    const y = (c: number) => padT + plotH - (c / scale.yMax) * plotH;

    // Baseline.
    ctx.strokeStyle = 'rgba(0,0,0,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, padT + plotH + 0.5);
    ctx.lineTo(padL + plotW, padT + plotH + 0.5);
    ctx.stroke();

    const drawCurve = (p: Prediction, stroke: string, fill: string | null, w: number) => {
      if (p.points.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(x(p.points[0].t), y(p.points[0].cp));
      for (const pt of p.points) ctx.lineTo(x(pt.t), y(pt.cp));
      if (fill) {
        ctx.save();
        ctx.lineTo(x(p.points[p.points.length - 1].t), y(0));
        ctx.lineTo(x(p.points[0].t), y(0));
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.restore();
        ctx.beginPath();
        ctx.moveTo(x(p.points[0].t), y(p.points[0].cp));
        for (const pt of p.points) ctx.lineTo(x(pt.t), y(pt.cp));
      }
      ctx.strokeStyle = stroke;
      ctx.lineWidth = w;
      ctx.lineJoin = 'round';
      ctx.stroke();
    };

    // The reference, underneath and dimmer: what one times would have done.
    if (reference && reference.points.length > 1) {
      ctx.save();
      ctx.setLineDash([3, 3]);
      drawCurve(reference, 'rgba(0,0,0,0.30)', null, 1);
      ctx.restore();
    }

    drawCurve(prediction, color, 'rgba(200, 67, 58, 0.13)', 1.75);

    // Peak marker, so the eye has somewhere to land.
    if (prediction.peak > 0) {
      const px = x(prediction.tmax_min);
      const py = y(prediction.peak);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px, padT + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Time axis: just the two ends and the peak. More would be clutter at this size.
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText('0', padL, padT + plotH + 2);
    ctx.textAlign = 'right';
    ctx.fillText(niceTime(scale.xMax), padL + plotW, padT + plotH + 2);
    if (prediction.peak > 0) {
      const px = x(prediction.tmax_min);
      if (px > padL + 26 && px < padL + plotW - 30) {
        ctx.textAlign = 'center';
        ctx.fillText(`peak ${niceTime(prediction.tmax_min)}`, px, padT + plotH + 2);
      }
    }
  }, [prediction, reference, width, height, color, scale]);

  return (
    <figure className={styles.doseCurveFigure} ref={figureRef}>
      <canvas ref={canvasRef} style={{ width: width > 0 ? width : '100%', height }} role="img" aria-label={label} />
      <figcaption className={styles.srOnly}>{label}</figcaption>
    </figure>
  );
}
