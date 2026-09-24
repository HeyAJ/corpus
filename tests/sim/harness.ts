import { Engine } from '../../src/sim/core/engine';
import { P } from '../../src/sim/core/constants';
import type { SimIntent, SimSnapshot } from '../../src/bridge/types';

/**
 * Headless deterministic harness (spec 12).
 *
 * No wall clock, no timers, no worker. A plain loop over the fixed timestep, which
 * is the only way "same seed + same intent log = identical output" can be a
 * meaningful claim: if the number of steps depended on how fast the machine ran,
 * determinism would be untestable and therefore untrue.
 */

export const DT = P('sim.dt_s');

export interface ScheduledIntent {
  /** Simulated seconds at which to dispatch. */
  at: number;
  intent: SimIntent;
}

export interface RunOptions {
  seed?: number;
  seconds: number;
  intents?: ScheduledIntent[];
  /** Called every `sampleEvery` simulated seconds with a fresh snapshot. */
  onSample?: (s: SimSnapshot) => void;
  sampleEvery?: number;
}

export function run(options: RunOptions): { engine: Engine; final: SimSnapshot; samples: SimSnapshot[] } {
  const engine = new Engine(options.seed ?? 0x5eed);
  const steps = Math.round(options.seconds / DT);
  const pending = [...(options.intents ?? [])].sort((a, b) => a.at - b.at);
  const sampleEvery = options.sampleEvery ?? 0;
  const sampleStride = sampleEvery > 0 ? Math.max(1, Math.round(sampleEvery / DT)) : 0;
  const samples: SimSnapshot[] = [];

  let cursor = 0;
  for (let i = 0; i < steps; i++) {
    const t = i * DT;
    while (cursor < pending.length && pending[cursor].at <= t) {
      engine.applyIntent(pending[cursor].intent);
      cursor++;
    }
    engine.tick(DT);
    // The worker drains this every tick; a long headless run would otherwise grow
    // an unbounded array and dominate the test's memory.
    engine.pending.length = 0;

    if (sampleStride > 0 && i % sampleStride === 0) {
      const s = engine.snapshot();
      samples.push(s);
      options.onSample?.(s);
    }
  }

  return { engine, final: engine.snapshot(), samples };
}

/** A stable digest of the whole state vector, for the determinism test. */
export function hashSnapshot(s: SimSnapshot): string {
  const scalars: number[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'number') {
      scalars.push(v);
    } else if (typeof v === 'boolean') {
      scalars.push(v ? 1 : 0);
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x);
    } else if (v && typeof v === 'object') {
      for (const k of Object.keys(v).sort()) {
        if (k === 'wallClock_ms' || k === 'tickCost_ms') continue; // wall clock, not state
        walk((v as Record<string, unknown>)[k]);
      }
    } else if (typeof v === 'string') {
      for (let i = 0; i < v.length; i++) scalars.push(v.charCodeAt(i));
    }
  };
  walk(s);

  // FNV-1a over the IEEE-754 bit patterns, so two runs must agree bit for bit and
  // not merely to a printed precision.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const buf = new ArrayBuffer(8);
  const f64 = new Float64Array(buf);
  const u32 = new Uint32Array(buf);
  for (const n of scalars) {
    f64[0] = n;
    h1 = Math.imul(h1 ^ u32[0], 0x01000193) >>> 0;
    h1 = Math.imul(h1 ^ u32[1], 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (u32[0] + 0x9e3779b9), 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

/** Physiological reference ranges for the homeostasis test. */
export const NORMAL = {
  heartRate: [50, 100] as const,
  systolic: [95, 145] as const,
  diastolic: [55, 95] as const,
  map: [70, 105] as const,
  ejectionFraction: [0.5, 0.75] as const,
  cardiacOutput: [4.0, 7.0] as const,
  strokeVolume: [55, 100] as const,
  edv: [95, 150] as const,
  spo2: [0.94, 1.0] as const,
  paco2: [35, 45] as const,
  pao2: [80, 110] as const,
  respRate: [10, 18] as const,
  gfr: [90, 140] as const,
  glucose: [70, 110] as const,
  coreTemp: [36.4, 37.6] as const,
  potassium: [3.5, 5.2] as const,
  lactate: [0.3, 2.0] as const,
};

export function expectWithin(
  label: string,
  value: number,
  range: readonly [number, number],
): void {
  if (value < range[0] || value > range[1]) {
    throw new Error(`${label} = ${value.toFixed(3)}, outside the physiological range ${range[0]}..${range[1]}`);
  }
}
