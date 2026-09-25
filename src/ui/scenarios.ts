import drugsFile from '../data/drugs.json';
import type { DrugsFile } from '../data/pharma-types';
import type { Route, SimIntent } from '../bridge/types';

/**
 * SCENARIOS: A LIBRARY OF STARTING POINTS.
 *
 * Every piece of a scenario already exists as an intent a user could send by hand: a
 * drug from the drawer, a slider in the physiology or environment panel, an inoculation.
 * A scenario is only a remembered SEQUENCE of them, so it adds no physiology and no
 * number of its own - which is the point. It makes the engine usable as a bench ("set
 * up an anaphylaxis, now try the antihistamine, now try adrenaline") without anyone
 * having to know which six controls produce the starting picture.
 *
 * DOSES ARE LOOKED UP, NEVER WRITTEN HERE. The worker refuses any amount that is not a
 * declared preset (CLAUDE.md's first trap), so a scenario names a drug and a route and
 * takes the amount and unit from drugs.json at the moment it runs. A scenario whose drug
 * or route has been removed from the data simply omits that step rather than sending
 * something the engine would silently refuse.
 *
 * Nothing here is clinical guidance. The scenarios are the insults you learn to treat,
 * framed as "what happens if", in the same register as the rest of the interface.
 */

const DRUGS = (drugsFile as unknown as DrugsFile).drugs;

function dose(drugId: string, route: Route, multiplier = 1): SimIntent[] {
  const drug = DRUGS.find((d) => d.id === drugId);
  const preset = drug?.presetDoses.find((p) => p.route === route);
  if (!drug || !preset) return [];
  return [
    {
      type: 'ADMINISTER',
      drugId,
      route,
      dose: preset.amount,
      unit: preset.unit,
      label: `${drug.displayName} ${preset.label}`,
      ...(multiplier === 1 ? {} : { multiplier }),
    },
  ];
}

export interface Scenario {
  id: string;
  label: string;
  /** What it sets up and what to watch, in one or two sentences. */
  description: string;
  /** Intents sent after the body is reset (IV access is sited first). */
  intents: () => SimIntent[];
  /** Time scale to switch to, for slow processes. Omitted means real time. */
  timeScale?: number;
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'opioid-overdose',
    label: 'Opioid overdose',
    description: 'Several times a reference fentanyl dose. Watch pinpoint pupils, falling respiratory rate, rising PaCO2, then desaturation — and what naloxone does to it.',
    intents: () => dose('fentanyl', 'IV_PUSH', 5),
  },
  {
    id: 'anaphylaxis',
    label: 'Anaphylaxis',
    description: 'A full mast-cell discharge: vasodilatory shock, capillary leak and bronchospasm. Compare an antihistamine with adrenaline.',
    intents: () => [{ type: 'ALLERGEN_EXPOSURE', severity: 1 }],
  },
  {
    id: 'asthma',
    label: 'Acute asthma',
    description: 'Severe bronchospasm. Tidal volume and saturation fall; a beta-2 agonist relieves it, which it would not in healthy airways.',
    intents: () => [{ type: 'SET_BRONCHOSPASM', level: 0.7 }],
  },
  {
    id: 'haemorrhage',
    label: 'Haemorrhagic shock',
    description: 'A continuous 60 mL/min bleed. Watch the baroreflex tachycardia, narrowing pulse pressure, lactate — and how clotting slows it.',
    intents: () => [{ type: 'SET_BLEED', rate_mL_per_min: 60 }],
  },
  {
    id: 'orthostatic',
    label: 'Stand after blood loss',
    description: 'A litre of blood lost, then standing up: blood pools in the legs and a reflex that coped lying down no longer can.',
    intents: () => [
      { type: 'HAEMORRHAGE', volume_mL: 1000 },
      { type: 'SET_POSTURE', posture: 'standing' },
    ],
  },
  {
    id: 'sepsis',
    label: 'Gram-negative sepsis',
    description: 'E. coli bloodstream infection at high time scale: fever, vasodilation, capillary leak, lactate. An in-spectrum antibiotic clears it; fluids and a vasopressor support it.',
    intents: () => [{ type: 'INOCULATE', pathogenId: 'e_coli', dose_log10: 2 }],
    timeScale: 300,
  },
  {
    id: 'pneumonia',
    label: 'Pneumococcal pneumonia',
    description: 'A consolidated lobe is a shunt: hypoxaemia that more oxygen only partly corrects. Try FiO2 in the environment panel.',
    intents: () => [{ type: 'INOCULATE', pathogenId: 'strep_pneumoniae', dose_log10: 2 }],
    timeScale: 300,
  },
  {
    id: 'cholera',
    label: 'Cholera',
    description: 'Secretory diarrhoea at up to a litre an hour: hypovolaemia, hypokalaemia and a non-gap acidosis. Rehydration is the treatment.',
    intents: () => [{ type: 'INOCULATE', pathogenId: 'vibrio_cholerae', dose_log10: 2 }],
    timeScale: 300,
  },
  {
    id: 'hypoglycaemia',
    label: 'Insulin hypoglycaemia',
    description: 'An intravenous insulin bolus. Glucose falls, glucagon and adrenaline answer; dextrose or glucagon rescue it.',
    intents: () => dose('insulin_regular', 'IV_PUSH', 2),
  },
  {
    id: 'hyperkalaemia',
    label: 'Hyperkalaemia',
    description: 'A large potassium load slows the heart. Calcium stabilises the membrane within minutes without lowering the potassium.',
    intents: () => dose('potassium_chloride', 'IV_PUSH', 5),
  },
  {
    id: 'vf-arrest',
    label: 'VF cardiac arrest',
    description: 'Ventricular fibrillation. Breathing stops within a minute; compressions, defibrillation and adrenaline are the sequence.',
    intents: () => [{ type: 'FORCE_RHYTHM', rhythm: 'vfib' }],
  },
  {
    id: 'paralysis',
    label: 'Paralysis without a ventilator',
    description: 'A neuromuscular blocker with no airway support: the patient cannot breathe, desaturates and the heart slows. Intubate to rescue.',
    intents: () => dose('rocuronium', 'IV_PUSH'),
  },
  {
    id: 'altitude',
    label: 'High altitude',
    description: 'Sudden ascent to 5500 m: low inspired oxygen, hypoxic hyperventilation and a respiratory alkalosis.',
    intents: () => [{ type: 'SET_ENVIRONMENT', altitude_m: 5500 }],
  },
  {
    id: 'heat',
    label: 'Exertional heat illness',
    description: 'Hard exercise in 42 °C air: sweating, fluid loss and a rising core temperature.',
    intents: () => [
      { type: 'SET_ENVIRONMENT', ambientTemp_C: 42 },
      { type: 'SET_EXERTION', level: 0.7 },
    ],
    timeScale: 5,
  },
  {
    id: 'cold',
    label: 'Cold exposure',
    description: 'Air at −10 °C. Shivering defends the core until it cannot; sedation abolishes it.',
    intents: () => [{ type: 'SET_ENVIRONMENT', ambientTemp_C: -10 }],
    timeScale: 30,
  },
];
