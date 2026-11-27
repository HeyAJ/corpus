import type { OrganDetailSpec } from '../detail/types';

/**
 * NO MOTION: the pelvic floor muscles change colour and glow, and nothing here moves them.
 *
 * The engine has no per-muscle state: whole-body muscle tone (rigidity; paralysis, which is how a neuromuscular blocker reaches
 * a muscle), a seizure, and, for the perineal muscles, the orgasm signal (Guyton and Hall describe the perineal muscles
 * contracting in orgasm). Nothing says how far the floor is lifted or whether the urethra is closed, so the muscles do not lift or
 * tighten. The two fasciae (the perineal membrane and the tendinous arch) are drawn as panes, a display opacity, so the muscles under them show.
 */
const FASCIA_OPACITY = 0.45;

export const detail: OrganDetailSpec = {
  animate: (ctx) => {
    for (const id of ['perineal_membrane', 'tendinous_arch_of_levator_ani']) ctx.part(id)?.setOpacity(FASCIA_OPACITY);
  },
};
