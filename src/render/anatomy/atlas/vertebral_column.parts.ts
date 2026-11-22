import type * as THREE from 'three';
import type { PartBuilder } from '../parts';
import { warpGeometry } from '../layout';
import { SPINAL_CORD_PATH } from '../models';
import { mergeParts, tubeAlong, type V3 } from '../sdf';
import { blob } from './stub_shared';

/**
 * STUB INTERIOR OF THE VERTEBRAL COLUMN, in body coordinates and bent by `warpGeometry` like
 * the shell and the cord it encloses (shells/vertebral_column.ts). The five regions are
 * stretches of the shell's own path cut at body heights; the heights are drawing choices
 * chosen so the regions run in the right order and with the right rough proportions
 * (seven cervical, twelve thoracic, five lumbar), not measurements. The discs are flat
 * discs at five lumbar levels. Sizes are drawing choices; the content agent replaces this
 * file with the 24 vertebrae, the sacrum, the coccyx and a disc between each pair.
 */
function path(): V3[] {
  return [...SPINAL_CORD_PATH.map((p): V3 => [p[0], p[1], p[2] + 0.012]), [0, -0.15, -0.066], [0, -0.2, -0.05]];
}

/** The point of the path at a body height (linear between its points; the path falls with y). */
function at(pts: readonly V3[], y: number): V3 {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (y <= a[1] && y >= b[1]) {
      const t = a[1] === b[1] ? 0 : (a[1] - y) / (a[1] - b[1]);
      return [a[0] + (b[0] - a[0]) * t, y, a[2] + (b[2] - a[2]) * t];
    }
  }
  return pts[pts.length - 1];
}

/** A stretch of the path between two body heights, as a tube of constant radius. */
function stretch(pts: readonly V3[], yTop: number, yBottom: number, radius: number): THREE.BufferGeometry {
  const run: V3[] = [];
  for (let i = 0; i <= 6; i++) run.push(at(pts, yTop + ((yBottom - yTop) * i) / 6));
  return warpGeometry(tubeAlong(run, () => radius, { tubular: 14, radial: 8 }));
}

export const parts: PartBuilder = () => {
  const pts = path();
  const discs = [-0.06, -0.03, 0, 0.03, 0.06].map((y) => {
    const c = at(pts, y);
    return warpGeometry(blob(c, [0.013, 0.0025, 0.013], 12, 6));
  });
  return [
    { id: 'cervical_vertebrae', geometry: stretch(pts, 0.39, 0.33, 0.009) },
    { id: 'thoracic_vertebrae', geometry: stretch(pts, 0.33, 0.07, 0.012) },
    { id: 'lumbar_vertebrae', geometry: stretch(pts, 0.07, -0.07, 0.015) },
    { id: 'sacrum', geometry: stretch(pts, -0.07, -0.15, 0.014) },
    { id: 'coccyx', geometry: stretch(pts, -0.15, -0.2, 0.005) },
    { id: 'intervertebral_discs', geometry: mergeParts(discs) },
  ];
};
