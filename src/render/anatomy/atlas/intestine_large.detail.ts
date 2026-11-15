import type { DetailContext, FlowSpec, OrganDetailSpec } from '../detail/types';
import { warpPoints } from '../layout';
import type { V3 } from '../sdf';
import { colonPoints, segmentEnds, wallPoint } from './intestine_large.parts';

/**
 * THE LARGE INTESTINE IN MOTION.
 *
 * Reads the part activities, which the data file drives from the engine's colonic transit,
 * motility and parasympathetic signals.
 *
 *   - GLASS. The six segments, the appendix, the mucosal lining and the haustral folds
 *     enclose or surround the contents, so they are drawn as glass every frame (the brief's
 *     rule). The contents, and the taeniae (thin cords on the outside), stay solid.
 *   - TRANSIT. A slow stream of particles runs from the caecum towards the rectum. Its rate
 *     is a resting creep plus the activity of the contents part, which the data file drives
 *     from colonic transit and motility, so raised motility speeds it and reduced motility
 *     slows it. Diarrhoea is therefore shown as faster transit; the brief lists no separate
 *     gut-water signal, so none is used.
 *   - WATER. Short streams leave the lumen through the wall at five places along the
 *     ascending and transverse colon (where most absorption occurs) and the descending
 *     colon. Their rate follows the mucosa's activity, which the data file lowers when
 *     motility is raised and raises when it falls, so faster transit shows less water
 *     leaving. The streams end in the wall; the vessels that carry the water away are not
 *     drawn.
 *
 * Rates are display scales, not flows. Under `reducedMotion` the streams keep their colours
 * but run at a slow steady rate.
 */

const GLASS: readonly [string, number, number][] = [
  ['caecum', 0.22, 0.2],
  ['appendix', 0.3, 0.15],
  ['colon_ascending', 0.22, 0.2],
  ['colon_transverse', 0.22, 0.2],
  ['colon_descending', 0.22, 0.2],
  ['colon_sigmoid', 0.22, 0.2],
  ['rectum', 0.22, 0.2],
  ['mucosa', 0.2, 0.2],
  ['haustra', 0.3, 0.1],
];

const CONTENT_COLOUR = 0x9c7a4a;
const WATER_COLOUR = 0x7fb8e6;

const WATER_IDS: string[] = [];

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export const detail: OrganDetailSpec = {
  flows: () => {
    const ends = segmentEnds();
    const specs: FlowSpec[] = [
      { id: 'transit', path: warpPoints(colonPoints(0, 1, 0.03)), count: 120, size: 0.0022, color: CONTENT_COLOUR, speed: 0.008, spread: 0.003 },
    ];
    // Water leaves at fractions of the caecum-to-end-of-ascending run, the transverse colon and the descending colon.
    const at = [ends[0] * 0.5, (ends[0] + ends[1]) / 2, ends[1] + (ends[2] - ends[1]) * 0.3, ends[1] + (ends[2] - ends[1]) * 0.7, (ends[2] + ends[3]) / 2];
    WATER_IDS.length = 0;
    at.forEach((u, i) => {
      const lumen = colonPoints(u, u + 0.0001, 0.00005)[0];
      const angle = 0.9 + i * 1.3;
      const id = `water_${i}`;
      WATER_IDS.push(id);
      const path: V3[] = [lumen, wallPoint(u, 0.35, angle), wallPoint(u, 0.74, angle)];
      specs.push({ id, path: warpPoints(path), count: 14, size: 0.0013, color: WATER_COLOUR, speed: 0.006, spread: 0.0012 });
    });
    return specs;
  },

  animate: (ctx: DetailContext) => {
    for (const [id, base, extra] of GLASS) ctx.part(id)?.setOpacity(base + extra * ctx.activity(id));
    const still = ctx.reducedMotion;

    const transit = ctx.flow('transit');
    if (transit) {
      const load = ctx.activity('lumen_contents');
      transit.setRate(still ? 0.3 : 0.15 + 2.0 * load);
      transit.setDensity(0.1 + 0.9 * clamp((load - 0.15) / 0.5, 0, 1));
    }

    const absorb = clamp(ctx.activity('mucosa'), 0, 1);
    const load = clamp((ctx.activity('lumen_contents') - 0.15) / 0.4, 0, 1);
    for (const id of WATER_IDS) {
      const f = ctx.flow(id);
      if (!f) continue;
      f.setVisible(load > 0.03);
      f.setRate(still ? 0.4 : 0.2 + 2.0 * absorb);
      f.setDensity(0.2 + 0.8 * absorb);
    }
  },
};
