import type { DetailContext, OrganDetailSpec } from '../detail/types';

/**
 * THE MOUTH IN MOTION: the swallow, and glass where a part encloses something.
 *
 * WHAT IS SIMULATED. Only the `swallowing` signal (something is in the oesophagus) and
 * `mind.vomiting`. Chewing, taste, speech and saliva are not in the engine, so nothing here
 * pretends they are: no taste bud lights, no jaw moves.
 *
 * THE SWALLOW GESTURE. Guyton and Hall describe the oral stage of a swallow as the tongue
 * pressing the bolus back against the palate, and the soft palate rising to seal the
 * nasopharynx. When the swallowing signal rises, the tongue and the soft palate make one
 * smooth rise-and-fall lasting SWALLOW_DISPLAY_S. The duration and the two lifts are DISPLAY
 * CHOICES, not measurements: the engine's signal stays high for as long as the bolus is in
 * the oesophagus, which is far longer than the oral stage, so the gesture is keyed to the
 * rising edge and not held. Vomiting holds the soft palate up for as long as it lasts (the
 * textbook lifts it to close the posterior nares). Under reduced motion nothing moves.
 *
 * Children ride the pose of their parent (OrganDetail), so the uvula follows the soft palate
 * and every papilla follows the tongue without being posed here.
 */

/** How long the oral-stage gesture takes on screen, seconds. A display choice. */
const SWALLOW_DISPLAY_S = 1.0;
/** How far the soft palate rises, and the tongue's lift and backward press, metres of scene. Display choices. */
const PALATE_RISE_M = 0.0022;
const PALATE_BACK_M = 0.001;
const TONGUE_RISE_M = 0.0045;
const TONGUE_BACK_M = 0.0015;
/** Tongue activity above which the swallowing drive counts as on (rest 0.3 plus the drive's 0.3 weight at full signal). */
const TONGUE_ON = 0.45;

/** Glass opacities: parts that enclose, line or roof something are drawn see-through. */
const GLASS: readonly [string, number][] = [
  ['lips', 0.25],
  ['oral_vestibule', 0.2],
  ['palate', 0.4],
  ['soft_palate', 0.5],
  ['oral_cavity_proper', 0.1],
  ['oral_mucosa', 0.07],
  ['buccal_mucosa', 0.15],
  ['floor_of_mouth', 0.4],
  ['mylohyoid', 0.55],
  ['oral_part', 0.25],
  ['pharyngeal_part', 0.25],
  ['taste_bud', 0.25],
  ['enamel', 0.3],
  ['cementum', 0.25],
  ['periodontal_ligament', 0.18],
  ['alveolar_bone', 0.15],
];

let start = -1;
let wasOn = false;
let lastTime = 0;

export const detail: OrganDetailSpec = {
  animate: (ctx: DetailContext) => {
    for (const [id, o] of GLASS) ctx.part(id)?.setOpacity(o);

    // A fresh opening of the organ restarts the clock: forget any gesture half-played.
    if (ctx.time < lastTime) {
      start = -1;
      wasOn = false;
    }
    lastTime = ctx.time;
    if (ctx.reducedMotion) return;

    const on = ctx.activity('tongue') > TONGUE_ON;
    if (on && !wasOn) start = ctx.time;
    wasOn = on;
    let g = 0;
    if (start >= 0) {
      const tau = (ctx.time - start) / SWALLOW_DISPLAY_S;
      if (tau >= 1) start = -1;
      else g = Math.sin(Math.PI * tau);
    }
    const v = ctx.snapshot.mind.vomiting ? 1 : 0;
    const lift = Math.max(g, v);
    ctx.part('soft_palate')?.setOffset([0, PALATE_RISE_M * lift, -PALATE_BACK_M * lift]);
    ctx.part('tongue')?.setOffset([0, TONGUE_RISE_M * g, -TONGUE_BACK_M * g]);
  },
};
