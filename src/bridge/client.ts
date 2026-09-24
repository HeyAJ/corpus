import * as Comlink from 'comlink';
import { WaveformRing, type WaveformRingBuffers } from './ring';
import { WAVEFORM_CHANNELS, type SimIntent, type SimSnapshot, type WaveformChannel } from './types';

/**
 * THE MAIN-THREAD SIDE OF THE BRIDGE (spec 3).
 *
 * Owns the worker, the Comlink proxy and the waveform ring. Everything the UI and
 * the renderer know about the simulation comes through here, and every message in
 * the other direction is a discrete `SimIntent` — never a direct state write.
 *
 * DEGRADED MODE. The 250 Hz waveform channel wants a SharedArrayBuffer, which needs
 * the page to be cross-origin isolated (COOP + COEP). Those headers are set by the
 * Vite plugin in dev and must be set by the host in production. When they are
 * absent, `sharedArrayBuffer` comes back false and the client polls
 * `takeWaveformChunk()` every 50 ms for a transferred Float32Array instead. The
 * traces still work; they arrive in 50 ms bursts rather than continuously, and the
 * degradation is recorded in docs/MODEL_LIMITATIONS.md and surfaced in the UI.
 */

export interface ShockResult {
  delivered: boolean;
  reason: string;
  converted: boolean;
  probability: number;
}

interface WorkerApi {
  init(seed: number): Promise<{ buffers: WaveformRingBuffers; sharedArrayBuffer: boolean }>;
  start(): void;
  stop(): void;
  dispatch(intent: SimIntent): void;
  onSnapshot(cb: (s: SimSnapshot) => void): void;
  takeShockResult(): Promise<ShockResult | null>;
  takeWaveformChunk(): Promise<Float32Array>;
  runFor(seconds: number): Promise<SimSnapshot>;
}

const FALLBACK_POLL_MS = 50;

export class SimClient {
  private worker: Worker;
  private api: Comlink.Remote<WorkerApi>;
  ring: WaveformRing | null = null;
  sharedArrayBuffer = false;
  private fallbackTimer: ReturnType<typeof setInterval> | null = null;
  private shockTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
    this.api = Comlink.wrap<WorkerApi>(this.worker);
  }

  async init(
    seed: number,
    onSnapshot: (s: SimSnapshot) => void,
    onShock: (r: ShockResult) => void,
  ): Promise<{ sharedArrayBuffer: boolean }> {
    const { buffers, sharedArrayBuffer } = await this.api.init(seed);
    this.sharedArrayBuffer = sharedArrayBuffer && typeof SharedArrayBuffer !== 'undefined';
    this.ring = new WaveformRing(buffers, false);

    await this.api.onSnapshot(Comlink.proxy(onSnapshot));

    if (!this.sharedArrayBuffer) {
      this.fallbackTimer = setInterval(() => {
        void this.drainFallback();
      }, FALLBACK_POLL_MS);
    }

    // Shock outcomes are pulled rather than pushed, because they are rare and the
    // UI wants them exactly once.
    this.shockTimer = setInterval(() => {
      void this.api.takeShockResult().then((r) => {
        if (r) onShock(r);
      });
    }, 120);

    await this.api.start();
    return { sharedArrayBuffer: this.sharedArrayBuffer };
  }

  private async drainFallback(): Promise<void> {
    if (!this.ring) return;
    const chunk = await this.api.takeWaveformChunk();
    const channels = WAVEFORM_CHANNELS.length;
    for (let i = 0; i + channels <= chunk.length; i += channels) {
      this.ring.push(chunk.subarray(i, i + channels));
    }
  }

  dispatch(intent: SimIntent): void {
    void this.api.dispatch(intent);
  }

  channelIndex(channel: WaveformChannel): number {
    return WAVEFORM_CHANNELS.indexOf(channel);
  }

  dispose(): void {
    if (this.fallbackTimer !== null) clearInterval(this.fallbackTimer);
    if (this.shockTimer !== null) clearInterval(this.shockTimer);
    void this.api.stop();
    this.worker.terminate();
  }
}
