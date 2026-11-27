import * as THREE from 'three';
import { organPosition } from '../anatomy/layout';
import type { OrganDef } from '../../data/types';
import { EXTERNAL_FLAG, HEAD_MARGIN_M, SAMPLE_STRIDE, SKIN_MARGIN_M } from './outlineModel';

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

/** Organs outside the pelvic floor: the outline gives them their own blob and ends the trunk above them. */
const EXTERNAL_ORGANS = new Set<string>(['testes', 'penis', 'vagina']);

/**
 * SKELETAL LANDMARKS THE GLASS MUST CONTAIN, carried by the organ they sit beside.
 *
 * WHY THIS EXISTS. The bones are LAYER organs and are left out of the fit on purpose: they are
 * built lazily, only while the Bones layer is on, and a figure fitted to lazily built meshes
 * would change shape when a visitor switched a layer. The skull's occipital base nevertheless
 * reaches behind everything that is fitted: 95 skull vertices (20 after the neck was moved) (the nuchal ridge and the external occipital
 * protuberance, y 0.40 to 0.42, z to -0.092) stood up to 14 mm outside the glass head, which
 * is fitted to the brain, whose back is at about z -0.086. One cheap sample is added instead
 * of fitting to the bone: the centre of that outlier set, measured from the skull shell's
 * vertices that the figure did not contain (centroid x -0.0007, y 0.4086, z -0.0871), with a
 * radius that carries the slice's back edge to the bone's furthest vertex (z -0.0916) and a
 * little beyond. `r` is a DISPLAY choice, not an anatomical size. It rides with the brain
 * because the brain is in every body and the skull encloses it.
 */
const SKELETAL_LANDMARKS: Readonly<Record<string, readonly (readonly [number, number, number, number])[]>> = {
  brain: [[0, 0.4086, -0.0871, 0.009]],
};

/**
 * THE SKIN COVERS THE MUSCLES, WHETHER OR NOT THE MUSCLES ARE SHOWN.
 *
 * Every muscle vertex must lie at least this far inside the glass, metres. A DISPLAY choice: the
 * thickness of the skin drawn over the outermost muscle, a millimetre so the muscle never grazes
 * the surface. `tests/render/body-outline.test.ts` pins it for all seven muscle organs in the male,
 * the non-pregnant female and the 28-week bodies.
 */
export const MUSCLE_SKIN_M = 0.001;

/**
 * What went wrong first: the glass was fitted to the viscera (about 4 mm over the ribs) and the
 * seven muscle layer organs, which are excluded from the fit like every layer organ, stood outside
 * it by up to 13.3 mm (the iliotibial tract), 7.5 mm (trapezius and the erector columns), 5.5 mm
 * (the rectus sheath) and 4.8 mm (pectoralis major). A real body wall is muscle and then skin, so
 * the skin has to be drawn round the muscles even when only the skin is on screen. The muscles
 * are built lazily (CLAUDE.md), so the figure cannot be fitted to their meshes; a handful of
 * landmark samples carry the outermost muscle surface into the fit instead.
 *
 * HOW THE TABLE WAS DERIVED. Each row is the outermost vertex of a muscle shell that the glass did
 * not contain, found by building the seven shells and taking, per 24 mm band of height and per
 * side (front or back of the trunk, outer side of the hip), the vertex furthest outside the figure:
 * [x, y, z, axis, direction]. Rows are mirrored across the midline in code. The fit adds the skin
 * margin to every sample, so each row is moved INWARD along its axis by that margin less
 * MUSCLE_SKIN_M; the surface of the figure then lands MUSCLE_SKIN_M outside the muscle. Rows
 * exist only where a muscle was outside, so nothing else bulges: the arms and legs still fade
 * at the elbow and knee, and the thighs follow the hip's width through the fit's own rule (a
 * thigh's outer edge is the hip's), which is why the hip rows sit at the pelvic floor and not
 * down the thigh. The test proves the result against the real meshes; if a muscle builder is
 * thickened, rerun the probe and extend the table.
 */
type WallRow = readonly [number, number, number, 'x' | 'z', 1 | -1, 'trunk' | 'head'];
const BODY_WALL_MUSCLE_ROWS: readonly WallRow[] = [
  // Pectoralis major and the chest wall, front.
  [0.067, 0.096, 0.099, 'z', 1, 'trunk'],
  [0.047, 0.120, 0.099, 'z', 1, 'trunk'],
  [0.038, 0.144, 0.101, 'z', 1, 'trunk'],
  [0.067, 0.168, 0.102, 'z', 1, 'trunk'],
  [0.067, 0.192, 0.101, 'z', 1, 'trunk'],
  [0.067, 0.216, 0.097, 'z', 1, 'trunk'],
  // Rectus sheath and the abdominal wall, front.
  [0.071, 0.072, 0.098, 'z', 1, 'trunk'],
  [0.071, 0.096, 0.100, 'z', 1, 'trunk'],
  [0.004, -0.096, 0.076, 'z', 1, 'trunk'],
  [0.004, -0.120, 0.076, 'z', 1, 'trunk'],
  // Trapezius, latissimus and the erector columns, back.
  [0.016, -0.069, -0.116, 'z', -1, 'trunk'],
  [0.043, 0.072, -0.119, 'z', -1, 'trunk'],
  [0.014, 0.144, -0.128, 'z', -1, 'trunk'],
  [0.044, 0.168, -0.127, 'z', -1, 'trunk'],
  [0.016, 0.192, -0.127, 'z', -1, 'trunk'],
  [0.048, 0.216, -0.122, 'z', -1, 'trunk'],
  // The gluteal back of the pelvis. Added when the large intestine was moved off the iliac bones: the old
  // descending colon and sigmoid had been holding the male glass out here, and once they moved the back
  // muscles stood 0.24 mm inside it against the 1 mm the containment test needs.
  [0.083, -0.15, -0.082, 'z', -1, 'trunk'],
  // The point of the shoulder (the outermost vertex of the shoulder and arm muscles, deltoid). Added by gx1 when
  // the lungs were cut to the heart's own shape (paths.ts `heartCavity`): the lung samples that had been holding
  // the glass out here moved, and this muscle went from 1.62 mm inside the glass to 0.93 mm, short of the
  // 1 mm the containment test needs. The glass is a smooth fit, so removing lung material in the middle of
  // the chest moved the shoulder; the landmark makes the shoulder independent of the lungs.
  [0.176, 0.269, -0.015, 'x', 1, 'trunk'],
  // The iliotibial tract and the gluteal region at the hip: the widest vertex of the thigh shell.
  [0.127, -0.216, 0.0, 'x', 1, 'trunk'],
  [0.125, -0.240, -0.005, 'x', 1, 'trunk'],
  [0.125, -0.262, -0.005, 'x', 1, 'trunk'],
  // The neck muscles, a fraction of a millimetre proud of the thinner head margin.
  [0.084, 0.480, -0.031, 'x', 1, 'head'],
  [0.084, 0.504, -0.024, 'x', 1, 'head'],
];

/** The rows as samples (x, y, z, 0), mirrored across the midline, moved inward by the margin less the skin. */
function bodyWallSamples(): number[][] {
  const out: number[][] = [];
  for (const [x, y, z, axis, dir, kind] of BODY_WALL_MUSCLE_ROWS) {
    const inset = (kind === 'head' ? HEAD_MARGIN_M : SKIN_MARGIN_M) - MUSCLE_SKIN_M;
    for (const side of [1, -1]) {
      if (axis === 'x') out.push([side * (x - inset * dir), y, z, 0]);
      else out.push([side * x, y, z - inset * dir, 0]);
    }
  }
  return out;
}

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

  const landmarks: (readonly number[])[] = [...(SKELETAL_LANDMARKS[def.id] ?? [])];
  // The body wall rides with the diaphragm: it is in every body and is itself a muscle sheet of the trunk.
  if (def.id === 'diaphragm') landmarks.push(...bodyWallSamples());
  const out = new Float32Array((picked.length + landmarks.length) * SAMPLE_STRIDE);
  for (let n = 0; n < picked.length; n++) {
    v.fromBufferAttribute(pos, picked[n]);
    if (rot) v.applyMatrix4(m);
    out[n * SAMPLE_STRIDE] = v.x + origin.x;
    out[n * SAMPLE_STRIDE + 1] = v.y + origin.y;
    out[n * SAMPLE_STRIDE + 2] = v.z + origin.z;
    out[n * SAMPLE_STRIDE + 3] = EXTERNAL_ORGANS.has(def.id) ? EXTERNAL_FLAG : 0;
  }
  // The landmarks are in the body frame already (not the organ's own), so they bypass the transform.
  for (let k = 0; k < landmarks.length; k++) {
    const o = (picked.length + k) * SAMPLE_STRIDE;
    out[o] = landmarks[k][0];
    out[o + 1] = landmarks[k][1];
    out[o + 2] = landmarks[k][2];
    out[o + 3] = landmarks[k][3];
  }
  return out;
}
