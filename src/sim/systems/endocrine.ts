import hormonesFile from '../../data/hormones.json';
import type { SimState } from '../core/state';
import { addEffect, prevEffect, setEffectSource } from '../core/effects';
import { referenceBloodVolume } from '../core/body';
import { P } from '../core/constants';

/**
 * ENDOCRINE SYSTEM.
 *
 * Six hormones, each a first-order compartment with a secretion rate that is a
 * function of state the engine already computes, and an effect vector onto the same
 * bus every drug uses.
 *
 * WHY HORMONES SHARE THE DRUG EFFECT BUS. Adrenaline the infusion and adrenaline the
 * adrenal output should reach `cardio.contractility` by the same path, or the model
 * has two adrenalines. Routing hormones through `addEffect` means a drug and a
 * hormone can oppose each other without either knowing the other exists — which is
 * what a beta-blocker and a stress response actually do.
 *
 * WHY THE FEEDBACK IS THE POINT. A hormone with a fixed level is a constant, and a
 * constant belongs in physiology.json. What earns a subsystem is the loop: potassium
 * rises, aldosterone rises, potassium is excreted, aldosterone falls. Every driver
 * below reads live state, so every hormone here is closing a loop rather than
 * reporting a number.
 *
 * TIMESCALES SPAN FOUR ORDERS OF MAGNITUDE, deliberately. Glucagon has a six-minute
 * half-life and thyroxine has seven days. Both are integrated by the same code at the
 * same 100 Hz tick, and the seven-day one simply moves imperceptibly — which is the
 * honest representation, and is why changing thyroid state in this model does nothing
 * you can see in a single session.
 */

interface HormoneDriver {
  signal: string;
  gain: number;
}

interface HormoneEffect {
  target: string;
  gain: number;
  /**
   * Act only on the part of the activity that is ABOVE baseline. For an effect that is
   * a suppression by excess (cortisol on inflammation) a level below baseline is not
   * the opposite stimulus: the evening cortisol trough does not inflame anyone. Without
   * this flag the circadian dip was an inflammatory drive every afternoon.
   */
  aboveBaselineOnly?: boolean;
  note: string;
}

export interface HormoneDef {
  id: string;
  label: string;
  gland: string;
  unit: string;
  baseline: number;
  refLow: number;
  refHigh: number;
  halfLife_min: number;
  ec50: number;
  hill: number;
  circadianAmplitude?: number;
  circadianPeakHour?: number;
  drivers: HormoneDriver[];
  effects: HormoneEffect[];
  source: string;
  confidence: string;
  note: string;
}

interface HormonesFile {
  version: number;
  sources: Record<string, { label: string; url: string }>;
  hormones: HormoneDef[];
}

export const HORMONES = (hormonesFile as unknown as HormonesFile).hormones;
export const HORMONE_BY_ID = new Map(HORMONES.map((h) => [h.id, h]));

/** Simulated seconds in a day, for the circadian terms. */
const DAY_S = 24 * 60 * 60;

export function stepEndocrine(s: SimState, dt: number): void {
  const e = s.endocrine;

  // Wall-clock hour of the simulated day. Starts at 08:00 so a fresh body begins at
  // the cortisol peak, which is where a morning blood test would find it.
  e.clockHour = (8 + ((s.t % DAY_S) / 3600)) % 24;

  // --- the stress axis -----------------------------------------------------
  // Hypothalamic-pituitary-adrenal drive. Slow by construction: cortisol answers a
  // stressor over tens of minutes, not seconds, and a model that let it respond in
  // one tick would make every transient into an endocrine event.
  const hypotension = Math.max(0, (70 - s.cardio.map) / 40);
  const hypoxia = Math.max(0, (0.92 - s.resp.spo2) / 0.2);
  const hypoglycaemia = Math.max(0, (70 - s.metabolic.G) / 40);
  // PSYCHOLOGICAL drive on the HPA axis, from affect.ts (fright, stress, depression) and
  // pain. It reaches here through the bus, read from the completed previous tick because
  // affect runs before endocrine. This was the missing line the affect.ts comment named:
  // psychological stress wrote `neuro.stressAxis` and nothing read it, so a month of
  // stress produced no cortisol. Now it drives the same axis a haemorrhage does.
  const psychological = Math.max(0, prevEffect(s, 'neuro.stressAxis'));
  const target = Math.min(1, hypotension + hypoxia + hypoglycaemia + psychological);
  e.stressAxis += ((target - e.stressAxis) * dt) / 600;

  // --- each hormone --------------------------------------------------------
  for (const def of HORMONES) {
    let h = e.hormones[def.id];
    if (!h) {
      // Seeded here rather than in createInitialState, so the baseline lives in one
      // place: the data file that also carries its source.
      h = { level: periodicSteadyLevel(def, e.clockHour), secretion: 0, activity: 0 };
      e.hormones[def.id] = h;
    }

    const k = Math.LN2 / (def.halfLife_min * 60);

    // Basal secretion is whatever keeps the baseline at steady state. Solving for it
    // rather than storing it means the baseline and the half-life cannot disagree.
    let secretion = def.baseline * k;

    for (const d of def.drivers) {
      secretion += def.baseline * k * d.gain * driverValue(s, d.signal);
    }

    if (def.circadianAmplitude) {
      const peak = def.circadianPeakHour ?? 8;
      const phase = ((e.clockHour - peak) / 24) * 2 * Math.PI;
      secretion *= 1 + def.circadianAmplitude * Math.cos(phase);
    }

    secretion = Math.max(0, secretion);
    h.secretion = secretion * 60;

    // First-order clearance. The same integrator for a six-minute hormone and a
    // seven-day one; only the rate constant differs.
    h.level += (secretion - k * h.level) * dt;
    h.level = Math.max(0, h.level);

    // A DRUG THAT IS THIS HORMONE AND HAS NO RECEPTOR OF ITS OWN (levothyroxine) adds to
    // the effective level here. Its pharmacokinetics already govern its rise and fall in
    // `s.endocrine.exogenous[id]` (set by the engine from the drug's plasma
    // concentration), so it is ADDED to the secreted pool for the activity and the
    // effects without being integrated again. Hormone drugs that bind their own receptors
    // (vasopressin, hydrocortisone, glucagon) are deliberately NOT in this map - they act
    // through those receptors, and adding them here as well counted their effects twice.
    // They reach only the measured level (`exogenousMeasured`, read by the snapshot).
    const exo = s.endocrine.exogenous[def.id] ?? 0;
    const effectiveLevel = h.level + exo;

    // Receptor-level activity: a Hill transform of concentration. This is what the
    // effects scale on, NOT the raw level, because a hormone at ten times its
    // reference does not produce ten times its effect — it saturates, like everything
    // else that acts through a receptor.
    const x = Math.pow(Math.max(0, effectiveLevel), def.hill);
    const e50 = Math.pow(def.ec50, def.hill);
    h.activity = x / (x + e50);

    // Relative to the activity the baseline produces, so a hormone sitting at its
    // own baseline contributes ZERO to the effect bus. Without this every effect
    // would be double-counted against physiology that is already calibrated to
    // include normal hormone tone.
    const baseX = Math.pow(def.baseline, def.hill);
    const baseActivity = baseX / (baseX + e50);
    const delta = h.activity - baseActivity;

    // Attributed per hormone, so the impact panel can say "cortisol +12 %" rather than
    // an anonymous "body". Display-only; the sum on the bus is unchanged.
    setEffectSource(`hormone:${def.id}`);
    for (const fx of def.effects) {
      addEffect(s.effects, fx.target, fx.gain * (fx.aboveBaselineOnly ? Math.max(0, delta) : delta));
    }
  }
}

/**
 * Where a circadian hormone sits at a given clock hour once the rhythm is established.
 *
 * Secretion is `baseline·k·(1 + A·cos(ω(t − peak)))` and clearance is first-order at
 * rate k, so the level is a low-pass-filtered copy of the secretion rhythm. Its periodic
 * steady state is exact:
 *
 *   level = baseline · (1 + A · k/√(k² + ω²) · cos(ω(t − peak) − atan(ω/k)))
 *
 * smaller than the secretion swing and lagging it. For cortisol (half-life 80 min) that
 * is 17.3 µg/dL at 08:00, which is exactly where a 24 h run arrives on its own. The body
 * used to START at the daily mean, 12, and spent its first three hours climbing to the
 * morning peak - a startup transient every session opened with, the same defect the
 * cardiovascular warm-up (engine.ts, createRestingState) exists to remove. A hormone with
 * no rhythm returns its baseline.
 */
export function periodicSteadyLevel(def: HormoneDef, clockHour: number): number {
  const A = def.circadianAmplitude ?? 0;
  if (!A) return def.baseline;
  const k = Math.LN2 / (def.halfLife_min / 60); // per hour
  const omega = (2 * Math.PI) / 24; // per hour
  const peak = def.circadianPeakHour ?? 8;
  const gain = k / Math.sqrt(k * k + omega * omega);
  const lag = Math.atan(omega / k);
  return def.baseline * (1 + A * gain * Math.cos(omega * (clockHour - peak) - lag));
}

/**
 * The live signals hormones are allowed to read.
 *
 * Deliberately a closed list. A driver naming something not here is a data error
 * rather than a silent zero, because a hormone whose feedback loop quietly does
 * nothing is worse than one that is absent — it looks modelled.
 */
function driverValue(s: SimState, signal: string): number {
  switch (signal) {
    case 'stressAxis':
      return s.endocrine.stressAxis;

    case 'reninDrive':
      // Renal perfusion below the autoregulatory plateau, plus direct beta-1 drive.
      return Math.max(0, (90 - s.cardio.map) / 50);

    case 'serumPotassium':
      // Measured from the model's own resting potassium (4.2), not a round 4.0: against
      // 4.0 the driver sat at +0.1 in a resting body, raised aldosterone secretion 12 %
      // and held the hormone above the baseline its basal secretion is solved for - the
      // same zero-at-rest rule the osmotic limb of ADH follows below.
      return Math.max(0, (s.chem.k - P('blood.k_mEq_per_L')) / 2.0);

    case 'plasmaOsmolality': {
      // Sodium dominates measured osmolality, and the ADH response to it is steep:
      // a 1% rise is a substantial stimulus.
      //
      // MEASURED FROM THIS MODEL'S OWN RESTING OSMOLALITY, not from a textbook 285. The
      // formula below gives 2 x 142 + 92/18 + 5 = 294 for the resting body, so against
      // 285 the driver sat at +0.9 at rest and quadrupled basal secretion: ADH climbed
      // from its 2.5 pg/mL baseline to about 9 within the first hour of every run, and
      // held the kidney and the vessels in a mild antidiuretic, vasoconstricted state
      // that no one had asked for. The baseline secretion is solved for the baseline
      // level (above), so the osmotic drive has to be zero at rest for the two to agree -
      // the same reasoning that references the CO2 reactivity of cerebral flow to the
      // model's own resting PaCO2.
      //
      // AND IT GOES BOTH WAYS. A dilute plasma switches ADH off: resting osmolality sits
      // above the osmotic threshold, which is why basal ADH is detectable at all, and
      // drinking water pulls osmolality below it. Floored at zero (as it used to be) the
      // driver could raise ADH but never lower it, so a litre of water left ADH exactly at
      // baseline and the kidney had no signal to excrete it (round-2 tester, 2026-09-25).
      // Secretion itself is floored at zero below, which is where suppression bottoms out.
      const osm = 2 * s.chem.na + s.metabolic.G / 18 + 5;
      const restingOsm = 2 * P('blood.na_mEq_per_L') + P('blood.glucose_mg_per_dL') / 18 + 5;
      return (osm - restingOsm) / 10;
    }

    case 'hypovolaemia': {
      // Volume has to fall about 10% before this contributes at all — and then it
      // overrides the osmotic limb entirely. That threshold is the mechanism behind
      // hypovolaemic hyponatraemia.
      const deficit = 1 - s.cardio.bloodVolume / referenceBloodVolume(s);
      return Math.max(0, (deficit - 0.1) / 0.2);
    }

    case 'tshDrive':
      // No pituitary model yet: thyroxine sits at its set point. Recorded in
      // MODEL_LIMITATIONS rather than faked with a plausible-looking loop.
      return 0;

    case 'hypoglycaemia':
      return Math.max(0, (80 - s.metabolic.G) / 40);

    case 'hypoxia':
      return Math.max(0, (0.94 - s.resp.spo2) / 0.2);

    default:
      throw new Error(`endocrine: hormone driver "${signal}" is not a known signal`);
  }
}
