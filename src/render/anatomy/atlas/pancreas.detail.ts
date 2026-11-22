import * as THREE from 'three';
import type { DetailContext, FlowSpec, OrganDetailSpec } from '../detail/types';
import { bloodColour } from '../detail/blood';
import type { V3 } from '../sdf';
import { ALPHA_ORIGIN, BETA_ORIGIN, DUCT_PATH, arteryPath, veinPath } from './pancreas.parts';

/**
 * THE PANCREAS IN MOTION.
 *
 * Reads the part activities (which the data file drives from the digestive and glucose
 * signals), `anatomy.glands.pancreas_beta` and `pancreas_alpha` (the engine's secretion of
 * each islet hormone relative to its own resting output, 1 = basal) and the arterial and
 * venous saturations (blood colour, through the shared `bloodColour` ramp).
 *
 *   - GLASS. The four regions and the uncinate process, the acinar tissue, the main duct
 *     and the splenic vessels all enclose or carry something, so they are drawn as glass
 *     every frame (the brief's rule). Only the islets and the thin accessory duct stay
 *     solid: they are the contents a user should be able to tap.
 *   - PANCREATIC JUICE runs down the main duct towards the duodenum. Its rate is a resting
 *     trickle plus the acinar tissue's activity, which the data file drives from
 *     `digestion`, `fatLoad` and vagal outflow, so a meal in the gut speeds it up.
 *   - INSULIN (blue) and GLUCAGON (amber) leave the islets into the splenic vein in two
 *     colours. Each stream's speed and density follow its own gland's secretion, so a meal
 *     visibly strengthens the blue stream and a fall in glucose the amber one. The two
 *     rise and fall independently, which is the whole point of drawing two.
 *   - BLOOD. Arterial blood runs out along the splenic artery and venous blood back along
 *     the vein; both take their colour from the body's saturations.
 *
 * The hormone colours are drawing choices that do not appear on any other organ; the rates
 * are display scales, not secretion rates. The islets do not move, and under
 * `reducedMotion` the streams keep their colours but their speed is held at a slow steady
 * rate.
 */

const GLASS: readonly [string, number][] = [
  ['head', 0.2],
  ['neck', 0.2],
  ['body', 0.2],
  ['tail', 0.2],
  ['uncinate_process', 0.24],
  ['main_duct', 0.45],
  ['splenic_vessels', 0.4],
  // Finer structures (T2): the intercalated ducts carry the juice away from the acinus.
  ['intercalated_ducts', 0.45],
];

const INSULIN_COLOUR = 0x4aa3e0;
const GLUCAGON_COLOUR = 0xe8a838;
const JUICE_COLOUR = 0xe8dca0;

const tmp = new THREE.Color();
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The vein from a given index to the neck, with an islet origin prepended: where a hormone joins the blood. */
function viaVein(origin: V3, from: number): V3[] {
  return [origin, ...veinPath().slice(from)];
}

/** A gland's secretion relative to rest, 1 if the engine does not report it. */
function secretion(glands: Record<string, number>, id: string): number {
  const v = glands[id];
  return typeof v === 'number' && Number.isFinite(v) ? v : 1;
}

export const detail: OrganDetailSpec = {
  flows: () => {
    const specs: FlowSpec[] = [
      { id: 'juice', path: DUCT_PATH, count: 70, size: 0.0011, color: JUICE_COLOUR, speed: 0.014, spread: 0.0004 },
      { id: 'insulin', path: viaVein(BETA_ORIGIN, 2), count: 60, size: 0.0014, color: INSULIN_COLOUR, speed: 0.012, spread: 0.0006 },
      { id: 'glucagon', path: viaVein(ALPHA_ORIGIN, 0), count: 60, size: 0.0014, color: GLUCAGON_COLOUR, speed: 0.012, spread: 0.0006 },
      { id: 'artery', path: arteryPath().reverse(), count: 24, size: 0.0012, color: 0xc8323a, speed: 0.016, spread: 0.0004 },
      { id: 'vein', path: veinPath(), count: 24, size: 0.0012, color: 0x6a4a7a, speed: 0.012, spread: 0.0004 },
    ];
    return specs;
  },

  animate: (ctx: DetailContext) => {
    for (const [id, o] of GLASS) ctx.part(id)?.setOpacity(o);
    ctx.part('acinar_tissue')?.setOpacity(0.18 + 0.22 * ctx.activity('acinar_tissue'));

    const act = ctx.activity('acinar_tissue');
    const juice = ctx.flow('juice');
    if (juice) {
      juice.setRate(ctx.reducedMotion ? 0.3 : 0.25 + 2.5 * act);
      juice.setDensity(clamp(0.3 + 1.4 * act, 0.3, 1));
    }

    const beta = clamp(ctx.lerp((s) => secretion(s.anatomy.glands, 'pancreas_beta')), 0, 4);
    const alpha = clamp(ctx.lerp((s) => secretion(s.anatomy.glands, 'pancreas_alpha')), 0, 4);
    const insulin = ctx.flow('insulin');
    if (insulin) {
      insulin.setRate(ctx.reducedMotion ? 0.3 : clamp(beta, 0.15, 3));
      insulin.setDensity(clamp(0.15 + 0.3 * beta, 0.15, 1));
    }
    const glucagon = ctx.flow('glucagon');
    if (glucagon) {
      glucagon.setRate(ctx.reducedMotion ? 0.3 : clamp(alpha, 0.15, 3));
      glucagon.setDensity(clamp(0.15 + 0.3 * alpha, 0.15, 1));
    }

    ctx.flow('artery')?.setColor(bloodColour(tmp, ctx.snapshot.transport.arterialSat));
    ctx.flow('vein')?.setColor(bloodColour(tmp, ctx.snapshot.transport.venousSat));
  },
};
