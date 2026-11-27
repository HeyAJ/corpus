import * as THREE from 'three';
import { SPINAL_CORD_PATH } from '../paths';
import { ellipsoid, mergeParts, polygonise, roundBox, subtract, tubeAlong, union, type Sdf, type V3 } from '../sdf';

/**
 * RIB CAGE: THE SHELL, AND THE GEOMETRY THE INTERIOR PARTS SHARE. A LAYER organ in the thoracic
 * group (drawn with the Bones layer on, or while selected).
 *
 * FRAME. Origin at organs.json [0, 0.2, 0]; every shape below is AUTHORED IN BODY COORDINATES
 * (the numbers a reader can compare with the lungs and the spine) and moved into the organ's
 * own frame by `local()` at the last moment. +x is the patient's right, +y cranial, +z
 * anterior. The thoracic group has no exploded-stack offset, so body coordinates are world
 * coordinates here.
 *
 * WHAT IT IS DRAWN AROUND. Gray's relationships kept: twelve pairs of ribs, a sternum of
 * manubrium, body and xiphoid process, the first seven pairs joined to it by their own costal
 * cartilages, the 8th to 10th joined to the cartilage above, the 11th and 12th free. The cage
 * has to stand OUTSIDE the lungs and the heart or the Bones layer would cut them: the lungs
 * reach x 0.134 at the widest, z -0.066 to +0.066, and the apex of each lung comes up to y 0.326
 * at a narrow x range, so the first rib is a small ring around the apex's waist and the cage
 * widens downward exactly as the real one does. The heart's front is at z 0.057; the sternum
 * lies in front of that. tools in the scratchpad (sk2/contain.ts) print the worst clearances.
 *
 * HOW THE RIBS ARE DRAWN. Each rib is a smooth curve through ten or so control points: the head
 * on the side of its vertebral body, the neck going back and out to the tubercle (on the
 * transverse process), then an arc round an ellipse that is the cage's own cross-section at the
 * height of the rib, falling as it goes forward (a rib slopes down towards the front) to the
 * costochondral junction. The cross-section ellipse is wider and deeper as it goes down
 * (`CAGE_A`, `CAGE_BP`, `CAGE_BF`). All of this is a DRAWING choice, fitted to the organs the
 * cage must clear; it is a schematic rib cage, not a traced one (MODEL_LIMITATIONS says so).
 *
 * THE SPINE. The head of rib n is placed on the side of the vertebral body at thoracic level n.
 * `T1_Y` and `T_PITCH` are the levels agreed with the vertebral column's own drawing
 * (shells/vertebral_column.ts, agent sk1): the same two numbers, so the costal facets and the
 * rib heads meet. Vertebral body centre is placed `BODY_BEHIND_CORD` in front of the spinal
 * cord's centreline.
 *
 * TRIANGLES. Shell: 24 ribs of 4 sides, 14 cartilages, the sternum polygonised at a coarse cell.
 * The interior parts (atlas/thoracic_cage.parts.ts) call the same builders at higher detail.
 */

/** Origin of the organ's frame, organs.json. */
export const ORIGIN_Y = 0.2;

/** Body coordinates to the organ's frame. */
export const local = (p: V3): V3 => [p[0], p[1] - ORIGIN_Y, p[2]];

/** Level of the first thoracic vertebra's body centre and the spacing between thoracic bodies, metres. Drawing choices shared with the vertebral column. */
export const T1_Y = 0.3;
export const T_PITCH = 0.0227;
/** Height of the body of thoracic vertebra n (1 to 12). */
export const thoracicLevel = (n: number): number => T1_Y - T_PITCH * (n - 1);

/** How far in front of the spinal cord's centreline the centre of a vertebral body lies, metres. A drawing choice (the canal sits between). */
export const BODY_BEHIND_CORD = 0.016;

/** z of the spinal cord's centreline at height y (linear between the cord path's control points). */
export function cordZ(y: number): number {
  const P = SPINAL_CORD_PATH;
  if (y >= P[0][1]) return P[0][2];
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i];
    const b = P[i + 1];
    if (y <= a[1] && y >= b[1]) {
      const t = (a[1] - y) / (a[1] - b[1]);
      return a[2] + (b[2] - a[2]) * t;
    }
  }
  return P[P.length - 1][2];
}

/** z of the centre of a vertebral body at height y. */
export const bodyZ = (y: number): number => cordZ(y) + BODY_BEHIND_CORD;

/** Piecewise-linear interpolation of a (y, value) table, y descending. */
function table(rows: readonly (readonly [number, number])[], y: number): number {
  if (y >= rows[0][0]) return rows[0][1];
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i];
    const b = rows[i + 1];
    if (y <= a[0] && y >= b[0]) return a[1] + ((b[1] - a[1]) * (a[0] - y)) / (a[0] - b[0]);
  }
  return rows[rows.length - 1][1];
}

/**
 * THE CAGE'S CROSS-SECTION, an ellipse at each height: half-width, half-depth behind and half-
 * depth in front of the centre line z = 0. Fitted so every rib clears the lungs (widest 0.134,
 * z +-0.066) by about a centimetre and the heart (front 0.057) by more. Drawing choices.
 */
const CAGE_A: readonly (readonly [number, number])[] = [
  [0.32, 0.09], [0.3, 0.112], [0.28, 0.118], [0.26, 0.126], [0.24, 0.134], [0.2, 0.143], [0.16, 0.148],
  [0.12, 0.15], [0.08, 0.148], [0.04, 0.138], [0.0, 0.12],
];
const CAGE_BP: readonly (readonly [number, number])[] = [
  [0.32, 0.07], [0.3, 0.085], [0.28, 0.09], [0.24, 0.098], [0.2, 0.105], [0.16, 0.108], [0.1, 0.108], [0.05, 0.104], [0.0, 0.094],
];
const CAGE_BF: readonly (readonly [number, number])[] = [
  [0.32, 0.05], [0.3, 0.052], [0.28, 0.056], [0.24, 0.082], [0.2, 0.1], [0.16, 0.104], [0.12, 0.104], [0.08, 0.1], [0.04, 0.092], [0.0, 0.085],
];

/** Half-width and back half-depth of the cage's cross-section at height y: the scapula hugs this surface. */
export const cageHalfWidth = (y: number): number => table(CAGE_A, y);
export const cageBackDepth = (y: number): number => table(CAGE_BP, y);

interface RibSpec {
  /** Level of the head (the vertebral body it meets). */
  yh: number;
  /** Level of the front end (costochondral junction). */
  yEnd: number;
  /** x of the front end for ribs 1 to 10, whose cartilage turns in to the sternum. */
  xEnd?: number;
  /** Angle round the cage ellipse at which a free rib ends (11, 12), radians from the back midline. */
  aEnd?: number;
}

/** Twelve ribs of one side. Levels are drawing choices following Gray's: each rib slopes down towards the front. */
const RIBS: readonly RibSpec[] = [
  { yh: thoracicLevel(1), yEnd: 0.272, xEnd: 0.03 },
  { yh: thoracicLevel(2), yEnd: 0.222, xEnd: 0.05 },
  { yh: thoracicLevel(3), yEnd: 0.19, xEnd: 0.062 },
  { yh: thoracicLevel(4), yEnd: 0.168, xEnd: 0.072 },
  { yh: thoracicLevel(5), yEnd: 0.145, xEnd: 0.082 },
  { yh: thoracicLevel(6), yEnd: 0.122, xEnd: 0.092 },
  { yh: thoracicLevel(7), yEnd: 0.098, xEnd: 0.102 },
  { yh: thoracicLevel(8), yEnd: 0.076, xEnd: 0.112 },
  { yh: thoracicLevel(9), yEnd: 0.056, xEnd: 0.118 },
  { yh: thoracicLevel(10), yEnd: 0.04, xEnd: 0.12 },
  { yh: thoracicLevel(11), yEnd: 0.03, aEnd: 2.0 },
  { yh: thoracicLevel(12), yEnd: 0.03, aEnd: 1.5 },
];

export const RIB_COUNT = RIBS.length;

/** Point on the cage ellipse at height y and angle a (0 = back midline, pi/2 = side, pi = front midline). */
function ring(y: number, a: number): [number, number] {
  const A = table(CAGE_A, y);
  const c = Math.cos(a);
  const depth = c > 0 ? table(CAGE_BP, y) : table(CAGE_BF, y);
  return [A * Math.sin(a), -c * depth];
}

/**
 * The cage's cross-section, exported for the muscle shells that wrap it (chest wall, abdominal
 * wall, back): one rule for where the outside of the trunk lies, so a muscle stub is placed
 * against the ribs it covers and not against a second, drifting copy of their numbers.
 */
export const cageRing = ring;

/** Control points of the right-hand rib n (1..12), body coordinates, head to front end. */
export function ribPointsBody(n: number): V3[] {
  const r = RIBS[n - 1];
  const zs = bodyZ(r.yh);
  const aS = Math.asin(Math.min(0.9, 0.05 / table(CAGE_A, r.yh)));
  const aE = r.aEnd !== undefined ? r.aEnd : Math.PI - Math.asin(Math.min(0.99, (r.xEnd as number) / table(CAGE_A, r.yEnd)));
  const [x0, z0] = ring(r.yh, aS);
  const pts: V3[] = [
    [0.016, r.yh + 0.002, zs],
    [0.022, r.yh + 0.002, zs + 0.3 * (z0 - zs)],
    [0.034, r.yh + 0.001, zs + 0.7 * (z0 - zs)],
    [x0, r.yh, z0],
  ];
  const steps = 7;
  for (let k = 1; k <= steps; k++) {
    const s = k / steps;
    // The rib falls slowly at the back and faster as it comes round to the front.
    const h = 0.1 * s + 0.9 * Math.pow(s, 1.5);
    const y = r.yh - (r.yh - r.yEnd) * h;
    const [x, z] = ring(y, aS + (aE - aS) * s);
    pts.push([x, y, z]);
  }
  return pts;
}

const mirror = (pts: readonly V3[], side: number): V3[] => pts.map((p): V3 => [side * p[0], p[1], p[2]]);

/** The rib's control points in the organ's frame, for the right (+1) or left (-1) side. */
export function ribPoints(n: number, side = 1): V3[] {
  return mirror(ribPointsBody(n), side).map(local);
}

/** Radius along a rib, 0 at the head to 1 at the front: the head swells, the neck is slim, the shaft is even. A drawing choice. */
function ribRadius(t: number, scale: number): number {
  const base = t < 0.05 ? 0.0044 : t < 0.12 ? 0.0028 : t < 0.9 ? 0.0036 : 0.0031;
  return base * scale;
}

export interface RibOptions {
  tubular?: number;
  radial?: number;
  /** Multiplier on the radius: the typical rib is drawn thicker so its features read (illustrative). */
  scale?: number;
}

export function ribGeometry(n: number, side = 1, o: RibOptions = {}): THREE.BufferGeometry {
  const scale = o.scale ?? 1;
  return tubeAlong(ribPoints(n, side), (t) => ribRadius(t, scale), { tubular: o.tubular ?? 24, radial: o.radial ?? 4 });
}

/** The right rib's curve, for features that are placed along it. */
export function ribCurve(n: number, side = 1): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3(ribPoints(n, side).map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', 0.5);
}

/* ------------------------------------------------------------------ the sternum */

/** z of the sternum's midline at height y: it leans forward as it goes down, as Gray's draws it. */
export function sternumZ(y: number): number {
  return table([[0.272, 0.05], [0.227, 0.064], [0.137, 0.088], [0.117, 0.086]], y);
}

/** A frame for a flat bone: origin, in-plane axes u (across) and v (along), normal w. */
export interface Frame {
  o: V3;
  u: V3;
  v: V3;
  w: V3;
}

/** Build a right-handed frame from an origin, a long-axis direction and a notional across direction (+x). */
export function frameOf(o: V3, along: V3): Frame {
  const v = new THREE.Vector3(...along).normalize();
  const u = new THREE.Vector3(1, 0, 0);
  const w = new THREE.Vector3().crossVectors(u, v).normalize();
  return { o, u: [1, 0, 0], v: [v.x, v.y, v.z], w: [w.x, w.y, w.z] };
}

/** A field defined in a frame's own coordinates, placed in the body. */
export function inFrame(base: Sdf, f: Frame): Sdf {
  const [ox, oy, oz] = f.o;
  const [ux, uy, uz] = f.u;
  const [vx, vy, vz] = f.v;
  const [wx, wy, wz] = f.w;
  return (x, y, z) => {
    const dx = x - ox;
    const dy = y - oy;
    const dz = z - oz;
    return base(dx * ux + dy * uy + dz * uz, dx * vx + dy * vy + dz * vz, dx * wx + dy * wy + dz * wz);
  };
}

const MANUBRIUM_FRAME = frameOf([0, 0.2495, 0.057], [0, 0.045, -0.014]);
const SBODY_FRAME = frameOf([0, 0.182, 0.076], [0, 0.09, -0.024]);
const XIPHOID_FRAME = frameOf([0, 0.127, 0.0875], [0, 0.02, 0.0]);

/** Half-lengths used again by the landmarks: manubrium 0.0235 and body 0.0465 along their axes. */
export const MANUBRIUM_HALF = [0.0185, 0.0235, 0.004] as const;
export const SBODY_HALF = [0.015, 0.0465, 0.0038] as const;
export const XIPHOID_HALF = [0.0065, 0.0105, 0.003] as const;

export function manubriumField(): Sdf {
  const base = subtract(
    subtract(
      subtract(roundBox([0, 0, 0], MANUBRIUM_HALF, 0.0025), ellipsoid([0, MANUBRIUM_HALF[1], 0], [0.0075, 0.005, 0.006])),
      ellipsoid([MANUBRIUM_HALF[0], 0.0185, 0], [0.005, 0.005, 0.006]),
    ),
    ellipsoid([-MANUBRIUM_HALF[0], 0.0185, 0], [0.005, 0.005, 0.006]),
  );
  return inFrame(base, MANUBRIUM_FRAME);
}
export const sternalBodyField = (): Sdf => inFrame(roundBox([0, 0, 0], SBODY_HALF, 0.0025), SBODY_FRAME);
export const xiphoidField = (): Sdf => inFrame(ellipsoid([0, 0, 0], XIPHOID_HALF), XIPHOID_FRAME);
export const MANUBRIUM = MANUBRIUM_FRAME;
export const SBODY = SBODY_FRAME;
export const XIPHOID = XIPHOID_FRAME;

/** Extract a body-coordinate field into the organ's frame. */
export function extract(field: Sdf, min: V3, max: V3, cell: number): THREE.BufferGeometry {
  const f: Sdf = (x, y, z) => field(x, y + ORIGIN_Y, z);
  return polygonise(f, local(min), local(max), { cell, pad: 2 });
}

export function sternumGeometry(which: 'all' | 'manubrium' | 'body' | 'xiphoid', cell: number): THREE.BufferGeometry {
  const fields: Record<string, { f: Sdf; min: V3; max: V3 }> = {
    manubrium: { f: manubriumField(), min: [-0.025, 0.222, 0.04], max: [0.025, 0.276, 0.07] },
    body: { f: sternalBodyField(), min: [-0.022, 0.132, 0.06], max: [0.022, 0.232, 0.098] },
    xiphoid: { f: xiphoidField(), min: [-0.012, 0.113, 0.078], max: [0.012, 0.142, 0.095] },
  };
  if (which !== 'all') {
    const s = fields[which];
    return extract(s.f, s.min, s.max, cell);
  }
  const f = union(fields.manubrium.f, fields.body.f, fields.xiphoid.f);
  return extract(f, [-0.025, 0.113, 0.04], [0.025, 0.276, 0.098], cell);
}

/* --------------------------------------------------------- costal cartilages */

/** Where on the sternum the cartilage of rib n (1..7) meets it: level of the junction. Drawing choices following Gray's (the 2nd at the sternal angle). */
const ATTACH_Y = [0.268, 0.228, 0.208, 0.19, 0.172, 0.155, 0.14];

/** Control points of the cartilage of right rib n (1..10), body coordinates, rib end to sternum (or to the cartilage above). */
export function cartilagePointsBody(n: number): V3[] {
  const rib = ribPointsBody(n);
  const end = rib[rib.length - 1];
  if (n <= 7) {
    const ay = ATTACH_Y[n - 1];
    const att: V3 = [0.015, ay, sternumZ(ay)];
    const mid: V3 = [(end[0] + att[0]) / 2, (end[1] + att[1]) / 2 + 0.003, (end[2] + att[2]) / 2 + 0.003];
    return [end, mid, att];
  }
  // Ribs 8 to 10 do not reach the sternum: each turns up and joins the cartilage above it (the costal margin).
  const above = cartilagePointsBody(n - 1);
  const c = new THREE.CatmullRomCurve3(above.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const j = c.getPoint(0.55);
  const att: V3 = [j.x, j.y - 0.003, j.z];
  const mid: V3 = [(end[0] + att[0]) / 2 + 0.004, (end[1] + att[1]) / 2, (end[2] + att[2]) / 2 + 0.002];
  return [end, mid, att];
}

export function cartilageGeometry(n: number, side = 1, tubular = 8, radial = 4): THREE.BufferGeometry {
  const pts = mirror(cartilagePointsBody(n), side).map(local);
  return tubeAlong(pts, () => 0.0032, { tubular, radial });
}

/* ------------------------------------------------------------------- the shell */

export function thoracicCage(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [1, -1]) {
    for (let n = 1; n <= RIB_COUNT; n++) parts.push(ribGeometry(n, side, { tubular: 22, radial: 4 }));
    for (let n = 1; n <= 10; n++) parts.push(cartilageGeometry(n, side, 6, 4));
  }
  parts.push(sternumGeometry('all', 0.004));
  return mergeParts(parts);
}
