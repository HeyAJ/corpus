import { P } from '../core/constants';
import type { SimState } from '../core/state';
import { addEffect, effect, prevEffect } from '../core/effects';
import { STOMACH_INDEX } from './gi';
import { addBicarbonate } from './acidbase';

/**
 * SIGNS: PUPILS, TONE, NAUSEA, VOMITING AND SEIZURES.
 *
 * Nine effect-bus targets were written by drugs, hormones and pathology and read by
 * nothing (docs/DECISIONS.md, "dead targets"). Morphine constricted no pupil, ondansetron
 * relieved no nausea, a benzodiazepine protected against no seizure, and a
 * neuromuscular blocker - had one existed - would have paralysed nobody. Each of those
 * is either something a clinician SEES at the bedside or something with consequences
 * elsewhere in the body, so each gets a consumer here.
 *
 * WHAT IS A READOUT AND WHAT HAS CONSEQUENCES.
 *
 *   pupils, anxiety, euphoria, psychedelia, dependence, appetite
 *       Readouts. They describe what the bus is doing and change nothing else, because
 *       none of them has a mechanical consequence this model represents.
 *   muscle tone
 *       Consequential: respiratory.ts reads it, so flaccid paralysis stops ventilation
 *       while the patient may still be awake, and rigidity stiffens the chest wall.
 *   nausea -> vomiting
 *       Consequential: a vomiting episode empties the stomach (taking any undissolved
 *       tablet with it) and loses gastric acid, which is a metabolic alkalosis.
 *   seizure threshold -> seizures
 *       Consequential: a generalised seizure is an enormous, brief metabolic event -
 *       tachycardia, hypertension, heat, apnoea during the tonic phase, and lactate -
 *       all of which reach the body through the bus.
 */

/** Seizure-related modifiers, applied through the bus while a seizure lasts. */
const SEIZURE_EFFECTS: [string, number][] = [
  ['cardio.heartRate', 0.5],
  ['cardio.systemicResistance', 0.3],
  ['thermal.heatProduction', 2.0],
  ['resp.drive', -0.8],
  ['neuro.sedation', 1.2],
];

export function stepMind(s: SimState, dt: number): void {
  stepPupil(s, dt);
  stepTone(s);
  stepNauseaAndVomiting(s, dt);
  stepSeizure(s, dt);
}

/* ------------------------------------------------------------------ pupils */

function stepPupil(s: SimState, dt: number): void {
  const m = s.mind;
  const base = P('neuro.pupilBaseline_mm');
  let target = base * (1 + effect(s, 'neuro.pupilDiameter'));

  // Cerebral anoxia abolishes the pupillary light reflex and the pupils dilate: fixed
  // and dilated within about a minute of the circulation stopping. Keyed to cerebral
  // oxygen DELIVERY falling below the level at which consciousness is already gone, so
  // an opioid overdose shows pinpoint pupils until the hypoxia overtakes it - the
  // classic sequence.
  const cbfFraction = s.neuro.cbf / P('neuro.cerebralBloodFlow_mL_per_min');
  const anoxia = cbfFraction * Math.min(1, s.resp.spo2 / 0.97) < P('neuro.consciousnessLossCBF_fraction') * 0.5;
  if (anoxia) target = P('neuro.pupilMax_mm');

  target = Math.max(P('neuro.pupilMin_mm'), Math.min(P('neuro.pupilMax_mm'), target));
  // The iris answers within a second or two.
  m.pupil_mm += (target - m.pupil_mm) * (1 - Math.exp(-dt / 1.5));
}

/* ------------------------------------------------------------- muscle tone */

function stepTone(s: SimState): void {
  const seizing = s.mind.seizing ? 1 : 0;
  s.mind.muscleTone = Math.max(-1, Math.min(1, effect(s, 'neuro.muscleTone') + seizing));
}

/* -------------------------------------------------------- nausea, vomiting */

function stepNauseaAndVomiting(s: SimState, dt: number): void {
  const m = s.mind;
  // Nausea is read from LAST tick's bus, because the pathology (vertigo) that writes it
  // runs before pharmacodynamics and antiemetics write their opposition after. Reading
  // the completed sum is the only way the two can argue.
  const drive = prevEffect(s, 'gi.nausea') + 0.5 * prevEffect(s, 'gi.emesis');
  const target = Math.max(0, Math.min(1, drive));
  m.nausea += (target - m.nausea) * (1 - Math.exp(-dt / 20));

  m.vomitTimer = Math.max(0, m.vomitTimer - dt);
  if (m.vomiting) {
    if (m.vomitTimer <= 0) {
      m.vomiting = false;
      m.vomitTimer = P('gi.vomitInterval_s');
    }
    return;
  }

  // An unconscious patient does not vomit in this model. (They can, and it is the
  // aspiration risk everybody is taught about; the model has no airway contamination to
  // show for it, so it does not pretend.)
  if (m.nausea < P('gi.vomitThreshold') || m.vomitTimer > 0 || s.neuro.consciousness < 0.3) return;

  m.vomiting = true;
  m.vomitTimer = P('gi.vomitEpisode_s');

  // Empty the stomach. Everything in it - food, fluid, any tablet not yet dissolved -
  // leaves the body, and so does the free acid, which the stomach had taken out of the
  // blood as HCl. Losing it leaves the matching bicarbonate behind: the metabolic
  // alkalosis of persistent vomiting.
  let lost = 0;
  for (const d of s.gi.digesta) {
    if (d.segmentIndex !== STOMACH_INDEX) continue;
    lost += d.volume;
    d.volume = 0;
    d.carb_g = 0;
    d.fat_g = 0;
    d.protein_g = 0;
    for (const k in d.drugPayload) d.drugPayload[k] = 0;
  }
  s.gi.digesta = s.gi.digesta.filter((d) => d.segmentIndex !== STOMACH_INDEX);
  const acid = Math.max(0, s.gi.gastricAcid_mEq);
  s.gi.gastricAcid_mEq = 0;
  addBicarbonate(s, acid);
  m.vomitus_mL += lost;
}

/* ---------------------------------------------------------------- seizures */

/**
 * Margin before a seizure, 1 = normal, 0 = at threshold.
 *
 * The drug term is `neuro.seizureThreshold` itself: an anticonvulsant raises the margin,
 * a proconvulsant (cocaine, tramadol, theophylline at toxic levels) lowers it. The
 * metabolic provocations each cost margin as they approach their cited threshold:
 * profound hypoglycaemia, acute hyponatraemia and extreme hyperthermia.
 */
export function seizureMargin(s: SimState): number {
  const g = P('neuro.seizureGlucose_mg_per_dL');
  const na = P('neuro.seizureSodium_mEq_per_L');
  const t = P('neuro.seizureTemperature_C');
  const glucose = Math.max(0, (g + 20 - s.metabolic.G) / 20);
  const sodium = Math.max(0, (na + 5 - s.chem.na) / 5);
  const heat = Math.max(0, s.metabolic.coreTemp - (t - 1));
  return 1 + Math.max(-2, Math.min(2, effect(s, 'neuro.seizureThreshold'))) - glucose - sodium - heat;
}

function stepSeizure(s: SimState, dt: number): void {
  const m = s.mind;
  const margin = seizureMargin(s);

  m.postictal = Math.max(0, m.postictal - dt);

  if (!m.seizing) {
    if (margin < 0 && m.postictal <= 0 && s.cardio.co > 1) {
      m.seizing = true;
      m.seizureT = 0;
    }
    return;
  }

  m.seizureT += dt;
  // A seizure provoked only just past threshold stops by itself after about a minute
  // (Jenssen 2006); one driven well past it continues for as long as the provocation
  // does - status epilepticus - until something raises the threshold again.
  const status = margin < -0.5;
  if (margin >= 0 || (!status && m.seizureT >= P('neuro.seizureDuration_s'))) {
    m.seizing = false;
    m.postictal = P('neuro.postictalRefractory_s');
    return;
  }

  for (const [target, gain] of SEIZURE_EFFECTS) addEffect(s.effects, target, gain);

  // Muscle working flat out with no ventilation makes lactate fast: a generalised
  // seizure commonly leaves a lactate well above 5 mmol/L that clears within the hour.
  s.chem.lactate = Math.min(30, s.chem.lactate + (P('neuro.seizureLactateRise_mmol_per_L_per_min') * dt) / 60);
}
