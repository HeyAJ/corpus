import { P } from './constants';
import type { RhythmMode } from '../../bridge/types';

/**
 * THE STATE VECTOR.
 *
 * One mutable object graph, allocated once at boot and mutated in place every tick.
 * Nothing in here is allocated per-tick: at 100 Hz with a 2 ms budget, per-tick
 * allocation is the single easiest way to lose the frame (spec 2, perf budget).
 *
 * Everything the UI can see is a *computed output* of this vector, never a stored
 * display value. Ejection fraction in particular is derived from the elastance
 * model's EDV/ESV (spec 4.2), not a number anyone typed.
 */

export interface ChamberState {
  /** Contained blood volume, mL. */
  V: number;
  /** Instantaneous pressure, mmHg. */
  P: number;
  /** Unstressed volume, mL. */
  V0: number;
  Emax: number;
  Emin: number;
}

export interface CompartmentState {
  V: number;
  P: number;
  V0: number;
  C: number;
}

export interface CardioState {
  rhythm: RhythmMode;
  /** Seconds elapsed in the current cardiac cycle. */
  cycleT: number;
  /** Length of the current R-R interval, s. Resampled at each beat (AF jitters it). */
  rr: number;
  /** Rate the oscillator is currently running at. */
  hr: number;
  /** Last 8 R-R intervals, for the displayed (averaged) rate. */
  rrHistory: number[];
  activation: number;

  lv: ChamberState;
  rv: ChamberState;
  la: ChamberState;
  ra: ChamberState;

  aorta: CompartmentState;
  veins: CompartmentState;
  pulmArt: CompartmentState;
  pulmVein: CompartmentState;

  /** Aortic-valve flow, mL/s. A state variable because of the Windkessel inertance. */
  qAortic: number;
  qPulmonic: number;

  /** Per-beat accumulators, latched at each beat boundary. */
  beatEdv: number;
  beatEsv: number;
  beatSv: number;
  beatEjectedVolume: number;
  beatMinLv: number;
  beatMaxLv: number;

  sbp: number;
  dbp: number;
  /** Right atrial diastolic pressure, latched per beat. The other half of CPP. */
  dbpRa: number;
  map: number;
  /** Running extremes within the current beat, latched into sbp/dbp at the boundary. */
  beatMaxAo: number;
  beatMinAo: number;
  /** Per-beat minimum right atrial pressure: the relaxation-phase value CPP needs. */
  beatMinRa: number;
  mapFilter: number;

  co: number;
  ef: number;
  cpp: number;

  /** Multiplicative modulators. 1.0 = baseline. Driven by reflex + pharmacology. */
  contractilityScale: number;
  svrScale: number;
  venousToneScale: number;
  chronotropicScale: number;
  /** Additive HR offset from direct drug effects, bpm. */
  hrOffset: number;

  /** Total circulating volume, mL. Falls with haemorrhage, rises with fluids. */
  bloodVolume: number;
  targetBloodVolume: number;
  /** Isotonic volume moved this tick (blood, saline); excluded from electrolyte concentration. */
  isotonicDelta_mL: number;

  /** CPR compression impulse, decays over ~1.2 s (spec 9). */
  cprImpulse: number;
  /** VF fibrillation amplitude 0..1; drives the ECG noise generator. */
  fibAmplitude: number;
}

export interface ReflexState {
  /** Afferent baroreceptor firing, Hz. */
  afferent: number;
  /** Pure-transport delay lines for the two efferent limbs. */
  sympDelayLine: number[];
  vagalDelayLine: number[];
  sympIdx: number;
  vagalIdx: number;
  /** Efferent tone, 0..1 after the first-order lag. */
  symp: number;
  vagal: number;
  /** Filtered arterial pressure the baroreceptor actually sees. */
  sensedPressure: number;
}

export interface EcgState {
  x: number;
  y: number;
  z: number;
  theta: number;
  /** Band-limited VF noise oscillator state. */
  vfPhase: number;
  vfValue: number;
  vfTarget: number;
  /** Counter for the exact 250 Hz output tap (every 2nd 500 Hz sub-step). */
  emitCounter: number;
}

export interface RespState {
  /** Seconds into the current breath. */
  cycleT: number;
  period: number;
  rate: number;
  tidalVolume: number;
  /** Current lung gas volume, mL (FRC + inspired). */
  lungVolume: number;
  alveolarPo2: number;
  alveolarPco2: number;
  arterialPo2: number;
  arterialPco2: number;
  venousPo2: number;
  venousPco2: number;
  spo2: number;
  etco2: number;
  /** Ventilatory drive, L/min, from the chemoreceptors. */
  drive: number;
  /** Multiplicative depressant factor from opioids/sedatives. 1 = unaffected. */
  driveScale: number;
  intubated: boolean;
  apnoeic: boolean;
  /**
   * Oxygen contents, mL O2 per 100 mL blood. Held as STATE, because the body's oxygen
   * stores are what decide how long a stopped breath takes to kill: lung gas at FRC
   * plus the oxygen in five litres of blood, drawn down at the metabolic rate. When
   * PaO2 was computed algebraically from PaCO2 there were no stores at all, and an
   * apnoeic body's saturation froze wherever the CO2 happened to be.
   */
  arterialO2Content: number;
  venousO2Content: number;
  /** Fraction of pulmonary flow bypassing ventilated alveoli, as used this tick. */
  shuntFraction: number;
  /** Airway narrowing left after bronchodilators, 0..1, as used this tick. */
  bronchoconstriction: number;
}

export interface FluidState {
  /** Interstitial fluid volume, mL. Defends plasma volume across the capillary wall. */
  interstitial: number;
  /** Running net balance since the run began, mL. Positive is a gain. */
  balance_mL: number;
}

/** Convenience top-level scratch the fluid system owns; declared here for the type. */

export interface RenalState {
  gfr: number;
  rbf: number;
  autoreg: number;
  urineRate: number;
  bladderVolume: number;
  creatinine: number;
  /** Fraction of baseline GFR; renally-eliminated drugs scale their k10 by this. */
  clearanceScale: number;
}

export interface Digesta {
  id: number;
  segmentIndex: number;
  /** 0..1 along the segment centreline. */
  s: number;
  volume: number;
  carb_g: number;
  fat_g: number;
  protein_g: number;
  solidFraction: number;
  /**
   * Relative to glucose = 100. Scales the RATE of glucose absorption and nothing else,
   * so the parcel still gives up all of its carbohydrate eventually — the index changes
   * the shape of the curve, not the area under it. 55 for anything undeclared.
   */
  glycaemicIndex: number;
  /** Unabsorbed bulk, grams. Slows absorption in proportion to the parcel's own carb. */
  fibre_g: number;
  /** mg of each drug riding along, keyed by drug id. */
  drugPayload: Record<string, number>;
  label: string;
  /** Seconds spent in the current segment; drives the Elashoff emptying curve. */
  residence: number;
  /** Volume on arrival in the stomach. The emptying curve is a fraction of THIS. */
  stomachEntryVolume: number;
  /**
   * What has left this bolus but has not yet been handed to the duodenum as a
   * discrete parcel. PER BOLUS, not shared: a module-level scratch buffer let a
   * meal's emptying carry a separately-swallowed tablet's payload out with it, and
   * an oral dose taken with a fatty meal absorbed FASTER than one taken fasted.
   */
  pendingTransfer: number;
  pendingCarb: number;
  pendingFat: number;
  pendingProtein: number;
  pendingPayload: Record<string, number>;
}

export interface GiState {
  digesta: Digesta[];
  nextId: number;
  /** Free acid content of the stomach, mEq. Gastric pH is derived from this. */
  gastricAcid_mEq: number;
  gastricBuffer_mEq: number;
  glucoseAbsorptionRate: number;
  peristalsisPhase: number;
}

export interface MetabolicState {
  /** Bergman minimal model: plasma glucose, remote insulin action, plasma insulin. */
  G: number;
  X: number;
  I: number;
  glucagonDrive: number;
  coreTemp: number;
  /** Additive heat load, W, from thermogenic drug effects. */
  heatOffset: number;
  /** Sweat production right now, mL/min. Sets the evaporative heat loss and a fluid loss. */
  sweatRate_mL_per_min: number;
  /** Injected insulin present now, uU/mL, on top of the pancreas's own. Set by the engine. */
  exogenousInsulin_uU_per_mL: number;
}

export interface NeuroState {
  cbf: number;
  consciousness: number;
  sedation: number;
  /** EEG oscillator bank phases, one per band. */
  eegPhase: number[];
  eegValue: number;
}

export interface BloodChemState {
  na: number;
  k: number;
  ca: number;
  cl: number;
  hco3: number;
  ph: number;
  lactate: number;
  hct: number;
  albumin: number;
}

/** One extravascular dose, absorbing at its own route's rate. */
export interface DepotParcel {
  route: string;
  /** Mass remaining in the depot, mg. */
  amount: number;
  /** First-order release constant for this route, per minute. */
  ka_min: number;
  /** Time still to elapse before release begins, minutes. */
  lagRemaining: number;
  /** Fraction of released mass that survives to reach the systemic circulation. */
  bioavailability: number;
}

/** One drug's PK compartments. Allocated when the drug is first administered. */
export interface DrugPkState {
  drugId: string;
  /** Central, peripheral-fast, peripheral-slow amounts, mg. */
  a1: number;
  a2: number;
  a3: number;
  /** Absorption depots, mg. */
  gut: number;
  /**
   * Extravascular depots awaiting absorption. A LIST, not a scalar, because each
   * route absorbs at its own rate: an intramuscular dose and a transdermal patch on
   * the same body are two depots with rate constants three orders of magnitude
   * apart, and merging them into one number would make the patch release at the
   * injection's rate. Insertion-ordered, so the state stays deterministic.
   */
  depots: DepotParcel[];
  /** Gut absorption lag remaining, min. */
  lagRemaining: number;
  infusionRate: number;

  /**
   * Fluid / electrolyte payload still to be delivered, in the drug's own preset units.
   *
   * A payload drug has no volume of distribution, so it never goes through the
   * compartment model - it acts straight on blood volume and serum chemistry. That used
   * to happen the instant it was given, for EVERY route, because `applyPayload` was
   * called before the route was even looked at. A litre of saline labelled "over 30
   * minutes" arrived in one 10 ms tick, and a swallowed potassium tablet raised serum
   * potassium as fast as an intravenous push.
   */
  payloadPending: number;
  /** Zero-order delivery, units per minute. Zero means first-order at the gastric rate. */
  payloadRate: number;
  /**
   * Nebulised delivery: a zero-order pulmonary input that stops itself when the
   * chamber empties. Deliberately not folded into `infusionRate`, which belongs to
   * IV_DRIP and runs until cancelled — one is a device finishing, the other is a
   * decision, and cancelling the drip must not stop the nebuliser.
   */
  pulmonaryRate: number;
  pulmonaryRemaining: number;
  cumulativeDose: number;
  /** Plasma concentration, mg/L (== ug/mL). Cached each tick. */
  cp: number;
  /** Free concentration in nM — the only thing receptors see. null if MW unknown. */
  freeNM: number | null;
}

export interface ReceptorState {
  receptorId: string;
  /** Occupancy per ligand, keyed by drug id. */
  byLigand: Record<string, number>;
  total: number;
  activation: number;
}

export interface ProcedureState {
  cprActive: boolean;
  cprAuto: boolean;
  lastCompressionT: number;
  compressionTimes: number[];
  padsPlaced: boolean;
  defibCharge: number;
  defibCharged: boolean;
  shocksDelivered: number;
  arrestStartT: number | null;
  ivAccess: boolean;
}

/** Receptor/drug effects are accumulated here each tick, then read by the systems. */
export type EffectAccumulator = Record<string, number>;

/**
 * ENDOCRINE STATE.
 *
 * One concentration per hormone, in that hormone's own clinical unit, plus the
 * secretory drive that produced it. Held as a keyed record rather than named fields
 * because the set is data-driven from src/data/hormones.json: adding a hormone must
 * not require a change to this interface, or the data stops being data.
 *
 * WHY HORMONES ARE NOT DRUGS HERE. A drug enters by a route, distributes through
 * compartments and is eliminated. A hormone is SECRETED by a gland in response to
 * something the model already computes, acts, and is cleared — the interesting part
 * is the feedback loop that sets the secretion rate, not the pharmacokinetics. So
 * they get their own subsystem, and they reach physiology through the same effect
 * bus every drug uses.
 */
export interface HormoneState {
  /** Plasma concentration, in the unit declared in hormones.json. */
  level: number;
  /** Current secretion rate, in units per minute. */
  secretion: number;
  /** 0..1 receptor-level activity after the hormone's own Hill transform. */
  activity: number;
}

export interface EndocrineState {
  hormones: Record<string, HormoneState>;
  /** Hypothalamic-pituitary-adrenal drive, 0..1. Slow, and it drives cortisol. */
  stressAxis: number;
  /** Simulated hour of day, 0..24, for the circadian terms several hormones carry. */
  clockHour: number;
  /**
   * Exogenous hormone added by a drug that IS that hormone, in each hormone's own unit.
   * Kept separate from the secreted `level` because the drug's pharmacokinetics already
   * govern its rise and fall - folding it into the integrated pool would decay it twice.
   * The endocrine system reads the SUM of this and the secreted level for both the
   * effect vector and the lab readout, so an insulin infusion and the pancreas's own
   * output reach glucose uptake by one path. Keyed by hormone id.
   */
  exogenous: Record<string, number>;
}

/**
 * WHAT THE BLOOD IS CARRYING, for the renderer.
 *
 * The vascular view draws particles moving along arteries and veins; this is what
 * tells it what colour they should be and how many there should be. It is a
 * DERIVED, NORMALISED view of state the engine already has — never a second source
 * of truth. A marker at 0.8 means "this substance is at 80% of its own reference
 * scale", not any absolute concentration, because the renderer has no business
 * knowing what a milligram per litre looks like.
 */
export interface TransportMarker {
  id: string;
  label: string;
  /** 0..1 against this substance's own reference scale. */
  level: number;
  /** Where it currently is, so the renderer can route it correctly. */
  compartment: 'arterial' | 'venous' | 'both';
}

/* ==========================================================================
 * BEHAVIOUR, AFFECT, PATHOLOGY AND INFECTION
 *
 * Four subsystems added together, because they share one idea the model did not
 * previously have: that something OTHER than a drug can drive physiology. Until now
 * the only way to move this body was to inject something into it. A body that cannot
 * run, cannot sleep, cannot be frightened and cannot be infected is not a body, it is
 * a pharmacology bench.
 *
 * They are kept as separate state blocks rather than one "condition" blob because they
 * decay on completely different clocks - fright resolves in minutes, stress in hours,
 * a viral load over weeks - and lumping them would force one time constant on all four.
 *
 * All four reach the rest of the body through the EFFECT BUS, exactly as drugs and
 * hormones do. That is the whole reason the bus exists (ADR notes in core/effects.ts):
 * adrenaline from an infusion and adrenaline from being frightened arrive at
 * cardio.contractility by the same path and neither knows the other happened.
 * ========================================================================== */

/** What the body is DOING: sleeping, sitting, running. */
export interface ActivityState {
  /** Actual metabolic exertion, 0 = at rest, 1 = maximal sustainable effort. */
  exertion: number;
  /** What the person is trying to sustain; `exertion` chases it with a real time constant. */
  exertionTarget: number;
  /** 0 = fully awake, 1 = deep sleep. Continuous, because arousal is. */
  sleepDepth: number;
  /** Seconds spent in the current sleep or wake bout. */
  boutT: number;
  /** Oxygen owed, litres. Repaid after exercise stops, which is why recovery is not instant. */
  oxygenDebt_L: number;
}

/** What the body FEELS: the psychological drivers, which are physiological drivers. */
export interface AffectState {
  /** Acute alarm. Fast onset, fast offset - the startle response. 0..1. */
  fright: number;
  /** Sustained psychological stress. Slow, and drives the HPA axis. 0..1. */
  stress: number;
  /** Depressed mood. Very slow; changes set point rather than causing an event. 0..1. */
  depression: number;
}

/** What is WRONG with the body, apart from what was given to it. */
export interface PathologyState {
  /** Nociceptive input before any analgesia, 0..1. */
  nociception: number;
  /** Pain actually experienced, after analgesia. 0..1. */
  pain: number;
  /** Systemic inflammatory activation, 0..1. The SIRS axis. */
  inflammation: number;
  /** Active haemorrhage, mL/min. */
  bleedRate_mL_per_min: number;
  /** Cumulative blood lost, mL. */
  bloodLost_mL: number;
  /** Vestibular disturbance, 0..1. */
  vertigo: number;
}

/** One pathogen currently in the body. */
export interface PathogenBurden {
  pathogenId: string;
  /**
   * log10 of the burden relative to the INOCULUM. Kept for continuity with the intent
   * that seeds it (`dose_log10`) and for the growth readout; the dynamics run on
   * `burden`, which is normalised to the pathogen's own untreated peak.
   */
  load_log10: number;
  /** Burden relative to this pathogen's untreated peak, 0..1 (can exceed 1 briefly). */
  burden: number;
  /** Seconds since inoculation. */
  t: number;
  /** Incubation is over and the illness is declared. */
  symptomatic: boolean;
  /** Pathogen-specific adaptive immunity, 0..1. Builds after symptom onset. */
  adaptive: number;
  /** Antimicrobial kill applied last tick, per hour, for the readout. */
  drugKill_per_h: number;
  /** Cleared: burden fell below the extinction floor. Kept for the record. */
  cleared: boolean;
  /** Seconds since the burden peaked, or -1 before the peak. */
  sincePeak: number;
}

/** What the body is FIGHTING. */
export interface InfectionState {
  active: PathogenBurden[];
  /** Combined innate and adaptive activation, 0..1. */
  immuneActivation: number;
  /** CD4+ T cells per microlitre. Falls in untreated HIV; the number that defines AIDS. */
  cd4_per_uL: number;
  /** White cell count, x10^9/L. Follows immune activation with a lag. */
  wbc: number;
  /** C-reactive protein, mg/L. Hepatic acute-phase output, lags by a day. */
  crp: number;
  /** Red cells destroyed by a haemolytic pathogen since the run began, fraction of Hct. */
  haemolysed: number;
}

/**
 * WHERE THE BODY IS.
 *
 * Operator-set, like the scenario sliders: the ambient temperature, the altitude and
 * the gas being breathed are facts about the room, not about the patient, and every
 * physiological consequence of changing them is computed downstream.
 */
export interface EnvironmentState {
  ambientTemp_C: number;
  altitude_m: number;
  /** Inspired oxygen fraction delivered. 0.2095 is room air. */
  fio2: number;
  posture: 'supine' | 'sitting' | 'standing';
  /** Blood currently pooled in the dependent veins by gravity, mL. */
  pooled_mL: number;
}

/**
 * THE METABOLIC HALF OF ACID-BASE.
 *
 * pH is not stored; it is Henderson-Hasselbalch on the live PaCO2 and the bicarbonate
 * computed from these terms every tick. `metabolicHco3` is the bicarbonate the body
 * would have at a PaCO2 of 40 - the part fixed acids, lactate, vomiting and bicarbonate
 * infusions move - and `renalCompensation` is the slow renal answer to a sustained
 * PaCO2 change, which takes days.
 */
export interface AcidBaseState {
  /**
   * Bicarbonate before organic acids are counted, mEq/L. Moved by fixed-acid and alkali
   * loads (a bicarbonate infusion, vomited acid, diarrhoeal bicarbonate) and returned
   * toward normal by the kidney over days. Lactate and ketoacids are subtracted from it
   * 1:1 at the point of use rather than integrated into it, so clearing lactate gives
   * the bicarbonate back automatically - which is what metabolising lactate does.
   */
  metabolicHco3: number;
  /** The slow renal answer to a sustained PaCO2 change, mEq/L. */
  renalCompensation: number;
  /** Ketoacids, mmol/L. */
  ketones: number;
}

/**
 * THE HEART'S OWN OXYGEN SUPPLY.
 *
 * The missing link between the lungs and the heart. Until this existed nothing in the
 * cardiac model read oxygen at all: a body could stop breathing, saturate at 20 %, and
 * keep a normal sinus rhythm for ever.
 */
export interface MyocardiumState {
  /** Oxygen supply as a fraction of demand, low-pass filtered. >= 1 is adequate. */
  supplyRatio: number;
  /** 0 = well oxygenated, 1 = no aerobic reserve left. */
  hypoxia: number;
  /** Seconds the myocardium has spent profoundly hypoxic. Drives PEA and asystole. */
  hypoxicTime: number;
  /** Seconds of adequate oxygenation during an arrest. Drives ROSC. */
  recoveryTime: number;
}

/** Signs and experiences carried on the bus, integrated where they need a time course. */
export interface MindState {
  pupil_mm: number;
  nausea: number;
  vomiting: boolean;
  /** Seconds until the current vomiting episode ends, or until the next may start. */
  vomitTimer: number;
  vomitus_mL: number;
  seizing: boolean;
  seizureT: number;
  /** Refractory time after a seizure ends, s. */
  postictal: number;
  muscleTone: number;
}

/** Blood clotting state. */
export interface CoagulationState {
  /** Clotting-factor capacity relative to normal, 0..1+. */
  factorActivity: number;
  /** Platelet aggregation relative to normal, 0..1+. */
  plateletFunction: number;
  platelets: number;
  /** 0..1, how much of the current bleed is being held by clot. */
  haemostasis: number;
}

/** Airway and mast-cell state. */
export interface AirwayState {
  /** Intrinsic airway narrowing (asthma), 0..1. Operator-set. */
  asthma: number;
  /** Circulating mast-cell mediator activity, 0..1. Decays after an exposure. */
  histamine: number;
  /** Net narrowing after bronchodilators, 0..1. */
  constriction: number;
  /** Mast-cell release still to come from the last exposure, 0..1. */
  releaseRemaining: number;
}

export interface SimState {
  t: number;
  seed: number;
  running: boolean;
  timeScale: number;
  /** Ticks since boot; cheap modulo scheduling for slow subsystems. */
  tick: number;

  cardio: CardioState;
  reflex: ReflexState;
  ecg: EcgState;
  resp: RespState;
  renal: RenalState;
  fluids: FluidState;
  gi: GiState;
  metabolic: MetabolicState;
  endocrine: EndocrineState;
  neuro: NeuroState;
  chem: BloodChemState;
  drugs: DrugPkState[];
  receptors: ReceptorState[];
  procedures: ProcedureState;

  activity: ActivityState;
  affect: AffectState;
  pathology: PathologyState;
  infection: InfectionState;
  environment: EnvironmentState;
  acidBase: AcidBaseState;
  myocardium: MyocardiumState;
  mind: MindState;
  coagulation: CoagulationState;
  airway: AirwayState;

  /** Non-urine fluid loss right now (diarrhoea + sweat), mL/min. Readout. */
  fluidLossRate_mL_per_min: number;

  effects: EffectAccumulator;
  /**
   * LAST TICK'S EFFECT BUS, kept so a subsystem can read a target that is written
   * later in the same tick than it runs.
   *
   * The bus is cleared at the top of every tick, so anything reading a target before
   * its writer has run gets exactly zero, however loudly the writer pushed a
   * millisecond earlier. That is not a hypothetical: `stepPathology` runs before
   * pharmacodynamics and needs `neuro.analgesia`, which opioids write afterwards, so
   * morphine put +1.24 on the bus and the pain calculation read 0.000 and pain never
   * moved at all.
   *
   * Reordering does not fix it. Moving the pathology block after the drugs would fix
   * analgesia and leave the hormone-driven targets broken, because `stepEndocrine`
   * runs later still. A one-tick mirror fixes every case at once, and one tick is
   * 10 ms - far below any time constant in this model.
   */
  prevEffects: EffectAccumulator;

  body: { mass_kg: number; height_m: number; bsa_m2: number; age_y: number; sex: 'male' | 'female' };

  /** Latched condition state for hysteresis (spec 4.8). */
  conditionLatch: Record<string, boolean>;
}

function chamber(V: number, V0: number, Emax: number, Emin: number): ChamberState {
  return { V, P: 0, V0, Emax, Emin };
}

function compartment(V: number, V0: number, C: number): CompartmentState {
  return { V, P: 0, V0, C };
}

export function createInitialState(seed: number): SimState {
  const bv = P('blood.totalVolume_mL');
  const hr = P('cardio.heartRateBaseline_bpm');
  const rr0 = 60 / hr;

  // Compartment volumes chosen so the loop starts near its own steady state:
  // chambers 348, arterial 900, venous 3302, pulmonary 450. Sum = 5000 mL.
  const cardio: CardioState = {
    rhythm: 'nsr',
    cycleT: 0,
    rr: rr0,
    hr,
    rrHistory: [rr0, rr0, rr0, rr0, rr0, rr0, rr0, rr0],
    activation: 0,

    lv: chamber(120, P('cardio.lv.V0_mL'), P('cardio.lv.Emax_mmHg_per_mL'), P('cardio.lv.Emin_mmHg_per_mL')),
    rv: chamber(126, P('cardio.rv.V0_mL'), P('cardio.rv.Emax_mmHg_per_mL'), P('cardio.rv.Emin_mmHg_per_mL')),
    la: chamber(52, P('cardio.la.V0_mL'), P('cardio.la.E_mmHg_per_mL'), P('cardio.la.E_mmHg_per_mL')),
    ra: chamber(54, P('cardio.ra.V0_mL'), P('cardio.ra.E_mmHg_per_mL'), P('cardio.ra.E_mmHg_per_mL')),

    aorta: compartment(900, P('cardio.aorta.unstressedVolume_mL'), P('cardio.wk.C_mL_per_mmHg')),
    // The venous reservoir absorbs whatever is left over, so the compartments sum
    // to exactly the sourced total blood volume however the others are tuned.
    veins: compartment(bv - 120 - 126 - 52 - 54 - 900 - 135 - 320, P('cardio.venous.unstressedVolume_mL'), P('cardio.venous.C_mL_per_mmHg')),
    pulmArt: compartment(135, P('cardio.pulmArt.unstressedVolume_mL'), P('cardio.pulm.C_mL_per_mmHg')),
    pulmVein: compartment(320, P('cardio.pulmVein.unstressedVolume_mL'), P('cardio.pulm.venous.C_mL_per_mmHg')),

    qAortic: 0,
    qPulmonic: 0,

    beatEdv: 120,
    beatEsv: 50,
    beatSv: 70,
    beatEjectedVolume: 0,
    beatMinLv: 120,
    beatMaxLv: 120,

    sbp: 120,
    dbp: 78,
    dbpRa: 4,
    map: 92,
    beatMaxAo: 120,
    beatMinAo: 78,
    beatMinRa: 4,
    mapFilter: 92,

    co: 5.0,
    ef: 0.58,
    cpp: 60,

    contractilityScale: 1,
    svrScale: 1,
    venousToneScale: 1,
    chronotropicScale: 1,
    hrOffset: 0,

    bloodVolume: bv,
    targetBloodVolume: bv,
    isotonicDelta_mL: 0,

    cprImpulse: 0,
    fibAmplitude: 0,
  };

  const sympSteps = Math.max(1, Math.round(P('baroreflex.sympDelay_s') / P('sim.dt_s')));
  const vagalSteps = Math.max(1, Math.round(P('baroreflex.vagalDelay_s') / P('sim.dt_s')));

  const reflex: ReflexState = {
    afferent: 0.5,
    sympDelayLine: new Array<number>(sympSteps).fill(0.5),
    vagalDelayLine: new Array<number>(vagalSteps).fill(0.5),
    sympIdx: 0,
    vagalIdx: 0,
    symp: 0.5,
    vagal: 0.5,
    sensedPressure: P('baroreflex.setpoint_mmHg'),
  };

  const ecg: EcgState = { x: 1, y: 0, z: 0, theta: 0, vfPhase: 0, vfValue: 0, vfTarget: 0, emitCounter: 0 };

  const resp: RespState = {
    cycleT: 0,
    period: 60 / P('resp.rate_per_min'),
    rate: P('resp.rate_per_min'),
    tidalVolume: P('resp.tidalVolume_mL'),
    lungVolume: P('resp.frc_mL'),
    alveolarPo2: 104,
    alveolarPco2: P('resp.paco2_mmHg'),
    arterialPo2: P('resp.pao2_mmHg'),
    arterialPco2: P('resp.paco2_mmHg'),
    venousPo2: 40,
    venousPco2: 46,
    spo2: 0.975,
    etco2: 38,
    drive: (P('resp.rate_per_min') * P('resp.tidalVolume_mL')) / 1000,
    driveScale: 1,
    intubated: false,
    apnoeic: false,
    arterialO2Content: 19.8,
    venousO2Content: 14.8,
    shuntFraction: 0.03,
    bronchoconstriction: 0,
  };

  const renal: RenalState = {
    gfr: P('renal.gfr_mL_per_min'),
    rbf: P('renal.rbf_mL_per_min'),
    autoreg: 1,
    urineRate: P('renal.urineOutput_mL_per_min'),
    bladderVolume: 120,
    creatinine: 0.9,
    clearanceScale: 1,
  };

  const fluids: FluidState = {
    interstitial: P('fluid.interstitialVolume_mL'),
    balance_mL: 0,
  };

  const gi: GiState = {
    digesta: [],
    nextId: 1,
    // Fasted stomach: ~30 mL of gastric juice. Acid content in mEq that reproduces
    // the fasted pH through the same derivation the engine uses every tick.
    gastricAcid_mEq: 30 * Math.pow(10, -P('gi.gastricPhFasted')),
    gastricBuffer_mEq: 0,
    glucoseAbsorptionRate: 0,
    peristalsisPhase: 0,
  };

  const metabolic: MetabolicState = {
    G: P('blood.glucose_mg_per_dL'),
    X: 0,
    I: P('metabolic.insulinBasal_uU_per_mL'),
    glucagonDrive: 0,
    coreTemp: P('thermal.coreTemp_C'),
    heatOffset: 0,
    sweatRate_mL_per_min: 0,
    exogenousInsulin_uU_per_mL: 0,
  };

  // Hormone levels are seeded from src/data/hormones.json by systems/endocrine.ts on
  // its first step, so this starts empty rather than duplicating those baselines here.
  // Two copies of a baseline is one copy too many: they diverge silently.
  const endocrine: EndocrineState = {
    hormones: {},
    stressAxis: 0,
    clockHour: 8,
    exogenous: {},
  };

  const neuro: NeuroState = {
    cbf: P('neuro.cerebralBloodFlow_mL_per_min'),
    consciousness: 1,
    sedation: 0,
    eegPhase: [0, 1.7, 3.1, 4.9, 2.2],
    eegValue: 0,
  };

  const chem: BloodChemState = {
    na: P('blood.na_mEq_per_L'),
    k: P('blood.k_mEq_per_L'),
    ca: P('blood.caIonised_mmol_per_L'),
    cl: P('blood.cl_mEq_per_L'),
    hco3: P('blood.hco3_mEq_per_L'),
    ph: P('blood.pH'),
    lactate: P('blood.lactate_mmol_per_L'),
    hct: P('blood.haematocrit'),
    albumin: P('blood.albumin_g_per_dL'),
  };

  const procedures: ProcedureState = {
    cprActive: false,
    cprAuto: false,
    lastCompressionT: -999,
    compressionTimes: [],
    padsPlaced: false,
    defibCharge: 0,
    defibCharged: false,
    shocksDelivered: 0,
    arrestStartT: null,
    ivAccess: true,
  };

  return {
    t: 0,
    seed,
    running: true,
    timeScale: 1,
    tick: 0,
    cardio,
    reflex,
    ecg,
    resp,
    renal,
    fluids,
    gi,
    metabolic,
    endocrine,
    neuro,
    chem,
    drugs: [],
    receptors: [],
    procedures,

    // A body at rest, awake, calm, unhurt and uninfected. Every one of these is a
    // deliberate zero rather than an absent field: "not in pain" is a state the model
    // should be able to state, not merely fail to mention.
    activity: { exertion: 0, exertionTarget: 0, sleepDepth: 0, boutT: 0, oxygenDebt_L: 0 },
    affect: { fright: 0, stress: 0, depression: 0 },
    pathology: {
      nociception: 0,
      pain: 0,
      inflammation: 0,
      bleedRate_mL_per_min: 0,
      bloodLost_mL: 0,
      vertigo: 0,
    },
    infection: {
      active: [],
      immuneActivation: 0,
      cd4_per_uL: P('immune.cd4Baseline_per_uL'),
      wbc: P('immune.wbcBaseline_10e9_per_L'),
      crp: P('immune.crpBaseline_mg_per_L'),
      haemolysed: 0,
    },
    environment: {
      ambientTemp_C: P('thermal.ambientTemp_C'),
      altitude_m: 0,
      fio2: P('resp.fio2RoomAir'),
      posture: 'supine',
      pooled_mL: 0,
    },
    acidBase: {
      metabolicHco3: P('blood.hco3_mEq_per_L'),
      renalCompensation: 0,
      ketones: P('blood.ketones_mmol_per_L'),
    },
    myocardium: { supplyRatio: 2, hypoxia: 0, hypoxicTime: 0, recoveryTime: 0 },
    mind: {
      pupil_mm: P('neuro.pupilBaseline_mm'),
      nausea: 0,
      vomiting: false,
      vomitTimer: 0,
      vomitus_mL: 0,
      seizing: false,
      seizureT: 0,
      postictal: 0,
      muscleTone: 0,
    },
    coagulation: {
      factorActivity: 1,
      plateletFunction: 1,
      platelets: P('blood.platelets_10e9_per_L'),
      haemostasis: 0,
    },
    airway: { asthma: 0, histamine: 0, constriction: 0, releaseRemaining: 0 },

    fluidLossRate_mL_per_min: 0,

    effects: {},
    prevEffects: {},
    body: {
      mass_kg: P('body.mass_kg'),
      height_m: P('body.height_m'),
      bsa_m2: P('body.bsa_m2'),
      age_y: 35,
      sex: 'male',
    },
    conditionLatch: {},
  };
}
