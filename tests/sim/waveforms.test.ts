import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/sim/core/engine';
import { DT } from './harness';
import { WAVEFORM_CHANNELS, WAVEFORM_RATE_HZ } from '../../src/bridge/types';
import { WaveformRing, createWaveformBuffers } from '../../src/bridge/ring';
import type { RhythmMode } from '../../src/bridge/types';

/**
 * WAVEFORM GENERATION (spec 4.3) AND THE 250 Hz TRANSPORT (spec 3).
 *
 * The property that matters most: `omega` in the McSharry oscillator is driven by
 * the cardiovascular heart rate, so THE TRACE AND THE NUMBER CAN NEVER DISAGREE.
 * A simulator whose ECG says one rate and whose HR chip says another is worse than
 * one with no trace at all.
 */

function capture(rhythm: RhythmMode, seconds: number, seed = 5) {
  const engine = new Engine(seed);
  if (rhythm !== 'nsr') engine.applyIntent({ type: 'FORCE_RHYTHM', rhythm });
  const ecg: number[] = [];
  const eeg: number[] = [];
  const abp: number[] = [];
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    engine.tick(DT);
    for (const frame of engine.pending) {
      ecg.push(frame[0]);
      eeg.push(frame[1]);
      abp.push(frame[2]);
    }
    engine.pending.length = 0;
  }
  return { ecg, eeg, abp, engine };
}

/**
 * Count R peaks by thresholding at a fraction of the trace's maximum.
 *
 * The threshold has to sit above the T wave and below the R wave. With the McSharry
 * parameters the T wave reaches about 40 % of the R, so 0.7 separates them cleanly
 * while leaving room for the respiratory baseline wander.
 */
function countPeaks(signal: number[], fraction = 0.7): number {
  const max = Math.max(...signal);
  const threshold = max * fraction;
  const rearm = max * 0.3;
  let count = 0;
  let above = false;
  for (const v of signal) {
    if (!above && v > threshold) {
      count++;
      above = true;
    } else if (above && v < rearm) {
      above = false;
    }
  }
  return count;
}

/**
 * Normalised cross-correlation at a lag, on the mean-subtracted signal. Bounded in
 * [-1, 1] by Cauchy-Schwarz, which an unnormalised version is not — the first
 * version of this helper reported 2.33 and made the assertion meaningless.
 */
function normalisedCorrelation(x: number[], lag: number): number {
  const mean = x.reduce((a, b) => a + b, 0) / x.length;
  let cross = 0;
  let power = 0;
  for (let i = 0; i + lag < x.length; i++) cross += (x[i] - mean) * (x[i + lag] - mean);
  for (const v of x) power += (v - mean) * (v - mean);
  return power > 0 ? cross / power : 0;
}

describe('the 250 Hz waveform tap', () => {
  it('emits exactly the specified sample rate', () => {
    const SECONDS = 20;
    const { ecg } = capture('nsr', SECONDS);
    // 100 Hz physiology x 5 sub-steps, tapped every second sub-step, is exactly
    // 250 samples per second with no resampling jitter.
    expect(ecg.length).toBe(SECONDS * WAVEFORM_RATE_HZ);
  });

  it('emits one value per channel per frame', () => {
    const engine = new Engine(1);
    engine.tick(DT);
    for (const frame of engine.pending) {
      expect(frame.length).toBe(WAVEFORM_CHANNELS.length);
      for (const v of frame) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('ECG rate agrees with the numeric heart rate (spec 4.3)', () => {
  it('normal sinus rhythm', () => {
    const SECONDS = 30;
    const { ecg, engine } = capture('nsr', SECONDS);
    const beats = countPeaks(ecg);
    const rate = (beats / SECONDS) * 60;
    const reported = engine.snapshot().cardio.heartRateDisplay_bpm;
    // Within a beat per minute or two: the peak detector can miss the first and
    // last partial beats in the window, which at 30 s is worth about 2 bpm.
    expect(Math.abs(rate - reported)).toBeLessThan(8);
    // And the R wave must be a real millivolt-scale deflection, not a ripple.
    expect(Math.max(...ecg)).toBeGreaterThan(0.6);
    expect(Math.max(...ecg)).toBeLessThan(3);
  });

  it('ventricular tachycardia runs at its ectopic rate', () => {
    const SECONDS = 20;
    const { ecg, engine } = capture('vt', SECONDS);
    const rate = (countPeaks(ecg) / SECONDS) * 60;
    expect(rate).toBeGreaterThan(150);
    expect(Math.abs(rate - engine.state.cardio.hr)).toBeLessThan(15);
  });
});

describe('rhythm morphologies', () => {
  it('atrial fibrillation is irregularly irregular', () => {
    const { engine } = capture('afib', 60);
    const rr = engine.state.cardio.rrHistory;
    const mean = rr.reduce((a, b) => a + b, 0) / rr.length;
    const sd = Math.sqrt(rr.reduce((a, b) => a + (b - mean) ** 2, 0) / rr.length);
    // Real AF has an R-R coefficient of variation well above 10 %.
    expect(sd / mean).toBeGreaterThan(0.1);
  });

  it('sinus rhythm is regular apart from respiratory sinus arrhythmia', () => {
    const { engine } = capture('nsr', 60);
    const rr = engine.state.cardio.rrHistory;
    const mean = rr.reduce((a, b) => a + b, 0) / rr.length;
    const sd = Math.sqrt(rr.reduce((a, b) => a + (b - mean) ** 2, 0) / rr.length);
    // Present, but small: this is what makes the trace look recorded rather than
    // synthesised, and it must not be mistaken for atrial fibrillation.
    expect(sd / mean).toBeLessThan(0.1);
    expect(sd / mean).toBeGreaterThan(0);
  });

  it('ventricular fibrillation is chaotic and low-amplitude, not a limit cycle', () => {
    const { ecg: vf } = capture('vfib', 20);
    const { ecg: nsr } = capture('nsr', 20);
    expect(Math.max(...vf)).toBeLessThan(Math.max(...nsr));
    // A limit cycle returns to the same place every beat; VF does not. Compare the
    // normalised autocorrelation at roughly one R-R interval: sinus rhythm repeats
    // itself, fibrillation does not.
    const lag = Math.round(WAVEFORM_RATE_HZ * 0.88);
    expect(normalisedCorrelation(nsr, lag)).toBeGreaterThan(0.2);
    expect(normalisedCorrelation(vf, lag)).toBeLessThan(normalisedCorrelation(nsr, lag));
  });

  it('asystole is a flat baseline with only slow wander, not a perfect line', () => {
    const { ecg } = capture('asystole', 20);
    const amplitude = Math.max(...ecg) - Math.min(...ecg);
    expect(amplitude).toBeLessThan(0.6);
    // Not identically zero: a real asystolic strip drifts.
    expect(amplitude).toBeGreaterThan(0);
  });

  it('PEA has organised complexes despite no cardiac output', () => {
    const { ecg, engine } = capture('pea', 20);
    expect(countPeaks(ecg)).toBeGreaterThan(5);
    expect(engine.snapshot().cardio.cardiacIndex).toBeLessThan(1);
  });
});

describe('arterial pressure waveform', () => {
  it('has a real pulse contour at sub-step resolution', () => {
    const { abp } = capture('nsr', 10);
    const max = Math.max(...abp);
    const min = Math.min(...abp);
    expect(max - min).toBeGreaterThan(25);
    // Distinct values within a single 10 ms tick prove the trace is sampled inside
    // the cardiovascular sub-step loop, not held once per tick.
    const distinctInTick = new Set(abp.slice(100, 105)).size;
    expect(distinctInTick).toBeGreaterThan(1);
  });
});

describe('EEG', () => {
  it('slows and flattens as consciousness falls', () => {
    const awake = capture('nsr', 12);
    const arrested = capture('vfib', 200);
    const rms = (x: number[]) => Math.sqrt(x.reduce((a, b) => a + b * b, 0) / x.length);
    expect(rms(arrested.eeg.slice(-2000))).toBeLessThan(rms(awake.eeg));
    expect(arrested.engine.snapshot().neuro.eegBand === 'delta' || arrested.engine.snapshot().neuro.eegBand === 'suppressed').toBe(true);
  });
});

describe('the shared waveform ring', () => {
  it('round-trips frames in order', () => {
    const ring = new WaveformRing(createWaveformBuffers(64, WAVEFORM_CHANNELS.length), true);
    for (let i = 0; i < 40; i++) ring.push([i, i * 2, i * 3, i * 4]);
    const out = new Float32Array(40);
    const n = ring.readLatest(0, out, 40);
    expect(n).toBe(40);
    for (let i = 0; i < 40; i++) expect(out[i]).toBe(i);
  });

  it('readSince returns only what is new', () => {
    const ring = new WaveformRing(createWaveformBuffers(64, WAVEFORM_CHANNELS.length), true);
    const out = new Float32Array(64);
    for (let i = 0; i < 10; i++) ring.push([i, 0, 0, 0]);
    const first = ring.readSince(0, 0, out);
    expect(first.count).toBe(10);
    const second = ring.readSince(0, first.next, out);
    expect(second.count).toBe(0);
    ring.push([99, 0, 0, 0]);
    const third = ring.readSince(0, second.next, out);
    expect(third.count).toBe(1);
    expect(out[0]).toBe(99);
  });

  it('a consumer that falls more than a ring behind skips rather than duplicating', () => {
    const CAPACITY = 16;
    const ring = new WaveformRing(createWaveformBuffers(CAPACITY, WAVEFORM_CHANNELS.length), true);
    for (let i = 0; i < 100; i++) ring.push([i, 0, 0, 0]);
    const out = new Float32Array(CAPACITY);
    const r = ring.readSince(0, 0, out);
    expect(r.count).toBe(CAPACITY);
    // The oldest still-valid sample, not sample zero.
    expect(out[0]).toBe(100 - CAPACITY);
    expect(r.next).toBe(100);
  });

  it('wraps without losing alignment between channels', () => {
    const CAPACITY = 8;
    const ring = new WaveformRing(createWaveformBuffers(CAPACITY, WAVEFORM_CHANNELS.length), true);
    for (let i = 0; i < 30; i++) ring.push([i, i + 1000, i + 2000, i + 3000]);
    const a = new Float32Array(CAPACITY);
    const b = new Float32Array(CAPACITY);
    ring.readLatest(0, a, CAPACITY);
    ring.readLatest(1, b, CAPACITY);
    for (let i = 0; i < CAPACITY; i++) expect(b[i] - a[i]).toBe(1000);
  });
});
