import type { EffectAccumulator, SimState } from './state';

/**
 * THE EFFECT BUS.
 *
 * Receptor occupancy does not reach a system directly. Instead, pharmacodynamics
 * writes fractional modifiers into a flat accumulator keyed by a dotted target path
 * (`cardio.contractility`, `renal.reninRelease`, ...), and each system reads the
 * targets it cares about once per tick.
 *
 * Why a bus and not direct calls: a receptor can affect several systems, and several
 * receptors can affect one parameter. Summing fractional deltas in one place keeps
 * the composition rule explicit and keeps `src/sim/systems/*` from importing the
 * pharmacology layer.
 *
 * Convention: a value of `0` means "no effect". Systems apply it as `(1 + value)`,
 * so `+0.5` is a 50 % increase and `-0.5` a 50 % decrease. Targets whose natural
 * units are absolute (e.g. `resp.rateOffset_per_min`) say so in the target name.
 */

export const EFFECT_TARGETS = [
  'cardio.contractility',
  'cardio.heartRate',
  'cardio.systemicResistance',
  'cardio.venousTone',
  'cardio.ectopicRate',
  'cardio.avNodalBlock',
  'cardio.arrhythmogenicity',
  // CAUTION, AND READ THIS BEFORE USING IT. `resp.rate` and `resp.tidalVolume` are
  // applied where drive is split into a rate and a depth, which is DOWNSTREAM of the
  // chemoreceptor loop. A sustained push on either is therefore cancelled by the loop:
  // ventilation falls, PaCO2 rises, the chemoreceptor raises drive, and the rate comes
  // back to where it started. That is not a defect in them - it is what makes them the
  // right target for a change of breathing PATTERN, and the wrong one for a change of
  // ventilation.
  //
  // Anything that depresses or stimulates breathing belongs on `resp.drive`. Routing a
  // respiratory depressant here instead is a bug that hides perfectly: the modifier sits
  // on the bus at the correct value, every test of the DATA passes, and the drug does
  // nothing whatsoever. It cost midazolam its entire respiratory effect until
  // tests/sim/integrity.test.ts caught it by measuring behaviour rather than data. See
  // ADR-021.
  //
  // Nothing currently writes `resp.rate`; `resp.tidalVolume` carries airway calibre
  // (beta2, m3, h1) and neuromuscular block, which are mechanical and genuinely belong
  // downstream of drive.
  'resp.rate',
  'resp.tidalVolume',
  'resp.drive',
  'renal.reninRelease',
  'renal.vascularResistance',
  'renal.waterReabsorption',
  'gi.motility',
  'gi.acidSecretion',
  'neuro.sedation',
  'neuro.analgesia',
  'neuro.arousal',
  'metabolic.glucoseUptake',
  'metabolic.hepaticGlucoseOutput',
  'metabolic.insulinSecretion',
  'thermal.heatProduction',
  'vascular.tone',

  /* --------------------------------------------------------------- endocrine */
  // Added for the endocrine subsystem. Hormones are not drugs: they have no dose,
  // no route and no pharmacokinetics in the xenobiotic sense. What they share with
  // drugs is the EFFECT BUS — they push on the same named targets, which is what
  // makes a drug and a hormone able to oppose each other without either knowing the
  // other exists. Adrenaline the infusion and adrenaline the adrenal output reach
  // cardio.contractility by exactly the same path.
  'metabolic.lipolysis',
  'metabolic.proteinCatabolism',
  'metabolic.basalRate',
  'metabolic.glycogenolysis',
  'metabolic.ketogenesis',
  'renal.sodiumReabsorption',
  'renal.potassiumExcretion',
  'renal.calciumReabsorption',
  'renal.erythropoiesis',
  'vascular.permeability',
  'immune.inflammation',
  'bone.resorption',
  'gi.appetite',
  'neuro.stressAxis',
  'thermal.setPoint',

  /* ------------------------------------------------- wider pharmacology bus */
  // Declared ahead of the drugs that will use them. A target here with no consumer
  // is inert — `effect()` returns whatever was accumulated and the systems that do
  // not read it simply do not read it — so the cost of declaring one early is zero,
  // and the cost of NOT declaring it is that a drug's action gets approximated onto
  // a target that means something else. An antiemetic pushed onto `gi.motility`
  // because there was no `gi.nausea` is a worse model than an antiemetic that
  // visibly does nothing yet.
  'blood.coagulation',
  'blood.plateletAggregation',
  'blood.erythropoiesis',
  'cardio.qtInterval',
  'cardio.conductionVelocity',
  'gi.nausea',
  'gi.emesis',
  'neuro.seizureThreshold',
  'neuro.muscleTone',
  'neuro.pupilDiameter',
  'neuro.anxiety',
  'neuro.psychedelia',
  'neuro.euphoria',
  'neuro.dependence',
  'hepatic.enzymeActivity',
  'metabolic.lipidSynthesis',
  'metabolic.urateProduction',
  'immune.histamineRelease',
  'resp.bronchodilation',
  'resp.cough',
] as const;

export type EffectTarget = (typeof EFFECT_TARGETS)[number];

export function clearEffects(acc: EffectAccumulator, mirror?: EffectAccumulator): void {
  if (mirror) for (const k in acc) mirror[k] = acc[k];
  for (const k in acc) acc[k] = 0;
}

/**
 * Read a target as it stood at the END of the previous tick.
 *
 * For a subsystem that runs BEFORE the thing it needs to read. `effect()` is always
 * correct for a target written earlier in the same tick and always returns zero for one
 * written later, which is a trap with no warning on it: the value is not wrong, it is
 * absent, and absent looks exactly like "the drug did nothing".
 *
 * One tick is 10 ms. Every time constant in this model is orders of magnitude longer,
 * so the staleness is not observable - but it is real, and a caller choosing this over
 * `effect()` should be doing so because of ordering, not by accident.
 */
export function prevEffect(s: SimState, target: string): number {
  return s.prevEffects[target] ?? 0;
}

export function addEffect(acc: EffectAccumulator, target: string, value: number): void {
  acc[target] = (acc[target] ?? 0) + value;
}

export function effect(s: SimState, target: string): number {
  return s.effects[target] ?? 0;
}

/** Clamp a fractional modifier so a stacked overdose cannot invert a parameter. */
export function boundedFactor(value: number, min = -0.95, max = 6): number {
  return 1 + Math.max(min, Math.min(max, value));
}
