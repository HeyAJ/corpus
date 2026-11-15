import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/sim/core/engine';
import { P } from '../../src/sim/core/constants';
import { anatomySignals, buildAnatomy } from '../../src/sim/derive/anatomy';
import organsFile from '../../src/data/organs.json';
import { ANATOMY, atlasOf } from '../../src/data/anatomy';
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
      expect(v, `${name} at rest`).toBeLessThan(0.06);
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

describe('every part of a resting body sits at its own resting level', () => {
  // WHAT WAS WRONG: five signals (baroreflex, parasympathetic, cortisol, insulin,
  // hepaticOutput) read 0.06 to 0.28 in a resting body and the test above hid it behind a
  // looser limit, so the medulla, vagal nuclei, adrenal cortex, islets and liver glowed
  // with nothing happening. They now measure departure from the settled body's own rest
  // (cortisol from the circadian expectation for the hour), so this must hold all day.
  it('is within 0.03 of the JSON rest at boot, 2 h, 8 h and 16 h', () => {
    const e = new Engine(0x5eed);
    const check = (label: string): void => {
      const a = buildAnatomy(e.state);
      let n = 0;
      const bad: string[] = [];
      for (const o of organsFile.organs as unknown as { id: string; atlas?: string; sex?: string; pregnancyOnly?: boolean }[]) {
        const file = ANATOMY[atlasOf(o)];
        for (const p of file ? file.parts : []) {
          const v = a.parts[`${o.id}.${p.id}`];
          if (v === undefined) continue; // other sex, or pregnancy-only
          // A part driven by `night` follows the pineal's light-dark cycle by design (the
          // signal is marked cyclic in anatomy-types.ts), so at 16 h (midnight) it is
          // rightly away from its daytime rest. It is the only such part.
          if (p.drives.some((d) => d.signal === 'night')) continue;
          // bladderFill is bladder volume over capacity, and a living bladder is never empty: it fills continuously, so it is state, not a defect.
          if (p.drives.some((d) => d.signal === 'bladderFill')) continue;
          n++;
          if (Math.abs(v - p.rest) > 0.03) bad.push(`${o.id}.${p.id} ${v.toFixed(3)} vs rest ${p.rest}`);
        }
      }
      expect(bad, `${label}: parts away from rest`).toEqual([]);
      expect(n, `${label} parts checked`).toBeGreaterThan(50);
    };
    check('boot');
    let done = 0;
    for (const h of [2, 8, 16]) {
      advance(e, (h - done) * 3600);
      done = h;
      check(`${h} h`);
    }
  }, 900_000);
});
