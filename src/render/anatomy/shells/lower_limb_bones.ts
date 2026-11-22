import * as THREE from 'three';
import { mergeParts, tubeAlong, type V3 } from '../sdf';

/**
 * HIP AND THIGH BONES, STUB SHELL. A LAYER organ in the pelvic group.
 *
 * Frame: origin at organs.json [0, -0.2, 0]. Positions come from src/data/vasculature.json,
 * which is the only authored geometry the leg has:
 *
 *   - the FEMUR runs beside the femoral artery, from the hip joint (just outside the iliac
 *     artery's end, right (0.044, -0.125, -0.01), so about (0.08, -0.135, -0.008)) down to the
 *     knee, where the popliteal artery starts at y -0.262 and the glass leg fades at -0.336;
 *     it lies lateral and behind the artery (the artery runs in front of the thigh bone);
 *   - the HIP BONE is a broad flat wing above and behind the joint, from the iliac crest
 *     (about y -0.05) to the acetabulum, with the pubic region toward the midline.
 *
 * Right and left are mirrored in x. A stub: two rods and two flattened ellipsoids; the
 * content agent adds the ilium, ischium and pubis, the sacroiliac joint, the femoral head,
 * neck, trochanters and the condyles. Radii are drawing choices.
 */
function blob(c: V3, r: V3): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 14, 10);
  g.scale(r[0], r[1], r[2]);
  g.translate(c[0], c[1], c[2]);
  return g;
}

export function lowerLimbBones(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    const at = (x: number, y: number, z: number): V3 => [s * x, y + 0.2, z];
    parts.push(
      tubeAlong([at(0.082, -0.135, -0.008), at(0.07, -0.2, -0.012), at(0.06, -0.3, -0.014), at(0.058, -0.336, -0.012)], () => 0.011, {
        tubular: 16,
        radial: 7,
      }),
    ); // femur
    parts.push(blob(at(0.07, -0.085, -0.03), [0.04, 0.04, 0.014])); // the iliac wing
    parts.push(blob(at(0.035, -0.14, 0.03), [0.024, 0.018, 0.01])); // the pubic region
  }
  return mergeParts(parts);
}
