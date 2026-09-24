import pathologyFile from '../../data/pathology.json';
import { P } from '../core/constants';
import { addEffect, prevEffect } from '../core/effects';
import { addVolume } from './cardio';
import type { SimState } from '../core/state';

/**
 * WHAT IS WRONG: PAIN, INFLAMMATION, HAEMORRHAGE AND VERTIGO.
 *
 * Four things that can be wrong with a body for reasons that have nothing to do with
 * what was given to it. Until this file had a body in it, the only way to move this
 * simulation was to inject something.
 *
 * Everything here reaches the rest of the body through the EFFECT BUS
 * (`addEffect` in `core/effects.ts`), never by writing another system's state. That is
 * what lets a painful stimulus and a beta blocker arrive at `cardio.heartRate` by the
 * same path and argue, instead of one of them quietly winning because it ran later.
 * The single exception is the bleed, which removes circulating volume and therefore
 * goes through `addVolume` — the same function the instantaneous `HAEMORRHAGE` intent
 * has always used. A second path into blood volume would be a second haemorrhage.
 *
 * ------------------------------------------------------------------------------
 * READ THIS BEFORE BELIEVING THAT MORPHINE RELIEVES PAIN HERE.
 *
 * It does not yet, and the reason is an ordering defect in the engine rather than
 * anything in this file. `Engine.tick` calls `clearEffects(s.effects)` and THEN calls
 * the four step-0 systems, of which this is one, and only after that does it run
 * pharmacodynamics. So every bus target this file reads is guaranteed to be exactly
 * zero at the moment it reads it, however loudly a drug wrote to it a millisecond ago.
 *
 * Measured, not assumed: 8 mg of morphine intravenously puts +1.24 on
 * `neuro.analgesia` by the end of a tick, and `prevEffect(s, 'neuro.analgesia')` returns 0
 * when `stepPathology` asks for it at the start of the next one.
 *
 * The comment in the engine explains that step 0 runs BEFORE pharmacodynamics so that
 * these contributions are on the bus when the drugs push on the same targets in the
 * same tick. That reasoning is correct, and it is about WRITING. Nobody had yet needed
 * to READ a target that is written later in the same tick, and this is the first
 * subsystem that does — three times over: analgesia, inflammation and the febrile set
 * point are all written downstream of here.
 *
 * The code below reads the bus anyway, because reading the bus is the correct thing to
 * do and the fix belongs in the engine rather than in a workaround here. The fix asked
 * for is a one-tick mirror: `clearEffects` copies the accumulator into `s.prevEffects`
 * before zeroing it, and a `prevEffect(s, target)` accessor reads that. Deliberately
 * NOT "move step 0 after pharmacodynamics", which would fix the drugs and leave the
 * hormones broken, because `stepEndocrine` runs later still.
 *
 * Until it lands, the analgesia case in tests/sim/pathology.test.ts is the thing that
 * fails, loudly, with this explanation attached to it.
 * ------------------------------------------------------------------------------
 *
 * NOTHING HERE MODELS INFECTION. Inflammation in this file is the sterile kind: the
 * acute-phase response to tissue injury, which is the same axis a pathogen would drive
 * and is not a pathogen. `immune.inflammation` is read as an INPUT, so anything that
 * later drives that target reaches the fever without this file knowing what it was.
 */

/* ========================================================================== */
/* The data file                                                              */
/* ========================================================================== */

interface SourcedConstant {
  value: number | null;
  unit: string;
  source: string;
  sourceUrl: string;
  confidence: string;
  note: string;
}

interface PathologyFile {
  version: number;
  sources: Record<string, { label: string; url: string }>;
  constants: Record<string, SourcedConstant>;
}

const DATA = pathologyFile as unknown as PathologyFile;

/**
 * Same contract as `P` in `core/constants.ts`, over this subsystem's own data file: a
 * missing or deliberately-null constant throws rather than becoming NaN three systems
 * downstream. It is a separate file and a separate accessor rather than an addition to
 * physiology.json because these constants belong to this subsystem, and one data file
 * that every agent edits is one data file in which every agent's mistakes collide.
 */
function Q(key: string): number {
  const e = DATA.constants[key];
  if (!e) throw new Error(`pathology.json: unknown constant "${key}"`);
  if (e.value === null) {
    throw new Error(
      `pathology.json: constant "${key}" is deliberately null and must not reach the engine. ` +
        `Read its note: ${e.note}`,
    );
  }
  return e.value;
}

/** For the constants allowed to be absent. Absent means "do nothing", never "zero". */
function Qopt(key: string): number | null {
  const e = DATA.constants[key];
  if (!e) throw new Error(`pathology.json: unknown constant "${key}"`);
  return e.value;
}

/* ========================================================================== */
/* Derived gains                                                              */
/* ========================================================================== */

/*
 * EVERY GAIN BELOW IS COMPUTED, NOT TYPED.
 *
 * The literature reports the cold pressor test raising heart rate by about ten beats a
 * minute. What FRACTION of this model's heart rate that is depends on this model's
 * baseline heart rate, which lives in physiology.json with its own citation. Writing
 * 0.14 into a data file would silently freeze a relationship between two numbers that
 * are each free to change, and the day someone re-sourced the baseline the gain would
 * go quietly wrong while every test of the data still passed. So the citation is
 * stored and the fraction is derived — the same argument as ADR-022, which derives the
 * resting state rather than writing down the 66 bpm a debugger happened to show.
 *
 * Computed once at module load. These are pure functions of two data files, and
 * recomputing them a hundred times a second would buy nothing but tick budget spent.
 */

const BASE_TEMP_C = P('thermal.coreTemp_C');
const FEVER_CEILING_C = Q('inflammation.feverCeiling_C');

/** Where on the 0..1 inflammation axis the SIRS temperature criterion falls. */
const SIRS_INFLAMMATION =
  (Q('sirs.temperature_C') - BASE_TEMP_C) / (FEVER_CEILING_C - BASE_TEMP_C);

/** Pain, at pain = 1. */
const PAIN_HEART_RATE_GAIN = Q('pain.heartRateRise_bpm') / P('cardio.heartRateBaseline_bpm');
const PAIN_RESISTANCE_GAIN = Q('pain.meanPressureRise_mmHg') / P('baroreflex.setpoint_mmHg');
const PAIN_DRIVE_GAIN = Q('pain.minuteVentilationRise_fraction');

/**
 * Inflammation, at inflammation = 1.
 *
 * The tachycardia and the respiratory drive are both anchored at SIRS: at the
 * inflammatory load that produces 38.0 C, the model should also be at 90 beats a
 * minute and at a PaCO2 of 32 mmHg, because the syndrome is DEFINED by the conjunction
 * of those findings. Dividing by `SIRS_INFLAMMATION` extrapolates each one linearly to
 * the top of the axis. That is one modelling assumption — linearity — stated once,
 * rather than three separately invented gains.
 */
const INFLAMMATION_HEART_RATE_GAIN =
  (Q('sirs.heartRate_bpm') / P('cardio.heartRateBaseline_bpm') - 1) / SIRS_INFLAMMATION;

/*
 * WHY THE RESPIRATORY GAIN IS DERIVED FROM PaCO2 AND NOT FROM RESPIRATORY RATE.
 *
 * Bone's criteria are an OR: respiratory rate above 20, or PaCO2 below 32. Both
 * describe the same hyperventilation, and only one of them is a thing a drive term
 * controls. Push `resp.drive` and arterial CO2 falls roughly in proportion to alveolar
 * ventilation; respiratory RATE then lands wherever the chemoreflex leaves it after it
 * has finished objecting, because falling CO2 lowers chemoreceptor drive and takes
 * some of the push straight back out again. Fitting the gain to the rate would be
 * fitting it to this model's own buffering rather than to the literature — ADR-020 —
 * and would have produced a much larger number in order to overcome a loop that is
 * behaving entirely correctly. ADR-021 is the same lesson from the other direction.
 *
 * At steady state PaCO2 x alveolar ventilation is a constant for a fixed CO2
 * production, so asking for 32 mmHg instead of 40 asks for 40/32 of the ventilation.
 */
const INFLAMMATION_DRIVE_GAIN =
  (P('resp.paco2_mmHg') / Q('sirs.paco2_mmHg') - 1) / SIRS_INFLAMMATION;

const INFLAMMATION_RESISTANCE_FALL = Q('inflammation.systemicResistanceFall_fraction');
const INFLAMMATION_PERMEABILITY_GAIN = Q('inflammation.capillaryPermeabilityRise_fraction');

/**
 * How much inflammation a sustained maximal nociceptive stimulus eventually produces.
 *
 * Anchored on the ordinary non-infective pyrexia of major surgery: about a degree.
 * nociception = 1 therefore settles the axis at roughly a quarter — which is exactly
 * the SIRS threshold, and it is worth noticing that those two numbers came from two
 * unrelated papers and agree. That agreement is the reason a post-operative patient
 * meets the SIRS criteria on the first day with nothing whatsoever wrong with them.
 */
const INJURY_DRIVE_PER_NOCICEPTION =
  Q('inflammation.majorInjuryFever_C') / (FEVER_CEILING_C - BASE_TEMP_C);

const INFLAMMATION_ONSET_TAU_S = Q('inflammation.onsetTau_min') * 60;
const INFLAMMATION_RESOLUTION_TAU_S = Q('inflammation.resolutionTau_min') * 60;

/** Vertigo. The heart rate term is null on purpose; see the note in the data file. */
const VERTIGO_MOTILITY_FALL = Q('vertigo.gastricMotilityFall_fraction');
const VERTIGO_HEART_RATE_CHANGE = Qopt('vertigo.heartRateChange_fraction');

/* ========================================================================== */
/* Fever                                                                      */
/* ========================================================================== */

/**
 * THE FEVER IS PRODUCED BY THE WRONG MECHANISM, AND THIS IS THE HONEST ACCOUNT OF IT.
 *
 * A fever is a RAISED SET POINT. The hypothalamus decides, under the influence of
 * prostaglandin E2, that 38.5 C is the correct temperature and then defends it with
 * exactly the machinery it uses to defend 37.0 — which is why someone climbing a fever
 * shivers and feels cold, and why the same person sweats when it breaks. `effects.ts`
 * declares a `thermal.setPoint` target for precisely this, and `receptors.json` already
 * has cox2 writing −0.7 to it with the note "Hypothalamic PGE2 sets the febrile
 * temperature; blocking it is exactly what an antipyretic does".
 *
 * Nothing reads it. `stepThermal` in `systems/metabolic.ts` has `const SET_POINT_C =
 * 37.0` written into the body of the function. So the only channel from this file to
 * core temperature is `thermal.heatProduction`, and a fever here is produced by
 * generating more heat against a set point that has not moved — a body that is,
 * thermally speaking, exercising rather than febrile.
 *
 * What that costs, written down so that nobody has to discover it:
 *
 *   1. The febrile body in this model is VASODILATED AND SWEATING while its
 *      temperature climbs, because `stepThermal`'s proportional term reads it as being
 *      above its set point. A real one is vasoconstricted and shivering. The plateau
 *      temperature is right; the route to it is inverted.
 *   2. `thermal.heatProduction` is also read by `metabolicScale` in the respiratory
 *      system, where it means metabolic RATE. Forcing a fever this way therefore also
 *      raises oxygen consumption and CO2 production far more than a real fever of the
 *      same size does. The tachypnoea that follows is right in kind and overstated in
 *      degree.
 *   3. An antipyretic cannot act through its own mechanism. Paracetamol writes to
 *      `thermal.setPoint`, which is read below as a fever MODIFIER so the drug at least
 *      reaches the right output — but that is a patch over a missing wire, not a
 *      mechanism.
 *
 * THE FIX, FOR WHOEVER OWNS `metabolic.ts`: give `stepThermal` an effect-bus set point,
 * move the fever onto `thermal.setPoint`, and delete both the inversion below and the
 * `thermal.setPoint` read in `stepPathology`. Those three are ONE change and must not
 * be made separately, or the fever doubles.
 */
function heatProductionFractionFor(targetC: number): number {
  const k = P('thermal.heatLossCoefficient_W_per_C');
  const ambient = P('thermal.ambientTemp_C');
  const gain = P('thermal.regulatoryGain_per_C');

  // Mirrors stepThermal's own clamp. If the two ever disagree, the inversion stops
  // inverting anything — so it is copied rather than re-chosen.
  const regulatory = (t: number): number =>
    Math.max(0.35, Math.min(2.6, 1 + gain * (t - BASE_TEMP_C)));

  const lossAt = (t: number): number => k * regulatory(t) * (t - ambient);

  // Normalised against the loss at the NORMAL temperature rather than against
  // `thermal.basalHeatProduction_W`. The two are equal today, because the loss
  // coefficient was solved to make them equal — but if either is ever re-sourced,
  // dividing by the basal figure would leave a small non-zero heat production on the
  // bus in a body with no inflammation at all, and the 24-hour homeostasis test would
  // begin failing for a reason that had nothing to do with pathology. This form is
  // exactly zero at the normal temperature whatever the constants say.
  return lossAt(targetC) / lossAt(BASE_TEMP_C) - 1;
}

/* ========================================================================== */

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function stepPathology(s: SimState, dt: number): void {
  const p = s.pathology;

  /* ---------------------------------------------------------------- pain */

  /*
   * NOCICEPTION IS THE STIMULUS; PAIN IS WHAT IS FELT. That distinction is the whole
   * reason this is two fields rather than one.
   *
   * `neuro.analgesia` is read as an absolute fraction of cover, 0..1, in the same way
   * `stepNeuro` reads `neuro.sedation` — not as a fractional modifier of something
   * else. Full mu-opioid occupancy puts 1.0 there, kappa 0.6, delta 0.45, a COX-2
   * inhibitor 0.55, a sodium-channel block 0.4, and they sum. A saturating opioid dose
   * abolishes the pain and leaves the nociception exactly where the user set it, which
   * is what analgesia MEANS and is the single most instructive thing in this file.
   *
   * There is no time constant on this, and that is deliberate. A noxious stimulus is
   * felt when it arrives; the lag a user sees in the vital signs is the baroreflex's
   * seven-second sympathetic delay and the respiratory system's fifteen-second drive
   * lag, both of which already exist, are both cited, and are both the real reason the
   * response is not instantaneous. A third lag here would have been an invented number
   * doing a job two sourced ones were already doing.
   */
  const analgesia = clamp01(prevEffect(s, 'neuro.analgesia'));
  p.pain = clamp01(p.nociception) * (1 - analgesia);

  /*
   * Pain drives sympathetic tone. The pressure limb has to be expressed as a
   * RESISTANCE, because a pressure is not something this bus can carry — and that is
   * the right way round physiologically as well as architecturally, since the cold
   * pressor response is a vasoconstriction rather than a pressure set by decree. The
   * baroreflex then buffers it exactly as it buffers everything else, so the mean
   * pressure that comes out is smaller than the 20 mmHg the source reports in a subject
   * whose baroreflex was also buffering. Those two facts are the same fact.
   */
  if (p.pain > 0) {
    addEffect(s.effects, 'cardio.heartRate', p.pain * PAIN_HEART_RATE_GAIN);
    addEffect(s.effects, 'cardio.systemicResistance', p.pain * PAIN_RESISTANCE_GAIN);
    addEffect(s.effects, 'resp.drive', p.pain * PAIN_DRIVE_GAIN);
  }

  /* -------------------------------------------------------- inflammation */

  /*
   * THE SIRS AXIS.
   *
   * Driven by TISSUE INJURY — for which `nociception` is the proxy — and by whatever
   * else is pushing on `immune.inflammation`. Note carefully which of the two pain
   * fields is used: `nociception`, the stimulus, and NOT `pain`, the sensation.
   * Morphine abolishes the pain of an injury and does not touch the cytokine response
   * to it, and a febrile post-operative patient with excellent analgesia is the
   * ordinary case rather than a paradox. Wiring this to `pain` would have made a
   * syringe of morphine cure the inflammation, which is a lie a user would have had no
   * way of detecting.
   *
   * (A real neuraxial block DOES blunt the surgical stress response, and this model
   * cannot tell a spinal from an intravenous opioid. docs/PATHOLOGY.md records that.)
   *
   * `immune.inflammation` is read bidirectionally. A negative value — glucocorticoids
   * write −0.95 through the receptor, cortisol −0.8 through the endocrine system —
   * scales the whole axis down, which is what a steroid does to the entire response
   * and not only to the fever. A positive value adds to the drive, so anything that
   * later writes to that target arrives here without this file needing to know what it
   * was. Both limbs currently read zero, for the ordering reason at the top of the file.
   */
  const inflammatoryBus = prevEffect(s, 'immune.inflammation');
  const injuryDrive = clamp01(p.nociception) * INJURY_DRIVE_PER_NOCICEPTION;
  const inflammationTarget = clamp01(
    (injuryDrive + Math.max(0, inflammatoryBus)) * (1 + Math.min(0, inflammatoryBus)),
  );

  // Asymmetric, because the acute-phase response rises over hours and resolves over a
  // day or two. One time constant for both directions would let an injury stop having
  // happened within an hour of the stimulus being withdrawn.
  const tau =
    inflammationTarget > p.inflammation ? INFLAMMATION_ONSET_TAU_S : INFLAMMATION_RESOLUTION_TAU_S;
  p.inflammation = clamp01(p.inflammation + ((inflammationTarget - p.inflammation) * dt) / tau);

  if (p.inflammation > 0) {
    /*
     * Fever. `thermal.setPoint` is READ here as an antipyretic modifier rather than
     * written, for the reason set out above `heatProductionFractionFor`: an antipyretic
     * writes a negative value there and nothing in this engine reads it, so without
     * this the drug would visibly do nothing to a fever. Only the negative half is
     * taken — a positive value on that target would mean a raised set point, which IS
     * the fever, and reading it would make the fever drive itself.
     */
    const setPointModifier = 1 + Math.min(0, prevEffect(s, 'thermal.setPoint'));
    const feverFraction = clamp01(p.inflammation * setPointModifier);
    const targetTemp = BASE_TEMP_C + feverFraction * (FEVER_CEILING_C - BASE_TEMP_C);
    addEffect(s.effects, 'thermal.heatProduction', heatProductionFractionFor(targetTemp));

    addEffect(s.effects, 'cardio.heartRate', p.inflammation * INFLAMMATION_HEART_RATE_GAIN);

    // Vasodilation: the falling systemic resistance of a distributive picture. It is
    // the same target pain pushes the other way, which is exactly the point of having a
    // bus — a patient who is both in pain and inflamed gets the sum, and the sum can
    // come out either sign depending on which is winning.
    addEffect(s.effects, 'cardio.systemicResistance', -p.inflammation * INFLAMMATION_RESISTANCE_FALL);

    // The hyperventilation of a systemic inflammatory response: hypocapnia out of
    // proportion to the metabolic rate, which is what makes it a respiratory alkalosis
    // rather than a compensation for anything.
    addEffect(s.effects, 'resp.drive', p.inflammation * INFLAMMATION_DRIVE_GAIN);

    /*
     * CAPILLARY LEAK, AND IT CURRENTLY DOES NOTHING. `vascular.permeability` is a
     * declared effect target with no consumer anywhere in `src/sim/systems/`, so this
     * line puts a correctly sized, correctly signed number on the bus and the body does
     * not move. That is deliberate, and `effects.ts` argues for it at length: a target
     * with no consumer is inert and costs nothing, while the alternative — approximating
     * capillary leak onto some target that IS read, or pulling volume out of the
     * circulation by hand — would be a second fluid model standing next to the one in
     * `fluids.ts`.
     *
     * Making it live is a change to `stepFluids`, where the transcapillary flux is
     * already a first-order return toward a fixed plasma target: a leak is that same
     * gradient driven the other way. It is named in docs/PATHOLOGY.md as the one thing
     * this subsystem claims and does not deliver.
     */
    addEffect(s.effects, 'vascular.permeability', p.inflammation * INFLAMMATION_PERMEABILITY_GAIN);
  }

  /* --------------------------------------------------------- haemorrhage */

  /*
   * A RATE, not an event. `HAEMORRHAGE` removes a stated volume once; this bleeds until
   * it is told to stop, which is the difference between a laceration and a venesection.
   *
   * There is nothing else here, on purpose. The response to blood loss — the baroreflex
   * tachycardia, the transcapillary refill from the interstitium over Lundvall's thirty
   * minutes, the lactate rise as oxygen delivery falls below its critical threshold — is
   * already modelled, and re-implementing any of it here would give one question two
   * answers. This block's entire job is to take the volume away and let the rest of the
   * engine find out about it.
   *
   * The amount lost is measured from what `addVolume` actually did rather than from what
   * was asked for, because `addVolume` floors the venous compartment: at the end of an
   * exsanguination the requested rate and the delivered rate stop agreeing, and
   * `bloodLost_mL` should report blood that was really lost.
   */
  if (p.bleedRate_mL_per_min > 0) {
    const before = s.cardio.veins.V;
    addVolume(s.cardio, -(p.bleedRate_mL_per_min * dt) / 60);
    p.bloodLost_mL += before - s.cardio.veins.V;
  }

  /* ------------------------------------------------------------- vertigo */

  /*
   * THE THINNEST OF THE FOUR, AND IT SHOULD BE READ THAT WAY.
   *
   * A vestibular disturbance in this model is a gastric stasis and a nausea flag. That
   * is all of it. It does not make the room spin, because nothing in this simulation has
   * an orientation. It does not make the patient fall over, because there is no posture.
   * It does not make them vomit, because `gi.emesis` has no consumer and the gut model
   * has no reverse gear. It does not make them sweat, because there is no bus target for
   * skin blood flow or sweating, and inventing one to carry a single symptom would be
   * worse than the absence.
   *
   * What it does do is real: vestibular and visually induced nausea replaces the normal
   * three-per-minute gastric slow wave with tachygastria and abolishes antral
   * contractility, and a tablet swallowed by a seasick person is absorbed late because
   * of it. That is measurable here, through `gi.motility`, and it is the only thing a
   * user should conclude from this slider.
   *
   * The bradycardia is NOT MODELLED AT ALL, and the null in the data file is the
   * statement of why: the autonomic response to vestibular provocation is biphasic —
   * heart rate up during the provocation, then a vagal collapse at the point of emesis —
   * and no single fractional gain is right for both halves. Choosing one would have been
   * wrong half the time, and would have looked modelled.
   */
  if (p.vertigo > 0) {
    // No scaling constant, because there is nothing to scale against: `gi.nausea` has no
    // consumer, so in practice it has no units. Vertigo writes its own magnitude, and
    // the day something reads it, that reader decides what the number means.
    addEffect(s.effects, 'gi.nausea', clamp01(p.vertigo));
    addEffect(s.effects, 'gi.motility', -clamp01(p.vertigo) * VERTIGO_MOTILITY_FALL);

    if (VERTIGO_HEART_RATE_CHANGE !== null) {
      addEffect(s.effects, 'cardio.heartRate', clamp01(p.vertigo) * VERTIGO_HEART_RATE_CHANGE);
    }
  }
}

/**
 * The calibration landmarks, exported for the tests that assert this subsystem against
 * the literature rather than against itself (ADR-020).
 *
 * Not read by the engine. `sirsInflammation` is the one number a reader of
 * docs/PATHOLOGY.md most often wants: where on the 0..1 axis the model begins to meet a
 * published definition. It is a derived quantity rather than a chosen one, which is the
 * whole reason it is worth printing.
 */
export const PATHOLOGY_CALIBRATION = {
  sirsInflammation: SIRS_INFLAMMATION,
  injuryDrivePerNociception: INJURY_DRIVE_PER_NOCICEPTION,
  painHeartRateGain: PAIN_HEART_RATE_GAIN,
  painResistanceGain: PAIN_RESISTANCE_GAIN,
  painDriveGain: PAIN_DRIVE_GAIN,
  inflammationHeartRateGain: INFLAMMATION_HEART_RATE_GAIN,
  inflammationDriveGain: INFLAMMATION_DRIVE_GAIN,
  inflammationResistanceFall: INFLAMMATION_RESISTANCE_FALL,
  feverCeiling_C: FEVER_CEILING_C,
  heatProductionFractionFor,
} as const;
