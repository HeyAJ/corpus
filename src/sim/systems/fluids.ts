import { P } from '../core/constants';
import type { SimState } from '../core/state';

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
  const plasmaTarget = P('blood.totalVolume_mL') * (1 - P('blood.haematocrit'));
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

  f.balance_mL += intake - insensible - (s.renal.urineRate * dtMin);
}

/** Remove or add fluid directly to the interstitium (oedema, dehydration scenarios). */
export function addInterstitial(s: SimState, mL: number): void {
  s.fluids.interstitial = Math.max(0, s.fluids.interstitial + mL);
}
