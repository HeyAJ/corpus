import type { OrganDetailSpec } from '../detail/types';
import { BRONCHUS_LEFT_END, BRONCHUS_RIGHT_END, CARINA } from '../models';
import { TRACHEA_CENTRELINE } from '../paths';
import type { V3 } from '../sdf';
import { breathTracker } from './lungShared';

/**
 * STREAMS AND ANIMATION OF THE TRACHEA.
 *
 * Two air streams run down the lumen and into the two main bronchi on inspiration and back
 * up on expiration. The direction and speed come from the change in lung inflation, as in
 * the lungs (see breathTracker in lungShared.ts); the stream stops in apnoea. The right
 * bronchus is the wider and takes the larger share of the air, so its stream is the denser.
 * A slow stream of mucus runs UP the back wall all the time: the mucociliary escalator
 * sweeps trapped particles toward the throat whether or not the body is breathing.
 *
 * The larynx rises with swallowing. The engine's swallowing signal reaches the part as
 * activity, so the excess over the larynx's resting level (0.15 in trachea.json) is the
 * swallow; the vocal folds draw together as it rises.
 */

const LARYNX_REST = 0.15;
const LARYNX_SWALLOW_WEIGHT = 0.5;

/** The same centreline the shell and the parts follow (paths.ts), so the air stream stays inside the airway. */
const TRUNK: readonly V3[] = TRACHEA_CENTRELINE;

function toBronchus(end: V3): V3[] {
  return [...TRUNK, [(CARINA[0] + end[0]) / 2, (CARINA[1] + end[1]) / 2, (CARINA[2] + end[2]) / 2], end];
}

const tracker = breathTracker();
// Reused every frame so the animation allocates nothing.
const RISE: [number, number, number] = [0, 0, 0];
const CILIA: [number, number, number] = [0, 0, 0];
const FOLD_SCALE: [number, number, number] = [1, 1, 1];
const FOLD_PIVOT: V3 = [0, 0.362, 0];
const WARM = [0.85, 0.5, 0.23];

function warm(c: { r: number; g: number; b: number }, k: number): number {
  const r = Math.round((c.r + (WARM[0] - c.r) * k) * 255);
  const g = Math.round((c.g + (WARM[1] - c.g) * k) * 255);
  const b = Math.round((c.b + (WARM[2] - c.b) * k) * 255);
  return (r << 16) | (g << 8) | b;
}

/**
 * Parts of the larynx that move with it in a swallow. The cartilages, folds and membranes are
 * one assembly, so they are lifted by the same offset as the thyroid cartilage.
 */
const LARYNX_RIDERS = [
  'epiglottis', 'arytenoid_cartilages', 'corniculate_cartilages', 'cuneiform_cartilages', 'vestibular_folds',
  'laryngeal_ventricle', 'rima_glottidis', 'cricothyroid_ligament', 'thyrohyoid_membrane',
];

/** Opacity of each layer of the wall and of the hollow laryngeal spaces: drawing choices, not data. */
const GLASS: [string, number][] = [
  ['tracheal_wall', 0.1], ['tracheal_mucosa', 0.22], ['adventitia', 0.14], ['hyaline_cartilage', 0.5],
  ['seromucous_glands', 0.6], ['laryngeal_ventricle', 0.35], ['rima_glottidis', 0.5], ['thyrohyoid_membrane', 0.5],
  ['cricothyroid_ligament', 0.6],
];

/**
 * DISPLAY CONSTANTS FOR THE CILIA. The beat is drawn as a small to-and-fro sweep of the whole
 * tuft layer along the airway axis; it is a picture of a beating cilium, not a measured beat
 * frequency or amplitude. It runs at rest and in apnoea alike (the mucociliary escalator does
 * not depend on breathing) and stops under reduced motion.
 */
const CILIA_SWEEP_M = 0.00028;
const CILIA_RAD_PER_S = 9;

export const detail: OrganDetailSpec = {
  flows: () => [
    { id: 'air_right', path: toBronchus(BRONCHUS_RIGHT_END), count: 44, size: 0.0014, color: 0xbfe3f0, speed: 0.1, spread: 0.0035 },
    { id: 'air_left', path: toBronchus(BRONCHUS_LEFT_END), count: 26, size: 0.0014, color: 0xbfe3f0, speed: 0.1, spread: 0.003 },
    {
      id: 'mucus',
      path: [[0, 0.258, -0.004], [0, 0.29, -0.0045], [0, 0.322, -0.0055], [0, 0.35, -0.0075]],
      count: 30, size: 0.0009, color: 0xe8dca0, speed: 0.012, spread: 0.004,
    },
  ],
  animate: (ctx) => {
    const bc = Math.max(0, Math.min(1, ctx.snapshot.fluids.bronchoconstriction));
    const rate = tracker.update(ctx) * (1 - 0.5 * bc);
    ctx.flow('air_right')?.setRate(rate);
    ctx.flow('air_left')?.setRate(rate);
    ctx.flow('air_right')?.setDensity(1 - 0.6 * bc);
    ctx.flow('air_left')?.setDensity(1 - 0.6 * bc);
    // Mucus moves toward the throat (the path runs carina to larynx, so the rate is positive).
    ctx.flow('mucus')?.setRate(ctx.reducedMotion ? 0 : 1);

    for (const id of ['right_main_bronchus', 'left_main_bronchus', 'trachealis']) {
      const part = ctx.part(id);
      if (part && bc > 0) part.setColor(warm(part.baseColor, 0.8 * bc));
    }

    const swallow = ctx.reducedMotion
      ? 0
      : Math.max(0, Math.min(1, (ctx.activity('larynx') - LARYNX_REST) / LARYNX_SWALLOW_WEIGHT));
    RISE[1] = 0.004 * swallow;
    RISE[2] = 0.0008 * swallow;
    ctx.part('larynx')?.setOffset(RISE);
    for (const id of LARYNX_RIDERS) ctx.part(id)?.setOffset(RISE);
    for (const [id, o] of GLASS) ctx.part(id)?.setOpacity(o);
    // The ciliated layer: the sweep is along the airway (y), toward the throat on the power stroke.
    if (!ctx.reducedMotion) {
      CILIA[1] = CILIA_SWEEP_M * Math.sin(ctx.time * CILIA_RAD_PER_S);
      ctx.part('ciliated_epithelium')?.setOffset(CILIA);
    }
    const folds = ctx.part('vocal_folds');
    if (folds) {
      folds.setOffset(RISE);
      FOLD_SCALE[0] = 1 - 0.65 * swallow;
      folds.setScale(FOLD_SCALE, FOLD_PIVOT);
    }
  },
};
