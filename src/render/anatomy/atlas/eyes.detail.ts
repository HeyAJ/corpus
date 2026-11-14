import type { OrganDetailSpec } from '../detail/types';
import { opticNervePath, PUPIL_AUTHORED_MM, PUPIL_CENTRES } from './eyes.parts';

/**
 * STREAMS AND ANIMATION OF THE EYES.
 *
 * THE PUPIL IS THE ONE THING THAT MOVES. Its diameter comes from `mind.pupil_mm`, the
 * engine's own pupil, which every drug and state reaches through the effect bus (an
 * opioid pins it, an antimuscarinic or fright widens it). The two discs were authored at
 * the model's resting 3.5 mm, so the scale is simply the live diameter over 3.5, applied
 * about each disc's own centre. The engine has a single pupil, so both discs follow it;
 * they are separate parts so a future per-eye signal needs no change to the geometry.
 *
 * The scale is clamped: the disc must neither vanish (a pinpoint pupil is still drawn)
 * nor grow past the iris, which is 12 mm across.
 *
 * REDUCED MOTION. The pupil is a measurement made visible, not decoration, so it stays
 * live under `prefers-reduced-motion`; it is already smoothed by `ctx.lerp`, and a pupil
 * that never moved would hide the very thing this view exists to show. The optic-nerve
 * stream is ornament and is held still.
 *
 * THE OPTIC NERVE STREAM runs from the retina towards the brain at a rate that falls with
 * consciousness: a visual signal does not stop in sleep, but the display scale here is
 * the same one that dims the retina and nerve, and it would be odd for the dimmed nerve
 * to carry a brisk stream.
 */

const MIN_SCALE = 0.25;
const MAX_SCALE = 2.6;

export const detail: OrganDetailSpec = {
  flows: () => [
    {
      id: 'optic_right',
      path: opticNervePath(1),
      count: 36,
      size: 0.0007,
      color: 0xffd36b,
      speed: 0.012,
      spread: 0.0007,
    },
    {
      id: 'optic_left',
      path: opticNervePath(-1),
      count: 36,
      size: 0.0007,
      color: 0xffd36b,
      speed: 0.012,
      spread: 0.0007,
    },
  ],

  animate: (ctx) => {
    const mm = ctx.lerp((s) => s.mind.pupil_mm);
    let scale = mm / PUPIL_AUTHORED_MM;
    if (!(scale >= MIN_SCALE)) scale = MIN_SCALE;
    if (scale > MAX_SCALE) scale = MAX_SCALE;
    ctx.part('pupil_right')?.setScale(scale, PUPIL_CENTRES[0]);
    ctx.part('pupil_left')?.setScale(scale, PUPIL_CENTRES[1]);

    const awake = ctx.lerp((s) => s.neuro.consciousness);
    const rate = ctx.reducedMotion ? 0 : 0.2 + 0.8 * (awake < 0 ? 0 : awake > 1 ? 1 : awake);
    ctx.flow('optic_right')?.setRate(rate);
    ctx.flow('optic_left')?.setRate(rate);
  },
};
