import * as THREE from 'three';
import { mergeParts, tubeAlong, type V3 } from '../sdf';

/**
 * SKULL, STUB SHELL. A LAYER organ (organs.json `layer: "bones"`): built only while the bones
 * layer is on or the skull is selected, never at load.
 *
 * Frame: the BRAIN's own frame (origin at organs.json [0, 0.42, 0], cranial group), so every
 * number below is read straight off the brain shell, whose bounding box is x +-0.066,
 * y -0.093..0.055, z -0.083..0.079 (brain() in models.ts). The vault is the smallest ellipsoid
 * that clears that box with a bone's thickness to spare (centre (0, 0.004, -0.004), radii
 * 0.075 / 0.066 / 0.088); the face block is centred between and below the orbits, using the
 * eyes shell (globes at local (+-0.031, -0.034, 0.06)) and the nasal cavity shell; the
 * mandible is a U that wraps the mouth shell, whose floor is 0.112 below this origin; the
 * hyoid is a small ring at the back of the mouth's floor, above the larynx.
 *
 * A stub of simple primitives (a few hundred triangles). The content agent replaces it with
 * the cranial bones, the orbits and the teeth sockets. Sizes are drawing choices.
 */

/** A scaled sphere: the cheapest closed primitive that has an index and normals. */
function blob(c: V3, r: V3, w: number, h: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(r[0], r[1], r[2]);
  g.translate(c[0], c[1], c[2]);
  return g;
}

export function skull(): THREE.BufferGeometry {
  const mandible: V3[] = [
    [-0.05, -0.075, -0.012],
    [-0.04, -0.105, 0.028],
    [0, -0.116, 0.058],
    [0.04, -0.105, 0.028],
    [0.05, -0.075, -0.012],
  ];
  const hyoid: V3[] = [
    [-0.014, -0.098, 0.004],
    [0, -0.098, 0.016],
    [0.014, -0.098, 0.004],
  ];
  return mergeParts([
    blob([0, 0.004, -0.004], [0.075, 0.066, 0.088], 22, 14), // the cranial vault
    blob([0, -0.05, 0.05], [0.04, 0.03, 0.032], 14, 10), // the face: orbits, nose and upper jaw
    tubeAlong(mandible, () => 0.006, { tubular: 20, radial: 6 }),
    tubeAlong(hyoid, () => 0.0025, { tubular: 8, radial: 5 }),
  ]);
}
