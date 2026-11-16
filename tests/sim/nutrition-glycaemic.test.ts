// Nutrition, part 1 of 4: the food data itself, and the shape of the glucose curve
// for a high- and a low-index food. The shared story is told in nutrition-helpers.ts.
import { describe, expect, it } from 'vitest';
import { run } from './harness';
import { FOODS, eat, peakGlucose } from './nutrition-helpers';

describe('the food data itself', () => {
  it('states a portion mass its macros cannot exceed', () => {
    for (const f of FOODS) {
      if (f.portion_g === undefined) continue;
      const macroMass = f.carb_g + f.fat_g + f.protein_g + (f.alcohol_g ?? 0);
      // Water and fibre make up the rest, so the macros must be a subset of the mass.
      expect(macroMass, f.id).toBeLessThanOrEqual(f.portion_g * 1.02);
    }
  });

  it('keeps every glycaemic index on the scale it is defined on', () => {
    for (const f of FOODS) {
      if (f.glycaemicIndex === undefined) continue;
      // Glucose is 100 by definition and nothing meaningfully exceeds it.
      expect(f.glycaemicIndex, f.id).toBeGreaterThan(0);
      expect(f.glycaemicIndex, f.id).toBeLessThanOrEqual(110);
    }
  });

  it('never declares fibre a food does not have room for', () => {
    for (const f of FOODS) {
      if (f.fibre_g === undefined || f.portion_g === undefined) continue;
      expect(f.fibre_g, f.id).toBeLessThanOrEqual(f.portion_g);
    }
  });

  it('has no duplicate ids', () => {
    const ids = FOODS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('glycaemic index changes the shape of the glucose curve', () => {
  it('a high-index drink peaks higher and sooner than a low-index meal', () => {
    // Glucose drink: index 100, no fibre, liquid. Lentils: index 32, 15.6 g of fibre.
    // The comparison is deliberately extreme because the effect should be obvious.
    const fast = run({ seconds: 4 * 3600, sampleEvery: 60, intents: [eat(10, 'glucose_drink')] });
    const slow = run({ seconds: 4 * 3600, sampleEvery: 60, intents: [eat(10, 'lentils', 2)] });

    const a = peakGlucose(fast.samples);
    const b = peakGlucose(slow.samples);

    expect(a.peak).toBeGreaterThan(b.peak);
    expect(a.tmax_min).toBeLessThan(b.tmax_min);
  });
});
