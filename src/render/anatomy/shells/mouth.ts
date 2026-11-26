import * as THREE from 'three';
import { ellipsoid, intersect, polygonise, roundBox, smoothUnion } from '../sdf';
import { ringAt } from './pharynx';

/**
 * MOUTH, SHELL.
 *
 * Frame: the organ's own, origin at organs.json [0, 0.32, 0.042]. That point is DERIVED, not
 * guessed: the cranial group is lifted 0.06 m in the exploded stack, so the origin sits at
 * y = 0.38 in the scene, which is 6.6 cm below the eyes (eyes.position y 0.386 + 0.06) and
 * just above the thyroid cartilage of the larynx (trachea shell, centre y 0.364, top about
 * 0.378). In z it is in front of the oropharynx (the pharynx shell runs at z = -0.012) and
 * behind the lips, so the cavity occupies z 0.015 to 0.069.
 *
 * WHAT THIS IS. One ellipsoid for the oral cavity and a flatter one for the lips, in the
 * right place and about the right size (a cavity roughly 5 cm wide, 2.5 cm high and 5.5 cm
 * deep) with two lips on its front. The interior (atlas/mouth.parts.ts) now draws the lips,
 * palate, tongue, teeth and the rest inside it; this silhouette is deliberately unchanged in
 * size so the glass head, which is fitted to it, still reads as a head.
 * The radii are drawing choices against that anatomy, not measurements.
 *
 * COST. Cell 4.2 mm keeps it to about a thousand triangles; the budget is for the finished
 * organ to be decided by the agent who draws it.
 */
/** The mouth's origin in scene metres (organs.json [0, 0.32, 0.042] plus the cranial group's 0.06 lift). */
const ORIGIN = [0, 0.38, 0.042] as const;
/** The pharynx's elliptical section at the doorway's height, as a field in the mouth's own frame (slightly oversize, so the two shells overlap rather than part). */
function throat(): (x: number, y: number, z: number) => number {
  const r = ringAt(0.385); // body y 0.385 = scene 0.385: the warp has not started
  const rx = r.rx + 0.0006;
  const dz = r.dz + 0.0006;
  const cx = r.cx - ORIGIN[0];
  const cz = r.cz - ORIGIN[2];
  const k = Math.min(rx, dz);
  return (x, _y, z) => (Math.hypot((x - cx) / rx, (z - cz) / dz) - 1) * k;
}

export function mouth(): THREE.BufferGeometry {
  const field = smoothUnion(
    0.004,
    ellipsoid([0, 0, 0], [0.027, 0.012, 0.027]), // the oral cavity
    // THE ISTHMUS OF THE FAUCES: the cavity's back is an ellipsoid that closes to a point, so on its
    // own it only touched the throat at one point, 2 cm in front of the pharynx. This passage
    // carries the cavity back as a wide doorway whose back is CUT BY THE PHARYNX'S OWN FRONT
    // WALL (the same elliptical section, from shells/pharynx.ts, at the height of the doorway),
    // so the two surfaces coincide and the mouth opens into the oropharynx with no gap and no
    // front wall between them. The doorway itself is a rounded box.
    intersect(roundBox([0, 0.003, -0.027], [0.0085, 0.0085, 0.0075], 0.003), throat()),
    ellipsoid([0, 0.0035, 0.025], [0.0165, 0.0045, 0.007]), // the upper lip
    ellipsoid([0, -0.0055, 0.0245], [0.0155, 0.0055, 0.0072]), // the lower lip, a little fuller
  );
  return polygonise(field, [-0.03, -0.014, -0.034], [0.03, 0.014, 0.036], { cell: 0.0021 });
}
