import { P } from '../core/constants';
import type { SimState } from '../core/state';
import { effect } from '../core/effects';

/**
 * RESPIRATORY SYSTEM (spec 4.4).
 *
 * Single alveolar compartment with dead-space ventilation, gas exchange against
 * mixed venous blood, and a two-limb chemoreceptor drive.
 *
 *   alveolar ventilation  VA = (Vt - Vd) * f
 *   PACO2 = 863 * VCO2 / VA          (the alveolar ventilation equation)
 *   PAO2  = PIO2 - PACO2 / R
 *   SaO2  = Severinghaus(PaO2)
 *
 * The chemoreceptor loop is what makes an opioid overdose behave correctly: mu
 * occupancy suppresses drive, PaCO2 climbs, PaO2 falls, and the hypoxic backup
 * limb only engages below 60 mmHg — far too late to save the situation, which is
 * precisely the clinical point.
 */

/** Severinghaus (1979) O2 dissociation approximation. pO2 in mmHg, returns 0..1. */
export function severinghaus(po2: number): number {
  const p = Math.max(1e-3, po2);
  return 1 / (23400 / (p * p * p + 150 * p) + 1);
}

export function stepRespiratory(s: SimState, dt: number): void {
  const r = s.resp;
  const c = s.cardio;

  // --- chemoreceptor drive -------------------------------------------------
  const co2Drive = Math.max(
    0,
    P('resp.centralChemoGain_L_per_min_per_mmHg') * (r.arterialPco2 - P('resp.centralChemoThreshold_mmHg')),
  );

  const o2Threshold = P('resp.peripheralChemoThreshold_mmHg');
  const hypoxicFraction = r.arterialPo2 >= o2Threshold
    ? 0
    : Math.min(1, (o2Threshold - r.arterialPo2) / 30);
  const o2Drive = P('resp.peripheralChemoGain_L_per_min') * hypoxicFraction * hypoxicFraction;

  // --- the reflex saturates, and then it reverses --------------------------
  //
  // Both limbs were applied as unbounded ramps, so a PaCO2 of 52 manufactured 30 L/min
  // of drive and the two limbs together could ask for more than fifty. Nothing in the
  // body can deliver that, and the real response curve does not request it: ventilation
  // rises steeply with CO2 and then FLATTENS against the mechanics of breathing.
  //
  // The consequence was not merely a wrong number. An unbounded reflex cannot be
  // overcome by anything MULTIPLICATIVE - not a drug, not a perfusion gate - because
  // whatever fraction you multiply by, the reflex simply climbs until the product is
  // back at baseline. That is why a pulseless body went on breathing: drive was being
  // scaled by 0.14 and the reflex was generating fifty.
  //
  // Saturating hyperbola rather than a hard clamp, so the curve stays smooth and its
  // slope near the origin is still the published one - it bends, it does not corner.
  const ceiling = P('resp.chemoVentilationCeiling_L_per_min');
  const rawChemo = co2Drive + o2Drive;
  const chemoDrive = (ceiling * rawChemo) / (ceiling + rawChemo);

  // CO2 NARCOSIS. The stimulant and the narcotic are the same molecule at different
  // tensions: above the threshold, carbon dioxide depresses the respiratory centre it
  // was driving, and by the abolished tension the drive is gone. Without this limb the
  // model says the more CO2 you retain the harder you breathe, for ever, which gets
  // the endgame of any hypercapnic respiratory failure exactly wrong.
  const narcosisFrom = P('resp.co2NarcosisThreshold_mmHg');
  const narcosisTo = P('resp.co2NarcosisAbolished_mmHg');
  const narcosis = Math.max(0, Math.min(1, (narcosisTo - r.arterialPco2) / (narcosisTo - narcosisFrom)));

  // --- the brainstem has to be perfused to do any of this ------------------
  //
  // THE BUG THIS FIXES: a body in cardiac arrest went on breathing, and breathing
  // HARDER, indefinitely. Nothing clears CO2 without a circulation, so `co2Drive`
  // climbs without limit and the hypoxic limb engages on top of it; both push the
  // same way, and drive had no term that could push back. The simulator showed a
  // pulseless patient ventilating calmly, which teaches the single most important
  // recognition cue in an arrest exactly backwards - "not breathing normally" is a
  // criterion for starting CPR.
  //
  // `driveScale` existed in the state for this from the beginning, was initialised to
  // 1, was read on the line below, and was never written by anything in the codebase.
  // It was a hook left for this job and never connected.
  //
  // NO NEW CONSTANT. The ramp is expressed in the cited syncope threshold the neuro
  // system already uses: above it the brainstem is perfused and drive is untouched;
  // below it drive falls with flow and reaches zero when flow does. That the cortex
  // fails first and the brainstem keeps going a little longer is exactly what the
  // ordering says - consciousness is already gone at the top of this ramp.
  //
  // The ONSET is emergent rather than chosen. `n.cbf` follows its target with a 3 s
  // lag and `r.drive` follows this one with a 15 s lag, so ventilation fades over
  // tens of seconds rather than stopping the instant the pulse does - which is the
  // observed picture, agonal gasps included.
  //
  // It is deliberately keyed to PERFUSION, not to the arrest rhythm. Profound shock
  // and a critically low cardiac output produce the same failure by the same route,
  // and a special case for `rhythm === 'asystole'` would have covered one of them.
  const syncope = P('neuro.consciousnessLossCBF_fraction');
  const cbfFraction = s.neuro.cbf / P('neuro.cerebralBloodFlow_mL_per_min');
  r.driveScale = Math.max(0, Math.min(1, cbfFraction / syncope));

  const baselineDrive = (P('resp.rate_per_min') * P('resp.tidalVolume_mL')) / 1000;
  const targetDrive = (baselineDrive + chemoDrive) * narcosis * r.driveScale * (1 + effect(s, 'resp.drive'));

  // Ventilatory drive changes over ~15 s, not instantly.
  r.drive += ((targetDrive - r.drive) * dt) / 15;
  r.drive = Math.max(0, r.drive);

  // --- split drive into rate and depth -------------------------------------
  // Below ~10 L/min a human raises tidal volume; above it, rate. This split is what
  // keeps dead-space ventilation realistic across the range.
  const driveRatio = r.drive / baselineDrive;
  let rate = P('resp.rate_per_min') * Math.pow(Math.max(0.01, driveRatio), 0.55) * (1 + effect(s, 'resp.rate'));
  let vt = P('resp.tidalVolume_mL') * Math.pow(Math.max(0.01, driveRatio), 0.45) * (1 + effect(s, 'resp.tidalVolume'));

  if (r.intubated) {
    // Controlled ventilation: fixed, adequate, and independent of drive.
    rate = 14;
    vt = 500;
  }

  rate = Math.max(0, Math.min(60, rate));
  vt = Math.max(0, Math.min(1400, vt));
  r.apnoeic = rate < 1.5 || vt < 60;

  r.rate = rate;
  r.tidalVolume = vt;
  r.period = rate > 0.1 ? 60 / rate : 1e6;

  // --- breath cycle --------------------------------------------------------
  r.cycleT += dt;
  if (r.cycleT >= r.period) r.cycleT -= r.period;
  const phase = r.cycleT / r.period;
  const iFrac = P('resp.inspiratoryFraction');
  // Inspiration: a raised half-sine. Expiration: passive exponential decay.
  const inflation = phase < iFrac
    ? 0.5 - 0.5 * Math.cos((Math.PI * phase) / iFrac)
    : Math.exp(-(phase - iFrac) / (0.28 * (1 - iFrac)));
  r.lungVolume = P('resp.frc_mL') + vt * inflation * (r.apnoeic ? 0 : 1);

  // --- gas exchange --------------------------------------------------------
  const deadSpace = P('resp.deadSpace_mL');
  const alveolarVentilation_L_per_min = (Math.max(0, vt - deadSpace) * rate) / 1000;

  const vco2 = P('resp.vco2_mL_per_min') * metabolicScale(s);
  const vo2 = P('resp.vo2_mL_per_min') * metabolicScale(s);

  // Alveolar ventilation equation. Below a floor the equation blows up, so the
  // apnoeic case is integrated as CO2 accumulation in the body stores instead.
  const MIN_VA = 0.2;
  let targetPaco2: number;
  if (alveolarVentilation_L_per_min > MIN_VA) {
    targetPaco2 = (863 * (vco2 / 1000)) / alveolarVentilation_L_per_min;
  } else {
    // Apnoea: PaCO2 rises ~3 mmHg in the first minute then ~3.5 mmHg/min thereafter.
    targetPaco2 = r.arterialPco2 + 3.5 * (dt / 60) * 60;
  }
  targetPaco2 = Math.min(180, targetPaco2);

  // Body CO2 stores are large, so PaCO2 moves with a time constant of tens of
  // seconds, not instantly. This is why apnoea takes minutes, not seconds, to kill.
  const CO2_TAU_S = 35;
  r.arterialPco2 += ((targetPaco2 - r.arterialPco2) * dt) / CO2_TAU_S;
  r.alveolarPco2 = r.arterialPco2;
  r.etco2 = r.arterialPco2 * 0.95;

  // Alveolar gas equation, respiratory quotient 0.8.
  const RQ = vco2 / Math.max(1, vo2);
  const fio2 = r.intubated ? 1.0 : 0.2095;
  const pio2 = fio2 * (760 - 47);
  const targetPao2 = Math.max(5, pio2 - r.alveolarPco2 / Math.max(0.5, RQ));
  r.alveolarPo2 = targetPao2;

  // A-a gradient. Oxygen stores are tiny compared with CO2 stores, so PaO2 tracks
  // alveolar gas within a few seconds. That asymmetry is the whole reason
  // pre-oxygenation works and hyperventilation does not buy you time.
  const O2_TAU_S = 6;
  const aaGradient = 10;
  const ventilatedPo2 = Math.max(5, r.alveolarPo2 - aaGradient);

  // LOW CARDIAC OUTPUT WIDENS THE EFFECTIVE SHUNT.
  //
  // This must move the TARGET and the time constant, not scale the state. An
  // earlier version multiplied the current PaO2 by (1 - shunt) on every tick, which
  // at 100 Hz is a 33 % reduction a hundred times a second: saturation reached 0.2 %
  // within six seconds of a cardiac arrest. Real desaturation after an arrest takes
  // a minute or two, because it is limited by the body's oxygen stores rather than
  // by anything instantaneous.
  const shunt = c.co < 3.0 ? Math.min(0.95, (3.0 - c.co) / 3.0) : 0;
  const target = ventilatedPo2 * (1 - shunt);
  // Without a circulation there is nothing to equilibrate the blood, so the
  // approach slows as output falls: seconds when perfused, a minute and a half in
  // full arrest.
  const tau = O2_TAU_S + shunt * 90;
  r.arterialPo2 += ((Math.max(4, target) - r.arterialPo2) * dt) / tau;

  r.spo2 = severinghaus(r.arterialPo2);

  // Mixed venous values, from the Fick relation against cardiac output.
  const caO2 = oxygenContent(r.spo2, r.arterialPo2, s.chem.hct);
  const cvO2 = Math.max(2, caO2 - vo2 / Math.max(500, c.co * 1000) * 100);
  r.venousPo2 = invSeveringhausApprox(cvO2 / Math.max(1e-6, oxygenCapacity(s.chem.hct)));
  r.venousPco2 = r.arterialPco2 + 6;
}

/** Oxygen carrying capacity, mL O2 per 100 mL blood. */
function oxygenCapacity(hct: number): number {
  const hb = (hct / 0.45) * 15; // g/dL, scaled from the reference haematocrit
  return hb * 1.34;
}

/** Arterial oxygen content, mL O2 per 100 mL blood, bound plus dissolved. */
export function oxygenContent(sat: number, po2: number, hct: number): number {
  return oxygenCapacity(hct) * sat + 0.003 * po2;
}

/** Crude inverse of the dissociation curve, used only for the venous point. */
function invSeveringhausApprox(sat: number): number {
  const s = Math.max(0.01, Math.min(0.999, sat));
  // Hill inverse with n = 2.7, P50 = 26.8 mmHg.
  return 26.8 * Math.pow(s / (1 - s), 1 / 2.7);
}

/** Metabolic rate scaling from temperature and stimulant thermogenesis. */
function metabolicScale(s: SimState): number {
  // Q10 = 2.0 for human metabolic rate over the physiological range.
  const q10 = Math.pow(2.0, (s.metabolic.coreTemp - 37) / 10);
  return q10 * (1 + effect(s, 'thermal.heatProduction'));
}
