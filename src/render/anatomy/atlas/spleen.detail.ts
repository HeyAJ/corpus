import * as THREE from 'three';
import type { DetailContext, FlowSpec, OrganDetailSpec } from '../detail/types';
import { bloodColour } from '../detail/blood';
import { ARTERY_ENTRY, VEIN_EXIT, arteryBranches, veinBranches } from './spleen.parts';

/**
 * THE SPLEEN IN MOTION.
 *
 * Reads the part activities (which the data file drives from the immune, infection,
 * inflammation and haemolysis signals), `cardio.cardiacOutput_L_per_min` (how fast blood
 * is driven through the organ) and the arterial and venous saturations (blood colour,
 * through the shared `bloodColour` ramp).
 *
 *   - GLASS. The capsule, red pulp, marginal zone, artery and vein all enclose or carry
 *     something, so they are glass every frame (the brief's rule): the follicles, the
 *     trabeculae and the hilum cord, which are the contents a user taps, stay solid.
 *   - INFLOW. Arterial blood runs in along three branches from the hilum, in the arterial
 *     colour that follows the body's arterial saturation.
 *   - OUTFLOW. Filtered blood leaves along three veins to the hilum, in the venous colour
 *     that follows venous saturation.
 *   - SPEED. Every stream runs at the cardiac output divided by 5 L/min, a display scale
 *     near this engine's resting output and not a measured splenic flow. A stopped heart
 *     stops the streams.
 *   - WHITE PULP. The follicles glow with the part's activity (the default) and in
 *     addition brighten towards white as it rises, and the glass marginal zone round
 *     them becomes more visible, so an infection or an immune response shows as lit
 *     follicles. Under `reducedMotion` nothing here moves; only colours change.
 */

const GLASS: readonly [string, number][] = [
  ['capsule', 0.16],
  ['splenic_artery', 0.4],
  ['splenic_vein', 0.42],
];

/**
 * THE FINER STRUCTURES. Vessels, the lymphoid sheath, the sinuses and the ligament sheets
 * enclose or carry something, so they are glass; germinal centres, cords and macrophages are
 * content and stay solid. Opacities are drawing choices.
 */
const CHILD_GLASS: readonly [string, number][] = [
  ['central_arteriole', 0.55],
  ['periarteriolar_lymphoid_sheath', 0.3],
  ['trabecular_arteries', 0.55],
  ['penicillar_arterioles', 0.6],
  ['venous_sinuses', 0.3],
  ['gastrosplenic_ligament', 0.28],
  ['splenorenal_ligament', 0.28],
];

const FOLLICLE_BRIGHT = new THREE.Color(0xf4efe6);
const tmp = new THREE.Color();
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export const detail: OrganDetailSpec = {
  flows: () => {
    const specs: FlowSpec[] = [];
    arteryBranches().forEach((b, i) => {
      specs.push({ id: `in_${i}`, path: [ARTERY_ENTRY, ...b], count: 34, size: 0.0012, color: 0xc8323a, speed: 0.014, spread: 0.0005 });
    });
    veinBranches().forEach((b, i) => {
      specs.push({ id: `out_${i}`, path: [...b, VEIN_EXIT], count: 34, size: 0.0012, color: 0x6a4a7a, speed: 0.012, spread: 0.0006 });
    });
    return specs;
  },

  animate: (ctx: DetailContext) => {
    for (const [id, o] of GLASS) ctx.part(id)?.setOpacity(o);
    for (const [id, o] of CHILD_GLASS) ctx.part(id)?.setOpacity(o);
    ctx.part('red_pulp')?.setOpacity(0.2 + 0.2 * ctx.activity('red_pulp'));
    const white = ctx.activity('white_pulp');
    ctx.part('marginal_zone')?.setOpacity(0.18 + 0.3 * ctx.activity('marginal_zone'));

    const follicles = ctx.part('white_pulp');
    if (follicles) follicles.setColor(tmp.copy(follicles.baseColor).lerp(FOLLICLE_BRIGHT, 0.6 * clamp(white, 0, 1)));

    const rate = ctx.reducedMotion ? 0.3 : clamp(ctx.lerp((s) => s.cardio.cardiacOutput_L_per_min) / 5, 0, 2.5);
    const arterial = bloodColour(tmp, ctx.snapshot.transport.arterialSat).getHex();
    for (let i = 0; i < 3; i++) {
      const a = ctx.flow(`in_${i}`);
      if (a) {
        a.setRate(rate);
        a.setColor(arterial);
      }
    }
    const venous = bloodColour(tmp, ctx.snapshot.transport.venousSat).getHex();
    for (let i = 0; i < 3; i++) {
      const v = ctx.flow(`out_${i}`);
      if (v) {
        v.setRate(rate);
        v.setColor(venous);
      }
    }
  },
};
