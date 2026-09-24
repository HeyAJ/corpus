import { useEffect, useRef } from 'react';
import type { WaveformRing } from '../../bridge/ring';
import type { WaveformChannel } from '../../bridge/types';
import styles from './components.module.css';

/**
 * ECG / EEG / pressure strip (spec 8.4).
 *
 * Hand-rolled Canvas2D. No chart library — a chart library redraws the whole plot
 * on every data change, and this is a 60 fps component reading a 250 Hz ring.
 *
 * SWEEP RENDERING. The trace is drawn left to right with a ~20 px erase band ahead
 * of the write head, which is the classic bedside-monitor look and, more usefully,
 * means each frame only touches the columns that actually changed. A full-canvas
 * redraw at 60 fps would show up in the frame budget immediately.
 *
 * CALIBRATION. 25 mm/s paper speed, so the trace has clinically familiar
 * proportions: at 60 bpm one R-R interval is 25 mm wide. `pxPerMm` converts that to
 * the strip's own width.
 */

const PAPER_SPEED_MM_PER_S = 25;
const ERASE_BAND_PX = 18;

export interface WaveformStripProps {
  ring: WaveformRing | null;
  channel: WaveformChannel;
  channelIndex: number;
  /** Vertical scale: data units that fill half the strip height. */
  range: number;
  color: string;
  background?: string;
  width: number;
  height: number;
  /** Accessible text equivalent (spec 10.6). */
  label: string;
  className?: string;
  /** Draw a 1 mV calibration pulse at the left edge, as a real monitor does. */
  calibration?: boolean;
}

export function WaveformStrip({
  ring,
  channel,
  channelIndex,
  range,
  color,
  background = 'transparent',
  width,
  height,
  label,
  className,
  calibration = false,
}: WaveformStripProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const readIndex = useRef(0);
  const writeX = useRef(0);
  const lastY = useRef<number | null>(null);
  const scratch = useRef(new Float32Array(2048));
  const rafRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (background !== 'transparent') {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
    }
    writeX.current = 0;
    lastY.current = null;
    readIndex.current = ring ? ring.writeIndex() : 0;

    // pxPerSample from the paper-speed calibration. The strip is sized in CSS px,
    // and we treat the full width as `width / pxPerMm` millimetres of paper.
    const pxPerMm = width / 200; // 200 mm of paper across the strip
    const pxPerSecond = PAPER_SPEED_MM_PER_S * pxPerMm;
    const sampleRate = ring?.rateHz ?? 250;
    const pxPerSample = pxPerSecond / sampleRate;

    const midY = height / 2;

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      if (!ring) return;

      const { count, next } = ring.readSince(channelIndex, readIndex.current, scratch.current);
      readIndex.current = next;
      if (count === 0) return;

      ctx.lineWidth = 1.5;
      ctx.strokeStyle = color;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      for (let i = 0; i < count; i++) {
        const v = scratch.current[i];
        const y = midY - (v / range) * (height * 0.42);
        const x0 = writeX.current;
        const x1 = x0 + pxPerSample;

        // Erase the band ahead of the write head, plus a short alpha-fade trail so
        // the leading edge does not look like a hard cut.
        ctx.save();
        ctx.globalCompositeOperation = background === 'transparent' ? 'destination-out' : 'source-over';
        ctx.fillStyle = background === 'transparent' ? 'rgba(0,0,0,1)' : background;
        const eraseStart = x1;
        if (eraseStart + ERASE_BAND_PX <= width) {
          ctx.fillRect(eraseStart, 0, ERASE_BAND_PX, height);
        } else {
          ctx.fillRect(eraseStart, 0, width - eraseStart, height);
          ctx.fillRect(0, 0, ERASE_BAND_PX - (width - eraseStart), height);
        }
        ctx.restore();

        if (lastY.current !== null && x1 > x0) {
          ctx.beginPath();
          ctx.moveTo(x0, lastY.current);
          ctx.lineTo(x1, y);
          ctx.stroke();
        }

        lastY.current = y;
        writeX.current = x1;
        if (writeX.current >= width) {
          writeX.current -= width;
          lastY.current = null;
        }
      }

      if (calibration) {
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        ctx.moveTo(2, midY);
        ctx.lineTo(2, midY - height * 0.3);
        ctx.lineTo(6, midY - height * 0.3);
        ctx.lineTo(6, midY);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [ring, channelIndex, range, color, background, width, height, calibration, channel]);

  return (
    <div className={`${styles.strip} ${className ?? ''}`} style={{ width, height }}>
      <canvas ref={canvasRef} style={{ width, height, display: 'block' }} aria-hidden="true" />
      <span className="visually-hidden">{label}</span>
    </div>
  );
}
