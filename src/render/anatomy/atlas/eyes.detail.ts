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

/**
 * WHICH PARTS ARE GLASS. The first version drew the sclera and cornea opaque, so the
 * choroid, retina and everything else inside could never have been seen; a part drawn
 * below 0.98 opacity stops writing depth and lets what is behind it show. Everything that
 * CONTAINS something is therefore glass (the coats, the chambers, the vitreous, the lids and
 * conjunctiva, the lens and its shells, the retina and its layers, the tear passages) and
 * what is inside is solid. The values are display choices tuned so that the nesting stays
 * readable; they are not measured transparency. The iris and the two pupils are left as
 * they were, solid, so the live pupil is as plain to see as before.
 */
const GLASS: Readonly<Record<string, number>> = {
  sclera: 0.3,
  cornea: 0.26,
  conjunctiva: 0.12,
  eyelids: 0.2,
  tarsal_plates: 0.45,
  lens: 0.5,
  lens_capsule: 0.22,
  lens_cortex: 0.35,
  retina: 0.4,
  choroid: 0.28,
  optic_nerve: 0.5,
  aqueous_humour: 0.14,
  anterior_chamber: 0.2,
  posterior_chamber: 0.2,
  vitreous_body: 0.1,
  scleral_venous_sinus: 0.5,
  lacrimal_canaliculi: 0.5,
  lacrimal_sac: 0.45,
  nasolacrimal_duct: 0.4,
  retinal_pigment_epithelium: 0.5,
  rods: 0.5,
  cones: 0.5,
  outer_nuclear_layer: 0.5,
  outer_plexiform_layer: 0.5,
  horizontal_cells: 0.5,
  bipolar_cells: 0.5,
  amacrine_cells: 0.5,
  ganglion_cells: 0.5,
  nerve_fibre_layer: 0.5,
  corneal_epithelium: 0.3,
  bowman_layer: 0.35,
  corneal_stroma: 0.3,
  descemet_membrane: 0.4,
  corneal_endothelium: 0.4,
};

/**
 * THE AQUEOUS CIRCUIT: made at the ciliary body, through the space behind the iris, out
 * through the pupil, across the front chamber and out through the angle into the sinus.
 * The stream runs at one steady display rate: the model has no aqueous signal, and the
 * stream is held still under reduced motion like every other ornament.
 */
function aqueousPath(s: 1 | -1) {
  const cx = s * 0.031;
  return [
    [cx, 0.0072, 0.0066],
    [cx, 0.005, 0.0086],
    [cx, 0.0008, 0.0094],
    [cx, 0.0035, 0.0112],
    [cx, 0.0072, 0.0084],
    [cx, 0.009, 0.0066],
  ] as [number, number, number][];
}

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
    { id: 'aqueous_right', path: aqueousPath(1), count: 24, size: 0.00045, color: 0x8fd0f0, speed: 0.004, spread: 0.0003 },
    { id: 'aqueous_left', path: aqueousPath(-1), count: 24, size: 0.00045, color: 0x8fd0f0, speed: 0.004, spread: 0.0003 },
  ],

  animate: (ctx) => {
    for (const id of Object.keys(GLASS)) ctx.part(id)?.setOpacity(GLASS[id]);
    ctx.flow('aqueous_right')?.setRate(ctx.reducedMotion ? 0 : 1);
    ctx.flow('aqueous_left')?.setRate(ctx.reducedMotion ? 0 : 1);
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
