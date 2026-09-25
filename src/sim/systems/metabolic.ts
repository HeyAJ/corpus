import { P } from '../core/constants';
import type { SimState } from '../core/state';
import { effect } from '../core/effects';

/**
 * METABOLIC / ENDOCRINE (spec 4.7).
 *
 * Bergman minimal model for glucose-insulin:
 *
 *   dG/dt = -(p1 + X)*G + p1*Gb + Ra/Vg
 *   dX/dt = -p2*X + p3*(I - Ib)
 *   dI/dt = gamma*(G - h)+ * t - n*I
 *
 * Ra is the appearance rate of glucose from the gut, which is where GI absorption
 * (systems/gi.ts) couples in. Glucagon counter-regulation below 70 mg/dL raises
 * hepatic output, which is why the model recovers from a hypoglycaemic dip instead
 * of spiralling.
 *
 * Core temperature is a straight heat balance: production minus loss over the
 * body's heat capacity. It is here rather than in its own module because the same
 * receptor effects (5-HT2A, TAAR1, beta-3) drive both metabolic rate and heat.
 */

export function stepMetabolic(s: SimState, dt: number): void {
  const m = s.metabolic;
  const dtMin = dt / 60;

  const p1 = P('metabolic.bergman.p1_per_min');
  const p2 = P('metabolic.bergman.p2_per_min');
  const p3 = P('metabolic.bergman.p3_mL_per_uU_min2');
  const n = P('metabolic.bergman.n_per_min');
  const gamma = P('metabolic.bergman.gamma');
  const h = P('metabolic.bergman.h_mg_per_dL');
  const Gb = P('blood.glucose_mg_per_dL');
  const Ib = P('metabolic.insulinBasal_uU_per_mL');
  const Vg = P('metabolic.glucoseDistributionVolume_dL');

  // --- counter-regulation --------------------------------------------------
  const hypoThreshold = P('metabolic.glucagonThreshold_mg_per_dL');
  m.glucagonDrive = m.G < hypoThreshold ? Math.min(1, (hypoThreshold - m.G) / 25) : 0;

  // Injected insulin acts through the same terms as the pancreas's own (engine sets it
  // from an insulin drug's plasma level). It is added to plasma insulin for the actions,
  // not to m.I itself, because the drug's pharmacokinetics already govern its decay.
  const effectiveInsulin = m.I + m.exogenousInsulin_uU_per_mL;

  // Insulin suppresses hepatic glucose output; this is most of what basal insulin
  // actually does. COUNTER-REGULATION IS ADDED, NOT MULTIPLIED BY THAT SUPPRESSION. It
  // used to be a factor on the suppressed output, so once insulin had shut the liver
  // down, glucagon could only scale a number that was already near zero: an injected
  // insulin bolus drove glucose to the 5 mg/dL floor and held it there, with no
  // recovery at all. In a real insulin tolerance test glucagon and adrenaline pull
  // glucose back from its nadir within the hour despite the insulin still on board,
  // because hypoglycaemic counter-regulation overrides insulin's hepatic brake. With no
  // counter-regulatory drive (glucose above threshold) the two forms are identical, so a
  // resting or fed body is unchanged.
  const insulinSuppression = Math.max(0.15, 1 - 0.055 * (effectiveInsulin - Ib));

  // GLYCOGENOLYSIS is its own term, scaled on the share of hepatic output that comes
  // from glycogen (36 % post-absorptive, Rothman 1991), and it is ADDED - not
  // multiplied by insulin's suppression - for the same reason the counter-regulation
  // term beside it is (see above): glucagon breaking down liver glycogen overrides the
  // insulin brake, which is why glucagon rescues an insulin overdose at all.
  //
  // Until 2026-09-25 nothing read `metabolic.glycogenolysis`: the glucagon receptor and
  // the glucagon hormone both wrote it and it went nowhere, so glucagon's principal acute
  // action was missing and 1 mg of it raised glucose by 2 mg/dL. Wired first as one more
  // modifier on the insulin-suppressed output, it still did almost nothing, because the
  // pancreas answered the first few mg/dL with insulin and the suppression multiplied the
  // stimulus away - the defect the counter-regulation comment above describes, reproduced
  // for the drug. At rest the target is zero, so a resting or fed body is unchanged.
  const glycogenolysis = P('metabolic.glycogenolysisFraction') * effect(s, 'metabolic.glycogenolysis');
  const hepaticOutput =
    P('metabolic.hepaticGlucoseOutput_mg_per_min') *
    Math.max(
      0,
      Math.max(0, 1 + effect(s, 'metabolic.hepaticGlucoseOutput')) * (insulinSuppression + 2.2 * m.glucagonDrive) +
        glycogenolysis,
    );

  // Gut appearance from GI absorption, mg/min.
  const Ra = s.gi.glucoseAbsorptionRate + hepaticOutput;

  // --- Bergman ODEs --------------------------------------------------------
  const uptakeScale = 1 + effect(s, 'metabolic.glucoseUptake');
  const dG = -(p1 + m.X * uptakeScale) * m.G + p1 * Gb + Ra / Vg;
  const dX = -p2 * m.X + p3 * (effectiveInsulin - Ib);

  // The canonical minimal model writes secretion as gamma*(G-h)+ * t, where t is
  // minutes since the glucose bolus. That form only makes sense for a single IVGTT;
  // it is meaningless for a continuously-running body that eats repeatedly. We use a
  // first-order secretion rate instead, calibrated so a post-prandial glucose of
  // 140 mg/dL produces ~60 uU/mL of insulin. Recorded in docs/MODEL_LIMITATIONS.md.
  void gamma;
  const kSec = P('metabolic.insulinSecretionGain');
  const secretion = kSec * Math.max(0, m.G - h) * (1 + effect(s, 'metabolic.insulinSecretion'));
  const dI = secretion - n * (m.I - Ib);

  m.G = Math.max(5, m.G + dG * dtMin);
  // A CEILING ON INSULIN ACTION. The minimal model is linear in insulin, which is fine
  // across the range it was fitted in (a meal, an IVGTT) and absurd far above it: an
  // intravenous bolus that briefly puts plasma insulin in the hundreds made remote
  // insulin action - and so glucose disposal - rise without limit, clearing half the
  // plasma glucose every minute. Real insulin-stimulated disposal saturates; clamp
  // studies put its maximum at about 15 mg/kg/min. The cap is that maximum expressed in
  // this model's own units at basal glucose, so a meal (which stays below it) is
  // untouched and a supraphysiological bolus saturates where a human does.
  const xMax = (P('metabolic.maxInsulinGlucoseDisposal_mg_per_kg_min') * s.body.mass_kg) / (Gb * Vg);
  m.X = Math.max(0, Math.min(xMax, m.X + dX * dtMin));
  m.I = Math.max(0, m.I + dI * dtMin);

  // Keep the blood-chemistry mirror in sync; the UI reads chem, the engine reads m.
  s.chem.lactate = anaerobicLactate(s, dt);

  // --- thermal balance -----------------------------------------------------
  stepThermal(s, dt);
}

/**
 * RUN THE GLUCOSE-INSULIN LOOP TO ITS OWN RESTING STATE.
 *
 * The engine's 30 s warm-up (engine.ts, createRestingState) settles the circulation, but
 * this loop's time constants are tens of minutes: remote insulin action X relaxes at p2,
 * glucose at p1, and the pancreas has to find the insulin level that balances hepatic
 * output. Booted at the textbook basal values (G = Gb, I = Ib, X = 0) the loop is not at
 * rest - hepatic output is flowing and nothing yet opposes it - so every fresh body's
 * glucose climbed from 93 to 100 mg/dL over its first quarter of an hour and took most of
 * an hour to come back. That transient sat under every drug run and every control.
 *
 * So the loop is asked where its own rest is, by running THIS FILE'S OWN step with the
 * effect vector frozen at the warmed-up body's values, rather than by a separate
 * closed-form solution that could quietly disagree with the step it is meant to match.
 * Twelve simulated hours at a one-second step is far past the slowest time constant and
 * costs a few milliseconds, once per process.
 */
export function settleGlucoseInsulin(s: SimState): void {
  const dt = 1;
  const steps = 12 * 3600;
  for (let i = 0; i < steps; i++) stepMetabolic(s, dt);
}

/**
 * Lactate rises when oxygen delivery cannot meet demand. DO2 = CO x CaO2; below a
 * critical threshold, metabolism goes anaerobic. This is what turns a long arrest
 * into a metabolic problem rather than only a circulatory one.
 */
function anaerobicLactate(s: SimState, dt: number): number {
  const caO2 = 1.34 * ((s.chem.hct / 0.45) * 15) * s.resp.spo2 + 0.003 * s.resp.arterialPo2;
  const do2 = s.cardio.co * caO2 * 10; // mL O2/min
  const CRITICAL_DO2 = 400; // mL/min; below this, anaerobic metabolism begins
  const deficit = Math.max(0, (CRITICAL_DO2 - do2) / CRITICAL_DO2);

  const production = 0.9 * deficit * deficit; // mmol/L/min at full deficit
  const CLEARANCE_PER_MIN = 0.035; // hepatic + renal Cori cycle
  const clearance = CLEARANCE_PER_MIN * (s.chem.lactate - 1.0) * (s.cardio.co / 5.0);

  const next = s.chem.lactate + (production - clearance) * (dt / 60);
  return Math.max(0.3, Math.min(30, next));
}

function stepThermal(s: SimState, dt: number): void {
  const m = s.metabolic;

  // THE SET POINT can be moved. A fever is a RAISED set point - the body defends 39 as
  // if it were normal, which is why it shivers to reach it - and an antipyretic lowers
  // it again. Pathology.ts writes the fever onto thermal.heatProduction directly, but a
  // drug that lowers the set point (an antipyretic, ethanol) writes thermal.setPoint,
  // and shivering and sweating must be judged against the defended temperature, not a
  // fixed 37. Only the sourced normal is a constant; the offset is on the bus.
  const setPoint = P('thermal.coreTemp_C') * (1 + Math.min(0.05, Math.max(-0.05, effect(s, 'thermal.setPoint'))));

  // SHIVERING adds heat when the core is below the set point; it is skeletal muscle, so
  // it stops under deep sedation and paralysis, which is why anaesthetised patients get
  // cold. SWEATING adds evaporative loss when the core is above it, and costs body water.
  const below = Math.max(0, setPoint - m.coreTemp);
  const canShiver = 1 - Math.min(1, s.neuro.sedation) - Math.max(0, -s.mind.muscleTone);
  const shiver = Math.max(0, Math.min(1, below / P('thermal.shiveringSpan_C'))) * Math.max(0, canShiver);
  const shiverHeat = P('thermal.shiveringMaxRise') * shiver * P('thermal.basalHeatProduction_W');

  const above = Math.max(0, m.coreTemp - setPoint);
  const sweatFraction = Math.max(0, Math.min(1, above / P('thermal.sweatSpan_C')));
  m.sweatRate_mL_per_min = (sweatFraction * P('thermal.maxSweatRate_mL_per_h')) / 60;
  const evaporativeLoss_W = (m.sweatRate_mL_per_min / 60) * P('thermal.latentHeat_kJ_per_g') * 1000;

  const production =
    P('thermal.basalHeatProduction_W') * (1 + effect(s, 'thermal.heatProduction')) + m.heatOffset + shiverHeat;

  // Proportional skin blood flow: above the set point the skin dilates and loses heat
  // faster, below it constricts. Ambient temperature is the room the operator set.
  const regulatory = Math.max(
    0.35,
    Math.min(2.6, 1 + P('thermal.regulatoryGain_per_C') * (m.coreTemp - setPoint)),
  );
  const ambient = s.environment.ambientTemp_C;
  const loss = P('thermal.heatLossCoefficient_W_per_C') * regulatory * (m.coreTemp - ambient) + evaporativeLoss_W;
  const netW = production - loss;

  const heatCapacity_J_per_C = P('thermal.bodyHeatCapacity_kJ_per_kg_C') * 1000 * s.body.mass_kg;
  m.coreTemp += (netW * dt) / heatCapacity_J_per_C;
  m.coreTemp = Math.max(20, Math.min(45, m.coreTemp));
}
