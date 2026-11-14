import type { OrganDetailSpec } from '../detail/types';
import { warpPoints } from '../layout';
import { cordLine } from './spinal_cord.parts';

/**
 * STREAMS AND ANIMATION OF THE SPINAL CORD.
 *
 * FIVE KINDS OF TRAFFIC, EACH IN ITS OWN PLACE.
 *   - Motor, descending, along the front and sides of the cord, rate and density from
 *     `anatomy.nerves.motor` (voluntary movement, shivering, a seizure).
 *   - Sensory, ascending, along the back (the dorsal columns), from `nerves.sensory`.
 *   - Pain, ascending in a warm colour through the anterolateral part of the cord, from
 *     `nerves.pain`, which is the stimulus before any analgesia. Kept as its own stream
 *     so that an analgesic that quietens felt pain can be seen to leave the stimulus
 *     alone, and the reverse.
 *   - Sympathetic outflow along the two chains, from `nerves.sympathetic`.
 * Every path comes from `cordLine`, which follows the same centreline and radius as the
 * shell, and goes through `warpPoints`, because the cord is drawn in the exploded body.
 *
 * A QUIET NERVE IS NOT AN EMPTY ONE. At rest the nerve signals are 0, and a cord with no
 * traffic at all would read as a dead one. Each stream keeps a floor of rate and density
 * so a resting cord shows a slow trickle, and the signal scales it up from there. The
 * floor is a display choice, not a firing rate.
 *
 * REDUCED MOTION holds every stream still; the part colours stay live.
 *
 * THE CORD STILL CONDUCTS WHEN MUSCLE TONE IS LOST. The three lengths of cord dim only
 * slightly with `paralysis` (see the JSON): a drug that paralyses at the neuromuscular
 * junction leaves the spinal cord itself working, and the display should not suggest
 * otherwise.
 */

const TOP = 0.385;
const BOTTOM = 0.05;
const STEPS = 12;

function clamp01(x: number): number {
  return x !== x ? 0 : x < 0 ? 0 : x > 1 ? 1 : x;
}

/** A path down (top to bottom) or up (bottom to top) the cord at a position in its cross-section. */
function path(up: boolean, fx: number, fz: number) {
  const down = cordLine(TOP, BOTTOM, STEPS, fx, fz);
  return warpPoints(up ? down.reverse() : down);
}

/** One chain's path, beside the cord, top to bottom. */
function chainPath(side: 1 | -1) {
  const pts = cordLine(0.265, 0.065, STEPS, 0, 0);
  // Out beside the cord by the chain's own offset: the shell radius plus 1.8 mm, as the
  // part is built, measured here as a fraction of the cord radius at each level.
  return warpPoints(pts.map((p) => [p[0] + side * 0.0068, p[1], p[2] + 0.0008] as const));
}

const FLOW_IDS = [
  { id: 'motor_right', pick: 0 },
  { id: 'motor_left', pick: 0 },
  { id: 'sensory_right', pick: 1 },
  { id: 'sensory_left', pick: 1 },
  { id: 'pain_right', pick: 2 },
  { id: 'pain_left', pick: 2 },
  { id: 'symp_right', pick: 3 },
  { id: 'symp_left', pick: 3 },
] as const;

export const detail: OrganDetailSpec = {
  flows: () => [
    { id: 'motor_right', path: path(false, 0.5, 0.42), count: 60, size: 0.0008, color: 0xf2c14e, speed: 0.07, spread: 0.0005 },
    { id: 'motor_left', path: path(false, -0.5, 0.42), count: 60, size: 0.0008, color: 0xf2c14e, speed: 0.07, spread: 0.0005 },
    { id: 'sensory_right', path: path(true, 0.4, -0.55), count: 60, size: 0.0008, color: 0x5fc8e8, speed: 0.07, spread: 0.0005 },
    { id: 'sensory_left', path: path(true, -0.4, -0.55), count: 60, size: 0.0008, color: 0x5fc8e8, speed: 0.07, spread: 0.0005 },
    { id: 'pain_right', path: path(true, 0.68, -0.05), count: 40, size: 0.0009, color: 0xff7a3d, speed: 0.06, spread: 0.0004 },
    { id: 'pain_left', path: path(true, -0.68, -0.05), count: 40, size: 0.0009, color: 0xff7a3d, speed: 0.06, spread: 0.0004 },
    { id: 'symp_right', path: chainPath(1), count: 36, size: 0.0007, color: 0xd98cff, speed: 0.05, spread: 0.0003 },
    { id: 'symp_left', path: chainPath(-1), count: 36, size: 0.0007, color: 0xd98cff, speed: 0.05, spread: 0.0003 },
  ],

  animate: (ctx) => {
    const traffic = [
      clamp01(ctx.lerp((s) => s.anatomy.nerves.motor)),
      clamp01(ctx.lerp((s) => s.anatomy.nerves.sensory)),
      clamp01(ctx.lerp((s) => s.anatomy.nerves.pain)),
      clamp01(ctx.lerp((s) => s.anatomy.nerves.sympathetic)),
    ];
    for (const f of FLOW_IDS) {
      const h = ctx.flow(f.id);
      if (!h) continue;
      const v = traffic[f.pick];
      h.setRate(ctx.reducedMotion ? 0 : 0.35 + 1.4 * v);
      h.setDensity(0.25 + 0.75 * v);
    }
  },
};
