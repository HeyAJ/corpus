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

  const hepaticOutput =
    P('metabolic.hepaticGlucoseOutput_mg_per_min') *
    (1 + 2.2 * m.glucagonDrive) *
    (1 + effect(s, 'metabolic.hepaticGlucoseOutput')) *
    // Insulin suppresses hepatic glucose output; this is most of what basal
    // insulin actually does.
    Math.max(0.15, 1 - 0.055 * (m.I - Ib));

  // Gut appearance from GI absorption, mg/min.
  const Ra = s.gi.glucoseAbsorptionRate + hepaticOutput;

  // --- Bergman ODEs --------------------------------------------------------
  const uptakeScale = 1 + effect(s, 'metabolic.glucoseUptake');
  const dG = -(p1 + m.X * uptakeScale) * m.G + p1 * Gb + Ra / Vg;
  const dX = -p2 * m.X + p3 * (m.I - Ib);

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
  m.X = Math.max(0, m.X + dX * dtMin);
  m.I = Math.max(0, m.I + dI * dtMin);

  // Keep the blood-chemistry mirror in sync; the UI reads chem, the engine reads m.
  s.chem.lactate = anaerobicLactate(s, dt);

  // --- thermal balance -----------------------------------------------------
  stepThermal(s, dt);
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
  const production =
    P('thermal.basalHeatProduction_W') * (1 + effect(s, 'thermal.heatProduction')) + m.heatOffset;
  // Proportional thermoregulation. Above the set point the body sweats and dilates
  // its skin vessels, so it loses heat faster; below it, it vasoconstricts and loses
  // heat more slowly. Without this term the model has an equilibrium but no defended
  // temperature, and core temperature wanders all day.
  const SET_POINT_C = 37.0;
  const regulatory = Math.max(
    0.35,
    Math.min(2.6, 1 + P('thermal.regulatoryGain_per_C') * (m.coreTemp - SET_POINT_C)),
  );
  const loss = P('thermal.heatLossCoefficient_W_per_C') * regulatory * (m.coreTemp - P('thermal.ambientTemp_C'));
  const netW = production - loss;

  const heatCapacity_J_per_C = P('thermal.bodyHeatCapacity_kJ_per_kg_C') * 1000 * s.body.mass_kg;
  m.coreTemp += (netW * dt) / heatCapacity_J_per_C;
  m.coreTemp = Math.max(20, Math.min(45, m.coreTemp));
}
