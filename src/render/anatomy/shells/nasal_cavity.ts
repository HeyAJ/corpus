import * as THREE from 'three';
import { ellipsoid, polygonise, smoothUnion } from '../sdf';

/**
 * NASAL CAVITY AND SINUSES, STUB SHELL.
 *
 * Frame: origin at organs.json [0, 0.352, 0.05], y = 0.412 in the scene after the cranial
 * lift. DERIVED from the eyes shell (globes at x = +-0.031, y 0.386 + 0.06 = 0.446, z 0.06,
 * radius 12 mm): the cavity lies between the orbits and below them, so its top is under the
 * globes' lower edge (0.434) and it is narrow enough (x within +-0.012 either side of the
 * septum) to fit between two globes 62 mm apart. Its floor is the palate, which the mouth
 * shell's top (0.38 + 0.012 = 0.392) meets from below. Front to back it runs from the nostrils
 * (z 0.082) to the choanae (z 0.018), opening into the nasopharynx behind it.
 *
 * Two chambers either side of the midline, plus a maxillary sinus a side (the largest
 * sinus, below the orbit). The frontal, ethmoid and sphenoid sinuses are for the content agent.
 * Sizes are drawing choices, not measurements.
 */
export function nasalCavity(): THREE.BufferGeometry {
  const chamber = (s: number) => ellipsoid([s * 0.008, 0, 0], [0.0085, 0.022, 0.032]);
  const field = smoothUnion(
    0.004,
    chamber(1),
    chamber(-1),
    ellipsoid([0.026, -0.012, -0.002], [0.011, 0.011, 0.014]), // right maxillary sinus
    ellipsoid([-0.026, -0.012, -0.002], [0.011, 0.011, 0.014]), // left maxillary sinus
  );
  return polygonise(field, [-0.04, -0.026, -0.02], [0.04, 0.026, 0.036], { cell: 0.003 });
}
