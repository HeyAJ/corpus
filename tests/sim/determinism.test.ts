import { describe, expect, it } from 'vitest';
import { run, hashSnapshot, DT } from './harness';
import { Rng } from '../../src/sim/core/rng';
import type { SimIntent } from '../../src/bridge/types';

/**
 * DETERMINISM (spec 4.1, 12).
 *
 * "Same seed + same intent log = byte-identical output. Write a test that proves it."
 *
 * This is not a nicety. Without it, a reported bug cannot be reproduced, the
 * pharmacology golden tests are flaky by construction, and the probabilistic
 * defibrillation model cannot be validated at all — you could never tell a real
 * change in shock success from a different roll of the dice.
 */

const INTENTS: { at: number; intent: SimIntent }[] = [
  { at: 5, intent: { type: 'ADMINISTER', drugId: 'epinephrine', route: 'IV_PUSH', dose: 1, unit: 'mg', label: '1 mg' } },
  { at: 12, intent: { type: 'EAT', foodId: 'pizza_slice', portions: 2 } },
  { at: 20, intent: { type: 'HAEMORRHAGE', volume_mL: 500 } },
  { at: 30, intent: { type: 'FORCE_RHYTHM', rhythm: 'afib' } },
  { at: 45, intent: { type: 'ADMINISTER', drugId: 'fentanyl', route: 'IV_PUSH', dose: 100, unit: 'mcg', label: '100 mcg' } },
];

describe('determinism (spec 4.1)', () => {
  it('produces identical state at t=60s for the same seed and intent log', () => {
    const a = run({ seed: 0x5eed, seconds: 60, intents: INTENTS });
    const b = run({ seed: 0x5eed, seconds: 60, intents: INTENTS });
    expect(hashSnapshot(b.final)).toBe(hashSnapshot(a.final));
  });

  it('diverges when the seed changes, so the hash is actually sensitive', () => {
    // A hash that never changes would make the test above vacuous.
    const a = run({ seed: 0x5eed, seconds: 60, intents: [...INTENTS, { at: 40, intent: { type: 'FORCE_RHYTHM', rhythm: 'vfib' } }] });
    const b = run({ seed: 0xf00d, seconds: 60, intents: [...INTENTS, { at: 40, intent: { type: 'FORCE_RHYTHM', rhythm: 'vfib' } }] });
    expect(hashSnapshot(b.final)).not.toBe(hashSnapshot(a.final));
  });

  it('diverges when one intent moves by a single tick', () => {
    const shifted = INTENTS.map((x, i) => (i === 0 ? { ...x, at: x.at + DT } : x));
    const a = run({ seed: 0x5eed, seconds: 60, intents: INTENTS });
    const b = run({ seed: 0x5eed, seconds: 60, intents: shifted });
    expect(hashSnapshot(b.final)).not.toBe(hashSnapshot(a.final));
  });

  it('reproduces the whole trajectory, not just the endpoint', () => {
    const a = run({ seed: 7, seconds: 40, intents: INTENTS, sampleEvery: 2 });
    const b = run({ seed: 7, seconds: 40, intents: INTENTS, sampleEvery: 2 });
    expect(a.samples.length).toBeGreaterThan(15);
    for (let i = 0; i < a.samples.length; i++) {
      expect(hashSnapshot(b.samples[i])).toBe(hashSnapshot(a.samples[i]));
    }
  });
});

describe('seeded PRNG', () => {
  it('is reproducible and restorable from its serialised state', () => {
    const a = new Rng(12345);
    const first = [a.next(), a.next(), a.next()];
    const state = a.getState();
    const mid = [a.next(), a.next()];

    const b = new Rng(12345);
    expect([b.next(), b.next(), b.next()]).toEqual(first);
    b.setState(state);
    expect([b.next(), b.next()]).toEqual(mid);
  });

  it('produces a roughly uniform distribution', () => {
    const rng = new Rng(99);
    const buckets = new Array(10).fill(0);
    const N = 200000;
    for (let i = 0; i < N; i++) buckets[Math.floor(rng.next() * 10)]++;
    for (const b of buckets) expect(Math.abs(b - N / 10) / (N / 10)).toBeLessThan(0.05);
  });

  it('produces a standard normal with the right moments', () => {
    const rng = new Rng(4242);
    let sum = 0;
    let sumSq = 0;
    const N = 200000;
    for (let i = 0; i < N; i++) {
      const g = rng.gaussian();
      sum += g;
      sumSq += g * g;
    }
    expect(Math.abs(sum / N)).toBeLessThan(0.02);
    expect(Math.abs(Math.sqrt(sumSq / N) - 1)).toBeLessThan(0.02);
  });

  it('forks independent streams without perturbing the parent', () => {
    const parent = new Rng(1);
    const before = parent.getState();
    const child = parent.fork(17);
    expect(parent.getState()).toBe(before);
    expect(child.next()).not.toBe(new Rng(1).next());
  });
});
