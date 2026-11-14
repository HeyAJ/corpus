import type { OrganDetailSpec } from '../detail/types';
import { BRONCHUS_LEFT_END, BRONCHUS_RIGHT_END, CARINA } from '../models';
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

const TRUNK: V3[] = [
  [0, 0.352, 0],
  [0, 0.32, 0.002],
  [0, 0.285, 0.004],
  [CARINA[0], CARINA[1], CARINA[2]],
];

function toBronchus(end: V3): V3[] {
  return [...TRUNK, [(CARINA[0] + end[0]) / 2, (CARINA[1] + end[1]) / 2, (CARINA[2] + end[2]) / 2], end];
}

const tracker = breathTracker();
// Reused every frame so the animation allocates nothing.
const RISE: [number, number, number] = [0, 0, 0];
const FOLD_SCALE: [number, number, number] = [1, 1, 1];
const FOLD_PIVOT: V3 = [0, 0.362, 0];
const WARM = [0.85, 0.5, 0.23];

function warm(c: { r: number; g: number; b: number }, k: number): number {
  const r = Math.round((c.r + (WARM[0] - c.r) * k) * 255);
  const g = Math.round((c.g + (WARM[1] - c.g) * k) * 255);
  const b = Math.round((c.b + (WARM[2] - c.b) * k) * 255);
  return (r << 16) | (g << 8) | b;
}

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
    const folds = ctx.part('vocal_folds');
    if (folds) {
      folds.setOffset(RISE);
      FOLD_SCALE[0] = 1 - 0.65 * swallow;
      folds.setScale(FOLD_SCALE, FOLD_PIVOT);
    }
  },
};
