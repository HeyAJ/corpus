import type { OrganDetailSpec } from '../detail/types';

/**
 * No streams and no animation. Bone is not simulated as tissue, and the only part with a drive
 * (the red marrow) changes colour, not shape, so there is nothing to move.
 *
 * WHICH PARTS ARE GLASS. A part drawn below 0.98 opacity stops writing depth and lets what is
 * behind it show. What CONTAINS something is glass: the discs round their nuclei, the sacral
 * canal, the three region parts (their vertebrae are shown inside them when a child is selected),
 * and the curvature guides, which are guides rather than tissue. The marrow inside the bodies is
 * solid so that it can be seen through the bone. The opacities are display choices.
 */
const GLASS: Readonly<Record<string, number>> = {
  cervical_vertebrae: 0.5,
  thoracic_vertebrae: 0.5,
  lumbar_vertebrae: 0.5,
  intervertebral_discs: 0.4,
  annulus_fibrosus: 0.3,
  sacral_canal: 0.3,
  cervical_lordosis: 0.5,
  thoracic_kyphosis: 0.5,
  lumbar_lordosis: 0.5,
  sacral_kyphosis: 0.5,
  sacrum: 0.6,
  typical_vertebra: 0.45,
};

export const detail: OrganDetailSpec = {
  animate: (ctx) => {
    for (const id of Object.keys(GLASS)) ctx.part(id)?.setOpacity(GLASS[id]);
  },
};
