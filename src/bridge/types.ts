/**
 * THE LAYER CONTRACT (spec 3).
 *
 *   Layer A -> B/C : SimSnapshot at 20 Hz (structured clone)
 *                  + a Float32Array ring at 250 Hz for waveforms (SharedArrayBuffer)
 *   B/C -> Layer A : SimIntent messages only. Never a direct state write.
 *
 * Everything in this file must be structured-cloneable: plain objects, arrays and
 * primitives. No class instances, no functions, no Maps with object keys.
 */

export type RhythmMode =
  | 'nsr'
  | 'sinus_tach'
  | 'sinus_brad'
  | 'afib'
  | 'vt'
  | 'vfib'
  | 'asystole'
  | 'pea';

/**
 * ROUTES OF ADMINISTRATION.
 *
 * The parameters for each live in src/data/routes.json with a citation; this union is
 * only the set of identifiers. Adding one here without adding it there is a type
 * error at the route-table lookup, which is deliberate.
 */
export type Route =
  | 'IV_PUSH'
  | 'IV_DRIP'
  | 'INTRAOSSEOUS'
  | 'IM'
  | 'SUBCUTANEOUS'
  | 'INTRANASAL'
  | 'SUBLINGUAL'
  | 'RECTAL'
  | 'TRANSDERMAL'
  | 'INHALED'
  | 'NEBULISED'
  | 'ORAL';

export type Severity = 'watch' | 'warn' | 'critical';

export interface ConditionTag {
  id: string;
  label: string;
  severity: Severity;
  /** Human-readable reason, used for the screen-reader text equivalent (spec 10.6). */
  detail: string;
}

export interface CardioSnapshot {
  rhythm: RhythmMode;
  /** Instantaneous rate driving the ECG oscillator. */
  heartRate_bpm: number;
  /** Rate averaged over the last 8 R-R intervals; this is what the HUD chip shows. */
  heartRateDisplay_bpm: number;
  systolic_mmHg: number;
  diastolic_mmHg: number;
  map_mmHg: number;
  /** Per-beat outputs computed by the elastance model, never stored constants. */
  strokeVolume_mL: number;
  cardiacOutput_L_per_min: number;
  cardiacIndex: number;
  ejectionFraction: number;
  edv_mL: number;
  esv_mL: number;
  /** Live chamber volumes: the heart mesh's pulse is driven by these (spec 6.5). */
  lvVolume_mL: number;
  rvVolume_mL: number;
  laVolume_mL: number;
  raVolume_mL: number;
  /** 0..1 within the current cardiac cycle. */
  cyclePhase: number;
  /** Normalised elastance activation 0..1, used for the mesh contraction curve. */
  activation: number;
  contractilityScale: number;
  svrScale: number;
  centralVenousPressure_mmHg: number;
  coronaryPerfusionPressure_mmHg: number;
  bloodVolume_mL: number;
}

export interface RespSnapshot {
  rate_per_min: number;
  tidalVolume_mL: number;
  minuteVentilation_L_per_min: number;
  /** 0..1 lung inflation above residual, drives the lung mesh scale. */
  inflation: number;
  spo2: number;
  pao2_mmHg: number;
  paco2_mmHg: number;
  etco2_mmHg: number;
  /** 0..1 within the breath cycle. */
  cyclePhase: number;
  apnoeic: boolean;
  intubated: boolean;
}

export interface RenalSnapshot {
  gfr_mL_per_min: number;
  renalBloodFlow_mL_per_min: number;
  urineOutput_mL_per_min: number;
  bladderVolume_mL: number;
  bladderFillFraction: number;
  /** Fraction of baseline GFR, 0..1+. The cliff below MAP 80 is the whole point. */
  autoregulationFactor: number;
  creatinine_mg_per_dL: number;
}

export interface GiDigestaSnapshot {
  id: number;
  segment: string;
  /** 0..1 position along the segment centreline. */
  s: number;
  volume_mL: number;
  solidFraction: number;
  label: string;
}

export interface GiSnapshot {
  gastricVolume_mL: number;
  gastricFillFraction: number;
  gastricPh: number;
  /** mg/min entering portal blood right now. */
  glucoseAbsorption_mg_per_min: number;
  digesta: GiDigestaSnapshot[];
  /** Peristaltic phase 0..1, drives the travelling-wave displacement. */
  peristalsisPhase: number;
}

export interface MetabolicSnapshot {
  glucose_mg_per_dL: number;
  insulin_uU_per_mL: number;
  remoteInsulinAction: number;
  glucagonDrive: number;
  coreTemp_C: number;
}

export interface NeuroSnapshot {
  cerebralBloodFlow_mL_per_min: number;
  /** 0..1; 1 = fully alert. Falls with CBF, sedation and hypoxia. */
  consciousness: number;
  /** Dominant EEG band, derived from consciousness + sedative occupancy. */
  eegBand: 'beta' | 'alpha' | 'theta' | 'delta' | 'suppressed';
  sedationLevel: number;
}

export interface BloodChemSnapshot {
  na_mEq_per_L: number;
  k_mEq_per_L: number;
  caIonised_mmol_per_L: number;
  cl_mEq_per_L: number;
  hco3_mEq_per_L: number;
  ph: number;
  lactate_mmol_per_L: number;
  haematocrit: number;
  /** g/dL. Carried in state and used for protein binding; surfaced for the lab panel. */
  albumin_g_per_dL: number;
}

export interface DrugSnapshot {
  drugId: string;
  displayName: string;
  /** Total plasma concentration, ng/mL. */
  plasma_ng_per_mL: number;
  /** Unbound fraction only — the part that can bind a receptor (spec 5.2). */
  free_nM: number | null;
  /** Amounts in each compartment, mg. */
  a1_mg: number;
  a2_mg: number;
  a3_mg: number;
  gut_mg: number;
  /** Total across every extravascular depot, mg. */
  depot_mg: number;
  /** One entry per outstanding extravascular dose, newest last. */
  depots: {
    route: string;
    amount_mg: number;
    /** False while the route's lag is still running (a patch, for twelve hours). */
    releasing: boolean;
    lagRemaining_min: number;
  }[];
  /** A nebuliser is still delivering. */
  nebulising: boolean;
  /** Active zero-order infusion, mg/min, 0 when not running. */
  infusionRate_mg_per_min: number;
  cumulativeDose_mg: number;
}

export interface ReceptorSnapshot {
  receptorId: string;
  label: string;
  group: string;
  /** Total occupancy 0..1 across all bound ligands. */
  occupancy: number;
  /** Signed activation: occupancy weighted by intrinsic activity, -1..1. */
  activation: number;
  /** Which drug contributes the most occupancy right now. */
  dominantLigand: string | null;
}

export interface ProcedureSnapshot {
  cprActive: boolean;
  cprRate_per_min: number;
  cprQuality: 'none' | 'slow' | 'good' | 'fast';
  lastCompressionAgo_s: number;
  defibCharge_J: number;
  defibCharged: boolean;
  padsPlaced: boolean;
  shocksDelivered: number;
  downtime_s: number;
  ivAccess: boolean;
}

/** One hormone, as the interface reads it. */
export interface HormoneSnapshot {
  id: string;
  label: string;
  /** Plasma level in the hormone's own clinical unit. */
  level: number;
  unit: string;
  /** 0..1 receptor-level activity. */
  activity: number;
  /** The reference range, so the UI can say high/normal/low without a second table. */
  refLow: number;
  refHigh: number;
  gland: string;
}

export interface EndocrineSnapshot {
  hormones: HormoneSnapshot[];
  stressAxis: number;
  clockHour: number;
}

/**
 * WHAT THE BLOOD IS CARRYING.
 *
 * Feeds the vascular renderer, which draws particles along the arterial and venous
 * trees. Every value is NORMALISED against that substance's own reference scale,
 * because the renderer must not be in the business of knowing what a milligram per
 * litre looks like — that mapping belongs in the sim, where the reference can be
 * cited.
 */
export interface TransportSnapshot {
  markers: {
    id: string;
    label: string;
    /** 0..1 against this substance's own reference scale. */
    level: number;
    compartment: 'arterial' | 'venous' | 'both';
    /** Hex colour the renderer tints its particles with. */
    colour: number;
  }[];
  /** 0..1 within the current cardiac cycle, so flow can pulse in step with the heart. */
  pulsePhase: number;
  /** Instantaneous aortic flow, mL/s. Drives particle speed. */
  aorticFlow_mL_per_s: number;
  /** 0..1 oxygen saturation of arterial and venous blood, for vessel colour. */
  arterialSat: number;
  venousSat: number;
}

/**
 * WHAT THE BODY IS DOING, FEELING AND SUFFERING.
 *
 * Kept out of the other snapshots on purpose. These are not measurements a monitor
 * takes off a patient - nobody has a sensor for "frightened" - they are the STATE OF
 * THE SCENARIO, and conflating them with the vital signs would suggest the body is
 * reporting them when really the operator set them. The interface shows them as
 * controls that read back, not as readings.
 */
export interface BehaviourSnapshot {
  /** 0 = at rest, 1 = maximal sustainable effort. */
  exertion: number;
  exertionTarget: number;
  /** 0 = awake, 1 = deep sleep. */
  sleepDepth: number;
  /** Litres of oxygen owed; why recovery is not instant. */
  oxygenDebt_L: number;
  fright: number;
  stress: number;
  depression: number;
}

export interface PathologySnapshot {
  /** The stimulus, before any analgesia. */
  nociception: number;
  /** What is actually felt. Morphine separates this from nociception. */
  pain: number;
  inflammation: number;
  bleedRate_mL_per_min: number;
  bloodLost_mL: number;
  vertigo: number;
}

/* ==========================================================================
 * THE WIDER BODY: environment, acid-base, mind, blood clotting, infection.
 *
 * Added together because they were the parts of a body that the snapshot could not
 * describe. Every field here is a COMPUTED OUTPUT of the engine, never a stored
 * display value, exactly like the vital signs above: pupil size is what the effect
 * bus has done to a resting pupil, the INR is what the coagulation state has done to
 * a normal clotting time, and pH is Henderson-Hasselbalch applied to the live PaCO2
 * and bicarbonate. Nothing in this block can be set directly by the interface; the
 * interface sets the ENVIRONMENT (and the scenario), and the body answers.
 * ========================================================================== */

/** Where the body is. Operator-set, and read back so the interface can show it. */
export interface EnvironmentSnapshot {
  /** Air temperature around the body, C. */
  ambientTemp_C: number;
  /** Height above sea level, m. Sets the barometric pressure. */
  altitude_m: number;
  /** Barometric pressure derived from altitude, mmHg. */
  barometric_mmHg: number;
  /** Fraction of inspired oxygen actually being breathed, 0.21 in room air. */
  fio2: number;
  /** Inspired PO2 after water-vapour correction, mmHg. The number altitude changes. */
  inspiredPo2_mmHg: number;
  /** Body position. Standing pools blood in the legs; lying down returns it. */
  posture: 'supine' | 'sitting' | 'standing';
}

/** Arterial acid-base, computed every tick from PaCO2 and the metabolic buffer. */
export interface AcidBaseSnapshot {
  ph: number;
  hco3_mEq_per_L: number;
  paco2_mmHg: number;
  /** Standard base excess, mEq/L. Negative is a metabolic acidosis. */
  baseExcess_mEq_per_L: number;
  /** Na - (Cl + HCO3), mEq/L. Raised by lactate and ketones. */
  anionGap_mEq_per_L: number;
  /** Beta-hydroxybutyrate + acetoacetate, mmol/L. */
  ketones_mmol_per_L: number;
  /** Plain-language reading: 'normal', 'respiratory acidosis', 'mixed ...' etc. */
  interpretation: string;
}

/**
 * The effect-bus targets that describe experience and signs rather than a vital:
 * what a clinician would SEE (pupils, tone, a seizure) and what the patient would
 * REPORT (nausea, euphoria). 0..1 unless stated.
 */
export interface MindSnapshot {
  /** Pupil diameter, mm. Opioids constrict, antimuscarinics and sympathomimetics dilate. */
  pupil_mm: number;
  anxiety: number;
  euphoria: number;
  psychedelia: number;
  /** Reinforcement signal. Not addiction: the drive the drug is producing now. */
  dependence: number;
  nausea: number;
  /** Hunger, 0 = none; appetite suppressants lower it, fasting raises it. */
  appetite: number;
  /** Skeletal muscle tone, -1 = flaccid paralysis, 0 = normal, +1 = rigidity. */
  muscleTone: number;
  /** Margin before a seizure, 1 = normal, 0 = at threshold. */
  seizureMargin: number;
  seizing: boolean;
  /** Vomiting is happening right now. */
  vomiting: boolean;
  /** Cumulative volume vomited, mL. */
  vomitus_mL: number;
}

/** Blood clotting, as a clinician's coagulation screen reads it. */
export interface CoagulationSnapshot {
  /** International normalised ratio. 1.0 is normal. */
  inr: number;
  /** Activated partial thromboplastin time, s. */
  aptt_s: number;
  /** Platelet aggregation relative to normal, 0..1+. Aspirin and clopidogrel lower it. */
  plateletFunction: number;
  /** Platelet count, x10^9/L. */
  platelets_10e9_per_L: number;
  /** 0..1, how much of an active bleed the clotting system is currently holding. */
  haemostasis: number;
}

export interface PathogenSnapshot {
  pathogenId: string;
  label: string;
  kind: 'virus' | 'bacterium' | 'parasite' | 'toxin';
  site: string;
  /** Burden relative to this pathogen's untreated peak, 0..1+. */
  burden: number;
  /** log10 of burden relative to the inoculum, for the "growth" readout. */
  load_log10: number;
  /** Hours since inoculation. */
  t_h: number;
  phase: 'incubating' | 'symptomatic' | 'resolving' | 'cleared';
  /** Antimicrobial kill currently being applied, per hour. */
  drugKill_per_h: number;
}

export interface InfectionSnapshot {
  active: PathogenSnapshot[];
  /** Combined innate and adaptive activation, 0..1. */
  immuneActivation: number;
  /** White cell count, x10^9/L. */
  wbc_10e9_per_L: number;
  /** C-reactive protein, mg/L. */
  crp_mg_per_L: number;
  /** CD4+ T cells, per uL. */
  cd4_per_uL: number;
  /** qSOFA-style sepsis flag computed from live signs. */
  sepsis: boolean;
}

/** Fluid compartments and balance. */
export interface FluidSnapshot {
  interstitial_mL: number;
  /** Net fluid balance since the run began, mL. Positive is a gain. */
  balance_mL: number;
  /** Plasma osmolality, mOsm/kg (2Na + glucose/18 + urea/2.8). */
  osmolality_mOsm_per_kg: number;
  /** Losses happening now that are not urine: diarrhoea, vomiting, sweat, leak. mL/min. */
  extraLosses_mL_per_min: number;
  /** Airway narrowing, 0 = open, 1 = closed. Bronchospasm, anaphylaxis. */
  bronchoconstriction: number;
}

/** One message from the engine that the operator should see: a refused dose, say. */
export interface EngineNotice {
  id: number;
  t: number;
  tone: 'info' | 'warn' | 'critical';
  text: string;
}

export interface SimSnapshot {
  /** Monotonic sequence number; the renderer interpolates between seq and seq-1. */
  seq: number;
  /** Simulated seconds since the run began. */
  t: number;
  /** performance.now() in the worker when this snapshot was produced. */
  wallClock_ms: number;
  timeScale: number;
  running: boolean;
  seed: number;
  /** Cost of the last physiology tick, ms. Surfaced so the perf budget is visible. */
  tickCost_ms: number;
  cardio: CardioSnapshot;
  resp: RespSnapshot;
  renal: RenalSnapshot;
  gi: GiSnapshot;
  metabolic: MetabolicSnapshot;
  endocrine: EndocrineSnapshot;
  transport: TransportSnapshot;
  neuro: NeuroSnapshot;
  chem: BloodChemSnapshot;
  drugs: DrugSnapshot[];
  receptors: ReceptorSnapshot[];
  conditions: ConditionTag[];
  procedures: ProcedureSnapshot;
  behaviour: BehaviourSnapshot;
  pathology: PathologySnapshot;
  environment: EnvironmentSnapshot;
  acidBase: AcidBaseSnapshot;
  mind: MindSnapshot;
  coagulation: CoagulationSnapshot;
  infection: InfectionSnapshot;
  fluids: FluidSnapshot;
  /**
   * THE EFFECT BUS, as it stood at the end of the last tick: every target, its summed
   * fractional modifier. This is the single most useful thing for explaining WHY a
   * vital sign moved — a beta blocker and a fright argue here, in plain numbers, before
   * either reaches the heart. Zero-valued targets are omitted.
   */
  effects: Record<string, number>;
  /**
   * Who is pushing on each target: the same bus broken down by source ('drug:morphine',
   * 'hormone:cortisol', 'baroreflex', 'exertion', 'pathogen:influenza_a', ...). Only
   * contributions above a small threshold are kept, so the object stays small.
   */
  effectSources: Record<string, Record<string, number>>;
  /** Recent engine messages, newest last. Refused doses land here instead of vanishing. */
  notices: EngineNotice[];
  /** The subject being simulated, as the engine is using it. Set with SET_BODY. */
  body: { mass_kg: number; height_m: number; age_y: number; sex: 'male' | 'female'; bsa_m2: number };
}

/* ------------------------------------------------------------- dose bounds */

/**
 * THE BOUNDS ON A SIMULATED DOSE.
 *
 * A tenth of a reference dose is low enough to show a sub-threshold response, and ten
 * times it is high enough to show frank toxicity for every drug in the set — which is
 * the entire educational point of letting the number move at all. Beyond that range
 * the model stops being informative: the pharmacokinetics are still linear, so a
 * hundred-fold dose produces a hundred-fold concentration and a plateau, which
 * teaches nothing except that the model is linear.
 *
 * Enforced in the WORKER, not in the interface. A bound that only exists in the
 * component that draws the slider is not a bound.
 */
export const MIN_DOSE_MULTIPLIER = 0.1;
export const MAX_DOSE_MULTIPLIER = 10;

/** Infusion and nebuliser run times the user may set, minutes. */
export const MIN_DOSE_DURATION_MIN = 1;
export const MAX_DOSE_DURATION_MIN = 240;

/** How far above the cited reference a dose is, as the interface describes it. */
export type DoseBand = 'sub-reference' | 'reference' | 'above-reference' | 'far-above-reference';

export function doseBandFor(multiplier: number): DoseBand {
  if (multiplier < 0.95) return 'sub-reference';
  if (multiplier <= 1.05) return 'reference';
  if (multiplier <= 3) return 'above-reference';
  return 'far-above-reference';
}

/* ------------------------------------------------------------------ intents */

export type SimIntent =
  | { type: 'START' }
  | { type: 'PAUSE' }
  | { type: 'RESET'; seed?: number }
  | { type: 'SET_TIME_SCALE'; x: number }
  /**
   * ADMINISTER carries a CITED REFERENCE DOSE plus a multiplier, never an absolute
   * amount. `dose` and `unit` must still match a preset declared for this drug and
   * this route exactly, or the worker refuses the intent — that check is unchanged.
   * What `multiplier` adds is the ability to explore either side of that reference
   * without ever expressing a dose that is not anchored to a citation.
   *
   * The distinction matters. A free mg/kg field is a prescribing interface and reads
   * as dosing guidance. "0.4x the labelled adult dose" is a simulation parameter: it
   * cannot be transcribed onto a drug chart, it always shows what it is relative to,
   * and the thing it is relative to has a source the user can go and read.
   */
  | {
      type: 'ADMINISTER';
      drugId: string;
      route: Route;
      dose: number;
      unit: string;
      label: string;
      /** Clamped to [MIN_DOSE_MULTIPLIER, MAX_DOSE_MULTIPLIER] in the worker. */
      multiplier?: number;
      /** Overrides the preset duration for infused and nebulised routes, minutes. */
      durationMin?: number;
    }
  | { type: 'STOP_INFUSION'; drugId: string }
  | { type: 'EAT'; foodId: string; portions: number }
  | { type: 'CPR_COMPRESSION' }
  | { type: 'SET_CPR_AUTO'; on: boolean }
  | { type: 'PLACE_PADS' }
  | { type: 'CHARGE_DEFIB'; joules: number }
  | { type: 'DEFIBRILLATE' }
  | { type: 'INTUBATE'; on: boolean }
  | { type: 'IV_ACCESS'; on: boolean }
  | { type: 'HAEMORRHAGE'; volume_mL: number }
  | { type: 'FORCE_RHYTHM'; rhythm: RhythmMode }
  | { type: 'SET_BODY'; mass_kg?: number; height_m?: number; age_y?: number; sex?: 'male' | 'female' }

  /* ---------------------------------------------------- behaviour and affect */
  /** Sustained effort the person is attempting, 0 = at rest, 1 = maximal. */
  | { type: 'SET_EXERTION'; level: number }
  /** Lie down and sleep, or wake up. Depth develops on its own. */
  | { type: 'SET_SLEEP'; asleep: boolean }
  /** A startle: acute fear, fast on and fast off. */
  | { type: 'FRIGHTEN'; intensity: number }
  /** Sustained psychological load and mood, both slow. */
  | { type: 'SET_AFFECT'; stress?: number; depression?: number }

  /* ------------------------------------------------------------- pathology */
  /** Nociceptive input, before any analgesia. */
  | { type: 'SET_PAIN'; level: number }
  /** Continuous blood loss, mL/min. Zero stops it. Distinct from HAEMORRHAGE,
   *  which is a single instantaneous loss of a stated volume. */
  | { type: 'SET_BLEED'; rate_mL_per_min: number }
  | { type: 'SET_VERTIGO'; level: number }

  /* ------------------------------------------------------------- infection */
  /** Inoculate with a pathogen from src/data/pathogens.json. */
  | { type: 'INOCULATE'; pathogenId: string; dose_log10?: number }
  /** Clear one pathogen, or all of them when no id is given. */
  | { type: 'CLEAR_INFECTION'; pathogenId?: string }

  /* ----------------------------------------------------------- environment */
  /**
   * Where the body is and what it is breathing. Every field optional; an absent field
   * leaves that part of the environment as it was. `fio2` is the oxygen fraction the
   * operator is delivering (room air 0.21, a non-rebreather mask about 0.8, a
   * ventilator anything up to 1.0) — a setting of the equipment, not of the body.
   */
  | {
      type: 'SET_ENVIRONMENT';
      ambientTemp_C?: number;
      altitude_m?: number;
      fio2?: number;
    }
  | { type: 'SET_POSTURE'; posture: 'supine' | 'sitting' | 'standing' }
  /** Drink plain water, mL. Absorbed through the gut like any other fluid. */
  | { type: 'DRINK_WATER'; volume_mL: number }
  /** Empty the bladder. */
  | { type: 'VOID_BLADDER' }
  /** Airway narrowing from an asthma attack, 0..1. Bronchodilators oppose it. */
  | { type: 'SET_BRONCHOSPASM'; level: number }
  /** Exposure to an allergen the body is sensitised to: a mast-cell discharge, 0..1. */
  | { type: 'ALLERGEN_EXPOSURE'; severity: number }
  /** Clamp and set a bleed back to zero AND reset the lost-blood tally. */
  | { type: 'STOP_ALL_BLEEDING' };

/** Waveform channel layout in the shared ring (spec 3). */
export const WAVEFORM_CHANNELS = ['ecg', 'eeg', 'abp', 'resp'] as const;
export type WaveformChannel = (typeof WAVEFORM_CHANNELS)[number];
export const WAVEFORM_RATE_HZ = 250;
/** 12 s of history at 250 Hz — more than the widest strip needs. */
export const WAVEFORM_CAPACITY = 3000;
