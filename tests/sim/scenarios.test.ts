import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/sim/core/engine';
import { P } from '../../src/sim/core/constants';
import { SCENARIOS } from '../../src/ui/scenarios';

/**
 * THE SCENARIO LIBRARY AND THE SUBJECT.
 *
 * A scenario is a remembered sequence of intents, and the engine refuses any dose that
 * is not a declared preset WITHOUT an error (CLAUDE.md's first trap). A scenario whose
 * preset has drifted out of drugs.json would therefore run, do nothing, and look exactly
 * like a scenario that works. These tests make that failure loud.
 */

const DT = P('sim.dt_s');

function run(e: Engine, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    e.tick(DT);
    e.pending.length = 0;
  }
}

describe('scenarios', () => {
  it('every scenario produces at least one intent', () => {
    for (const sc of SCENARIOS) {
      expect(sc.intents().length, sc.id).toBeGreaterThan(0);
    }
  });

  it('no scenario dose is refused by the engine', () => {
    for (const sc of SCENARIOS) {
      const e = new Engine(0x5eed);
      e.applyIntent({ type: 'IV_ACCESS', on: true } as never);
      for (const intent of sc.intents()) e.applyIntent(intent);
      run(e, 1);
      const refused = e.snapshot().notices.filter((n) => n.tone !== 'info');
      expect(refused.map((n) => n.text), sc.id).toEqual([]);
    }
  });

  it('every scenario moves the body away from rest', () => {
    const control = new Engine(0x5eed);
    run(control, 120);
    const rest = control.snapshot();
    for (const sc of SCENARIOS) {
      // Slow scenarios (infections) need their time scale; approximate it by running
      // longer, capped so the suite stays quick.
      const seconds = Math.min(3600, 120 * (sc.timeScale ?? 1));
      const e = new Engine(0x5eed);
      e.applyIntent({ type: 'IV_ACCESS', on: true } as never);
      for (const intent of sc.intents()) e.applyIntent(intent);
      run(e, seconds);
      const s = e.snapshot();
      const moved =
        Math.abs(s.cardio.heartRateDisplay_bpm - rest.cardio.heartRateDisplay_bpm) > 3 ||
        Math.abs(s.cardio.map_mmHg - rest.cardio.map_mmHg) > 3 ||
        Math.abs(s.resp.spo2 - rest.resp.spo2) > 0.01 ||
        Math.abs(s.resp.paco2_mmHg - rest.resp.paco2_mmHg) > 2 ||
        Math.abs(s.metabolic.glucose_mg_per_dL - rest.metabolic.glucose_mg_per_dL) > 5 ||
        Math.abs(s.metabolic.coreTemp_C - rest.metabolic.coreTemp_C) > 0.1 ||
        Math.abs(s.chem.k_mEq_per_L - rest.chem.k_mEq_per_L) > 0.3 ||
        s.infection.active.some((b) => b.burden > 0.05) ||
        s.cardio.rhythm !== rest.cardio.rhythm;
      expect(moved, sc.id).toBe(true);
    }
  });
});

describe('the subject', () => {
  it('a smaller body reaches a higher drug level from the same dose, a larger one lower', () => {
    const level = (mass: number): number => {
      const e = new Engine(0x5eed);
      e.applyIntent({ type: 'IV_ACCESS', on: true } as never);
      e.applyIntent({ type: 'SET_BODY', mass_kg: mass } as never);
      e.applyIntent({ type: 'ADMINISTER', drugId: 'morphine', route: 'IV_PUSH', dose: 4, unit: 'mg', label: 'x' } as never);
      run(e, 120);
      return e.snapshot().drugs.find((d) => d.drugId === 'morphine')?.plasma_ng_per_mL ?? 0;
    };
    const ref = level(70);
    expect(ref).toBeGreaterThan(0);
    expect(level(45)).toBeGreaterThan(ref * 1.2);
    expect(level(120)).toBeLessThan(ref * 0.85);
  });

  it('changing body size leaves a resting circulation stable', () => {
    for (const mass of [45, 120]) {
      const e = new Engine(0x5eed);
      e.applyIntent({ type: 'SET_BODY', mass_kg: mass } as never);
      run(e, 60);
      const s = e.snapshot();
      expect(s.conditions.map((c) => c.id), `${mass} kg`).toEqual([]);
      expect(s.body.mass_kg).toBe(mass);
    }
  });

  it('rejects non-physical body values instead of producing NaN', () => {
    const e = new Engine(0x5eed);
    e.applyIntent({ type: 'SET_BODY', mass_kg: -5, height_m: 0 } as never);
    run(e, 5);
    const s = e.snapshot();
    expect(Number.isFinite(s.body.bsa_m2)).toBe(true);
    expect(Number.isFinite(s.cardio.cardiacIndex)).toBe(true);
  });
});
