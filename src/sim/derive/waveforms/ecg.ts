import morphologies from '../../../data/ecg_morphologies.json';
import { P } from '../../core/constants';
import type { SimState } from '../../core/state';
import type { Rng } from '../../core/rng';
import { effect } from '../../core/effects';
import type { RhythmMode } from '../../../bridge/types';

/**
 * ECG GENERATION — McSharry-Clifford dynamical model (spec 4.3).
 *
 *   theta = atan2(y, x)
 *   xdot  = alpha*x - omega*y
 *   ydot  = alpha*y + omega*x
 *   zdot  = -SUM_i a_i * dtheta_i * exp(-dtheta_i^2 / 2 b_i^2) - (z - z0)
 *   alpha = 1 - sqrt(x^2 + y^2),  omega = 2*pi*HR/60
 *
 * omega is driven live by the cardiovascular heart rate, so the trace and the
 * numeric HR chip can never disagree — they are the same variable.
 *
 * Sub-stepping: the physiology loop runs at 100 Hz but these ODEs are much stiffer,
 * so the oscillator is advanced at dt/5 (2 ms, 500 Hz) and every second sub-step is
 * tapped for the 250 Hz waveform ring. The spec suggests dt/4; dt/5 is both finer
 * and makes the 250 Hz output an exact 2:1 decimation instead of a 400 Hz -> 250 Hz
 * resample with sub-sample jitter. Recorded in docs/DECISIONS.md.
 */

export const ECG_SUBSTEPS = 5;

interface EcgEvent {
  id: string;
  theta: number;
  a: number;
  b: number;
}

type MorphKey = 'nsr' | 'afib' | 'vt' | 'pea' | 'asystole';

const MORPHS = morphologies.morphologies as Record<MorphKey, { events: EcgEvent[] }>;
const VFIB = morphologies.vfib;

function morphFor(rhythm: RhythmMode): EcgEvent[] {
  switch (rhythm) {
    case 'afib':
      return MORPHS.afib.events;
    case 'vt':
      return MORPHS.vt.events;
    case 'pea':
      return MORPHS.pea.events;
    case 'asystole':
      return MORPHS.asystole.events;
    default:
      return MORPHS.nsr.events;
  }
}

/** Shortest signed angular difference, in (-pi, pi]. */
function angDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * Advance the ECG oscillator by `h` seconds and return the current z (millivolts).
 * Called ECG_SUBSTEPS times per physiology tick.
 */
/**
 * HOW DRUGS RESHAPE THE COMPLEX.
 *
 * Three bus targets that were declared for a long time and read by nothing, so a hERG
 * binder produced no QT change, a sodium-channel blocker produced no broad complex, and
 * an AV-nodal blocker produced no PR prolongation - the three ECG findings that are the
 * entire reason those drugs are dangerous.
 *
 * Signs follow the consumers below, which were written first:
 *   qtStretch        > 1 lengthens repolarisation
 *   conductionFactor < 1 slows conduction, so the QRS broadens
 *   prStretch        > 1 lengthens AV conduction
 *
 * Clamped rather than free, because these multiply angles on a limit cycle: an unbounded
 * stretch would wrap the T wave past the top of the cycle and the strip would show an
 * extra beat that never happened.
 *
 * NOTE FOR WHOEVER PICKS THIS UP: the call site, the downstream geometry and the
 * amplitude rescaling were already written; only this function and SHAPE were missing
 * when the work was interrupted. This is a faithful completion of that design, not a
 * replacement for it - refine it rather than assuming it was the intent.
 */
const SHAPE = { qtStretch: 1, conductionFactor: 1, prStretch: 1 };

// Exported so its response to a given bus state can be asserted directly, the same
// way renal.ts exports `autoregulation` for its own curve - cheaper and more precise
// than inferring it only from a full waveform simulation.
export function remodelling(s: SimState, out: typeof SHAPE): void {
  out.qtStretch = 1 + Math.max(-0.4, Math.min(1.2, effect(s, 'cardio.qtInterval')));
  out.conductionFactor = 1 + Math.max(-0.75, Math.min(0.5, effect(s, 'cardio.conductionVelocity')));
  out.prStretch = 1 + Math.max(0, Math.min(2.5, effect(s, 'cardio.avNodalBlock')));
}

export function stepEcg(s: SimState, h: number, rng: Rng): number {
  const e = s.ecg;
  const c = s.cardio;

  if (c.rhythm === 'vfib') {
    return stepVfib(s, h, rng);
  }

  const omega = (2 * Math.PI * Math.max(c.hr, 1e-3)) / 60;

  // Limit-cycle attractor in (x, y). alpha pulls the trajectory onto the unit circle.
  const r = Math.sqrt(e.x * e.x + e.y * e.y);
  const alpha = 1 - r;
  const dx = alpha * e.x - omega * e.y;
  const dy = alpha * e.y + omega * e.x;
  e.x += dx * h;
  e.y += dy * h;
  e.theta = Math.atan2(e.y, e.x);

  // z0 carries the baseline, modulated at the respiratory rate. One line, and it is
  // the difference between a trace that looks synthetic and one that looks recorded.
  const respPhase = (s.resp.cycleT / s.resp.period) * 2 * Math.PI;
  // In MODEL units, not millivolts: the amplitude gain is applied on the way out,
  // so writing millivolts here would multiply the wander by 25 and give an
  // asystolic strip a 5 mV drift.
  const z0 = (P('ecg.baselineWander_mV') / P('ecg.amplitudeGain')) * 10 * Math.sin(respPhase);

  // --- pharmacological remodelling of the complex --------------------------
  remodelling(s, SHAPE);
  const qtStretch = SHAPE.qtStretch;
  const conductionFactor = SHAPE.conductionFactor;
  const prStretch = SHAPE.prStretch;

  const events = morphFor(c.rhythm);

  // A wider QRS pushes the T wave out with it: the ventricle cannot start repolarising
  // the part of itself it has not yet depolarised, so every millisecond added to
  // depolarisation is a millisecond added to QT. Without this term a sodium-channel
  // blocker would broaden the complex and leave the QT interval untouched, which is not
  // something a strip ever shows. The shift is the extra angle the last depolarisation
  // event has moved by, so it is derived from the morphology rather than chosen.
  let qrsDelay = 0;
  if (conductionFactor !== 1) {
    let qrsHalf = 0;
    for (let i = 0; i < events.length; i++) {
      const id = events[i].id;
      if (id !== 'P' && id !== 'T') qrsHalf = Math.max(qrsHalf, Math.abs(events[i].theta));
    }
    qrsDelay = qrsHalf * (1 / conductionFactor - 1);
  }

  let sum = 0;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    let theta = ev.theta;
    let a = ev.a;
    let b = ev.b;

    // AMPLITUDE MUST BE RESCALED WHENEVER A WIDTH CHANGES, and this is the trap the
    // data file already warns about for the VT morphology: the excursion one Gaussian
    // event contributes to z is proportional to a*b^2, so widening b without touching a
    // makes the wave TALLER as well as wider. Keeping a*b^2 invariant means a widened
    // QRS is a genuinely broad, low complex - which is what a sodium-channel blocker
    // produces - rather than a giant one.
    if (ev.id === 'P') {
      theta *= prStretch;
    } else if (ev.id === 'T') {
      // Capped short of pi so a prolonged T can never wrap past the top of the cycle
      // and be mistaken for the next beat's P wave.
      theta = Math.min(0.9 * Math.PI, theta * qtStretch + qrsDelay);
      b *= qtStretch;
      a /= qtStretch * qtStretch;
    } else {
      // Q, R and S: the depolarisation wavefront. This is the QRS duration.
      theta /= conductionFactor;
      b /= conductionFactor;
      a *= conductionFactor * conductionFactor;
    }

    const dtheta = angDiff(e.theta, theta);
    sum += a * dtheta * Math.exp(-(dtheta * dtheta) / (2 * b * b));
  }

  // RATE NORMALISATION. Integrating the raw form gives an excursion of a*b^2/omega
  // per event, so the R wave would shrink as the heart sped up — at 120 bpm it would
  // be half the size it is at 60, which is not something a real electrocardiogram
  // does. Scaling the event sum by omega/omega_ref cancels the dependence exactly
  // and leaves the published parameters meaning what they mean at 60 bpm.
  const omegaRef = (2 * Math.PI * P('ecg.referenceRate_bpm')) / 60;
  const dz = -sum * (omega / omegaRef) - (e.z - z0);
  e.z += dz * h;

  // Hyperkalaemia: peaked T waves then QRS widening. Applied as a gain on the T
  // event and a broadening of the complex; the threshold is the clinical one.
  if (s.chem.k > 5.5) {
    const excess = Math.min(3, s.chem.k - 5.5);
    e.z *= 1 + excess * 0.05;
  }

  // Asystole has no events, so z decays to z0 and we see baseline wander only.
  //
  // The gain converts the model's dimensionless z into millivolts. McSharry's paper
  // scales its output rather than emitting millivolts directly, and without this the
  // R wave is 0.05 mV — a fiftieth of a real one, and smaller than the fibrillation
  // trace, which made VF look like the healthier rhythm.
  return e.z * P('ecg.amplitudeGain');
}

/**
 * Ventricular fibrillation: the limit cycle is replaced by band-limited 4-7 Hz
 * noise (spec 4.3). Implemented as a slowly-retargeted smooth interpolation, which
 * gives the characteristic coarse chaotic trace without an FIR filter bank.
 *
 * The amplitude decays with downtime, so coarse VF visibly becomes fine VF — which
 * is exactly why a late shock works less often (see procedures.ts).
 */
function stepVfib(s: SimState, h: number, rng: Rng): number {
  const e = s.ecg;
  const dominant = rng.range(VFIB.dominantFrequencyLow_Hz, VFIB.dominantFrequencyHigh_Hz);
  e.vfPhase += h * dominant;
  if (e.vfPhase >= 1) {
    e.vfPhase -= 1;
    e.vfTarget = rng.gaussian() * 0.6;
  }
  // Smooth toward the current target: a critically-damped approach at the dominant
  // frequency, which band-limits the noise without an explicit filter.
  e.vfValue += (e.vfTarget - e.vfValue) * Math.min(1, h * dominant * 8);

  const downtime = s.procedures.arrestStartT === null ? 0 : s.t - s.procedures.arrestStartT;
  const decay = Math.pow(0.5, downtime / VFIB.amplitudeDecayHalfLife_s);
  s.cardio.fibAmplitude = decay;

  // Coarse VF is 0.5-1.0 mV peak to peak, which must come out SMALLER than a
  // normal R wave.
  e.z = e.vfValue * VFIB.amplitude_mV * decay * 1.2;
  return e.z;
}

/** Peak-to-peak amplitude of the current VF, mV. Drives shock success (spec 9). */
export function vfAmplitude_mV(s: SimState): number {
  return VFIB.amplitude_mV * s.cardio.fibAmplitude;
}
