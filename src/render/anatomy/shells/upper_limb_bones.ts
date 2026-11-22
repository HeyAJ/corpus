import * as THREE from 'three';
import { mergeParts, tubeAlong, type V3 } from '../sdf';

/**
 * SHOULDER AND ARM BONES, STUB SHELL. A LAYER organ in the thoracic group.
 *
 * Frame: origin at organs.json [0, 0.2, 0] (the thoracic group has no offset, so this is body
 * coordinates minus that point). Every position is read off src/data/vasculature.json, the
 * only authored geometry the arm has:
 *
 *   - the HUMERUS follows the brachial artery, from where the subclavian ends at the shoulder
 *     (right (0.098, 0.248, 0.004)) down to where the arm's glass outline fades (right
 *     (0.156, 0.118, 0.01)), 0.012 outside the artery so the bone lies beside the vessel;
 *   - the CLAVICLE runs from the top of the sternum (0, 0.27, 0.05) out along the subclavian
 *     artery (0.098, 0.266) to the shoulder, in front of it;
 *   - the SCAPULA is a flat plate behind the shoulder, over the upper ribs, its centre about
 *     0.065 behind the clavicle's.
 *
 * Right and left are mirrored in x (body +x is the patient's right). A stub of rods and flat
 * ellipsoids; the content agent adds the humeral head, the glenoid, the acromion, the
 * coracoid and the elbow end. Radii are drawing choices.
 */
function blob(c: V3, r: V3): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 12, 8);
  g.scale(r[0], r[1], r[2]);
  g.translate(c[0], c[1], c[2]);
  return g;
}

const rod = (points: V3[], r: number): THREE.BufferGeometry => tubeAlong(points, () => r, { tubular: 12, radial: 6 });

export function upperLimbBones(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    const at = (x: number, y: number, z: number): V3 => [s * x, y - 0.2, z];
    parts.push(rod([at(0.1, 0.248, 0.004), at(0.138, 0.208, 0.008), at(0.162, 0.158, 0.01), at(0.168, 0.118, 0.01)], 0.007)); // humerus
    parts.push(rod([at(0.006, 0.27, 0.05), at(0.05, 0.276, 0.046), at(0.098, 0.268, 0.02)], 0.0045)); // clavicle
    parts.push(blob(at(0.082, 0.236, -0.05), [0.03, 0.04, 0.003])); // scapula
  }
  return mergeParts(parts);
}
