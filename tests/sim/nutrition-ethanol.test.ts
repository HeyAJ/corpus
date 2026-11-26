// Nutrition, part 3 of 4: alcohol arrives as a drug by the oral path and is cleared
// with saturated-enzyme kinetics. The shared story is told in nutrition-helpers.ts.
import { describe, expect, it } from 'vitest';
import { run } from './harness';
import { eat, peakOf } from './nutrition-helpers';

describe('alcohol and caffeine arrive as drugs, by the same path as any oral dose', () => {
  it('a drink produces measurable plasma ethanol', () => {
    const s = run({ seconds: 3 * 3600, sampleEvery: 60, intents: [eat(10, 'beer')] });
    const { peak } = peakOf(s.samples, 'ethanol');
    expect(peak).toBeGreaterThan(0);
  });

  it('eliminates ethanol LINEARLY, which is what a saturated enzyme looks like', () => {
    // THE POINT OF MODELLING ETHANOL AT ALL, and the right way to test it.
    //
    // A first-order drug loses a constant FRACTION per minute, so its decline is
    // exponential and slows continuously as the concentration falls. A drug whose
    // enzyme is saturated loses a constant AMOUNT per minute, so its decline is a
    // straight line. Comparing the fall rate in the first and second halves of the
    // decline distinguishes those two mechanisms directly.
    //
    // An earlier version of this test compared how long one drink and three took to
    // clear, and asserted a ratio above 2.5. That was a bad test twice over: the
    // arithmetic gives about 2.3 because ethanol's Km sits close to the concentration
    // a drink actually produces, so elimination here is only PARTLY zero-order — and
    // even at its best it only separated 2.3 from the 1.85 a first-order drug would
    // give, which is far too narrow a margin to rest a claim on.
    const s = run({ seconds: 6 * 3600, sampleEvery: 60, intents: [eat(10, 'beer', 3)] });

    const series = s.samples.map((x) => ({
      t: x.t / 60,
      c: x.drugs.find((d) => d.drugId === 'ethanol')?.plasma_ng_per_mL ?? 0,
    }));

    let peakIdx = 0;
    for (let i = 0; i < series.length; i++) if (series[i].c > series[peakIdx].c) peakIdx = i;
    const peak = series[peakIdx].c;
    expect(peak).toBeGreaterThan(0);

    // The window from the peak down to a third of it, split in half.
    const target = peak / 3;
    let endIdx = series.length - 1;
    for (let i = peakIdx; i < series.length; i++) {
      if (series[i].c <= target) {
        endIdx = i;
        break;
      }
    }
    expect(endIdx).toBeGreaterThan(peakIdx + 4);

    const midIdx = Math.floor((peakIdx + endIdx) / 2);
    const rate = (a: number, b: number) =>
      (series[a].c - series[b].c) / Math.max(1e-6, series[b].t - series[a].t);

    const firstHalf = rate(peakIdx, midIdx);
    const secondHalf = rate(midIdx, endIdx);

    expect(firstHalf).toBeGreaterThan(0);
    expect(secondHalf).toBeGreaterThan(0);

    // For a first-order drug the second half would be far slower than the first —
    // roughly 45% of it over a fall to a third. A saturated enzyme keeps going at
    // nearly the same rate. Anything above 0.7 is unambiguously not exponential.
    expect(secondHalf / firstHalf).toBeGreaterThan(0.7);
  });

  it('three drinks reach a higher peak than one', () => {
    // Absorption is linear even though elimination is not, so the peak scales with the
    // dose. This is the half of the behaviour that IS proportional.
    const one = run({ seconds: 3 * 3600, sampleEvery: 120, intents: [eat(10, 'beer', 1)] });
    const three = run({ seconds: 3 * 3600, sampleEvery: 120, intents: [eat(10, 'beer', 3)] });

    const p1 = peakOf(one.samples, 'ethanol').peak;
    const p3 = peakOf(three.samples, 'ethanol').peak;

    expect(p3).toBeGreaterThan(p1 * 2);
  });
});
