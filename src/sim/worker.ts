import * as Comlink from 'comlink';
import { Engine } from './core/engine';
import { P } from './core/constants';
import { WaveformRing, createWaveformBuffers, type WaveformRingBuffers } from '../bridge/ring';
import type { SimIntent, SimSnapshot } from '../bridge/types';

/**
 * THE WORKER — Layer A's only entry point (spec 3).
 *
 * Owns the fixed-step loop. Nothing here imports three.js, React or the DOM; the
 * ESLint override in .eslintrc.cjs makes that a build error rather than a code
 * review note.
 *
 * TIME MODEL (spec 4.1). Fixed timestep with an accumulator. `dt` is always 10 ms
 * of *simulated* time. `timeScale` changes how many steps are taken per wall-clock
 * second — it never changes `dt`. That is the whole reason a time-scale change
 * cannot produce a discontinuity in any state variable: every integrator sees the
 * same step it always saw, just more of them.
 *
 * Wall-clock catch-up is capped. If the tab is backgrounded for a minute, we do not
 * then run six thousand ticks in one frame; we drop the backlog and carry on, which
 * keeps the worker responsive at the cost of simulated time, and says so.
 */

const DT = P('sim.dt_s');
const SNAPSHOT_INTERVAL_MS = 1000 / P('sim.snapshotRate_Hz');
const MAX_CATCHUP_S = 0.25;

export interface SimWorkerApi {
  init(seed: number): Promise<{ buffers: WaveformRingBuffers; sharedArrayBuffer: boolean }>;
  start(): void;
  stop(): void;
  dispatch(intent: SimIntent): void;
  /** Push-based snapshot delivery. The callback is a Comlink proxy. */
  onSnapshot(cb: (s: SimSnapshot) => void): void;
  /** Pull the last shock outcome, then clear it. */
  takeShockResult(): { delivered: boolean; reason: string; converted: boolean; probability: number } | null;
  /** Fallback transport when SharedArrayBuffer is unavailable (spec 3). */
  takeWaveformChunk(): Float32Array;
  /** Deterministic stepping for tests and for headless replay. */
  runFor(seconds: number): SimSnapshot;
}

class SimWorker implements SimWorkerApi {
  private engine = new Engine(0x5eed);
  private ring: WaveformRing | null = null;
  private buffers: WaveformRingBuffers | null = null;
  private shared = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private accumulator = 0;
  private lastWall = 0;
  private lastSnapshot = 0;
  private snapshotCb: ((s: SimSnapshot) => void) | null = null;
  /** Fallback path: frames accumulate here and are transferred every 50 ms. */
  private fallbackFrames: number[] = [];

  async init(seed: number): Promise<{ buffers: WaveformRingBuffers; sharedArrayBuffer: boolean }> {
    this.engine = new Engine(seed);
    this.buffers = createWaveformBuffers();
    this.shared = this.buffers.shared;
    this.ring = new WaveformRing(this.buffers, true);
    return { buffers: this.buffers, sharedArrayBuffer: this.shared };
  }

  onSnapshot(cb: (s: SimSnapshot) => void): void {
    this.snapshotCb = cb;
  }

  start(): void {
    if (this.timer !== null) return;
    this.engine.state.running = true;
    this.lastWall = performance.now();
    this.lastSnapshot = this.lastWall;
    // 4 ms is below the 5 ms clamp browsers apply to nested timers, so this
    // effectively runs as fast as the event loop allows without starving it.
    this.timer = setInterval(() => this.frame(), 4);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.engine.state.running = false;
  }

  dispatch(intent: SimIntent): void {
    this.engine.applyIntent(intent);
    if (intent.type === 'PAUSE') this.stop();
    if (intent.type === 'START') this.start();
  }

  takeShockResult(): SimWorkerApi extends { takeShockResult(): infer R } ? R : never {
    const r = this.engine.lastShock;
    this.engine.lastShock = null;
    return r as never;
  }

  takeWaveformChunk(): Float32Array {
    const out = new Float32Array(this.fallbackFrames);
    this.fallbackFrames.length = 0;
    return Comlink.transfer(out, [out.buffer]) as unknown as Float32Array;
  }

  /** Headless deterministic stepping. No wall clock, no timers (spec 12). */
  runFor(seconds: number): SimSnapshot {
    const steps = Math.round(seconds / DT);
    for (let i = 0; i < steps; i++) {
      this.engine.tick(DT);
      this.drainWaveforms();
    }
    return this.engine.snapshot();
  }

  private frame(): void {
    const now = performance.now();
    let elapsed = (now - this.lastWall) / 1000;
    this.lastWall = now;

    if (elapsed > MAX_CATCHUP_S) elapsed = MAX_CATCHUP_S;
    if (!this.engine.state.running) return;

    // Scale the NUMBER of steps, never dt.
    this.accumulator += elapsed * this.engine.state.timeScale;

    let steps = 0;
    const MAX_STEPS_PER_FRAME = 400;
    while (this.accumulator >= DT && steps < MAX_STEPS_PER_FRAME) {
      this.engine.tick(DT);
      this.drainWaveforms();
      this.accumulator -= DT;
      steps++;
    }
    if (steps >= MAX_STEPS_PER_FRAME) this.accumulator = 0;

    if (now - this.lastSnapshot >= SNAPSHOT_INTERVAL_MS) {
      this.lastSnapshot = now;
      this.snapshotCb?.(this.engine.snapshot());
    }
  }

  private drainWaveforms(): void {
    const pending = this.engine.pending;
    if (pending.length === 0) return;
    for (const frame of pending) {
      if (this.ring) this.ring.push(frame);
      if (!this.shared) {
        for (const v of frame) this.fallbackFrames.push(v);
        // Keep the fallback queue bounded if the main thread stops draining it.
        if (this.fallbackFrames.length > 8000) this.fallbackFrames.splice(0, this.fallbackFrames.length - 8000);
      }
    }
    pending.length = 0;
  }
}

Comlink.expose(new SimWorker());
