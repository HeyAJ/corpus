import { describe, expect, it } from 'vitest';
import { run, type ScheduledIntent } from './harness';
import foodsFile from '../../src/data/foods.json';

/**
 * FOOD AS A ROUTE OF ADMINISTRATION.
 *
 * The food set carries three things the gastrointestinal model did not previously use:
 * a glycaemic index, a fibre content, and — for anything alcoholic or caffeinated — a
 * quantity of a substance that is also a drug in `src/data/drugs.json`.
 *
 * The last of those is the interesting one. A drink is simply the route by which a body
 * receives ethanol, so it is handed to the same pharmacokinetics an oral dose uses
 * rather than getting a second, parallel model. These tests check that it really is the
 * same path, because a parallel implementation would be invisible until it disagreed.
 */

interface FoodLike {
  id: string;
  carb_g: number;
  glycaemicIndex?: number;
  fibre_g?: number;
  alcohol_g?: number;
  caffeine_mg?: number;
  source: string;
  sourceUrl: string;
  portion_g?: number;
  fat_g: number;
  protein_g: number;
}
const FOODS = (foodsFile as unknown as { foods: FoodLike[] }).foods;

const eat = (t: number, foodId: string, portions = 1): ScheduledIntent => ({
  at: t,
  intent: { type: 'EAT', foodId, portions },
});

/** Peak plasma concentration of a drug and when it happened, in minutes. */
function peakOf(
  samples: { t: number; drugs: { drugId: string; plasma_ng_per_mL: number }[] }[],
  drugId: string,
) {
  let peak = -1;
  let at = 0;
  for (const s of samples) {
    const c = s.drugs.find((d) => d.drugId === drugId)?.plasma_ng_per_mL ?? 0;
    if (c > peak) {
      peak = c;
      at = s.t / 60;
    }
  }
  return { peak, tmax_min: at };
}

function peakGlucose(samples: { t: number; metabolic: { glucose_mg_per_dL: number } }[]) {
  let peak = -1;
  let at = 0;
  for (const s of samples) {
    if (s.metabolic.glucose_mg_per_dL > peak) {
      peak = s.metabolic.glucose_mg_per_dL;
      at = s.t / 60;
    }
  }
  return { peak, tmax_min: at };
}

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

  it('coffee produces plasma caffeine', () => {
    const s = run({ seconds: 4 * 3600, sampleEvery: 60, intents: [eat(10, 'coffee')] });
    expect(peakOf(s.samples, 'caffeine').peak).toBeGreaterThan(0);
  });

  it('a food with neither produces neither', () => {
    const s = run({ seconds: 2 * 3600, sampleEvery: 120, intents: [eat(10, 'white_rice')] });
    expect(peakOf(s.samples, 'ethanol').peak).toBeLessThanOrEqual(0);
    expect(peakOf(s.samples, 'caffeine').peak).toBeLessThanOrEqual(0);
  });
});
