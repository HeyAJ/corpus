import { P } from '../core/constants';
import type { SimState } from '../core/state';
import { effect } from '../core/effects';
import { referenceBloodVolume } from '../core/body';

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

  // --- transcapillary refill ----------------------------------------------
  // Plasma volume is defended toward its baseline by exchange with the
  // interstitium. The gradient is the plasma deficit; the rate is first-order with
  // the published restitution time constant.
  const plasma = s.cardio.bloodVolume * (1 - s.chem.hct);
  const plasmaTarget = referenceBloodVolume(s) * (1 - P('blood.haematocrit'));
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
