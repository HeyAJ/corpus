import type { SimState } from '../core/state';
import type { AnatomySnapshot } from '../../bridge/types';
import { P } from '../core/constants';
import { ANATOMY, atlasOf } from '../../data/anatomy';
import { ANATOMY_SIGNALS, type AnatomySignal } from '../../data/anatomy-types';
import organsFile from '../../data/organs.json';
import { HORMONE_BY_ID } from '../systems/endocrine';
import { SEGMENTS, gastricVolume } from '../systems/gi';
import { reproductiveSignals } from '../systems/reproductive';

/**
 * ANATOMY ACTIVITY: what each structure of each organ is doing, as a number from 0 to 1.
 *
 * The anatomy view lets a person open an organ and see what it is made of. This file is
 * what makes those parts move. Every signal the atlas may name (the closed list in
 * src/data/anatomy-types.ts) is evaluated here ONCE per snapshot from the state vector,
 * and each part's activity is then `clamp01(rest + sum(weight * signal))` over the drives
 * its atlas file declares. Nothing here is written back: delete this file and the
 * simulation is bit-for-bit unchanged, which is what makes it safe for the renderer and
 * the panel to depend on. It reads the effect bus (`s.effects`) only as the record of
 * what was pushed during the last tick.
 *
 * THE THRESHOLDS ARE DISPLAY ANCHORS, NOT PHYSIOLOGICAL CONSTANTS. Each signal is shaped
 * so that it is 0 in a resting adult and approaches 1 in an extreme state: "hypercapnia"
 * is (PaCO2 - 42) / 25, "fever" is (T - 37.5) / 3, and so on. Those numbers say where a
 * bar should start to move and where it should be full. They are not diagnostic cut-offs,
 * nothing else in the engine reads them, and they are deliberately not in physiology.json,
 * because that file holds numbers the simulation computes with. Where a signal does have a
 * physiological anchor (the resting pupil, the resting minute ventilation, the resting
 * GFR) it reads the engine's own constant, so the display and the model cannot disagree
 * about what "rest" is.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. Activity is an index of how hard the model's own
 * drives are pushing a structure. It is not a firing rate, a BOLD signal, a blood flow or
 * a metabolic rate, and the drive weights in the atlas are display scales. The gland
 * multipliers below are display scales too: "1" means basal, and a gland at "3" is drawn
 * three times as bright as at rest, not secreting three times the hormone.
 *
 * COST. The signals are written into one reused record and the gut is scanned once, so a
 * call allocates only the returned snapshot. The part list is built once, lazily, from the
 * atlas files, so a file that is still empty simply contributes no parts.
 */

/* ------------------------------------------------------------------ helpers */

function clamp01(v: number): number {
  // NaN fails both comparisons and would otherwise reach the renderer as a colour of NaN.
  return v > 0 ? (v < 1 ? v : 1) : 0;
}

/** The effect bus as it stood at the end of the last tick; absent targets are 0. */
function eff(s: SimState, target: string): number {
  return s.effects[target] ?? 0;
}

/** Compile-time proof that the switch below names every signal. */
function unreachable(_name: never): number {
  return 0;
}

/**
 * The dark phase of the circadian clock: 1 from 23:00 to 05:00, 0 from 07:00 to 21:00,
 * with a half-cosine through the two hours either side so the pineal does not jump.
 */
function nightFactor(h: number): number {
  if (h >= 23 || h < 5) return 1;
  if (h >= 7 && h < 21) return 0;
  if (h >= 21) return 0.5 - 0.5 * Math.cos((Math.PI * (h - 21)) / 2);
  return 0.5 + 0.5 * Math.cos((Math.PI * (h - 5)) / 2);
}

/**
 * Hormone activity above the activity its own baseline produces, rescaled so that
 * "fully saturated" is 1. The baseline activity is the same Hill transform the endocrine
 * system applies, so a hormone sitting at baseline reads exactly 0 here as it does on the
 * effect bus. A hormone that is not seeded yet reads 0.
 */
const HORMONE_BASE_ACTIVITY = new Map<string, number>();
function hormoneAbove(s: SimState, id: string): number {
  let base = HORMONE_BASE_ACTIVITY.get(id);
  if (base === undefined) {
    const def = HORMONE_BY_ID.get(id);
    if (def) {
      const x = Math.pow(def.baseline, def.hill);
      base = x / (x + Math.pow(def.ec50, def.hill));
    } else {
      base = 0;
    }
    HORMONE_BASE_ACTIVITY.set(id, base);
  }
  const h = s.endocrine.hormones[id];
  if (!h) return 0;
  return clamp01((h.activity - base) / (1 - base));
}

/* ------------------------------------------------------------ the scratch space */

/**
 * Intermediate values that more than one signal needs, filled once per call. Kept as a
 * single reused object so that evaluating a hundred signals allocates nothing.
 */
interface Scratch {
  exertion: number;
  fright: number;
  stress: number;
  pain: number;
  sleep: number;
  digestion: number;
  sexualArousal: number;
  orgasm: number;
  swallowing: number;
  gastricFill: number;
  fatLoad: number;
  intestinalTransit: number;
  colonTransit: number;
  mv: number;
  mv0: number;
}

const C: Scratch = {
  exertion: 0, fright: 0, stress: 0, pain: 0, sleep: 0, digestion: 0, sexualArousal: 0, orgasm: 0,
  swallowing: 0, gastricFill: 0, fatLoad: 0, intestinalTransit: 0, colonTransit: 0, mv: 0, mv0: 1,
};

const SEG_OESOPHAGUS = SEGMENTS.indexOf('oesophagus');
const SEG_STOMACH = SEGMENTS.indexOf('stomach');
const SEG_DUODENUM = SEGMENTS.indexOf('duodenum');
const SEG_JEJUNUM = SEGMENTS.indexOf('jejunum');
const SEG_ILEUM = SEGMENTS.indexOf('ileum');
const SEG_CAECUM = SEGMENTS.indexOf('caecum');

/** One pass over the digesta: every gut signal comes from this, so the list is walked once. */
function scanGut(s: SimState): void {
  let oesophagus = 0;
  let upper = 0; // stomach + duodenum + jejunum volume
  let fat = 0; // stomach + duodenum fat
  let small = 0; // duodenum + jejunum + ileum volume
  let colon = 0; // caecum onward
  for (const d of s.gi.digesta) {
    const i = d.segmentIndex;
    if (i === SEG_OESOPHAGUS) oesophagus++;
    if (i === SEG_STOMACH || i === SEG_DUODENUM || i === SEG_JEJUNUM) upper += d.volume;
    if (i === SEG_STOMACH || i === SEG_DUODENUM) fat += d.fat_g;
    if (i >= SEG_DUODENUM && i <= SEG_ILEUM) small += d.volume;
    if (i >= SEG_CAECUM) colon += d.volume;
  }
  C.swallowing = oesophagus > 0 ? 1 : 0;
  C.gastricFill = clamp01(gastricVolume(s) / 1000);
  C.digestion = clamp01(upper / 400);
  C.fatLoad = clamp01(fat / 30);
  C.intestinalTransit = small > 0 ? clamp01(small / 300) : 0;
  C.colonTransit = colon > 0 ? clamp01(colon / 300) : 0;
}

/* -------------------------------------------------------------- the signals */

/** The signals, reused across calls: the record is overwritten, never reallocated. */
const SIGNALS = {} as Record<AnatomySignal, number>;
for (const name of ANATOMY_SIGNALS) SIGNALS[name] = 0;

/**
 * ONE exhaustive switch over the signal union. A signal added to the union and not here
 * fails to compile, through the `never` in the default branch. Each case is a pure read
 * of the state; the shared intermediates are in the scratch record.
 */
function signal(name: AnatomySignal, s: SimState, rep: ReturnType<typeof reproductiveSignals>): number {
  switch (name) {
    /* --- arousal and mind --- */
    case 'awake': return clamp01(1 - s.activity.sleepDepth);
    case 'sleep': return clamp01(s.activity.sleepDepth);
    case 'consciousness': return clamp01(s.neuro.consciousness);
    case 'unconscious': return clamp01(1 - s.neuro.consciousness);
    case 'sedation': return clamp01(s.neuro.sedation);
    case 'night': return nightFactor(s.endocrine.clockHour);
    case 'fright': return clamp01(s.affect.fright);
    case 'stress': return clamp01(s.affect.stress);
    case 'depression': return clamp01(s.affect.depression);
    case 'anxiety': return clamp01(eff(s, 'neuro.anxiety'));
    case 'euphoria': return clamp01(eff(s, 'neuro.euphoria'));
    case 'psychedelia': return clamp01(eff(s, 'neuro.psychedelia'));
    case 'reward': return clamp01(eff(s, 'neuro.dependence'));
    case 'pain': return clamp01(s.pathology.pain);
    case 'nociception': return clamp01(s.pathology.nociception);
    case 'analgesia': return clamp01(eff(s, 'neuro.analgesia'));
    case 'nausea': return clamp01(s.mind.nausea);
    case 'vomiting': return s.mind.vomiting ? 1 : 0;
    case 'vertigo': return clamp01(s.pathology.vertigo);
    case 'seizure': return s.mind.seizing ? 1 : 0;
    case 'rigidity': return clamp01(s.mind.muscleTone);
    case 'paralysis': return clamp01(-s.mind.muscleTone);
    case 'mydriasis': {
      const base = P('neuro.pupilBaseline_mm');
      return clamp01((s.mind.pupil_mm - base) / (P('neuro.pupilMax_mm') - base));
    }
    case 'miosis': {
      const base = P('neuro.pupilBaseline_mm');
      return clamp01((base - s.mind.pupil_mm) / (base - P('neuro.pupilMin_mm')));
    }
    /* --- movement --- */
    case 'exertion': return clamp01(C.exertion);
    case 'shivering': {
      // The set point moves with the bus exactly as the thermal system moves it (a fever
      // raises it, so a febrile body below its new set point shivers: the rigor).
      const sp = eff(s, 'thermal.setPoint');
      const setPoint = P('thermal.coreTemp_C') * (1 + (sp < -0.05 ? -0.05 : sp > 0.05 ? 0.05 : sp));
      return clamp01((setPoint - s.metabolic.coreTemp) / P('thermal.shiveringSpan_C'));
    }
    /* --- autonomic outflow --- */
    case 'sympathetic':
      return clamp01(Math.max(
        (s.reflex.symp - 0.5) * 2, C.fright, 0.8 * C.exertion, 0.6 * C.stress, 0.5 * C.pain,
        0.6 * C.sexualArousal, C.orgasm,
      ));
    case 'parasympathetic':
      return clamp01(Math.max((s.reflex.vagal - 0.5) * 2, 0.6 * C.sleep, 0.5 * C.digestion));
    case 'baroreflex': return clamp01(Math.abs(s.reflex.afferent - 0.5) * 2);
    /* --- heart and circulation --- */
    case 'beat': return clamp01(s.cardio.activation);
    case 'heartRate': {
      // The engine's settled resting rate is about 6 bpm under the intrinsic 72 of
      // physiology.json (vagal tone holds the sinus node down), so rest is derived from
      // that constant rather than typed in a second time here.
      const rest = P('cardio.heartRateBaseline_bpm') - 6;
      return clamp01((s.cardio.hr - rest) / (180 - rest));
    }
    case 'bradycardia': return s.cardio.hr > 0 ? clamp01((60 - s.cardio.hr) / 30) : 0;
    case 'inotropy': return clamp01(s.cardio.contractilityScale * (1 + eff(s, 'cardio.contractility')) - 1);
    case 'pumpFailure': return clamp01(1 - s.cardio.contractilityScale * (1 + eff(s, 'cardio.contractility')));
    case 'outputRise': return clamp01(s.cardio.co / 5 - 1);
    case 'outputFall': return clamp01(1 - s.cardio.co / 4.6);
    case 'hypertension': return clamp01((s.cardio.map - 105) / 45);
    case 'hypotension': return clamp01((75 - s.cardio.map) / 35);
    case 'arrest': {
      const r = s.cardio.rhythm;
      return r === 'vfib' || r === 'asystole' || r === 'pea' ? 1 : 0;
    }
    case 'fibrillation': {
      const r = s.cardio.rhythm;
      return r === 'vfib' || r === 'afib' ? 1 : 0;
    }
    case 'myocardialHypoxia': return clamp01(s.myocardium.hypoxia);
    case 'vasoconstriction': return clamp01(s.cardio.svrScale * (1 + eff(s, 'cardio.systemicResistance')) - 1);
    case 'vasodilation': return clamp01(1 - s.cardio.svrScale * (1 + eff(s, 'cardio.systemicResistance')));
    /* --- breathing and gas exchange --- */
    case 'inspiration': return clamp01((s.resp.lungVolume - P('resp.frc_mL')) / Math.max(1, s.resp.tidalVolume));
    case 'ventilation': return clamp01((C.mv / C.mv0 - 1) / 3);
    case 'hypoventilation': return clamp01(1 - C.mv / C.mv0);
    case 'respDrive': return clamp01((s.resp.drive / C.mv0 - 1) / 3);
    case 'apnoea': return s.resp.apnoeic ? 1 : 0;
    case 'hypoxia': return clamp01((0.95 - s.resp.spo2) / 0.25);
    case 'hypercapnia': return clamp01((s.resp.arterialPco2 - 42) / 25);
    case 'hypocapnia': return clamp01((34 - s.resp.arterialPco2) / 14);
    case 'bronchoconstriction': return clamp01(s.resp.bronchoconstriction);
    case 'shunt': return clamp01((s.resp.shuntFraction - 0.03) / 0.37);
    /* --- kidney, water and salt --- */
    case 'filtrationRise': return clamp01(s.renal.gfr / P('renal.gfr_mL_per_min') - 1);
    case 'filtrationFall': return clamp01(1 - s.renal.gfr / P('renal.gfr_mL_per_min'));
    case 'urineFlow': return clamp01((s.renal.urineRate - P('renal.urineOutput_mL_per_min')) / 5);
    case 'bladderFill': return clamp01(s.renal.bladderVolume / P('renal.bladderCapacity_mL'));
    case 'dehydration': {
      const osm = 2 * s.chem.na + s.metabolic.G / 18 + 5;
      const rest = 2 * P('blood.na_mEq_per_L') + P('blood.glucose_mg_per_dL') / 18 + 5;
      return clamp01((osm - rest) / 15);
    }
    case 'hypovolaemia': return clamp01((1 - s.cardio.bloodVolume / P('blood.totalVolume_mL')) / 0.3);
    case 'reninDrive': return clamp01((90 - s.cardio.map) / 50);
    case 'adh': return hormoneAbove(s, 'adh');
    case 'aldosterone': return hormoneAbove(s, 'aldosterone');
    /* --- gut and metabolism --- */
    case 'swallowing': return C.swallowing;
    case 'gastricFill': return C.gastricFill;
    case 'digestion': return C.digestion;
    case 'fatLoad': return C.fatLoad;
    case 'absorption': return clamp01(s.gi.glucoseAbsorptionRate / 400);
    case 'intestinalTransit': return C.intestinalTransit;
    case 'colonTransit': return C.colonTransit;
    case 'motilityRise': return clamp01(eff(s, 'gi.motility'));
    case 'motilityFall': return clamp01(-eff(s, 'gi.motility'));
    case 'hyperglycaemia': return clamp01((s.metabolic.G - 110) / 150);
    case 'hypoglycaemia': return clamp01((70 - s.metabolic.G) / 40);
    case 'insulin':
      return clamp01((s.metabolic.I + s.metabolic.exogenousInsulin_uU_per_mL - P('metabolic.insulinBasal_uU_per_mL')) / 60);
    case 'glucagon': return hormoneAbove(s, 'glucagon');
    case 'hepaticOutput': return clamp01(eff(s, 'metabolic.hepaticGlucoseOutput') + eff(s, 'metabolic.glycogenolysis'));
    case 'lactate': return clamp01((s.chem.lactate - 1) / 8);
    case 'ketosis': return clamp01(s.acidBase.ketones / 5);
    case 'fever': return clamp01((s.metabolic.coreTemp - 37.5) / 3);
    case 'hypothermia': return clamp01((36 - s.metabolic.coreTemp) / 4);
    case 'sweating': return clamp01(s.metabolic.sweatRate_mL_per_min / (P('thermal.maxSweatRate_mL_per_h') / 60));
    /* --- endocrine --- */
    case 'stressAxis': return clamp01(s.endocrine.stressAxis);
    case 'cortisol': return hormoneAbove(s, 'cortisol');
    case 'thyroid': return hormoneAbove(s, 'thyroxine');
    case 'epo': return hormoneAbove(s, 'epo');
    /* --- blood and immunity --- */
    case 'bleeding': return clamp01(s.pathology.bleedRate_mL_per_min / 100);
    case 'anaemia': return clamp01((P('blood.haematocrit') - s.chem.hct) / 0.25);
    case 'haemolysis': return clamp01(eff(s, 'blood.haemolysis_per_h') * 10);
    case 'inflammation': return clamp01(s.pathology.inflammation);
    case 'immune': return clamp01(s.infection.immuneActivation);
    case 'infection': {
      let burden = 0;
      for (const p of s.infection.active) {
        if (!p.cleared && p.burden > burden) burden = p.burden;
      }
      return clamp01(burden);
    }
    case 'histamine': return clamp01(s.airway.histamine);
    case 'clotting': return clamp01(s.coagulation.haemostasis);
    /* --- reproduction: straight from the reproductive system --- */
    case 'estradiol': return clamp01(rep.estradiol);
    case 'progesterone': return clamp01(rep.progesterone);
    case 'lh': return clamp01(rep.lh);
    case 'fsh': return clamp01(rep.fsh);
    case 'testosterone': return clamp01(rep.testosterone);
    case 'prolactin': return clamp01(rep.prolactin);
    case 'oxytocin': return clamp01(rep.oxytocin);
    case 'hcg': return clamp01(rep.hcg);
    case 'follicle': return clamp01(rep.follicle);
    case 'corpusLuteum': return clamp01(rep.corpusLuteum);
    case 'endometrium': return clamp01(rep.endometrium);
    case 'menstruating': return clamp01(rep.menstruating);
    case 'pregnancy': return clamp01(rep.pregnancy);
    case 'sexualArousal': return clamp01(rep.sexualArousal);
    case 'orgasm': return clamp01(rep.orgasm);
    case 'vasocongestion': return clamp01(rep.vasocongestion);
    default:
      return unreachable(name);
  }
}

/**
 * Every anatomy signal for this state. The returned record is SHARED and overwritten by the
 * next call (that is what keeps the per-snapshot cost allocation-free); copy it if you need
 * to keep it.
 */
export function anatomySignals(s: SimState): Readonly<Record<AnatomySignal, number>> {
  const rep = reproductiveSignals(s);
  C.exertion = clamp01(s.activity.exertion);
  C.fright = clamp01(s.affect.fright);
  C.stress = clamp01(s.affect.stress);
  C.pain = clamp01(s.pathology.pain);
  C.sleep = clamp01(s.activity.sleepDepth);
  C.sexualArousal = clamp01(rep.sexualArousal);
  C.orgasm = clamp01(rep.orgasm);
  C.mv = (s.resp.rate * s.resp.tidalVolume) / 1000;
  C.mv0 = (P('resp.rate_per_min') * P('resp.tidalVolume_mL')) / 1000;
  scanGut(s);
  for (const name of ANATOMY_SIGNALS) SIGNALS[name] = signal(name, s, rep);
  return SIGNALS;
}

/* -------------------------------------------------------------- the part plan */

interface PlanPart {
  key: string;
  rest: number;
  signals: AnatomySignal[];
  weights: number[];
}
interface PlanOrgan {
  id: string;
  sex: string | undefined;
  pregnancyOnly: boolean;
  parts: PlanPart[];
}

interface OrganRef {
  id: string;
  atlas?: string;
  sex?: string;
  pregnancyOnly?: boolean;
}

let plan: PlanOrgan[] | null = null;

/** Built once from organs.json and the atlas files; a missing or empty atlas gives no parts. */
function buildPlan(): PlanOrgan[] {
  const out: PlanOrgan[] = [];
  for (const o of organsFile.organs as unknown as OrganRef[]) {
    const file = ANATOMY[atlasOf(o)];
    const parts: PlanPart[] = [];
    for (const p of file ? file.parts : []) {
      parts.push({
        key: `${o.id}.${p.id}`,
        rest: p.rest,
        signals: p.drives.map((d) => d.signal),
        weights: p.drives.map((d) => d.weight),
      });
    }
    out.push({ id: o.id, sex: o.sex, pregnancyOnly: o.pregnancyOnly === true, parts });
  }
  return out;
}

/* ----------------------------------------------------------------- the build */

export function buildAnatomy(s: SimState): AnatomySnapshot {
  const sig = anatomySignals(s);
  if (plan === null) plan = buildPlan();
  const pregnant = sig.pregnancy > 0;

  const organs: Record<string, number> = {};
  const parts: Record<string, number> = {};
  for (const o of plan) {
    if (o.sex !== undefined && o.sex !== s.body.sex) continue;
    if (o.pregnancyOnly && !pregnant) continue;
    let lift = 0;
    for (const p of o.parts) {
      let a = p.rest;
      for (let i = 0; i < p.signals.length; i++) a += p.weights[i] * sig[p.signals[i]];
      a = clamp01(a);
      parts[p.key] = a;
      if (a - p.rest > lift) lift = a - p.rest;
    }
    organs[o.id] = clamp01(1.6 * lift);
  }

  // The gland multipliers are DISPLAY SCALES (1 = basal), not secretion rates: they say how
  // much brighter a gland is drawn, and no one should read "3" as three-fold the hormone.
  const gonadal = Math.max(sig.estradiol, sig.progesterone, sig.testosterone);
  const glands: Record<string, number> = {
    pituitary: Math.min(4, 1 + 2 * sig.stressAxis + sig.adh + sig.lh + sig.prolactin + sig.oxytocin),
    adrenal_cortex: 1 + 2 * sig.cortisol + sig.aldosterone,
    adrenal_medulla: 1 + 3 * sig.sympathetic,
    thyroid: 1 + sig.thyroid,
    pancreas_beta: 1 + 3 * sig.insulin,
    pancreas_alpha: 1 + 3 * sig.glucagon,
    pineal: 0.2 + 1.8 * sig.night,
    kidney: 1 + 2 * sig.epo + sig.reninDrive,
    gonads: 1 + gonadal,
    placenta: sig.hcg > 0 ? 1 + 2 * sig.hcg : 0,
  };

  return {
    organs,
    parts,
    nerves: {
      sympathetic: sig.sympathetic,
      parasympathetic: sig.parasympathetic,
      motor: clamp01(Math.max(sig.exertion, sig.shivering, sig.seizure)),
      sensory: clamp01(Math.max(sig.vertigo, sig.nausea, sig.sexualArousal * 0.6)),
      pain: clamp01(s.pathology.nociception),
    },
    glands,
  };
}
