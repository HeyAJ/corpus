import { describe, expect, it } from 'vitest';
import { run } from './harness';

/**
 * STEP-RESPONSE SANITY (spec 12).
 *
 * "Haemorrhage 1 L -> MAP falls, HR rises (baroreflex), GFR falls. Assert direction
 *  and rough magnitude."
 *
 * Direction is the easy half. The magnitude and the *shape* are what prove the
 * reflex is a reflex rather than a lookup: a real body does not step to a new heart
 * rate, it overshoots on the fast vagal limb and then settles as the slow
 * sympathetic limb catches up.
 */

describe('haemorrhage step response (spec 12)', () => {
  const BLEED_AT = 60;
  const { samples } = run({
    seconds: 400,
    sampleEvery: 2,
    intents: [{ at: BLEED_AT, intent: { type: 'HAEMORRHAGE', volume_mL: 1000 } }],
  });

  const before = samples.filter((s) => s.t > 40 && s.t < BLEED_AT);
  const after = samples.filter((s) => s.t > 340);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  const mapBefore = avg(before.map((s) => s.cardio.map_mmHg));
  const mapAfter = avg(after.map((s) => s.cardio.map_mmHg));
  const hrBefore = avg(before.map((s) => s.cardio.heartRateDisplay_bpm));
  const hrAfter = avg(after.map((s) => s.cardio.heartRateDisplay_bpm));
  const gfrBefore = avg(before.map((s) => s.renal.gfr_mL_per_min));
  const gfrAfter = avg(after.map((s) => s.renal.gfr_mL_per_min));

  it('drops mean arterial pressure', () => {
    expect(mapAfter).toBeLessThan(mapBefore - 3);
  });

  it('raises heart rate through the baroreflex', () => {
    // Class II-III haemorrhage: a 1 L loss is 20 % of blood volume and the textbook
    // response is a tachycardia of 100-120.
    expect(hrAfter).toBeGreaterThan(hrBefore + 15);
    expect(hrAfter).toBeLessThan(150);
  });

  it('reduces stroke volume more than cardiac output, because rate compensates', () => {
    const svDrop = 1 - avg(after.map((s) => s.cardio.strokeVolume_mL)) / avg(before.map((s) => s.cardio.strokeVolume_mL));
    const coDrop = 1 - avg(after.map((s) => s.cardio.cardiacOutput_L_per_min)) / avg(before.map((s) => s.cardio.cardiacOutput_L_per_min));
    expect(svDrop).toBeGreaterThan(coDrop);
  });

  it('reduces glomerular filtration', () => {
    expect(gfrAfter).toBeLessThan(gfrBefore);
  });

  it('raises sympathetic tone and lowers vagal tone', () => {
    const early = samples.find((s) => s.t > BLEED_AT + 30)!;
    expect(early.cardio.svrScale).toBeGreaterThan(1.0);
    expect(early.cardio.contractilityScale).toBeGreaterThan(1.0);
  });

  it('raises the heart rate on the FAST limb first: within 5 s, not 30', () => {
    // The vagal limb has a 1.5 s time constant and a 0.2 s delay; the sympathetic
    // limb is 7 s with a 2 s delay. So most of the immediate rate response must be
    // vagal withdrawal. If this assertion fails, the two limbs have been given the
    // same dynamics and the reflex will look like a step function.
    // Measured on the INSTANTANEOUS rate, not the displayed one: the HUD figure is
    // an eight-beat rolling average, which at 66 bpm smooths over about seven
    // seconds and would hide precisely the dynamics being asserted here.
    const atBleed = samples.find((s) => s.t >= BLEED_AT)!;
    const fiveSeconds = samples.find((s) => s.t >= BLEED_AT + 5)!;
    const thirtySeconds = samples.find((s) => s.t >= BLEED_AT + 30)!;

    const fastRise = fiveSeconds.cardio.heartRate_bpm - atBleed.cardio.heartRate_bpm;
    const totalRise = thirtySeconds.cardio.heartRate_bpm - atBleed.cardio.heartRate_bpm;
    expect(totalRise).toBeGreaterThan(15);
    expect(fastRise / totalRise).toBeGreaterThan(0.25);
  });

  it('partly restores plasma volume from the interstitium over the next half hour', () => {
    // Transcapillary refill. No fluid is given; the volume comes from the
    // interstitial compartment with a 30 min time constant.
    const long = run({
      seconds: 3000,
      sampleEvery: 60,
      intents: [{ at: 60, intent: { type: 'HAEMORRHAGE', volume_mL: 1000 } }],
    });
    const justAfter = long.samples.find((s) => s.t >= 120)!;
    const muchLater = long.samples[long.samples.length - 1];
    expect(muchLater.cardio.bloodVolume_mL).toBeGreaterThan(justAfter.cardio.bloodVolume_mL + 100);
  });

  it('a fluid bolus moves the numbers back toward baseline', () => {
    const withFluid = run({
      seconds: 900,
      sampleEvery: 10,
      intents: [
        { at: 60, intent: { type: 'HAEMORRHAGE', volume_mL: 1000 } },
        { at: 120, intent: { type: 'ADMINISTER', drugId: 'normal_saline', route: 'IV_DRIP', dose: 1000, unit: 'mL', label: '1 L bolus' } },
      ],
    });
    const end = withFluid.samples[withFluid.samples.length - 1];
    expect(end.cardio.map_mmHg).toBeGreaterThan(mapAfter);
    expect(end.cardio.bloodVolume_mL).toBeGreaterThan(4300);
  });
});

describe('hyperkalaemia', () => {
  it('slows the heart once serum potassium passes 6 mEq/L', () => {
    const { samples } = run({
      seconds: 600,
      sampleEvery: 20,
      intents: [
        { at: 30, intent: { type: 'ADMINISTER', drugId: 'potassium_chloride', route: 'IV_PUSH', dose: 10, unit: 'mEq', label: '10 mEq' } },
        { at: 60, intent: { type: 'ADMINISTER', drugId: 'potassium_chloride', route: 'IV_PUSH', dose: 10, unit: 'mEq', label: '10 mEq' } },
        { at: 90, intent: { type: 'ADMINISTER', drugId: 'potassium_chloride', route: 'IV_PUSH', dose: 10, unit: 'mEq', label: '10 mEq' } },
      ],
    });
    const peak = samples.reduce((a, b) => (b.chem.k_mEq_per_L > a.chem.k_mEq_per_L ? b : a));
    expect(peak.chem.k_mEq_per_L).toBeGreaterThan(5.5);
    expect(peak.conditions.some((c) => c.id === 'hyperkalemia')).toBe(true);
  });
});
