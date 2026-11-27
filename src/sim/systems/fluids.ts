import { P } from '../core/constants';
import type { SimState } from '../core/state';
import { effect } from '../core/effects';
import { referenceBloodVolume } from '../core/body';
import { R } from './reproductive';

/**
 * BODY FLUID BALANCE.
 *
 * This module exists because of a test failure, and it is worth saying why.
 *
 * The 24-hour homeostasis test (spec 12) showed circulating volume falling from
 * 5000 mL to 3949 mL over a simulated day. The cause was not an integrator bug: the
 * kidney was correctly removing about 1.4 L of urine, and nothing was putting any
 * water back. The body was slowly and accurately dying of thirst.
 *
 * The fix is the compartment that was missing. Plasma volume in a real body is
 * defended by the interstitium, which holds roughly 11 L and exchanges with plasma
 * across the capillary wall over tens of minutes. Add that compartment, balance
 * obligate intake against obligate loss, and the day-long drift disappears — not
 * because a fudge factor cancels it, but because the mechanism that prevents it in
 * a real body is now present.
 *
 * It pays for itself immediately elsewhere:
 *   - after a haemorrhage, plasma volume partly recovers over the next half hour
 *     with no fluid given, which is transcapillary refill and is what actually
 *     happens;
 *   - a loop diuretic now produces hypovolaemia by draining the interstitium, which
 *     is the mechanism by which it really does.
 *
 * The body is modelled as drinking to thirst rather than on a schedule: obligate
 * intake is a constant that matches obligate output at baseline. That is an
 * approximation and it is recorded in docs/MODEL_LIMITATIONS.md.
 */

export function stepFluids(s: SimState, dt: number): void {
  const dtMin = dt / 60;
  const f = s.fluids;

  // --- obligate turnover ---------------------------------------------------
  const intake = P('fluid.obligateIntake_mL_per_min') * dtMin;
  const insensible = P('fluid.insensibleLoss_mL_per_min') * dtMin;
  f.interstitial += intake - insensible;

  stepVolumeExpansion(s, dt);

  // --- transcapillary refill ----------------------------------------------
  // Plasma volume is defended toward its baseline by exchange with the
  // interstitium. The gradient is the plasma deficit; the rate is first-order with
  // the published restitution time constant.
  const plasma = s.cardio.bloodVolume * (1 - s.chem.hct);
  // Raised by the expansion the bus has asked for and fluids has achieved (pregnancy), so
  // the refill defends the NEW plasma volume instead of draining it back to the old one.
  const plasmaTarget = referenceBloodVolume(s) * (1 - P('blood.haematocrit')) + f.plasmaExpansion_mL;
  const deficit = plasmaTarget - plasma;

  const tau = P('fluid.transcapillaryRefillTau_min');
  let shift = (deficit / tau) * dtMin;

  // The interstitium is finite. It cannot give what it does not have, and it will
  // not be drained below half its baseline volume — past that point a real body is
  // in profound shock and the model has nothing useful left to say (see
  // docs/MODEL_LIMITATIONS.md).
  const floor = P('fluid.interstitialVolume_mL') * 0.5;
  if (shift > 0) shift = Math.min(shift, Math.max(0, f.interstitial - floor));

  f.interstitial -= shift;
  s.cardio.veins.V += shift;
  // PLASMA LEAVING THE VESSELS CARRIES ITS ELECTROLYTES. When the circulation is over-full
  // (after an infusion) the surplus crosses the capillary wall as plasma ultrafiltrate,
  // taking its sodium, potassium and chloride with it. Left untagged,
  // `rebalanceElectrolytes` read that outflow as plasma WATER being lost and concentrated
  // the serum sodium by about 4 mEq/L on top of the infusion itself (a litre of normal
  // saline read 146.8 instead of the ~142.8 mass balance gives). It is tagged so the
  // electrolytes ignore it, while the haematocrit and albumin, which the fluid does not
  // carry, still move with it.
  //
  // ONLY THE OUTWARD DIRECTION IS TAGGED, and that asymmetry is a stated model choice, not
  // physiology. The model has no renal sodium excretion, so the resting kidney's urine
  // is, to the electrolytes, a loss of free water, and it is the INWARD refill from the
  // interstitium that exactly offsets it. Tagging the inward refill as well removed that
  // balance and a resting body drifted from 142 to 157 mEq/L sodium in 24 hours (this
  // change was tried and measured, and failed the 24 h homeostasis test). Until the kidney
  // excretes solute, the inward refill must keep diluting as it always did.
  if (shift < 0) s.cardio.solutedShift_mL += shift;

  // --- capillary leak ------------------------------------------------------
  //
  // `vascular.permeability` was a declared, written, unread target: the inflammation of
  // pathology.ts, sepsis and anaphylaxis all pushed onto it and nothing moved. A leaky
  // capillary loses plasma into the interstitium, and it is that loss - not the
  // vasodilation alone - that makes distributive shock so hard to fill. The leak is the
  // transcapillary gradient driven the OTHER way, into the interstitium, scaled by the
  // permeability the bus reports. It is the same conductance the refill uses, so a body
  // with no permeability effect behaves exactly as before.
  const permeability = Math.max(0, effect(s, 'vascular.permeability'));
  if (permeability > 0) {
    const leak = (referenceBloodVolume(s) * 0.02 * permeability) * dtMin;
    const moved = Math.min(leak, Math.max(0, s.cardio.veins.V - 50));
    s.cardio.veins.V -= moved;
    f.interstitial += moved;
    s.cardio.targetBloodVolume = Math.max(500, s.cardio.targetBloodVolume - moved);
    // Leaked plasma carries its electrolytes (same reasoning as the refill above).
    s.cardio.solutedShift_mL -= moved;
  }

  // --- non-urine fluid losses: diarrhoea and sweat -------------------------
  //
  // Both leave the BODY, not just the circulation, and both carry electrolytes, so
  // they change serum chemistry as well as volume. Diarrhoea comes from the bus
  // (cholera, gastroenteritis write gi.diarrhoea_mL_per_min); sweat comes from the
  // thermal system, which sets `metabolic.sweatRate_mL_per_min` when the body is shedding
  // heat. Their electrolyte compositions differ - stool is nearly isotonic and rich in
  // bicarbonate and potassium, sweat is hypotonic - so they pull serum chemistry in
  // opposite directions, which is the whole clinical difference between them.
  const diarrhoea = Math.max(0, effect(s, 'gi.diarrhoea_mL_per_min'));
  const sweat = s.metabolic.sweatRate_mL_per_min;
  s.fluidLossRate_mL_per_min = diarrhoea + sweat;

  if (diarrhoea > 0) {
    const mL = diarrhoea * dtMin;
    const removed = Math.min(mL, Math.max(0, s.cardio.veins.V - 50));
    loseFluidWithElectrolytes(s, removed, P('fluid.stoolNa_mEq_per_L'), P('fluid.stoolK_mEq_per_L'), P('fluid.stoolHco3_mEq_per_L'));
    f.balance_mL -= removed;
  }
  if (sweat > 0) {
    const mL = sweat * dtMin;
    const removed = Math.min(mL, Math.max(0, s.cardio.veins.V - 50));
    loseFluidWithElectrolytes(s, removed, P('fluid.sweatNa_mEq_per_L'), 0, 0);
    f.balance_mL -= removed;
  }

  // --- haemolysis ----------------------------------------------------------
  // A haemolytic pathogen (malaria) destroys red cells, and the haematocrit falls. The
  // volume stays - the cells lyse in place - so this lowers Hct without changing blood
  // volume, which is the anaemia of a haemolytic infection.
  const haemolysis = Math.max(0, effect(s, 'blood.haemolysis_per_h'));
  if (haemolysis > 0) {
    s.chem.hct = Math.max(0.1, s.chem.hct - s.chem.hct * haemolysis * (dt / 3600));
    s.infection.haemolysed += haemolysis * (dt / 3600);
  }

  f.balance_mL += intake - insensible - (s.renal.urineRate * dtMin);
}

/**
 * PLASMA VOLUME AND RED-CELL MASS EXPANSION (the `blood.plasmaVolume` and
 * `blood.redCellMass` bus targets; written by the pregnancy adaptations).
 *
 * Both targets are fractions of the model's reference volumes. The ACHIEVED expansion is
 * held in FluidState and chases `reference x target` with a short pacing constant (the
 * target itself moves over weeks of gestation; the constant only keeps the change smooth
 * from tick to tick). The difference is added as ISOTONIC volume, exactly as cardio.ts
 * addVolume does, so serum electrolytes are not diluted; haematocrit follows by mass
 * balance (red cells added over the new total), which is why plasma expands more than
 * cells and the haematocrit falls. With both targets at zero and nothing achieved, this
 * function does nothing at all and the body behaves exactly as before.
 */
function stepVolumeExpansion(s: SimState, dt: number): void {
  const f = s.fluids;
  const pT = effect(s, 'blood.plasmaVolume');
  const rT = effect(s, 'blood.redCellMass');
  if (pT === 0 && rT === 0 && f.plasmaExpansion_mL === 0 && f.redCellExpansion_mL === 0) return;

  const refV = referenceBloodVolume(s);
  const hct0 = P('blood.haematocrit');
  const k = 1 - Math.exp(-dt / R('pregnancy.plasmaPacingTau_s'));
  const dP = (refV * (1 - hct0) * pT - f.plasmaExpansion_mL) * k;
  const dR = (refV * hct0 * rT - f.redCellExpansion_mL) * k;
  f.plasmaExpansion_mL += dP;
  f.redCellExpansion_mL += dR;
  if (Math.abs(f.plasmaExpansion_mL) < 1e-6 && pT === 0) f.plasmaExpansion_mL = 0;
  if (Math.abs(f.redCellExpansion_mL) < 1e-6 && rT === 0) f.redCellExpansion_mL = 0;

  const d = dP + dR;
  const total = Math.max(1, s.cardio.bloodVolume);
  s.cardio.veins.V += d;
  s.cardio.targetBloodVolume += d;
  s.cardio.isotonicDelta_mL += d;
  s.chem.hct = Math.max(0.1, Math.min(0.7, (s.chem.hct * total + dR) / (total + d)));
}

/** Remove fluid from the circulation carrying the stated electrolyte concentrations. */
function loseFluidWithElectrolytes(s: SimState, mL: number, na: number, k: number, hco3: number): void {
  if (mL <= 0) return;
  const ecf_L = s.body.mass_kg * 0.2;
  s.cardio.veins.V -= mL;
  s.cardio.targetBloodVolume = Math.max(500, s.cardio.targetBloodVolume - mL);
  // The fluid carried these ions out of the body; removing them from the ECF pool
  // changes the concentration of what remains. A near-isotonic loss barely moves
  // sodium; a hypotonic loss (sweat) concentrates it.
  const L = mL / 1000;
  s.chem.na -= ((na - s.chem.na) * L) / ecf_L;
  s.chem.k = Math.max(0.5, s.chem.k - ((k - s.chem.k) * L) / ecf_L);
  s.acidBase.metabolicHco3 = Math.max(2, s.acidBase.metabolicHco3 - ((hco3 - s.acidBase.metabolicHco3) * L) / ecf_L);
}

/** Empty the bladder. */
export function voidBladder(s: SimState): void {
  s.renal.bladderVolume = 0;
}

/** Remove or add fluid directly to the interstitium (oedema, dehydration scenarios). */
export function addInterstitial(s: SimState, mL: number): void {
  s.fluids.interstitial = Math.max(0, s.fluids.interstitial + mL);
}
