import * as THREE from 'three';
import { ellipsoid, polygonise, smoothUnion } from '../sdf';

/**
 * MOUTH, STUB SHELL.
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
 * deep). It is the placeholder the content agent replaces with lips, palate, tongue and
 * teeth; the interior atlas (src/data/anatomy/mouth.json) already names those four parts.
 * The radii are drawing choices against that anatomy, not measurements.
 *
 * COST. Cell 3.5 mm keeps it to a few hundred triangles; the budget is for the finished
 * organ to be decided by the agent who draws it.
 */
export function mouth(): THREE.BufferGeometry {
  const field = smoothUnion(
    0.004,
    ellipsoid([0, 0, 0], [0.027, 0.012, 0.027]), // the oral cavity
    ellipsoid([0, -0.001, 0.025], [0.019, 0.008, 0.007]), // the lips, a flatter cap on the front
  );
  return polygonise(field, [-0.03, -0.014, -0.03], [0.03, 0.014, 0.036], { cell: 0.0035 });
}
