import { P } from '../core/constants';
import { addEffect } from '../core/effects';
import type { SimState } from '../core/state';
import { B } from './activity';

/**
 * WHAT THE BODY FEELS: FRIGHT, STRESS AND LOW MOOD.
 *
 * Three states on three clocks, which is the reason they are three numbers and not one.
 * Fright resolves on the clearance half-life of adrenaline - two minutes. Stress runs on
 * the hypothalamic-pituitary-adrenal axis, whose own integrator in systems/endocrine.ts
 * has a ten-minute time constant and whose product, cortisol, has an eighty-minute
 * half-life. Depression does not resolve at all on any clock this simulation runs; it is
 * a shift in where the set points sit. Lump them and you have to pick one time constant
 * for all three, and whichever you pick is wrong for the other two.
 *
 * ALL THREE REACH PHYSIOLOGY THROUGH THE EFFECT BUS. That is not a style rule here, it
 * is the entire feature: a frightened body and a body given adrenaline arrive at
 * `cardio.contractility` by the same path, so a beta blocker blunts the fright without
 * either the fright or the drug knowing the other happened. Writing `s.cardio.hr` would
 * make the frightened body's tachycardia the one thing in this simulation that no drug
 * can touch.
 *
 * WHAT IS NOT MODELLED, said plainly rather than left to be discovered:
 *
 *   - Depression's best-replicated physiological sign is reduced heart rate variability
 *     (Kemp 2010), and this engine's only variability is respiratory sinus arrhythmia,
 *     whose amplitude is a fixed constant read inside systems/cardio.ts with no bus
 *     target in front of it. So the sign we can cite best is the one we cannot show.
 *     `depression.heartRateVariabilityFall` is a null constant recording that.
 *   - `depression` is one scalar, and real depression is at least two things with
 *     opposite signs: the melancholic subtype loses appetite and sleep, the atypical
 *     subtype gains both. One number cannot have two signs, so one was chosen and the
 *     choice is written down in the constant's own note.
 *   - Stress here is a level somebody sets, not something the body generates. A model in
 *     which being unwell is itself stressful would be better and would also be a
 *     feedback loop, and feedback loops need to be designed rather than added.
 */

export function stepAffect(s: SimState, dt: number): void {
  stepFright(s, dt);
  stepStress(s);
  stepDepression(s);
}

/* ----------------------------------------------------------------- fright */

function stepFright(s: SimState, dt: number): void {
  const f0 = s.affect.fright;
  // Nothing at all when the body is calm. A subsystem that writes zeroes still writes,
  // and the accumulator is shared.
  if (f0 <= 0) return;

  // Exponential decay evaluated exactly rather than as a forward-Euler step. The
  // difference at 10 ms against a two-minute half-life is negligible; the reason to do
  // it properly is that the half-life is a CITED number and a Euler decay would make the
  // realised half-life depend on the step size, which would quietly decouple the
  // simulation from its own citation the day anybody changed dt.
  const f = f0 * Math.exp((-Math.LN2 * dt) / B('fright.decayHalfLife_s'));
  s.affect.fright = f < 1e-4 ? 0 : f;

  // CHRONOTROPY. Expressed as a bpm rise against the resting baseline and converted to
  // the bus's fractional convention here, because the source measures bpm - ambulatory
  // recordings during spontaneous panic - and a fraction would have been a number nobody
  // published.
  addEffect(s.effects, 'cardio.heartRate', (B('fright.heartRateRise_bpm') * f) / P('cardio.heartRateBaseline_bpm'));

  // INOTROPY AND TONE, the two halves of the pressure rise. Contractility carries most
  // of it, because at the plasma adrenaline concentrations a fright produces the beta
  // effects lead: infused adrenaline at these levels raises systolic and CARDIAC OUTPUT
  // while leaving diastolic flat or lower, through beta-2 dilation in muscle. A fright
  // has the sympathetic nerve traffic as well as the circulating hormone, so the net
  // resistance change comes out positive - but only just, and that "only just" is why
  // the number is 0.15 and not 0.5.
  addEffect(s.effects, 'cardio.contractility', B('fright.contractilityRise') * f);
  addEffect(s.effects, 'cardio.systemicResistance', B('fright.systemicResistanceRise') * f);

  // FAST AND SHALLOW. These two targets are the ones effects.ts warns against, and this
  // is the case its warning explicitly makes room for: they sit downstream of the
  // chemoreflex, so the loop cancels any sustained push on ventilation through them -
  // which makes them exactly right for a change of PATTERN and useless for a change of
  // amount. A frightened body breathes faster and less deeply and clears no more CO2 for
  // it, because its dead-space fraction has gone up. That is the pattern, and the
  // chemoreflex cancelling the net is the correct behaviour rather than a lost effect.
  addEffect(s.effects, 'resp.rate', B('fright.respiratoryRateRise') * f);
  addEffect(s.effects, 'resp.tidalVolume', -B('fright.tidalVolumeFall') * f);

  // The genuine hyperventilation, which is a separate fact and therefore a separate
  // target. This one is upstream of the chemoreflex and does move ventilation, so
  // arterial PCO2 falls - and the hypocapnia is the mechanism behind the paraesthesiae
  // and the carpopedal spasm that make a panic attack frightening in its own right.
  addEffect(s.effects, 'resp.drive', B('fright.ventilatoryDriveRise') * f);

  // Sympathetic inhibition of the gut. Cheap to write and not decorative: it slows
  // gastric emptying, which slows the absorption of any oral drug this body happens to
  // be carrying. Being frightened changes what a tablet does.
  addEffect(s.effects, 'gi.motility', -B('fright.gutMotilityFall') * f);

  // Adrenaline is a glycogenolytic hormone as well as a cardiac one, and Clutter's
  // thresholds put the glycaemic action ABOVE the chronotropic one - so a fright raises
  // heart rate before it raises glucose. That ordering is reproduced by the two
  // coefficients rather than stated anywhere.
  addEffect(s.effects, 'metabolic.hepaticGlucoseOutput', B('fright.hepaticGlucoseOutputRise') * f);

  // The HPA limb. Routed at `neuro.stressAxis` - see stepStress for what that target
  // currently does and does not reach.
  addEffect(s.effects, 'neuro.stressAxis', B('fright.stressAxisDrive') * f);

  // Declarations of state on the bus. Neither is consumed yet; both have unambiguous
  // sign conventions and cost nothing, and a frightened body that says nothing about
  // being aroused or anxious is withholding the only thing it knows for certain.
  addEffect(s.effects, 'neuro.arousal', f);
  addEffect(s.effects, 'neuro.anxiety', f);
}

/* ----------------------------------------------------------------- stress */

function stepStress(s: SimState): void {
  const st = s.affect.stress;
  if (st <= 0) return;

  // No decay term. `stress` is a LEVEL the scenario sets - "this person is under this
  // much load" - not an event that resolves, and inventing a recovery half-life for
  // psychological stress would be inventing a physiological number by another route.
  // Fright decays because adrenaline is cleared and that clearance is measured; nothing
  // equivalent exists for this.

  // THE SYMPATHETIC LIMB, which is the part that acts now. Sustained rather than
  // transient: the distinction between this and fright is entirely one of time course,
  // and if the two had the same coefficients the model would be saying a startle and a
  // difficult month are the same thing at different volumes.
  addEffect(s.effects, 'cardio.heartRate', B('stress.heartRateRise') * st);
  addEffect(s.effects, 'cardio.systemicResistance', B('stress.systemicResistanceRise') * st);
  addEffect(s.effects, 'neuro.anxiety', st);

  // THE HPA LIMB, and a path that is currently incomplete. Say so here rather than in a
  // document nobody opens.
  //
  // Cortisol is already modelled, properly, in systems/endocrine.ts: a secretion rate
  // driven by `s.endocrine.stressAxis`, a circadian term, an eighty-minute half-life, a
  // Hill transform, and an effect vector that already reaches hepatic glucose output,
  // protein catabolism and inflammation. Driving that is the right thing to do and
  // duplicating it here would give this simulation two cortisols that disagree.
  //
  // So psychological stress is written to `neuro.stressAxis`, which is the declared bus
  // target for exactly this, and endocrine.ts DOES NOT YET READ IT - its `stressAxis`
  // integrator currently relaxes towards a target built only from hypotension, hypoxia
  // and hypoglycaemia. Until one line there adds this modifier to that target, the
  // psychological limb of the HPA axis is on the bus and reaching nothing.
  //
  // The alternative was to write `s.endocrine.stressAxis` directly from here, and it was
  // rejected: it is another system's state, it would be overwritten by that system's own
  // relaxation on the same tick, and it would be the one drive on cortisol that no drug
  // could modulate - which is the exact property the bus exists to prevent. A path that
  // is visibly incomplete is better than a path that is invisibly wrong.
  addEffect(s.effects, 'neuro.stressAxis', B('stress.hpaDrive') * st);
}

/* ------------------------------------------------------------- depression */

function stepDepression(s: SimState): void {
  const dp = s.affect.depression;
  if (dp <= 0) return;

  // BE CLEAR ABOUT HOW CRUDE THIS IS.
  //
  // What follows is not a model of depression. It is three correlates of depression, two
  // of which are set-point shifts small enough that you would not see them in one body,
  // and one of which - appetite - is written to a target nothing reads. Depression is a
  // disorder of mood, motivation and cognition, none of which this simulation represents
  // at all, and the physiological signature that survives meta-analysis is autonomic
  // (reduced heart rate variability) rather than anything on this list.
  //
  // The reason to have it anyway is that its EFFECTS ON OTHER SUBSYSTEMS are real and
  // are the point: a depressed body attempts the same exertion and delivers less of it,
  // and sleeps less deeply for the same hours. Both of those live in systems/activity.ts,
  // which reads `s.affect.depression` directly, and both are the kind of thing that only
  // shows up when you drive the model rather than read its numbers.
  //
  // What it must not do is pretend. Nothing here is a claim about how depressed people
  // feel; every number is a correlate with a citation and a stated weakness.

  // A modest, sustained resting tachycardia - the companion finding to the reduced
  // variability, and the only cardiovascular sign of depression this engine can show.
  addEffect(
    s.effects,
    'cardio.heartRate',
    (B('depression.restingHeartRateRise_bpm') * dp) / P('cardio.heartRateBaseline_bpm'),
  );

  // Appetite. `gi.appetite` is declared and unread, so this currently reaches nothing,
  // and the sign is a choice between two real subtypes that point opposite ways. Both
  // caveats are in the constant's own note; it is written because it is the right target
  // and because the day something consumes it, this should already be there.
  addEffect(s.effects, 'gi.appetite', -B('depression.appetiteFall') * dp);

  // HPA overactivity, in about half of patients with major depression. Same routing and
  // the same incomplete path as psychological stress above; the coefficient is smaller
  // because it is a population average standing in for a bimodal fact.
  addEffect(s.effects, 'neuro.stressAxis', B('depression.hpaDrive') * dp);
}
