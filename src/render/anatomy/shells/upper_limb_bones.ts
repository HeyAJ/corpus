import * as THREE from 'three';
import {
  capsule, chain, ellipsoid, mergeParts, polygonise, sphere, subtract, tubeAlong, union,
  type Sdf, type V3,
} from '../sdf';
import { cageBackDepth, cageHalfWidth } from './thoracic_cage';

/**
 * SHOULDER AND ARM BONES: THE SHELL, AND THE GEOMETRY THE INTERIOR PARTS SHARE. A LAYER organ in
 * the thoracic group (drawn with the Bones layer on, or while selected).
 *
 * FRAME. Origin at organs.json [0, 0.2, 0]. Everything is AUTHORED IN BODY COORDINATES for the
 * patient's RIGHT side (+x) and moved into the organ's frame by `local()`; the left side is the
 * same shape mirrored in x (`sideField`, `sideBounds`). The thoracic group has no exploded-stack
 * offset.
 *
 * WHERE THE BONES GO, AND WHAT WENT WRONG THE FIRST TIME. The stub put the humerus "beside the
 * brachial artery" as the brief said. In THIS body the vessels data are schematic and the artery
 * runs inside the lung's own x range (x 0.126 at the lung's widest height, 0.131), so a bone
 * beside it stood inside the rib cage. The humerus is instead drawn along the glass ARM's own
 * axis, which the body outline (render/body/outlineModel.ts) puts about 0.04 outside the
 * brachial artery (the artery runs on the arm's inner side), so the bone is where the arm is and
 * clear of the ribs; the humerus ends where the glass arm has almost faded (armEndY 0.118, fade
 * length 0.05), at about 0.129, the lowest point of the condyles. The same applies to the scapula:
 * the body is too shallow front to back for the textbook gap behind the ribs, so the scapula is a
 * plate that HUGS the rib cage's own cross-section (`cageHalfWidth`, `cageBackDepth` of
 * shells/thoracic_cage.ts), standing off the ribs by `SCAPULA_STANDOFF`.
 *
 * WHAT IS DRAWN. Clavicle (S-curved tube with a flared sternal end and a flattened acromial end);
 * scapula (a curved plate with a medial and a lateral border, a spine, an acromion, a coracoid
 * process and a glenoid cavity at the end of a neck); humerus (head, anatomical and surgical
 * necks, greater and lesser tubercles with the intertubercular sulcus between them, shaft with
 * the deltoid tuberosity, and the condyles and epicondyles at the elbow end). Proportions follow
 * Gray's relationships (the scapula spans about the second to the seventh rib, the spine of the
 * scapula runs out into the acromion); sizes are fitted to this body and are drawing choices.
 * This is a schematic skeleton, not a traced atlas.
 */

export const ORIGIN_Y = 0.2;
export const local = (p: V3): V3 => [p[0], p[1] - ORIGIN_Y, p[2]];

/** A field and its bounds for the right side, made for either side by reflecting x. */
export const sideField = (f: Sdf, side: number): Sdf => (side > 0 ? f : (x, y, z) => f(-x, y, z));
export const sideBounds = (min: V3, max: V3, side: number): [V3, V3] =>
  side > 0 ? [min, max] : [[-max[0], min[1], min[2]], [-min[0], max[1], max[2]]];
export const mirrorPts = (pts: readonly V3[], side: number): V3[] => pts.map((p): V3 => [side * p[0], p[1], p[2]]);

/** Extract a body-coordinate right-side field, for one side, into the organ's frame. */
export function extractSide(field: Sdf, min: V3, max: V3, cell: number, side: number): THREE.BufferGeometry {
  const [lo, hi] = sideBounds(min, max, side);
  const f = sideField(field, side);
  return polygonise((x, y, z) => f(x, y + ORIGIN_Y, z), local(lo), local(hi), { cell, pad: 2 });
}

/** Both sides, merged. */
export function extractBoth(field: Sdf, min: V3, max: V3, cell: number): THREE.BufferGeometry {
  return mergeParts([extractSide(field, min, max, cell, 1), extractSide(field, min, max, cell, -1)]);
}

/** An orthonormal frame with its third axis along `n` (and its second as near to world up as it can be). */
export interface Frame3 {
  o: V3;
  u: V3;
  v: V3;
  w: V3;
}
export function frameFromNormal(o: V3, n: V3): Frame3 {
  const w = new THREE.Vector3(...n).normalize();
  let up = new THREE.Vector3(0, 1, 0);
  if (Math.abs(w.dot(up)) > 0.95) up = new THREE.Vector3(0, 0, 1);
  const u = new THREE.Vector3().crossVectors(up, w).normalize();
  const v = new THREE.Vector3().crossVectors(w, u).normalize();
  return { o, u: [u.x, u.y, u.z], v: [v.x, v.y, v.z], w: [w.x, w.y, w.z] };
}
export function inFrame3(base: Sdf, f: Frame3): Sdf {
  const [ox, oy, oz] = f.o;
  return (x, y, z) => {
    const dx = x - ox;
    const dy = y - oy;
    const dz = z - oz;
    return base(
      dx * f.u[0] + dy * f.u[1] + dz * f.u[2],
      dx * f.v[0] + dy * f.v[1] + dz * f.v[2],
      dx * f.w[0] + dy * f.w[1] + dz * f.w[2],
    );
  };
}

/** Signed distance to a closed polygon in two dimensions (negative inside). */
export function polySd(pts: readonly (readonly [number, number])[]): (x: number, y: number) => number {
  const n = pts.length;
  return (px, py) => {
    let d = Infinity;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [ax, ay] = pts[j];
      const [bx, by] = pts[i];
      const ex = bx - ax;
      const ey = by - ay;
      const wx = px - ax;
      const wy = py - ay;
      const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
      const dx = wx - ex * t;
      const dy = wy - ey * t;
      d = Math.min(d, dx * dx + dy * dy);
      if (ay > py !== by > py && px < (ex * (py - ay)) / (by - ay) + ax) inside = !inside;
    }
    return (inside ? -1 : 1) * Math.sqrt(d);
  };
}

/* ------------------------------------------------------------------- the clavicle */

/** Centreline of the right clavicle: an S, convex forward over the medial two thirds and concave forward at the outer third. */
export const CLAVICLE_PTS: V3[] = [
  [0.019, 0.2815, 0.0475],
  [0.045, 0.2885, 0.056],
  [0.075, 0.2895, 0.0505],
  [0.105, 0.2885, 0.035],
  [0.13, 0.2845, 0.017],
  [0.1495, 0.2805, -0.006],
];
export const clavicleCurve = (side = 1): THREE.CatmullRomCurve3 =>
  new THREE.CatmullRomCurve3(mirrorPts(CLAVICLE_PTS, side).map((p) => new THREE.Vector3(...local(p))), false, 'catmullrom', 0.5);

/** Radius along the clavicle: a flared sternal end, a slim shaft, a slightly flattened outer end. A drawing choice. */
const clavicleRadius = (t: number): number => (t < 0.12 ? 0.0062 - 0.02 * t : t < 0.85 ? 0.0042 : 0.0042 + 0.012 * (t - 0.85));

export function clavicleGeometry(side: number, tubular = 24, radial = 6, t0 = 0, t1 = 1): THREE.BufferGeometry {
  const c = clavicleCurve(side);
  const pts: V3[] = [];
  const n = 10;
  for (let k = 0; k <= n; k++) {
    const p = c.getPointAt(t0 + ((t1 - t0) * k) / n);
    pts.push([p.x, p.y, p.z]);
  }
  return tubeAlong(pts, (t) => clavicleRadius(t0 + (t1 - t0) * t), { tubular, radial });
}

/* -------------------------------------------------------------------- the scapula */

/** How far the scapula's mid-plane stands off the ribs' centreline, metres. A drawing choice: room for the ribs' own radius and a layer of muscle in a body that is shallow front to back. */
export const SCAPULA_STANDOFF = 0.0135;
/** Thickness of the scapular plate, metres. A drawing choice. */
export const SCAPULA_THICK = 0.0054;

/** z of the back of the cage at (x, y), standing off by the scapular distance: the surface the plate lies on. */
export function scapulaZ(x: number, y: number): number {
  const a = cageHalfWidth(y) + SCAPULA_STANDOFF;
  const b = cageBackDepth(y) + SCAPULA_STANDOFF;
  const r = Math.min(1, Math.abs(x) / a);
  return -b * Math.sqrt(1 - r * r);
}

/** Outline of the right scapula in (x, y): superior angle, superior border, the neck, lateral border, inferior angle, medial border. */
export const SCAPULA_OUTLINE: [number, number][] = [
  [0.052, 0.263], [0.08, 0.2655], [0.112, 0.264], [0.13, 0.2635], [0.137, 0.254], [0.138, 0.24], [0.128, 0.222],
  [0.112, 0.198], [0.094, 0.175], [0.076, 0.16], [0.062, 0.158], [0.054, 0.168], [0.05, 0.2], [0.049, 0.235],
];

/** The line of the spine of the scapula across the back of the plate, at x. */
export const spineY = (x: number): number => 0.2465 + (0.007 * (x - 0.05)) / 0.08;

/** A slab of the plate, shifted off its mid-surface by `shift` (back is negative z), within a region. */
export function plate(region: readonly (readonly [number, number])[], thick: number, shift = 0): Sdf {
  const sd = polySd(region);
  return (x, y, z) => Math.max(Math.abs(z - (scapulaZ(x, y) + shift)) * 0.8 - thick / 2, sd(x, y));
}

/** The head's centre, the glenoid's, and the direction the socket looks, as one fact for every file. */
export const HEAD: V3 = [0.158, 0.25, -0.006];
export const HEAD_R = 0.0118;
const GLEN_DIR = new THREE.Vector3(0.84, 0, 0.54).normalize();
/** Direction from the glenoid to the head (the socket's axis, pointing out of the socket). */
export const SOCKET_DIR: V3 = [GLEN_DIR.x, GLEN_DIR.y, GLEN_DIR.z];
export const GLENOID_CENTRE: V3 = [
  HEAD[0] - 0.0118 * GLEN_DIR.x,
  HEAD[1],
  HEAD[2] - 0.0118 * GLEN_DIR.z,
];
export const SOCKET_R = 0.0128;

export const glenoidFrame = (): Frame3 => frameFromNormal(GLENOID_CENTRE, SOCKET_DIR);
export const socketField = (): Sdf => sphere(HEAD, SOCKET_R);

/** The glenoid cavity: a pear-shaped disc whose face is dished by the humeral head. */
export function glenoidField(): Sdf {
  const disc = inFrame3(ellipsoid([0, 0, 0], [0.0085, 0.0128, 0.0055]), glenoidFrame());
  return subtract(disc, socketField());
}

export function scapulaBody(): Sdf {
  return union(plate(SCAPULA_OUTLINE, SCAPULA_THICK));
}

/** The spine of the scapula: a ridge standing off the back of the plate, running out to the acromion. */
export function spineField(): Sdf {
  const pts: V3[] = [];
  for (let x = 0.054; x <= 0.1321; x += 0.026) pts.push([x, spineY(x), scapulaZ(x, spineY(x)) - 0.0045]);
  return chain(pts, [0.0024, 0.0028, 0.0032, 0.0034]);
}
export function acromionField(): Sdf {
  const a: V3 = [0.132, 0.2535, scapulaZ(0.132, 0.2535) - 0.0045];
  return chain([a, [0.146, 0.2715, -0.02], [0.1515, 0.2765, -0.0105]], [0.0034, 0.0036, 0.0036]);
}
export function coracoidField(): Sdf {
  return chain(
    [[0.134, 0.2585, -0.028], [0.139, 0.2655, -0.012], [0.143, 0.2635, 0.008], [0.1455, 0.2585, 0.022]],
    [0.0042, 0.0038, 0.0034, 0.003],
  );
}
/** The neck between the plate's outer end and the glenoid. */
export function scapularNeck(): Sdf {
  return capsule([0.128, 0.247, scapulaZ(0.128, 0.247)], [GLENOID_CENTRE[0] - 0.002, GLENOID_CENTRE[1], GLENOID_CENTRE[2] - 0.002], 0.0058, 0.0052);
}

export function scapulaField(): Sdf {
  return union(scapulaBody(), spineField(), acromionField(), coracoidField(), scapularNeck(), glenoidField());
}
export const SCAPULA_MIN: V3 = [0.044, 0.152, -0.125];
export const SCAPULA_MAX: V3 = [0.17, 0.28, 0.035];

/* --------------------------------------------------------------------- the humerus */

/** Centreline of the shaft of the right humerus, which follows the glass arm. */
export const SHAFT_PTS: V3[] = [
  [0.1655, 0.2325, -0.003],
  [0.1715, 0.195, 0.003],
  [0.183, 0.159, 0.008],
  [0.1885, 0.141, 0.009],
];
export const HUMERUS_SHAFT_R = [0.0092, 0.0076, 0.0078, 0.0105];

export const greaterTubercleField = (): Sdf => ellipsoid([0.1705, 0.2405, -0.011], [0.0075, 0.0105, 0.0075]);
export const lesserTubercleField = (): Sdf => ellipsoid([0.1625, 0.2385, 0.0085], [0.0048, 0.0082, 0.0048]);
const SULCUS_A: V3 = [0.1685, 0.247, 0.0098];
const SULCUS_B: V3 = [0.1695, 0.213, 0.0088];
export const sulcusCutter = (): Sdf => capsule(SULCUS_A, SULCUS_B, 0.0021);
export const deltoidField = (): Sdf => ellipsoid([0.178, 0.188, 0.002], [0.0042, 0.011, 0.005]);
export const headField = (): Sdf => ellipsoid(HEAD, [HEAD_R, HEAD_R * 0.97, HEAD_R]);
export const humeralNeckField = (): Sdf => capsule(HEAD, [0.1635, 0.2365, -0.0035], 0.0098, 0.0094);
export const humeralShaftField = (): Sdf => chain(SHAFT_PTS, HUMERUS_SHAFT_R);
/** The elbow end: capitulum, trochlea and the two epicondyles. */
export const CONDYLES = {
  capitulum: { c: [0.199, 0.1365, 0.0115] as V3, r: [0.0072, 0.0072, 0.0072] as V3 },
  trochlea: { c: [0.1815, 0.1355, 0.0105] as V3, r: [0.0078, 0.0075, 0.0072] as V3 },
  medialEpicondyle: { c: [0.1745, 0.1425, 0.0035] as V3, r: [0.0042, 0.0042, 0.0042] as V3 },
  lateralEpicondyle: { c: [0.204, 0.1435, 0.0035] as V3, r: [0.0038, 0.0038, 0.0038] as V3 },
};
export const distalField = (): Sdf =>
  union(...Object.values(CONDYLES).map((k) => ellipsoid(k.c, k.r)), capsule([0.1885, 0.15, 0.009], [0.1895, 0.1385, 0.0095], 0.0105, 0.0098));

export function humerusField(): Sdf {
  return union(
    subtract(union(headField(), humeralNeckField(), greaterTubercleField(), lesserTubercleField(), humeralShaftField()), sulcusCutter()),
    deltoidField(),
    distalField(),
  );
}
export const HUMERUS_MIN: V3 = [0.14, 0.126, -0.03];
export const HUMERUS_MAX: V3 = [0.215, 0.27, 0.03];

/** The whole skeleton of the shoulder and arm, for the shell. */
export function upperLimbBones(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [1, -1]) {
    parts.push(clavicleGeometry(side, 20, 5));
    parts.push(extractSide(scapulaField(), SCAPULA_MIN, SCAPULA_MAX, 0.0045, side));
    parts.push(extractSide(humerusField(), HUMERUS_MIN, HUMERUS_MAX, 0.0038, side));
  }
  return mergeParts(parts);
}
