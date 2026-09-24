import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/sim/core/engine';
import { DT } from '../sim/harness';
import { P } from '../../src/sim/core/constants';

/**
 * PERFORMANCE BUDGET (spec 2, 12).
 *
 * "Sim worker tick must complete in < 2 ms at 100 Hz on mid-tier mobile."
 *
 * A CI machine is not mid-tier mobile, so a raw millisecond threshold would either
 * be meaningless here or fail spuriously there. The budget is expressed two ways:
 *
 *   - an absolute ceiling generous enough to pass on a slow shared runner but tight
 *     enough to catch an order-of-magnitude regression;
 *   - a HEADROOM ratio against the 10 ms real-time step, which is the number that
 *     actually determines whether the simulation keeps up. At 300x time scale the
 *     worker must fit 300 ticks into each wall-clock second, so the real budget is
 *     the one this measures.
 */

const TICK_BUDGET_MS = 2.0;
const WARMUP_TICKS = 2000;
const MEASURE_TICKS = 20000;

function measure(prepare: (e: Engine) => void): { mean: number; p95: number; max: number } {
  const engine = new Engine(1);
  prepare(engine);

  for (let i = 0; i < WARMUP_TICKS; i++) {
    engine.tick(DT);
    engine.pending.length = 0;
  }

  const times: number[] = [];
  for (let i = 0; i < MEASURE_TICKS; i++) {
    const t0 = performance.now();
    engine.tick(DT);
    times.push(performance.now() - t0);
    engine.pending.length = 0;
  }
  times.sort((a, b) => a - b);
  return {
    mean: times.reduce((a, b) => a + b, 0) / times.length,
    p95: times[Math.floor(times.length * 0.95)],
    max: times[times.length - 1],
  };
}

describe('simulation tick budget', () => {
  it('an idle body ticks well inside the budget', () => {
    const r = measure(() => {});
    expect(r.mean).toBeLessThan(TICK_BUDGET_MS);
    expect(r.p95).toBeLessThan(TICK_BUDGET_MS);
  });

  it('a fully loaded body still ticks inside the budget', () => {
    // Every subsystem doing work at once: several drugs in the pharmacokinetic
    // loop, receptors binding, food in the tract, an arrhythmia, and compressions.
    const r = measure((e) => {
      e.applyIntent({ type: 'ADMINISTER', drugId: 'epinephrine', route: 'IV_PUSH', dose: 1, unit: 'mg', label: '1 mg' });
      e.applyIntent({ type: 'ADMINISTER', drugId: 'fentanyl', route: 'IV_PUSH', dose: 500, unit: 'mcg', label: '500 mcg' });
      e.applyIntent({ type: 'ADMINISTER', drugId: 'propofol', route: 'IV_DRIP', dose: 630, unit: 'mg', label: '150 mcg/kg/min' });
      e.applyIntent({ type: 'ADMINISTER', drugId: 'norepinephrine', route: 'IV_DRIP', dose: 0.48, unit: 'mg', label: '8 mcg/min' });
      e.applyIntent({ type: 'ADMINISTER', drugId: 'atropine', route: 'IV_PUSH', dose: 1, unit: 'mg', label: '1 mg' });
      e.applyIntent({ type: 'ADMINISTER', drugId: 'furosemide', route: 'IV_PUSH', dose: 40, unit: 'mg', label: '40 mg' });
      e.applyIntent({ type: 'EAT', foodId: 'butter_heavy_meal', portions: 2 });
      e.applyIntent({ type: 'EAT', foodId: 'pizza_slice', portions: 3 });
      e.applyIntent({ type: 'FORCE_RHYTHM', rhythm: 'afib' });
    });
    expect(r.mean).toBeLessThan(TICK_BUDGET_MS);
    expect(r.p95).toBeLessThan(TICK_BUDGET_MS);
  });

  it('leaves enough headroom to run at 300x real time', () => {
    // The time-scale control offers 300x, which means 300 fixed steps must fit into
    // one wall-clock second alongside everything else the worker does. If the mean
    // tick exceeds about 3 ms, 300x silently stops keeping up and simulated time
    // drifts away from the clock without saying so.
    const r = measure((e) => {
      e.applyIntent({ type: 'ADMINISTER', drugId: 'epinephrine', route: 'IV_PUSH', dose: 1, unit: 'mg', label: '1 mg' });
      e.applyIntent({ type: 'EAT', foodId: 'pizza_slice', portions: 2 });
    });
    const maxScale = P('sim.maxTimeScale');
    const secondsOfWorkPerSecond = (r.mean / 1000) * maxScale;
    expect(secondsOfWorkPerSecond).toBeLessThan(0.8);
  });

  it('does not allocate per tick: the snapshot is the only garbage', () => {
    // A growing heap across a long run means something in the hot path is
    // allocating, which will show up as periodic frame drops rather than as a
    // steady cost. Measure the retained size rather than trying to count objects.
    const engine = new Engine(1);
    engine.applyIntent({ type: 'EAT', foodId: 'pizza_slice', portions: 1 });
    for (let i = 0; i < 5000; i++) {
      engine.tick(DT);
      engine.pending.length = 0;
    }
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 100000; i++) {
      engine.tick(DT);
      engine.pending.length = 0;
    }
    const growth = process.memoryUsage().heapUsed - before;
    // 100k ticks is 16 simulated minutes. Anything under a few megabytes is noise
    // from the GC not having run, not a per-tick allocation.
    expect(growth).toBeLessThan(24 * 1024 * 1024);
  });

  it('the waveform tap produces exactly the frames the transport expects', () => {
    const engine = new Engine(1);
    let frames = 0;
    const TICKS = 1000;
    for (let i = 0; i < TICKS; i++) {
      engine.tick(DT);
      frames += engine.pending.length;
      engine.pending.length = 0;
    }
    // 1000 ticks is 10 s, and the ring runs at 250 Hz.
    expect(frames).toBe(Math.round(TICKS * DT * P('sim.waveformRate_Hz')));
  });

  it('reports its own tick cost in the snapshot', () => {
    const engine = new Engine(1);
    for (let i = 0; i < 500; i++) {
      engine.tick(DT);
      engine.pending.length = 0;
    }
    const s = engine.snapshot();
    expect(s.tickCost_ms).toBeGreaterThanOrEqual(0);
    expect(s.tickCost_ms).toBeLessThan(TICK_BUDGET_MS * 5);
  });
}, 300_000);
