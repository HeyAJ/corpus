import type { OrganDetailSpec } from '../detail/types';

/**
 * NO MOTION: the hip and thigh muscles change colour and glow, and nothing here moves them.
 *
 * The engine has no per-muscle state: it has whole-body muscle tone (rigidity, and paralysis, which is how a neuromuscular
 * blocker reaches a muscle), exertion, shivering and a seizure, which the atlas file turns into each part's activity and the
 * default detail into a glow. Nothing in the model says how far a hip or knee is bent, so a muscle that shortened or bulged
 * would be moving by a number nobody has. Shivering is a whole-body signal and does not say which muscle shakes, so it is the
 * glow and not a tremor.
 *
 * THE FEMORAL TRIANGLE IS A SPACE, drawn as a thin pane (a display opacity) so the muscles under it can be seen through it.
 */
const TRIANGLE_OPACITY = 0.3;

export const detail: OrganDetailSpec = {
  animate: (ctx) => {
    ctx.part('femoral_triangle')?.setOpacity(TRIANGLE_OPACITY);
  },
};
