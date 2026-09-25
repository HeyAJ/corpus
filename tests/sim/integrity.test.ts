import { describe, expect, it } from 'vitest';
import { run, type ScheduledIntent, DT } from './harness';
import { Engine } from '../../src/sim/core/engine';
import drugsFile from '../../src/data/drugs.json';
import foodsFile from '../../src/data/foods.json';
import type { DrugsFile } from '../../src/data/pharma-types';
import type { SimIntent, SimSnapshot } from '../../src/bridge/types';
import { toMilligrams, isMassUnit } from '../../src/sim/pharma/units';
import { routeSpec, depotParamsFor, ROUTE_IDS } from '../../src/sim/pharma/routes';
import { PATHOGENS } from '../../src/sim/systems/infection';
import { P } from '../../src/sim/core/constants';

/**
 * INTEGRITY SWEEP.
 *
 * Six bugs were found while building the expanded model, and every one of them was of
 * a kind that types and lint cannot catch:
 *
 *   1. a circular import that typechecked cleanly and threw at runtime
 *   2. a switch with no case for half its inputs, silently falling to a default
 *   3. an alias that never matched because of HTML-entity decoding
 *   4. a unit conversion applied in one place and forgotten in another
 *   5. a compartment that was never created, so absorbed mass went nowhere
 *   6. a test whose assertion did not follow from the arithmetic
 *
 * What they share is that nothing was *wrong* — a number was quietly zero, a category
 * was quietly "other", a drug was quietly absent. Silence is the failure mode, so this
 * file goes looking for silence: values that should be non-zero and are not, paths that
 * should be reachable and are not, invariants that should hold everywhere.
 *
 * It is deliberately broad rather than deep. Each individual assertion is cheap; what
 * makes it useful is running all of them over every drug, every route and every food.
 */

const DRUGS = (drugsFile as unknown as DrugsFile).drugs;
const FOODS = (foodsFile as unknown as { foods: { id: string; carb_g: number; alcohol_g?: number; caffeine_mg?: number }[] }).foods;

const IV: ScheduledIntent = { at: 0, intent: { type: 'IV_ACCESS', on: true } };

/** Walks a snapshot and returns the path of the first non-finite number it finds. */
function findNonFinite(value: unknown, path = ''): string | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? null : path || '(root)';
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findNonFinite(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const hit = findNonFinite(v, path ? `${path}.${k}` : k);
      if (hit) return hit;
    }
  }
  return null;
}

describe('no NaN ever reaches a snapshot', () => {
  /**
   * A NaN in the state vector is the worst failure this model can have: it propagates
   * silently through every subsequent tick, and by the time a readout shows an
   * em-dash the cause is thousands of ticks in the past. Cheap to check, so check it
   * everywhere.
   */
  it('stays finite through a resting hour', () => {
    const s = run({ seconds: 3600, sampleEvery: 30 });
    for (const sample of s.samples) {
      expect(findNonFinite(sample), `at t=${sample.t}`).toBeNull();
    }
  });

  it('stays finite through an arrest and a resuscitation', () => {
    const s = run({
      seconds: 900,
      sampleEvery: 10,
      intents: [
        IV,
        { at: 30, intent: { type: 'FORCE_RHYTHM', rhythm: 'vfib' } },
        { at: 60, intent: { type: 'PLACE_PADS' } },
        { at: 70, intent: { type: 'CHARGE_DEFIB', joules: 200 } },
        { at: 75, intent: { type: 'DEFIBRILLATE' } },
        { at: 90, intent: { type: 'FORCE_RHYTHM', rhythm: 'nsr' } },
      ],
    });
    for (const sample of s.samples) {
      expect(findNonFinite(sample), `at t=${sample.t}`).toBeNull();
    }
  });

  it('refuses an intent carrying a NaN instead of letting it poison the body', () => {
    // Twelve intents once accepted NaN and six of them turned the heart rate itself into
    // NaN within a second, for ever. Each is sent here with every numeric field NaN, into
    // a separate body, and the body must stay finite and say that it refused.
    const poisoned: SimIntent[] = [
      { type: 'HAEMORRHAGE', volume_mL: Number.NaN },
      { type: 'SET_EXERTION', level: Number.NaN },
      { type: 'FRIGHTEN', intensity: Number.NaN },
      { type: 'SET_AFFECT', stress: Number.NaN, depression: Number.NaN },
      { type: 'SET_BRONCHOSPASM', level: Number.NaN },
      { type: 'ALLERGEN_EXPOSURE', severity: Number.NaN },
      { type: 'SET_PAIN', level: Number.NaN },
      { type: 'SET_BLEED', rate_mL_per_min: Number.NaN },
      { type: 'SET_VERTIGO', level: Number.NaN },
      { type: 'EAT', foodId: 'white_rice', portions: Number.NaN },
      { type: 'DRINK_WATER', volume_mL: Number.POSITIVE_INFINITY },
      { type: 'INOCULATE', pathogenId: 'e_coli', dose_log10: Number.NaN },
      { type: 'CHARGE_DEFIB', joules: Number.NaN },
    ];
    for (const intent of poisoned) {
      const e = new Engine(0x5eed);
      e.applyIntent(intent);
      for (let i = 0; i < 300; i++) {
        e.tick(DT);
        e.pending.length = 0;
      }
      const snap = e.snapshot();
      expect(findNonFinite(snap), intent.type).toBeNull();
      expect(snap.notices.some((n) => n.text.startsWith(`${intent.type} refused`)), intent.type).toBe(true);
    }
  });

  it('stays finite when every hormone is pushed by a haemorrhage', () => {
    const s = run({
      seconds: 1800,
      sampleEvery: 30,
      intents: [{ at: 60, intent: { type: 'HAEMORRHAGE', volume_mL: 1500 } }],
    });
    for (const sample of s.samples) {
      expect(findNonFinite(sample), `at t=${sample.t}`).toBeNull();
    }
  });
});

describe('every drug is reachable by every route it declares', () => {
  /**
   * THE BUG THIS EXISTS FOR: a drug that declares a route but cannot actually be given
   * by it produces a button that silently does nothing. That happened twice — once
   * because no absorption constant existed to scale, and once because no compartment
   * was ever created.
   *
   * A route that is genuinely unsimulatable must be REFUSED at the manifest level, not
   * accepted and then ignored.
   */
  it('has a usable absorption path for every depot route it offers', () => {
    const broken: string[] = [];
    for (const d of DRUGS) {
      for (const route of d.routes) {
        const spec = routeSpec(route);
        if (spec.kind !== 'depot') continue;
        if (depotParamsFor(d, route) === null) {
          broken.push(`${d.id} declares ${route} but has no absorption rate to scale`);
        }
      }
    }
    expect(broken.join('\n')).toBe('');
  });

  it('declares a preset for every route it offers', () => {
    const missing: string[] = [];
    for (const d of DRUGS) {
      for (const route of d.routes) {
        if (!d.presetDoses.some((p) => p.route === route)) {
          missing.push(`${d.id} declares route ${route} with no preset dose`);
        }
      }
    }
    expect(missing.join('\n')).toBe('');
  });

  it('names only routes that exist in the route table', () => {
    const unknown: string[] = [];
    for (const d of DRUGS) {
      for (const route of d.routes) {
        if (!ROUTE_IDS.includes(route)) unknown.push(`${d.id}: ${route}`);
      }
    }
    expect(unknown.join('\n')).toBe('');
  });
});

describe('unit handling is consistent wherever a dose becomes a concentration', () => {
  /**
   * THE BUG THIS EXISTS FOR: the transport deriver computed a reference concentration
   * from a raw preset amount without converting to milligrams, so every microgram-dosed
   * drug had a marker pinned at zero. The conversion now lives in one module; this
   * checks that the module is actually right, and that nothing declares a dose in a
   * unit the model cannot interpret.
   */
  it('converts every unit the manifest actually uses', () => {
    const units = new Set(DRUGS.flatMap((d) => d.presetDoses.map((p) => p.unit)));
    const known = new Set(['mg', 'mcg', 'ug', 'g', 'mEq', 'mmol', 'mL', 'unit']);
    for (const u of units) {
      expect(known.has(u), `unit "${u}" is used by a preset but is not handled`).toBe(true);
    }
  });

  it('agrees with itself on the obvious cases', () => {
    expect(toMilligrams(1, 'g')).toBe(1000);
    expect(toMilligrams(1000, 'mcg')).toBe(1);
    expect(toMilligrams(1, 'mg')).toBe(1);
    // A volume is not a mass and must not pretend to be one.
    expect(isMassUnit('mL')).toBe(false);
    expect(isMassUnit('mEq')).toBe(false);
    expect(isMassUnit('mcg')).toBe(true);
  });

  it('gives every mass-dosed simulatable drug a usable transport reference', () => {
    // The marker's full scale is derived from the first mass-unit preset over V1.
    // A drug where that comes out as zero or non-finite has a marker that can never
    // move, which is exactly the failure that hid fentanyl.
    const broken: string[] = [];
    for (const d of DRUGS) {
      const v1 = d.pk.V1_L;
      if (v1 === null || v1 <= 0) continue;
      const ref = d.presetDoses.find((p) => isMassUnit(p.unit));
      if (!ref) continue;
      const cp = toMilligrams(ref.amount, ref.unit) / v1;
      if (!(cp > 0) || !Number.isFinite(cp)) broken.push(`${d.id}: reference concentration ${cp}`);
    }
    expect(broken.join('\n')).toBe('');
  });
});

describe('the data has no silent categories', () => {
  /**
   * THE BUG THIS EXISTS FOR: the drawer derived its grouping from a switch that had no
   * case for most drug classes, so eighty of eighty-nine drugs fell through to "Other"
   * and nobody noticed because "Other" is a valid-looking answer.
   */
  it('gives every drug a drawer group that is not a fallback', () => {
    const ungrouped = DRUGS.filter((d) => !d.drawerGroup || d.drawerGroup === 'Other');
    // "Other" is allowed to exist, but it must be a deliberate choice for a handful,
    // not the destination for most of the set.
    expect(ungrouped.length, `drugs falling to Other: ${ungrouped.map((d) => d.id).join(', ')}`)
      .toBeLessThan(DRUGS.length * 0.15);
  });

  it('gives every controlled substance the note that explains why it is modelled', () => {
    for (const d of DRUGS.filter((x) => x.scheduled)) {
      expect(d.scheduleNote, `${d.id} is scheduled with no scheduleNote`).toBeTruthy();
      expect((d.scheduleNote ?? '').length, d.id).toBeGreaterThan(80);
    }
  });

  it('gives every drug SOME mechanism, so no button does nothing', () => {
    // A drug reaches physiology by one of four routes, and a drug with none of them is
    // a button that does nothing — worse than an absent one, because it looks like it
    // worked.
    //
    // `pulsePd` belongs in this list and was missing from the first version of this
    // test, which reported propofol and midazolam as inert when both work perfectly
    // well through the Pulse concentration-effect block. The test was wrong; the
    // drugs were fine. What WAS wrong was their targetsNote, which claimed direct
    // effects they did not have.
    //
    // Two more routes arrived with the 2026-09-24 drugs, and this test reported fourteen
    // of them as inert until it learned about them - the same mistake as pulsePd, made
    // again. Insulin joins the body's own insulin pool (`hormoneAnalogue`, read by
    // endocrine.ts), and an antibiotic or antiviral acts on a PATHOGEN rather than on a
    // receptor (`antimicrobial`, read by infection.ts). Neither touches a healthy,
    // uninfected body's vitals directly, which is correct and is not inertness.
    const inert = DRUGS.filter(
      (d) =>
        d.targets.length === 0 &&
        d.directEffects.length === 0 &&
        d.pulsePd === null &&
        !d.payload &&
        !d.hormoneAnalogue &&
        !d.antimicrobial,
    );
    expect(inert.map((d) => d.id).join(', ')).toBe('');
  });

  it('points every antimicrobial at a pathogen the body can actually carry', () => {
    // An antimicrobial whose spectrum names only pathogens that are not in
    // pathogens.json is inert by a longer road: the kill term is summed over the
    // infections present, and it can never be present. So the spectrum has to resolve.
    const known = new Set(PATHOGENS.map((p) => p.id));
    const orphaned = DRUGS.filter((d) => d.antimicrobial).flatMap((d) =>
      d.antimicrobial!.spectrum.filter((x) => !known.has(x.pathogenId)).map((x) => `${d.id}->${x.pathogenId}`),
    );
    expect(orphaned.join(', ')).toBe('');
    // And every spectrum entry needs a finite, positive MIC, or the Emax term divides
    // by zero or never engages.
    const badMic = DRUGS.filter((d) => d.antimicrobial).flatMap((d) =>
      d.antimicrobial!.spectrum.filter((x) => !(x.mic_mg_per_L > 0 && Number.isFinite(x.mic_mg_per_L))).map((x) => `${d.id}->${x.pathogenId}`),
    );
    expect(badMic.join(', ')).toBe('');
  });

  it('actually depresses respiration for every drug that should', () => {
    // Not a data check - a behavioural one, and the test that found the worst bug in
    // the pharmacology layer.
    //
    // Three drugs here depress breathing by three different mechanisms: fentanyl
    // through mu-opioid occupancy, propofol through a cited direct effect, midazolam
    // through the Pulse concentration-effect block. The Pulse path was landing on
    // `resp.rate`, which is applied DOWNSTREAM of the chemoreceptor loop, so the loop
    // cancelled it exactly: 2 mg of midazolam produced a respiratory trace byte-for-byte
    // identical to giving nothing, with the modifier sitting uselessly on the bus.
    // See src/sim/pharma/pulsepd.ts for the fix.
    //
    // MEASURED AGAINST A NO-DRUG CONTROL, not against a fixed fraction of the resting
    // rate. Breathing has a natural ripple of a few per cent, so a bare threshold is
    // either loose enough to miss a real effect or tight enough to fail on noise. The
    // control run is the noise floor, and it costs one more run to be sure.
    const control = run({ seconds: 25 * 60, sampleEvery: 10, intents: [IV] });
    const floorRate = Math.min(...control.samples.map((x) => x.resp.rate_per_min));
    const floorCo2 = control.final.resp.paco2_mmHg;

    const depressants: [string, number, string, string][] = [
      ['fentanyl', 100, 'mcg', '100 mcg'],
      ['propofol', 140, 'mg', '2 mg/kg induction'],
      ['midazolam', 2, 'mg', '2 mg'],
    ];

    for (const [drugId, dose, unit, label] of depressants) {
      const s = run({
        seconds: 25 * 60,
        sampleEvery: 10,
        intents: [
          IV,
          { at: 10, intent: { type: 'ADMINISTER', drugId, route: 'IV_PUSH', dose, unit, label } },
        ],
      });
      const lowest = Math.min(...s.samples.map((x) => x.resp.rate_per_min));
      expect(lowest, `${drugId} did not depress the respiratory rate`).toBeLessThan(floorRate);

      // The rate recovers as the chemoreflex compensates - it must, because at steady
      // state ventilation has to clear the CO2 the body is producing. What does NOT
      // recover is the PaCO2 it has to run at to do so, and that hypercapnia is the
      // real signature of opioid and benzodiazepine respiratory depression.
      expect(s.final.resp.paco2_mmHg, `${drugId} did not raise PaCO2`).toBeGreaterThan(floorCo2);
    }
  });

  it('makes a sedative and an opioid together worse than either alone', () => {
    // THE INTERACTION THAT KILLS PEOPLE, and the strongest argument for putting every
    // drug on one shared effect bus.
    //
    // Midazolam reaches respiratory drive through the Pulse block and fentanyl reaches
    // it through mu-opioid occupancy. Neither knows the other exists. They compose
    // because they arrive at the same place, which is what happens in a body and is not
    // something either drug's own data records.
    const give = (drugId: string, dose: number, unit: string, label: string): ScheduledIntent => ({
      at: 10,
      intent: { type: 'ADMINISTER', drugId, route: 'IV_PUSH', dose, unit, label },
    });

    const midaz = give('midazolam', 2, 'mg', '2 mg');
    const fent = give('fentanyl', 100, 'mcg', '100 mcg');

    const measure = (intents: ScheduledIntent[]) => {
      const s = run({ seconds: 25 * 60, sampleEvery: 10, intents });
      return {
        lowestRate: Math.min(...s.samples.map((x) => x.resp.rate_per_min)),
        co2: s.final.resp.paco2_mmHg,
      };
    };

    const alone1 = measure([IV, midaz]);
    const alone2 = measure([IV, fent]);
    const together = measure([IV, midaz, fent]);

    expect(together.lowestRate, 'the pair should breathe worse than midazolam alone').toBeLessThan(alone1.lowestRate);
    expect(together.lowestRate, 'the pair should breathe worse than fentanyl alone').toBeLessThan(alone2.lowestRate);
    expect(together.co2, 'the pair should retain more CO2 than midazolam alone').toBeGreaterThan(alone1.co2);
    expect(together.co2, 'the pair should retain more CO2 than fentanyl alone').toBeGreaterThan(alone2.co2);
  });
});

describe('the body starts at rest', () => {
  it('boots into its own equilibrium instead of ringing into a false bradycardia', () => {
    // The eighth bug, and the one every single user would have seen.
    //
    // The initial state was a plausible resting body - 72 bpm, 92 mmHg, both reflex
    // limbs at 0.5 - but not THIS model's equilibrium. The baroreflex afferent is a
    // sigmoid, so a pulsating pressure does not average to the sigmoid of the mean, and
    // the true fixed point sits nearer 66 bpm at 94 mmHg. Started off it, the loop had
    // to travel, and with a transport delay and a 7 s sympathetic lag it overshot: heart
    // rate fell to 41 bpm inside four seconds and the classifier reported SINUS
    // BRADYCARDIA. The app opened on a bradycardia alarm made entirely of startup
    // transient, and every test read its resting baseline off the same swinging number.
    //
    // The assertions are deliberately relative. An undisturbed body should report one
    // rhythm and hold near its own mean; what that mean IS belongs to the constants,
    // not to this test.
    const s = run({ seconds: 60, sampleEvery: 1, intents: [] });
    const hr = s.samples.map((x) => x.cardio.heartRate_bpm);

    expect(
      [...new Set(s.samples.map((x) => x.cardio.rhythm))],
      'an undisturbed body reported a rhythm other than plain sinus',
    ).toEqual(['nsr']);

    const mean = hr.reduce((a, b) => a + b, 0) / hr.length;
    expect(Math.min(...hr), 'heart rate dipped far below its own resting mean').toBeGreaterThan(mean * 0.85);
    expect(Math.max(...hr), 'heart rate spiked far above its own resting mean').toBeLessThan(mean * 1.15);

    // Mean pressure should be flat too - the same overshoot pushed it to 108 mmHg.
    const map = s.samples.map((x) => x.cardio.map_mmHg);
    const meanMap = map.reduce((a, b) => a + b, 0) / map.length;
    expect(Math.max(...map), 'mean arterial pressure overshot at boot').toBeLessThan(meanMap * 1.1);
  });
});

describe('food-borne substances reach the circulation', () => {
  /**
   * THE BUG THIS EXISTS FOR: a drug arriving only through the gut never got a
   * pharmacokinetic compartment, so it was absorbed correctly and then dropped. Every
   * previous route went through `administer`, which creates one; food was the first
   * that did not.
   */
  it('names only drugs that exist for its alcohol and caffeine content', () => {
    const ids = new Set(DRUGS.map((d) => d.id));
    const alcoholic = FOODS.filter((f) => f.alcohol_g);
    const caffeinated = FOODS.filter((f) => f.caffeine_mg);

    expect(alcoholic.length, 'expected at least one alcoholic food').toBeGreaterThan(0);
    expect(caffeinated.length, 'expected at least one caffeinated food').toBeGreaterThan(0);
    expect(ids.has('ethanol'), 'foods carry alcohol but no ethanol drug exists').toBe(true);
    expect(ids.has('caffeine'), 'foods carry caffeine but no caffeine drug exists').toBe(true);
  });

  it('creates a compartment for a drug that arrives only through the gut', () => {
    const e = new Engine(0x5eed);
    e.applyIntent({ type: 'EAT', foodId: 'beer', portions: 1 });

    // Nothing has been administered, so nothing should have a compartment yet.
    const before = e.snapshot().drugs.length;

    for (let i = 0; i < Math.round(1800 / DT); i++) {
      e.tick(DT);
      e.pending.length = 0;
    }

    const after = e.snapshot();
    const ethanol = after.drugs.find((d) => d.drugId === 'ethanol');
    expect(after.drugs.length, 'a compartment should have been created by the gut').toBeGreaterThan(before);
    expect(ethanol, 'ethanol should have a compartment after a drink').toBeTruthy();
    expect(ethanol!.plasma_ng_per_mL).toBeGreaterThan(0);
  });
});

describe('the engine is not order-dependent on its own intents', () => {
  /**
   * Two doses given in the same tick must produce the same state whichever order the
   * intent queue happens to hold them in. This is not a theoretical concern: the drawer
   * can dispatch two intents in one frame, and the ordering is whatever React's event
   * loop produced.
   */
  it('gives the same result for two simultaneous doses in either order', () => {
    const give = (drugId: string, amount: number, unit: string, label: string): ScheduledIntent => ({
      at: 10,
      intent: { type: 'ADMINISTER', drugId, route: 'IV_PUSH', dose: amount, unit, label },
    });

    const a = run({
      seconds: 300,
      intents: [IV, give('epinephrine', 1, 'mg', '1 mg'), give('atropine', 1, 'mg', '1 mg')],
    });
    const b = run({
      seconds: 300,
      intents: [IV, give('atropine', 1, 'mg', '1 mg'), give('epinephrine', 1, 'mg', '1 mg')],
    });

    expect(a.final.cardio.heartRate_bpm).toBeCloseTo(b.final.cardio.heartRate_bpm, 6);
    expect(a.final.cardio.map_mmHg).toBeCloseTo(b.final.cardio.map_mmHg, 6);
  });
});

describe('a body without a circulation stops breathing', () => {
  it('does not ventilate calmly through a cardiac arrest', () => {
    // THE TEST THAT WAS MISSING, and its absence is the whole story: arrest.test.ts has
    // nineteen tests covering VF, asystole, CPR, defibrillation and ROSC, and not one of
    // them looks at breathing. So a pulseless body ventilating at twelve a minute on a
    // normal tidal volume passed every arrest test there was.
    //
    // Three defects stacked to produce it - no perfusion term in drive, an unbounded
    // chemoreflex that no multiplicative gate could overcome, and cerebral flow computed
    // from arterial pressure instead of the perfusion gradient. See ADR-024.
    //
    // Asserted as MINUTE VENTILATION, not as the apnoea flag. What matters is that the
    // body is obviously not breathing normally; whether the last gasps trip a boolean is
    // a detail of where that threshold sits, and pinning the test to it would make this
    // fail for a reason that has nothing to do with the bug.
    const s = run({
      seconds: 4 * 60,
      sampleEvery: 10,
      intents: [IV, { at: 30, intent: { type: 'FORCE_RHYTHM', rhythm: 'vfib' } }],
    });

    const before = s.samples[1];
    const after = s.samples[s.samples.length - 1];
    const minuteVentilation = (x: SimSnapshot) => (x.resp.rate_per_min * x.resp.tidalVolume_mL) / 1000;

    expect(minuteVentilation(before), 'the body was not breathing normally to begin with').toBeGreaterThan(4);

    // Better than a fifteen-fold fall, measured. Before the fix it did not fall at all.
    expect(
      minuteVentilation(after),
      'a pulseless body was still ventilating - see ADR-024',
    ).toBeLessThan(minuteVentilation(before) * 0.1);

    // And the reason has to be the right one: no cardiac output, so no cerebral
    // perfusion, so no drive. A model that stopped breathing for some other reason
    // would pass the line above and still be wrong.
    expect(after.cardio.cardiacOutput_L_per_min, 'the arrest did not abolish output').toBeLessThan(0.5);
    expect(after.neuro.consciousness, 'consciousness survived an arrest').toBeLessThan(0.05);
    //
    // HOW MUCH CO2, and why this threshold was lowered on 2026-09-24. It used to demand
    // +20 mmHg in three and a half minutes, which the old respiratory model met because
    // it chased 863·VCO2/VA with a 35 s lag: as ventilation fell toward zero that target
    // ran to the 180 mmHg cap and PaCO2 climbed several mmHg a SECOND - faster than
    // metabolism can make CO2. Mass balance caps the rise at production over the body's
    // CO2 capacitance, measured during complete airway obstruction at 3.4 mmHg/min
    // (Stock 1989, `resp.apnoeaPaco2Rise_mmHg_per_min`). That paper's extra ~12 mmHg in
    // the first minute is lung and blood equilibrating with mixed venous gas, which needs
    // pulmonary blood flow, and an arrested circulation has none. So the honest
    // expectation over the ~3.5 apnoeic minutes here is roughly 3.4 x 3.5 = 12 mmHg, and
    // the line below asks for well over half of it: clearly accumulating, and bounded by
    // a measured rate rather than by the old model's overshoot.
    const apnoeicMinutes = (after.t - 30) / 60;
    expect(after.resp.paco2_mmHg, 'CO2 did not accumulate without a circulation').toBeGreaterThan(
      before.resp.paco2_mmHg + 0.6 * P('resp.apnoeaPaco2Rise_mmHg_per_min') * apnoeicMinutes,
    );
  });
});

describe('a drug never acts in the wrong direction', () => {
  it('empties the stomach faster with a prokinetic and slower with an antiemetic', () => {
    // Metoclopramide was modelled BACKWARDS, and no data check could have seen it.
    //
    // The d2 receptor carries gi.motility -0.3, so D2 blockade is the prokinetic path
    // and it was wired correctly all along. But GtoPdb publishes no human D2 affinity
    // for metoclopramide, so that target was dropped at ingestion and the only surviving
    // target was 5-HT3 at 596 nM - which is constipating. Every field was populated,
    // every citation resolved, and 10 mg given with a meal left MORE in the stomach than
    // no drug at all, when accelerating gastric emptying is the whole point of the drug.
    // Fixed with a cited direct effect; see ADR-023.
    //
    // The two drugs are asserted TOGETHER and in OPPOSITE directions on purpose. Either
    // one alone could be satisfied by a motility term that had simply been given the
    // wrong sign somewhere; only the pair pins down that the model distinguishes them.
    const meal: ScheduledIntent = {
      at: 5,
      intent: { type: 'EAT', foodId: 'glucose_drink', portions: 1 },
    };

    const remaining = (drugId: string | null, dose: number) => {
      const intents: ScheduledIntent[] = [IV, meal];
      if (drugId) {
        intents.push({
          at: 10,
          intent: { type: 'ADMINISTER', drugId, route: 'IV_PUSH', dose, unit: 'mg', label: `${dose} mg` },
        });
      }
      return run({ seconds: 20 * 60, intents }).final.gi.gastricVolume_mL;
    };

    const control = remaining(null, 0);
    expect(control, 'the meal never reached the stomach, so this test proves nothing').toBeGreaterThan(50);

    expect(
      remaining('metoclopramide', 10),
      'metoclopramide is a prokinetic and must empty the stomach FASTER than no drug',
    ).toBeLessThan(control);

    expect(
      remaining('ondansetron', 4),
      'ondansetron blocks enteric 5-HT3 and must empty the stomach SLOWER than no drug',
    ).toBeGreaterThan(control);
  });
});

describe('the snapshot is complete', () => {
  /**
   * Every field the interface reads must be present. A missing field renders as
   * undefined, which React prints as nothing at all — the same silence the other bugs
   * hid behind.
   */
  it('carries every top-level system', () => {
    const s: SimSnapshot = run({ seconds: 5 }).final;
    for (const key of [
      'cardio', 'resp', 'renal', 'gi', 'metabolic', 'endocrine',
      'transport', 'neuro', 'chem', 'drugs', 'receptors', 'conditions', 'procedures',
    ] as const) {
      expect(s[key], `snapshot is missing ${key}`).toBeDefined();
    }
  });

  it('carries a hormone entry for every hormone in the data file', () => {
    const s = run({ seconds: 30 }).final;
    expect(s.endocrine.hormones.length).toBeGreaterThan(0);
    for (const h of s.endocrine.hormones) {
      expect(h.unit, `${h.id} has no unit`).toBeTruthy();
      expect(h.refHigh, `${h.id} reference range is inverted`).toBeGreaterThan(h.refLow);
      expect(Number.isFinite(h.level), `${h.id} level is not finite`).toBe(true);
    }
  });

  it('normalises every transport marker into 0..1', () => {
    const s = run({
      seconds: 300,
      sampleEvery: 30,
      intents: [IV, { at: 10, intent: { type: 'ADMINISTER', drugId: 'fentanyl', route: 'IV_PUSH', dose: 100, unit: 'mcg', label: '100 mcg' } }],
    });
    for (const sample of s.samples) {
      for (const m of sample.transport.markers) {
        expect(m.level, `${m.id} out of range at t=${sample.t}`).toBeGreaterThanOrEqual(0);
        expect(m.level, `${m.id} out of range at t=${sample.t}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('shows a microgram-dosed drug on the transport markers', () => {
    // The 1000x unit bug, caught end to end: fentanyl is dosed in micrograms, and its
    // marker was pinned at zero however much was given.
    const s = run({
      seconds: 300,
      sampleEvery: 10,
      intents: [IV, { at: 10, intent: { type: 'ADMINISTER', drugId: 'fentanyl', route: 'IV_PUSH', dose: 100, unit: 'mcg', label: '100 mcg', multiplier: 5 } }],
    });
    const best = Math.max(
      ...s.samples.map((x) => x.transport.markers.find((m) => m.id === 'fentanyl')?.level ?? 0),
    );
    expect(best).toBeGreaterThan(0.01);
  });
});
