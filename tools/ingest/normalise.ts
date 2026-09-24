/**
 * UNIT NORMALISATION (spec 5.6).
 *
 * "Unit normalisation is not optional. GtoPdb gives log-scale affinities; SPL gives
 *  L/kg and mL/min; our engine wants nM, L and min^-1. Do the conversion in
 *  normalise.ts, once, with unit tests. A silent L/kg -> L error will make a drug
 *  look 70x too potent and it will not be obvious."
 *
 * Every function here is covered by tests/pharma/normalise.test.ts. Nothing else in
 * the pipeline is allowed to do arithmetic on a unit.
 */

import type { ReceptorActivationModel } from '../../src/data/pharma-types';

export const REFERENCE_MASS_KG = 70;

/* ------------------------------------------------------------- affinities */

/** pKi / pEC50 / pIC50 / pKd -> nM.  Ki_nM = 10^(9 - pKi). */
export function pXtoNanomolar(pX: number): number {
  return Math.pow(10, 9 - pX);
}

/** nM -> pX, the inverse. Used only for round-trip tests. */
export function nanomolarToPx(nM: number): number {
  return 9 - Math.log10(nM);
}

/**
 * GtoPdb's `Affinity Units` column names the scale of the `Affinity Median` value.
 * Everything it publishes is a negative log molar, so the conversion is uniform —
 * but the *meaning* differs, and we keep that distinction because an IC50 from a
 * functional assay is not a Ki.
 */
export type AffinityKind = 'Ki' | 'EC50' | 'IC50' | 'Kd' | 'unknown';

export function affinityKind(units: string): AffinityKind {
  const u = units.trim().toLowerCase();
  if (u === 'pki') return 'Ki';
  if (u === 'pec50') return 'EC50';
  if (u === 'pic50') return 'IC50';
  if (u === 'pkd') return 'Kd';
  if (u === 'pa2' || u === 'pkb') return 'Ki';
  return 'unknown';
}

/* --------------------------------------------------- volumes and clearance */

/** Volume of distribution in L/kg -> L for the reference adult. */
export function vdPerKgToLitres(vd_L_per_kg: number, mass_kg = REFERENCE_MASS_KG): number {
  return vd_L_per_kg * mass_kg;
}

/** Clearance in mL/min/kg -> L/min for the reference adult. */
export function clearancePerKgToLitresPerMin(cl_mL_per_min_kg: number, mass_kg = REFERENCE_MASS_KG): number {
  return (cl_mL_per_min_kg * mass_kg) / 1000;
}

/** Clearance in mL/min -> L/min. */
export function mlPerMinToLitresPerMin(x: number): number {
  return x / 1000;
}

/** Clearance in L/h -> L/min. */
export function litresPerHourToLitresPerMin(x: number): number {
  return x / 60;
}

/**
 * First-order elimination rate constant from clearance and central volume.
 *   k10 = CL / V1     [1/min]
 */
export function k10FromClearance(cl_L_per_min: number, v1_L: number): number {
  if (v1_L <= 0) throw new Error('normalise: V1 must be positive');
  return cl_L_per_min / v1_L;
}

/** Elimination rate constant from a terminal half-life in minutes. */
export function kFromHalfLife(halfLife_min: number): number {
  if (halfLife_min <= 0) throw new Error('normalise: half-life must be positive');
  return Math.LN2 / halfLife_min;
}

export function halfLifeFromK(k_per_min: number): number {
  if (k_per_min <= 0) throw new Error('normalise: k must be positive');
  return Math.LN2 / k_per_min;
}

export function hoursToMinutes(h: number): number {
  return h * 60;
}

/* -------------------------------------------------------- concentrations */

/** mg/L (== ug/mL) -> nM. */
export function mgPerLitreToNanomolar(mgPerL: number, mw_g_per_mol: number): number {
  if (mw_g_per_mol <= 0) throw new Error('normalise: molecular weight must be positive');
  return (mgPerL * 1e6) / mw_g_per_mol;
}

/** ug/mL -> nM. Same number as mg/L; kept separate so call sites read correctly. */
export function ugPerMlToNanomolar(ugPerMl: number, mw_g_per_mol: number): number {
  return mgPerLitreToNanomolar(ugPerMl, mw_g_per_mol);
}

/** ng/mL -> nM. */
export function ngPerMlToNanomolar(ngPerMl: number, mw_g_per_mol: number): number {
  return mgPerLitreToNanomolar(ngPerMl / 1000, mw_g_per_mol);
}

/* -------------------------------------------------- two-compartment micro */

/**
 * Macro (A, alpha, B, beta) -> micro (k10, k12, k21) rate constants.
 * Standard two-compartment identities; used when a paper reports the exponentials.
 */
export function macroToMicro(alpha: number, beta: number, A: number, B: number): {
  k21: number;
  k10: number;
  k12: number;
} {
  const k21 = (A * beta + B * alpha) / (A + B);
  const k10 = (alpha * beta) / k21;
  const k12 = alpha + beta - k21 - k10;
  return { k21, k10, k12 };
}

/**
 * Two-compartment micro constants from four *published* quantities:
 *   V1   central volume, L
 *   CL   clearance, L/min
 *   Vss  steady-state volume of distribution, L
 *   t-half(beta)  terminal elimination half-life, min
 *
 * Derivation. With k10 = CL/V1 and beta = ln2/t-half, the steady-state identity
 * k12*V1 = k21*V2 plus the characteristic-polynomial identities
 *   alpha + beta = k10 + k12 + k21   and   alpha*beta = k10*k21
 * close the system with no free parameter:
 *
 *   alpha = (k10 - beta) / (1 - beta*(Vss/V1)/k10)
 *   k21   = alpha*beta/k10
 *   k12   = alpha + beta - k10 - k21
 *
 * THE CONSISTENCY CONSTRAINT. The denominator is positive only when
 * Vss < CL/beta = V_area. That is not a numerical quirk — V_area >= Vss is a
 * theorem about two-compartment models. When a label's quoted "volume of
 * distribution" is actually V_area (which is common), feeding it in as Vss makes
 * the system insoluble, and the honest response is to say so and drop to one
 * compartment rather than to nudge a number until it fits.
 *
 * Returns null when the inputs are mutually inconsistent.
 */
export function twoCompartmentFromVss(
  v1_L: number,
  cl_L_per_min: number,
  vss_L: number,
  terminalHalfLife_min: number,
): { k10: number; k12: number; k21: number; alpha: number; beta: number; vArea_L: number } | null {
  if (v1_L <= 0 || cl_L_per_min <= 0 || terminalHalfLife_min <= 0) return null;
  const k10 = cl_L_per_min / v1_L;
  const beta = Math.LN2 / terminalHalfLife_min;
  const vArea = cl_L_per_min / beta;
  if (vss_L <= v1_L) return null;

  const denominator = 1 - (beta * (vss_L / v1_L)) / k10;
  if (denominator <= 0.02) return null; // Vss >= V_area: insoluble

  const alpha = (k10 - beta) / denominator;
  if (!Number.isFinite(alpha) || alpha <= beta) return null;

  const k21 = (alpha * beta) / k10;
  const k12 = alpha + beta - k10 - k21;
  if (k12 <= 0 || k21 <= 0) return null;

  return { k10, k12, k21, alpha, beta, vArea_L: vArea };
}

/** V_area = CL / beta. The one-compartment volume that reproduces the terminal phase. */
export function vAreaFrom(cl_L_per_min: number, terminalHalfLife_min: number): number {
  return cl_L_per_min / (Math.LN2 / terminalHalfLife_min);
}

/** Terminal half-life implied by a set of two-compartment micro constants. */
export function terminalHalfLifeOf(k10: number, k12: number, k21: number): number {
  const a = k10 + k12 + k21;
  const b = k10 * k21;
  const disc = Math.sqrt(Math.max(0, a * a - 4 * b));
  const beta = (a - disc) / 2;
  return beta > 0 ? Math.LN2 / beta : Infinity;
}

/* ------------------------------------------------------------ parse helpers */

/** Pull `1.23` out of Pulse's `"1.23 mL/min kg"` style value strings. */
/**
 * THREE-COMPARTMENT TERMINAL HALF-LIFE.
 *
 * The two-compartment form above cannot be reused for a three-compartment drug by
 * ignoring the deep compartment, because the deep compartment IS the terminal phase.
 * Doing exactly that reported fentanyl's terminal half-life as 52.6 minutes when
 * Shafer's own parameter set implies seven hours — an error of eight-fold, in the one
 * quantity that decides how long a patient stays narcotised after an infusion stops.
 *
 * The three rate constants are the negated roots of the characteristic polynomial of
 * the mamillary system,
 *
 *     y^3 - a2*y^2 + a1*y - a0 = 0
 *     a2 = k10 + k12 + k13 + k21 + k31
 *     a1 = k10*k21 + k10*k31 + k21*k31 + k12*k31 + k13*k21
 *     a0 = k10*k21*k31
 *
 * and the terminal rate is the SMALLEST of them. It is bracketed below by zero, where
 * the polynomial is -a0 < 0, and above by min(k21, k31), because no root can exceed
 * the slowest return rate; bisection on that bracket is exact to machine precision in
 * sixty iterations and cannot pick the wrong root.
 */
export function terminalHalfLifeOf3(
  k10: number, k12: number, k21: number, k13: number, k31: number,
): number {
  const a2 = k10 + k12 + k13 + k21 + k31;
  const a1 = k10 * k21 + k10 * k31 + k21 * k31 + k12 * k31 + k13 * k21;
  const a0 = k10 * k21 * k31;

  const f = (y: number) => ((y - a2) * y + a1) * y - a0;

  let lo = 0;
  let hi = Math.min(k21, k31);
  if (!(hi > 0) || f(hi) <= 0) return Infinity;

  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < 0) lo = mid;
    else hi = mid;
  }

  const gamma = (lo + hi) / 2;
  return gamma > 0 ? Math.LN2 / gamma : Infinity;
}

export function parseValueWithUnit(raw: string): { value: number; unit: string } | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^inf$/i.test(s) || /^\s*INF\b/i.test(s)) return null;
  const m = /^(-?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*(.*)$/.exec(s);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  return { value, unit: m[2].trim() };
}

export function parseNumber(raw: string): number | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------------------------ GtoPdb action -> activity */

/**
 * Map GtoPdb's `Action` vocabulary onto the schema's signed `intrinsicActivity`
 * (spec 5.3), which means three different things depending on the target's
 * `activationModel`. See ADR-025 and the doc comment on `DrugTarget`.
 *
 * WHY THE MODEL HAS TO BE PASSED IN. GtoPdb's vocabulary is the same words for a GPCR,
 * an enzyme and a transporter, and the words do not mean the same thing. "Inhibitor" at
 * a 5-HT2A receptor would be an antagonist displacing serotonin; "Inhibitor" at PDE3 is
 * the drug's entire therapeutic action and the effect vector is written for it. The
 * first version of this function took a single `isTransporter` boolean, so an enzyme
 * inhibitor came out as a neutral antagonist and the engine ran it backwards.
 *
 * THE MAGNITUDES IN THE `endogenous-agonist` BRANCH ARE CLASS PLACEHOLDERS, NOT
 * MEASUREMENTS. GtoPdb's `Action` column is a category: it says "Partial agonist", not
 * "0.35 of the endogenous maximum". Nobody measured 0.35 and it is not claimed to be
 * measured — it is the pipeline saying "partial" in the only units the engine has, and
 * it is listed as such in docs/MISSING_CONSTANTS.md. Where a drug's published efficacy
 * CONTRADICTS the raw assay label, the manifest overrides it with a citation rather
 * than the pipeline guessing better (`intrinsicActivity` in ManifestEntry). Carvedilol
 * is the case that forced this: GtoPdb labels it a partial agonist at beta-1, beta-2
 * and beta-3 from the assay it was characterised in, its own label says in as many
 * words that it has no intrinsic sympathomimetic activity, and taking the assay label
 * literally made a heart-failure drug drive the heart rate from 64 to 235.
 */
export function actionToIntrinsicActivity(
  action: string,
  type: string,
  target: ReceptorActivationModel | boolean,
): number | null {
  // This used to take `isTransporter: boolean`, which is exactly the distinction that
  // turned out to be too coarse. The boolean spelling is still accepted because the
  // unit tests that pin the vocabulary are written against it, and it maps onto the two
  // models it always meant.
  const model: ReceptorActivationModel =
    typeof target === 'boolean' ? (target ? 'transporter' : 'endogenous-agonist') : target;
  const a = `${action} ${type}`.toLowerCase();

  if (model === 'transporter') {
    // A DIRECTION, NOT AN EFFICACY. Both raise synaptic transmitter; the sign records
    // which mechanism, so a stimulant panel can show reuptake block and release apart.
    if (/substrate|releas/.test(a)) return 1;
    if (/inhibit|block|antagon/.test(a)) return -1;
    return null;
  }

  if (model === 'inhibition') {
    // A DIRECTION. <=0 drives the effect vector as written (it is written for the
    // inhibited state); >0 is an activator or channel opener and drives it backwards.
    // "Allosteric modulator / Negative" is an inhibitor; a positive modulator is not,
    // so the two are separated before the generic /allosteric/ case can swallow both.
    if (/negative/.test(a)) return 0;
    if (/activat|opener|potentiat|positive/.test(a)) return 1;
    if (/inhibit|block|antagon|inverse agonist/.test(a)) return 0;
    return null;
  }

  if (/inverse agonist/.test(a)) return -1;
  if (/partial agonist/.test(a)) return 0.35;
  if (/full agonist/.test(a)) return 1;
  if (/\bagonist\b/.test(a)) return 1;
  if (/antagonist|blocker|inhibit|channel block/.test(a)) return 0;
  if (/activator|opener|potentiat/.test(a)) return 0.6;
  if (/allosteric/.test(a)) return 0.3;
  return null;
}

/** The subset of the action vocabulary that carries a class placeholder, not a measurement. */
export function isEfficacyPlaceholder(ia: number, model: ReceptorActivationModel): boolean {
  return model === 'endogenous-agonist' && (ia === 0.35 || ia === 0.3 || ia === 0.6);
}
