import * as THREE from 'three';
import { tubeAlong, type V3 } from '../sdf';
import { warpGeometry } from '../layout';

/**
 * PHARYNX, SHELL. An AXIAL organ.
 *
 * Authored in unexploded body coordinates and bent by `warpGeometry`, exactly like the
 * oesophagus it continues into, so the join stays seamless after the exploded stack has
 * moved the head 6 cm away from the neck. The warp matters most here: between body y 0.385
 * and 0.405 it stretches 2 cm of the neck into 8 cm of scene (layout.ts, axialWarp.cranial),
 * and the pharynx is the structure that lives in that stretch.
 *
 * PATH. It starts exactly where the oesophagus shell starts, [0.002, 0.37, -0.014] (its
 * first point), at a radius a little under the oesophagus's own, and rises behind the nasal
 * cavity and the mouth to the base of the skull. In the scene that is about y 0.37 at the
 * cricoid, 0.425 at the level of the soft palate and 0.45 at the nasopharynx. It lies
 * ahead of the spinal cord (z -0.026 at the top) and behind the larynx (z +0.004), so
 * z drifts from -0.014 to -0.008.
 *
 * It is a plain tube: the silhouette only. The openings into the nose, mouth and larynx,
 * the three levels, the muscles and the tonsils are drawn by the interior
 * (atlas/pharynx.parts.ts), which re-derives this centreline and radius profile so the two
 * cannot drift apart. The shell is deliberately unchanged so the glass head still fits.
 */
const PATH: V3[] = [
  [0.002, 0.37, -0.014],
  [0.002, 0.381, -0.012],
  [0.001, 0.392, -0.01],
  [0, 0.4, -0.008],
];

export function pharynx(): THREE.BufferGeometry {
  const g = tubeAlong(PATH, (t) => 0.0075 + 0.0045 * Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5), { tubular: 24, radial: 10 });
  return warpGeometry(g);
}
