import pathogensFile from '../../data/pathogens.json';
import { P } from '../core/constants';
import { addEffect, setEffectSource } from '../core/effects';
import type { SimState, PathogenBurden } from '../core/state';
import type { Drug } from '../../data/pharma-types';

/**
 * INFECTION.
 *
 * This file was a declared no-op scaffold: `stepInfection` took the state and the time
 * step and did nothing with either, and the two intents that reached it (INOCULATE,
 * CLEAR_INFECTION) pushed a burden onto a list that no code ever read. A body that
 * could be given a pathogen and never fall ill is not modelling infection, it is
 * storing a label.
 *
 * WHAT AN INFECTION IS HERE. Each pathogen carries, in src/data/pathogens.json, a
 * replication rate, an innate-immunity control rate, the time its adaptive response
 * takes to arrive and how hard it then bites, and an effect vector onto the shared bus.
 * The burden - normalised to that pathogen's own untreated peak - follows logistic
 * growth checked first by innate immunity and then, after its onset delay, by the
 * adaptive response that eventually clears it. That is the shape every acute
 * self-limiting infection has: a rise to a peak two to three days in, then a clearance
 * as immunity catches up. A chronic infection (HIV) simply has rates slow enough that
 * the balance never tips within a session.
 *
 * EVERYTHING IT DOES TO THE BODY GOES THROUGH THE BUS. The fever, the shunt of a
 * pneumonia, the capillary leak of sepsis, the diarrhoea of cholera, the
 * thrombocytopenia of dengue, the haemolysis of malaria - each is an effect target
 * that some other system already consumes, scaled by burden. So an antipyretic blunts
 * the fever, fluids answer the diarrhoea, and the sepsis and its treatment argue on the
 * same `cardio.systemicResistance` a vasopressor pushes. Nothing about an infection is
 * special-cased downstream; it is one more thing pushing on the bus.
 *
 * ANTIMICROBIALS act here, reading the drug's `antimicrobial` block: kill (or, for a
 * virustatic drug, suppressed replication) follows an Emax curve on the free plasma
 * concentration with the pathogen's MIC as the potency term, and ONLY for pathogens in
 * the drug's spectrum. An antibiotic given for a virus visibly does nothing, which is
 * the single most important thing about antibiotics to teach.
 */

interface PathogenEffect {
  target: string;
  gain: number;
  note: string;
}
interface PathogenDef {
  id: string;
  label: string;
  kind: 'virus' | 'bacterium' | 'parasite' | 'toxin';
  site: string;
  incubation_h: number;
  growthRate_per_h: number;
  innateControl_per_h: number;
  adaptiveOnset_h: number;
  adaptivePeakControl_per_h: number;
  clearanceFloor: number;
  lethalBurden: number | null;
  cd4DeclinePerBurden_per_h?: number;
  effects: PathogenEffect[];
}
interface PathogensFile {
  version: number;
  pathogens: PathogenDef[];
}

export const PATHOGENS = (pathogensFile as unknown as PathogensFile).pathogens;
export const PATHOGEN_BY_ID = new Map(PATHOGENS.map((p) => [p.id, p]));

/** Below this normalised burden the pathogen is declared cleared and removed. */
const EXTINCTION = 1e-3;

export function stepInfection(s: SimState, dt: number): void {
  const inf = s.infection;
  const dtH = dt / 3600;

  let totalActivation = 0;
  let anyReplicating = false;

  for (const b of inf.active) {
    const def = PATHOGEN_BY_ID.get(b.pathogenId);
    if (!def) continue;
    b.t += dt;
    if (b.cleared) continue;

    // --- growth, checked by immunity --------------------------------------
    const symptomatic = b.t >= def.incubation_h * 3600;
    b.symptomatic = symptomatic;

    // Adaptive immunity builds after its onset delay, over a couple of days.
    if (b.t >= def.adaptiveOnset_h * 3600) {
      const build = 1 - Math.exp(-(b.t - def.adaptiveOnset_h * 3600) / (2 * 86400));
      b.adaptive = Math.min(1, build);
    }

    const innate = def.innateControl_per_h * (0.5 + inf.immuneActivation);
    const adaptive = def.adaptivePeakControl_per_h * b.adaptive;
    // Logistic growth: the (1 - burden) term stops a single pathogen filling the body,
    // and is what gives the peak-and-fall rather than an exponential runaway.
    const growth = def.growthRate_per_h * b.burden * Math.max(0, 1 - b.burden / 1.3);
    const drugKill = antimicrobialKill(s, def) * b.burden;
    b.drugKill_per_h = drugKill / Math.max(1e-6, b.burden);

    const dBurden = (growth - (innate + adaptive) * b.burden - drugKill) * dtH;
    b.burden = Math.max(0, b.burden + dBurden);

    if (b.sincePeak < 0 && dBurden < 0) b.sincePeak = 0;
    else if (b.sincePeak >= 0) b.sincePeak += dt;

    b.load_log10 = Math.log10(Math.max(1e-9, b.burden / EXTINCTION));

    if (b.burden < EXTINCTION && b.t > def.incubation_h * 1800) {
      b.cleared = true;
      b.burden = 0;
      continue;
    }
    if (b.burden > 1e-6) anyReplicating = true;

    // --- what the pathogen does to the body -------------------------------
    if (symptomatic) {
      setEffectSource(`pathogen:${def.id}`);
      for (const fx of def.effects) {
        let scale = b.burden;
        // Dengue's plasma leak and the like are weighted to the defervescence: they
        // strike as the burden falls, which is the clinical trap. Detected by a
        // negative-going burden past its peak.
        if (fx.target === 'vascular.permeability' && def.id === 'dengue') {
          scale = b.sincePeak > 0 ? Math.min(1, b.sincePeak / (2 * 86400)) * Math.max(b.burden, 0.3) : b.burden * 0.3;
        }
        addEffect(s.effects, fx.target, fx.gain * scale);
      }
      setEffectSource('body');
    }

    // HIV: the CD4 count falls with burden over the untreated years.
    if (def.cd4DeclinePerBurden_per_h && b.burden > 0) {
      inf.cd4_per_uL = Math.max(2, inf.cd4_per_uL - def.cd4DeclinePerBurden_per_h * b.burden * dtH * inf.cd4_per_uL);
    }

    totalActivation += Math.min(1, b.burden);
  }

  // Drop cleared pathogens once they have been cleared a while (kept briefly so the UI
  // can show "cleared").
  if (inf.active.some((b) => b.cleared && b.t > 0)) {
    inf.active = inf.active.filter((b) => !(b.cleared && b.sincePeak > 3600));
  }

  // --- innate immune activation and the acute-phase markers ---------------
  const target = Math.min(1, totalActivation + Math.max(0, s.pathology.inflammation));
  inf.immuneActivation += (target - inf.immuneActivation) * (1 - Math.exp(-dt / (4 * 3600)));

  // White cells rise within hours; CRP over a day. Both toward a burden-scaled ceiling.
  const wbcTarget = P('immune.wbcBaseline_10e9_per_L') +
    (P('immune.wbcMax_10e9_per_L') - P('immune.wbcBaseline_10e9_per_L')) * inf.immuneActivation;
  inf.wbc += (wbcTarget - inf.wbc) * (1 - Math.exp(-dt / (6 * 3600)));

  const crpTarget = P('immune.crpBaseline_mg_per_L') +
    (P('immune.crpMax_mg_per_L') - P('immune.crpBaseline_mg_per_L')) * inf.immuneActivation * inf.immuneActivation;
  inf.crp += (crpTarget - inf.crp) * (1 - Math.exp((-Math.LN2 * dt) / (P('immune.crpHalfLife_h') * 3600)));

  // Slow CD4 recovery when HIV is suppressed (or absent).
  const hiv = inf.active.find((b) => b.pathogenId === 'hiv_1' && !b.cleared);
  if ((!hiv || hiv.burden < 0.05) && inf.cd4_per_uL < P('immune.cd4Baseline_per_uL')) {
    inf.cd4_per_uL = Math.min(
      P('immune.cd4Baseline_per_uL'),
      inf.cd4_per_uL + (P('immune.cd4Baseline_per_uL') - inf.cd4_per_uL) * (1 - Math.exp(-dtH / (30 * 24))),
    );
  }

  void anyReplicating;
}

/**
 * Antimicrobial kill rate against one pathogen, per hour, summed over every drug on
 * board that names it in its spectrum. Emax on the free plasma concentration with the
 * MIC as the half-maximal term. A virustatic drug (maxKill via suppressed replication)
 * uses the same maths; the distinction is recorded in the drug's note, not the engine.
 */
function antimicrobialKill(s: SimState, def: PathogenDef): number {
  let kill = 0;
  for (const st of s.drugs) {
    if (st.cp <= 0) continue;
    const drug = DRUG_BY_ID?.get(st.drugId);
    const am = drug?.antimicrobial;
    if (!am) continue;
    const entry = am.spectrum.find((x) => x.pathogenId === def.id);
    if (!entry) continue;
    // Free concentration in mg/L: total plasma times unbound fraction. cp is mg/L.
    const bound = drug.pk.proteinBound ?? 0;
    const free = st.cp * (1 - bound);
    const c = Math.pow(free, am.hill);
    const mic = Math.pow(entry.mic_mg_per_L, am.hill);
    kill += am.maxKill_per_h * (c / (mic + c));
  }
  return kill;
}

/**
 * The drug table, injected once at load by the engine. Kept as a module reference so
 * this file does not import the whole drugs.json (which would pull the data layer into
 * a systems file); the engine already holds the map.
 */
let DRUG_BY_ID: Map<string, Drug> | null = null;
export function setInfectionDrugTable(map: Map<string, Drug>): void {
  DRUG_BY_ID = map;
}

/** Create a fresh burden for an inoculation. */
export function newBurden(pathogenId: string, dose_log10: number): PathogenBurden {
  // A dose expressed in log10 relative to a "standard" inoculum seeds a small starting
  // burden; a larger inoculum starts higher and reaches symptoms sooner.
  const burden0 = Math.max(EXTINCTION * 2, 0.01 * Math.pow(10, Math.max(-2, Math.min(3, dose_log10))) / 10);
  return {
    pathogenId,
    load_log10: dose_log10,
    burden: Math.min(0.2, burden0),
    t: 0,
    symptomatic: false,
    adaptive: 0,
    drugKill_per_h: 0,
    cleared: false,
    sincePeak: -1,
  };
}

/** qSOFA-style sepsis flag from live signs (Sepsis-3): a screening heuristic. */
export function isSepsis(s: SimState): boolean {
  const anyBacterial = s.infection.active.some((b) => {
    const def = PATHOGEN_BY_ID.get(b.pathogenId);
    return def && (def.kind === 'bacterium') && b.symptomatic && b.burden > 0.2;
  });
  if (!anyBacterial && s.pathology.inflammation < 0.5) return false;
  let score = 0;
  if (s.resp.rate >= 22) score += 1;
  if (s.cardio.sbp <= 100) score += 1;
  if (s.neuro.consciousness < 0.85) score += 1;
  return score >= 2;
}
