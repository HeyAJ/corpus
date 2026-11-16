import reproductionFile from '../../data/reproduction.json';
import { P } from '../core/constants';
import { addEffect } from '../core/effects';
import { referenceBloodVolume } from '../core/body';
import type { SimState } from '../core/state';
import type {
  CyclePhase,
  HormoneSnapshot,
  ReproductiveSnapshot,
  SexualPhase,
  SimIntent,
} from '../../bridge/types';

/**
 * REPRODUCTIVE PHYSIOLOGY: THE GONADAL AXIS, THE MENSTRUAL CYCLE, PREGNANCY AND THE
 * SEXUAL RESPONSE.
 *
 * Written in the register of an anatomy and physiology textbook. Nothing here is
 * clinical advice, and nothing is a model of anything but the physiology the cited papers
 * measured.
 *
 * THE REPRODUCTIVE CLOCK. A cycle takes a month and a pregnancy nine, so this subsystem
 * runs on its own clock: `lapse_days_per_s` reproductive days per SIMULATED second, real
 * time being 1/86400. The rest of the body is untouched by that clock except through the
 * effect bus and through `slowClockScale`, which tells the two day-scale processes
 * elsewhere (the kidney's acid-base compensation and creatinine) to keep pace with it.
 * Without that, a body moved to 30 weeks of gestation would have the hormones and the
 * minute ventilation of 30 weeks and the bicarbonate of a non-pregnant woman, and would
 * spend simulated DAYS getting there. A "catch-up window" of about 90 simulated seconds
 * after any jump (a pregnancy begun, a cycle day set, a change of sex) runs those clocks
 * very fast so the body arrives at the steady values of its new state.
 *
 * HOW THE BODY IS REACHED. Everything goes through the effect bus, as fright and
 * exertion do (affect.ts, activity.ts). A beta blocker therefore blunts the tachycardia
 * of pregnancy and of arousal by the path it blunts every other tachycardia. Hormone
 * LEVELS are readouts: they follow the cycle day or the gestational age from cited
 * tables and are never read back by the physiology. What the body responds to is the
 * state (progesterone's fraction of its mid-luteal level, gestational age), with gains
 * that were CALIBRATED with .cache/probes/repro_*.ts so that the model's own outputs
 * land on the cited outcomes. The gains are marked "derived" in reproduction.json and
 * their notes say what they were calibrated to.
 *
 * WHAT IS DELIBERATELY NOT MODELLED, said here rather than discovered later:
 *   - Menstrual blood is a READOUT. It is not taken out of the circulation: the model has
 *     no erythropoiesis, so a time-lapsed body would become anaemic within a few cycles
 *     when a real one replaces the cells.
 *   - Pregnancy: supine aortocaval compression, the nausea of early pregnancy, the rise
 *     in total cortisol and aldosterone as hormone levels, labour, the puerperium,
 *     lactation, and fetal physiology beyond a weight. Gestational age stops at 42
 *     weeks; ending a pregnancy simply returns the body to non-pregnant.
 *   - Sexual response: breathing changes, pupils, muscle tone, skin flush - no cited
 *     magnitudes were available. The size of the post-orgasm prolactin rise in ng/mL was
 *     not read from any text, so prolactin outside pregnancy is a 0..1 "raised" state
 *     and never a level. Male LH and FSH are absent for the same reason.
 *   - The male refractory period is the only sex difference in the sexual response.
 */

/* ========================================================================== *
 * THE CONSTANT TABLE (same pattern as B() in activity.ts)
 * ========================================================================== */

export interface ReproductionConstant {
  value: number | null;
  unit: string;
  source: string;
  sourceUrl: string;
  confidence: 'measured' | 'derived' | 'assumed';
  note: string;
}

interface Anchored {
  p50: number[];
  p10: number[];
  p90: number[];
}

interface ReproductionFile {
  version: number;
  about: string;
  citationPolicy: string;
  sources: Record<string, { label: string; url: string }>;
  constants: Record<string, ReproductionConstant>;
  tables: {
    strickerDaily: {
      days: number[];
      lh_IU_L: number[];
      fsh_IU_L: number[];
      estradiol_pmol_L: number[];
      progesterone_nmol_L: number[];
    };
    hcgWeeklyMedian: { weeks: number[]; median_IU_L: number[] };
    schockPregnancy: {
      weeks: number[];
      estradiol_ng_mL: Anchored;
      progesterone_ng_mL: Anchored;
      testosterone_ng_mL: Anchored;
      prolactin_ng_mL: Anchored;
      week3Anchor: {
        estradiol_pmol_L: { p50: number; p10: number; p90: number };
        progesterone_nmol_L: { p50: number; p10: number; p90: number };
      };
    };
    shapes: { curves: Record<string, { points: number[][] }> };
    pildnerFetalHeartRate: {
      fromWeek: number[];
      toWeek: number[];
      n: number[];
      ciLow_bpm: number[];
      ciHigh_bpm: number[];
    };
  };
}

const REPRO = reproductionFile as unknown as ReproductionFile;

/** Numeric reproduction constant. Throws if absent or deliberately null. */
export function R(key: string): number {
  const e = REPRO.constants[key];
  if (!e) throw new Error(`reproduction.json: unknown constant "${key}"`);
  if (e.value === null) throw new Error(`reproduction.json: "${key}" is a declared hole and must not be read.`);
  return e.value;
}

/** Provenance, for the tests and for any interface that wants to show where a number came from. */
export function reproductionConstants(): Record<string, ReproductionConstant> {
  return REPRO.constants;
}

export function reproductionSources(): Record<string, { label: string; url: string }> {
  return REPRO.sources;
}

/* ========================================================================== */

export interface ReproductiveState {
  /** Reproductive days per simulated second. Real time is 1 / 86400. */
  lapse_days_per_s: number;
  /** Operator-set sexual stimulation, 0..1. */
  stimulation: number;
  /** Day of the cycle, fractional, 1 <= day < 1 + length. Day 1 is the first day of menstruation. */
  cycleDay: number;
  pregnant: boolean;
  /** Gestational age, weeks from the last menstrual period. */
  gestationWeeks: number;
  /** Simulated seconds of the post-jump catch-up window still to run. */
  catchUp_s: number;
  /**
   * Gestational age a pregnancy was ENDED at, while the blood volume it expanded is still
   * draining away; 0 otherwise. The circulatory adaptations are tied to the realised
   * volume (see applyPregnancy), so a body that has just stopped being pregnant must keep
   * them for exactly as long as it still carries the volume that they serve.
   */
  endedWeeks: number;

  arousal: number;
  phase: SexualPhase;
  /** Orgasm envelope, 0..1; a half sine over the orgasmic phase. */
  orgasm: number;
  inOrgasm: boolean;
  orgasmElapsed_s: number;
  plateauHold_s: number;
  refractory_s: number;
  resolving: boolean;
  vasocongestion: number;
  orgasms: number;
  /** Fraction of the oxytocin excess (peak minus basal) currently present, 0..1. */
  oxytocinExcess: number;
  /** 0..1: prolactin raised after orgasm. A state, never a level (see the header). */
  prolactinRaised: number;
  prolactinSince_s: number;
}

export const REAL_TIME_DAYS_PER_S = 1 / 86400;
/** Factor applied to the day-scale clocks during a catch-up window. */
const CATCH_UP_FACTOR = 20000;
/** Length of the catch-up window, simulated seconds. An engineering choice. */
const CATCH_UP_S = 90;

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
  return {
    lapse_days_per_s: REAL_TIME_DAYS_PER_S,
    stimulation: 0,
    cycleDay: 1,
    pregnant: false,
    gestationWeeks: 0,
    catchUp_s: 0,
    endedWeeks: 0,
    arousal: 0,
    phase: 'rest',
    orgasm: 0,
    inOrgasm: false,
    orgasmElapsed_s: 0,
    plateauHold_s: 0,
    refractory_s: 0,
    resolving: false,
    vasocongestion: 0,
    orgasms: 0,
    oxytocinExcess: 0,
    prolactinRaised: 0,
    prolactinSince_s: 0,
  };
}

/* ------------------------------------------------------------------ helpers */

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Piecewise-linear interpolation, held at both ends. `xs` ascending. */
function lerpTable(xs: readonly number[], ys: readonly number[], x: number): number {
  const n = xs.length;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let i = 0;
  while (x > xs[i + 1]) i++;
  const f = (x - xs[i]) / (xs[i + 1] - xs[i]);
  return ys[i] + (ys[i + 1] - ys[i]) * f;
}

/** Interpolate a circular daily table indexed from day -14, wrapping day +14 to day -14. */
function circular(values: readonly number[], dayFromLh: number): number {
  const n = values.length;
  const x = dayFromLh + 14;
  const i = Math.floor(x);
  const f = x - i;
  const a = values[((i % n) + n) % n];
  const b = values[(((i + 1) % n) + n) % n];
  return a + (b - a) * f;
}

const SHAPES: Record<string, { w: number[]; v: number[] }> = {};
for (const [name, c] of Object.entries(REPRO.tables.shapes.curves)) {
  SHAPES[name] = { w: c.points.map((p) => p[0]), v: c.points.map((p) => p[1]) };
}
function shape(name: string, weeks: number): number {
  const c = SHAPES[name];
  return lerpTable(c.w, c.v, weeks);
}

function cycleLength(): number {
  return R('cycle.length_days');
}

/** Days from the LH peak for a cycle day. Cycle day 15 is LH-day 0. */
function dayFromLh(cycleDay: number): number {
  return cycleDay - R('cycle.lhPeakCycleDay');
}

function trimesterOf(weeks: number): 1 | 2 | 3 {
  return weeks < R('pregnancy.trimester2Start_weeks') ? 1 : weeks < R('pregnancy.trimester3Start_weeks') ? 2 : 3;
}

/* ----------------------------------------------------------- hormone tables */

/** Progesterone's excess over its early-follicular level, as a fraction of the mid-luteal excess. */
function progesteroneFraction(p4: number): number {
  const lo = R('cycle.progesteroneEarlyFollicular_nmol_L');
  return clamp01((p4 - lo) / (R('cycle.progesteroneMidLuteal_nmol_L') - lo));
}

function cycleP4(cycleDay: number): number {
  return circular(REPRO.tables.strickerDaily.progesterone_nmol_L, dayFromLh(cycleDay));
}

function schockAt(
  a: Anchored,
  weeks: number,
  which: 'p50' | 'p10' | 'p90',
  factor: number,
  week3SI: number | null,
): number {
  const ws = REPRO.tables.schockPregnancy.weeks;
  if (week3SI !== null) {
    return lerpTable([3, ...ws], [week3SI, ...a[which].map((v) => v * factor)], weeks);
  }
  return lerpTable(ws, a[which].map((v) => v * factor), weeks);
}

function hcgAt(weeks: number): number {
  const t = REPRO.tables.hcgWeeklyMedian;
  const w0 = R('pregnancy.hcgLogLinearFromWeek');
  const w1 = R('pregnancy.hcgLogLinearToWeek');
  const floor = R('pregnancy.hcgFloor_IU_L');
  if (weeks <= w0) return floor;
  if (weeks < w1) {
    const f = (weeks - w0) / (w1 - w0);
    return Math.exp(Math.log(floor) + (Math.log(t.median_IU_L[0]) - Math.log(floor)) * f);
  }
  return lerpTable(t.weeks, t.median_IU_L, weeks);
}

type PregHormone = 'progesterone' | 'estradiol' | 'prolactin' | 'testosterone';

function pregnancyLevel(h: PregHormone, weeks: number, which: 'p50' | 'p10' | 'p90'): number {
  const t = REPRO.tables.schockPregnancy;
  switch (h) {
    case 'progesterone':
      return schockAt(t.progesterone_ng_mL, weeks, which, R('pregnancy.hormoneToSI_progesterone'), t.week3Anchor.progesterone_nmol_L[which]);
    case 'estradiol':
      return schockAt(t.estradiol_ng_mL, weeks, which, R('pregnancy.hormoneToSI_estradiol'), t.week3Anchor.estradiol_pmol_L[which]);
    case 'prolactin':
      return schockAt(t.prolactin_ng_mL, weeks, which, 1, null);
    case 'testosterone':
      return schockAt(t.testosterone_ng_mL, weeks, which, R('pregnancy.testosteroneToNgDl'), null);
  }
}

/** The pregnancy display maximum: the top of the 90th percentile at the last sampled window. */
function pregnancyDisplayMax(h: PregHormone): number {
  return pregnancyLevel(h, 99, 'p90');
}

function maleTestosterone(s: SimState): number {
  const f = R('male.testosteroneFallBy1600');
  // 24 h cosine peaking at 08:00. With T = M + A cos(2 pi (h - 8) / 24), the 08:00 value
  // is M + A and the 16:00 value (8 h later, cos = -1/2) is M - A/2. Requiring
  // T16 = (1 - f) T08 gives A = f M / (1.5 - f), which is derived here rather than stored.
  const aOverM = f / (1.5 - f);
  const mean = R('male.testosteroneAt0800_ng_dL') / (1 + aOverM);
  return mean * (1 + aOverM * Math.cos((2 * Math.PI * (s.endocrine.clockHour - 8)) / 24));
}

/* ----------------------------------------------------------------- the step */

/** One physiology tick. Everything it does to the body goes through the effect bus. */
export function stepReproductive(s: SimState, dt: number): void {
  const r = s.reproductive;
  if (r.catchUp_s > 0) r.catchUp_s = Math.max(0, r.catchUp_s - dt);

  if (s.body.sex === 'female') {
    const days = r.lapse_days_per_s * dt;
    if (r.pregnant) {
      r.gestationWeeks = Math.min(R('pregnancy.maxWeeks'), r.gestationWeeks + days / 7);
      r.endedWeeks = 0;
      applyPregnancy(s, r.gestationWeeks);
    } else {
      // A pregnancy that has just ended leaves its plasma expansion to drain over the
      // pacing time constant; the circulation's adaptations drain with it (applyPregnancy).
      if (r.endedWeeks > 0) {
        if (realisedVolumeFraction(s, r.endedWeeks) < 1e-3) r.endedWeeks = 0;
        else applyPregnancy(s, r.endedWeeks, true);
      }
      r.cycleDay += days;
      const len = cycleLength();
      while (r.cycleDay >= 1 + len) r.cycleDay -= len;
      applyCycle(s);
    }
  }
  stepSexual(s, dt);
}

function applyCycle(s: SimState): void {
  const r = s.reproductive;
  const p4 = cycleP4(r.cycleDay);
  const frac = progesteroneFraction(p4);
  if (frac > 0) {
    // BAKER2020: +0.3-0.7 C when progesterone is high. The consumer applies
    // setPoint = 37 C x (1 + value), so the bus value is the shift over 37 C.
    addEffect(s.effects, 'thermal.setPoint', (R('cycle.lutealTempShift_C') * frac) / P('thermal.coreTemp_C'));
    // SLATKOVSKA2006: ventilation about 1 L/min greater mid-luteal, gain calibrated.
    addEffect(s.effects, 'resp.drive', R('cycle.ventilationDriveGain') * frac);
  }
  const bpm = pulseShift_bpm(r.cycleDay);
  if (bpm > 0) addEffect(s.effects, 'cardio.heartRate', bpm / P('cardio.heartRateBaseline_bpm'));
}

/**
 * SHILAIH2017 sleeping pulse relative to menses: 0 through menstruation, +2.1 bpm at the
 * fertile window, +3.8 bpm mid-luteal, back to 0 by the next cycle's day 1. Piecewise
 * linear through the phase means (where each mean sits on the axis is a stated choice).
 */
function pulseShift_bpm(cycleDay: number): number {
  const lh = R('cycle.lhPeakCycleDay');
  const xs = [R('cycle.menstruationDuration_days'), lh + R('cycle.pulseFertileAnchorLhDay'), lh + R('cycle.pulseMidLutealAnchorLhDay'), 1 + cycleLength()];
  const ys = [0, R('cycle.pulseFertileWindow_bpm'), R('cycle.pulseMidLuteal_bpm'), 0];
  return lerpTable(xs, ys, cycleDay);
}

/**
 * How much of the volume expansion this gestational age calls for the body has actually
 * grown, 0..1. Read from the fluids state (reading is allowed; nothing is written).
 * Returns 1 when the age calls for no expansion, so the early weeks are untouched.
 */
function realisedVolumeFraction(s: SimState, weeks: number): number {
  const target = referenceBloodVolume(s) * (1 - P('blood.haematocrit')) * R('pregnancy.plasmaVolume.maxGain') * shape('plasmaVolume', weeks);
  if (target < 1) return 1;
  return Math.max(0, Math.min(1, s.fluids.plasmaExpansion_mL / target));
}

function applyPregnancy(s: SimState, w: number, ended = false): void {
  // WHAT WENT WRONG, AND WHY THE CIRCULATORY TERMS ARE SCALED. The volume expansion is
  // paced (pregnancy.plasmaPacingTau_s) but the vasodilation, venous capacity and heart
  // rate used to apply at once. After a jump to week 24 or 36 the arterial tree was
  // already dilated and the veins already roomy while the plasma that fills them was
  // still being added: for about twenty seconds the body had a relative hypovolaemia no
  // pregnancy at that age has (observed in the browser: HR 121 with "Sinus tachycardia",
  // stroke volume 51 mL; at week 36 hypotension and even renal failure fired). A real
  // pregnancy grows the vessels' capacity and the volume together, so the demand side
  // is made to follow the realised volume: the adaptations that are only meaningful
  // WITH the extra volume (resistance, venous capacity, the heart-rate trim and the
  // renal vascular terms) are multiplied by the fraction of the target expansion that
  // exists. At rest at any age that fraction is 1 and nothing changes.
  const rho = realisedVolumeFraction(s, w);
  // After an ended pregnancy the volume TARGET is zero (the expansion drains away); only
  // the circulatory terms below are kept, fading with it.
  if (!ended) {
    addEffect(s.effects, 'blood.plasmaVolume', R('pregnancy.plasmaVolume.maxGain') * shape('plasmaVolume', w));
    addEffect(s.effects, 'blood.redCellMass', R('pregnancy.redCellMass.maxGain') * shape('redCellMass', w));
  }
  addEffect(s.effects, 'cardio.systemicResistance', R('pregnancy.systemicResistance.gain') * shape('systemicResistance', w) * rho);
  addEffect(
    s.effects,
    'cardio.venousTone',
    (R('pregnancy.venousTone.gain') * shape('systemicResistance', w) + R('pregnancy.venousTone.volumeGain') * shape('plasmaVolume', w)) * rho,
  );
  addEffect(s.effects, 'cardio.heartRate', R('pregnancy.heartRate.gain') * shape('heartRate', w) * rho);
  addEffect(s.effects, 'renal.vascularResistance', R('pregnancy.renalVascularResistance.gain') * shape('systemicResistance', w) * rho);
  addEffect(s.effects, 'renal.sodiumReabsorption', R('pregnancy.renalSodiumReabsorption.gain') * shape('systemicResistance', w) * rho);
  // Ventilation, heat and glucose are hormonal and metabolic, not tied to the volume, and
  // they stop the moment the pregnancy does (an ended pregnancy keeps only the circulatory
  // terms above).
  if (ended) return;
  addEffect(s.effects, 'resp.drive', R('pregnancy.resp.drive.gain') * shape('ventilation', w));
  addEffect(s.effects, 'thermal.heatProduction', R('pregnancy.heatProduction.gain') * shape('metabolicRate', w));
  const ir = shape('insulinResistance', w);
  if (ir > 0) {
    addEffect(s.effects, 'metabolic.glucoseUptake', R('pregnancy.glucoseUptake.gain') * ir);
    addEffect(s.effects, 'metabolic.insulinSecretion', R('pregnancy.insulinSecretion.gain') * ir);
  }
}

/* ---------------------------------------------------------- sexual response */

function stepSexual(s: SimState, dt: number): void {
  const x = s.reproductive;
  const quiet =
    x.stimulation <= 0 &&
    x.arousal === 0 &&
    !x.inOrgasm &&
    x.vasocongestion === 0 &&
    x.oxytocinExcess === 0 &&
    x.prolactinRaised === 0 &&
    x.refractory_s === 0 &&
    !x.resolving;
  if (quiet) {
    x.phase = 'rest';
    x.orgasm = 0;
    return;
  }

  const male = s.body.sex === 'male';
  const cons = clamp01(s.neuro.consciousness);
  const thr = R('sexual.plateauThreshold');
  const tauUp = R('sexual.arousalRiseTau_s');
  const tauDown = R('sexual.resolutionTau_s');
  const duration = R('sexual.orgasmDuration_s');

  if (x.refractory_s > 0) x.refractory_s = Math.max(0, x.refractory_s - dt);
  const refractory = male && x.refractory_s > 0;

  // Arousal follows stimulation x consciousness, first order, rising with one time
  // constant and falling with the (slower, derived) resolution one. In the male
  // refractory period stimulation cannot raise it at all.
  let target = refractory ? 0 : x.stimulation * cons;
  if (x.inOrgasm) target = 1;
  const rising = target > x.arousal;
  x.arousal += (target - x.arousal) * (1 - Math.exp(-dt / (rising ? tauUp : tauDown)));
  x.vasocongestion += (x.arousal - x.vasocongestion) * (1 - Math.exp(-dt / (x.arousal > x.vasocongestion ? tauUp : tauDown)));

  if (x.inOrgasm) {
    x.orgasmElapsed_s += dt;
    x.orgasm = Math.sin((Math.PI * Math.min(x.orgasmElapsed_s, duration)) / duration);
    // Oxytocin "jumps toward" its peak over the orgasmic phase: three time constants
    // across the phase, so about 95 % of the way there at its end.
    x.oxytocinExcess += (1 - x.oxytocinExcess) * (1 - Math.exp((-3 * dt) / duration));
    if (x.orgasmElapsed_s >= duration) {
      x.inOrgasm = false;
      x.orgasm = 0;
      x.orgasmElapsed_s = 0;
      x.plateauHold_s = 0;
      x.arousal = Math.min(x.arousal, R('sexual.postOrgasmArousal'));
      x.resolving = true;
      x.prolactinSince_s = 0;
      if (male) x.refractory_s = R('male.refractoryPeriod_min') * 60;
    }
  } else {
    x.orgasm = 0;
    const drive = x.stimulation * cons;
    if (!refractory && x.arousal >= thr && drive > thr) {
      x.plateauHold_s += dt;
      x.resolving = false;
      if (x.plateauHold_s >= R('sexual.plateauHold_s')) {
        x.inOrgasm = true;
        x.orgasmElapsed_s = 0;
        x.orgasms += 1;
        x.prolactinRaised = 1;
        x.prolactinSince_s = 0;
      }
    } else {
      x.plateauHold_s = 0;
    }
    if (x.resolving && (!refractory && drive > x.arousal)) x.resolving = false;
    // Oxytocin falls with the half-life derived from "basal in 30 min".
    const halfLife = (R('sexual.oxytocinReturn_min') * 60) / R('sexual.oxytocinHalfLivesToBasal');
    x.oxytocinExcess *= Math.exp((-Math.LN2 * dt) / halfLife);
    // Prolactin: a 60 min plateau, then decay.
    x.prolactinSince_s += dt;
    if (x.prolactinRaised > 0 && x.prolactinSince_s > R('sexual.prolactinPlateau_min') * 60) {
      x.prolactinRaised *= Math.exp(-dt / (R('sexual.prolactinDecayTau_min') * 60));
    }
  }

  if (x.arousal < 1e-4 && !x.inOrgasm) x.arousal = 0;
  if (x.vasocongestion < 1e-4) x.vasocongestion = 0;
  if (x.oxytocinExcess < 1e-4) x.oxytocinExcess = 0;
  if (x.prolactinRaised < 1e-4) x.prolactinRaised = 0;
  if (x.resolving && x.arousal === 0) x.resolving = false;

  x.phase = x.inOrgasm
    ? 'orgasm'
    : x.resolving
      ? 'resolution'
      : x.arousal >= thr
        ? 'plateau'
        : x.arousal > 0
          ? 'excitement'
          : 'rest';

  const a = x.arousal;
  const env = x.orgasm;
  if (a > 0 || env > 0) {
    // Pressure peaks at the START of plateau (XUERUI2008), so the pressure terms reach
    // full value at the plateau threshold; heart rate keeps rising to the start of orgasm.
    const arm = Math.min(1, a / thr);
    // CENTRAL COMMAND RESETS THE BAROREFLEX. This is the term that makes the pressure
    // rise possible at all. XUERUI2008 found pressure up by about 20 mmHg for minutes
    // while heart rate was up by about 20 bpm; a reflex defending its resting set point
    // cannot do that, and the previous calibration proved it the hard way - every pressor
    // gain it added came back as vagal slowing, and raising the gains until the pressure
    // moved only made the heart rate FALL. The fix is the mechanism, not a bigger number:
    // the defended pressure is moved up by the cited rise in mean pressure, as a fraction
    // of the set point (derived per sex in reproduction.json), full at the plateau
    // threshold where XUERUI2008 found the pressure peak, and fading with arousal in
    // resolution exactly as the exercise resetting fades with exertion.
    const sx = male ? 'male' : 'female';
    addEffect(s.effects, 'reflex.setpointShift', R(`sexual.setpointShift_${sx}`) * arm);
    // The direct terms on top of the reset are now small, and per sex where the citation
    // is per sex. The orgasmic increments are NEMEC1976's (men only) and are applied to
    // both sexes; see the notes on the sexual.*_orgasm constants.
    addEffect(s.effects, 'cardio.heartRate', (R(`sexual.hr_arousal_${sx}_bpm`) * a + R('sexual.hr_orgasm_bpm') * env) / P('cardio.heartRateBaseline_bpm'));
    addEffect(s.effects, 'cardio.contractility', R(`sexual.contractility_arousal_${sx}`) * arm + R('sexual.contractility_orgasm') * env);
    addEffect(s.effects, 'cardio.systemicResistance', R(`sexual.resistance_arousal_${sx}`) * arm + R('sexual.resistance_orgasm') * env);
    // THE PRELOAD SIDE OF THE RESPONSE, AND WHAT WENT WRONG WITHOUT IT. The first
    // calibration reached the cited pressures' MEAN with the set-point reset and a faster
    // heart, but nothing in it returned blood to the heart: the quicker ventricle ejected a
    // SMALLER stroke against a higher resistance, so diastolic pressure rose about twice as
    // much as systolic (+22 / +11 mmHg in a man) where XUERUI2008 found the reverse
    // (+18 / +21) and the pulse pressure widened. Contractility gains could not repair it
    // because this ventricle is preload-limited. Sympathetic venoconstriction is the
    // textbook mechanism (shrinks unstressed venous volume, raises venous return), and
    // cardio.venousTone is the bus target that already carries it for exercise.
    addEffect(s.effects, 'cardio.venousTone', R(`sexual.venousTone_arousal_${sx}`) * arm + R('sexual.venousTone_orgasm') * env);
    // pathology.ts: felt pain = nociception x (1 - analgesia). The stimulus needed to
    // reach a fixed felt pain is therefore proportional to 1 / (1 - analgesia), so a
    // threshold raised by a fraction q needs analgesia = 1 - 1 / (1 + q) (WHIPPLE1985).
    const a1 = 1 - 1 / (1 + R('sexual.painThresholdRise_stimulation'));
    const a2 = 1 - 1 / (1 + R('sexual.painThresholdRise_orgasm'));
    addEffect(s.effects, 'neuro.analgesia', a1 * arm + (a2 - a1) * env);
    // A declaration of state, as affect.ts makes for fright.
    addEffect(s.effects, 'neuro.euphoria', env);
    // TWO WRITES THAT USED TO BE HERE, AND WHY THEY ARE GONE.
    //
    // `neuro.arousal` (sexual arousal x 1): it read as a harmless declaration, but it is
    // not one. neuro.ts SUBTRACTS that target from the sedation load, so a body at full
    // stimulation could not be anaesthetised - a propofol induction dose was cancelled
    // term for term - and because sexual arousal follows consciousness, the two held
    // each other up in a loop. No source available to this project gives a magnitude
    // for any such opposition to sedation, so the honest value is none at all. The
    // shared English word "arousal" (wakefulness there, sexual response here) is what
    // made the wiring look right.
    //
    // `neuro.dependence` (the orgasm envelope): that target is the interface's readout of
    // a DRUG's dependence liability. An orgasm is not a dose of anything, and writing to
    // it put a physiological event on a pharmacological scale.
  }
}

/* ------------------------------------------------------------------ intents */

function resetSexual(r: ReproductiveState): void {
  r.stimulation = 0;
  r.arousal = 0;
  r.phase = 'rest';
  r.orgasm = 0;
  r.inOrgasm = false;
  r.orgasmElapsed_s = 0;
  r.plateauHold_s = 0;
  r.refractory_s = 0;
  r.resolving = false;
  r.vasocongestion = 0;
  r.oxytocinExcess = 0;
  r.prolactinRaised = 0;
  r.prolactinSince_s = 0;
}

/**
 * Handle one of the four reproductive intents. Returns null when it was applied, or a
 * sentence saying why it was refused (the engine surfaces it as a notice).
 */
export function applyReproductiveIntent(s: SimState, intent: SimIntent): string | null {
  const r = s.reproductive;
  switch (intent.type) {
    case 'SET_CYCLE_DAY': {
      if (s.body.sex !== 'female') return 'The menstrual cycle exists only in a female body.';
      if (r.pregnant) return 'The menstrual cycle is inactive during pregnancy; end the pregnancy first.';
      if (!Number.isFinite(intent.day)) return 'The cycle day must be a number.';
      r.cycleDay = Math.max(1, Math.min(cycleLength(), intent.day));
      r.catchUp_s = CATCH_UP_S;
      return null;
    }
    case 'SET_PREGNANCY': {
      if (s.body.sex !== 'female') return 'Pregnancy is only possible in a female body.';
      if (!intent.pregnant) {
        if (r.pregnant) {
          r.pregnant = false;
          r.endedWeeks = r.gestationWeeks;
          r.gestationWeeks = 0;
          r.cycleDay = 1;
          r.catchUp_s = CATCH_UP_S;
        }
        return null;
      }
      const w = intent.weeks === undefined || !Number.isFinite(intent.weeks) ? R('pregnancy.defaultWeeks') : intent.weeks;
      r.pregnant = true;
      r.gestationWeeks = Math.max(0, Math.min(R('pregnancy.maxWeeks'), w));
      r.catchUp_s = CATCH_UP_S;
      return null;
    }
    case 'SET_REPRODUCTIVE_LAPSE': {
      const v = intent.days_per_s;
      r.lapse_days_per_s =
        !Number.isFinite(v) || v <= REAL_TIME_DAYS_PER_S ? REAL_TIME_DAYS_PER_S : Math.min(1, v);
      return null;
    }
    case 'SET_SEXUAL_STIMULATION': {
      if (!Number.isFinite(intent.level)) return 'The stimulation level must be a number.';
      r.stimulation = clamp01(intent.level);
      return null;
    }
    default:
      return `${intent.type} is not a reproductive intent`;
  }
}

/** Called by the engine after SET_BODY changes the body's sex. */
export function onSexChanged(s: SimState): void {
  const r = s.reproductive;
  r.pregnant = false;
  r.gestationWeeks = 0;
  r.cycleDay = 1;
  resetSexual(r);
  r.catchUp_s = CATCH_UP_S;
}

/* ---------------------------------------------------------------- read-outs */

function menstruating(r: ReproductiveState): boolean {
  return r.cycleDay < 1 + R('cycle.menstruationDuration_days');
}

function cyclePhase(r: ReproductiveState): CyclePhase {
  if (menstruating(r)) return 'menstrual';
  const d = Math.floor(r.cycleDay);
  const lh = R('cycle.lhPeakCycleDay');
  if (d < lh) return 'follicular';
  if (d <= lh + 1) return 'ovulation';
  return 'luteal';
}

function follicleIndex(r: ReproductiveState): number {
  const d = dayFromLh(r.cycleDay);
  return d < 0 ? clamp01((d + 14) / 14) : 0;
}

function corpusLuteumIndex(r: ReproductiveState): number {
  if (dayFromLh(r.cycleDay) < 0) return 0;
  return clamp01(cycleP4(r.cycleDay) / R('cycle.progesteroneMidLuteal_nmol_L'));
}

/**
 * Endometrium, a DISPLAY INDEX 0..1 (no cited thickness by phase was available). Shed
 * linearly over menstruation to 0 at its end; then rises with estradiol to 0.5 at the
 * pre-ovulatory estradiol peak; then 0.5 to 1 with progesterone, mid-luteal highest.
 */
function endometriumIndex(r: ReproductiveState): number {
  const t = REPRO.tables.strickerDaily;
  const dur = R('cycle.menstruationDuration_days');
  const p4Ml = R('cycle.progesteroneMidLuteal_nmol_L');
  const d = dayFromLh(r.cycleDay);
  if (menstruating(r)) {
    const start = 0.5 + 0.5 * clamp01(t.progesterone_nmol_L[0] / p4Ml);
    return start * clamp01(1 - (r.cycleDay - 1) / dur);
  }
  if (d < 0) {
    const e2 = circular(t.estradiol_pmol_L, d);
    const e2End = circular(t.estradiol_pmol_L, 1 + dur - R('cycle.lhPeakCycleDay'));
    const e2Max = t.estradiol_pmol_L[13];
    return 0.5 * clamp01((e2 - e2End) / (e2Max - e2End));
  }
  return 0.5 + 0.5 * clamp01(cycleP4(r.cycleDay) / p4Ml);
}

function bloodLoss(r: ReproductiveState): number {
  return R('cycle.menstrualBloodLoss_mL') * clamp01((r.cycleDay - 1) / R('cycle.menstruationDuration_days'));
}

function oxytocinLevel(r: ReproductiveState): number {
  const b = R('sexual.oxytocinBasal_pmol_L');
  return b + (R('sexual.oxytocinPeak_pmol_L') - b) * r.oxytocinExcess;
}

function fetalWeight(w: number): number | null {
  if (w < R('pregnancy.fetalWeightFirstWeek')) return null;
  const ga = Math.min(w, R('pregnancy.fetalWeightLastWeek'));
  return Math.exp(R('pregnancy.hadlockIntercept') + R('pregnancy.hadlockLinear') * ga + R('pregnancy.hadlockQuadratic') * ga * ga);
}

/**
 * Fetal heart rate, beats/min, for a gestational age in weeks, or null where no cited rate
 * exists. This is a REPLAY of population means, nothing more, pieced from three studies:
 *
 *   w < 10            null. The model holds its fetus at the 10-week drawing below 10 weeks
 *                     and no source retrieved covers 9 to 10 weeks, so no rate is shown
 *                     rather than a plausible extrapolation of Hyett's line backwards.
 *   10 <= w < 14      the straight line between the two Hyett (1996) means, 171 bpm at 10
 *                     weeks and 156 bpm at 14 (6903 normal singleton pregnancies).
 *   14 <= w < 20      156 + slope x (w - 14), with the slope of Ursem (1999), -2.52 bpm per
 *                     week (55 healthy women, 10-20 weeks). This is a DERIVED join of two
 *                     cited numbers from two studies, not a measurement in its own right.
 *                     It reaches 140.88 at 20 weeks, and the independent Pildner (2013)
 *                     band that starts at 20 weeks has midpoint 141.348: the two agree to
 *                     0.47 bpm, which is the check that the join is acceptable. The test
 *                     suite asserts that agreement so a change to either end shows up.
 *   w >= 20           the midpoint of the Pildner interval of the band that contains w
 *                     (computerised CTG, 13,015 tracings). The paper prints the 95%
 *                     confidence interval of the MEAN, not the mean, and the midpoint of a
 *                     symmetric interval is the sample mean. The last band (week 42)
 *                     continues past 42 weeks, where the model's pregnancy ends anyway.
 *
 * What it is NOT: not a simulated fetal circulation. There is no beat-to-beat variability,
 * no accelerations or decelerations, no response to the mother's state, and the steps
 * between Pildner bands are steps in the data, not physiology. It is a display quantity
 * of the fetus only and therefore deliberately does NOT go on the effect bus: nothing in
 * the mother consumes it (CLAUDE.md rule 2 is about what reaches the body).
 */
export function fetalHeartRate(w: number): number | null {
  if (!(w >= 10)) return null;
  if (w < 14) {
    const a = R('fetus.heartRateAt10Weeks_bpm');
    const b = R('fetus.heartRateAt14Weeks_bpm');
    return a + ((b - a) * (w - 10)) / 4;
  }
  if (w < 20) return R('fetus.heartRateAt14Weeks_bpm') + R('fetus.heartRateSlope10to20Weeks_bpm_per_week') * (w - 14);
  const t = REPRO.tables.pildnerFetalHeartRate;
  let k = 0;
  for (let i = 0; i < t.fromWeek.length; i++) if (w >= t.fromWeek[i]) k = i;
  return (t.ciLow_bpm[k] + t.ciHigh_bpm[k]) / 2;
}

export function reproductiveSnapshot(s: SimState): ReproductiveSnapshot {
  const r = s.reproductive;
  const female = s.body.sex === 'female';
  const cycleActive = female && !r.pregnant;
  const w = r.gestationWeeks;
  const refPlasma = referenceBloodVolume(s) * (1 - P('blood.haematocrit'));
  const refCells = referenceBloodVolume(s) * P('blood.haematocrit');
  return {
    sex: s.body.sex,
    lapse_days_per_s: r.lapse_days_per_s,
    cycle: {
      active: cycleActive,
      day: cycleActive ? r.cycleDay : 1,
      length_days: cycleLength(),
      phase: cycleActive ? cyclePhase(r) : 'follicular',
      dayFromLhPeak: cycleActive ? dayFromLh(r.cycleDay) : -14,
      menstruating: cycleActive && menstruating(r),
      bloodLoss_mL: cycleActive ? bloodLoss(r) : 0,
      endometrium: cycleActive ? endometriumIndex(r) : 0,
      follicle: cycleActive ? follicleIndex(r) : 0,
      corpusLuteum: cycleActive ? corpusLuteumIndex(r) : 0,
      temperatureShift_C: cycleActive ? R('cycle.lutealTempShift_C') * progesteroneFraction(cycleP4(r.cycleDay)) : 0,
    },
    pregnancy: {
      pregnant: female && r.pregnant,
      gestationWeeks: female && r.pregnant ? w : 0,
      trimester: female && r.pregnant ? trimesterOf(w) : 0,
      fetalWeight_g: female && r.pregnant ? fetalWeight(w) : null,
      fetalHeartRate_bpm: female && r.pregnant ? fetalHeartRate(w) : null,
      amnioticFluid_mL:
        female && r.pregnant && w >= R('pregnancy.amnioticFirstWeek') && w <= R('pregnancy.amnioticLastWeek')
          ? R('pregnancy.amnioticFluid_mL')
          : null,
      plasmaVolumeGain: s.fluids.plasmaExpansion_mL / refPlasma,
      redCellMassGain: s.fluids.redCellExpansion_mL / refCells,
    },
    sexual: {
      stimulation: r.stimulation,
      arousal: r.arousal,
      phase: r.phase,
      orgasm: r.orgasm,
      refractory_s: s.body.sex === 'male' ? r.refractory_s : 0,
      vasocongestion: r.vasocongestion,
      orgasms: r.orgasms,
      prolactinRaised: r.prolactinRaised,
    },
  };
}

function hormone(
  id: string,
  label: string,
  level: number,
  unit: string,
  refLow: number,
  refHigh: number,
  gland: string,
  displayMax: number,
  note?: string,
): HormoneSnapshot {
  // The label stays a short NAME. A caveat about the range used to be glued onto the label
  // and the panel printed it over the value; it now travels separately as `note`.
  const h: HormoneSnapshot = { id, label, level, unit, activity: clamp01(level / displayMax), refLow, refHigh, gland };
  if (note !== undefined) h.note = note;
  return h;
}

/** The reproductive hormones, in the same shape the endocrine panel already lists. */
export function reproductiveHormones(s: SimState): HormoneSnapshot[] {
  const r = s.reproductive;
  const out: HormoneSnapshot[] = [];
  if (s.body.sex === 'male') {
    out.push(
      hormone('testosterone', 'Testosterone (total)', maleTestosterone(s), 'ng/dL', R('male.testosteroneRefLow_ng_dL'), R('male.testosteroneRefHigh_ng_dL'), 'testes', R('male.testosteroneRefHigh_ng_dL')),
    );
  } else if (r.pregnant) {
    const w = r.gestationWeeks;
    const hMax = R('pregnancy.hcgDisplayMax_IU_L');
    out.push(hormone('hcg', 'hCG (total)', hcgAt(w), 'IU/L', 0, hMax, 'placenta', hMax, 'The reference shown is the peak weekly median, not a percentile range.'));
    out.push(hormone('progesterone', 'Progesterone', pregnancyLevel('progesterone', w, 'p50'), 'nmol/L', pregnancyLevel('progesterone', w, 'p10'), pregnancyLevel('progesterone', w, 'p90'), 'placenta', pregnancyDisplayMax('progesterone')));
    out.push(hormone('estradiol', 'Estradiol', pregnancyLevel('estradiol', w, 'p50'), 'pmol/L', pregnancyLevel('estradiol', w, 'p10'), pregnancyLevel('estradiol', w, 'p90'), 'placenta', pregnancyDisplayMax('estradiol')));
    out.push(hormone('prolactin', 'Prolactin', pregnancyLevel('prolactin', w, 'p50'), 'ng/mL', pregnancyLevel('prolactin', w, 'p10'), pregnancyLevel('prolactin', w, 'p90'), 'anterior pituitary', pregnancyDisplayMax('prolactin')));
    out.push(hormone('testosterone', 'Testosterone (total)', pregnancyLevel('testosterone', w, 'p50'), 'ng/dL', pregnancyLevel('testosterone', w, 'p10'), pregnancyLevel('testosterone', w, 'p90'), 'ovary and placenta', pregnancyDisplayMax('testosterone')));
  } else {
    const t = REPRO.tables.strickerDaily;
    const d = dayFromLh(r.cycleDay);
    out.push(hormone('lh', 'Luteinising hormone', circular(t.lh_IU_L, d), 'IU/L', R('cycle.lhRefLow_IU_L'), R('cycle.lhRefHigh_IU_L'), 'anterior pituitary', R('cycle.lhRefHigh_IU_L')));
    out.push(hormone('fsh', 'Follicle-stimulating hormone', circular(t.fsh_IU_L, d), 'IU/L', R('cycle.fshRefLow_IU_L'), R('cycle.fshRefHigh_IU_L'), 'anterior pituitary', R('cycle.fshRefHigh_IU_L')));
    out.push(hormone('estradiol', 'Estradiol', circular(t.estradiol_pmol_L, d), 'pmol/L', R('cycle.estradiolRefLow_pmol_L'), R('cycle.estradiolRefHigh_pmol_L'), 'ovary', R('cycle.estradiolRefHigh_pmol_L')));
    out.push(hormone('progesterone', 'Progesterone', circular(t.progesterone_nmol_L, d), 'nmol/L', R('cycle.progesteroneRefLow_nmol_L'), R('cycle.progesteroneRefHigh_nmol_L'), 'ovary', R('cycle.progesteroneRefHigh_nmol_L')));
  }
  // Measured basal and peak (MURPHY1987, men), not a laboratory range; used for both sexes.
  out.push(
    hormone('oxytocin', 'Oxytocin', oxytocinLevel(r), 'pmol/L', R('sexual.oxytocinBasal_pmol_L'), R('sexual.oxytocinPeak_pmol_L'), 'posterior pituitary', R('sexual.oxytocinPeak_pmol_L'), 'The range shown is the measured basal and peak, not a laboratory range.'),
  );
  return out;
}

export function reproductiveSignals(s: SimState): ReproductiveSignals {
  const r = s.reproductive;
  const female = s.body.sex === 'female';
  const sig: ReproductiveSignals = {
    estradiol: 0,
    progesterone: 0,
    lh: 0,
    fsh: 0,
    testosterone: 0,
    prolactin: 0,
    // DEPARTURE FROM BASAL, NOT LEVEL. This used to be level / peak, which reads
    // basal / peak = 0.19 in every resting body; the anatomy deriver requires a display
    // signal to be about zero at rest so that anything above it means something happened.
    // (level - basal) / (peak - basal) from the measured MURPHY1987 basal and peak.
    oxytocin: clamp01((oxytocinLevel(r) - R('sexual.oxytocinBasal_pmol_L')) / (R('sexual.oxytocinPeak_pmol_L') - R('sexual.oxytocinBasal_pmol_L'))),
    hcg: 0,
    follicle: 0,
    corpusLuteum: 0,
    endometrium: 0,
    menstruating: 0,
    pregnancy: 0,
    sexualArousal: r.arousal,
    orgasm: r.orgasm,
    vasocongestion: r.vasocongestion,
  };
  if (!female) {
    // EXCESS OVER THE RESTING LEVEL. The old level / reference-high read 0.58 in a resting
    // man (the 531 ng/dL start is mid-range), which the anatomy deriver treated as an
    // event. This body's own resting level is its circadian curve, which peaks at 08:00 at
    // R('male.testosteroneAt0800_ng_dL') and only falls after, so the signal is the amount
    // above that peak as a fraction of the room left under the reference-range ceiling.
    // It is exactly 0 at rest at every hour of the day; nothing in the model raises
    // testosterone yet, and when something does (an exogenous dose) it will show here.
    const t0800 = R('male.testosteroneAt0800_ng_dL');
    sig.testosterone = clamp01((maleTestosterone(s) - t0800) / (R('male.testosteroneRefHigh_ng_dL') - t0800));
  } else if (r.pregnant) {
    const w = r.gestationWeeks;
    sig.pregnancy = clamp01(w / 40);
    sig.hcg = clamp01(hcgAt(w) / R('pregnancy.hcgDisplayMax_IU_L'));
    sig.progesterone = clamp01(pregnancyLevel('progesterone', w, 'p50') / pregnancyDisplayMax('progesterone'));
    sig.estradiol = clamp01(pregnancyLevel('estradiol', w, 'p50') / pregnancyDisplayMax('estradiol'));
    sig.prolactin = clamp01(pregnancyLevel('prolactin', w, 'p50') / pregnancyDisplayMax('prolactin'));
    sig.testosterone = clamp01(pregnancyLevel('testosterone', w, 'p50') / pregnancyDisplayMax('testosterone'));
  } else {
    // CYCLE AND PREGNANCY SIGNALS ARE EVENTS, NOT REST. A non-pregnant woman is always
    // somewhere in her cycle, and at day 1 (the start state) she is menstruating: FSH
    // about 0.43, endometrium about 0.52, estradiol about 0.1 of their ranges are the
    // cycle's own state, not a resting level that should read zero. They were audited for
    // the anatomy-at-rest requirement and deliberately left as levels.
    const t = REPRO.tables.strickerDaily;
    const d = dayFromLh(r.cycleDay);
    sig.lh = clamp01(circular(t.lh_IU_L, d) / R('cycle.lhRefHigh_IU_L'));
    sig.fsh = clamp01(circular(t.fsh_IU_L, d) / R('cycle.fshRefHigh_IU_L'));
    sig.estradiol = clamp01(circular(t.estradiol_pmol_L, d) / R('cycle.estradiolRefHigh_pmol_L'));
    sig.progesterone = clamp01(circular(t.progesterone_nmol_L, d) / R('cycle.progesteroneRefHigh_nmol_L'));
    sig.follicle = follicleIndex(r);
    sig.corpusLuteum = corpusLuteumIndex(r);
    sig.endometrium = endometriumIndex(r);
    sig.menstruating = menstruating(r) ? 1 : 0;
    // Prolactin outside pregnancy exists only as the post-orgasm "raised" state.
    sig.prolactin = r.prolactinRaised;
  }
  if (!female) sig.prolactin = r.prolactinRaised;
  return sig;
}

/**
 * Multiplier on the day-scale clocks elsewhere in the engine (renal compensation of
 * acid-base, creatinine) while the reproductive clock is being run ahead of real time.
 * Exactly 1 in real time and with no jump, so a body that is not being time-lapsed is
 * unchanged. During the catch-up window after a jump it is very large, so the body is
 * brought to the steady values of its new state instead of spending simulated days there.
 */
export function slowClockScale(s: SimState): number {
  const r = s.reproductive;
  if (r.catchUp_s > 0) return CATCH_UP_FACTOR;
  // The time-lapse advances only a female body's cycle or pregnancy. It used to be
  // applied to any body, so a lapse left set when the body was switched to male ran a
  // male kidney's clocks thousands of times faster than real time while nothing in that
  // body was being advanced. A male body is in real time outside a catch-up window.
  if (s.body.sex !== 'female') return 1;
  return Math.max(1, r.lapse_days_per_s * 86400);
}
