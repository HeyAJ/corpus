import { WAVEFORM_CAPACITY, WAVEFORM_CHANNELS, WAVEFORM_RATE_HZ } from './types';

/**
 * Lock-free single-producer / single-consumer ring for the 250 Hz waveform channel.
 *
 * A 20 Hz object snapshot cannot carry a 250 Hz ECG: you would need 12-13 samples
 * per message and the structured clone would dominate the frame budget. So the
 * waveforms go through a SharedArrayBuffer that the worker writes and the main
 * thread reads without copying (spec 3).
 *
 * Layout:
 *   ctrl : Int32Array(4)  [writeIndex, capacity, channels, rateHz]
 *   data : Float32Array(capacity * channels), channel-interleaved
 *
 * Only `writeIndex` is shared mutable state and only the producer writes it, with a
 * release store (Atomics.store). The consumer does an acquire load (Atomics.load).
 * That is sufficient for SPSC; no lock is needed.
 *
 * FALLBACK (spec 3): when SharedArrayBuffer is unavailable — i.e. the page is not
 * cross-origin isolated — `createWaveformRing` returns a ring backed by a plain
 * ArrayBuffer. The worker then transfers a Float32Array chunk every 50 ms instead,
 * and the degradation is recorded in docs/MODEL_LIMITATIONS.md.
 */

const CTRL_WRITE = 0;
const CTRL_CAPACITY = 1;
const CTRL_CHANNELS = 2;
const CTRL_RATE = 3;
const CTRL_LEN = 4;

export interface WaveformRingBuffers {
  ctrl: SharedArrayBuffer | ArrayBuffer;
  data: SharedArrayBuffer | ArrayBuffer;
  shared: boolean;
}

export function sharedArrayBufferAvailable(): boolean {
  return typeof SharedArrayBuffer !== 'undefined' &&
    typeof globalThis.crossOriginIsolated === 'boolean' ? globalThis.crossOriginIsolated : typeof SharedArrayBuffer !== 'undefined';
}

export function createWaveformBuffers(
  capacity = WAVEFORM_CAPACITY,
  channels = WAVEFORM_CHANNELS.length,
): WaveformRingBuffers {
  const ctrlBytes = CTRL_LEN * 4;
  const dataBytes = capacity * channels * 4;
  const canShare = typeof SharedArrayBuffer !== 'undefined';
  if (canShare) {
    return {
      ctrl: new SharedArrayBuffer(ctrlBytes),
      data: new SharedArrayBuffer(dataBytes),
      shared: true,
    };
  }
  return { ctrl: new ArrayBuffer(ctrlBytes), data: new ArrayBuffer(dataBytes), shared: false };
}

export class WaveformRing {
  readonly ctrl: Int32Array;
  readonly data: Float32Array;
  readonly capacity: number;
  readonly channels: number;
  readonly rateHz: number;
  readonly shared: boolean;

  constructor(buffers: WaveformRingBuffers, init: boolean) {
    this.ctrl = new Int32Array(buffers.ctrl);
    this.data = new Float32Array(buffers.data);
    this.shared = buffers.shared;
    this.channels = WAVEFORM_CHANNELS.length;
    this.capacity = this.data.length / this.channels;
    this.rateHz = WAVEFORM_RATE_HZ;
    if (init) {
      this.ctrl[CTRL_CAPACITY] = this.capacity;
      this.ctrl[CTRL_CHANNELS] = this.channels;
      this.ctrl[CTRL_RATE] = this.rateHz;
      this.ctrl[CTRL_WRITE] = 0;
    }
  }

  /** Producer side. `frame` must have exactly `channels` entries. */
  push(frame: ArrayLike<number>): void {
    const w = this.ctrl[CTRL_WRITE];
    const slot = (w % this.capacity) * this.channels;
    for (let c = 0; c < this.channels; c++) this.data[slot + c] = frame[c];
    if (this.shared) Atomics.store(this.ctrl, CTRL_WRITE, w + 1);
    else this.ctrl[CTRL_WRITE] = w + 1;
  }

  /** Consumer side: total samples ever written. */
  writeIndex(): number {
    return this.shared ? Atomics.load(this.ctrl, CTRL_WRITE) : this.ctrl[CTRL_WRITE];
  }

  /**
   * Copy the `count` most recent samples of one channel into `out`, oldest first.
   * Returns how many were actually available.
   */
  readLatest(channel: number, out: Float32Array, count: number): number {
    const w = this.writeIndex();
    const n = Math.min(count, this.capacity, w);
    const start = w - n;
    for (let i = 0; i < n; i++) {
      const slot = ((start + i) % this.capacity) * this.channels + channel;
      out[i] = this.data[slot];
    }
    return n;
  }

  /**
   * Copy every sample of one channel written since `sinceIndex`, oldest first.
   * Returns the new index to pass next time. This is the sweep-renderer's path:
   * it only ever draws the columns that are actually new (spec 8.4).
   */
  readSince(channel: number, sinceIndex: number, out: Float32Array): { count: number; next: number } {
    const w = this.writeIndex();
    let from = sinceIndex;
    // If the consumer fell more than a full ring behind, skip to the oldest valid sample.
    if (w - from > this.capacity) from = w - this.capacity;
    const n = Math.min(w - from, out.length);
    for (let i = 0; i < n; i++) {
      const slot = ((from + i) % this.capacity) * this.channels + channel;
      out[i] = this.data[slot];
    }
    return { count: n, next: from + n };
  }
}

export const CTRL_INDICES = { CTRL_WRITE, CTRL_CAPACITY, CTRL_CHANNELS, CTRL_RATE, CTRL_LEN };
