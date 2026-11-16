// Nutrition, part 2 of 4: glycaemic index changes the rate of absorption, not the total.
// The shared story is told in nutrition-helpers.ts.
import { describe, expect, it } from 'vitest';
import { run } from './harness';
import { eat } from './nutrition-helpers';

describe('glycaemic index changes the shape of the glucose curve', () => {
  it('does not change how much is eventually absorbed', () => {
    // THE STRONGEST FORM OF THE CLAIM. The index scales the RATE and nothing else, so
    // two foods carrying the same grams of carbohydrate must deliver the same TOTAL
    // glucose to the portal blood however differently they are shaped. If this ever
    // fails, the index has become a fudge factor on energy, which is exactly what it
    // must not be.
    //
    // Integrating `glucoseAbsorption_mg_per_min` is the direct measurement of area
    // under the absorption curve, which is what "same area" means.
    const total = (samples: { t: number; gi: { glucoseAbsorption_mg_per_min: number } }[]) => {
      let mg = 0;
      for (let i = 1; i < samples.length; i++) {
        const dtMin = (samples[i].t - samples[i - 1].t) / 60;
        const a = samples[i - 1].gi.glucoseAbsorption_mg_per_min;
        const b = samples[i].gi.glucoseAbsorption_mg_per_min;
        mg += ((a + b) / 2) * dtMin;
      }
      return mg;
    };

    // White rice (index 73) against pasta (index 49), both at roughly 44 g of
    // carbohydrate — chosen because their carbohydrate loads are close and their
    // indices are not.
    const fast = run({ seconds: 8 * 3600, sampleEvery: 30, intents: [eat(10, 'white_rice')] });
    const slow = run({ seconds: 8 * 3600, sampleEvery: 30, intents: [eat(10, 'pasta')] });

    const a = total(fast.samples);
    const b = total(slow.samples);

    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    // Their carbohydrate loads differ by about 3%, so the totals should track that and
    // not the 50% difference in their glycaemic indices.
    expect(a / b).toBeGreaterThan(0.85);
    expect(a / b).toBeLessThan(1.18);
  });
});
