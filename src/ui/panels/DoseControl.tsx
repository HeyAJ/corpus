import { useMemo, useState } from 'react';
import routesFile from '../../data/routes.json';
import type { Drug } from '../../data/pharma-types';
import type { DoseBand, Route } from '../../bridge/types';
import {
  MAX_DOSE_DURATION_MIN,
  MAX_DOSE_MULTIPLIER,
  MIN_DOSE_DURATION_MIN,
  MIN_DOSE_MULTIPLIER,
  doseBandFor,
} from '../../bridge/types';
import { horizonFor, predict } from '../../sim/pharma/predict';
import { DoseCurve } from '../components/DoseCurve';
import styles from './dose.module.css';

/**
 * THE DOSE LEVER.
 *
 * The specification forbade a dose input field, and it was right to. A box you type
 * "0.1 mg/kg" into is a prescribing interface: the number that comes out of it is
 * transcribable onto a drug chart, it carries no context, and it reads as advice
 * whatever disclaimer sits underneath it.
 *
 * This is a different object. It cannot express an absolute dose at all. What it
 * expresses is a MULTIPLE OF A CITED REFERENCE — the labelled adult dose for this
 * drug by this route, with its source one tap away — and every state of the control
 * shows the reference it is relative to. "0.4x the labelled 100 mcg" is a simulation
 * parameter. "40 mcg" alone would be a dosing instruction, so the control never shows
 * the amount without showing what it is a fraction of.
 *
 * Three consequences of that design, all deliberate:
 *
 *   - A drug with no cited reference dose for a route gets no control for it. There
 *     is nothing to be a multiple of.
 *   - The 1x position is detented and labelled, so the cited value is always the
 *     easiest one to hit and is visibly the anchor rather than a midpoint.
 *   - The bound is enforced in the worker (bridge/types MIN/MAX_DOSE_MULTIPLIER).
 *     A limit that lives only in the component drawing the slider is not a limit.
 *
 * The scale is logarithmic because the interesting question is almost always "what
 * does an order of magnitude do", not "what does an extra 7% do".
 *
 * AND IT DRAWS THE CONSEQUENCE. A multiplier is an abstraction; a plasma curve is the
 * thing the multiplier does. The control predicts the curve this dose would produce —
 * using the engine's own pharmacokinetics, not a second implementation of them — and
 * keeps the reference dose's curve underneath it as a dashed ghost, so the control
 * reads as a comparison rather than as a number that changes.
 *
 * WHY THE STATE LIVES OUTSIDE IT (2026-09-26 rebuild). The Give button used to sit
 * inside each control, one per route, in the middle of a scrolling list; on a phone it
 * was usually scrolled out of reach, below the chart. The drawer now shows ONE route
 * at a time and pins a single Give button to the bottom of the sheet, under the
 * thumb, so the lever's value has to be readable by the sheet — hence `useDose`, the
 * state the drawer owns and hands down here.
 */

interface RouteSpecLite {
  label: string;
  short: string;
  kind: string;
  durationMin?: number;
  requiresIvAccess?: boolean;
}
const ROUTE_SPECS = (routesFile as unknown as { routes: Record<string, RouteSpecLite> }).routes;

export function routeLabel(route: Route): string {
  return ROUTE_SPECS[route]?.label ?? route;
}
export function routeShort(route: Route): string {
  return ROUTE_SPECS[route]?.short ?? route;
}
/** Whether the engine will refuse this route without an IV line (dosing.ts). */
export function routeNeedsIv(route: Route): boolean {
  return ROUTE_SPECS[route]?.requiresIvAccess === true;
}

/**
 * Mirror of engine.toMilligrams. Duplicated deliberately and kept tiny: the UI must
 * not import the engine, and tests/pharma/routes.test.ts pins the two together.
 */
function toMilligrams(amount: number, unit: string): number {
  switch (unit) {
    case 'mcg':
    case 'ug':
      return amount / 1000;
    case 'g':
      return amount * 1000;
    default:
      return amount;
  }
}

const BAND_TEXT: Record<DoseBand, string> = {
  'sub-reference': 'below the cited reference',
  reference: 'the cited reference dose',
  'above-reference': 'above the cited reference',
  'far-above-reference': 'far above any cited reference',
};

const BAND_CLASS: Record<DoseBand, string> = {
  'sub-reference': styles.bandLow,
  reference: styles.bandRef,
  'above-reference': styles.bandHigh,
  'far-above-reference': styles.bandExtreme,
};

/** Slider position 0..1 maps logarithmically onto [MIN, MAX], with 1x detented. */
const LOG_MIN = Math.log(MIN_DOSE_MULTIPLIER);
const LOG_MAX = Math.log(MAX_DOSE_MULTIPLIER);
const UNITY_POS = (0 - LOG_MIN) / (LOG_MAX - LOG_MIN);

function posToMultiplier(pos: number): number {
  // A detent at the reference: anything within a pixel or two of 1x snaps to exactly
  // 1x, so the cited dose is reachable without fighting the control.
  if (Math.abs(pos - UNITY_POS) < 0.015) return 1;
  return Math.exp(LOG_MIN + pos * (LOG_MAX - LOG_MIN));
}

function multiplierToPos(m: number): number {
  return (Math.log(m) - LOG_MIN) / (LOG_MAX - LOG_MIN);
}

/**
 * The quick steps under the lever. They are MULTIPLES OF THE CITED REFERENCE, like
 * every other value the lever can take, and each lies inside the worker's bound; they
 * exist because a thumb on a phone cannot land on "exactly half" by dragging, and
 * "what does half do, what does double do" is the comparison most people want.
 */
const QUICK_STEPS: { m: number; label: string }[] = [
  { m: 0.25, label: '¼×' },
  { m: 0.5, label: '½×' },
  { m: 1, label: '1×' },
  { m: 2, label: '2×' },
  { m: 4, label: '4×' },
];

/** Two significant figures, so the readout never implies precision it does not have. */
export function formatAmount(amount: number, unit: string): string {
  const abs = Math.abs(amount);
  const text =
    abs >= 100 ? amount.toFixed(0)
      : abs >= 10 ? amount.toFixed(1)
        : abs >= 1 ? amount.toFixed(2)
          : amount.toPrecision(2);
  // Strip a trailing zero pair so "40.00 mcg" reads as "40 mcg".
  return `${text.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1')} ${unit}`;
}

export function formatMultiplier(m: number): string {
  if (m >= 10) return '10×';
  if (m >= 1) return `${m.toFixed(m < 3 ? 2 : 1).replace(/\.?0+$/, '')}×`;
  return `${m.toPrecision(2).replace(/0+$/, '').replace(/\.$/, '')}×`;
}

/** Whether a route is given over a set time, so the lever grows a duration stepper. */
export function isTimedRoute(route: Route): boolean {
  return route === 'IV_DRIP';
}

export interface DoseState {
  pos: number;
  setPos: (p: number) => void;
  multiplier: number;
  duration: number;
  setDuration: (d: number) => void;
}

/**
 * The lever's state, owned by whoever pins the Give button. `key` it on the preset so
 * choosing another route starts again at that route's 1x rather than carrying a 4x
 * across from a route whose reference was a different size.
 */
export function useDose(preset: Drug['presetDoses'][number]): DoseState {
  const [pos, setPos] = useState(UNITY_POS);
  const [duration, setDuration] = useState(preset.durationMin ?? 60);
  const multiplier = useMemo(() => posToMultiplier(pos), [pos]);
  return { pos, setPos, multiplier, duration, setDuration };
}

export interface DoseControlProps {
  drug: Drug;
  route: Route;
  preset: Drug['presetDoses'][number];
  presetSource: string | undefined;
  disabled: boolean;
  dose: DoseState;
}

export function DoseControl({ drug, route, preset, presetSource, disabled, dose }: DoseControlProps) {
  const { pos, setPos, multiplier, duration, setDuration } = dose;
  const timed = isTimedRoute(route);
  const band = doseBandFor(multiplier);
  const amount = preset.amount * multiplier;

  const id = `dose-${drug.id}-${route}-${preset.amount}`;

  // Both curves share a window, so the comparison is honest. The infusion duration
  // feeds both, so changing it reshapes the ghost as well as the live curve.
  const runFor = timed ? duration : undefined;
  const horizon = useMemo(() => horizonFor(drug, route, runFor), [drug, route, runFor]);
  const mg = toMilligrams(amount, preset.unit);
  const refMg = toMilligrams(preset.amount, preset.unit);
  const curve = useMemo(() => predict(drug, route, mg, horizon, runFor), [drug, route, mg, horizon, runFor]);
  const refCurve = useMemo(() => predict(drug, route, refMg, horizon, runFor), [drug, route, refMg, horizon, runFor]);

  // The filled part of the track, as a CSS variable the stylesheet paints with a
  // gradient: native range inputs have no cross-browser "fill up to the thumb".
  const fill = `${(pos * 100).toFixed(2)}%`;

  const stepDuration = (delta: number) =>
    setDuration(Math.max(MIN_DOSE_DURATION_MIN, Math.min(MAX_DOSE_DURATION_MIN, duration + delta)));

  return (
    <div className={styles.control}>
      {/* The readout first and large: what you would give, and what it is relative to. */}
      <div className={styles.readout}>
        <span className={styles.amount}>{formatAmount(amount, preset.unit)}</span>
        <span className={styles.multiplier}>{formatMultiplier(multiplier)} of {preset.label}</span>
      </div>
      {/* Colour is never the only signal: the band is always spelled out. */}
      <span className={`${styles.band} ${BAND_CLASS[band]}`}>{BAND_TEXT[band]}</span>

      <div className={styles.sliderWrap}>
        <input
          id={id}
          className={styles.slider}
          style={{ ['--fill' as string]: fill }}
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={pos}
          disabled={disabled}
          onChange={(e) => setPos(Number(e.target.value))}
          aria-label={`Simulated dose of ${drug.displayName} by ${routeLabel(route)}, as a multiple of the cited reference dose of ${preset.label}`}
          aria-valuetext={`${formatMultiplier(multiplier)} of the reference, ${formatAmount(amount, preset.unit)}, ${BAND_TEXT[band]}`}
        />
        {/* The anchor, drawn on the track so the cited dose is visibly the origin. Hidden
            while the thumb sits on it: a tick painted over the thumb read as a glitch. */}
        {multiplier !== 1 && <span className={styles.detent} style={{ left: `${UNITY_POS * 100}%`, ['--p' as string]: UNITY_POS }} aria-hidden="true" />}
      </div>
      <div className={styles.ends} aria-hidden="true">
        <span>{formatMultiplier(MIN_DOSE_MULTIPLIER)}</span>
        <span className={styles.endRef} style={{ left: `${UNITY_POS * 100}%`, ['--p' as string]: UNITY_POS }}>reference</span>
        <span>{formatMultiplier(MAX_DOSE_MULTIPLIER)}</span>
      </div>

      <div className={styles.steps} role="group" aria-label="Quick multiples of the reference dose">
        {QUICK_STEPS.map((q) => (
          <button
            key={q.m}
            className={`${styles.step} ${Math.abs(multiplier - q.m) < 1e-6 ? styles.stepOn : ''}`}
            disabled={disabled}
            onClick={() => setPos(q.m === 1 ? UNITY_POS : multiplierToPos(q.m))}
            aria-pressed={Math.abs(multiplier - q.m) < 1e-6}
          >
            {q.label}
          </button>
        ))}
      </div>

      {timed && (
        <div className={styles.durationRow}>
          <span className={styles.durationLabel}>Run over</span>
          <div className={styles.stepper}>
            <button onClick={() => stepDuration(-5)} disabled={disabled || duration <= MIN_DOSE_DURATION_MIN} aria-label="Five minutes shorter">
              {'−'}
            </button>
            <span className={styles.durationValue} aria-live="polite">{duration} min</span>
            <button onClick={() => stepDuration(5)} disabled={disabled || duration >= MAX_DOSE_DURATION_MIN} aria-label="Five minutes longer">
              +
            </button>
          </div>
          <span className={styles.rate}>{formatAmount(amount / Math.max(1, duration), `${preset.unit}/min`)}</span>
        </div>
      )}

      {curve.reason && <p className={styles.curveReason}>{curve.reason}</p>}

      {curve.points.length > 1 && (
        <div className={styles.curveCard}>
          <div className={styles.curveHead}>
            <span>Predicted plasma level</span>
            {multiplier !== 1 && (
              <span className={styles.curveKey}>
                <i className={styles.keyGhost} aria-hidden="true" /> reference
              </span>
            )}
          </div>
          <DoseCurve
            prediction={curve}
            reference={multiplier === 1 ? null : refCurve}
            height={140}
            color="#c8433a"
            label={
              `Predicted plasma concentration for ${formatAmount(amount, preset.unit)} of ${drug.displayName} ` +
              `by ${routeLabel(route)}: peaks at about ${curve.peak.toPrecision(2)} mg/L ` +
              `${curve.tmax_min < 1 ? 'immediately' : `after about ${curve.tmax_min.toFixed(0)} minutes`}` +
              `${multiplier === 1 ? '' : `, against ${refCurve.peak.toPrecision(2)} mg/L for the reference dose`}.`
            }
          />
          <p className={styles.curveNote}>
            {curve.approximate
              ? 'Predicted for a resting body with an empty stomach. An oral curve really does depend on what is already in the gut, and this preview cannot see that.'
              : 'Predicted for a resting body, this dose alone. Clearance changes with perfusion, so a shocked body will not follow it.'}
          </p>
        </div>
      )}

      {presetSource && (
        <details className={styles.provenance}>
          <summary>Where {preset.label} comes from</summary>
          <p>{presetSource}</p>
        </details>
      )}
    </div>
  );
}
