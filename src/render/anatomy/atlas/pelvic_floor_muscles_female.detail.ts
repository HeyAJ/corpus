import type { OrganDetailSpec } from '../detail/types';

/**
 * NO MOTION: the female pelvic floor muscles change colour and glow, and nothing here moves them. The reasons are the male atlas's: the engine has
 * no per-muscle state (only whole-body muscle tone, paralysis, a seizure and, for the perineal muscles, the orgasm signal), and nothing says how far
 * the floor is lifted or whether the urethra is closed. The two fasciae (the perineal membrane and the tendinous arch) are drawn as panes, a display
 * opacity, so the muscles under them show; the membrane here is perforated, and the panes show the urethra's and the vagina's openings.
 */
const FASCIA_OPACITY = 0.45;

export const detail: OrganDetailSpec = {
  animate: (ctx) => {
    for (const id of ['perineal_membrane', 'tendinous_arch_of_levator_ani']) ctx.part(id)?.setOpacity(FASCIA_OPACITY);
  },
};
