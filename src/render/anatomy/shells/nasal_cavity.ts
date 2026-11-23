import * as THREE from 'three';
import { ellipsoid, polygonise, smoothUnion } from '../sdf';

/**
 * NASAL CAVITY AND SINUSES, SHELL.
 *
 * Frame: origin at organs.json [0, 0.352, 0.05], y = 0.412 in the scene after the cranial
 * lift. DERIVED from the eyes shell (globes at x = +-0.031, y 0.386 + 0.06 = 0.446, z 0.06,
 * radius 12 mm): the cavity lies between the orbits and below them, so its top is under the
 * globes' lower edge (0.434) and it is narrow enough to fit between two globes 62 mm apart.
 * Its floor is the palate, which the mouth shell's top (0.38 + 0.012 = 0.392) meets from
 * below. Front to back it runs from the nostrils (z about +0.036) to the choanae (z -0.032),
 * opening into the nasopharynx behind it.
 *
 * WHAT WENT WRONG IN THE STUB. It was two ellipsoids that met on the midline, so at x = 0
 * the union had a waist only 15 mm tall and the septum, drawn 39 mm tall, stuck out of the
 * silhouette. The two chambers are now centred 8.5 mm out (so each just touches the
 * midline) and a median column fills the gap: the septum and the bone and cartilage that
 * carry it, which is how a nose looks in profile.
 *
 * The silhouette is: the two chambers, the median column, a flared vestibule a side (the
 * nostril), the maxillary sinus a side (the largest, below the orbit), the frontal sinus a
 * side (above the nasal root, between the globes), a block of ethmoidal cells between the
 * orbit and the cavity, and the sphenoidal sinus behind. All sizes are drawing choices that
 * keep the parts in the atlas inside; none is a measurement.
 */
export function nasalCavity(): THREE.BufferGeometry {
  const chamber = (s: number) => ellipsoid([s * 0.0085, 0, 0], [0.0085, 0.022, 0.032]);
  const side = (s: number) => [
    chamber(s),
    ellipsoid([s * 0.0085, -0.012, 0.03], [0.007, 0.008, 0.006]), // vestibule, the flare of the nostril
    ellipsoid([s * 0.028, -0.012, -0.002], [0.0115, 0.0115, 0.0145]), // maxillary sinus
    ellipsoid([s * 0.0105, 0.03, 0.0105], [0.0068, 0.006, 0.0072]), // frontal sinus
    ellipsoid([s * 0.0185, 0.0165, 0.0035], [0.0050, 0.0085, 0.0115]), // ethmoidal cells
    ellipsoid([s * 0.0055, 0.0115, -0.0225], [0.0058, 0.0058, 0.0075]), // sphenoidal sinus
  ];
  const field = smoothUnion(
    0.003,
    ellipsoid([0, 0, 0], [0.0035, 0.021, 0.031]), // the median column
    ...side(1),
    ...side(-1),
  );
  return polygonise(field, [-0.045, -0.026, -0.04], [0.045, 0.04, 0.042], { cell: 0.0045 });
}
