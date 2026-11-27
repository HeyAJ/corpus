import * as THREE from 'three';
import { capsule, chain, ellipsoid, mergeParts, polygonise, sphere, subtract, union, type Sdf, type V3 } from '../sdf';

/**
 * HIP AND THIGH BONES: THE SHELL, AND THE GEOMETRY THE INTERIOR PARTS SHARE. A LAYER organ in the
 * pelvic group (drawn with the Bones layer on, or while selected).
 *
 * FRAME. Origin at organs.json [0, -0.2, 0]; the pelvic group is moved down 0.045 by the exploded
 * stack, as the bladder, uterus and prostate are, so the bones keep their place round them.
 * Everything is AUTHORED IN BODY COORDINATES for the patient's RIGHT side (+x) and moved into the
 * organ's frame by `local()`; the left side is the same shape mirrored in x.
 *
 * WHAT IT HAS TO STAND AROUND. The pelvic organs (uterus, ovaries, bladder, prostate, vagina,
 * the rectum, the ureters) lie between the two hip bones: the widest of them, the non-pregnant
 * uterus, reaches x +-0.07 at the height of the acetabulum, so the inner wall of each hip bone
 * stands at about 0.077. The glass figure is only as wide as its organs plus a skin margin, so
 * the pelvis cannot be wider than that margin allows; the iliac wing is therefore bowed out only
 * as far as the glass lets it (see the probe notes in the report), and the greater trochanter
 * (the widest bone point) is kept inside the thigh.
 *
 * WHAT IS DRAWN. The HIP BONE is three bones that meet at the acetabulum: the ILIUM (a bowed
 * plate with a crest, anterior superior and inferior spines, a posterior superior spine, a fossa
 * on the inside, an arcuate line and an auricular surface where it meets the sacrum), the ISCHIUM
 * (a body from the acetabulum down to the tuberosity, an ischial spine pointing in, a ramus that
 * runs forward) and the PUBIS (superior and inferior rami and a body that meets its fellow at the
 * symphysis); the pubic rami and the ischial ramus and body form a ring round the OBTURATOR
 * FORAMEN. Between the ilium and the ischial spine the back edge is the GREATER SCIATIC NOTCH,
 * below the spine the LESSER one. The FEMUR has a head with a fovea, a neck at an angle to the
 * shaft, greater and lesser trochanters with the intertrochanteric line in front and crest behind,
 * a shaft with the linea aspera along its back, and the two condyles. It ends at the condyles,
 * where the glass thigh has almost faded (legFadeStartY to legEndY). This is a schematic skeleton
 * at the body's own scale, not a traced atlas; the femur is shorter than a real one because the
 * glass leg is, as the vessels data end at the knee.
 *
 * THE ILIAC WING is a plate defined in its own plane (`WING_*`): a flat slab through the posterior
 * superior and anterior superior spines, bowed outward along the crest and bent outward again
 * towards the acetabulum, cut to an outline. That is cheaper and more controllable than a
 * polygonised shell and it makes the fossa (the concave inner face) fall out of the bow.
 */

export const ORIGIN_Y = -0.2;
export const local = (p: V3): V3 => [p[0], p[1] - ORIGIN_Y, p[2]];

export const sideField = (f: Sdf, side: number): Sdf => (side > 0 ? f : (x, y, z) => f(-x, y, z));
export const mirrorPts = (pts: readonly V3[], side: number): V3[] => pts.map((p): V3 => [side * p[0], p[1], p[2]]);

/** Extract a right-side body-coordinate field, for one side, into the organ's frame. */
export function extractSide(field: Sdf, min: V3, max: V3, cell: number, side: number): THREE.BufferGeometry {
  const lo: V3 = side > 0 ? min : [-max[0], min[1], min[2]];
  const hi: V3 = side > 0 ? max : [-min[0], max[1], max[2]];
  const f = sideField(field, side);
  return polygonise((x, y, z) => f(x, y + ORIGIN_Y, z), local(lo), local(hi), { cell, pad: 2 });
}
export function extractBoth(field: Sdf, min: V3, max: V3, cell: number): THREE.BufferGeometry {
  return mergeParts([extractSide(field, min, max, cell, 1), extractSide(field, min, max, cell, -1)]);
}

/** Orthonormal frame with its third axis along `n`. */
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

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/* ------------------------------------------------------------------ landmarks */

/** The centre of the femoral head, the centre of the socket it sits in, and the head's radius. */
export const F: V3 = [0.1, -0.15, -0.004];
export const HEAD_R = 0.0155;
export const SOCKET_R = 0.0172;
/** The direction the socket opens: lateral, a little forward and down. */
export const SOCKET_OPENS: V3 = [0.887, -0.269, 0.359];

/* ------------------------------------------------------------------ the ilium */

const WING_O: V3 = [0.036, -0.054, -0.078];
/** In-plane direction from the posterior to the anterior superior spine (x, z) and the outward normal. */
const WING_S: [number, number] = [0.471, 0.882];
const WING_N: [number, number] = [0.882, -0.471];
/** Thickness of the iliac plate, metres. A drawing choice. */
export const WING_THICK = 0.011;
/** How far the plate is bowed out along the crest, and how far it is carried out to meet the acetabulum, metres. Drawing choices fitted to the glass (see the header). */
const WING_BOW = 0.036;
const WING_LOW = 0.0215;

export const WING_OUTLINE: [number, number][] = [
  [0.0, -0.052], [0.02, -0.04], [0.05, -0.03], [0.085, -0.032], [0.115, -0.045], [0.14, -0.058], [0.141, -0.072], [0.144, -0.09],
  [0.13, -0.112], [0.118, -0.128], [0.095, -0.143], [0.075, -0.143], [0.06, -0.122], [0.048, -0.108], [0.036, -0.098], [0.018, -0.092],
  [0.01, -0.078], [0.003, -0.066],
];

/** The plate's offset from its flat plane at (s, y): bowed along the crest, bent out towards the socket. */
export function wingSurface(s: number, y: number): number {
  const top = smooth(-0.095, -0.05, y);
  const low = smooth(-0.09, -0.14, y);
  return WING_BOW * Math.sin(Math.PI * Math.max(0, Math.min(1, s / 0.144))) * top + WING_LOW * low;
}

/**
 * How far the POSTERIOR end of the plate is carried back, metres (a negative z offset), and the
 * span of s over which that fades out. WHY IT EXISTS (lv2, 2026-11). The sacrum's auricular surface
 * lies where the sacral axis puts it (the cord/column centreline, z -0.0713 at the alae) and the
 * ilium's lay 7.7 mm in front of it (-0.0636): the plate was authored from the acetabulum and the
 * iliac spines, with nothing tying its back end to the sacrum, so the two faces of the sacroiliac
 * joint overlapped for only a part of their length. The sacrum cannot move (the promontory has to
 * meet L5, and the alae follow the column), so the ilium's back end does: a pure translation in z
 * for s below WING_BACK_S0, fading to nothing by WING_BACK_S1, so the anterior superior and inferior
 * spines, the crest, the fossa and the acetabular junction keep their places and only the plate
 * between them and the sacrum bends backwards. A pure z translation (no change in x) is chosen
 * because the two faces already agreed in x to within a millimetre (0.0393 against 0.0385); only z
 * differed. 7.7 mm is the measured offset of the two patch centres, not a figure from the
 * literature; Gray's says only that the ilium and sacrum meet at the auricular surfaces.
 */
const WING_BACK_Z = -0.0077;
const WING_BACK_S0 = 0.03;
const WING_BACK_S1 = 0.09;
function wingBack(s: number): number {
  return WING_BACK_Z * (1 - smooth(WING_BACK_S0, WING_BACK_S1, s));
}

/** The body-coordinate point on the plate's mid-surface at (s, y), pushed off it by `off` along the outward normal. */
export function wingPoint(s: number, y: number, off = 0): V3 {
  const d = wingSurface(s, y) + off;
  return [WING_O[0] + s * WING_S[0] + d * WING_N[0], y, WING_O[2] + s * WING_S[1] + d * WING_N[1] + wingBack(s)];
}

/** The plate within an outline, optionally thinner and shifted off the mid-surface. */
export function wing(outline: readonly (readonly [number, number])[] = WING_OUTLINE, thick = WING_THICK, shift = 0): Sdf {
  const sd = polySd(outline);
  return (x, y, z) => {
    const dx = x - WING_O[0];
    // Undo the posterior translation of wingPoint. It depends on s and s depends on z, so the
    // inverse is found by fixed-point iteration (the slope of wingBack is 0.13, so three passes
    // leave well under a micrometre).
    let dz = z - WING_O[2];
    let s = dx * WING_S[0] + dz * WING_S[1];
    for (let k = 0; k < 3; k++) {
      dz = z - WING_O[2] - wingBack(s);
      s = dx * WING_S[0] + dz * WING_S[1];
    }
    const dn = dx * WING_N[0] + dz * WING_N[1];
    return Math.max(Math.abs(dn - wingSurface(s, y) - shift) * 0.9 - thick / 2, sd(s, y));
  };
}

/** Shrink an outline about its centre, for a core inside the plate (the red marrow of the ilium). */
export function shrunk(outline: readonly (readonly [number, number])[], k: number): [number, number][] {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of outline) {
    cx += x;
    cy += y;
  }
  cx /= outline.length;
  cy /= outline.length;
  return outline.map(([x, y]): [number, number] => [cx + (x - cx) * k, cy + (y - cy) * k]);
}

/* ---------------------------------------------------------- acetabulum, ischium, pubis */

const CUP: V3 = [0.0955, -0.1495, -0.0035];
export const CUP_R = 0.0215;
export const NOTCH: V3 = [0.1, -0.1705, -0.0045];

export const socketField = (): Sdf => sphere(F, SOCKET_R);
export const notchField = (): Sdf => ellipsoid(NOTCH, [0.0075, 0.006, 0.0075]);

/** The cup of the acetabulum: a mass of bone round the socket, with the notch cut at its lower edge. */
export function acetabulumField(): Sdf {
  return subtract(subtract(sphere(CUP, CUP_R), socketField()), notchField());
}

export const ISCHIUM_BODY: V3[] = [[0.096, -0.158, -0.012], [0.088, -0.182, -0.022], [0.079, -0.2035, -0.026]];
export const TUBEROSITY: V3 = [0.079, -0.2035, -0.026];
export const ISCHIAL_RAMUS: V3[] = [TUBEROSITY, [0.0735, -0.2105, -0.008], [0.064, -0.2135, 0.012], [0.052, -0.2125, 0.032]];
export const INFERIOR_RAMUS: V3[] = [
  [0.052, -0.2125, 0.032], [0.038, -0.205, 0.045], [0.024, -0.193, 0.054], [0.0115, -0.177, 0.0585],
];
export const SUPERIOR_RAMUS: V3[] = [
  [0.097, -0.14, 0.012], [0.078, -0.143, 0.032], [0.052, -0.148, 0.049], [0.03, -0.1535, 0.0575], [0.0115, -0.159, 0.0605],
];
export const SPINE_BASE: V3 = [0.092, -0.15, -0.03];
export const SPINE_TIP: V3 = [0.0745, -0.152, -0.041];
export const PUBIC_BODY: V3 = [0.0115, -0.168, 0.0585];
export const PUBIC_TUBERCLE: V3 = [0.025, -0.155, 0.066];

export const ischialBodyField = (): Sdf => chain(ISCHIUM_BODY, [0.0075, 0.0068, 0.0062]);
export const tuberosityField = (): Sdf => ellipsoid(TUBEROSITY, [0.0125, 0.0135, 0.0115]);
export const ischialRamusField = (): Sdf => chain(ISCHIAL_RAMUS, [0.0058, 0.0056, 0.0054, 0.0052]);
export const ischialSpineField = (): Sdf => capsule(SPINE_BASE, SPINE_TIP, 0.0042, 0.002);
export const inferiorRamusField = (): Sdf => chain(INFERIOR_RAMUS, [0.0052, 0.0052, 0.0052, 0.0052]);
export const superiorRamusField = (): Sdf => chain(SUPERIOR_RAMUS, [0.007, 0.0065, 0.0062, 0.0062, 0.006]);
export const pubicBodyField = (): Sdf => ellipsoid(PUBIC_BODY, [0.0075, 0.0165, 0.0062]);
export const pubicTubercleField = (): Sdf => sphere(PUBIC_TUBERCLE, 0.0033);

export const ischiumField = (): Sdf => union(ischialBodyField(), tuberosityField(), ischialRamusField(), ischialSpineField());
export const pubisField = (): Sdf => union(superiorRamusField(), inferiorRamusField(), pubicBodyField(), pubicTubercleField());
export const iliumField = (): Sdf => wing();

export function hipBoneField(): Sdf {
  return union(wing(), acetabulumField(), ischiumField(), pubisField());
}
export const HIP_MIN: V3 = [0.0, -0.225, -0.095];
export const HIP_MAX: V3 = [0.15, -0.025, 0.072];

/* ------------------------------------------------------------------- the femur */

export const NECK_END: V3 = [0.108, -0.1695, -0.008];
export const SHAFT: V3[] = [[0.101, -0.182, -0.007], [0.091, -0.225, -0.005], [0.083, -0.27, -0.0075], [0.078, -0.298, -0.0115]];
export const SHAFT_R = [0.0092, 0.0082, 0.0082, 0.011];
export const GREATER: V3 = [0.1095, -0.165, -0.011];
export const LESSER: V3 = [0.093, -0.195, -0.0145];
export const CONDYLE_L: V3 = [0.0875, -0.3, -0.014];
export const CONDYLE_M: V3 = [0.0685, -0.3, -0.014];
export const CONDYLE_R: V3 = [0.0095, 0.0095, 0.0105];

export const headField = (): Sdf => ellipsoid(F, [HEAD_R, HEAD_R, HEAD_R]);
export const neckField = (): Sdf => capsule(F, NECK_END, 0.0105, 0.0105);
export const greaterField = (): Sdf => ellipsoid(GREATER, [0.0095, 0.0125, 0.0105]);
export const lesserField = (): Sdf => ellipsoid(LESSER, [0.0055, 0.0065, 0.0055]);
export const shaftField = (): Sdf => chain(SHAFT, SHAFT_R);
export const condyleFields = (): Sdf[] => [ellipsoid(CONDYLE_L, CONDYLE_R), ellipsoid(CONDYLE_M, CONDYLE_R)];
export const patellarField = (): Sdf => ellipsoid([0.079, -0.293, -0.0015], [0.0085, 0.011, 0.005]);
const notchCutter = (): Sdf => ellipsoid([0.079, -0.3, -0.026], [0.0035, 0.0075, 0.009]);
/** The fovea: a pit on the head where the ligament of the head is fixed. */
export const FOVEA: V3 = [F[0] - 0.0145 * 0.69, F[1] - 0.0145 * 0.57, F[2] - 0.0145 * 0.46];
export const foveaCutter = (): Sdf => sphere(FOVEA, 0.0026);

export function femurField(): Sdf {
  const bone = union(headField(), neckField(), greaterField(), lesserField(), shaftField(), ...condyleFields(), patellarField());
  return subtract(subtract(bone, notchCutter()), foveaCutter());
}
export const FEMUR_MIN: V3 = [0.055, -0.318, -0.04];
export const FEMUR_MAX: V3 = [0.13, -0.13, 0.015];

/** Shaft radius at a height, interpolating the chain's radii by height, for sleeves round the shaft. */
export function shaftRadiusAt(y: number): number {
  for (let i = 0; i < SHAFT.length - 1; i++) {
    const a = SHAFT[i];
    const b = SHAFT[i + 1];
    if (y <= a[1] && y >= b[1]) return SHAFT_R[i] + ((SHAFT_R[i + 1] - SHAFT_R[i]) * (a[1] - y)) / (a[1] - b[1]);
  }
  return y > SHAFT[0][1] ? SHAFT_R[0] : SHAFT_R[SHAFT_R.length - 1];
}
/** The shaft's centreline at a height (linear between the control points). */
export function shaftAxisAt(y: number): V3 {
  for (let i = 0; i < SHAFT.length - 1; i++) {
    const a = SHAFT[i];
    const b = SHAFT[i + 1];
    if (y <= a[1] && y >= b[1]) {
      const t = (a[1] - y) / (a[1] - b[1]);
      return [a[0] + (b[0] - a[0]) * t, y, a[2] + (b[2] - a[2]) * t];
    }
  }
  return y > SHAFT[0][1] ? SHAFT[0] : SHAFT[SHAFT.length - 1];
}

/** The whole hip and thigh, for the shell. */
export function lowerLimbBones(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [1, -1]) {
    parts.push(extractSide(hipBoneField(), HIP_MIN, HIP_MAX, 0.005, side));
    parts.push(extractSide(femurField(), FEMUR_MIN, FEMUR_MAX, 0.0046, side));
  }
  return mergeParts(parts);
}
