/**
 * THE INERT-DRUG SWEEP.
 *
 * `tests/sim/integrity.test.ts` asserts that every drug has SOME mechanism — a receptor
 * target, a direct effect, a Pulse block or a payload. That is a check on the data, and
 * it is not the same question as whether the drug DOES anything, which is the question a
 * user asks by pressing the button.
 *
 * Two bugs got through the data check by being true at the level of data and false at the
 * level of behaviour. Midazolam had a Pulse block with a perfectly good respiratory
 * modifier that landed downstream of the chemoreflex, so the loop cancelled it exactly and
 * 2 mg produced a trace byte-identical to giving nothing. Propofol had a Pulse block that
 * set its respiratory modifier POSITIVE, so an induction agent made the patient breathe
 * faster. In both cases every field was populated, every citation resolved, and the drug
 * did nothing or the opposite of the right thing.
 *
 * So this gives each drug its own first declared preset, runs it, and measures whether any
 * vital sign moved against a no-drug control. It is deliberately a TOOL rather than a test:
 * a run per drug at fifteen simulated minutes is minutes of wall clock, which belongs in a
 * command you invoke when you have changed the pharmacology, not in the suite you run on
 * every save.
 *
 * Run it with:  npx vite-node tests/sim/inert-sweep.ts
 *
 * TWO CHECKS, AND WHY THE SECOND EXISTS. The sweep first asks whether every drug's first
 * preset was ACCEPTED at all, because the engine silently refuses any dose that is not a
 * declared preset and a refused dose looks exactly like a broken drug (CLAUDE.md lists it
 * among the traps that have fooled several people). Only then does it ask whether the
 * accepted dose moved a PHYSIOLOGICAL readout. The "moved" ranking used to take the maximum
 * over every signal the file samples, which let a gut-timing artefact (glucose absorption
 * from the shared meal, 100 % different the moment any drug nudged gastric emptying) count
 * as a drug that "moved" something, and so hid drugs that move nothing a body would show.
 * The ranking is now restricted to PHYSIOLOGICAL below; the other signals are still
 * sampled, because they are what you want when you go looking for why.
 *
 * It lives under tests/ rather than tools/ because tools/ is a separate TypeScript
 * project that deliberately sees only the DATA types from src, not the simulation
 * itself. Widening it so a script could import the Engine would blur a layer boundary
 * the build enforces on purpose. The name has no `.test.` in it, so vitest does not
 * collect it - this is a command you run, not a test that runs you.
 *
 * READ A PASS AS SCEPTICALLY AS A FAILURE. Excluding the dose vehicle from the ranking
 * fixed the worst of it, but a slow oral drug can still clear the threshold on
 * `gastricPh` alone at around 1.5%, which is the swallow of water it arrived in rather
 * than anything pharmacological. Amlodipine, hydrochlorothiazide, ferrous sulfate and
 * allopurinol all sit there, and all of them genuinely do very little in fifteen
 * simulated minutes - which is correct, not a bug. The sweep answers "did anything at
 * all happen", not "did the right thing happen"; the second question is what the tests
 * in tests/sim/integrity.test.ts are for.
 *
 * The noise floor is zero, and that is worth knowing when reading a small number here.
 * Two baseline runs on different seeds diverge by 0.00% on every signal, because the
 * resting state is shared and settled and the baseline has no stochastic term. So a 5%
 * reading is a real 5%, not a run-to-run wobble.
 *
 * A drug reported here is not necessarily broken. Some are genuinely slow (levothyroxine
 * does nothing measurable in fifteen minutes and should not), some act on things no vital
 * sign shows, and some are given by routes that take an hour to absorb. The output is a
 * list to explain, not a list to fix — but every entry should have an explanation, and
 * "nobody ever checked" is not one.
 */

import { Engine } from '../../src/sim/core/engine';
import { P } from '../../src/sim/core/constants';
import drugsFile from '../../src/data/drugs.json';
import type { DrugsFile } from '../../src/data/pharma-types';
import type { SimSnapshot } from '../../src/bridge/types';

const DRUGS = (drugsFile as unknown as DrugsFile).drugs;
const DT = P('sim.dt_s');
const MINUTES = 15;

/** The signals a user can actually see move. */
function vitals(s: SimSnapshot): Record<string, number> {
  return {
    hr: s.cardio.heartRate_bpm,
    map: s.cardio.map_mmHg,
    sbp: s.cardio.systolic_mmHg,
    co: s.cardio.cardiacOutput_L_per_min,
    rr: s.resp.rate_per_min,
    spo2: s.resp.spo2,
    paco2: s.resp.paco2_mmHg,
    vt: s.resp.tidalVolume_mL,
    temp: s.metabolic.coreTemp_C,
    glucose: s.metabolic.glucose_mg_per_dL,
    consciousness: s.neuro.consciousness,
    urine: s.renal.urineOutput_mL_per_min,
    // ADDED AFTER THE FIRST RUN, WHICH REPORTED FOURTEEN INERT DRUGS AND WAS WRONG
    // ABOUT AT LEAST THREE OF THEM. Potassium chloride moves serum potassium, calcium
    // chloride moves ionised calcium, omeprazole and famotidine move gastric pH - and
    // the first version measured none of those, so it reported an electrolyte as doing
    // nothing while a direct probe showed 1 g of calcium chloride taking ionised
    // calcium from 1.20 to 2.03 mmol/L.
    //
    // A sweep that hunts for silence has to be able to hear the thing it is listening
    // for. Anything it cannot measure it reports as inert, and a false alarm here costs
    // more time than the bug it was looking for - it sends you into the pharmacology
    // looking for a fault that is in the instrument.
    na: s.chem.na_mEq_per_L,
    k: s.chem.k_mEq_per_L,
    ca: s.chem.caIonised_mmol_per_L,
    cl: s.chem.cl_mEq_per_L,
    hco3: s.chem.hco3_mEq_per_L,
    ph: s.chem.ph,
    lactate: s.chem.lactate_mmol_per_L,
    gastricPh: s.gi.gastricPh,
    gastricVolume: s.gi.gastricVolume_mL,
    glucoseAbsorption: s.gi.glucoseAbsorption_mg_per_min,
    insulin: s.metabolic.insulin_uU_per_mL,
    sedation: s.neuro.sedationLevel,
    cbf: s.neuro.cerebralBloodFlow_mL_per_min,
    inr: s.coagulation.inr,
    aptt: s.coagulation.aptt_s,
    osmolality: s.fluids.osmolality_mOsm_per_kg,
  };
}

interface Run {
  samples: Record<string, number>[];
  /** The named drug entered the body at some point: a pharmacokinetic record with a plasma
   *  concentration, a pending payload (fluids and electrolytes never reach a plasma level in
   *  the same way) or a cumulative dose. False means the engine refused the dose. */
  entered: boolean;
  /** Text of any refusal notice raised during the run. */
  refusal: string | null;
}

function runOne(intents: { at: number; intent: unknown }[], drugId?: string): Run {
  const engine = new Engine(0x5eed);
  const steps = Math.round(MINUTES * 60 / DT);
  const sampleStride = Math.round(10 / DT);
  const out: Record<string, number>[] = [];
  let entered = false;
  const pending = [...intents];
  let cursor = 0;
  for (let i = 0; i < steps; i++) {
    const t = i * DT;
    while (cursor < pending.length && pending[cursor].at <= t) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      engine.applyIntent(pending[cursor].intent as any);
      cursor++;
    }
    engine.tick(DT);
    engine.pending.length = 0;
    if (drugId && !entered) {
      const st = engine.state.drugs.find((d) => d.drugId === drugId);
      if (st && (st.cp > 0 || st.payloadPending > 0 || st.payloadRate > 0 || st.cumulativeDose > 0)) entered = true;
    }
    if (i % sampleStride === 0) out.push(vitals(engine.snapshot()));
  }
  const refusal = engine.snapshot().notices.find((n) => /refus|declin|not a declared|cannot/i.test(n.text))?.text ?? null;
  return { samples: out, entered, refusal };
}

/**
 * Signals that move for reasons that are not the drug working.
 *
 * `gastricVolume` is the DOSE VEHICLE. Every oral tablet puts a swallow of water in a
 * stomach the control run left empty, so it diverges by 100% whether or not the drug
 * does anything at all - and because this function reports the LARGEST divergence, it
 * reported that 100% for most oral drugs and hid whatever else did or did not happen.
 * That is a false negative, and a false negative is worse here than a false positive:
 * a sweep that hunts for silence and reports "everything is fine" because the water
 * moved has stopped doing its job.
 */
const NOT_A_DRUG_EFFECT = new Set(['gastricVolume']);

/**
 * The readouts a body would actually show: vitals, clotting times, the main electrolytes,
 * glucose, osmolality and pH. The "moved" verdict is decided on these ONLY. Gut-timing
 * signals (gastric volume and pH, glucose absorption), insulin and the sedation index are
 * sampled but not ranked: glucose absorption from the shared test meal swings by 100 %
 * whenever a drug shifts gastric emptying by a hair, which is a timing artefact and not a
 * physiological effect. The membership is a measuring choice, not a physiological claim.
 */
const PHYSIOLOGICAL = new Set([
  'hr', 'map', 'sbp', 'co', 'rr', 'spo2', 'paco2', 'vt', 'temp', 'glucose', 'consciousness',
  'urine', 'na', 'k', 'ca', 'cl', 'hco3', 'ph', 'lactate', 'cbf', 'inr', 'aptt', 'osmolality',
]);

/**
 * Largest fractional excursion of any signal, drug run against control run.
 *
 * The denominator is max(|control|, |test|) rather than |control|, which bounds the
 * result at 1 and makes it readable. Dividing by the control alone produced figures
 * like "carbamazepine 11572238.2% sedation" - true in the sense that sedation went
 * from about zero to not-about-zero, and useless as a number. Bounded, the same
 * result reads 100%, which is what it means.
 */
function biggestDivergence(
  control: Record<string, number>[],
  test: Record<string, number>[],
): { signal: string; fraction: number } {
  let best = { signal: 'none', fraction: 0 };
  const keys = Object.keys(control[0]).filter((k) => PHYSIOLOGICAL.has(k) && !NOT_A_DRUG_EFFECT.has(k));
  for (const k of keys) {
    for (let i = 0; i < Math.min(control.length, test.length); i++) {
      const c = control[i][k];
      const t = test[i][k];
      if (!Number.isFinite(c) || !Number.isFinite(t)) continue;
      const scale = Math.max(Math.abs(c), Math.abs(t), 1e-9);
      const frac = Math.abs(t - c) / scale;
      if (frac > best.fraction) best = { signal: k, fraction: frac };
    }
  }
  return best;
}

const IV_ACCESS = { at: 0, intent: { type: 'IV_ACCESS', on: true } };

/**
 * A meal, in the control run and every drug run alike.
 *
 * Without it the stomach is empty, and a drug whose only action is on gut motility has
 * nothing to act on: ondansetron and metoclopramide both measured 0.000% and looked
 * inert when they were merely unobserved. Giving every run the same meal cancels out of
 * the comparison for drugs that do not touch the gut, and gives the ones that do
 * something to move.
 */
const MEAL = { at: 5, intent: { type: 'EAT', foodId: 'glucose_drink', portions: 1 } };
/** Below this, nothing a user could see has changed. */
const THRESHOLD = 0.01;

function main(): void {
  // An optional list of drug ids on the command line re-checks just those, which is
  // what you want after widening the measured signals rather than paying for all 89
  // again.
  const only = new Set(process.argv.slice(2).filter((a) => !a.startsWith('-')));
  const subject = only.size > 0 ? DRUGS.filter((d) => only.has(d.id)) : DRUGS;
  process.stdout.write(`Inert-drug sweep: ${subject.length} drugs, ${MINUTES} simulated minutes each.\n\n`);
  const control = runOne([IV_ACCESS, MEAL]).samples;

  const inert: string[] = [];
  const noPreset: string[] = [];
  const refused: string[] = [];
  let moved = 0;

  for (const d of subject) {
    const preset = d.presetDoses[0];
    if (!preset) {
      noPreset.push(d.id);
      continue;
    }
    const run = runOne([
      IV_ACCESS,
      MEAL,
      {
        at: 10,
        intent: {
          type: 'ADMINISTER',
          drugId: d.id,
          route: preset.route,
          dose: preset.amount,
          unit: preset.unit,
          label: preset.label,
        },
      },
    ], d.id);
    const samples = run.samples;
    if (!run.entered) {
      // Not measured further: a drug that never entered the body says nothing about its
      // pharmacology, and reporting it as "inert" would send the reader to the wrong place.
      refused.push(`${d.id.padEnd(22)} ${preset.label} ${preset.route}${run.refusal ? ` - ${run.refusal}` : ''}`);
      continue;
    }
    const best = biggestDivergence(control, samples);
    if (best.fraction < THRESHOLD) {
      inert.push(`${d.id.padEnd(22)} ${preset.label} ${preset.route} - largest change ${(best.fraction * 100).toFixed(3)}% (${best.signal})`);
    } else {
      moved++;
      process.stdout.write(
        `  ${d.id.padEnd(22)} ${(best.fraction * 100).toFixed(1).padStart(7)}%  ${best.signal}\n`,
      );
    }
  }

  process.stdout.write(`\n${moved}/${subject.length} drugs moved a physiological readout by more than ${THRESHOLD * 100}%.\n`);

  if (refused.length > 0) {
    process.stdout.write(`\nDOSE NEVER ENTERED THE BODY (refused, or no pharmacokinetic record) - fix the preset before reading anything else:\n`);
    for (const line of refused) process.stdout.write(`  ${line}\n`);
  } else {
    process.stdout.write('\nEvery first preset was accepted.\n');
  }

  if (noPreset.length > 0) {
    process.stdout.write(`\nNo declared preset (cannot be given at all): ${noPreset.join(', ')}\n`);
  }
  if (inert.length > 0) {
    process.stdout.write(`\nMOVED NO PHYSIOLOGICAL READOUT - each of these needs an explanation:\n`);
    for (const line of inert) process.stdout.write(`  ${line}\n`);
  } else {
    process.stdout.write('\nEvery accepted drug moved a physiological readout.\n');
  }
}

main();
