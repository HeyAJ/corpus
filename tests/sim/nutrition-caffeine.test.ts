// Nutrition, part 4 of 4: caffeine arrives as a drug by the oral path, and a food with
// neither substance produces neither. The shared story is told in nutrition-helpers.ts.
import { describe, expect, it } from 'vitest';
import { run } from './harness';
import { eat, peakOf } from './nutrition-helpers';

describe('alcohol and caffeine arrive as drugs, by the same path as any oral dose', () => {
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
