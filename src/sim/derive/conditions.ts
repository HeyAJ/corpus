import { P } from '../core/constants';
import { referenceBloodVolume } from '../core/body';
import type { SimState } from '../core/state';
import type { ConditionTag, Severity } from '../../bridge/types';

/**
 * DERIVED CONDITIONS (spec 4.8).
 *
 * A pure function of state, evaluated every tick. These become the coloured tags in
 * the emergency HUD.
 *
 * HYSTERESIS IS NOT OPTIONAL. A threshold comparison with no dead band flickers on
 * and off as the value oscillates across it — and every value here oscillates,
 * because MAP has a pulse and glucose has an insulin loop. A +/-3 % dead band means
 * a tag that turns on at MAP 65 does not turn off until MAP 67, which is what stops
 * the HUD looking broken.
 */

interface Rule {
  id: string;
  label: string;
  severity: Severity | ((s: SimState) => Severity);
  /** Value and threshold; `above` decides the comparison direction. */
  measure: (s: SimState) => number;
  threshold: (s: SimState) => number;
  above: boolean;
  detail: (s: SimState) => string;
}

const RULES: Rule[] = [
  {
    id: 'hypovolemia',
    label: 'Hypovolemia',
    severity: (s) => (s.cardio.bloodVolume < 0.7 * referenceBloodVolume(s) ? 'critical' : 'warn'),
    measure: (s) => s.cardio.bloodVolume,
    threshold: (s) => 0.85 * referenceBloodVolume(s),
    above: false,
    detail: (s) => `Circulating volume ${Math.round(s.cardio.bloodVolume)} mL of ${Math.round(referenceBloodVolume(s))} mL baseline`,
  },
  {
    id: 'hypotension',
    label: 'Hypotension',
    severity: (s) => (s.cardio.map < 50 ? 'critical' : 'warn'),
    measure: (s) => s.cardio.map,
    threshold: () => 65,
    above: false,
    detail: (s) => `Mean arterial pressure ${Math.round(s.cardio.map)} mmHg`,
  },
  {
    id: 'hypertension',
    label: 'Hypertension',
    severity: (s) => (s.cardio.sbp > 180 || s.cardio.dbp > 120 ? 'critical' : 'watch'),
    measure: (s) => Math.max(s.cardio.sbp / 140, s.cardio.dbp / 90),
    threshold: () => 1,
    above: true,
    detail: (s) => `Blood pressure ${Math.round(s.cardio.sbp)}/${Math.round(s.cardio.dbp)} mmHg`,
  },
  {
    id: 'hypoglycemia',
    label: 'Hypoglycemia',
    severity: (s) => (s.metabolic.G < 50 ? 'critical' : 'warn'),
    measure: (s) => s.metabolic.G,
    threshold: () => P('metabolic.glucagonThreshold_mg_per_dL'),
    above: false,
    detail: (s) => `Plasma glucose ${Math.round(s.metabolic.G)} mg/dL`,
  },
  {
    id: 'hyperglycemia',
    label: 'Hyperglycemia',
    severity: (s) => (s.metabolic.G > 300 ? 'warn' : 'watch'),
    measure: (s) => s.metabolic.G,
    threshold: () => 180,
    above: true,
    detail: (s) => `Plasma glucose ${Math.round(s.metabolic.G)} mg/dL`,
  },
  {
    id: 'hyperkalemia',
    label: 'Hyperkalemia',
    severity: (s) => (s.chem.k > 6.5 ? 'critical' : 'warn'),
    measure: (s) => s.chem.k,
    threshold: () => 5.5,
    above: true,
    detail: (s) => `Serum potassium ${s.chem.k.toFixed(1)} mEq/L`,
  },
  {
    id: 'hypokalemia',
    label: 'Hypokalemia',
    severity: 'warn',
    measure: (s) => s.chem.k,
    threshold: () => 3.5,
    above: false,
    detail: (s) => `Serum potassium ${s.chem.k.toFixed(1)} mEq/L`,
  },
  {
    id: 'hypoxemia',
    label: 'Hypoxemia',
    severity: (s) => (s.resp.spo2 < 0.8 ? 'critical' : 'warn'),
    measure: (s) => s.resp.spo2 * 100,
    threshold: () => 90,
    above: false,
    detail: (s) => `Oxygen saturation ${(s.resp.spo2 * 100).toFixed(0)} %`,
  },
  {
    id: 'hypercapnia',
    label: 'Hypercapnia',
    severity: (s) => (s.resp.arterialPco2 > 70 ? 'critical' : 'warn'),
    measure: (s) => s.resp.arterialPco2,
    threshold: () => 50,
    above: true,
    detail: (s) => `Arterial CO2 ${Math.round(s.resp.arterialPco2)} mmHg`,
  },
  {
    id: 'resp_depression',
    label: 'Respiratory Depression',
    severity: (s) => (s.resp.apnoeic ? 'critical' : 'warn'),
    measure: (s) => s.resp.rate,
    threshold: () => 8,
    above: false,
    detail: (s) => `Respiratory rate ${s.resp.rate.toFixed(0)} /min`,
  },
  {
    id: 'renal_failure',
    label: 'Renal Hypoperfusion',
    severity: (s) => (s.renal.gfr < 20 ? 'critical' : 'warn'),
    measure: (s) => s.renal.gfr,
    threshold: () => 0.6 * P('renal.gfr_mL_per_min'),
    above: false,
    detail: (s) => `GFR ${Math.round(s.renal.gfr)} mL/min`,
  },
  {
    id: 'lactic_acidosis',
    label: 'Lactic Acidosis',
    severity: (s) => (s.chem.lactate > 8 ? 'critical' : 'warn'),
    measure: (s) => s.chem.lactate,
    threshold: () => 4,
    above: true,
    detail: (s) => `Lactate ${s.chem.lactate.toFixed(1)} mmol/L`,
  },
  {
    id: 'hyperthermia',
    label: 'Hyperthermia',
    severity: (s) => (s.metabolic.coreTemp > 40 ? 'critical' : 'warn'),
    measure: (s) => s.metabolic.coreTemp,
    threshold: () => 38.3,
    above: true,
    detail: (s) => `Core temperature ${s.metabolic.coreTemp.toFixed(1)} C`,
  },
  {
    id: 'hypothermia',
    label: 'Hypothermia',
    severity: (s) => (s.metabolic.coreTemp < 32 ? 'critical' : 'warn'),
    measure: (s) => s.metabolic.coreTemp,
    threshold: () => 35,
    above: false,
    detail: (s) => `Core temperature ${s.metabolic.coreTemp.toFixed(1)} C`,
  },
  {
    id: 'unconscious',
    label: 'Unresponsive',
    severity: 'critical',
    measure: (s) => s.neuro.consciousness,
    threshold: () => 0.25,
    above: false,
    detail: (s) => `Consciousness index ${(s.neuro.consciousness * 100).toFixed(0)} %`,
  },
  {
    id: 'tachycardia',
    label: 'Tachycardia',
    severity: (s) => (s.cardio.hr > 150 ? 'warn' : 'watch'),
    measure: (s) => s.cardio.hr,
    threshold: () => 100,
    above: true,
    detail: (s) => `Heart rate ${Math.round(s.cardio.hr)} bpm`,
  },
  {
    id: 'bradycardia',
    label: 'Bradycardia',
    severity: (s) => (s.cardio.hr < 40 ? 'warn' : 'watch'),
    measure: (s) => s.cardio.hr,
    threshold: () => 60,
    above: false,
    detail: (s) => `Heart rate ${Math.round(s.cardio.hr)} bpm`,
  },
];

/** Rhythm-derived tags. These are categorical, so hysteresis does not apply. */
function rhythmTags(s: SimState, out: ConditionTag[]): void {
  const r = s.cardio.rhythm;
  if (r === 'vfib') out.push({ id: 'vfib', label: 'V Fib', severity: 'critical', detail: 'Ventricular fibrillation' });
  if (r === 'vt') out.push({ id: 'vt', label: 'V Tach', severity: 'critical', detail: 'Ventricular tachycardia' });
  if (r === 'asystole') out.push({ id: 'asystole', label: 'Asystole', severity: 'critical', detail: 'No electrical activity' });
  if (r === 'pea') out.push({ id: 'pea', label: 'PEA', severity: 'critical', detail: 'Electrical activity without a pulse' });
  if (r === 'afib') out.push({ id: 'afib', label: 'A Fib', severity: 'warn', detail: 'Atrial fibrillation, irregularly irregular' });

  // Cardiac arrest is defined haemodynamically, not electrically: no effective
  // cardiac output. That is why PEA counts and why a perfusing VT does not.
  const ci = s.cardio.co / s.body.bsa_m2;
  if (ci < 1.0) {
    out.push({
      id: 'arrest',
      label: 'Cardiac Arrest',
      severity: 'critical',
      detail: `Cardiac index ${ci.toFixed(2)} L/min/m2 — no effective output`,
    });
  }
}

const OUT: ConditionTag[] = [];

export function deriveConditions(s: SimState): ConditionTag[] {
  OUT.length = 0;
  const band = P('sim.conditionHysteresis');

  for (const rule of RULES) {
    const value = rule.measure(s);
    const thr = rule.threshold(s);
    const latched = s.conditionLatch[rule.id] === true;

    // Dead band: entering takes crossing the threshold, leaving takes crossing it
    // again by the band width in the other direction.
    const onThreshold = thr;
    const offThreshold = rule.above ? thr * (1 - band) : thr * (1 + band);

    let active: boolean;
    if (rule.above) {
      active = latched ? value > offThreshold : value > onThreshold;
    } else {
      active = latched ? value < offThreshold : value < onThreshold;
    }

    s.conditionLatch[rule.id] = active;
    if (active) {
      OUT.push({
        id: rule.id,
        label: rule.label,
        severity: typeof rule.severity === 'function' ? rule.severity(s) : rule.severity,
        detail: rule.detail(s),
      });
    }
  }

  rhythmTags(s, OUT);

  // Most severe first, so the HUD's top slot is always the thing that matters.
  const order: Record<Severity, number> = { critical: 0, warn: 1, watch: 2 };
  OUT.sort((a, b) => order[a.severity] - order[b.severity]);
  return OUT;
}
