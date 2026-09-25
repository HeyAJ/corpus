import { P } from './constants';
import type { SimState } from './state';

/**
 * THE SIZE OF THIS BODY.
 *
 * Every sourced constant in physiology.json describes the reference adult: 70 kg,
 * 1.73 m. `SET_BODY` has always let the operator change the mass, height, age and sex,
 * and until this file existed it changed almost nothing - a round-1 tester measured a
 * 30 kg and a 200 kg subject producing byte-identical heart rates, pressures and drug
 * levels after the same absolute dose. A dose that is right for one of them is a tenth
 * of an overdose or three times one for the other, and that is exactly the lesson a
 * weight slider is for.
 *
 * So drug disposition now scales with mass by a published rule, not a fitted number
 * (the circulation itself does not - see referenceBloodVolume for why):
 *
 *   - DRUG DISPOSITION follows allometry: volumes of distribution scale with mass to the
 *     power 1, clearances to the power 0.75, so every first-order rate constant
 *     (clearance over volume) scales with mass to the -0.25. A heavier body dilutes the
 *     same dose into more volume and clears it a little more slowly per litre.
 *
 * At the reference mass every factor here is exactly 1, so the resting baseline and
 * every existing test are unchanged by construction.
 */

/** Body mass relative to the reference adult. */
export function massRatio(s: SimState): number {
  return s.body.mass_kg / P('body.mass_kg');
}

/**
 * The blood volume the circulation is built around, mL.
 *
 * DELIBERATELY NOT SCALED BY MASS, and this is a measured decision rather than an
 * omission. The first version of this file scaled it, and a 45 kg subject went straight
 * into shock while a 120 kg one became hypertensive at rest: the circulation's
 * compliances, unstressed volumes and chamber elastances (physiology.json, cardio.*) are
 * sourced for the reference adult, and pouring a different volume into the same vessels
 * is a haemorrhage or an overload, not a different-sized person. Scaling the whole
 * circuit consistently is a larger change than this; until it is made the circulation
 * stays the reference size and mass acts on drug disposition, which is where it matters
 * most for dosing. docs/MODEL_LIMITATIONS.md records it.
 */
export function referenceBloodVolume(s: SimState): number {
  void s;
  return P('blood.totalVolume_mL');
}

/** Multiplier on a drug's volumes of distribution. */
export function volumeScale(s: SimState): number {
  return Math.pow(massRatio(s), P('pk.allometricVolumeExponent'));
}

/** Multiplier on a drug's first-order rate constants (clearance / volume). */
export function rateConstantScale(s: SimState): number {
  return Math.pow(massRatio(s), P('pk.allometricClearanceExponent') - P('pk.allometricVolumeExponent'));
}

/** Multiplier on a saturable (Michaelis-Menten) maximal elimination rate. */
export function clearanceScale(s: SimState): number {
  return Math.pow(massRatio(s), P('pk.allometricClearanceExponent'));
}
