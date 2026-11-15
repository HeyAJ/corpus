import type { DetailContext, FlowSpec, OrganDetailSpec } from '../detail/types';
import { bowelPoints, lacteal0, lymphTrunk, mesentericLayout, slabVein, veinBranch, veinTrunk } from './intestine_small.parts';
import type { V3 } from '../sdf';

/**
 * THE SMALL INTESTINE IN MOTION.
 *
 * Reads the part activities (which the data file drives from the engine's digestion,
 * transit, absorption, fat and motility signals), the peristaltic phase and the glucose
 * absorption rate in `snapshot.gi`.
 *
 *   - GLASS. The three regions, the muscular wall, the villus patch, the lacteals and the
 *     mesenteric vessels all enclose or carry something, so they are drawn as glass every
 *     frame (the brief's rule). The chyme, the circular folds, the Peyer's patches and the
 *     ileocaecal junction are contents or things to tap, and stay solid.
 *   - CHYME runs along the whole lumen. Its rate is a resting trickle plus the activity of
 *     the lumen-contents part (transit, digestion and motility signals), pulsed with the
 *     engine's peristaltic phase so the stream surges rather than flows evenly. With
 *     nothing in the small bowel the stream thins to a few particles. The pulse is a display
 *     of the phase, not a measured wave speed.
 *   - ABSORBED NUTRIENTS leave the enlarged villi and the arcades' veins towards the portal
 *     vein. Rate and density follow `glucoseAbsorption_mg_per_min` on the same 400 mg/min
 *     display scale the engine's own `absorption` signal uses, so a meal visibly lights them
 *     and a fasting body shows almost nothing.
 *   - CHYLE runs in the lacteals and the lymph trunk only while the lacteals' activity is
 *     above its resting value, which the data file drives from the fat load in the upper
 *     gut. No fat, no lymph stream.
 *
 * Under `reducedMotion` the streams keep their colours and visibility but run at a slow
 * steady rate.
 */

const GLASS: readonly [string, number, number][] = [
  // id, base opacity, extra with activity
  ['duodenum', 0.22, 0.2],
  ['jejunum', 0.22, 0.2],
  ['ileum', 0.22, 0.2],
  ['muscular_wall', 0.14, 0.14],
  ['mucosa_villi', 0.3, 0.2],
  ['lacteals', 0.4, 0.1],
  ['mesenteric_vessels', 0.4, 0.1],
];

const CHYME_COLOUR = 0xb99a52;
const NUTRIENT_COLOUR = 0xe6b84a;
const CHYLE_COLOUR = 0xf3ecd2;

/** Same scale as the engine's `absorption` signal (derive/anatomy.ts): 400 mg/min is full. */
const ABSORPTION_FULL_MG_PER_MIN = 400;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** An arcade vein run from a bowel-wall end back to the hub and up the trunk to the portal side. */
function drainage(k: number): V3[] {
  const b = veinBranch(k);
  return [...b.slice().reverse(), ...veinTrunk().slice(1)];
}

export const detail: OrganDetailSpec = {
  flows: () => {
    const lay = mesentericLayout();
    const n = lay.branches.length;
    const chymePath = bowelPoints(0, 1, 0.02);
    const specs: FlowSpec[] = [
      { id: 'chyme', path: chymePath, count: 200, size: 0.0018, color: CHYME_COLOUR, speed: 0.03, spread: 0.0022 },
      { id: 'nutrients_villi', path: [...slabVein(), ...veinTrunk().slice(2)], count: 50, size: 0.0012, color: NUTRIENT_COLOUR, speed: 0.02, spread: 0.0006 },
      { id: 'nutrients_jejunal', path: drainage(Math.floor(n * 0.25)), count: 36, size: 0.0011, color: NUTRIENT_COLOUR, speed: 0.016, spread: 0.0004 },
      { id: 'nutrients_mid', path: drainage(Math.floor(n * 0.5)), count: 36, size: 0.0011, color: NUTRIENT_COLOUR, speed: 0.016, spread: 0.0004 },
      { id: 'nutrients_ileal', path: drainage(Math.floor(n * 0.8)), count: 36, size: 0.0011, color: NUTRIENT_COLOUR, speed: 0.016, spread: 0.0004 },
      { id: 'chyle', path: [lacteal0(), ...lymphTrunk()], count: 50, size: 0.0011, color: CHYLE_COLOUR, speed: 0.018, spread: 0.0004 },
    ];
    return specs;
  },

  animate: (ctx: DetailContext) => {
    for (const [id, base, extra] of GLASS) ctx.part(id)?.setOpacity(base + extra * ctx.activity(id));
    const still = ctx.reducedMotion;

    // --- chyme: surges with the peristaltic phase.
    const chyme = ctx.flow('chyme');
    if (chyme) {
      const load = ctx.activity('lumen_contents');
      const phase = ctx.lerp((s) => s.gi.peristalsisPhase);
      const surge = still ? 1 : 0.65 + 0.35 * Math.sin(phase * Math.PI * 2);
      chyme.setRate((0.15 + 1.6 * load) * surge);
      chyme.setDensity(0.08 + 0.92 * clamp((load - 0.15) / 0.5, 0, 1));
    }

    // --- nutrients: rate and density from the absorption signal.
    const absorb = clamp(ctx.lerp((s) => s.gi.glucoseAbsorption_mg_per_min) / ABSORPTION_FULL_MG_PER_MIN, 0, 1);
    const nutrientRate = still ? 0.4 : 0.2 + 2.8 * absorb;
    for (const id of ['nutrients_villi', 'nutrients_jejunal', 'nutrients_mid', 'nutrients_ileal']) {
      const f = ctx.flow(id);
      if (!f) continue;
      f.setRate(nutrientRate);
      f.setVisible(absorb > 0.01);
      f.setDensity(0.15 + 0.85 * absorb);
    }

    // --- chyle: only while fat is arriving.
    const chyle = ctx.flow('chyle');
    if (chyle) {
      const fat = clamp((ctx.activity('lacteals') - 0.12) * 2.5, 0, 1);
      chyle.setVisible(fat > 0.02);
      chyle.setRate(still ? 0.4 : 0.3 + 1.5 * fat);
      chyle.setDensity(0.2 + 0.8 * fat);
    }
  },
};
