import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/sim/core/engine';
import { P } from '../../src/sim/core/constants';
import { anatomySignals, buildAnatomy } from '../../src/sim/derive/anatomy';
import { ANATOMY_SIGNALS, type AnatomySignal } from '../../src/data/anatomy-types';

/**
 * THE ANATOMY ACTIVITY DERIVER.
 *
 * Signals are display indices, so these tests check three things: that a resting body
 * reads as rest (so no part glows for no reason), that the deriver is a pure reader, and
 * that the signals move the way the state moves in the handful of scenarios a person
 * would try first.
 */

const DT = P('sim.dt_s');

function advance(e: Engine, seconds: number): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    e.tick(DT);
    e.pending.length = 0;
  }
}

/** The shared record is overwritten by the next call, so a test that compares keeps a copy. */
function sample(e: Engine): Record<AnatomySignal, number> {
  return { ...anatomySignals(e.state) };
}

/** Signals marked (tonic) or (cyclic) in anatomy-types.ts: allowed to be non-zero at rest. */
const TONIC = new Set<AnatomySignal>(['awake', 'consciousness', 'night', 'bladderFill', 'beat', 'inspiration']);

/**
 * Signals that are NOT marked tonic but read above 0.06 at rest, each with the reason and
 * a looser ceiling that still catches a real regression. They are honest readings of the
 * model, not errors of the definition:
 *  - parasympathetic, baroreflex: resting vagal tone and resting baroreceptor firing sit
 *    away from the 0.5 mid-point the formulas centre on; they are tonic by nature.
 *  - cortisol: the run starts at 08:00, the circadian peak, which is above the hormone's
 *    mean baseline that the "above baseline" reference uses.
 *  - insulin: the settled resting insulin sits a little above the minimal model's basal
 *    constant that the display reference uses.
 *  - hepaticOutput: borderline (about 0.06) from the resting glycogenolysis term.
 */
const REST_EXEMPT = new Map<AnatomySignal, number>([
  ['parasympathetic', 0.3],
  ['baroreflex', 0.4],
  ['cortisol', 0.3],
  ['insulin', 0.15],
  ['hepaticOutput', 0.15],
]);

describe('anatomy signals at rest', () => {
  it('are finite, in range, and near zero unless tonic', () => {
    const e = new Engine(0x5eed);
    advance(e, 30);
    const sig = sample(e);
    for (const name of ANATOMY_SIGNALS) {
      const v = sig[name];
      expect(Number.isFinite(v), name).toBe(true);
      expect(v, name).toBeGreaterThanOrEqual(0);
      expect(v, name).toBeLessThanOrEqual(1);
      if (TONIC.has(name)) continue;
      expect(v, `${name} at rest`).toBeLessThan(REST_EXEMPT.get(name) ?? 0.06);
    }
    expect(sig.awake).toBe(1);
    expect(sig.consciousness).toBeGreaterThan(0.95);
  });
});

describe('buildAnatomy', () => {
  it('does not mutate the state', () => {
    const e = new Engine(0x5eed);
    advance(e, 5);
    const before = structuredClone(e.state);
    buildAnatomy(e.state);
    expect(e.state).toEqual(before);
  });

  it('returns finite values in range, and the five nerve classes', () => {
    const e = new Engine(0x5eed);
    advance(e, 5);
    const a = buildAnatomy(e.state);
    for (const v of [...Object.values(a.parts), ...Object.values(a.organs), ...Object.values(a.nerves)]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
    expect(Object.keys(a.nerves).sort()).toEqual(['motor', 'pain', 'parasympathetic', 'sensory', 'sympathetic']);
    expect(a.glands.pineal).toBeCloseTo(0.2, 6); // 08:00: day, so the dark-phase term is 0
    expect(a.glands.placenta).toBe(0);
  });

  it('is deterministic across two engines with the same seed', () => {
    const a = new Engine(0x5eed);
    const b = new Engine(0x5eed);
    advance(a, 20);
    advance(b, 20);
    expect(JSON.stringify(buildAnatomy(a.state))).toBe(JSON.stringify(buildAnatomy(b.state)));
  });
});

describe('anatomy signals respond to the body', () => {
  it('exertion raises exertion, heartRate, ventilation and sympathetic', () => {
    const e = new Engine(0x5eed);
    advance(e, 10);
    const rest = sample(e);
    e.applyIntent({ type: 'SET_EXERTION', level: 0.8 } as never);
    advance(e, 120);
    const work = sample(e);
    expect(work.exertion).toBeGreaterThan(rest.exertion + 0.3);
    expect(work.heartRate).toBeGreaterThan(rest.heartRate + 0.3);
    expect(work.ventilation).toBeGreaterThan(rest.ventilation + 0.3);
    expect(work.sympathetic).toBeGreaterThan(rest.sympathetic + 0.3);
    expect(buildAnatomy(e.state).nerves.motor).toBeGreaterThan(0.3);
  });

  it('fright raises fright and sympathetic', () => {
    const e = new Engine(0x5eed);
    advance(e, 10);
    const rest = sample(e);
    e.applyIntent({ type: 'FRIGHTEN', intensity: 1 } as never);
    advance(e, 2);
    const scared = sample(e);
    expect(scared.fright).toBeGreaterThan(rest.fright + 0.3);
    expect(scared.sympathetic).toBeGreaterThan(rest.sympathetic + 0.3);
  });

  it('a 1.5 L haemorrhage raises hypovolaemia', () => {
    const e = new Engine(0x5eed);
    advance(e, 10);
    const rest = sample(e);
    e.applyIntent({ type: 'HAEMORRHAGE', volume_mL: 1500 } as never);
    advance(e, 60);
    expect(sample(e).hypovolaemia).toBeGreaterThan(rest.hypovolaemia + 0.1);
  });
});
