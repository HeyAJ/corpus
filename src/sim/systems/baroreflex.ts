import { P } from '../core/constants';
import type { SimState } from '../core/state';
import { addEffect } from '../core/effects';
import { B } from './activity';

/**
 * ARTERIAL BAROREFLEX — Ursino-style two-limb reflex (spec 4.2).
 *
 * "This reflex is what makes the whole thing feel alive." Without it, a drug
 * produces a step change; with it, you get the overshoot-and-settle curve that a
 * real body produces, because the two efferent limbs have very different speeds:
 * the vagal limb responds within a beat or two (tau 1.5 s) while the sympathetic
 * limb takes the better part of ten seconds (tau 7 s).
 *
 *   carotid pressure --sigmoid--> afferent firing --+--> vagal  limb (fast)
 *                                                   +--> symp   limb (slow)
 *
 * The sympathetic limb is *inhibited* by baroreceptor firing and the vagal limb is
 * *driven* by it, so at the set point both sit at 0.5 and the reflex is silent.
 *
 * The baroreceptor sees a lightly-filtered *instantaneous* aortic pressure rather
 * than MAP. That matters: the sigmoid is non-linear, so pulse pressure rectifies
 * through it. A body with a narrow pulse pressure at the same MAP gets more
 * sympathetic drive, which is the real behaviour.
 */

const SENSE_TAU_S = 0.3;

export function stepBaroreflex(s: SimState, dt: number): void {
  const r = s.reflex;
  const c = s.cardio;

  // --- afferent ------------------------------------------------------------
  r.sensedPressure += ((c.aorta.P - r.sensedPressure) * dt) / SENSE_TAU_S;

  // EXERCISE RESETS THE OPERATING POINT UPWARD. Central command and the exercise pressor
  // reflex carry the baroreflex to a higher defended pressure, so the reflex sits near
  // neutral at the raised exercising pressure instead of reading the intended vasodilation
  // as hypotension and cranking heart rate to fight it (see activity.ts). Proportional to
  // actual exertion, so it fades out with recovery exactly as the tachycardia does.
  const pn = P('baroreflex.setpoint_mmHg') + B('exercise.baroreflexResetting') * s.activity.exertion;
  const ka = P('baroreflex.sigmoidWidth_mmHg');
  const fMin = P('baroreflex.afferentMin_Hz');
  const fMax = P('baroreflex.afferentMax_Hz');

  const x = (r.sensedPressure - pn) / ka;
  // Guard the exponential: at |x| > 40 the sigmoid is saturated to float precision.
  const ex = Math.exp(Math.max(-40, Math.min(40, x)));
  const fCs = (fMin + fMax * ex) / (1 + ex);
  r.afferent = (fCs - fMin) / (fMax - fMin); // 0..1, 0.5 at the set point

  // --- pure transport delays ----------------------------------------------
  const sympTarget = 1 - r.afferent;
  const vagalTarget = r.afferent;

  r.sympDelayLine[r.sympIdx] = sympTarget;
  r.sympIdx = (r.sympIdx + 1) % r.sympDelayLine.length;
  const delayedSymp = r.sympDelayLine[r.sympIdx];

  r.vagalDelayLine[r.vagalIdx] = vagalTarget;
  r.vagalIdx = (r.vagalIdx + 1) % r.vagalDelayLine.length;
  const delayedVagal = r.vagalDelayLine[r.vagalIdx];

  // --- first-order efferent lags ------------------------------------------
  r.symp += ((delayedSymp - r.symp) * dt) / P('baroreflex.sympTau_s');
  r.vagal += ((delayedVagal - r.vagal) * dt) / P('baroreflex.vagalTau_s');

  r.symp = Math.max(0, Math.min(1, r.symp));
  r.vagal = Math.max(0, Math.min(1, r.vagal));

  // --- efferent effects ----------------------------------------------------
  // HR is applied in cardio.ts (it needs the intrinsic rate). Contractility and
  // resistance are written straight onto the state scales; renin goes on the bus.
  const tone = (r.symp - 0.5) * 2; // -1..+1
  c.contractilityScale = 1 + P('baroreflex.gainContractility') * tone;
  c.svrScale = 1 + P('baroreflex.gainResistance') * tone;

  addEffect(s.effects, 'renal.reninRelease', 0.4 * tone);
}
