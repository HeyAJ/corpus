import drugsFile from '../../data/drugs.json';
import receptorsFile from '../../data/receptors.json';
import type { Drug, DrugsFile, Receptor, ReceptorsFile } from '../../data/pharma-types';
import foodsFile from '../../data/foods.json';

import { P } from './constants';
import { Rng } from './rng';
import { clearEffects, setEffectSource, trackEffectSources, effectBreakdown, addEffect } from './effects';
import { createInitialState, type SimState } from './state';

import { stepCardio, addVolume, SUBSTEP_AORTIC_P, CARDIO_SUBSTEPS } from '../systems/cardio';
import { stepBaroreflex } from '../systems/baroreflex';
import { stepRespiratory } from '../systems/respiratory';
import { stepRenal } from '../systems/renal';
import { stepFluids } from '../systems/fluids';
import { stepGi, gastricVolume, gastricPh, swallow, SEGMENTS, STOMACH_INDEX } from '../systems/gi';
import { stepMetabolic } from '../systems/metabolic';
import { stepEndocrine, HORMONES } from '../systems/endocrine';
import { buildTransport } from '../derive/transport';
import { toMilligrams, isMassUnit } from '../pharma/units';
import { stepNeuro, stepEeg, dominantBand } from '../systems/neuro';
import {
  stepProcedures,
  stepArrestProgression,
  compress,
  cprRate,
  cprQuality,
  chargeDefib,
  defibrillate,
  type ShockResult,
} from '../systems/procedures';

import { stepPk } from '../pharma/pk';
import { stepPd, buildLinks, createReceptorStates, type DrugTargetLink } from '../pharma/pd';
import { applyPulsePd, buildPulsePdPlans, type PulsePdPlan } from '../pharma/pulsepd';
import { administer, stopInfusion, getOrCreatePkState, rebalanceElectrolytes, stepPayload } from '../pharma/dosing';

import { stepEcg, ECG_SUBSTEPS } from '../derive/waveforms/ecg';
import { deriveConditions } from '../derive/conditions';

import type { SimIntent, SimSnapshot, GiDigestaSnapshot } from '../../bridge/types';
import { stepActivity } from '../systems/activity';
import { stepAffect } from '../systems/affect';
import { stepPathology } from '../systems/pathology';
import { stepInfection, setInfectionDrugTable, newBurden, PATHOGEN_BY_ID, isSepsis } from '../systems/infection';
import { stepEnvironment } from '../systems/environment';
import { stepAcidBase, baseExcess, anionGap, interpretAcidBase } from '../systems/acidbase';
import { stepMyocardium } from '../systems/myocardium';
import { stepMind, seizureMargin } from '../systems/mind';
import { stepCoagulation, inr, aptt } from '../systems/coagulation';
import { stepAirway } from '../systems/airway';
import { barometricPressure } from '../systems/respiratory';
import { inspiredPo2 } from '../systems/environment';
import { voidBladder } from '../systems/fluids';
import {
  WAVEFORM_CHANNELS,
  MIN_DOSE_MULTIPLIER,
  MAX_DOSE_MULTIPLIER,
  MIN_DOSE_DURATION_MIN,
  MAX_DOSE_DURATION_MIN,
} from '../../bridge/types';

/**
 * THE ENGINE.
 *
 * Owns the state vector, the data tables and the tick. It knows nothing about
 * three.js, React, the DOM, or how it is being driven — worker.ts supplies the
 * clock and the transport. That separation is what makes the determinism test
 * possible: the same seed and the same intent log, stepped by a plain loop with no
 * wall clock involved, must produce byte-identical output (spec 4.1, 12).
 */

const DRUGS = (drugsFile as unknown as DrugsFile).drugs;
const RECEPTORS = (receptorsFile as unknown as ReceptorsFile).receptors;
const DEFAULT_KON = (receptorsFile as unknown as ReceptorsFile).defaultKon.value;

interface FoodDef {
  id: string;
  displayName: string;
  portion_g: number;
  volume_mL: number;
  carb_g: number;
  fat_g: number;
  protein_g: number;
  solidFraction: number;
  source: string;
  /** Relative to glucose = 100. Optional; absent means the model uses its default. */
  glycaemicIndex?: number;
  /** Unabsorbed bulk, grams per portion. */
  fibre_g?: number;
  /** Grams of ethanol per portion. Handed to the ethanol pharmacokinetics. */
  alcohol_g?: number;
  /** Milligrams of caffeine per portion. Handed to the caffeine pharmacokinetics. */
  caffeine_mg?: number;
}
const FOODS = (foodsFile as { foods: FoodDef[] }).foods;

const DRUG_BY_ID = new Map<string, Drug>(DRUGS.map((d) => [d.id, d]));

/**
 * The ceiling on a direct effect, as a multiple of the reference-dose response.
 *
 * A numerical guard, not a physiological claim: it exists so that stacking doses cannot
 * push a fractional modifier so far that a consumer computes a negative heart rate. Four
 * is far outside any preset in the set and well inside the range where `(1 + effect)`
 * still means what `effects.ts` says it means.
 */
const DIRECT_EFFECT_CEILING = 4;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * What one reference dose of each drug puts in the plasma.
 *
 * The first preset expressed in a MASS unit over the cited central volume. A preset in
 * mL or mEq is a fluid or an electrolyte whose payload is handled elsewhere and has no
 * plasma concentration, so a reference taken from it would be meaningless - the same
 * reasoning, and the same guard, as `derive/transport.ts`.
 */
function buildDirectReferenceCp(drugs: Drug[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const drug of drugs) {
    if (drug.directEffects.length === 0) continue;
    const v1 = drug.pk.V1_L;
    const reference = drug.presetDoses.find((p) => isMassUnit(p.unit));
    if (v1 === null || v1 <= 0 || !reference) continue;
    out.set(drug.id, toMilligrams(reference.amount, reference.unit) / v1);
  }
  return out;
}
const RECEPTOR_BY_ID = new Map<string, Receptor>(RECEPTORS.map((r) => [r.id, r]));

export interface WaveformFrame {
  ecg: number;
  eeg: number;
  abp: number;
  resp: number;
}

/**
 * THE RESTING BODY.
 *
 * `createInitialState` writes down a plausible resting body: heart rate 72, mean
 * pressure 92, the baroreflex limbs both sitting at 0.5. Plausible, but not this
 * model's own equilibrium - and the difference was visible on every single boot.
 *
 * The sigmoid in the baroreflex afferent is non-linear, so a pulsating pressure does
 * not average to the sigmoid of the mean; the true fixed point is nearer 66 bpm at 94
 * mmHg. Started at 72/92 the model had to travel there, and because the sympathetic
 * limb carries a transport delay and a 7 s lag the trip overshot: heart rate fell to
 * 41 bpm within four seconds and the rhythm classifier duly reported SINUS
 * BRADYCARDIA. Every session opened on a bradycardia alarm that was pure startup
 * transient, and every test read its "resting" baseline off the same swinging value.
 *
 * So the model is asked where its own resting state is, rather than being told. Thirty
 * seconds of warm-up, the clock wound back to zero, and that state is the one every
 * engine starts from.
 *
 * WHY NOT JUST WRITE 66 BPM INTO THE INITIAL STATE: because 66 is not a number anyone
 * measured. It is an output of the constants already in the model, and those carry
 * citations. Deriving it keeps the provenance rule intact; hard-coding it would smuggle
 * in an uncited physiological constant that happened to come out of a debugger.
 *
 * The warm-up runs ONCE per process and is cached, because 30 s of simulated time costs
 * about half a second and a test file builds dozens of engines. It is deliberately run
 * on a FIXED seed rather than the caller's: a cache filled by whichever engine happened
 * to be constructed first would make the resting state depend on test ordering, which is
 * precisely the kind of silent non-determinism this engine exists to avoid. Noise after
 * t = 0 is driven by the caller's own seed as usual.
 */
const SETTLE_S = 30;
const SETTLE_SEED = 0x5eed;
let restingBaseline: SimState | null = null;
let settling = false;

function createRestingState(seed: number): SimState {
  if (restingBaseline === null) {
    // Re-entrancy: the warm-up engine below runs this same constructor.
    if (settling) return createInitialState(seed);
    settling = true;
    try {
      const warm = new Engine(SETTLE_SEED);
      const dt = P('sim.dt_s');
      const steps = Math.round(SETTLE_S / dt);
      for (let i = 0; i < steps; i++) {
        warm.tick(dt);
        warm.pending.length = 0;
      }
      warm.state.t = 0;
      restingBaseline = structuredClone(warm.state);
    } finally {
      settling = false;
    }
  }
  const s = structuredClone(restingBaseline);
  s.seed = seed;
  return s;
}

export class Engine {
  state: SimState;
  rng: Rng;
  private links: Map<string, DrugTargetLink[]>;
  private pulsePlans: Map<string, PulsePdPlan>;
  /** Plasma concentration each drug's own reference dose produces, mg/L. */
  private directRefCp: Map<string, number>;
  private drugConc = new Map<string, number | null>();
  private seq = 0;
  private lastTickCost = 0;
  private conditionCache = deriveConditionsEmpty();
  /** Ring of waveform frames produced by the last tick, consumed by the transport. */
  readonly pending: number[][] = [];

  /** Reported by the last shock, surfaced once then cleared. */
  lastShock: ShockResult | null = null;

  /** Rolling engine notices (a refused dose, a warning). Surfaced in the snapshot. */
  private notices: { id: number; t: number; tone: 'info' | 'warn' | 'critical'; text: string }[] = [];
  private noticeId = 1;

  private notice(tone: 'info' | 'warn' | 'critical', text: string): void {
    this.notices.push({ id: this.noticeId++, t: this.state.t, tone, text });
    if (this.notices.length > 12) this.notices.shift();
  }

  constructor(seed: number) {
    this.state = createRestingState(seed);
    this.rng = new Rng(seed);
    this.links = buildLinks(DRUGS, RECEPTORS, DEFAULT_KON);
    this.pulsePlans = buildPulsePdPlans(DRUGS, RECEPTORS);
    this.directRefCp = buildDirectReferenceCp(DRUGS);
    this.state.receptors = createReceptorStates(RECEPTORS);
    setInfectionDrugTable(DRUG_BY_ID);
    trackEffectSources(this.state.effects);
  }

  reset(seed: number): void {
    this.state = createRestingState(seed);
    this.rng = new Rng(seed);
    this.state.receptors = createReceptorStates(RECEPTORS);
    trackEffectSources(this.state.effects);
    this.seq = 0;
    this.pending.length = 0;
    this.lastShock = null;
    this.notices = [];
  }

  /** One fixed physiology step. `dt` is always P('sim.dt_s'). */
  tick(dt: number): void {
    const s = this.state;
    const t0 = nowMs();

    const volumeBefore = s.cardio.bloodVolume;

    clearEffects(s.effects, s.prevEffects);

    // 0. What the body is doing, feeling, suffering and fighting, and where it is.
    //
    // BEFORE pharmacodynamics, so that everything these push onto the bus is already
    // there when the drugs push on the same targets in the same tick. A body that is
    // frightened AND given a beta blocker should have the two arrive together and argue,
    // which is the entire point of routing both through one accumulator. The `source`
    // set before each call is display-only attribution (effects.ts): it records who put
    // each number on the bus, for the impact panel, and changes nothing about the sum.
    stepEnvironment(s, dt);
    setEffectSource('activity');
    stepActivity(s, dt);
    setEffectSource('affect');
    stepAffect(s, dt);
    setEffectSource('pathology');
    stepPathology(s, dt);
    stepInfection(s, dt); // labels its own sources per pathogen
    setEffectSource('anaphylaxis');
    stepAirway(s, dt);
    setEffectSource('body');

    // 1. Pharmacodynamics reads last tick's free concentrations.
    this.drugConc.clear();
    for (const d of s.drugs) this.drugConc.set(d.drugId, d.freeNM);
    setEffectSource('receptors');
    stepPd(s, dt, RECEPTORS, this.links, this.drugConc);
    applyPulsePd(s, this.pulsePlans, s.drugs);
    setEffectSource('body');
    this.applyDirectEffects();
    this.applyHormoneAnalogues();

    // 1b. Signs the bus now carries a consumer for: pupils, tone, nausea, seizures.
    setEffectSource('seizure');
    stepMind(s, dt);
    setEffectSource('body');

    // 1c. The heart's own oxygen supply, BEFORE the circulation that reads it. This is
    //     the link that lets the lungs kill the heart: hypoxaemia and acidaemia weaken
    //     the pump and, if profound, degenerate the rhythm to PEA and asystole.
    stepMyocardium(s, dt, this.rng);

    // 2. Reflex, then circulation. The reflex must run first so the circulation
    //    sees this tick's tone, not last tick's.
    setEffectSource('baroreflex');
    stepBaroreflex(s, dt);
    setEffectSource('body');
    stepCardio(s, dt, this.rng);

    // 3. Waveforms at 500 Hz, tapped to the 250 Hz ring every second sub-step.
    this.stepWaveforms(dt);

    // 4. Gas exchange, filtration, digestion.
    stepRespiratory(s, dt);
    stepRenal(s, dt);
    stepFluids(s, dt);
    const absorbed = stepGi(s, dt);

    // 5. Pharmacokinetics, fed by whatever the gut just handed over.
    //
    // A drug that arrives ONLY through the gut has no compartment yet, because
    // `getOrCreatePkState` is called by `administer` and nothing else. The loop below
    // iterates `s.drugs`, so without this the absorbed mass was silently dropped and
    // the drug never appeared in plasma at all — which is exactly what happened to the
    // ethanol in a glass of wine and the caffeine in a cup of coffee.
    for (const drugId in absorbed.drugs) {
      if (absorbed.drugs[drugId] > 0) getOrCreatePkState(s, drugId);
    }

    for (const st of s.drugs) {
      const drug = DRUG_BY_ID.get(st.drugId);
      if (!drug) continue;
      // Payloads first: a fluid or electrolyte never enters the compartment model, and
      // `stepPk` returns before it could deliver one anyway.
      stepPayload(s, drug, st, dt);
      stepPk(s, st, drug, dt, absorbed.drugs[st.drugId] ?? 0);
    }

    // 6. Metabolism, brain, procedures.
    // AFTER metabolic, BEFORE neuro. The endocrine drivers read glucose and blood
    // pressure, so they must see this tick's values rather than last tick's; and the
    // effects they add have to be on the bus before the systems that consume them run.
    stepMetabolic(s, dt);
    // Acid-base after metabolic (which sets lactate) and respiratory (which set PaCO2):
    // pH is Henderson-Hasselbalch on those two, and it stops being a frozen constant.
    stepAcidBase(s, dt);
    stepEndocrine(s, dt); // labels its own sources per hormone
    setEffectSource('body');
    stepNeuro(s, dt);
    stepCoagulation(s, dt);
    stepProcedures(s, dt, this.rng);
    stepArrestProgression(s, dt);

    rebalanceElectrolytes(s, volumeBefore);

    s.t += dt;
    s.tick += 1;
    this.lastTickCost = nowMs() - t0;
  }

  /**
   * Drug effects that do not go through a receptor: channel block (amiodarone),
   * osmotic load, direct electrolyte action. They are scaled by plasma
   * concentration relative to the drug's own reference concentration.
   */
  /**
   * DIRECT EFFECTS, SCALED TO THE DRUG'S OWN REFERENCE DOSE.
   *
   * This was `gain * cp` on the raw plasma concentration in mg/L, which quietly made
   * the gain mean something different for every drug in the set. `effects.ts` documents
   * a modifier as a fraction - "+0.5 is a 50% increase" - and whether `gain * cp` landed
   * anywhere near that range depended entirely on where the drug's therapeutic
   * concentration happened to sit.
   *
   * It broke in both directions at once, which is why it survived so long:
   *
   *   - ONE STANDARD DRINK produced a circulatory collapse. Ethanol is dosed in grams,
   *     so cp reaches ~138 mg/L, and `-0.4 * 138` put -55 on a bus whose documented
   *     range is about +-1. Mean pressure 94 -> 43 mmHg, tidal volume 519 -> 63 mL.
   *   - The ACLS AMIODARONE LOADING DOSE stopped the heart outright, same arithmetic.
   *   - OXYCODONE AND LORAZEPAM DID NOTHING AT ALL, for exactly the opposite reason:
   *     their therapeutic concentrations sit near 0.02 mg/L, so `-0.55 * 0.025` is two
   *     orders of magnitude too small to register. Verapamil and digoxin were inert the
   *     same way, because their volumes of distribution are large.
   *
   * The fix is to divide by the concentration the drug's OWN declared reference dose
   * produces, so a gain of -0.4 means "a reference dose depresses this by 40%" for every
   * drug equally. That is what the interface has always claimed the gains mean: "the
   * absolute scale was fitted so that a reference dose produces a textbook-sized
   * response". Nothing here is invented - the reference is the drug's first mass-unit
   * preset over its cited V1, which is the same derivation `derive/transport.ts` already
   * uses for the vascular markers.
   *
   * SATURATING, NOT LINEAR. Ten times the dose is not ten times the effect, and a
   * linear ramp is precisely what let amiodarone drive heart rate through zero. Same
   * hyperbola as the chemoreflex: the slope near a reference dose is unchanged, and it
   * bends toward a ceiling instead of running away.
   */
  private applyDirectEffects(): void {
    const s = this.state;
    for (const st of s.drugs) {
      const drug = DRUG_BY_ID.get(st.drugId);
      if (!drug || drug.directEffects.length === 0) continue;
      if (st.cp <= 0) continue;

      const referenceCp = this.directRefCp.get(st.drugId) ?? 0;
      // No mass-unit preset or no sourced V1 means no reference exists. Fall back to the
      // raw concentration rather than silently dropping the drug's only mechanism, and
      // let the ceiling below keep it inside the bus's documented range.
      const multiple = referenceCp > 0 ? st.cp / referenceCp : st.cp;
      const scaled = (DIRECT_EFFECT_CEILING * multiple) / (DIRECT_EFFECT_CEILING + multiple);

      setEffectSource(`drug:${drug.id}`);
      for (const e of drug.directEffects) {
        addEffect(s.effects, e.target, e.gain * scaled);
      }
      setEffectSource('body');
    }
  }

  /**
   * A DRUG THAT IS A HORMONE adds to that hormone's pool. Insulin lands in the Bergman
   * model's plasma insulin; every other hormone lands in `s.endocrine.exogenous`, which
   * stepEndocrine reads alongside the secreted level. The amount is the drug's plasma
   * concentration (mg/L) times the cited unit conversion, so the drug's own
   * pharmacokinetics govern the rise and fall and the pool is not integrated twice.
   */
  private applyHormoneAnalogues(): void {
    const s = this.state;
    for (const k in s.endocrine.exogenous) s.endocrine.exogenous[k] = 0;
    let exogenousInsulin = 0;
    for (const st of s.drugs) {
      if (st.cp <= 0) continue;
      const drug = DRUG_BY_ID.get(st.drugId);
      const ha = drug?.hormoneAnalogue;
      if (!ha) continue;
      const units = st.cp * ha.unitsPerMgPerL;
      if (ha.pool === 'insulin') exogenousInsulin += units;
      else s.endocrine.exogenous[ha.pool] = (s.endocrine.exogenous[ha.pool] ?? 0) + units;
    }
    // Injected insulin joins plasma insulin, so it suppresses hepatic glucose output and
    // drives uptake through the same Bergman terms the pancreas's own insulin uses. It
    // is ADDED as a floor rather than integrated, because the drug PK already decays it.
    s.metabolic.exogenousInsulin_uU_per_mL = exogenousInsulin;
  }

  private stepWaveforms(dt: number): void {
    const s = this.state;
    const h = dt / ECG_SUBSTEPS;
    for (let i = 0; i < ECG_SUBSTEPS; i++) {
      const ecg = stepEcg(s, h, this.rng);
      const eeg = stepEeg(s, h, this.rng);
      s.ecg.emitCounter += 1;
      if (s.ecg.emitCounter % 2 === 0) {
        // Sub-step index into the cardio trace. Both loops use the same 2 ms grid.
        const abp = SUBSTEP_AORTIC_P[Math.min(i, CARDIO_SUBSTEPS - 1)];
        const resp = (s.resp.lungVolume - P('resp.frc_mL')) / Math.max(1, s.resp.tidalVolume);
        this.pending.push([ecg, eeg, abp, resp]);
      }
    }
  }

  /* -------------------------------------------------------------- intents */

  applyIntent(intent: SimIntent): void {
    const s = this.state;
    switch (intent.type) {
      case 'START':
        s.running = true;
        break;
      case 'PAUSE':
        s.running = false;
        break;
      case 'RESET':
        this.reset(intent.seed ?? s.seed);
        break;
      case 'SET_TIME_SCALE':
        // A non-finite scale used to become NaN, poison the worker's accumulator, and
        // freeze the whole simulation silently. Collapse it to real-time instead.
        s.timeScale = Number.isFinite(intent.x) ? Math.max(1, Math.min(P('sim.maxTimeScale'), intent.x)) : 1;
        break;
      case 'ADMINISTER': {
        const drug = DRUG_BY_ID.get(intent.drugId);
        if (!drug) return;
        const preset = drug.presetDoses.find(
          (p) => p.route === intent.route && p.amount === intent.dose && p.unit === intent.unit,
        );
        // THE ANCHOR IS STILL MANDATORY. An amount that is not a declared preset for
        // this drug and this route is rejected outright, exactly as before — there is
        // no path by which an arbitrary absolute dose reaches the engine.
        //
        // What is new is that the anchor can be SCALED. The intent says "this cited
        // dose, times x", so every dose the model integrates remains traceable to a
        // published figure, and the interface can never express one that is not.
        if (!preset) return;

        const multiplier = clampDoseMultiplier(intent.multiplier ?? 1);
        const duration = intent.durationMin !== undefined
          ? clampDoseDuration(intent.durationMin)
          : preset.durationMin;

        const result = administer(s, drug, intent.route, toMilligrams(preset.amount * multiplier, preset.unit), duration);
        // A refused dose used to vanish silently, which looked exactly like a broken
        // drug (CLAUDE.md's own trap). Now the reason reaches the interface.
        if (!result.ok) this.notice('warn', `${drug.displayName}: ${result.reason ?? 'dose refused'}`);
        break;
      }
      case 'STOP_INFUSION':
        stopInfusion(s, intent.drugId);
        break;
      case 'EAT': {
        const food = FOODS.find((f) => f.id === intent.foodId);
        if (!food) return;
        const n = Math.max(1, Math.min(6, Math.round(intent.portions)));

        // ALCOHOL AND CAFFEINE ARE DRUGS, NOT MACRONUTRIENTS.
        //
        // A drink is simply the route by which a body receives them, so they are handed
        // to the same pharmacokinetics any other oral dose uses rather than being given
        // a second, parallel model. That is what makes two glasses of wine interact with
        // a benzodiazepine: both reach the sedation target by the same effect bus, and
        // the ethanol arrives with the zero-order elimination its own drug entry
        // declares.
        //
        // THEY RIDE ON THE FOOD'S OWN PARCEL, which is both simpler and more correct —
        // the ethanol is dissolved in the beer. An earlier version gave them a parcel of
        // their own at 1 mL, which is below the volume gastric emptying releases at, so
        // they sat in the stomach indefinitely and no drink ever produced any plasma
        // ethanol at all.
        const payload: Record<string, number> = {};
        if (food.alcohol_g) payload.ethanol = food.alcohol_g * n * 1000;
        if (food.caffeine_mg) payload.caffeine = food.caffeine_mg * n;

        swallow(s, {
          volume_mL: food.volume_mL * n,
          carb_g: food.carb_g * n,
          fat_g: food.fat_g * n,
          protein_g: food.protein_g * n,
          solidFraction: food.solidFraction,
          label: food.displayName,
          // Optional in the data. A food that declares neither behaves exactly as it
          // did before these fields existed, which is what keeps them additive.
          ...(food.glycaemicIndex === undefined ? {} : { glycaemicIndex: food.glycaemicIndex }),
          ...(food.fibre_g === undefined ? {} : { fibre_g: food.fibre_g * n }),
          ...(Object.keys(payload).length > 0 ? { drugPayload: payload } : {}),
        });
        break;
      }
      case 'CPR_COMPRESSION':
        compress(s);
        break;
      case 'SET_CPR_AUTO':
        s.procedures.cprAuto = intent.on;
        if (intent.on) compress(s);
        break;
      case 'PLACE_PADS':
        s.procedures.padsPlaced = true;
        break;
      case 'CHARGE_DEFIB':
        chargeDefib(s, intent.joules);
        break;
      case 'DEFIBRILLATE':
        this.lastShock = defibrillate(s, this.rng);
        break;
      case 'INTUBATE':
        s.resp.intubated = intent.on;
        break;
      case 'IV_ACCESS':
        s.procedures.ivAccess = intent.on;
        break;
      case 'HAEMORRHAGE':
        addVolume(s.cardio, -Math.abs(intent.volume_mL));
        break;
      /* ------------------------------ behaviour, affect, pathology, infection */
      //
      // These set a TARGET or a RATE; they never write a physiological value directly.
      // `SET_EXERTION` says what the person is attempting, not what their heart rate
      // becomes - the subsystems in `src/sim/systems/` decide that, on their own time
      // constants, through the effect bus. An intent that set heart rate would be a
      // cheat code, not a simulation.
      case 'SET_EXERTION':
        s.activity.exertionTarget = clamp01(intent.level);
        break;
      case 'SET_SLEEP':
        s.activity.boutT = 0;
        // The intent is the decision to sleep; `sleepDepth` follows on its own.
        s.activity.exertionTarget = intent.asleep ? 0 : s.activity.exertionTarget;
        s.activity.sleepDepth = intent.asleep ? Math.max(1e-3, s.activity.sleepDepth) : 0;
        break;
      case 'FRIGHTEN':
        s.affect.fright = Math.max(s.affect.fright, clamp01(intent.intensity));
        break;
      case 'SET_AFFECT':
        if (intent.stress !== undefined) s.affect.stress = clamp01(intent.stress);
        if (intent.depression !== undefined) s.affect.depression = clamp01(intent.depression);
        break;
      case 'SET_PAIN':
        s.pathology.nociception = clamp01(intent.level);
        break;
      case 'SET_BLEED':
        s.pathology.bleedRate_mL_per_min = Math.max(0, intent.rate_mL_per_min);
        break;
      case 'SET_VERTIGO':
        s.pathology.vertigo = clamp01(intent.level);
        break;
      case 'INOCULATE': {
        if (!PATHOGEN_BY_ID.has(intent.pathogenId)) return;
        const existing = s.infection.active.find((x) => x.pathogenId === intent.pathogenId && !x.cleared);
        if (existing) {
          // A second exposure adds to the burden rather than restarting the clock.
          existing.burden = Math.min(1.2, existing.burden + 0.1);
        } else {
          s.infection.active.push(newBurden(intent.pathogenId, intent.dose_log10 ?? 0));
        }
        break;
      }
      case 'CLEAR_INFECTION':
        s.infection.active = intent.pathogenId
          ? s.infection.active.filter((x) => x.pathogenId !== intent.pathogenId)
          : [];
        break;

      case 'FORCE_RHYTHM':
        s.cardio.rhythm = intent.rhythm;
        s.cardio.cycleT = 0;
        if (intent.rhythm === 'vfib') {
          s.cardio.fibAmplitude = 1;
          s.procedures.arrestStartT = s.t;
        }
        break;
      case 'SET_BODY': {
        // Every field is clamped to a physiological range, because a negative or zero
        // mass or height makes the DuBois BSA NaN and poisons cardiac index and every
        // per-BSA readout downstream, silently and forever.
        const finite = (x: number | undefined): x is number => typeof x === 'number' && Number.isFinite(x);
        if (finite(intent.mass_kg)) s.body.mass_kg = Math.max(2, Math.min(300, intent.mass_kg));
        if (finite(intent.height_m)) s.body.height_m = Math.max(0.3, Math.min(2.5, intent.height_m));
        if (finite(intent.age_y)) s.body.age_y = Math.max(0, Math.min(120, intent.age_y));
        if (intent.sex) s.body.sex = intent.sex;
        s.body.bsa_m2 = 0.007184 * Math.pow(s.body.height_m * 100, 0.725) * Math.pow(s.body.mass_kg, 0.425);
        break;
      }

      /* --------------------------------------------------------- environment */
      case 'SET_ENVIRONMENT': {
        const env = s.environment;
        if (intent.ambientTemp_C !== undefined) env.ambientTemp_C = Math.max(-40, Math.min(60, intent.ambientTemp_C));
        if (intent.altitude_m !== undefined) env.altitude_m = Math.max(-400, Math.min(9000, intent.altitude_m));
        if (intent.fio2 !== undefined) env.fio2 = Math.max(0.1, Math.min(1, intent.fio2));
        break;
      }
      case 'SET_POSTURE':
        s.environment.posture = intent.posture;
        break;
      case 'DRINK_WATER':
        swallow(s, {
          volume_mL: Math.max(0, Math.min(3000, intent.volume_mL)),
          carb_g: 0,
          fat_g: 0,
          protein_g: 0,
          solidFraction: 0,
          label: 'Water',
        });
        break;
      case 'VOID_BLADDER':
        voidBladder(s);
        break;
      case 'SET_BRONCHOSPASM':
        s.airway.asthma = clamp01(intent.level);
        break;
      case 'ALLERGEN_EXPOSURE':
        // A mast-cell discharge: sets the release that airway.ts then plays out over
        // minutes. Adds to any release already running rather than restarting it.
        s.airway.releaseRemaining = Math.min(1, s.airway.releaseRemaining + clamp01(intent.severity));
        break;
      case 'STOP_ALL_BLEEDING':
        s.pathology.bleedRate_mL_per_min = 0;
        s.pathology.bloodLost_mL = 0;
        break;
    }
  }

  /* ------------------------------------------------------------- snapshot */

  snapshot(): SimSnapshot {
    const s = this.state;
    this.seq += 1;
    this.conditionCache = deriveConditions(s);

    const meanRr = s.cardio.rrHistory.reduce((a, b) => a + b, 0) / s.cardio.rrHistory.length;
    const displayHr = s.cardio.hr <= 0 ? 0 : 60 / meanRr;

    const digesta: GiDigestaSnapshot[] = s.gi.digesta.map((d) => ({
      id: d.id,
      segment: SEGMENTS[d.segmentIndex],
      s: d.s,
      volume_mL: d.volume,
      solidFraction: d.solidFraction,
      label: d.label,
    }));

    const gastric = gastricVolume(s);

    return {
      seq: this.seq,
      t: s.t,
      wallClock_ms: nowMs(),
      timeScale: s.timeScale,
      running: s.running,
      seed: s.seed,
      tickCost_ms: this.lastTickCost,
      cardio: {
        rhythm: s.cardio.rhythm,
        heartRate_bpm: s.cardio.hr,
        heartRateDisplay_bpm: displayHr,
        systolic_mmHg: s.cardio.sbp,
        diastolic_mmHg: s.cardio.dbp,
        map_mmHg: s.cardio.map,
        strokeVolume_mL: s.cardio.beatSv,
        cardiacOutput_L_per_min: s.cardio.co,
        cardiacIndex: s.cardio.co / s.body.bsa_m2,
        ejectionFraction: s.cardio.ef,
        edv_mL: s.cardio.beatEdv,
        esv_mL: s.cardio.beatEsv,
        lvVolume_mL: s.cardio.lv.V,
        rvVolume_mL: s.cardio.rv.V,
        laVolume_mL: s.cardio.la.V,
        raVolume_mL: s.cardio.ra.V,
        cyclePhase: Math.min(1, s.cardio.cycleT / Math.max(1e-6, s.cardio.rr)),
        activation: s.cardio.activation,
        contractilityScale: s.cardio.contractilityScale,
        svrScale: s.cardio.svrScale,
        centralVenousPressure_mmHg: s.cardio.ra.P,
        coronaryPerfusionPressure_mmHg: s.cardio.cpp,
        bloodVolume_mL: s.cardio.bloodVolume,
      },
      resp: {
        rate_per_min: s.resp.rate,
        tidalVolume_mL: s.resp.tidalVolume,
        minuteVentilation_L_per_min: (s.resp.rate * s.resp.tidalVolume) / 1000,
        inflation: (s.resp.lungVolume - P('resp.frc_mL')) / Math.max(1, P('resp.tidalVolume_mL')),
        spo2: s.resp.spo2,
        pao2_mmHg: s.resp.arterialPo2,
        paco2_mmHg: s.resp.arterialPco2,
        etco2_mmHg: s.resp.etco2,
        cyclePhase: s.resp.cycleT / s.resp.period,
        apnoeic: s.resp.apnoeic,
        intubated: s.resp.intubated,
      },
      renal: {
        gfr_mL_per_min: s.renal.gfr,
        renalBloodFlow_mL_per_min: s.renal.rbf,
        urineOutput_mL_per_min: s.renal.urineRate,
        bladderVolume_mL: s.renal.bladderVolume,
        bladderFillFraction: s.renal.bladderVolume / P('renal.bladderCapacity_mL'),
        autoregulationFactor: s.renal.autoreg,
        creatinine_mg_per_dL: s.renal.creatinine,
      },
      gi: {
        gastricVolume_mL: gastric,
        gastricFillFraction: Math.min(1, gastric / 1000),
        gastricPh: gastricPh(s),
        glucoseAbsorption_mg_per_min: s.gi.glucoseAbsorptionRate,
        digesta,
        peristalsisPhase: s.gi.peristalsisPhase,
      },
      metabolic: {
        glucose_mg_per_dL: s.metabolic.G,
        insulin_uU_per_mL: s.metabolic.I,
        remoteInsulinAction: s.metabolic.X,
        glucagonDrive: s.metabolic.glucagonDrive,
        coreTemp_C: s.metabolic.coreTemp,
      },
      endocrine: {
        hormones: HORMONES.map((def) => {
          const h = s.endocrine.hormones[def.id];
          return {
            id: def.id,
            label: def.label,
            level: (h?.level ?? def.baseline) + (s.endocrine.exogenous[def.id] ?? 0),
            unit: def.unit,
            activity: h?.activity ?? 0,
            refLow: def.refLow,
            refHigh: def.refHigh,
            gland: def.gland,
          };
        }),
        stressAxis: s.endocrine.stressAxis,
        clockHour: s.endocrine.clockHour,
      },
      transport: buildTransport(s, DRUG_BY_ID),
      neuro: {
        cerebralBloodFlow_mL_per_min: s.neuro.cbf,
        consciousness: s.neuro.consciousness,
        eegBand: dominantBand(s),
        sedationLevel: s.neuro.sedation,
      },
      chem: {
        na_mEq_per_L: s.chem.na,
        k_mEq_per_L: s.chem.k,
        caIonised_mmol_per_L: s.chem.ca,
        cl_mEq_per_L: s.chem.cl,
        hco3_mEq_per_L: s.chem.hco3,
        ph: s.chem.ph,
        lactate_mmol_per_L: s.chem.lactate,
        haematocrit: s.chem.hct,
        albumin_g_per_dL: s.chem.albumin,
      },
      drugs: s.drugs.map((d) => {
        const drug = DRUG_BY_ID.get(d.drugId);
        return {
          drugId: d.drugId,
          displayName: drug?.displayName ?? d.drugId,
          plasma_ng_per_mL: d.cp * 1000,
          free_nM: d.freeNM,
          a1_mg: d.a1,
          a2_mg: d.a2,
          a3_mg: d.a3,
          gut_mg: gutAmountOf(s, d.drugId),
          depot_mg: d.depots.reduce((n, x) => n + x.amount, 0),
          // Named so the UI can say WHICH depot is still releasing. A patch and an
          // injection are both "depot_mg" and the difference is the whole story.
          depots: d.depots.map((x) => ({
            route: x.route,
            amount_mg: x.amount,
            releasing: x.lagRemaining <= 0,
            lagRemaining_min: x.lagRemaining,
          })),
          nebulising: d.pulmonaryRemaining > 0,
          infusionRate_mg_per_min: d.infusionRate,
          cumulativeDose_mg: d.cumulativeDose,
        };
      }),
      receptors: s.receptors.map((r) => {
        const def = RECEPTOR_BY_ID.get(r.receptorId);
        let dominant: string | null = null;
        let best = 0;
        for (const k in r.byLigand) {
          if (r.byLigand[k] > best) {
            best = r.byLigand[k];
            dominant = k;
          }
        }
        return {
          receptorId: r.receptorId,
          label: def?.label ?? r.receptorId,
          group: def?.group ?? 'other',
          occupancy: r.total,
          activation: r.activation,
          dominantLigand: best > 0.001 ? dominant : null,
        };
      }),
      conditions: this.conditionCache.map((c) => ({ ...c })),
      behaviour: {
        exertion: s.activity.exertion,
        exertionTarget: s.activity.exertionTarget,
        sleepDepth: s.activity.sleepDepth,
        oxygenDebt_L: s.activity.oxygenDebt_L,
        fright: s.affect.fright,
        stress: s.affect.stress,
        depression: s.affect.depression,
      },
      pathology: {
        nociception: s.pathology.nociception,
        pain: s.pathology.pain,
        inflammation: s.pathology.inflammation,
        bleedRate_mL_per_min: s.pathology.bleedRate_mL_per_min,
        bloodLost_mL: s.pathology.bloodLost_mL,
        vertigo: s.pathology.vertigo,
      },
      procedures: {
        cprActive: s.procedures.cprActive,
        cprRate_per_min: cprRate(s),
        cprQuality: cprQuality(s),
        lastCompressionAgo_s: s.t - s.procedures.lastCompressionT,
        defibCharge_J: s.procedures.defibCharge,
        defibCharged: s.procedures.defibCharged,
        padsPlaced: s.procedures.padsPlaced,
        shocksDelivered: s.procedures.shocksDelivered,
        downtime_s: s.procedures.arrestStartT === null ? 0 : s.t - s.procedures.arrestStartT,
        ivAccess: s.procedures.ivAccess,
      },
      environment: {
        ambientTemp_C: s.environment.ambientTemp_C,
        altitude_m: s.environment.altitude_m,
        barometric_mmHg: barometricPressure(s.environment.altitude_m),
        fio2: s.environment.fio2,
        inspiredPo2_mmHg: inspiredPo2(s),
        posture: s.environment.posture,
      },
      acidBase: {
        ph: s.chem.ph,
        hco3_mEq_per_L: s.chem.hco3,
        paco2_mmHg: s.resp.arterialPco2,
        baseExcess_mEq_per_L: baseExcess(s.chem.hco3, s.chem.ph),
        anionGap_mEq_per_L: anionGap(s),
        ketones_mmol_per_L: s.acidBase.ketones,
        interpretation: interpretAcidBase(s.chem.ph, s.resp.arterialPco2, s.chem.hco3),
      },
      mind: {
        pupil_mm: s.mind.pupil_mm,
        anxiety: clamp01(effectValue(s, 'neuro.anxiety')),
        euphoria: clamp01(effectValue(s, 'neuro.euphoria')),
        psychedelia: clamp01(effectValue(s, 'neuro.psychedelia')),
        dependence: clamp01(effectValue(s, 'neuro.dependence')),
        nausea: s.mind.nausea,
        appetite: clamp01(1 + effectValue(s, 'gi.appetite')),
        muscleTone: s.mind.muscleTone,
        seizureMargin: Math.max(0, Math.min(1, seizureMargin(s))),
        seizing: s.mind.seizing,
        vomiting: s.mind.vomiting,
        vomitus_mL: s.mind.vomitus_mL,
      },
      coagulation: {
        inr: inr(s),
        aptt_s: aptt(s),
        plateletFunction: s.coagulation.plateletFunction,
        platelets_10e9_per_L: s.coagulation.platelets,
        haemostasis: s.coagulation.haemostasis,
      },
      infection: {
        active: s.infection.active.map((b) => {
          const def = PATHOGEN_BY_ID.get(b.pathogenId);
          return {
            pathogenId: b.pathogenId,
            label: def?.label ?? b.pathogenId,
            kind: (def?.kind ?? 'toxin') as 'virus' | 'bacterium' | 'parasite' | 'toxin',
            site: def?.site ?? '',
            burden: b.burden,
            load_log10: b.load_log10,
            t_h: b.t / 3600,
            phase: (b.cleared
              ? 'cleared'
              : !b.symptomatic
                ? 'incubating'
                : b.sincePeak > 0
                  ? 'resolving'
                  : 'symptomatic') as 'incubating' | 'symptomatic' | 'resolving' | 'cleared',
            drugKill_per_h: b.drugKill_per_h,
          };
        }),
        immuneActivation: s.infection.immuneActivation,
        wbc_10e9_per_L: s.infection.wbc,
        crp_mg_per_L: s.infection.crp,
        cd4_per_uL: s.infection.cd4_per_uL,
        sepsis: isSepsis(s),
      },
      fluids: {
        interstitial_mL: s.fluids.interstitial,
        balance_mL: s.fluids.balance_mL,
        osmolality_mOsm_per_kg: 2 * s.chem.na + s.metabolic.G / 18 + 5,
        extraLosses_mL_per_min: s.fluidLossRate_mL_per_min,
        bronchoconstriction: s.resp.bronchoconstriction,
      },
      effects: activeEffects(s),
      effectSources: buildEffectSources(s),
      notices: this.notices.map((n) => ({ ...n })),
    };
  }
}

/** A bus target's current value (0 when absent). */
function effectValue(s: SimState, target: string): number {
  return s.effects[target] ?? 0;
}

/** Every non-zero bus target, for the impact panel. */
function activeEffects(s: SimState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k in s.effects) {
    const v = s.effects[k];
    if (Math.abs(v) > 1e-4) out[k] = v;
  }
  return out;
}

/** The bus broken down by who is pushing each target, above a small threshold. */
function buildEffectSources(s: SimState): Record<string, Record<string, number>> {
  const rows = effectBreakdown(s.effects);
  if (!rows) return {};
  const out: Record<string, Record<string, number>> = {};
  for (const target in rows) {
    const row = rows[target];
    let kept: Record<string, number> | null = null;
    for (const src in row) {
      const v = row[src];
      if (Math.abs(v) > 1e-3) (kept ?? (kept = {}))[src] = v;
    }
    if (kept) out[target] = kept;
  }
  return out;
}

function gutAmountOf(s: SimState, drugId: string): number {
  let total = 0;
  for (const d of s.gi.digesta) total += d.drugPayload[drugId] ?? 0;
  return total;
}

/** Preset units to milligrams. The only unit conversion the intent path performs. */
/**
 * Clamped in the worker so the bound is real. A non-finite multiplier collapses to
 * the reference dose rather than to NaN, because a NaN reaching the PK integrator
 * poisons every downstream compartment silently and forever.
 */
export function clampDoseMultiplier(x: number): number {
  if (!Number.isFinite(x)) return 1;
  return Math.max(MIN_DOSE_MULTIPLIER, Math.min(MAX_DOSE_MULTIPLIER, x));
}

export function clampDoseDuration(x: number): number {
  if (!Number.isFinite(x)) return MIN_DOSE_DURATION_MIN;
  return Math.max(MIN_DOSE_DURATION_MIN, Math.min(MAX_DOSE_DURATION_MIN, x));
}

// Re-exported so existing callers and tests keep their import path. The conversion
// itself lives in pharma/units.ts, shared with the transport deriver.
export { toMilligrams };

function deriveConditionsEmpty(): ReturnType<typeof deriveConditions> {
  return [];
}

/** performance.now() where available, a monotonic fallback otherwise. */
function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

export { WAVEFORM_CHANNELS, DRUGS, RECEPTORS, FOODS, getOrCreatePkState, STOMACH_INDEX };
