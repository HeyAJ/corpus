import type { ReactNode } from 'react';
import type { ConditionTag as ConditionTagData, Severity } from '../../bridge/types';
import { Sparkline } from './Sparkline';
import { trendWord } from '../trends';
import styles from './components.module.css';

/**
 * HUD PRIMITIVES (spec 8.2).
 *
 * THE EM-DASH RULE. `MetricPill` renders an em-dash when its value is null or
 * non-finite, and never a zero or a placeholder number. That is not a styling
 * choice: a number the engine does not have must not be shown as a number the
 * engine has, because the user cannot tell the difference and would learn something
 * false with full confidence (spec 0.4, 0.6).
 */

export const EM_DASH = '—';

export function formatMetric(
  value: number | null | undefined,
  digits = 0,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH;
  return value.toFixed(digits);
}

export interface MetricPillProps {
  label?: string;
  value: number | null | undefined;
  digits?: number;
  unit?: string;
  /** Optional 0..1 fill shown as a bar along the chip's bottom edge. */
  fill?: number;
  /** Screen-reader text; falls back to `${label} ${value} ${unit}`. */
  ariaLabel?: string;
  onProvenance?: () => void;
  children?: ReactNode;
  /**
   * Key into the trend store. Supplying it draws a sixty-second sparkline AND adds
   * the direction in words to the chip's accessible name, because the line is a
   * decoration and the sentence is the content.
   */
  trendKey?: string;
  /** Smallest vertical span the sparkline should draw, in this metric's units. */
  trendMinSpan?: number;
}

export function MetricPill({
  label, value, digits = 0, unit, fill, ariaLabel, onProvenance, children, trendKey, trendMinSpan = 1,
}: MetricPillProps) {
  const text = formatMetric(value, digits);
  const trend = trendKey ? trendWord(trendKey, unit) : null;
  const base = ariaLabel ?? `${label ?? ''} ${text === EM_DASH ? 'not available' : text} ${unit ?? ''}`.trim();
  const spoken = trend ? `${base}, ${trend}` : base;
  return (
    <span
      className={`${styles.chip} ${fill !== undefined ? styles.chipFill : ''}`}
      style={fill !== undefined ? ({ ['--fill' as string]: `${Math.round(fill * 100)}%` }) : undefined}
      role="status"
      aria-label={spoken}
    >
      {label && <span className={styles.chipLabel}>{label}</span>}
      <span aria-hidden="true">{text}</span>
      {unit && <span className={styles.chipUnit} aria-hidden="true">{unit}</span>}
      {trendKey && text !== EM_DASH && (
        <Sparkline trendKey={trendKey} minSpan={trendMinSpan} />
      )}
      {children}
      {onProvenance && (
        <button className={styles.provenanceButton} onClick={onProvenance} aria-label={`Source for ${label ?? 'this value'}`}>
          ?
        </button>
      )}
    </span>
  );
}

export interface BloodPressurePillProps {
  systolic: number | null;
  diastolic: number | null;
}

/** `126 | 77`. Tabular figures keep the chip a constant width every heartbeat. */
export function BloodPressurePill({ systolic, diastolic }: BloodPressurePillProps) {
  const s = formatMetric(systolic, 0);
  const d = formatMetric(diastolic, 0);
  return (
    <span className={styles.chip} role="status" aria-label={`Blood pressure ${s} over ${d} millimetres of mercury`}>
      <span aria-hidden="true">{s}</span>
      <span className={styles.chipSeparator} aria-hidden="true">|</span>
      <span aria-hidden="true">{d}</span>
    </span>
  );
}

export function OrganChip({ name }: { name: string }) {
  return <span className={`${styles.pill} ${styles.organPill}`}>{name}</span>;
}

const SEVERITY_CLASS: Record<Severity, string> = {
  critical: styles.tagCritical,
  warn: styles.tagWarn,
  watch: styles.tagWatch,
};

// Colour is never the only signal for a condition (spec 10.6).
const SEVERITY_GLYPH: Record<Severity, string> = {
  critical: '◆', // filled diamond
  warn: '▲', // filled triangle
  watch: '●', // filled circle
};

const SEVERITY_WORD: Record<Severity, string> = {
  critical: 'critical',
  warn: 'warning',
  watch: 'watch',
};

export function ConditionTag({ tag }: { tag: ConditionTagData }) {
  return (
    <span
      className={`${styles.tag} ${SEVERITY_CLASS[tag.severity]}`}
      role="status"
      aria-label={`${SEVERITY_WORD[tag.severity]}: ${tag.label}. ${tag.detail}`}
      title={tag.detail}
    >
      <span className={styles.tagGlyph} aria-hidden="true">{SEVERITY_GLYPH[tag.severity]}</span>
      <span aria-hidden="true">{tag.label}</span>
    </span>
  );
}

export interface PhScaleProps {
  ph: number | null;
  /** Displayed range; gastric pH runs 0-8 in the reference. */
  min?: number;
  max?: number;
}

export function PhScale({ ph, min = 0, max = 8 }: PhScaleProps) {
  const known = ph !== null && Number.isFinite(ph);
  const fraction = known ? Math.max(0, Math.min(1, (ph - min) / (max - min))) : 0;
  return (
    <span className={styles.phChip} role="status" aria-label={known ? `Gastric pH ${ph.toFixed(1)}` : 'Gastric pH not available'}>
      <span className={styles.chipLabel} aria-hidden="true">pH</span>
      <span className={styles.phTrack} aria-hidden="true">
        {known && <span className={styles.phHandle} style={{ left: `${fraction * 100}%` }} />}
      </span>
      <span aria-hidden="true">{known ? ph.toFixed(ph < 10 ? 1 : 0) : EM_DASH}</span>
    </span>
  );
}

export interface SparklineChipProps {
  badge: string;
  series: { color: string; points: number[] }[];
  width?: number;
  height?: number;
  label: string;
}

/**
 * The dark multi-series chips from the reference HUD. Hand-rolled inline SVG
 * rather than Canvas2D: these update at snapshot rate, not frame rate, so the DOM
 * cost is irrelevant and SVG keeps them crisp at any DPR.
 */
export function SparklineChip({ badge, series, width = 96, height = 22, label }: SparklineChipProps) {
  return (
    <span className={styles.darkStrip} role="img" aria-label={label}>
      <span className={styles.darkStripBadge} aria-hidden="true">{badge}</span>
      <svg className={styles.sparkline} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        {series.map((s, i) => (
          <polyline
            key={i}
            fill="none"
            stroke={s.color}
            strokeWidth="1.4"
            strokeLinejoin="round"
            strokeLinecap="round"
            points={toPolyline(s.points, width, height)}
          />
        ))}
      </svg>
    </span>
  );
}

function toPolyline(points: number[], width: number, height: number): string {
  if (points.length === 0) return '';
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p < min) min = p;
    if (p > max) max = p;
  }
  const span = max - min || 1;
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const pad = 3;
  return points
    .map((p, i) => {
      const x = i * step;
      const y = height - pad - ((p - min) / span) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export function DotMatrix({ value, color, label }: { value: number; color: string; label: string }) {
  // 20 columns x 3 rows = 60 dots, filled column-major, so one column is 5 %.
  const columns = 20;
  const rows = 3;
  const filledColumns = Math.round(Math.max(0, Math.min(1, value)) * columns);
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const on = c < filledColumns;
      cells.push(
        <span
          key={`${r}-${c}`}
          className={`${styles.dot} ${on ? styles.dotOn : ''}`}
          style={on ? { background: color } : undefined}
        />,
      );
    }
  }
  return (
    <span className={styles.dotMatrix} role="img" aria-label={`${label} occupancy ${Math.round(value * 100)} per cent`}>
      {cells}
    </span>
  );
}
