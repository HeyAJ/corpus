import behaviourFile from '../../data/behaviour.json';
import { P } from '../core/constants';
import { addEffect } from '../core/effects';
import type { SimState } from '../core/state';

/**
 * WHAT THE BODY IS DOING: SLEEP AND EXERTION.
 *
 * Two things that share a file because they share a variable. Both are ways of setting
 * the body's metabolic rate away from basal - one up by a factor of ten, one down by a
 * tenth - and both then have to live with what the rest of the model does about that.
 *
 * Everything here reaches physiology through the EFFECT BUS and nothing else. The one
 * piece of state this file owns and writes is `s.activity`, which is its own. A heart
 * rate written from here would be a cheat code: it would arrive at `cardio.hr` by a path
 * no drug can travel, so a beta blocker given to a sprinting body would blunt the drug's
 * tachycardia and not the exercise's, which is the wrong half.
 *
 * THE DESIGN IN ONE PARAGRAPH. `exertionTarget` is what the person is attempting.
 * `exertion` is the aerobic metabolic rate they are actually running at, and it chases
 * the target with the measured phase-II oxygen-uptake time constant. The gap between the
 * two, integrated, is the OXYGEN DEFICIT, and it is stored in `oxygenDebt_L`. Nothing
 * about the debt is bolted on: it is the area between a step and an exponential, which is
 * exactly what the deficit is defined as, and it is repaid by the same variable running
 * above demand afterwards. Litres in, litres out, through one accumulator.
 *
 * WHAT THIS FILE DOES NOT DO, and why it is written down here rather than discovered
 * later:
 *
 *   - It does not reset the baroreflex. Central command and the exercise pressor reflex
 *     move the baroreflex to a higher operating pressure during exercise, which is why
 *     heart rate and arterial pressure rise together instead of the reflex trading one
 *     against the other. There is no bus target for the setpoint, so the reflex here
 *     fights the exercise tachycardia all the way up and the model reaches a lower peak
 *     heart rate than Tanaka's equation predicts. See `exercise.baroreflexResetting`,
 *     which is a null constant with a citation for precisely this reason.
 *   - It does not produce a lactate threshold. Lactate in this engine is a function of
 *     oxygen DELIVERY (systems/metabolic.ts), and delivery rises during exercise because
 *     cardiac output does, so lactate falls slightly rather than rising. An anaerobic
 *     threshold would need a demand term that model does not have.
 *   - It does not model REM, sleep cycling, or the upper airway. `sleepDepth` is one
 *     continuous number that goes down and comes back up, not an architecture.
 */

/* ========================================================================== *
 * THE CONSTANT TABLE
 *
 * Lives here, and `affect.ts` imports it, rather than in a third module: exertion,
 * sleep and affect are one subsystem that happens to be split across two files by
 * where the tick hooks are, and a shared loader module would imply a layer that does
 * not exist. `B()` throws on a missing or null key for the same reason `P()` does -
 * a constant that silently becomes NaN is a bug that survives every test of the data.
 * ========================================================================== */

export interface BehaviourConstant {
  value: number | null;
  unit: string;
  source: string;
  sourceUrl: string;
  confidence: 'measured' | 'derived' | 'assumed';
  note: string;
}

interface BehaviourFile {
  version: number;
  about: string;
  citationPolicy: string;
  sources: Record<string, { label: string; url: string }>;
  constants: Record<string, BehaviourConstant>;
}

const BEHAVIOUR = behaviourFile as unknown as BehaviourFile;

/** Numeric behaviour constant. Throws if absent or deliberately null. */
export function B(key: string): number {
  const e = BEHAVIOUR.constants[key];
  if (!e) throw new Error(`behaviour.json: unknown constant "${key}"`);
  if (e.value === null) {
    throw new Error(
      `behaviour.json: "${key}" is a declared hole with no value. ` +
        `It documents something this model cannot do; it must not be read by the engine.`,
    );
  }
  return e.value;
}

/** Provenance, for the tests and for any interface that wants to show where a number came from. */
export function behaviourConstants(): Record<string, BehaviourConstant> {
  return BEHAVIOUR.constants;
}

export function behaviourSources(): Record<string, { label: string; url: string }> {
  return BEHAVIOUR.sources;
}

/* ========================================================================== */

export function stepActivity(s: SimState, dt: number): void {
  s.activity.boutT += dt;

  // Sleep first: how deep this body is asleep changes what it will attempt, and the
  // exertion half reads `sleepDepth`. The reverse coupling does not exist - the engine
  // already zeroes `exertionTarget` when the SET_SLEEP intent arrives - so the order is
  // a real dependency rather than a coin toss.
  stepSleep(s, dt);
  stepExertion(s, dt);
}

/* ------------------------------------------------------------------ sleep */

function stepSleep(s: SimState, dt: number): void {
  const a = s.activity;

  // Awake is not "asleep with depth zero". A body that is awake must write NOTHING to
  // the bus, or the subsystem leaves a residue on every tick of every run that has
  // nothing to do with sleep - and a residue that small is exactly the kind that gets
  // found six weeks later as an unexplained 1% in a drug sweep. The engine's SET_SLEEP
  // intent is what lifts this off zero.
  if (a.sleepDepth <= 0) return;

  // How deep this body can get. Depression flattens slow-wave sleep, and a fright
  // drags the sleeper towards the surface; both are ceilings on depth rather than
  // forces on it, because neither of them wakes you by pushing.
  const ceiling = Math.max(
    0,
    1 -
      B('depression.slowWaveSleepFall') * s.affect.depression -
      B('sleep.arousalFromFright') * s.affect.fright,
  );

  // First order, not a staircase. Real sleep goes N1 -> N2 -> N3 in discrete stages and
  // then cycles back out every ninety minutes; this is the envelope of the first
  // descent and nothing more. Calibrated by its time constant against the cited 20-30
  // minute latency to the first slow-wave epoch - see the note on the constant.
  a.sleepDepth += ((ceiling - a.sleepDepth) * dt) / B('sleep.deepeningTimeConstant_s');
  a.sleepDepth = Math.max(0, Math.min(1, a.sleepDepth));

  const d = a.sleepDepth;

  // METABOLIC RATE. `thermal.heatProduction` is the target that systems/respiratory.ts
  // reads in `metabolicScale()` to set VO2 and VCO2, and that systems/metabolic.ts reads
  // for the heat balance. So one write lowers oxygen consumption, CO2 production and
  // heat production together, which is right: they are one fact about a sleeping body,
  // not three.
  //
  // `metabolic.basalRate` is the semantically correct name for this and is declared in
  // EFFECT_TARGETS, but nothing reads it. It is left unwritten on purpose: writing both
  // would double-count the moment somebody connects it. See docs/BEHAVIOUR.md.
  addEffect(s.effects, 'thermal.heatProduction', -B('sleep.metabolicRateFall') * d);

  // VENTILATION, and the point of the whole subsystem.
  //
  // This is a single modifier doing two jobs, and that it can is a property of where the
  // consumer applies it. systems/respiratory.ts computes
  //
  //     targetDrive = (baselineDrive + chemoDrive) * narcosis * driveScale * (1 + effect)
  //
  // so a negative modifier scales the CHEMORECEPTOR LIMB as well as the baseline. It
  // therefore blunts the slope of the hypercapnic ventilatory response by the same
  // fraction - which is the measured thing (Douglas 1982: the slope roughly halves in
  // NREM) - and withdraws the wakefulness drive at the same time.
  //
  // What it does NOT do is set minute ventilation. The loop settles wherever it must to
  // clear this body's CO2 production, so ventilation ends up lower because metabolism is
  // lower, and the arterial PCO2 rise that Douglas's companion paper measured at 2-4
  // mmHg comes out of the model instead of going into it. tests/sim/behaviour.test.ts
  // asserts against that published rise, which makes it a check on this number rather
  // than a restatement of it.
  //
  // AND IT IS WHY AN OPIOID IS MORE DANGEROUS ASLEEP. Opioids reach `resp.drive` through
  // mu occupancy at -0.85, and the bus SUMS. A sleeping body at -0.5 and a moderate
  // opioid at -0.6 arrive at the same accumulator as -1.1, and (1 + -1.1) is negative:
  // drive clamps at zero and the body stops breathing. Neither on its own does that.
  // That composition is a real clinical killer and it needed no code at all - only for
  // both of them to use the same path.
  addEffect(s.effects, 'resp.drive', -B('sleep.ventilatoryDriveFall') * d);

  // CIRCULATION. Sleep is principally a withdrawal of sympathetic outflow (Somers 1993:
  // muscle sympathetic nerve activity falls progressively from stage 2 to stage 4), so
  // both limbs point the same way and the nocturnal pressure dip falls out of them
  // rather than being written down. The baroreflex will oppose the dip, as it should -
  // a real sleeper's baroreflex is still working too, and it is why the dip is 10-20%
  // rather than the 30% the raw sympathetic withdrawal would suggest.
  addEffect(s.effects, 'cardio.heartRate', -B('sleep.heartRateFall') * d);
  addEffect(s.effects, 'cardio.systemicResistance', -B('sleep.systemicResistanceFall') * d);

  // Arousal, as a plain statement of fact on the bus. Nothing consumes `neuro.arousal`
  // yet. It is written anyway because the sign convention is unambiguous - the bus
  // documents 0 as no effect and negative as a decrease - and because the alternative is
  // that the one subsystem in this engine that actually knows whether the body is
  // conscious keeps it to itself.
  addEffect(s.effects, 'neuro.arousal', -d);
}

/* --------------------------------------------------------------- exertion */

function stepExertion(s: SimState, dt: number): void {
  const a = s.activity;

  // METs above rest. `exertion` is a fraction of the aerobic range, so the metabolic
  // multiple is 1 + exertion * (max - 1), and this is the (max - 1).
  const span = B('exercise.maximalAerobicMets') - 1;
  // The resting figure is physiology.json's, already cited to West, rather than a second
  // copy of 250 mL/min living in this subsystem. Two copies of a constant is one too
  // many; they diverge silently.
  const restVo2_L_per_min = P('resp.vo2_mL_per_min') / 1000;

  // WHAT THE BODY WILL ACTUALLY DELIVER for what the person is attempting. Depression
  // shows up here rather than as a force somewhere downstream, because psychomotor
  // retardation is a change in what effort produces, not a brake applied to a body that
  // is otherwise doing the same thing.
  const tolerance = Math.max(0, 1 - B('depression.exertionToleranceFall') * s.affect.depression);
  const demand = Math.max(0, Math.min(1, a.exertionTarget * tolerance));

  // THE OXYGEN DEBT ASKS FOR OXYGEN OF ITS OWN.
  //
  // Expressed as the exertion level whose extra oxygen flux would clear the outstanding
  // debt over the EPOC time constant. Writing it this way rather than as a separate
  // "recovery" term means the debt and the effort compete for one variable, so a body
  // that starts running again before it has finished recovering does not get two
  // metabolic rates - it gets the larger of them, which is what a body does.
  const epocTau_s = B('exercise.epocHalfTime_s') / Math.LN2;
  const debtFlux_L_per_min = a.oxygenDebt_L / (epocTau_s / 60);
  const repayAsk = debtFlux_L_per_min / (span * restVo2_L_per_min);

  const ask = Math.max(demand, Math.min(1, repayAsk));

  // Phase-II oxygen uptake kinetics. This lag IS the mechanism: the demand steps and
  // the delivery does not, and everything interesting about the first minute of exercise
  // and the three minutes after it is the consequence.
  a.exertion += ((ask - a.exertion) * dt) / B('exercise.vo2TimeConstant_s');
  a.exertion = Math.max(0, Math.min(1, a.exertion));

  // DEBT ACCOUNTING, in litres of oxygen, against the DEMAND and not against the ask.
  //
  // Using `demand` here is the whole trick and it is worth being explicit about. During
  // the transient at the start of a bout, demand exceeds delivery and the difference
  // accrues - that difference is the textbook definition of the oxygen deficit. After
  // the bout demand is zero while delivery is still elevated, so the same subtraction
  // goes negative and the debt drains at exactly the rate the surplus oxygen is being
  // consumed. Nothing is created or destroyed on either side; it is one integral run in
  // two directions, which is why the litres balance and why `exertion` decays on the
  // EPOC clock instead of the onset clock without anybody writing a second time constant.
  const netAbove_L_per_min = (demand - a.exertion) * span * restVo2_L_per_min;
  a.oxygenDebt_L = Math.max(0, a.oxygenDebt_L + (netAbove_L_per_min * dt) / 60);

  const x = a.exertion;
  // Silent at rest, for the same reason sleep is: a body doing nothing must leave
  // nothing on the bus. The guard is on `exertion` and not on `exertionTarget`, so the
  // three-minute recovery tail still runs after the target has gone back to zero.
  if (x <= 0) return;

  const met = 1 + x * span;

  // OXYGEN CONSUMPTION, CO2 PRODUCTION AND HEAT, all three from one write, for the
  // reason given in stepSleep above: `thermal.heatProduction` is what `metabolicScale()`
  // in systems/respiratory.ts multiplies VO2 and VCO2 by.
  //
  // THE HONEST PROBLEM WITH THIS. The same number is also the heat term, and the two are
  // not equal in a real body: about a fifth of the metabolic cost of locomotion leaves
  // as external work rather than as heat. More importantly, this engine's
  // thermoregulation has a proportional gain and no sweat model, so its maximum heat
  // loss is about 2.6 times basal while this asks for up to ten. A short bout therefore
  // warms the body at a realistic rate - about 0.19 C/min at full effort, which is what
  // a real one does - and a long bout at high effort climbs past anything physiological.
  // The fix is one line in someone else's file and is written out in docs/BEHAVIOUR.md;
  // it is NOT a fudge factor here, because a fudge factor would fix the temperature by
  // making the ventilation wrong.
  addEffect(s.effects, 'thermal.heatProduction', met - 1);

  // CHRONOTROPY, from the Karvonen relation rather than from a fitted gain.
  //
  // Percentage of heart rate reserve equals percentage of oxygen uptake reserve, which
  // is the relation the whole of exercise prescription is built on, and `exertion` is
  // already defined as the fraction of the aerobic reserve in use. So the target heart
  // rate is rest + x * (max - rest), and the modifier is whatever fraction of the
  // resting rate that represents. Maximum heart rate is age-specific and read live from
  // `s.body.age_y`, so changing the body's age through SET_BODY changes what it can do -
  // which is the point of having an age at all.
  const hrMax = B('exercise.maxHeartRateIntercept_bpm') - B('exercise.maxHeartRateAgeSlope_bpm_per_year') * s.body.age_y;
  const hrRest = P('cardio.heartRateBaseline_bpm');
  addEffect(s.effects, 'cardio.heartRate', (x * Math.max(0, hrMax - hrRest)) / hrRest);

  // INOTROPY. Stroke volume rises by about half and then stops, at somewhere around 40
  // to 50 per cent of VO2max; everything above that comes from rate alone. The plateau
  // is not decoration - it is the reason the top half of an exercise ramp feels
  // different from the bottom half, and the reason a heart that cannot raise its rate
  // (fixed-rate pacing, a heavy beta blockade) loses so much more capacity than the
  // arithmetic suggests.
  const plateau = B('exercise.strokeVolumePlateauFraction');
  addEffect(
    s.effects,
    'cardio.contractility',
    B('exercise.strokeVolumeRise') * Math.min(1, x / plateau),
  );

  // MUSCLE VASODILATION. The largest single number in this file, and it has to be:
  // cardiac output quadruples while mean pressure rises by a fifth, so resistance ends
  // at under a third of resting. Without this the pressure produced by a heart doing
  // four times the work would be absurd, and with it the model shows the thing that
  // surprises people - that exercise is a vasodilated state.
  addEffect(s.effects, 'cardio.systemicResistance', -B('exercise.systemicResistanceFall') * x);
  addEffect(s.effects, 'cardio.venousTone', B('exercise.venousReturnRise') * x);

  // VENTILATION: FEED-FORWARD, NOT CHEMOREFLEX.
  //
  // This is the part that a naive model gets backwards. Exercise hyperpnoea is not the
  // chemoreceptors answering a rise in CO2 - arterial PCO2 is flat through moderate
  // exercise and FALLS at high work rates. Ventilation is driven forward by central
  // command and muscle afferents, in proportion to CO2 production, and the chemoreflex
  // spends the whole bout with almost nothing to do. So the modifier is the metabolic
  // multiple minus one: breathe as many times more as you are producing CO2.
  //
  // Routed to `resp.drive` and not to `resp.rate`, per the warning at the top of
  // effects.ts and ADR-021. A push on rate lands downstream of the chemoreflex and gets
  // cancelled by it exactly; this is a change in ventilation, not in pattern.
  //
  // The residual: this model's rate/depth split raises tidal volume faster than a real
  // subject's, so dead-space fraction improves more than it should and arterial PCO2
  // ends a few mmHg below resting at high effort instead of at it. The direction is
  // right - heavy exercise really is hypocapnic - and the size is a few mmHg. Named in
  // docs/BEHAVIOUR.md rather than tuned away.
  addEffect(s.effects, 'resp.drive', met - 1);

  // GLUCOSE, both sides of it. The liver's output and the muscle's uptake rise together
  // during exercise and very nearly cancel, which is why arterial glucose barely moves
  // in a fed subject - that near-cancellation is the finding, not a coincidence, and
  // modelling only one side of it would produce a body that goes hypo- or hyperglycaemic
  // every time it moves.
  //
  // The uptake half is weaker here than it should be. `metabolic.glucoseUptake`
  // multiplies the insulin-dependent limb of the Bergman minimal model, and the
  // contraction-mediated limb that does most of this work in a real exercising muscle is
  // insulin-INDEPENDENT, so at basal insulin this write is nearly inert. It is made
  // anyway, because it is the correct target and it becomes correct the moment there is
  // insulin about - after a meal, or on an insulin infusion, which is precisely the
  // situation where exercise-induced hypoglycaemia is a clinical problem.
  addEffect(s.effects, 'metabolic.hepaticGlucoseOutput', (B('exercise.hepaticGlucoseOutputRise') - 1) * x);
  addEffect(s.effects, 'metabolic.glucoseUptake', (B('exercise.glucoseUptakeRise') - 1) * x);
}
