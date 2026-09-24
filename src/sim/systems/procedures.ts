import { P, PArray } from '../core/constants';
import type { SimState } from '../core/state';
import type { Rng } from '../core/rng';

/**
 * PROCEDURES (spec 9).
 *
 * CPR is modelled as a thoracic pump rather than as a scripted stroke volume: each
 * compression raises intrathoracic pressure, and blood moves through the existing
 * valve equations in systems/cardio.ts. That means compression rate, the patient's
 * volume status and their vascular tone all feed into the output the way they do in
 * reality, instead of being ignored by a hard-coded "25 % of normal".
 *
 * DEFIBRILLATION is probabilistic, seeded, and conditioned on rhythm, downtime and
 * coronary perfusion pressure.
 *
 *   Shocking asystole does nothing.
 *
 * That is modelled exactly, with no partial credit, because it is the single most
 * valuable teaching moment in the app: defibrillation does not start a heart, it
 * stops a chaotic one and lets the intrinsic pacemaker resume. There is nothing to
 * stop in asystole.
 */

export function stepProcedures(s: SimState, dt: number, rng: Rng): void {
  const p = s.procedures;

  // Track arrest onset for the downtime term.
  const ci = s.cardio.co / s.body.bsa_m2;
  const arrested = ci < 1.0;
  if (arrested && p.arrestStartT === null) p.arrestStartT = s.t;
  if (!arrested && p.arrestStartT !== null && s.t - p.arrestStartT > 5) p.arrestStartT = null;

  // Automatic compressions at the midpoint of the AHA target band, for users who do
  // not want to tap 110 times a minute. Manual taps override it.
  if (p.cprAuto && p.cprActive) {
    const target = (P('arrest.cprTargetRateLow_per_min') + P('arrest.cprTargetRateHigh_per_min')) / 2;
    if (s.t - p.lastCompressionT >= 60 / target) compress(s);
  }

  // Compressions older than 10 s stop counting toward the rate estimate.
  while (p.compressionTimes.length > 0 && s.t - p.compressionTimes[0] > 10) {
    p.compressionTimes.shift();
  }

  // CPR stops being effective the moment compressions stop.
  if (p.cprActive && s.t - p.lastCompressionT > 3) {
    p.cprActive = false;
  }

  void dt;
  void rng;
}

export function compress(s: SimState): void {
  const p = s.procedures;
  p.cprActive = true;
  p.lastCompressionT = s.t;
  p.compressionTimes.push(s.t);
  s.cardio.cprImpulse = 1;
}

export function cprRate(s: SimState): number {
  const times = s.procedures.compressionTimes;
  if (times.length < 2) return 0;
  const span = times[times.length - 1] - times[0];
  if (span <= 0) return 0;
  return ((times.length - 1) / span) * 60;
}

export function cprQuality(s: SimState): 'none' | 'slow' | 'good' | 'fast' {
  if (!s.procedures.cprActive) return 'none';
  const r = cprRate(s);
  if (r === 0) return 'none';
  if (r < P('arrest.cprTargetRateLow_per_min')) return 'slow';
  if (r > P('arrest.cprTargetRateHigh_per_min')) return 'fast';
  return 'good';
}

export function chargeDefib(s: SimState, joules: number): boolean {
  const allowed = PArray('arrest.defibEnergyOptions_J');
  if (!allowed.includes(joules)) return false;
  s.procedures.defibCharge = joules;
  s.procedures.defibCharged = true;
  return true;
}

export interface ShockResult {
  delivered: boolean;
  reason: string;
  converted: boolean;
  /** Probability that was rolled, for the teaching readout. */
  probability: number;
}

/**
 * Deliver a shock. Returns what happened and why, so the UI can explain it rather
 * than just animating something.
 */
export function defibrillate(s: SimState, rng: Rng): ShockResult {
  const p = s.procedures;

  if (!p.padsPlaced) return { delivered: false, reason: 'Pads not placed', converted: false, probability: 0 };
  if (!p.defibCharged) return { delivered: false, reason: 'Defibrillator not charged', converted: false, probability: 0 };

  p.defibCharged = false;
  p.shocksDelivered += 1;
  const joules = p.defibCharge;
  p.defibCharge = 0;

  const rhythm = s.cardio.rhythm;

  // --- non-shockable rhythms ------------------------------------------------
  if (rhythm === 'asystole') {
    return {
      delivered: true,
      converted: false,
      probability: 0,
      reason:
        'Asystole is not a shockable rhythm. Defibrillation depolarises myocardium that is already depolarised; there is no organised activity to interrupt. Continue compressions and treat reversible causes.',
    };
  }
  if (rhythm === 'pea') {
    return {
      delivered: true,
      converted: false,
      probability: 0,
      reason:
        'Pulseless electrical activity is not a shockable rhythm. The electrical rhythm is already organised; the problem is mechanical. Continue compressions and treat reversible causes.',
    };
  }
  if (rhythm !== 'vfib' && rhythm !== 'vt') {
    return {
      delivered: true,
      converted: false,
      probability: 0,
      reason: 'Rhythm is already organised and perfusing. No shock indicated.',
    };
  }

  // --- shockable ------------------------------------------------------------
  const downtime = p.arrestStartT === null ? 0 : s.t - p.arrestStartT;
  const base = P('arrest.defibBaseSuccess_vfib');
  const downtimeFactor = Math.pow(0.5, downtime / P('arrest.defibDowntimeHalfLife_s'));

  // Coronary perfusion pressure gates success: a myocardium that has not been
  // perfused will not sustain an organised rhythm even if the shock terminates VF.
  const cppTarget = P('arrest.cppRosc_mmHg');
  const cppFactor = Math.max(0.08, Math.min(1, s.cardio.cpp / cppTarget));

  // Energy: within the biphasic range, higher energy buys a little.
  const energyFactor = 0.9 + 0.1 * (joules / 200);

  // Fine VF (low amplitude) converts much less often than coarse VF.
  const amplitudeFactor = rhythm === 'vfib' ? Math.max(0.2, s.cardio.fibAmplitude) : 1;

  const probability = Math.max(0, Math.min(0.97, base * downtimeFactor * cppFactor * energyFactor * amplitudeFactor));

  if (rng.chance(probability)) {
    // The shock terminated the arrhythmia. What comes next depends on whether the
    // myocardium was perfused well enough to resume organised contraction.
    if (s.cardio.cpp >= cppTarget) {
      s.cardio.rhythm = 'nsr';
      s.cardio.cycleT = 0;
      s.cardio.hr = P('cardio.heartRateBaseline_bpm');
      s.cardio.fibAmplitude = 0;
      p.arrestStartT = null;
      return {
        delivered: true,
        converted: true,
        probability,
        reason: `Shock terminated the arrhythmia and an organised perfusing rhythm resumed. Coronary perfusion pressure was ${s.cardio.cpp.toFixed(0)} mmHg.`,
      };
    }
    s.cardio.rhythm = 'pea';
    s.cardio.hr = 60;
    s.cardio.fibAmplitude = 0;
    return {
      delivered: true,
      converted: true,
      probability,
      reason: `Shock terminated the arrhythmia but coronary perfusion pressure was only ${s.cardio.cpp.toFixed(0)} mmHg, so the myocardium resumed electrical activity without effective contraction. Resume compressions.`,
    };
  }

  return {
    delivered: true,
    converted: false,
    probability,
    reason: `Shock did not terminate the arrhythmia (${(probability * 100).toFixed(0)} % chance at ${downtime.toFixed(0)} s downtime and ${s.cardio.cpp.toFixed(0)} mmHg coronary perfusion pressure). Resume compressions immediately.`,
  };
}

/**
 * Untreated VF degenerates. Amplitude falls (see derive/waveforms/ecg.ts) and after
 * long enough the myocardium goes asystolic.
 */
export function stepArrestProgression(s: SimState, _dt: number): void {
  const p = s.procedures;
  if (s.cardio.rhythm !== 'vfib' || p.arrestStartT === null) return;
  const downtime = s.t - p.arrestStartT;
  // Fine VF below ~0.1 mV is electrically indistinguishable from asystole.
  if (downtime > 60 && s.cardio.fibAmplitude < 0.12) {
    s.cardio.rhythm = 'asystole';
  }
}
