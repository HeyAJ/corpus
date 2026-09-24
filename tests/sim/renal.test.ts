import { describe, expect, it } from 'vitest';
import { autoregulation } from '../../src/sim/systems/renal';
import { P } from '../../src/sim/core/constants';
import { run } from './harness';

/**
 * RENAL AUTOREGULATION AND THE CLEARANCE FEEDBACK LOOP (spec 4.5).
 *
 * "GFR holds flat across MAP 80-180 mmHg, then falls off a cliff. That cliff is the
 *  entire point of the GFR readout."
 *
 * And the loop that closes it: "renal drug clearance is proportional to GFR - so a
 * hypotensive body clears renally-eliminated drugs more slowly, and the second dose
 * hits harder. Wire that feedback; it's the most educational loop in the app."
 */

describe('autoregulation curve', () => {
  const LO = P('renal.autoregLow_mmHg');
  const HI = P('renal.autoregHigh_mmHg');

  it('is exactly flat across the plateau', () => {
    for (let map = LO; map <= HI; map += 5) {
      expect(autoregulation(map)).toBe(1);
    }
  });

  it('is continuous at both plateau edges', () => {
    // A discontinuity here would make the GFR chip jump by tens of mL/min for a
    // 1 mmHg change in pressure, which would read as a bug in the engine.
    expect(autoregulation(LO - 0.01)).toBeCloseTo(1, 3);
    expect(autoregulation(HI + 0.01)).toBeCloseTo(1, 3);
  });

  it('falls off a cliff below the plateau', () => {
    expect(autoregulation(70)).toBeLessThan(0.85);
    expect(autoregulation(60)).toBeLessThan(0.5);
    expect(autoregulation(50)).toBeLessThan(0.25);
    expect(autoregulation(40)).toBeLessThan(0.06);
  });

  it('is monotonic below the plateau', () => {
    let previous = autoregulation(30);
    for (let map = 31; map <= LO; map++) {
      const v = autoregulation(map);
      expect(v).toBeGreaterThanOrEqual(previous);
      previous = v;
    }
  });

  it('ceases filtration entirely at very low pressure', () => {
    expect(autoregulation(20)).toBeLessThan(0.01);
    expect(autoregulation(0)).toBe(0);
  });

  it('creeps up only slightly above the plateau, and is capped', () => {
    expect(autoregulation(200)).toBeGreaterThan(1);
    expect(autoregulation(250)).toBeLessThanOrEqual(1.15);
  });
});

describe('GFR responds to real perfusion', () => {
  it('collapses when haemorrhage drives MAP below the plateau', () => {
    const { samples } = run({
      seconds: 400,
      sampleEvery: 10,
      intents: [
        { at: 30, intent: { type: 'HAEMORRHAGE', volume_mL: 1500 } },
        { at: 60, intent: { type: 'HAEMORRHAGE', volume_mL: 800 } },
      ],
    });
    const end = samples[samples.length - 1];
    expect(end.cardio.map_mmHg).toBeLessThan(P('renal.autoregLow_mmHg'));
    expect(end.renal.gfr_mL_per_min).toBeLessThan(0.7 * P('renal.gfr_mL_per_min'));
    expect(end.renal.autoregulationFactor).toBeLessThan(1);
  });
});

describe('THE FEEDBACK LOOP: low GFR slows renal drug clearance (spec 4.5)', () => {
  /**
   * Furosemide is two-thirds renally eliminated, so it is the clearest possible
   * demonstration. Give the same dose to a normovolaemic body and to a bled one,
   * and compare how much drug is left an hour later.
   */
  const DOSE = {
    type: 'ADMINISTER' as const,
    drugId: 'furosemide',
    route: 'IV_PUSH' as const,
    dose: 40,
    unit: 'mg',
    label: '40 mg',
  };

  const normal = run({ seconds: 3600, intents: [{ at: 60, intent: DOSE }] });
  const bled = run({
    seconds: 3600,
    intents: [
      { at: 10, intent: { type: 'HAEMORRHAGE', volume_mL: 1500 } },
      { at: 30, intent: { type: 'HAEMORRHAGE', volume_mL: 900 } },
      { at: 60, intent: DOSE },
    ],
  });

  const concentrationOf = (r: typeof normal) =>
    r.final.drugs.find((d) => d.drugId === 'furosemide')?.plasma_ng_per_mL ?? 0;

  it('leaves a higher plasma concentration in the hypoperfused body', () => {
    const normalGfr = normal.final.renal.gfr_mL_per_min;
    const bledGfr = bled.final.renal.gfr_mL_per_min;
    expect(bledGfr).toBeLessThan(normalGfr);

    // Same dose, same hour, different clearance. This is the whole point.
    expect(concentrationOf(bled)).toBeGreaterThan(concentrationOf(normal) * 1.15);
  });

  it('is driven by the renal clearance scale, not by some other difference', () => {
    expect(bled.engine.state.renal.clearanceScale).toBeLessThan(
      normal.engine.state.renal.clearanceScale,
    );
  });

  it('a second dose therefore accumulates more in the hypoperfused body', () => {
    const twoDoses = (extra: { at: number; intent: (typeof DOSE) | { type: 'HAEMORRHAGE'; volume_mL: number } }[]) =>
      run({
        seconds: 5400,
        intents: [...extra, { at: 60, intent: DOSE }, { at: 3600, intent: DOSE }],
      });

    const a = twoDoses([]);
    const b = twoDoses([
      { at: 10, intent: { type: 'HAEMORRHAGE', volume_mL: 1500 } },
      { at: 30, intent: { type: 'HAEMORRHAGE', volume_mL: 900 } },
    ]);

    const aCp = a.final.drugs.find((d) => d.drugId === 'furosemide')!.plasma_ng_per_mL;
    const bCp = b.final.drugs.find((d) => d.drugId === 'furosemide')!.plasma_ng_per_mL;
    expect(bCp).toBeGreaterThan(aCp);
  });
});

describe('diuresis', () => {
  it('furosemide increases urine output and depletes volume', () => {
    const control = run({ seconds: 3600, sampleEvery: 300 });
    const treated = run({
      seconds: 3600,
      sampleEvery: 300,
      intents: [
        {
          at: 60,
          intent: { type: 'ADMINISTER', drugId: 'furosemide', route: 'IV_PUSH', dose: 40, unit: 'mg', label: '40 mg' },
        },
      ],
    });

    const avgUrine = (r: typeof control) =>
      r.samples.reduce((a, s) => a + s.renal.urineOutput_mL_per_min, 0) / r.samples.length;

    expect(avgUrine(treated)).toBeGreaterThan(avgUrine(control) * 1.5);
    expect(treated.final.renal.bladderVolume_mL).toBeGreaterThan(control.final.renal.bladderVolume_mL);
    // And the volume has to come from somewhere.
    expect(treated.engine.state.fluids.interstitial).toBeLessThan(control.engine.state.fluids.interstitial);
  });
});
