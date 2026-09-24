import { describe, expect, it } from 'vitest';
import { NORMAL, run } from './harness';
import type { SimSnapshot } from '../../src/bridge/types';

/**
 * HOMEOSTASIS (spec 12).
 *
 * "With no intervention, all vitals stay within physiological range for 24
 *  simulated hours. No drift. This catches integrator bugs nothing else will."
 *
 * The reason this catches what nothing else catches: a forward-Euler loop with a
 * small conservation error looks perfect for sixty seconds and has lost half a
 * litre of blood by lunchtime. The only way to see it is to run the clock.
 *
 * 24 h at a 10 ms step is 8.64 million ticks, so this is the slow test in the
 * suite. It is worth every second of it.
 */

describe('homeostasis over 24 simulated hours (spec 12)', () => {
  const HOURS = 24;
  const samples: SimSnapshot[] = [];
  const result = run({ seconds: HOURS * 3600, sampleEvery: 600, onSample: (s) => samples.push(s) });

  it('samples the whole day', () => {
    expect(samples.length).toBeGreaterThan(HOURS * 5);
  });

  it('keeps every vital inside its physiological range for the whole day', () => {
    const failures: string[] = [];
    const check = (label: string, value: number, range: readonly [number, number], t: number) => {
      if (value < range[0] || value > range[1]) {
        failures.push(`t=${(t / 3600).toFixed(1)}h ${label}=${value.toFixed(2)} outside ${range[0]}..${range[1]}`);
      }
    };

    for (const s of samples) {
      check('HR', s.cardio.heartRateDisplay_bpm, NORMAL.heartRate, s.t);
      check('systolic', s.cardio.systolic_mmHg, NORMAL.systolic, s.t);
      check('diastolic', s.cardio.diastolic_mmHg, NORMAL.diastolic, s.t);
      check('MAP', s.cardio.map_mmHg, NORMAL.map, s.t);
      check('EF', s.cardio.ejectionFraction, NORMAL.ejectionFraction, s.t);
      check('CO', s.cardio.cardiacOutput_L_per_min, NORMAL.cardiacOutput, s.t);
      check('SV', s.cardio.strokeVolume_mL, NORMAL.strokeVolume, s.t);
      check('EDV', s.cardio.edv_mL, NORMAL.edv, s.t);
      check('SpO2', s.resp.spo2, NORMAL.spo2, s.t);
      check('PaCO2', s.resp.paco2_mmHg, NORMAL.paco2, s.t);
      check('PaO2', s.resp.pao2_mmHg, NORMAL.pao2, s.t);
      check('RR', s.resp.rate_per_min, NORMAL.respRate, s.t);
      check('GFR', s.renal.gfr_mL_per_min, NORMAL.gfr, s.t);
      check('glucose', s.metabolic.glucose_mg_per_dL, NORMAL.glucose, s.t);
      check('core temp', s.metabolic.coreTemp_C, NORMAL.coreTemp, s.t);
      check('K+', s.chem.k_mEq_per_L, NORMAL.potassium, s.t);
      check('lactate', s.chem.lactate_mmol_per_L, NORMAL.lactate, s.t);
    }

    expect(failures.slice(0, 12).join('\n')).toBe('');
  });

  it('conserves blood volume: the circuit must not leak', () => {
    // Every compartment volume is summed from the state each tick, so a leak in the
    // integrator shows up here rather than hiding behind a stored total. Urine
    // output legitimately removes volume, so allow for a day of it.
    const first = samples[0].cardio.bloodVolume_mL;
    const last = samples[samples.length - 1].cardio.bloodVolume_mL;
    const urineOut = samples.reduce((sum, s) => sum + s.renal.urineOutput_mL_per_min, 0) / samples.length * 60 * HOURS;

    expect(last).toBeGreaterThan(first - urineOut - 150);
    expect(last).toBeLessThan(first + 150);
  });

  it('shows no monotonic drift in mean arterial pressure', () => {
    // A leak or a systematic integration bias shows up as a trend, not as noise.
    // Compare the first and last quarter of the day.
    const quarter = Math.floor(samples.length / 4);
    const early = mean(samples.slice(0, quarter).map((s) => s.cardio.map_mmHg));
    const late = mean(samples.slice(-quarter).map((s) => s.cardio.map_mmHg));
    expect(Math.abs(late - early)).toBeLessThan(4);
  });

  it('shows no drift in glucose, temperature or potassium', () => {
    const quarter = Math.floor(samples.length / 4);
    const drift = (pick: (s: SimSnapshot) => number) =>
      Math.abs(mean(samples.slice(-quarter).map(pick)) - mean(samples.slice(0, quarter).map(pick)));

    expect(drift((s) => s.metabolic.glucose_mg_per_dL)).toBeLessThan(6);
    expect(drift((s) => s.metabolic.coreTemp_C)).toBeLessThan(0.2);
    expect(drift((s) => s.chem.k_mEq_per_L)).toBeLessThan(0.3);
  });

  it('reports no condition tags in a resting healthy body', () => {
    const tagged = samples.filter((s) => s.conditions.length > 0);
    const labels = [...new Set(tagged.flatMap((s) => s.conditions.map((c) => `${c.label} (${c.detail})`)))];
    expect(labels.join(' | ')).toBe('');
  });

  it('fills the bladder at a physiological rate and does not overflow', () => {
    const last = result.final.renal.bladderVolume_mL;
    // Starting at 120 mL with ~1 mL/min and a 500 mL capacity, the bladder reaches
    // capacity and stays there — there is no micturition reflex modelled, which is
    // recorded in docs/MODEL_LIMITATIONS.md.
    expect(last).toBeLessThanOrEqual(500.001);
    expect(last).toBeGreaterThan(400);
  });
}, 900_000);

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
