import * as THREE from 'three';
import { organPosition } from '../anatomy/layout';
import type { OrganDef } from '../../data/types';
import { SAMPLE_STRIDE } from './outlineModel';

/**
 * THE POINTS A GLASS FIGURE IS FITTED TO: a thinned copy of an organ's vertices, moved
 * from the organ's own frame to the body frame.
 *
 * Why thinned: the whole body is about a hundred thousand vertices, and the outline
 * fits an ellipse per 12 mm slice, so ten thousand points say as much as a hundred
 * thousand. Why the extremes are always kept: a stride would skip the single vertex
 * that sets a slice's width, and the figure would then clip the organ it is meant to
 * contain. The six extreme vertices (lowest and highest in x, y and z) are therefore
 * added to the strided set, so the bounds are exact and only the interior of the
 * surface is thinned.
 *
 * The rotation is the organ's authored one (spleen, kidneys), applied in the order
 * three.js applies `Object3D.rotation` (intrinsic XYZ), which is how OrganSet poses the
 * mesh. The heart's and lungs' live scale is not applied: a breath moves the lung wall
 * by millimetres, well inside the skin margin.
 */

/** Strided vertices kept per organ, before the six extremes. A DISPLAY/cost choice. */
export const SAMPLES_PER_ORGAN = 500;

export function organSamples(def: OrganDef, geometry: THREE.BufferGeometry): Float32Array {
  const pos = geometry.getAttribute('position');
  if (!pos || pos.count === 0) return new Float32Array(0);
  const count = pos.count;
  const stride = Math.max(1, Math.floor(count / SAMPLES_PER_ORGAN));

  const picked: number[] = [];
  for (let i = 0; i < count; i += stride) picked.push(i);
  // The extremes: one vertex per direction along each axis.
  const ext = [0, 0, 0, 0, 0, 0];
  const best = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (x < best[0]) { best[0] = x; ext[0] = i; }
    if (x > best[1]) { best[1] = x; ext[1] = i; }
    if (y < best[2]) { best[2] = y; ext[2] = i; }
    if (y > best[3]) { best[3] = y; ext[3] = i; }
    if (z < best[4]) { best[4] = z; ext[4] = i; }
    if (z > best[5]) { best[5] = z; ext[5] = i; }
  }
  for (const e of ext) picked.push(e);

  const origin = organPosition(def);
  const rot = def.rotation;
  const m = new THREE.Matrix4();
  if (rot) m.makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'XYZ'));
  const v = new THREE.Vector3();

  const out = new Float32Array(picked.length * SAMPLE_STRIDE);
  for (let n = 0; n < picked.length; n++) {
    v.fromBufferAttribute(pos, picked[n]);
    if (rot) v.applyMatrix4(m);
    out[n * SAMPLE_STRIDE] = v.x + origin.x;
    out[n * SAMPLE_STRIDE + 1] = v.y + origin.y;
    out[n * SAMPLE_STRIDE + 2] = v.z + origin.z;
    out[n * SAMPLE_STRIDE + 3] = 0;
  }
  return out;
}
