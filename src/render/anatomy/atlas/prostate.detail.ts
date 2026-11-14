import type { DetailContext, FlowSpec, OrganDetailSpec } from '../detail/types';
import type { SimSnapshot } from '../../../bridge/types';
import { emissionPath } from './prostate.parts';

/**
 * THE PROSTATE'S INTERIOR IN MOTION.
 *
 * Reads `reproductive.sexual.orgasm` and `body.sex`.
 *
 *   - EMISSION. Along each side, from the ampulla of the vas deferens through the ejaculatory
 *     duct to the seminal colliculus and on down the urethra, a stream of pale particles is
 *     drawn only while `sexual.orgasm` is above zero in a male body. Its speed and density
 *     rise with the orgasm envelope. At rest, and in any other phase, nothing is drawn: the
 *     ducts are empty of anything this model tracks. The speed is a drawing choice.
 *   - GLASS. The capsule, the three zones, the seminal vesicles, the urethra, the ducts and the
 *     ampullae all enclose something or carry the stream, so each is drawn as glass every
 *     frame; the seminal colliculus and the coiled tubes of the vesicles stay solid, as the
 *     things a viewer taps. The vesicles and the capsule become a little more vivid with their
 *     own activity.
 *
 * Nothing here changes a shape: the gland is the same size at rest and in arousal.
 */

const SEMEN_COLOUR = 0xe8e0c0;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const orgasmOf = (s: SimSnapshot): number => s.reproductive.sexual.orgasm;

const SIDES = ['r', 'l'];

export const detail: OrganDetailSpec = {
  flows: () => {
    const out: FlowSpec[] = [];
    out.push({ id: 'emission_r', path: emissionPath(1), count: 44, size: 0.0009, color: SEMEN_COLOUR, speed: 0.018, spread: 0.0002 });
    out.push({ id: 'emission_l', path: emissionPath(-1), count: 44, size: 0.0009, color: SEMEN_COLOUR, speed: 0.018, spread: 0.0002 });
    return out;
  },

  animate: (ctx: DetailContext) => {
    ctx.part('prostatic_capsule')?.setOpacity(0.2 + 0.2 * ctx.activity('prostatic_capsule'));
    ctx.part('peripheral_zone')?.setOpacity(0.25 + 0.2 * ctx.activity('peripheral_zone'));
    ctx.part('central_zone')?.setOpacity(0.3);
    ctx.part('transition_zone')?.setOpacity(0.3);
    ctx.part('prostatic_urethra')?.setOpacity(0.4);
    ctx.part('ejaculatory_ducts')?.setOpacity(0.4);
    ctx.part('ampullae')?.setOpacity(0.4);
    ctx.part('seminal_vesicles')?.setOpacity(0.2 + 0.25 * ctx.activity('seminal_vesicles'));

    const male = ctx.snapshot.body.sex === 'male';
    const orgasm = male ? clamp01(ctx.lerp(orgasmOf)) : 0;
    const on = orgasm > 0.0001;
    for (let i = 0; i < SIDES.length; i++) {
      const f = ctx.flow(`emission_${SIDES[i]}`);
      if (!f) continue;
      f.setVisible(on);
      f.setRate(0.6 + 2 * orgasm);
      f.setDensity(clamp01(0.3 + orgasm));
    }
  },
};
