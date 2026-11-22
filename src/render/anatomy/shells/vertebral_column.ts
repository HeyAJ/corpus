import * as THREE from 'three';
import { tubeAlong, type V3 } from '../sdf';
import { SPINAL_CORD_PATH } from '../paths';
import { warpGeometry } from '../layout';

/**
 * VERTEBRAL COLUMN, STUB SHELL. A LAYER organ and an AXIAL one.
 *
 * It is authored in unexploded body coordinates and bent by `warpGeometry`, exactly as the
 * spinal cord is, because it ENCLOSES the cord: the same warp on both keeps the cord inside
 * the canal after the exploded stack has moved the head and the pelvis. The path is the
 * cord's own centreline (SPINAL_CORD_PATH, foramen magnum to the sacrum) with its z moved
 * forward by the canal's own half-width, so the tube runs down the vertebral bodies in front
 * of the cord, followed below the cord's end (-0.1) by two points for the sacrum and the
 * coccyx. Radius: a cervical vertebra is slimmer than a lumbar one, and the sacrum tapers.
 *
 * A single tapering tube in this stub; the content agent replaces it with C1 to C7, T1 to
 * T12, L1 to L5, the sacrum and the coccyx, and the discs between them. Sizes are drawing
 * choices.
 */
export function vertebralColumn(): THREE.BufferGeometry {
  // Read inside the function, not at module level: models.ts imports this file to register
  // it, and this file imports models.ts for the cord's path, so at load time the constant
  // does not exist yet (a temporal-dead-zone error) but at call time it always does.
  const PATH: V3[] = [
    ...SPINAL_CORD_PATH.map((p): V3 => [p[0], p[1], p[2] + 0.012]),
    [0, -0.15, -0.066],
    [0, -0.2, -0.05],
  ];
  const g = tubeAlong(
    PATH,
    (_t, p) => {
      if (p.y > 0.3) return 0.012; // cervical
      if (p.y > 0.0) return 0.016; // thoracic and upper lumbar
      if (p.y > -0.1) return 0.02; // lower lumbar
      return 0.02 * Math.max(0.15, 1 - (-0.1 - p.y) / 0.11); // the sacrum tapering to the coccyx
    },
    { tubular: 60, radial: 8 },
  );
  return warpGeometry(g);
}
