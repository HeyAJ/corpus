import type { SimSnapshot } from '../bridge/types';

/**
 * ROLLING HISTORY FOR THE HUD.
 *
 * A vital sign without its recent history is barely a vital sign. "Heart rate 118"
 * and "heart rate 118, up from 62 forty seconds ago" are different pieces of
 * information, and only the second one tells you something is happening. Every
 * bedside monitor ever built shows the trend next to the number, and the reason is
 * that clinicians read the direction before they read the value.
 *
 * DELIBERATELY OUTSIDE ZUSTAND. These buffers are mutated twenty times a second. Put
 * them in reactive state and every subscriber re-renders on every sample, which for a
 * HUD of thirty chips is thirty renders a tick to move a few pixels. They live here
 * as plain typed arrays, and the components that draw them already re-render on the
 * snapshot that filled them.
 *
 * FIXED CAPACITY, WRITTEN AS A RING. No allocation after startup and no unbounded
 * growth over a long session, which matters because a session can run for simulated
 * days at a high time scale.
 */

/** Sixty seconds at 20 Hz snapshots, decimated to four samples a second. */
const CAPACITY = 240;
const SAMPLE_INTERVAL_S = 0.25;

export interface TrendSeries {
  values: Float32Array;
  /** Index one past the newest sample. */
  head: number;
  count: number;
  min: number;
  max: number;
}

const series = new Map<string, TrendSeries>();
let lastSampleT = -Infinity;

function seriesFor(key: string): TrendSeries {
  let s = series.get(key);
  if (!s) {
    s = { values: new Float32Array(CAPACITY), head: 0, count: 0, min: Infinity, max: -Infinity };
    series.set(key, s);
  }
  return s;
}

function push(key: string, value: number | null | undefined): void {
  if (value === null || value === undefined || !Number.isFinite(value)) return;
  const s = seriesFor(key);
  s.values[s.head] = value;
  s.head = (s.head + 1) % CAPACITY;
  if (s.count < CAPACITY) s.count++;

  // Recomputed over the window rather than tracked incrementally, because a value
  // leaving the ring can be the one that was setting the bound. 240 floats is
  // nothing; a stale axis that silently flattens a trace is not.
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < s.count; i++) {
    const v = s.values[(s.head - 1 - i + CAPACITY * 2) % CAPACITY];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  s.min = min;
  s.max = max;
}

/**
 * The metrics worth a trend. Not everything: a sparkline on a value that never moves
 * is noise, and a HUD where everything is decorated is a HUD where nothing stands out.
 */
export function recordTrends(s: SimSnapshot): void {
  // Sample on SIMULATED time, so a trend at 60x time scale covers sixty simulated
  // seconds rather than sixty wall-clock ones. The axis has to mean the same thing
  // at every speed or the shape is a lie about how fast something happened.
  if (s.t - lastSampleT < SAMPLE_INTERVAL_S) {
    // A reset or a scrub backwards: start the window again rather than drawing a
    // line across the discontinuity.
    if (s.t < lastSampleT) clearTrends();
    else return;
  }
  lastSampleT = s.t;

  push('hr', s.cardio.heartRateDisplay_bpm);
  push('map', s.cardio.map_mmHg);
  push('systolic', s.cardio.systolic_mmHg);
  push('diastolic', s.cardio.diastolic_mmHg);
  push('co', s.cardio.cardiacOutput_L_per_min);
  push('sv', s.cardio.strokeVolume_mL);
  push('ef', s.cardio.ejectionFraction);
  push('edv', s.cardio.edv_mL);
  push('cvp', s.cardio.centralVenousPressure_mmHg);
  push('cpp', s.cardio.coronaryPerfusionPressure_mmHg);
  push('bloodVolume', s.cardio.bloodVolume_mL);

  push('spo2', s.resp.spo2);
  push('rr', s.resp.rate_per_min);
  push('etco2', s.resp.etco2_mmHg);
  push('paco2', s.resp.paco2_mmHg);
  push('pao2', s.resp.pao2_mmHg);
  push('tidalVolume', s.resp.tidalVolume_mL);
  push('minuteVentilation', s.resp.minuteVentilation_L_per_min);

  push('gfr', s.renal.gfr_mL_per_min);
  push('urine', s.renal.urineOutput_mL_per_min);
  push('bladder', s.renal.bladderVolume_mL);
  push('creatinine', s.renal.creatinine_mg_per_dL);

  push('glucose', s.metabolic.glucose_mg_per_dL);
  push('insulin', s.metabolic.insulin_uU_per_mL);
  push('temp', s.metabolic.coreTemp_C);

  push('k', s.chem.k_mEq_per_L);
  push('na', s.chem.na_mEq_per_L);
  push('ph', s.chem.ph);
  push('lactate', s.chem.lactate_mmol_per_L);
  push('hct', s.chem.haematocrit);

  // One series per hormone, keyed by id, so the endocrine panel gets a sparkline for
  // free however many hormones the data file grows to. Keyed rather than enumerated
  // for exactly that reason: adding a hormone must not require editing this file.
  for (const h of s.endocrine.hormones) push(`hormone.${h.id}`, h.level);
  push('stressAxis', s.endocrine.stressAxis);
}

export function clearTrends(): void {
  series.clear();
  lastSampleT = -Infinity;
}

export function trendFor(key: string): TrendSeries | null {
  const s = series.get(key);
  return s && s.count >= 2 ? s : null;
}

/** Oldest-first copy of the window, for drawing. Returns how many were written. */
export function readTrend(key: string, out: Float32Array): number {
  const s = series.get(key);
  if (!s || s.count < 2) return 0;
  const n = Math.min(s.count, out.length);
  for (let i = 0; i < n; i++) {
    out[i] = s.values[(s.head - n + i + CAPACITY * 2) % CAPACITY];
  }
  return n;
}

/**
 * Direction over the window, as a word. Colour and slope are never the only signal:
 * this is what the screen reader is told, and what the tooltip says.
 */
export function trendWord(key: string, unit?: string): string | null {
  const s = trendFor(key);
  if (!s) return null;
  const n = Math.min(s.count, CAPACITY);
  const newest = s.values[(s.head - 1 + CAPACITY) % CAPACITY];
  const oldest = s.values[(s.head - n + CAPACITY * 2) % CAPACITY];
  const delta = newest - oldest;
  const span = Math.max(1e-9, s.max - s.min);
  const seconds = Math.round(n * SAMPLE_INTERVAL_S);

  if (Math.abs(delta) < span * 0.1) return `steady over the last ${seconds} s`;
  const dir = delta > 0 ? 'rising' : 'falling';
  const mag = Math.abs(delta);
  const figure = mag >= 10 ? mag.toFixed(0) : mag >= 1 ? mag.toFixed(1) : mag.toPrecision(2);
  return `${dir} ${figure}${unit ? ` ${unit}` : ''} over the last ${seconds} s`;
}
