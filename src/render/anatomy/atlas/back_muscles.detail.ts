import type { OrganDetailSpec } from '../detail/types';

/**
 * NO MOTION: the back muscles change colour and glow, and nothing here moves them.
 *
 * The engine has no per-muscle state. It has whole-body muscle tone (raised in rigidity, lost in
 * paralysis, which is how a neuromuscular blocker reaches a muscle), exertion, shivering and a seizure,
 * and the atlas file turns those into each part's activity, which the default detail turns into a glow. A
 * muscle that lengthened, shortened or trembled here would be moving by a number nobody has: nothing in the
 * model says how far the spine has bent or the arm been pulled. Shivering in particular is a signal about the
 * whole body and does not say which of two muscles is shaking, so it is shown as the glow and not as a
 * tremor.
 *
 * THE FASCIA IS A PANE. The thoracolumbar fascia lies over the erector spinae and the deep muscles, so it is
 * drawn as glass and what it covers can be seen through it; the opacity is a display choice.
 */
const FASCIA_OPACITY = 0.4;

export const detail: OrganDetailSpec = {
  animate: (ctx) => {
    ctx.part('thoracolumbar_fascia')?.setOpacity(FASCIA_OPACITY);
  },
};
