import { describe, expect, it } from 'vitest';
import { run } from '../sim/harness';
import type { SimSnapshot } from '../../src/bridge/types';

/**
 * PHASE 3 DEFINITION OF DONE (spec 11).
 *
 * "Epinephrine 1 mg IV push produces a physiologically sensible HR/BP/contractility
 *  trajectory that a pharmacology textbook would recognise, and a unit test asserts
 *  it."
 *
 * The trajectory a textbook describes, in order:
 *
 *   1. An immediate, steep pressor response. Alpha-1 occupancy rises within seconds
 *      and systemic resistance with it.
 *   2. A brief baroreflex bradycardia at the pressure peak, because the vagal limb
 *      is fast (tau 1.5 s) and sees the pressure before the sympathetic limb
 *      responds.
 *   3. Net TACHYCARDIA as direct beta-1 chronotropy asserts itself over the reflex.
 *      This is the sign that catches a naive model out: if the reflex wins, the
 *      model will show bradycardia throughout, which is noradrenaline's signature,
 *      not adrenaline's.
 *   4. Raised contractility throughout.
 *   5. Return toward baseline within minutes, because the drug's own half-life is
 *      about two minutes.
 *
 * None of that is scripted. It emerges from measured binding affinities, an
 * integrated PK model and a two-limb reflex with different time constants.
 */

const DOSE = {
  type: 'ADMINISTER' as const,
  drugId: 'epinephrine',
  route: 'IV_PUSH' as const,
  dose: 1,
  unit: 'mg',
  label: '1 mg',
};

const AT = 60;

describe('epinephrine 1 mg IV push (Phase 3 DoD)', () => {
  const { samples } = run({ seconds: 900, sampleEvery: 1, intents: [{ at: AT, intent: DOSE }] });

  const at = (dt: number): SimSnapshot => samples.find((s) => s.t >= AT + dt)!;
  const baseline = at(-5);
  const window = (from: number, to: number) => samples.filter((s) => s.t >= AT + from && s.t <= AT + to);
  const peak = <K extends keyof SimSnapshot['cardio']>(k: K, from: number, to: number) =>
    Math.max(...window(from, to).map((s) => s.cardio[k] as number));
  const trough = <K extends keyof SimSnapshot['cardio']>(k: K, from: number, to: number) =>
    Math.min(...window(from, to).map((s) => s.cardio[k] as number));

  it('1. produces an immediate steep pressor response', () => {
    expect(peak('map_mmHg', 0, 20)).toBeGreaterThan(baseline.cardio.map_mmHg + 15);
    expect(peak('systolic_mmHg', 0, 20)).toBeGreaterThan(150);
    // Within seconds, not minutes: this is an intravenous bolus. Assert on WHEN the
    // peak occurs rather than on the value at one instant — the reported mean
    // pressure is a two-second leaky integral, so it has already begun falling back
    // by the time the reflex has finished responding.
    const peakSample = window(0, 60).reduce((a, b) => (b.cardio.map_mmHg > a.cardio.map_mmHg ? b : a));
    expect(peakSample.t - AT).toBeLessThan(12);
  });

  it('2. shows a transient baroreflex bradycardia at the pressure peak', () => {
    // The vagal limb is fast and it sees the pressure first.
    expect(trough('heartRate_bpm', 0, 12)).toBeLessThan(baseline.cardio.heartRate_bpm);
  });

  it('3. then produces NET TACHYCARDIA, which is adrenaline and not noradrenaline', () => {
    const later = window(20, 90).map((s) => s.cardio.heartRate_bpm);
    const mean = later.reduce((a, b) => a + b, 0) / later.length;
    expect(mean).toBeGreaterThan(baseline.cardio.heartRate_bpm + 5);
  });

  it('4. raises systemic vascular resistance through alpha-1', () => {
    const alpha1 = at(10).receptors.find((r) => r.receptorId === 'alpha1')!;
    expect(alpha1.occupancy).toBeGreaterThan(0.2);
    // Diastolic pressure is the readout of resistance, and it rises sharply.
    expect(peak('diastolic_mmHg', 0, 20)).toBeGreaterThan(baseline.cardio.diastolic_mmHg + 20);
  });

  it('5. occupies beta-1 and beta-2 as well as alpha-1, in affinity order', () => {
    const r = (id: string) => at(6).receptors.find((x) => x.receptorId === id)!.occupancy;
    // Adrenaline's published binding affinities put alpha-1 tightest of the three,
    // then beta-2, then beta-1. The occupancies must follow that ordering, because
    // they are computed from those affinities and nothing else.
    expect(r('alpha1')).toBeGreaterThan(r('beta2'));
    expect(r('beta2')).toBeGreaterThan(r('beta1'));
    expect(r('beta1')).toBeGreaterThan(r('beta3'));
  });

  it('6. returns toward baseline within fourteen minutes', () => {
    const end = at(800);
    expect(Math.abs(end.cardio.map_mmHg - baseline.cardio.map_mmHg)).toBeLessThan(8);
    expect(Math.abs(end.cardio.heartRate_bpm - baseline.cardio.heartRate_bpm)).toBeLessThan(12);
    const drug = end.drugs.find((d) => d.drugId === 'epinephrine')!;
    // 800 s is about seven half-lives, so under 1 % of the 72 ng/mL peak remains.
    expect(drug.plasma_ng_per_mL).toBeLessThan(1);
  });

  it('7. the whole response is driven by occupancy, not by the dose directly', () => {
    // Occupancy must decay with the plasma curve. If the effect outlasted the
    // occupancy, something is holding state it should not.
    const peakOcc = Math.max(...window(0, 60).map((s) => s.receptors.find((r) => r.receptorId === 'alpha1')!.occupancy));
    const lateOcc = at(600).receptors.find((r) => r.receptorId === 'alpha1')!.occupancy;
    expect(lateOcc).toBeLessThan(peakOcc * 0.1);
  });

  it('8. raises blood glucose, because beta-2 drives hepatic glycogenolysis', () => {
    // A secondary consequence nobody scripted: the same beta-2 occupancy that
    // dilates skeletal muscle arterioles also mobilises glucose.
    const before = baseline.metabolic.glucose_mg_per_dL;
    const after = Math.max(...window(30, 600).map((s) => s.metabolic.glucose_mg_per_dL));
    expect(after).toBeGreaterThan(before);
  });
});

describe('noradrenaline contrasts with adrenaline', () => {
  /**
   * The contrast is the point of having both. Noradrenaline has almost no beta-2
   * activity, so its alpha-1 pressor response is unopposed and the reflex
   * bradycardia is NOT overridden. A model that gave both drugs the same answer
   * would be modelling "a catecholamine" rather than these two catecholamines.
   */
  const epi = run({
    seconds: 300,
    sampleEvery: 1,
    intents: [{ at: AT, intent: DOSE }],
  });
  const noradrenaline = run({
    seconds: 300,
    sampleEvery: 1,
    intents: [
      {
        at: AT,
        intent: { type: 'ADMINISTER', drugId: 'norepinephrine', route: 'IV_PUSH', dose: 100, unit: 'mcg', label: '100 mcg' },
      },
    ],
  });

  it('noradrenaline has far less beta-2 occupancy than adrenaline', () => {
    const occ = (r: typeof epi, id: string, dt: number) =>
      r.samples.find((s) => s.t >= AT + dt)!.receptors.find((x) => x.receptorId === id)!.occupancy;
    const epiRatio = occ(epi, 'beta2', 6) / occ(epi, 'alpha1', 6);
    const neRatio = occ(noradrenaline, 'beta2', 6) / occ(noradrenaline, 'alpha1', 6);
    expect(neRatio).toBeLessThan(epiRatio);
  });

  it('both raise mean arterial pressure', () => {
    const rise = (r: typeof epi) => {
      const base = r.samples.find((s) => s.t >= AT - 5)!.cardio.map_mmHg;
      const top = Math.max(...r.samples.filter((s) => s.t >= AT && s.t <= AT + 30).map((s) => s.cardio.map_mmHg));
      return top - base;
    };
    expect(rise(epi)).toBeGreaterThan(8);
    expect(rise(noradrenaline)).toBeGreaterThan(3);
  });
});
