import { P } from '../core/constants';
import type { SimState } from '../core/state';
import { effect } from '../core/effects';

/**
 * BLOOD CLOTTING.
 *
 * `blood.coagulation` and `blood.plateletAggregation` were declared, written - aspirin's
 * COX-1 block reaches platelet aggregation, clopidogrel's P2Y12 block reaches it
 * directly - and read by nothing, so an anticoagulated patient bled exactly like anyone
 * else. This file gives them two consumers: the coagulation screen a clinician would
 * order, and the rate at which a bleed actually stops.
 *
 * THE SCREEN. Factor activity is the bus modifier applied to normal (1 + effect), and
 * the INR is its reciprocal: a factor activity of 40 % reads as an INR of 2.5, inside the
 * therapeutic band in which vitamin K-dependent factor activity sits (`coag.inrExponent`
 * states the anchoring). The aPTT scales the same way. The honest limitation is that
 * one factor-activity number cannot distinguish the extrinsic pathway (INR, warfarin)
 * from the intrinsic one (aPTT, heparin); both move together here, and MODEL_LIMITATIONS
 * says so.
 *
 * HAEMOSTASIS. A bleed does not run at its initial rate for ever: platelets plug it and
 * fibrin stabilises the plug over minutes (normal bleeding time 1-6 min, GH14). The
 * fraction of a bleed that clot is holding builds toward a ceiling set by clotting
 * capacity, platelet function and count, and by the size of the bleed - small-vessel
 * bleeding stops, arterial bleeding largely does not. `pathology.ts` multiplies the set
 * bleed rate by (1 - haemostasis). Anticoagulate the patient first and the same wound
 * keeps bleeding, which is the lesson.
 */
export function stepCoagulation(s: SimState, dt: number): void {
  const c = s.coagulation;

  // THE SIGN OF `blood.coagulation` MEANS TWO DIFFERENT THINGS, and reading it as one
  // was a bug. A negative value is the anticoagulant direction (heparin, enoxaparin,
  // warfarin, apixaban, alteplase): fewer working clotting factors, so the factor
  // activity falls and the INR and aPTT lengthen. A positive value is the
  // ANTIFIBRINOLYTIC direction, written only by tranexamic acid: it stops plasmin
  // dissolving a clot that has already formed. It makes no new factor and shortens
  // neither PT nor aPTT, yet the old single line turned its +0.4 into a factor activity
  // of 1.4, so a gram of tranexamic acid read INR 0.60 and aPTT 18.1 s against a
  // normal 1.00 and 30.0 s. The positive part therefore no longer touches the screen; it
  // becomes `clotStability` below and acts only where a formed clot matters, the
  // bleed-stopping ceiling.
  //
  // KNOWN LIMITATION, stated rather than hidden: the two signs are summed on the bus
  // before they get here, so heparin given together with tranexamic acid nets to a
  // smaller negative number and reads a shorter aPTT than heparin alone. A separate
  // fibrinolysis target would fix that, but it means changing the generated drug data
  // through the ingest pipeline, which could not be reproduced byte for byte in this
  // environment (see the 2026 round notes), so the fix lives here and the cost is recorded
  // in MODEL_LIMITATIONS.
  const coag = effect(s, 'blood.coagulation');
  c.factorActivity = Math.max(0.05, Math.min(2, 1 + Math.min(0, coag)));
  const clotStability = 1 + Math.max(0, coag);
  c.plateletFunction = Math.max(0.05, Math.min(2, 1 + effect(s, 'blood.plateletAggregation')));

  // Platelets turn over on their eight-to-ten-day lifespan (GH14); a destructive process
  // - dengue, sepsis - lowers the steady state, and the count follows on that clock.
  const plateletTarget = P('blood.platelets_10e9_per_L') * Math.max(0.02, 1 + effect(s, 'blood.plateletCount'));
  const lifespan_s = P('blood.plateletLifespan_days') * 86400;
  c.platelets += (plateletTarget - c.platelets) * (1 - Math.exp(-dt / lifespan_s));

  const rate = s.pathology.bleedRate_mL_per_min;
  if (rate <= 0) {
    c.haemostasis = 0;
    return;
  }
  const countFactor = Math.min(1, c.platelets / 100);
  const vesselFactor = 1 / (1 + rate / P('coag.largeBleedRate_mL_per_min'));
  const ceiling = Math.max(0, Math.min(0.98, c.factorActivity * c.plateletFunction * clotStability * countFactor * vesselFactor));
  const tau_s = P('coag.bleedingTime_min') * 60;
  c.haemostasis += (ceiling - c.haemostasis) * (1 - Math.exp(-dt / tau_s));
}

/**
 * International normalised ratio from the current factor activity.
 *
 * Capped: an anticoagulant driven past the therapeutic range must not render as an
 * infinity. A real INR above about 10 is off the top of the reportable scale anyway,
 * and the clinical meaning of anything beyond it ("dangerously over-anticoagulated") is
 * already made at 10. The cap is a display bound, not a physiological claim.
 */
export function inr(s: SimState): number {
  const raw = 1 / Math.pow(Math.max(0.02, s.coagulation.factorActivity), P('coag.inrExponent'));
  return Math.min(12, raw);
}

/** Activated partial thromboplastin time, s. Capped for the same reason as the INR. */
export function aptt(s: SimState): number {
  return Math.min(240, P('blood.apttNormal_s') / Math.max(0.05, s.coagulation.factorActivity));
}
