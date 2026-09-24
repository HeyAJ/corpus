import type { SimSnapshot } from '../../bridge/types';

/**
 * THE BODY, AUDIBLE.
 *
 * Four sounds, all SYNTHESISED rather than sampled. Not for purity: the project ships no
 * binary assets (ADR-016), the organ meshes are generated for the same reason, and a
 * heartbeat that is computed from stroke volume can get quieter when the heart gets
 * weaker, which a recording cannot.
 *
 *   - the heart, a lub-dub locked to the same cardiac phase that drives the mesh
 *   - the breath, noise whose loudness and colour follow lung inflation
 *   - the monitor beep, one per QRS, its pitch falling with saturation
 *   - the flatline tone, when the trace goes flat
 *
 * EVERYTHING IS DRIVEN FROM THE SNAPSHOT, which is what keeps the sound and the picture
 * honest with each other. The mesh contracts on `cardio.cyclePhase` and so does the
 * first heart sound; if the simulation stutters they stutter together instead of
 * drifting apart, which is far less uncanny than a metronome that is right on average.
 *
 * CLEAN AND SMOOTH MEANS NO ZIPPER NOISE. Every gain change is a ramp, never an
 * assignment, and every ramp ends at a small positive number rather than zero because
 * an exponential ramp cannot reach zero. A click in a medical monitor sound is worse
 * than silence: it reads as a fault in the equipment.
 *
 * Browsers will not start an AudioContext without a gesture, so nothing here runs until
 * the user asks for it. That is a constraint, but it is also the right default for a
 * page that might be open in a lecture theatre.
 */

/** Pulse-oximeter convention: the beep falls in pitch as saturation falls. */
const BEEP_HZ_AT_FULL_SAT = 880;
const BEEP_HZ_PER_PERCENT = 6;
const FLATLINE_HZ = 1000;

export interface VitalsAudioLevels {
  heart: number;
  breath: number;
  monitor: number;
}

export const DEFAULT_LEVELS: VitalsAudioLevels = { heart: 0.9, breath: 0.7, monitor: 0.5 };

export class VitalsAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private heartBus: GainNode | null = null;
  private breathBus: GainNode | null = null;
  private monitorBus: GainNode | null = null;

  /** Looping noise, made once. Re-creating a buffer per breath would allocate forever. */
  private noise: AudioBufferSourceNode | null = null;
  private breathFilter: BiquadFilterNode | null = null;
  private breathEnvelope: GainNode | null = null;

  private flatline: OscillatorNode | null = null;
  private flatlineGain: GainNode | null = null;

  private lastCardiacPhase = 0;
  private lastRespPhase = 0;
  private secondSoundAt: number | null = null;
  private levels: VitalsAudioLevels = { ...DEFAULT_LEVELS };

  get running(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Must be called from a user gesture. Safe to call again; it will resume a suspended context. */
  async start(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }

    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    const ctx = new Ctor();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.0001;
    this.master.connect(ctx.destination);
    // Fade in rather than appearing. 150 ms is below the threshold of feeling slow and
    // well above the threshold of clicking.
    this.master.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 0.15);

    this.heartBus = ctx.createGain();
    this.breathBus = ctx.createGain();
    this.monitorBus = ctx.createGain();
    this.heartBus.gain.value = this.levels.heart;
    this.breathBus.gain.value = this.levels.breath;
    this.monitorBus.gain.value = this.levels.monitor;
    for (const bus of [this.heartBus, this.breathBus, this.monitorBus]) bus.connect(this.master);

    // --- the breath: one looping noise source, shaped continuously ----------
    //
    // Breath sound is broadband noise through a moving band-pass. Inspiration is
    // brighter than expiration because the flow is faster and more turbulent, which is
    // the cue that makes it read as breathing rather than as hiss.
    const seconds = 2;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Slightly correlated noise, closer to breath than to white hiss.
    let previous = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.72 + white * 0.28;
      data[i] = previous * 1.6;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 480;
    filter.Q.value = 0.9;

    const breathEnvelope = ctx.createGain();
    breathEnvelope.gain.value = 0.0001;

    noise.connect(filter);
    filter.connect(breathEnvelope);
    breathEnvelope.connect(this.breathBus);
    noise.start();

    this.noise = noise;
    this.breathFilter = filter;
    this.breathEnvelope = breathEnvelope;
  }

  /** Suspends rather than tears down, so starting again is instant and click-free. */
  async stop(): Promise<void> {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(Math.max(0.0001, this.master.gain.value), now);
    this.master.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    const ctx = this.ctx;
    window.setTimeout(() => {
      void ctx.suspend();
    }, 150);
  }

  setLevels(levels: Partial<VitalsAudioLevels>): void {
    this.levels = { ...this.levels, ...levels };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.heartBus?.gain.setTargetAtTime(this.levels.heart, t, 0.05);
    this.breathBus?.gain.setTargetAtTime(this.levels.breath, t, 0.05);
    this.monitorBus?.gain.setTargetAtTime(this.levels.monitor, t, 0.05);
  }

  /**
   * Called once per snapshot. Everything is edge-triggered off the phases the renderer
   * uses, so the sound cannot drift away from the picture.
   */
  update(s: SimSnapshot): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;

    const rhythm = s.cardio.rhythm;
    const pulseless = rhythm === 'asystole' || rhythm === 'vfib' || rhythm === 'pea';
    const flat = rhythm === 'asystole';

    // --- the heart ----------------------------------------------------------
    //
    // A wrap in the cardiac phase is a new beat. Phase is the same number the mesh
    // contracts on, so the thump lands on the squeeze.
    const phase = s.cardio.cyclePhase;
    const beat = phase < this.lastCardiacPhase;
    this.lastCardiacPhase = phase;

    if (beat && !pulseless) {
      // Loudness follows stroke volume against a nominal 70 mL, so a failing heart is
      // quieter. This is the thing a recorded sample could never do.
      const strength = Math.max(0.15, Math.min(1.4, s.cardio.strokeVolume_mL / 70));
      this.thump(now, 46, 0.115, 0.5 * strength);

      // The second sound is valve closure at end-systole, not half way through the
      // cycle: it tracks systolic duration, which is why the lub-dub gets closer
      // together as the heart speeds up instead of staying a fixed fraction apart.
      const rrSeconds = 60 / Math.max(20, s.cardio.heartRate_bpm);
      this.secondSoundAt = now + Math.min(0.42, rrSeconds * 0.36);

      this.beep(now, s.resp.spo2);
    }

    if (this.secondSoundAt !== null && now >= this.secondSoundAt) {
      this.thump(this.secondSoundAt, 62, 0.075, 0.3);
      this.secondSoundAt = null;
    }

    // --- the breath ---------------------------------------------------------
    //
    // Driven by inflation rather than by rate, so an agonal 100 mL gasp is audibly a
    // gasp and a deep breath is audibly deep.
    if (this.breathEnvelope && this.breathFilter) {
      const inflation = Math.max(0, Math.min(1.4, s.resp.inflation));
      const rising = s.resp.cyclePhase < this.lastRespPhase ? false : s.resp.cyclePhase < 0.45;
      this.lastRespPhase = s.resp.cyclePhase;

      const target = Math.max(0.0001, inflation * 0.5);
      this.breathEnvelope.gain.setTargetAtTime(target, now, 0.09);
      // Inspiration is brighter than expiration; the shift is what makes it read as
      // breathing rather than as a swell of noise.
      this.breathFilter.frequency.setTargetAtTime(rising ? 620 : 380, now, 0.12);
    }

    // --- the flatline -------------------------------------------------------
    if (flat) this.startFlatline(now);
    else this.stopFlatline(now);
  }

  /** A heart sound: a damped low sine, filtered so it is a thud and not a tone. */
  private thump(at: number, hz: number, seconds: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.heartBus) return;
    const when = Math.max(at, ctx.currentTime);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(hz * 1.7, when);
    // The pitch drop is what gives it a body rather than a beep.
    osc.frequency.exponentialRampToValueAtTime(hz, when + seconds * 0.7);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), when + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, when + seconds);

    osc.connect(lp);
    lp.connect(env);
    env.connect(this.heartBus);
    osc.start(when);
    osc.stop(when + seconds + 0.02);
  }

  /** The monitor blip. Pitch falls with saturation, as a real oximeter does. */
  private beep(at: number, spo2: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.monitorBus) return;
    const when = Math.max(at, ctx.currentTime);
    const percent = Math.max(70, Math.min(100, spo2 * 100));
    const hz = BEEP_HZ_AT_FULL_SAT - (100 - percent) * BEEP_HZ_PER_PERCENT;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = hz;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(0.22, when + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, when + 0.075);

    osc.connect(env);
    env.connect(this.monitorBus);
    osc.start(when);
    osc.stop(when + 0.1);
  }

  private startFlatline(now: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.monitorBus || this.flatline) return;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = FLATLINE_HZ;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    // Deliberately slower than the blip. An alarm that snaps on sounds like a glitch;
    // one that swells sounds like an alarm.
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.25);
    osc.connect(gain);
    gain.connect(this.monitorBus);
    osc.start(now);
    this.flatline = osc;
    this.flatlineGain = gain;
  }

  private stopFlatline(now: number): void {
    if (!this.flatline || !this.flatlineGain) return;
    const osc = this.flatline;
    const gain = this.flatlineGain;
    this.flatline = null;
    this.flatlineGain = null;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.stop(now + 0.22);
  }

  dispose(): void {
    this.noise?.stop();
    void this.ctx?.close();
    this.ctx = null;
  }
}
