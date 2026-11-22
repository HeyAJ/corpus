import * as THREE from 'three';
import { capsule, mergeParts, polygonise, smoothUnion, sphere } from '../sdf';

/**
 * EARS, STUB SHELL. Both ears in one organ, the pattern the eyes use.
 *
 * Frame: origin at organs.json [0, 0.386, -0.012]. The height is the eyes' own (0.386, then
 * lifted 0.06 with the cranial group): the brief is "temporal region at about eye level".
 * In z it is 7.2 cm behind the globes (z 0.06), the order of the distance from pupil to ear
 * canal in an adult head. The lateral limit is |x| 0.074, just outside the brain shell's
 * widest point (0.066) and the thickness of a temporal bone beyond it; the medial end,
 * where the inner ear sits against the petrous bone, is at |x| 0.034, which is under the
 * temporal lobe (its lateral face is at 0.0655). The pinna (the visible flap) is not part
 * of this organ, only the canal and what lies inside.
 *
 * A stub: a canal, a sphere for the middle ear and a smaller one for the cochlea and
 * vestibule. The three named parts of the atlas replace it. Radii are drawing choices.
 */
export function ears(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    const field = smoothUnion(
      0.002,
      capsule([s * 0.074, 0, 0], [s * 0.046, -0.002, 0.002], 0.0035, 0.003), // external canal
      sphere([s * 0.044, -0.002, 0.002], 0.0065), // middle ear
      sphere([s * 0.036, -0.003, -0.002], 0.0075), // inner ear: cochlea and vestibule
    );
    const x0 = Math.min(s * 0.026, s * 0.082);
    const x1 = Math.max(s * 0.026, s * 0.082);
    parts.push(polygonise(field, [x0, -0.014, -0.014], [x1, 0.012, 0.014], { cell: 0.0016 }));
  }
  return mergeParts(parts);
}
