import type { DrugClass, PresetDose } from '../../src/data/pharma-types';
import type { Route } from '../../src/bridge/types';

/**
 * THE DRUG MANIFEST.
 *
 * What to build, what to look it up as, and which preset doses the UI offers.
 * Everything numeric about the drug — affinity, clearance, protein binding — comes
 * from the pipeline's sources, not from here.
 *
 * DOSES ARE FIXED SIMULATION PRESETS (spec 10.3). There is no mg/kg entry field
 * anywhere in this application. Each preset cites the guideline or label it comes
 * from so the UI can show where it came from, and the labels deliberately read as
 * simulation scenarios rather than as instructions.
 */

export interface ManifestEntry {
  id: string;
  displayName: string;
  class: DrugClass;
  /** Group heading in the drug drawer, matching the reference layout. */
  drawerGroup: string;
  routes: Route[];
  presetDoses: (PresetDose & { source: string; sourceUrl: string })[];

  /** Name in the Pulse substance table, if present there. */
  pulseName: string | null;
  /** Ligand name(s) to look up in the GtoPdb ligands/interactions CSVs. */
  gtopdbLigand: string | null;
  gtopdbAliases: string[];

  /**
   * Extra names to try against PubChem's name resolver, after the Pulse name, the
   * display name and the id. Needed where the clinical name is a salt or a mixture
   * and the descriptor set belongs to the free base.
   */
  pubchemAliases?: string[];

  /** Receptor ids we accept from GtoPdb for this drug. Anything else is dropped. */
  receptorAllowList?: string[];

  /**
   * Curated efficacy class for a target, keyed by receptor id, where GtoPdb's raw
   * `Action` label is NOT this drug's published efficacy (ADR-025).
   *
   * GtoPdb's Action column records what the ligand did in the assay a curator read. It
   * is a category, not a fraction, and for some drugs it is a category the clinical
   * pharmacology contradicts. Carvedilol is labelled "Partial agonist" at beta-1,
   * beta-2 and beta-3 and its own FDA label says in as many words that it has no
   * intrinsic sympathomimetic activity; read literally, the label made a heart-failure
   * drug take the modelled heart rate from 64 to 235 bpm.
   *
   * THIS IS NOT A TUNING KNOB. Every entry carries the sentence it comes from and the
   * source it comes from, and the emitted target's `source` string says the intrinsic
   * activity was curated and quotes the reason. It is the same instrument as a cited
   * direct effect (ADR-023): a published statement, written down where it can be
   * checked, replacing a value the pipeline would otherwise have guessed.
   */
  intrinsicActivity?: Record<string, { value: number; source: string; sourceUrl: string; note: string }>;

  /**
   * The receptor that mediates this drug's Pulse concentration-effect block, if the
   * drug has one and its pharmacology names a site.
   *
   * Declaring it makes the block COMPETABLE: an antagonist occupying that site scales
   * the block down (see sim/pharma/pulsepd.ts, ADR-026). Without it flumazenil could
   * not reverse midazolam, because midazolam's whole effect runs through a Pulse block
   * and GtoPdb publishes no human GABA-A affinity for it to compete over.
   */
  pulsePdMediatedBy?: string;

  /**
   * Overrides the generated explanation in MISSING_CONSTANTS when this drug ends up
   * with no receptor targets. Set it where the empty list is a modelling decision
   * rather than an upstream gap, and say which it is.
   */
  targetsNote?: string;

  /**
   * A controlled or recreational substance. The flag exists so the interface can say
   * so plainly and so the generated data is auditable; it changes nothing about how
   * the pharmacology is modelled, because the pharmacology is the same pharmacology.
   */
  scheduled?: boolean;
  /** Why this compound is modelled, shown alongside it. Required when `scheduled`. */
  scheduleNote?: string;

  /** Effects that are not receptor-mediated (channel block, osmotic load...). */
  directEffects?: { target: string; gain: number; note: string; source: string; sourceUrl: string }[];

  payload?: {
    volume_mL?: number;
    na_mEq?: number;
    k_mEq?: number;
    ca_mmol?: number;
    cl_mEq?: number;
    iron_mg?: number;
  };

  notes: string;
}

const ACLS = {
  source: 'Panchal AR, et al. Part 3: Adult Basic and Advanced Life Support: 2020 AHA Guidelines for CPR and ECC. Circulation 142(16_suppl_2), 2020.',
  sourceUrl: 'https://doi.org/10.1161/CIR.0000000000000916',
};
const dailymed = (q: string) => ({
  source: `FDA Structured Product Label via DailyMed — ${q}`,
  sourceUrl: `https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=${encodeURIComponent(q)}`,
});

export const MANIFEST: ManifestEntry[] = [
  /* ---------------------------------------------------- catecholamines */
  {
    id: 'epinephrine',
    displayName: 'Epinephrine',
    class: 'catecholamine',
    drawerGroup: 'Catecholamine',
    routes: ['IV_PUSH'],
    presetDoses: [{ route: 'IV_PUSH', amount: 1, unit: 'mg', label: '1 mg', ...ACLS }],
    pulseName: 'Epinephrine',
    gtopdbLigand: '(-)-adrenaline',
    gtopdbAliases: ['adrenaline', '(+)-adrenaline', '(&plusmn;)-adrenaline', 'epinephrine'],
    receptorAllowList: ['alpha1', 'alpha2', 'beta1', 'beta2', 'beta3'],
    notes: 'Non-selective adrenoceptor agonist. The dose-dependent split between beta-2 vasodilation at low concentration and alpha-1 vasoconstriction at high concentration is an emergent consequence of the affinity ratios, not a special case in the code.',
  },
  {
    id: 'norepinephrine',
    displayName: 'Norepinephrine',
    class: 'catecholamine',
    drawerGroup: 'Catecholamine',
    routes: ['IV_PUSH', 'IV_DRIP'],
    presetDoses: [
      { route: 'IV_PUSH', amount: 100, unit: 'mcg', label: '100 mcg', ...dailymed('norepinephrine') },
      { route: 'IV_DRIP', amount: 0.48, unit: 'mg', label: '8 mcg/min', durationMin: 60, ...dailymed('norepinephrine') },
    ],
    pulseName: 'Norepinephrine',
    gtopdbLigand: '(-)-noradrenaline',
    gtopdbAliases: ['noradrenaline', 'norepinephrine'],
    receptorAllowList: ['alpha1', 'alpha2', 'beta1', 'beta2'],
    notes: 'Alpha-1 predominant with useful beta-1 activity and almost no beta-2. Raises systemic resistance with a reflex fall in rate, which is the opposite of what an inexperienced reader expects from a "sympathomimetic".',
  },
  {
    id: 'dopamine',
    displayName: 'Dopamine',
    class: 'catecholamine',
    drawerGroup: 'Catecholamine',
    routes: ['IV_PUSH', 'IV_DRIP'],
    presetDoses: [
      { route: 'IV_PUSH', amount: 2, unit: 'mg', label: '2 mg', ...dailymed('dopamine hydrochloride') },
      { route: 'IV_DRIP', amount: 21, unit: 'mg', label: '5 mcg/kg/min', durationMin: 60, ...dailymed('dopamine hydrochloride') },
    ],
    pulseName: null,
    gtopdbLigand: 'dopamine',
    gtopdbAliases: [],
    receptorAllowList: ['d1', 'd2', 'alpha1', 'beta1', 'dat', 'net'],
    notes: 'Dose-dependent receptor recruitment: dopaminergic, then beta-1, then alpha-1. That progression falls out of the affinity ranking in the binding data, which is exactly why it is worth modelling with real affinities rather than three hard-coded dose bands.',
  },

  /* -------------------------------------------------- antiarrhythmics */
  {
    id: 'adenosine',
    displayName: 'Adenosine',
    class: 'antiarrhythmic',
    drawerGroup: 'Antiarrhythmics',
    routes: ['IV_PUSH'],
    presetDoses: [
      { route: 'IV_PUSH', amount: 6, unit: 'mg', label: '6 mg', ...ACLS },
      { route: 'IV_PUSH', amount: 12, unit: 'mg', label: '12 mg', ...ACLS },
    ],
    pulseName: null,
    gtopdbLigand: 'adenosine',
    gtopdbAliases: [],
    receptorAllowList: ['a1', 'a2a'],
    notes: 'A1-mediated transient atrioventricular block. Its six-second half-life is the whole clinical point, and the ODE integrator reproduces it without any special casing.',
  },
  {
    id: 'amiodarone',
    displayName: 'Amiodarone',
    class: 'antiarrhythmic',
    drawerGroup: 'Antiarrhythmics',
    routes: ['IV_DRIP'],
    presetDoses: [{ route: 'IV_DRIP', amount: 300, unit: 'mg', label: '300 mg over 10 min', durationMin: 10, ...ACLS }],
    pulseName: null,
    gtopdbLigand: 'amiodarone',
    gtopdbAliases: [],
    receptorAllowList: ['beta1', 'beta2', 'alpha1'],
    targetsNote:
      'Deliberate. Amiodarone acts on hERG/K_v11.1, Na_v1.5 and Ca_v1.2, and GtoPdb publishes no human ' +
      'affinity for it at any of the three. The two human rows it does publish — M5 at 56 nM and K_v1.7 at ' +
      '32 uM — are not the antiarrhythmic mechanism, and K_v1.7 sits three orders of magnitude above the free ' +
      'plasma concentration a 300 mg infusion produces. Simulating either would invent a drug effect rather ' +
      'than model this one, so the electrophysiology is carried by the cited direct effects instead.',
    directEffects: [
      {
        target: 'cardio.ectopicRate',
        gain: -0.35,
        note: 'Class III potassium-channel blockade prolongs refractoriness and slows a ventricular ectopic focus. Amiodarone has class I, II, III and IV activity; only the electrophysiological net effect is modelled.',
        ...dailymed('amiodarone'),
      },
      {
        target: 'cardio.systemicResistance',
        gain: -0.25,
        note: 'The IV formulation causes hypotension, historically attributed to the polysorbate-80 vehicle as much as to the drug.',
        ...dailymed('amiodarone'),
      },
      {
        target: 'cardio.heartRate',
        gain: -0.20,
        note: 'Non-competitive beta blockade plus calcium-channel blockade slow the sinus node.',
        ...dailymed('amiodarone'),
      },
    ],
    notes: 'Modelled through direct channel effects rather than receptor occupancy, because its dominant action is ion-channel blockade for which GtoPdb affinities do not map onto the receptor registry.',
  },

  /* ------------------------------------------------------ electrolytes */
  {
    id: 'potassium_chloride',
    displayName: 'Potassium',
    class: 'electrolyte',
    drawerGroup: 'Electrolyte',
    routes: ['ORAL', 'IV_PUSH'],
    presetDoses: [
      { route: 'ORAL', amount: 20, unit: 'mEq', label: '20 mEq', ...dailymed('potassium chloride') },
      { route: 'IV_PUSH', amount: 10, unit: 'mEq', label: '10 mEq', ...dailymed('potassium chloride') },
    ],
    pulseName: 'Potassium',
    gtopdbLigand: null,
    gtopdbAliases: [],
    payload: { k_mEq: 1, cl_mEq: 1 },
    notes: 'No receptor pharmacology. Serum potassium acts on the engine through cardiac conduction, which is why hyperkalaemia widens the QRS and slows the rate in this model.',
  },
  {
    id: 'calcium_chloride',
    displayName: 'Calcium',
    class: 'electrolyte',
    drawerGroup: 'Electrolyte',
    routes: ['ORAL', 'IV_PUSH'],
    presetDoses: [
      { route: 'IV_PUSH', amount: 1, unit: 'g', label: '1 g', ...dailymed('calcium chloride') },
      { route: 'ORAL', amount: 500, unit: 'mg', label: '500 mg', ...dailymed('calcium carbonate') },
    ],
    pulseName: 'Calcium',
    gtopdbLigand: null,
    gtopdbAliases: [],
    payload: { ca_mmol: 0.00681, cl_mEq: 0.0136 },
    notes: '1 g of calcium chloride delivers 273 mg (6.81 mmol) of elemental calcium. Payload is expressed per milligram of salt so the preset arithmetic stays in one place.',
  },
  {
    id: 'ferrous_sulfate',
    displayName: 'Iron',
    class: 'electrolyte',
    drawerGroup: 'Electrolyte',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 325, unit: 'mg', label: '325 mg', ...dailymed('ferrous sulfate') }],
    pulseName: null,
    gtopdbLigand: null,
    gtopdbAliases: [],
    payload: { iron_mg: 0.2 },
    notes: '325 mg of ferrous sulfate carries 65 mg of elemental iron. Absorption is regulated at the enterocyte and there is no excretory route, so no elimination is modelled — see docs/MODEL_LIMITATIONS.md.',
  },

  /* ----------------------------------------------------------- fluids */
  {
    id: 'normal_saline',
    displayName: 'Normal Saline',
    class: 'fluid',
    drawerGroup: 'Fluids',
    routes: ['IV_DRIP'],
    presetDoses: [
      { route: 'IV_DRIP', amount: 500, unit: 'mL', label: '500 mL bolus', durationMin: 15, ...dailymed('sodium chloride injection') },
      { route: 'IV_DRIP', amount: 1000, unit: 'mL', label: '1 L bolus', durationMin: 30, ...dailymed('sodium chloride injection') },
    ],
    pulseName: null,
    gtopdbLigand: null,
    gtopdbAliases: [],
    payload: { volume_mL: 1, na_mEq: 0.154, cl_mEq: 0.154 },
    notes: '0.9 % sodium chloride: 154 mEq/L of each ion. Payload is per millilitre.',
  },

  /* ----------------------------------------------- opioids & sedatives */
  {
    id: 'fentanyl',
    displayName: 'Fentanyl',
    class: 'opioid',
    drawerGroup: 'Opioids',
    routes: ['IV_PUSH'],
    presetDoses: [
      { route: 'IV_PUSH', amount: 100, unit: 'mcg', label: '100 mcg', ...dailymed('fentanyl citrate injection') },
      { route: 'IV_PUSH', amount: 500, unit: 'mcg', label: '500 mcg', ...dailymed('fentanyl citrate injection') },
    ],
    pulseName: 'Fentanyl',
    gtopdbLigand: 'fentanyl',
    gtopdbAliases: [],
    receptorAllowList: ['mu', 'kappa', 'delta'],
    notes: 'The 500 mcg preset exists so the respiratory-depression loop can be demonstrated: watch minute ventilation fall, PaCO2 climb, and SpO2 follow it down several minutes later.',
  },
  {
    id: 'morphine',
    displayName: 'Morphine',
    class: 'opioid',
    drawerGroup: 'Opioids',
    routes: ['IV_PUSH', 'ORAL'],
    presetDoses: [
      { route: 'IV_PUSH', amount: 4, unit: 'mg', label: '4 mg', ...dailymed('morphine sulfate injection') },
      { route: 'ORAL', amount: 15, unit: 'mg', label: '15 mg', ...dailymed('morphine sulfate oral') },
    ],
    pulseName: 'Morphine',
    gtopdbLigand: 'morphine',
    gtopdbAliases: [],
    receptorAllowList: ['mu', 'kappa', 'delta'],
    notes: 'The oral route demonstrates first-pass extraction and gastric-emptying-limited absorption; give it on a full stomach and the peak is visibly later and lower.',
  },
  {
    id: 'naloxone',
    displayName: 'Naloxone',
    class: 'other',
    drawerGroup: 'Opioids',
    routes: ['IV_PUSH', 'IM'],
    presetDoses: [
      { route: 'IV_PUSH', amount: 0.4, unit: 'mg', label: '0.4 mg', ...dailymed('naloxone hydrochloride injection') },
      { route: 'IM', amount: 2, unit: 'mg', label: '2 mg IM', ...dailymed('naloxone hydrochloride injection') },
    ],
    pulseName: 'Naloxone',
    gtopdbLigand: 'naloxone',
    gtopdbAliases: [],
    receptorAllowList: ['mu', 'kappa', 'delta'],
    notes: 'A competitive antagonist with a shorter half-life than the agonists it reverses. Give it after fentanyl and then wait: the model reproduces re-narcotisation, because the competition term in pd.ts is a real competition.',
  },
  {
    id: 'propofol',
    displayName: 'Propofol',
    class: 'anaesthetic',
    drawerGroup: 'Sedatives',
    routes: ['IV_PUSH', 'IV_DRIP'],
    presetDoses: [
      { route: 'IV_PUSH', amount: 140, unit: 'mg', label: '2 mg/kg induction', ...dailymed('propofol injectable emulsion') },
      { route: 'IV_DRIP', amount: 630, unit: 'mg', label: '150 mcg/kg/min', durationMin: 60, ...dailymed('propofol injectable emulsion') },
    ],
    pulseName: 'Propofol',
    gtopdbLigand: 'propofol',
    gtopdbAliases: [],
    receptorAllowList: ['gabaa'],
    targetsNote:
      'Deliberate. This drug acts as a positive allosteric modulator of GABA-A, and GtoPdb indexes allosteric ' +
      'modulation of the GABA-A complex without an orthosteric affinity this pipeline can convert to a Ki. ' +
      'The sedative, cardiovascular and neuromuscular actions are carried by the PULSE CONCENTRATION-EFFECT ' +
      'BLOCK (drug.pulsePd), not by direct effects — an earlier version of this note said direct effects and ' +
      'was simply wrong about its own model. The receptor panel will show no GABA-A occupancy for it, which ' +
      'is a limitation of the source rather than of the model.',
    directEffects: [
      {
        target: 'resp.drive',
        gain: -0.85,
        note:
          'Central respiratory depression, and at induction doses frank apnoea. THIS IS NOT IN THE PULSE ' +
          'BLOCK: Pulse sets this drug\'s respirationRate modifier POSITIVE, so without this the model shows ' +
          'an induction agent that does not stop anyone breathing. The label is unambiguous that it does, and ' +
          'a simulator that omits it teaches the single most dangerous thing about the drug backwards.',
        ...dailymed('propofol injectable emulsion'),
      },
    ],
    notes: 'The context-sensitive half-time of the three-compartment model is visible directly: a short infusion wakes up quickly, a long one does not.',
  },
  {
    id: 'midazolam',
    displayName: 'Midazolam',
    class: 'sedative',
    drawerGroup: 'Sedatives',
    routes: ['IV_PUSH', 'IM'],
    presetDoses: [
      { route: 'IV_PUSH', amount: 2, unit: 'mg', label: '2 mg', ...dailymed('midazolam hydrochloride injection') },
      { route: 'IM', amount: 5, unit: 'mg', label: '5 mg IM', ...dailymed('midazolam hydrochloride injection') },
    ],
    pulseName: 'Midazolam',
    gtopdbLigand: 'midazolam',
    gtopdbAliases: [],
    receptorAllowList: ['gabaa'],
    targetsNote:
      'Deliberate. This drug acts as a positive allosteric modulator of GABA-A, and GtoPdb indexes allosteric ' +
      'modulation of the GABA-A complex without an orthosteric affinity this pipeline can convert to a Ki. ' +
      'The sedative, cardiovascular and neuromuscular actions are carried by the PULSE CONCENTRATION-EFFECT ' +
      'BLOCK (drug.pulsePd), not by direct effects — an earlier version of this note said direct effects and ' +
      'was simply wrong about its own model. The receptor panel will show no GABA-A occupancy for it, which ' +
      'is a limitation of the source rather than of the model.',
    notes: 'Additive with opioids at GABA-A and mu respectively — the combination is modelled as two independent effect contributions on resp.drive, which is why it is more dangerous than either alone.',
  },
  {
    id: 'ketamine',
    displayName: 'Ketamine',
    class: 'anaesthetic',
    drawerGroup: 'Sedatives',
    routes: ['IV_PUSH', 'IM'],
    presetDoses: [
      { route: 'IV_PUSH', amount: 100, unit: 'mg', label: '1.5 mg/kg', ...dailymed('ketamine hydrochloride injection') },
      { route: 'IM', amount: 280, unit: 'mg', label: '4 mg/kg IM', ...dailymed('ketamine hydrochloride injection') },
    ],
    pulseName: 'Ketamine',
    gtopdbLigand: 'ketamine',
    gtopdbAliases: [],
    receptorAllowList: ['nmda', 'mu', 'dat', 'net'],
    notes: 'NMDA channel blockade against a substantial resting tone, which is why an antagonist produces a large effect with no agonist in the system. Respiratory drive is comparatively preserved.',
  },

  /* ----------------------------------------------- autonomic & others */
  {
    id: 'atropine',
    displayName: 'Atropine',
    class: 'other',
    drawerGroup: 'Autonomic',
    routes: ['IV_PUSH'],
    presetDoses: [{ route: 'IV_PUSH', amount: 1, unit: 'mg', label: '1 mg', ...ACLS }],
    pulseName: null,
    gtopdbLigand: 'atropine',
    gtopdbAliases: [],
    receptorAllowList: ['m1', 'm2', 'm3', 'm4', 'm5'],
    notes: 'A pure antagonist with nothing to antagonise unless the receptor carries resting tone. M2 baseline tone in the registry is what lets it work, and it is also why its effect is smaller in an already-tachycardic body.',
  },
  {
    id: 'phenylephrine',
    displayName: 'Phenylephrine',
    class: 'catecholamine',
    drawerGroup: 'Autonomic',
    routes: ['IV_PUSH', 'IV_DRIP'],
    presetDoses: [
      { route: 'IV_PUSH', amount: 100, unit: 'mcg', label: '100 mcg', ...dailymed('phenylephrine hydrochloride injection') },
      { route: 'IV_DRIP', amount: 3, unit: 'mg', label: '50 mcg/min', durationMin: 60, ...dailymed('phenylephrine hydrochloride injection') },
    ],
    pulseName: 'Phenylephrine',
    gtopdbLigand: 'phenylephrine',
    gtopdbAliases: [],
    receptorAllowList: ['alpha1', 'alpha2'],
    notes: 'A selective alpha-1 agonist. The reflex bradycardia it produces is not coded anywhere: it emerges because the baroreflex sees the pressure rise.',
  },
  {
    id: 'albuterol',
    displayName: 'Albuterol',
    class: 'other',
    drawerGroup: 'Respiratory',
    routes: ['INHALED'],
    presetDoses: [{ route: 'INHALED', amount: 2.5, unit: 'mg', label: '2.5 mg nebulised', ...dailymed('albuterol sulfate inhalation') }],
    pulseName: 'Albuterol',
    gtopdbLigand: 'salbutamol',
    gtopdbAliases: ['albuterol', '(R)-salbutamol'],
    receptorAllowList: ['beta2', 'beta1'],
    notes: 'Demonstrates the inhaled route: a pulmonary bioavailability factor into the central compartment, with the beta-1 cross-reactivity that produces the familiar tremor and tachycardia.',
  },
  {
    id: 'furosemide',
    displayName: 'Furosemide',
    class: 'other',
    drawerGroup: 'Renal',
    routes: ['IV_PUSH', 'ORAL'],
    presetDoses: [
      { route: 'IV_PUSH', amount: 40, unit: 'mg', label: '40 mg', ...dailymed('furosemide injection') },
      { route: 'ORAL', amount: 40, unit: 'mg', label: '40 mg', ...dailymed('furosemide tablets') },
    ],
    pulseName: 'Furosemide',
    gtopdbLigand: 'furosemide',
    gtopdbAliases: [],
    receptorAllowList: ['nkcc2'],
    notes: 'Its Na-K-2Cl action reaches the engine through the Pulse TubularPermeabilityModifier, which is concentration-scaled by a published EC50 rather than by a gain we chose. Two-thirds renally eliminated, so it is the clearest demonstration of the GFR-to-clearance feedback: diurese a body into hypovolaemia and the next dose clears more slowly and acts for longer.',
  },
];

export const MANIFEST_BY_ID = new Map(MANIFEST.map((m) => [m.id, m]));

/*
 * The wider therapeutic set lives in its own file for readability and is concatenated
 * here. Every entry in it was checked against the GtoPdb cache before being written:
 * a drug with no sourceable affinity and no sourceable pharmacokinetics renders as a
 * row of em-dashes and teaches nothing, so the list is what could be sourced rather
 * than what could be named.
 */
import { MANIFEST_2 } from './drug_manifest_2';

MANIFEST.push(...MANIFEST_2);
