import morphologies from '../../data/ecg_morphologies.json';
import { P } from '../core/constants';
import type { SimState } from '../core/state';
import type { Rng } from '../core/rng';
import { effect } from '../core/effects';

/**
 * NEURO (spec 4.4 chemoreceptors aside, this covers cerebral perfusion and EEG).
 *
 * Cerebral blood flow autoregulates over MAP 60-150. Below that plateau, CBF falls
 * and consciousness goes with it — that is syncope, and it is why a profoundly
 * hypotensive body in this simulation stops being alert before it stops having a
 * pulse.
 *
 * The EEG is a bank of five band-limited oscillators whose relative power is set by
 * consciousness and by sedative-hypnotic receptor occupancy. Alert = beta/alpha
 * dominant; sedated = theta then delta; deep = burst suppression. This is a
 * *descriptive* model of the band structure, not a neural-mass model, and
 * docs/MODEL_LIMITATIONS.md says so.
 *
 * This module is also the ONLY consumer of the two central-drive effect targets,
 * `neuro.sedation` and `neuro.arousal`. They are read together, as one signed axis;
 * the long comment at the point of use says why, and what it cost to read only one of
 * them.
 */

interface Band {
  id: string;
  centre_Hz: number;
}
const BANDS = morphologies.eeg.bands as Band[];

export function stepNeuro(s: SimState, dt: number): void {
  const n = s.neuro;
  const map = s.cardio.map;

  // --- cerebral autoregulation ---------------------------------------------
  //
  // PERFUSION PRESSURE, NOT ARTERIAL PRESSURE. Flow through any vascular bed is driven
  // by the pressure DIFFERENCE across it, and for the brain that is the cerebral
  // perfusion pressure: arterial pressure minus the pressure the outflow has to push
  // against. This model has no intracranial pressure, so central venous pressure is
  // the available proxy and is named as such below.
  //
  // Using `map` alone was the root cause of a body in cardiac arrest going on
  // breathing. In arrest the arterial pressure decays TOWARD the venous pressure, so
  // the gradient collapses to near nothing while the absolute number is still 12 mmHg.
  // Read absolutely, that left cerebral flow at 7.5% of normal - enough, once the
  // unbounded chemoreflex was multiplied through it, to sustain a normal respiratory
  // rate in a pulseless body. Read as a gradient it is a fraction of a per cent, which
  // is what no cardiac output actually means.
  //
  // It matters well short of arrest too: two bodies at the same mean pressure, one of
  // them congested with a central venous pressure of 20, do not perfuse their brains
  // equally, and only the gradient form can tell them apart.
  const lo = P('neuro.autoregLow_mmHg');
  const hi = P('neuro.autoregHigh_mmHg');
  const cpp = Math.max(0, map - s.cardio.ra.P);
  let flowFactor: number;
  if (cpp >= lo && cpp <= hi) flowFactor = 1;
  else if (cpp < lo) flowFactor = Math.max(0, Math.pow(Math.max(0, cpp / lo), 2));
  else flowFactor = 1 + Math.min(0.4, (cpp - hi) * 0.004);

  // Cerebral vessels are exquisitely CO2-reactive: ~2-4 % flow change per mmHg. Measured
  // against the MODEL'S OWN resting PaCO2, not a textbook 40, because this loop settles
  // a little below 40 and referencing 40 docked a resting body's cerebral flow (and, with
  // no dead-zone below, its consciousness) by about a tenth for no physiological reason.
  const co2Reactivity = 1 + Math.max(-0.6, Math.min(1.2, (s.resp.arterialPco2 - P('resp.restingPaco2_mmHg')) * 0.03));

  const target = P('neuro.cerebralBloodFlow_mL_per_min') * flowFactor * co2Reactivity;
  n.cbf += ((target - n.cbf) * dt) / 3;

  // --- consciousness -------------------------------------------------------
  const cbfFraction = n.cbf / P('neuro.cerebralBloodFlow_mL_per_min');
  const syncope = P('neuro.consciousnessLossCBF_fraction');
  // A DEAD-ZONE at the top: any cerebral flow at or above the resting operating point is
  // fully alert. Without it, the ordinary few-per-cent swings in flow that hypocapnia and
  // posture produce read as measurable progress toward syncope, and a resting body scored
  // 0.87 rather than 1.0. Consciousness should only fall once flow drops toward the
  // syncope threshold, which is what this normalisation now says.
  const alertFloor = 0.95;
  const perfusionTerm = Math.max(0, Math.min(1, (cbfFraction - syncope) / (alertFloor - syncope)));

  // Hypoxia acts on top of perfusion. Below SpO2 ~ 0.75 consciousness is not
  // sustainable however good the flow.
  const hypoxiaTerm = Math.max(0, Math.min(1, (s.resp.spo2 - 0.6) / 0.2));

  // --- central depressant load ---------------------------------------------
  //
  // SEDATION AND AROUSAL ARE ONE AXIS, READ IN ONE PLACE.
  //
  // `neuro.sedation` and `neuro.arousal` are both fractional modifiers of how awake
  // the cortex is, written by different halves of the receptor registry, and until
  // now only the first of them was read by anything. That was not a small gap. The
  // registry routes the ascending arousal systems - H1 (tuberomammillary histamine),
  // D2/D1/D3 (mesolimbic and nigrostriatal dopamine), M1/M4/M5, alpha4beta2 nicotinic,
  // 5-HT2A, NMDA, DAT, NET, SERT, TAAR1 and A2A - through `neuro.arousal` and
  // essentially nothing through `neuro.sedation`, so seventeen receptors and three
  // direct-effect drugs were writing to a target with no consumer.
  //
  // WHAT THAT LOOKED LIKE. Every sedating antipsychotic failed to sedate. Olanzapine,
  // quetiapine and haloperidol all reported a sedation level of exactly 0.000 at any
  // dose, because their entire central action is H1 and D2 blockade and both of those
  // land on `neuro.arousal`. So did diphenhydramine, whose clinical identity outside
  // an allergic reaction IS that it makes you sleepy, and so did ketamine, an
  // anaesthetic whose whole mechanism is NMDA blockade. A model in which an induction
  // agent leaves the patient wide awake is not incomplete, it is teaching the opposite
  // of the truth (ADR-023's rule).
  //
  // WHY THE TWO TARGETS COMBINE WITH A GAIN OF EXACTLY ONE, which is the only
  // number-free choice and therefore the only one allowed here. Both are dimensionless
  // fractional modifiers on the same 0..1 axis, per the convention `effects.ts` states
  // for the whole bus; one says "this drug adds depression", the other says "this drug
  // removes wakefulness". Subtracting arousal from sedation asserts that a unit of
  // removed wakefulness and a unit of added depression cost the same amount of
  // consciousness, which is the definition of them sharing an axis. Any other weight
  // would be a calibration constant, and there is no measurement to calibrate it
  // against.
  //
  // THE SIGN MATTERS IN BOTH DIRECTIONS, and this is why they are summed BEFORE the
  // clamp rather than after. A stimulant writes positive arousal and therefore negative
  // depression, which on its own is clamped away - the consciousness index tops out at
  // "fully alert" and there is no state above it. But given alongside a depressant it
  // cancels part of it on the bus first, so caffeine genuinely offsets some of a
  // benzodiazepine, and an antimuscarinic given to a sedated patient genuinely does not.
  // That opposition is the entire argument for a shared bus (see the endocrine header),
  // and clamping each term separately would throw it away.
  //
  // WHAT IS LOST BY STORING THE SUM IN `n.sedation`: the snapshot can no longer say
  // whether a body is sedated because a drug is depressing it or because a drug has
  // removed its arousal. That distinction is real - dexmedetomidine sedation is
  // rousable and propofol sedation is not - but this model has no term for
  // rousability, so keeping two fields would be keeping a distinction it cannot use.
  // One number, correctly signed, is the honest version, and it is what the EEG band
  // model and the burst-suppression envelope below both want.
  const depressantLoad = effect(s, 'neuro.sedation') - effect(s, 'neuro.arousal');
  n.sedation = Math.max(0, Math.min(1, depressantLoad));
  const drugTerm = 1 - n.sedation;

  const targetConsciousness = Math.max(0, Math.min(1, perfusionTerm * hypoxiaTerm * drugTerm));
  // Consciousness changes over seconds, not instantly, in both directions.
  n.consciousness += ((targetConsciousness - n.consciousness) * dt) / 2.5;
  n.consciousness = Math.max(0, Math.min(1, n.consciousness));
}

/** Band weights for the current state. Index order matches `BANDS`. */
function bandWeights(s: SimState, out: number[]): void {
  const c = s.neuro.consciousness;
  const sed = s.neuro.sedation;

  // delta, theta, alpha, beta, gamma
  const depth = Math.max(0, Math.min(1, 1 - c));
  out[0] = 0.08 + 1.5 * depth * depth; // delta grows as consciousness falls
  out[1] = 0.12 + 1.1 * depth * (1 - depth) * 2; // theta peaks mid-way
  out[2] = 0.55 * c + 0.35 * Math.min(1, sed * 2) * c; // alpha: eyes-closed rest, and the
  //                                                     "alpha spindle" of light sedation
  out[3] = 0.60 * c * c; // beta: alert cortex
  out[4] = 0.10 * c * c; // gamma
}

const WEIGHTS = [0, 0, 0, 0, 0];

/**
 * Advance the EEG oscillator bank and return the current amplitude in microvolts.
 * Called at the waveform sub-step rate alongside the ECG.
 */
export function stepEeg(s: SimState, h: number, rng: Rng): number {
  const n = s.neuro;
  bandWeights(s, WEIGHTS);

  let v = 0;
  let norm = 0;
  for (let i = 0; i < BANDS.length; i++) {
    // Each band is a narrow-band oscillator with a slowly wandering phase, which is
    // what gives EEG its characteristic "almost periodic" texture.
    const jitter = 1 + rng.gaussian() * 0.02;
    n.eegPhase[i] += 2 * Math.PI * BANDS[i].centre_Hz * jitter * h;
    if (n.eegPhase[i] > 2 * Math.PI) n.eegPhase[i] -= 2 * Math.PI;
    v += WEIGHTS[i] * Math.sin(n.eegPhase[i]);
    norm += WEIGHTS[i];
  }

  // Burst suppression: at deep sedation the trace alternates bursts and flat periods.
  let envelope = 1;
  if (n.sedation > 0.8) {
    const burstPhase = (s.t * 0.12) % 1;
    envelope = burstPhase < 0.35 ? 1 : 0.06;
  }

  const AMPLITUDE_UV = 35;
  n.eegValue = norm > 1e-6 ? (v / norm) * AMPLITUDE_UV * envelope * (0.35 + 0.65 * n.consciousness) : 0;
  return n.eegValue;
}

export function dominantBand(s: SimState): 'beta' | 'alpha' | 'theta' | 'delta' | 'suppressed' {
  if (s.neuro.sedation > 0.85 || s.neuro.consciousness < 0.08) return 'suppressed';
  bandWeights(s, WEIGHTS);
  let best = 0;
  for (let i = 1; i < 4; i++) if (WEIGHTS[i] > WEIGHTS[best]) best = i;
  return (['delta', 'theta', 'alpha', 'beta'] as const)[best];
}
