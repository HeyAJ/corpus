/**
 * Determinism (spec 4.1): the core owns exactly one PRNG. Nothing in src/sim may
 * call Math.random — the ESLint override in .eslintrc.cjs makes that a build error.
 *
 * mulberry32: 32-bit state, period 2^32, passes gjrand and PractRand to 32 GB.
 * Chosen because the whole state is one uint32, so a snapshot can carry it and a
 * replay can restore it exactly.
 */
export class Rng {
  private s: number;
  private spare: number | null = null;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  /** Standard normal, Marsaglia polar. Caches the spare so pairs stay deterministic. */
  gaussian(): number {
    if (this.spare !== null) {
      const v = this.spare;
      this.spare = null;
      return v;
    }
    let u: number, v: number, s: number;
    do {
      u = this.next() * 2 - 1;
      v = this.next() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const mul = Math.sqrt((-2 * Math.log(s)) / s);
    this.spare = v * mul;
    return u * mul;
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Serialise for snapshot / replay. */
  getState(): number {
    return this.s;
  }

  setState(s: number): void {
    this.s = s >>> 0;
    this.spare = null;
  }

  /**
   * A child stream, derived deterministically from this one. Lets an independent
   * subsystem (e.g. AF interval jitter) draw numbers without perturbing the parent
   * sequence, which is what makes "same seed + same intents" reproducible even when
   * a subsystem is toggled on and off.
   */
  fork(tag: number): Rng {
    return new Rng((Math.imul(this.s ^ tag, 0x9e3779b1) ^ (tag << 7)) >>> 0);
  }
}
