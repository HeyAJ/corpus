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
  // THE METABOLIC LIMB. The chemoreceptors answer hydrogen ions, not CO2 as such, so a
  // metabolic acidosis drives ventilation with PaCO2 unchanged - Kussmaul breathing -
  // and an alkalosis damps it. Carried as an equivalent shift of the CO2 stimulus,
  // calibrated so the steady-state compensation lands on the published slopes (PaCO2
  // falls 1.2 mmHg per mEq/L of bicarbonate lost, rises 0.7 per mEq/L gained; Adrogue
  // and Madias 1998). Before this existed a lactic acidosis left breathing untouched.
  const stimulusPco2 = r.arterialPco2 + metabolicAcidStimulus(s);
  const co2Drive = Math.max(
    0,
    P('resp.centralChemoGain_L_per_min_per_mmHg') * (stimulusPco2 - P('resp.centralChemoThreshold_mmHg')),
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
  //
  // OXYGEN DELIVERY, NOT FLOW. The brainstem fails when it runs out of oxygen, and it
  // can run out with a perfectly good blood flow if the blood carries none. So the gate
  // is cerebral oxygen DELIVERY - flow times arterial oxygen content, both relative to
  // normal - which is identical to the flow gate whenever saturation is normal and
  // additionally captures the secondary apnoea of severe hypoxaemia: respiratory drive
  // collapses once the brainstem itself is hypoxic, which is how an untreated
  // hypoxaemic patient stops breathing even before the heart stops.
  const syncope = P('neuro.consciousnessLossCBF_fraction');
  const cbfFraction = s.neuro.cbf / P('neuro.cerebralBloodFlow_mL_per_min');
  const o2ContentFraction = r.arterialO2Content / REFERENCE_CAO2;
  r.driveScale = Math.max(0, Math.min(1, (cbfFraction * Math.min(1, o2ContentFraction)) / syncope));

  const baselineDrive = (P('resp.rate_per_min') * P('resp.tidalVolume_mL')) / 1000;
  const targetDrive = (baselineDrive + chemoDrive) * narcosis * r.driveScale * Math.max(0, 1 + effect(s, 'resp.drive'));

  // Ventilatory drive changes over ~15 s, not instantly.
  r.drive += ((targetDrive - r.drive) * dt) / 15;
  r.drive = Math.max(0, r.drive);

  // --- split drive into rate and depth -------------------------------------
  // Below ~10 L/min a human raises tidal volume; above it, rate. This split is what
  // keeps dead-space ventilation realistic across the range.
  const driveRatio = r.drive / baselineDrive;
  let rate = P('resp.rate_per_min') * Math.pow(Math.max(0.01, driveRatio), 0.55) * (1 + effect(s, 'resp.rate'));

  // AIRWAY CALIBRE. `resp.tidalVolume` carries airway calibre and neuromuscular
  // capacity (see effects.ts). Where the airway is actively narrowed - asthma, the
  // mast-cell discharge of anaphylaxis - a positive calibre effect (a beta-2 agonist,
  // adrenaline) is spent RELIEVING the narrowing first, and only what is left over
  // widens a normal airway. That ordering is why salbutamol transforms an asthmatic's
  // breathing and does next to nothing to a healthy person's.
  const calibre = effect(s, 'resp.tidalVolume');
  const rawConstriction = s.airway.constriction;
  const relief = Math.max(0, calibre);
  const constriction = Math.max(0, rawConstriction - relief);
  r.bronchoconstriction = constriction;
  const calibreFactor = calibre > 0 ? 1 + Math.max(0, calibre - rawConstriction) : 1 + calibre;
  let vt = P('resp.tidalVolume_mL') * Math.pow(Math.max(0.01, driveRatio), 0.45) * calibreFactor;
  // Narrowed airways cut the volume each breath can move. The residual narrowing (after
  // bronchodilators) is what reaches here; 1 is a closed airway.
  vt *= Math.max(0, 1 - constriction);

  // NEUROMUSCULAR CAPACITY. A paralysed patient has enormous drive and no ventilation;
  // negative muscle tone is weakness down to flaccid paralysis at -1, and it removes
  // the respiratory muscles along with every other skeletal muscle. Rigidity (positive
  // tone) stiffens the chest wall - the fentanyl "wooden chest" - and costs volume too,
  // but only once it is marked.
  const tone = s.mind.muscleTone;
  if (tone < 0) {
    // Weakness is a CEILING on what the muscle can move, not a scaling of the drive. A
    // paralysed patient cannot answer air hunger by breathing deeper - the diaphragm is
    // the limit - so tidal volume is capped at the fraction of normal the remaining
    // strength allows, however hard the chemoreceptors push. At a near-complete block the
    // cap falls below the dead space and no fresh gas reaches the alveoli at all, which is
    // exactly why a paralysed patient who is not ventilated asphyxiates.
    vt = Math.min(vt, P('resp.tidalVolume_mL') * Math.max(0, 1 + tone));
  } else if (tone > 0.5) {
    vt *= Math.max(0.2, 1 - (tone - 0.5));
  }

  if (r.intubated) {
    // Controlled ventilation: fixed, adequate, and independent of drive, muscle tone
    // and the patient's own attempts to breathe. Bronchospasm still costs delivered
    // volume, because a ventilator pushing into closed airways does not ventilate them.
    rate = 14;
    vt = 500 * Math.max(0.2, 1 - 0.8 * constriction);
  }

  rate = Math.max(0, Math.min(60, rate));
  vt = Math.max(0, Math.min(1400, vt));
  r.apnoeic = rate < 1.5 || vt < 60;
  if (r.apnoeic) {
    rate = rate < 1.5 ? 0 : rate;
  }

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
  const alveolarVentilation_L_per_min = r.apnoeic ? 0 : (Math.max(0, vt - deadSpace) * rate) / 1000;

  const vco2 = P('resp.vco2_mL_per_min') * metabolicScale(s);
  const vo2 = P('resp.vo2_mL_per_min') * metabolicScale(s);
  const dtMin = dt / 60;

  // CARBON DIOXIDE.
  //
  // THE APNOEA BUG. The apnoeic branch used to set its TARGET to the current value plus
  // a per-tick increment and then feed that target through the 35 s lag below - which
  // multiplied by dt a second time. The realised rise was 0.1*dt^2 per tick, sixty
  // times slower than the 3.5 mmHg/min the comment promised, and because PaO2 was then
  // derived algebraically from PaCO2, oxygen froze with it. A body that had stopped
  // breathing held its saturation at 93 % for as long as anyone watched, its heart
  // beating normally: exactly the "lungs have stopped and the heart carries on" that
  // was reported.
  //
  // The fix is a mass balance with the whole-body CO2 store as its capacitance. When
  // ventilation removes less CO2 than metabolism makes, PaCO2 rises at the rate the
  // store allows - 3.4 mmHg/min in complete apnoea, as measured - and no faster,
  // whatever the ventilation equation's target says. A FALL is still governed by the
  // fast lag, because washing CO2 out of the lung is quick. Near-apnoeic
  // hypoventilation and true apnoea now rise at continuous rates rather than seventy-
  // fold apart.
  const TAU_CO2_S = 35;
  const targetPaco2 = alveolarVentilation_L_per_min > 0.05
    ? Math.min(180, (863 * (vco2 / 1000)) / alveolarVentilation_L_per_min)
    : 180;
  let dPaco2 = (targetPaco2 - r.arterialPco2) / TAU_CO2_S;
  if (dPaco2 > 0) {
    const retained_L_per_min = vco2 / 1000 - (alveolarVentilation_L_per_min * r.arterialPco2) / 863;
    const storeLimited = (P('resp.co2Capacitance_mmHg_per_L') * Math.max(0, retained_L_per_min)) / 60;
    dPaco2 = Math.min(dPaco2, storeLimited);
  }
  r.arterialPco2 = Math.max(5, Math.min(180, r.arterialPco2 + dPaco2 * dt));
  r.alveolarPco2 = r.arterialPco2;
  r.etco2 = r.apnoeic ? 0 : r.arterialPco2 * 0.95;

  // OXYGEN: THREE STORES, ONE BALANCE.
  //
  // Alveolar gas, arterial blood and venous blood each hold oxygen, and the time it
  // takes an apnoeic body to desaturate is the time it takes metabolism to draw those
  // stores down. That is why pre-oxygenation buys eight minutes and room air one or
  // two: it fills the biggest store, the FRC, with oxygen instead of nitrogen.
  //
  //   alveolar:  V_L dPA/dt = VA (PIO2 - PA) - uptake (PB - 47)
  //   uptake  =  Q (1 - shunt) (CcO2 - CvO2)
  //   arterial:  CaO2 = (1 - shunt) CcO2 + shunt CvO2        (the shunt equation)
  //   venous:    Vv dCvO2/dt = Q (CaO2 - CvO2) - VO2          (the Fick balance)
  //
  // Environment enters through PIO2: altitude lowers the barometric pressure, and an
  // oxygen mask or ventilator raises the inspired fraction. Pneumonia and asthma enter
  // through the shunt fraction, which is what makes a consolidated lung hypoxaemic
  // even at a normal minute ventilation - and why more oxygen helps it only partly.
  const pb = barometricPressure(s.environment.altitude_m);
  const pH2o = P('resp.waterVapour_mmHg');
  const fio2 = s.environment.fio2;
  const pio2 = fio2 * Math.max(0, pb - pH2o);

  const q_L_per_min = Math.max(0, c.co);
  const shunt = Math.max(
    0,
    Math.min(0.95, P('resp.physiologicalShunt') + effect(s, 'resp.shunt') + 0.3 * constriction),
  );
  r.shuntFraction = shunt;

  const hct = s.chem.hct;
  const bohr = { ph: s.chem.ph, pco2: r.arterialPco2, temp: s.metabolic.coreTemp };
  const endCapSat = saturationAt(r.alveolarPo2, bohr);
  const ccO2 = oxygenCapacity(hct) * endCapSat + 0.003 * r.alveolarPo2;
  const cvO2 = r.venousO2Content;

  // mL O2 per minute taken up by blood crossing ventilated alveoli. Negative when the
  // alveoli hold LESS oxygen than returning blood - breathing a hypoxic gas mixture
  // then strips oxygen out of the blood, which is why it is so dangerous.
  const uptake_mL_per_min = q_L_per_min * 10 * (1 - shunt) * (ccO2 - cvO2);
  const gasVolume_L = (P('resp.alveolarGasVolume_mL') + 0.5 * vt) / 1000;
  const dPA_per_min =
    (alveolarVentilation_L_per_min * (pio2 - r.alveolarPo2) - (uptake_mL_per_min / 1000) * Math.max(1, pb - pH2o)) /
    gasVolume_L;
  r.alveolarPo2 = Math.max(0.5, Math.min(Math.max(pio2, 1), r.alveolarPo2 + dPA_per_min * dtMin));

  // Arterial blood is replaced at the rate the heart moves it through the arterial
  // tree. With no output it simply stays where it was, which is the honest answer:
  // blood that is not moving is not being re-oxygenated either.
  const caIn = (1 - shunt) * ccO2 + shunt * cvO2;
  const arterialVolume_dL = Math.max(1, c.aorta.V / 100);
  // Blood the heart is moving is replaced (and re-oxygenated) at the rate it moves.
  // Blood that is NOT moving is not inert: it sits against a vessel wall and its oxygen
  // slowly diffuses into stagnant, extracting tissue, so a stopped circulation
  // desaturates over a minute or two rather than holding its last reading for ever - the
  // frozen SpO2 that made an asystolic patient read 98 %. The stagnant term equilibrates
  // arterial toward venous on a slow constant; the flow term dominates whenever there is
  // flow.
  const flowTurnover = (q_L_per_min * 10 * dtMin) / arterialVolume_dL;
  const arterialTurnover = Math.min(1, flowTurnover);
  r.arterialO2Content += (caIn - r.arterialO2Content) * arterialTurnover;
  // Toward venous when the circulation has all but stopped: keyed to cardiac output, so
  // it is exactly zero at any normal output and ramps in only below about 1 L/min - the
  // same haemodynamic definition of arrest the rest of the model uses. This is what lets
  // an unperfused body desaturate instead of holding its last SpO2 for ever.
  const stasis = Math.max(0, Math.min(1, (1.0 - q_L_per_min) / 1.0));
  if (stasis > 0) {
    const stagnantTurnover = dtMin / P('resp.stagnantArterialTau_min');
    r.arterialO2Content += (r.venousO2Content - r.arterialO2Content) * stagnantTurnover * stasis;
  }

  // Venous blood: what the tissues leave behind. Metabolism draws down the venous store
  // whether or not the heart is delivering, so without output it empties.
  const venousVolume_dL = Math.max(5, c.veins.V / 100);
  const dVenous_mL_per_min = q_L_per_min * 10 * (r.arterialO2Content - cvO2) - vo2;
  r.venousO2Content = Math.max(0.5, cvO2 + (dVenous_mL_per_min * dtMin) / venousVolume_dL);

  r.arterialPo2 = po2FromContent(r.arterialO2Content, hct, bohr);
  r.spo2 = saturationAt(r.arterialPo2, bohr);
  const cap = Math.max(1e-6, oxygenCapacity(hct));
  r.venousPo2 = invSeveringhausApprox(Math.max(0, r.venousO2Content - 0.003 * 40) / cap);
  r.venousPco2 = r.arterialPco2 + 6;
}

/**
 * Barometric pressure at an altitude, from the ICAO standard atmosphere.
 *
 *   PB = P0 (1 - k h)^n
 *
 * Exported because the environment snapshot and the lab panel both report it.
 */
export function barometricPressure(altitude_m: number): number {
  const h = Math.max(-400, Math.min(9000, altitude_m));
  return P('env.seaLevelPressure_mmHg') * Math.pow(1 - P('env.lapseCoefficient_per_m') * h, P('env.pressureExponent'));
}

/**
 * Oxygen saturation at a PO2, with the Bohr shift Severinghaus published alongside his
 * curve: acidosis, hypercapnia and fever move the curve right (less saturation at the
 * same PO2, easier unloading in the tissues), alkalosis and cold move it left.
 *
 *   PO2_virtual = PO2 x 10^(0.024 (37 - T) + 0.40 (pH - 7.40) + 0.06 log10(40 / PCO2))
 */
export function saturationAt(po2: number, bohr: { ph: number; pco2: number; temp: number }): number {
  const shift =
    0.024 * (37 - bohr.temp) + 0.4 * (bohr.ph - 7.4) + 0.06 * Math.log10(40 / Math.max(5, bohr.pco2));
  return severinghaus(po2 * Math.pow(10, shift));
}

/** Invert the content equation: the PO2 at which bound plus dissolved oxygen equals `content`. */
function po2FromContent(content: number, hct: number, bohr: { ph: number; pco2: number; temp: number }): number {
  const cap = oxygenCapacity(hct);
  let lo = 0.5;
  let hi = 800;
  for (let i = 0; i < 28; i++) {
    const mid = 0.5 * (lo + hi);
    const c = cap * saturationAt(mid, bohr) + 0.003 * mid;
    if (c > content) hi = mid;
    else lo = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * Normal arterial oxygen content, mL/dL, from the sourced haematocrit, the reference
 * saturation and PaO2. The yardstick every "fraction of normal oxygen" in the model is
 * measured against.
 */
export const REFERENCE_CAO2 = (() => {
  const cap = (P('blood.haematocrit') / 0.45) * P('blood.haemoglobin_g_per_dL') * P('blood.o2CapacityPerGramHb_mL');
  return cap * severinghaus(P('resp.pao2_mmHg')) + 0.003 * P('resp.pao2_mmHg');
})();

/**
 * Equivalent CO2 stimulus from the metabolic (non-respiratory) acid load, mmHg.
 *
 * The deficit is the metabolic bicarbonate relative to normal: what fixed acids,
 * lactate and ketoacids have consumed, or alkali has added. Positive for an acidosis.
 * The two gains are CALIBRATED, not chosen: each was solved so that the closed
 * chemoreflex loop settles on Adrogue and Madias' compensation slope (see the
 * `acidbase.chemoStimulus*` constants and tests/sim/acidbase.test.ts).
 */
export function metabolicAcidStimulus(s: SimState): number {
  const deficit = P('blood.hco3_mEq_per_L') - metabolicBicarbonate(s);
  return deficit > 0
    ? deficit * P('acidbase.chemoStimulusAcidosis_mmHg_per_mEq')
    : deficit * P('acidbase.chemoStimulusAlkalosis_mmHg_per_mEq');
}

/**
 * Bicarbonate with organic acids subtracted and respiratory buffering excluded: the
 * purely metabolic component, mEq/L. Shared with acidbase.ts so both read one number.
 */
export function metabolicBicarbonate(s: SimState): number {
  const lactateExcess = s.chem.lactate - P('blood.lactate_mmol_per_L');
  const ketoneExcess = s.acidBase.ketones - P('blood.ketones_mmol_per_L');
  return s.acidBase.metabolicHco3 - lactateExcess - ketoneExcess;
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
