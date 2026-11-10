import type { SimState } from '../core/state';
import type { HormoneSnapshot, ReproductiveSnapshot, SimIntent } from '../../bridge/types';

/**
 * REPRODUCTION — CONTRACT STUB.
 *
 * This file is the agreed interface between the engine (core/engine.ts, core/state.ts)
 * and the reproductive subsystem. The engine already calls every function exported
 * here; the bodies below return the state of a body in which nothing reproductive is
 * happening. The implementation replaces the bodies and the state, and must keep every
 * exported name and signature.
 */

export interface ReproductiveState {
  /** Reproductive days per simulated second. Real time is 1 / 86400. */
  lapse_days_per_s: number;
  /** Operator-set sexual stimulation, 0..1. */
  stimulation: number;
}

/** The sixteen reproductive signals the anatomy atlas may be driven by, each 0..1. */
export interface ReproductiveSignals {
  estradiol: number;
  progesterone: number;
  lh: number;
  fsh: number;
  testosterone: number;
  prolactin: number;
  oxytocin: number;
  hcg: number;
  follicle: number;
  corpusLuteum: number;
  endometrium: number;
  menstruating: number;
  pregnancy: number;
  sexualArousal: number;
  orgasm: number;
  vasocongestion: number;
}

export function createReproductiveState(): ReproductiveState {
  return { lapse_days_per_s: 1 / 86400, stimulation: 0 };
}

/** One physiology tick. Everything it does to the body goes through the effect bus. */
export function stepReproductive(_s: SimState, _dt: number): void {
  // Stub: a body with no reproductive physiology leaves nothing on the bus.
}

/**
 * Handle one of the four reproductive intents. Returns null when it was applied, or a
 * sentence saying why it was refused (the engine surfaces it as a notice).
 */
export function applyReproductiveIntent(_s: SimState, intent: SimIntent): string | null {
  return `${intent.type} is not available yet`;
}

/** Called by the engine after SET_BODY changes the body's sex. */
export function onSexChanged(_s: SimState): void {
  // Stub.
}

export function reproductiveSnapshot(s: SimState): ReproductiveSnapshot {
  return {
    sex: s.body.sex,
    lapse_days_per_s: s.reproductive.lapse_days_per_s,
    cycle: {
      active: false,
      day: 1,
      length_days: 29,
      phase: 'follicular',
      dayFromLhPeak: -14,
      menstruating: false,
      bloodLoss_mL: 0,
      endometrium: 0,
      follicle: 0,
      corpusLuteum: 0,
      temperatureShift_C: 0,
    },
    pregnancy: {
      pregnant: false,
      gestationWeeks: 0,
      trimester: 0,
      fetalWeight_g: null,
      amnioticFluid_mL: null,
      plasmaVolumeGain: 0,
      redCellMassGain: 0,
    },
    sexual: {
      stimulation: s.reproductive.stimulation,
      arousal: 0,
      phase: 'rest',
      orgasm: 0,
      refractory_s: 0,
      vasocongestion: 0,
      orgasms: 0,
    },
  };
}

/** The reproductive hormones, in the same shape the endocrine panel already lists. */
export function reproductiveHormones(_s: SimState): HormoneSnapshot[] {
  return [];
}

export function reproductiveSignals(_s: SimState): ReproductiveSignals {
  return {
    estradiol: 0,
    progesterone: 0,
    lh: 0,
    fsh: 0,
    testosterone: 0,
    prolactin: 0,
    oxytocin: 0,
    hcg: 0,
    follicle: 0,
    corpusLuteum: 0,
    endometrium: 0,
    menstruating: 0,
    pregnancy: 0,
    sexualArousal: 0,
    orgasm: 0,
    vasocongestion: 0,
  };
}

/**
 * Multiplier on the day-scale clocks elsewhere in the engine (renal compensation of
 * acid-base, creatinine) while the reproductive clock is being run ahead of real time.
 * Exactly 1 in real time, so a body that is not being time-lapsed is unchanged.
 */
export function slowClockScale(_s: SimState): number {
  return 1;
}
