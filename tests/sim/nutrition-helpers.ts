import type { ScheduledIntent } from './harness';
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
 *
 * The tests that use these helpers were one file and are now four (`nutrition-glycaemic`,
 * `nutrition-absorption`, `nutrition-ethanol`, `nutrition-caffeine`) only so that CI can
 * run them on different runners at the same time; they tell one story.
 */

export interface FoodLike {
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
export const FOODS = (foodsFile as unknown as { foods: FoodLike[] }).foods;

export const eat = (t: number, foodId: string, portions = 1): ScheduledIntent => ({
  at: t,
  intent: { type: 'EAT', foodId, portions },
});

/** Peak plasma concentration of a drug and when it happened, in minutes. */
export function peakOf(
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

export function peakGlucose(samples: { t: number; metabolic: { glucose_mg_per_dL: number } }[]) {
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
