import * as THREE from 'three';
import { ellipsoid, mergeParts, polygonise, smoothUnion } from '../sdf';

/**
 * SALIVARY GLANDS, STUB SHELL. Three pairs in one organ.
 *
 * Frame: origin at organs.json [0, 0.33, 0.02], which is y = 0.39 in the scene after the
 * cranial group's +0.06 lift, about the height of the mouth's floor. Each pair is placed
 * from the neighbouring shells, never from a free guess:
 *
 *   - PAROTID: in front of and below the ear. The ears shell puts the ear canal at
 *     x = +-0.062 and y = 0.386 (before the lift), z = -0.012; the gland lies 2 to 3 cm
 *     below and a little in front of that, against the cheek inside the skull's outline
 *     (the brain is 0.066 wide at most). Centre local (+-0.058, 0.022, -0.015).
 *   - SUBMANDIBULAR: under the body of the mandible, below the mouth shell (whose floor is
 *     12 mm under its origin) and well to the side of the larynx (which is under 16 mm wide).
 *     Centre local (+-0.034, -0.03, 0.01).
 *   - SUBLINGUAL: the smallest, in the floor of the mouth beside the midline, just under
 *     the mouth shell's origin line. Centre local (+-0.014, -0.012, 0.038).
 *
 * Sizes are drawing choices: the parotid is the largest and the sublingual the smallest,
 * which is the one fact about them a student must come away with. This is the placeholder
 * the content agent replaces with lobules, ducts and the duct openings.
 */
export function salivaryGlands(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    const field = smoothUnion(
      0.002,
      ellipsoid([s * 0.058, 0.022, -0.015], [0.009, 0.02, 0.014]), // parotid
      ellipsoid([s * 0.034, -0.03, 0.01], [0.012, 0.008, 0.016]), // submandibular
      ellipsoid([s * 0.014, -0.012, 0.038], [0.006, 0.005, 0.014]), // sublingual
    );
    // The three glands of one side are far apart, so one box would be mostly empty grid:
    // each side is polygonised on its own box and the two sides are merged.
    const x0 = Math.min(s * 0.005, s * 0.07);
    const x1 = Math.max(s * 0.005, s * 0.07);
    parts.push(polygonise(field, [x0, -0.04, -0.034], [x1, 0.046, 0.056], { cell: 0.0055, maxCells: 120000 }));
  }
  return mergeParts(parts);
}
