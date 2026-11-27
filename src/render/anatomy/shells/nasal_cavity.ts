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
 * THE OLFACTORY CLEFT. The brain atlas draws the olfactory bulbs just under the frontal lobes, at
 * scene y about 0.4705 (local y 0.0585 here), x 0.008 to 0.014 and z 0.062 to 0.075. Anatomically a bulb
 * rests ON the cribriform plate, so the roof of the cavity is carried up from the chamber as a
 * narrow cleft to that height, passing between the medial walls of the two orbits (the globes'
 * medial edges are at x 0.021 and the cleft's widest point is 0.0168, so they do not meet) and
 * behind the lacrimal sacs (z 0.0634 at most; the cleft starts at 0.0645). The frontal sinus
 * moved up and out to lie above the orbit. The cleft is much taller than a real one; the height
 * is set by where the bulb is drawn.
 *
 * The silhouette is: the two chambers, the median column, a flared vestibule a side (the
 * nostril), the maxillary sinus a side (the largest, below the orbit), the frontal sinus a
 * side (above the nasal root, between the globes), a block of ethmoidal cells between the
 * orbit and the cavity, and the sphenoidal sinus behind. All sizes are drawing choices that
 * keep the parts in the atlas inside; none is a measurement.
 */
/**
 * THE FLOOR WAS RAISED 3 MM (gx2). The chambers' lowest point was scene y 0.390 and the mouth
 * shell's roof is 0.3919 at the centre of the palate (shells/mouth.ts is not changed: its doorway
 * and teeth were fitted), so the two cavities crossed and there was no room for the hard palate
 * between them (Gray's 42nd: the hard palate, the palatine process of the maxilla and the
 * horizontal plate of the palatine bone, is the floor of the nose AND the roof of the mouth). The
 * chambers, the median column and the vestibule are shortened from below by this much and keep
 * their tops, so the roof, the olfactory cleft and everything above are where they were. A
 * drawing choice: it leaves 1.1 mm of bone at the pinch and more elsewhere.
 */
export const FLOOR_LIFT_M = 0.003;
export function nasalCavity(): THREE.BufferGeometry {
  const chamber = (s: number) => ellipsoid([s * 0.0085, FLOOR_LIFT_M / 2, 0], [0.0085, 0.022 - FLOOR_LIFT_M / 2, 0.032]);
  const side = (s: number) => [
    chamber(s),
    ellipsoid([s * 0.0085, -0.012 + FLOOR_LIFT_M / 2, 0.03], [0.007, 0.008 - FLOOR_LIFT_M / 2, 0.006]), // vestibule, the flare of the nostril
    ellipsoid([s * 0.028, -0.012, -0.002], [0.0115, 0.0115, 0.0145]), // maxillary sinus
    ellipsoid([s * 0.0205, 0.0535, 0.005], [0.0075, 0.0065, 0.008]), // frontal sinus, above the orbit's medial part
    ellipsoid([s * 0.011, 0.0385, 0.0205], [0.0058, 0.027, 0.0095]), // olfactory cleft, up to the underside of the olfactory bulb
    ellipsoid([s * 0.0165, 0.0135, 0.0035], [0.0045, 0.008, 0.0115]), // ethmoidal cells, kept medial to the globe
    ellipsoid([s * 0.0055, 0.0115, -0.0225], [0.0058, 0.0058, 0.0075]), // sphenoidal sinus
  ];
  const field = smoothUnion(
    0.003,
    ellipsoid([0, FLOOR_LIFT_M / 2, 0], [0.0035, 0.021 - FLOOR_LIFT_M / 2, 0.031]), // the median column
    ...side(1),
    ...side(-1),
  );
  return polygonise(field, [-0.045, -0.026, -0.04], [0.045, 0.075, 0.042], { cell: 0.0045 });
}
