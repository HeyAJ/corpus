import * as THREE from 'three';
import { mergeParts, type Sdf, type V3 } from '../sdf';
import {
  GREATER, LESSER, INFERIOR_RAMUS, ISCHIAL_RAMUS, PUBIC_BODY, PUBIC_TUBERCLE, SPINE_TIP, SUPERIOR_RAMUS, TUBEROSITY, F as HIP_JOINT,
  CONDYLE_L, CONDYLE_M, femurField, hipBoneField, shaftAxisAt, shaftRadiusAt, wingPoint,
} from './lower_limb_bones';
import { SACRAL_SHIFT, coccyxField, sacrumField } from './vertebral_column';
import { belly, fusiform, mirrorGeo, sheet } from './back_muscles';

/**
 * HIP AND THIGH MUSCLES, SHELL: THE MUSCLES OF THE GLUTEAL REGION AND THE THIGH AT TEXTBOOK DEPTH.
 * A LAYER organ of the muscles layer, in the pelvic group.
 *
 * FRAME. Origin organs.json [0, -0.2, 0], the hip and thigh bones' own origin; the pelvic group is
 * lowered 0.045 by the exploded stack, which the renderer adds back. Everything below is authored in
 * the BONES' OWN BODY COORDINATES (a point is the number `shells/lower_limb_bones.ts` gives, the
 * hip bone and the femur being rigid in the pelvic group) and moved to the organ's frame in
 * one place, `toLocal`. The sacrum and coccyx are the one exception worth knowing: they are drawn
 * with the warp at their own middle (`SACRAL_SHIFT`, -0.025), not with the pelvic group's -0.045, so a
 * point on the sacrum is carried by `SACRUM_IN_HIP` (+0.02) into the hip bone's body frame, which is what
 * makes the gluteus maximus and the piriformis meet the sacrum the sacroiliac joint is drawn against.
 *
 * HOW A MUSCLE IS PLACED. Nothing by eye. (1) Each ATTACHMENT is a landmark off the skeleton's own
 * files (the ischial tuberosity and spine, the pubic body and tubercle, the iliac crest and spines
 * through `wingPoint`, the greater and lesser trochanters, the femoral shaft's centreline and radius at
 * each height, the condyles, the sacrum's posterior surface by marching a ray to its own field) and is
 * snapped onto the bone's surface (`snap`), so it lies on it. (2) The course between two attachments is
 * a list of guide points: in the thigh a point on a ring round the shaft (`thigh`: a height, an angle
 * from the front round to the inner side, a distance from the shaft's own radius); in the pelvis a
 * short route round the bone. (3) `course` then pushes every interior control point OUT of the bones and
 * out of every muscle already drawn deeper (the layers are built deepest first, each a stack of
 * capsules the next must clear by its own half-thickness), so no muscle can pass through a bone and a
 * superficial muscle lies on the one under it. (4) The muscle is a closed elliptical tube
 * (`belly`) or a thin sheet (`sheet`), tendon at each end for the ones Gray's gives tendons.
 *
 * THE GLASS THIGH IS SLIM, and the skeleton ends at the knee. The glass is only 13 to 17 mm from the
 * shaft on its outer side at the height of the trochanters, so the vastus lateralis and the iliotibial
 * tract stand a few millimetres outside it (the probe prints the number). The tibia and fibula are not
 * drawn, so the hamstrings, the sartorius and the gracilis end in a short tendon just below the
 * condyles, where the leg's bones would carry them on: that is stated in each summary.
 *
 * NOT DRAWN. The bellies of the iliacus and psoas (the abdominal wall's organ, cross-referenced from
 * the iliopsoas tendon), the inguinal ligament, the fascia lata other than its iliotibial tract, the
 * bursae, and the nerves and vessels in the femoral triangle. All widths, thicknesses and courses are
 * DRAWING CHOICES.
 */

export const ORIGIN: V3 = [0, -0.2, 0];
/** The pelvic group's offset in the exploded stack. */
export const GROUP_Y = -0.045;
/** The sacrum and coccyx's displacement relative to the hip bone: its own warp (SACRAL_SHIFT) less the group's. */
export const SACRUM_IN_HIP = SACRAL_SHIFT - GROUP_Y;

const toLocal = (p: V3): V3 => [p[0], p[1] - ORIGIN[1], p[2]];

/* --------------------------------------------------------------------------- the bones */

let bones: Sdf | null = null;
/** The hip bone, femur, sacrum and coccyx as one field in the hip bone's body coordinates (right half; the sacrum is symmetric). */
export function hipThighBoneSd(): Sdf {
  if (bones) return bones;
  const hip = hipBoneField();
  const fem = femurField();
  const sac = sacrumField();
  const coc = coccyxField();
  bones = (x, y, z) => {
    let d = hip(Math.abs(x), y, z);
    d = Math.min(d, fem(Math.abs(x), y, z));
    if (Math.abs(x) < 0.07 && y > -0.2 && y < -0.05) d = Math.min(d, sac(x, y - SACRUM_IN_HIP, z), coc(x, y - SACRUM_IN_HIP, z));
    return d;
  };
  return bones;
}

/** Move a landmark onto the nearest point of the bone's surface (a few passes of the field's own gradient). */
export function snap(p: V3, offset = 0): V3 {
  const f = hipThighBoneSd();
  let q: V3 = p;
  for (let i = 0; i < 8; i++) {
    const d = f(q[0], q[1], q[2]) - offset;
    if (Math.abs(d) < 0.0001) break;
    const e = 0.0006;
    const gx = f(q[0] + e, q[1], q[2]) - f(q[0] - e, q[1], q[2]);
    const gy = f(q[0], q[1] + e, q[2]) - f(q[0], q[1] - e, q[2]);
    const gz = f(q[0], q[1], q[2] + e) - f(q[0], q[1], q[2] - e);
    const n = Math.hypot(gx, gy, gz) || 1;
    q = [q[0] - (gx / n) * d, q[1] - (gy / n) * d, q[2] - (gz / n) * d];
  }
  return q;
}

/* ---------------------------------------------------------------------- muscles already drawn */

interface Cap { a: V3; b: V3; r: number }
let layer: Cap[] = [];
/** Attachments recorded as the muscles are built, for the probe: muscle, end, landmark (body frame, right side), and what it should be on. */
export const ATTACHMENTS: { muscle: string; end: string; p: V3; on: 'hip' | 'femur' | 'sacrum' | 'free' }[] = [];

function layerSd(x: number, y: number, z: number): number {
  let d = 1;
  for (const c of layer) {
    const bx = c.b[0] - c.a[0], by = c.b[1] - c.a[1], bz = c.b[2] - c.a[2];
    const px = x - c.a[0], py = y - c.a[1], pz = z - c.a[2];
    const l2 = bx * bx + by * by + bz * bz || 1e-12;
    const t = Math.max(0, Math.min(1, (px * bx + py * by + pz * bz) / l2));
    const v = Math.hypot(px - bx * t, py - by * t, pz - bz * t) - c.r;
    if (v < d) d = v;
  }
  return d;
}
const fieldAll = (x: number, y: number, z: number): number => Math.min(hipThighBoneSd()(x, y, z), layerSd(x, y, z));

/* --------------------------------------------------------------------- the thigh's own frame */

/**
 * A point on a ring round the femoral shaft at height y: `phi` degrees from the front (0) round the inner side (90) to the back (180)
 * and the outer side (270), `radial` metres from the shaft's axis (the shaft's own radius is `shaftRadiusAt(y)`).
 */
export function thigh(y: number, phi: number, radial: number): V3 {
  const c = shaftAxisAt(y);
  const r = (phi * Math.PI) / 180;
  return [c[0] - Math.sin(r) * radial, y, c[2] + Math.cos(r) * radial];
}
/** Radial distance of the centre of a layer: the bone's radius, a gap, then the thickness of what lies between and the layer's own half. */
const onShaft = (y: number, under: number, half: number): number => shaftRadiusAt(y) + 0.0005 + under + half;

/** Outward direction for the thin axis of a belly: from the shaft in the thigh, from the hip joint above it. */
const outward = (p: THREE.Vector3): THREE.Vector3 => {
  if (p.y < -0.205) {
    const c = shaftAxisAt(p.y);
    return new THREE.Vector3(p.x - c[0], 0, p.z - c[2]).normalize();
  }
  return new THREE.Vector3(p.x - HIP_JOINT[0], p.y - HIP_JOINT[1], p.z - HIP_JOINT[2]).normalize();
};

/* ------------------------------------------------------------------------ course and belly */

/** Resample guide points to `n` control points along a smooth curve through them. */
function resample(guides: readonly V3[], n: number): V3[] {
  const c = new THREE.CatmullRomCurve3(guides.map((g) => new THREE.Vector3(g[0], g[1], g[2])), false, 'catmullrom', 0.5);
  return Array.from({ length: n + 1 }, (_, i) => {
    const p = c.getPointAt(i / n);
    return [p.x, p.y, p.z] as V3;
  });
}

/** Push a point out of the bones and the muscles beneath until it is `margin` clear of them. */
function clear(p: V3, margin: number): V3 {
  let q = p;
  const e = 0.0006;
  for (let i = 0; i < 12; i++) {
    const d = fieldAll(q[0], q[1], q[2]) - margin;
    if (d >= 0) break;
    const gx = fieldAll(q[0] + e, q[1], q[2]) - fieldAll(q[0] - e, q[1], q[2]);
    const gy = fieldAll(q[0], q[1] + e, q[2]) - fieldAll(q[0], q[1] - e, q[2]);
    const gz = fieldAll(q[0], q[1], q[2] + e) - fieldAll(q[0], q[1], q[2] - e);
    const n = Math.hypot(gx, gy, gz) || 1;
    const k = -d * 1.05 + 0.0002;
    q = [q[0] + (gx / n) * k, q[1] + (gy / n) * k, q[2] + (gz / n) * k];
  }
  return q;
}

interface Spec {
  /** Guide points, origin first. The first and last are the attachments and are kept exactly. */
  guides: V3[];
  /** Peak half-width and half-thickness, and the tendon fractions at each end. */
  w: number;
  t: number;
  a?: number;
  b?: number;
  tendon?: number;
  /** Control points along the course. */
  n?: number;
  /** What each end is attached to, for the probe. */
  ends?: ['hip' | 'femur' | 'sacrum' | 'free', 'hip' | 'femur' | 'sacrum' | 'free'];
}

/**
 * A MUSCLE BELLY from its guides: resampled, smoothed, pushed clear of the bones and of every muscle already drawn, built as an
 * elliptical tube, and then recorded as an obstacle for the muscles that lie over it.
 */
function bellyOf(id: string, s: Spec): THREE.BufferGeometry {
  const n = s.n ?? 9;
  const prof = (u: number): number => fusiform(u, s.a ?? 0.12, s.b ?? 0.12, s.tendon ?? 0.22);
  const half = (u: number): number => s.t * prof(u);
  let pts = resample(s.guides, n);
  for (let pass = 0; pass < 2; pass++) {
    const sm = pts.map((p, i) => (i === 0 || i === n ? p : ([(pts[i - 1][0] + 2 * p[0] + pts[i + 1][0]) / 4, (pts[i - 1][1] + 2 * p[1] + pts[i + 1][1]) / 4, (pts[i - 1][2] + 2 * p[2] + pts[i + 1][2]) / 4] as V3)));
    pts = sm.map((p, i) => (i === 0 || i === n ? p : clear(p, half(i / n) + 0.0004)));
  }
  pts = pts.map((p, i) => (i === 0 || i === n ? p : clear(p, half(i / n) + 0.0004)));
  for (let i = 0; i < n; i++) layer.push({ a: pts[i], b: pts[i + 1], r: Math.max(0.0012, half((i + 0.5) / n)) });
  ATTACHMENTS.push({ muscle: id, end: 'origin', p: pts[0], on: s.ends?.[0] ?? 'hip' });
  ATTACHMENTS.push({ muscle: id, end: 'insertion', p: pts[n], on: s.ends?.[1] ?? 'femur' });
  const g = belly(pts, (u) => s.w * prof(u), half, outward, Math.max(8, n + 1), 6);
  g.translate(0, -ORIGIN[1], 0);
  return g;
}

/** A SHEET over rails (a fan of courses): each rail from an origin to an insertion, interior points pushed clear; `thick` proud of the rails. */
function sheetOf(id: string, origins: V3[], inserts: V3[], thick: number, ends: ['hip' | 'femur' | 'sacrum' | 'free', 'hip' | 'femur' | 'sacrum' | 'free'], via: (i: number) => V3[] = () => [], n = 7): THREE.BufferGeometry {
  const rails = origins.map((o, i) => {
    const pts = resample([o, ...via(i), inserts[i]], n);
    return pts.map((p, k) => (k === 0 || k === n ? p : clear(p, 0.0005)));
  });
  rails.forEach((r, i) => {
    for (let k = 0; k < n; k++) layer.push({ a: r[k], b: r[k + 1], r: thick * 0.5 });
    if (i === 0 || i === rails.length - 1) {
      ATTACHMENTS.push({ muscle: id, end: `origin${i}`, p: r[0], on: ends[0] });
      ATTACHMENTS.push({ muscle: id, end: `insertion${i}`, p: r[n], on: ends[1] });
    }
  });
  // The sheet is mirrored by `pair`, so it is built on the right (side +1) and moved to the organ's frame here.
  const g = sheet(rails, 1, thick, HIP_JOINT as V3);
  g.translate(0, -ORIGIN[1], 0);
  return g;
}

const pair = (g: THREE.BufferGeometry): THREE.BufferGeometry[] => [g, mirrorGeo(g)];

/* ------------------------------------------------------------------------------ landmarks */

/** The iliac plate's outer (gluteal) face at wing coordinates (s, y), pushed a little off it. */
const iliac = (s: number, y: number, off = 0.0005): V3 => wingPoint(s, y, 0.0055 + off);
/** The right sacrum's posterior surface at height y (sacrum frame) and x, as a point in the hip bone's frame. */
function sacrumBack(yHip: number, x: number): V3 {
  const f = sacrumField();
  const ys = yHip - SACRUM_IN_HIP;
  let z = -0.14;
  while (f(x, ys, z) > 0 && z < 0) z += 0.0004;
  return [x, yHip, z - 0.0003];
}
function coccyxBack(yHip: number, x = 0.0): V3 {
  const f = coccyxField();
  const ys = yHip - SACRUM_IN_HIP;
  let z = -0.1;
  while (f(x, ys, z) > 0 && z < 0) z += 0.0004;
  return [x, yHip, z - 0.0003];
}
const PATELLA: V3 = [0.079, -0.293, -0.0015];
/** The lower ends of the hamstrings, the sartorius and the gracilis: just below the condyles, where the tibia and fibula (not drawn) would carry them on. */
const BELOW_KNEE_Y = -0.318;

/* ------------------------------------------------------------------------------ the muscles */

/** The pieces of each LEAF muscle, keyed by the leaf's part id in src/data/anatomy/hip_thigh_muscles.json. Built deepest first. */
export function hipThighLeaves(): Record<string, THREE.BufferGeometry[]> {
  layer = [];
  ATTACHMENTS.length = 0;
  const out: Record<string, THREE.BufferGeometry[]> = {};
  const y0 = (y: number): number => y;
  void y0;

  /* ---- the short lateral rotators and their neighbours: the deepest layer behind the hip */
  const grTop = snap([GREATER[0], GREATER[1] + 0.0125, GREATER[2]]);
  const grMedial = snap([GREATER[0] - 0.0095, GREATER[1] + 0.001, GREATER[2] + 0.0005]);
  out.piriformis = pair(bellyOf('piriformis', {
    guides: [sacrumBack(-0.112, 0.022).map((v, i) => (i === 2 ? v + 0.012 : v)) as unknown as V3, [0.05, -0.122, -0.058], [0.078, -0.138, -0.046], [0.097, -0.147, -0.03], grTop],
    w: 0.009, t: 0.0045, a: 0.15, b: 0.2, ends: ['sacrum', 'femur'],
  }));
  const spineMid = snap([SPINE_TIP[0], SPINE_TIP[1] - 0.002, SPINE_TIP[2]]);
  out.superior_gemellus = pair(bellyOf('superior_gemellus', { guides: [spineMid, [0.095, -0.155, -0.035], grMedial], w: 0.0045, t: 0.0028, a: 0.1, b: 0.2, tendon: 0.3, n: 5, ends: ['hip', 'femur'] }));
  const tubUpper = snap([TUBEROSITY[0] + 0.001, TUBEROSITY[1] + 0.008, TUBEROSITY[2] - 0.003]);
  out.inferior_gemellus = pair(bellyOf('inferior_gemellus', { guides: [tubUpper, [0.1, -0.178, -0.028], snap([GREATER[0] - 0.0085, GREATER[1] - 0.004, GREATER[2] - 0.002])], w: 0.0045, t: 0.0028, a: 0.1, b: 0.2, tendon: 0.3, n: 5, ends: ['hip', 'femur'] }));
  out.obturator_internus = pair(bellyOf('obturator_internus', {
    guides: [[0.049, -0.178, 0.0355], [0.066, -0.183, 0.005], [0.083, -0.19, -0.03], [0.099, -0.176, -0.028], snap([GREATER[0] - 0.0095, GREATER[1] + 0.003, GREATER[2] + 0.001])],
    w: 0.011, t: 0.0035, a: 0.45, b: 0.18, tendon: 0.2, n: 10, ends: ['hip', 'femur'],
  }));
  const quadTub = snap([0.1, -0.1865, -0.02]);
  out.quadratus_femoris = pair(bellyOf('quadratus_femoris', { guides: [snap([TUBEROSITY[0] + 0.011, TUBEROSITY[1] + 0.004, TUBEROSITY[2] + 0.002]), [0.093, -0.196, -0.026], quadTub], w: 0.0095, t: 0.0035, a: 0.1, b: 0.1, tendon: 0.35, n: 5, ends: ['hip', 'femur'] }));
  out.obturator_externus = pair(bellyOf('obturator_externus', {
    guides: [[0.055, -0.178, 0.0445], [0.075, -0.2, 0.012], [0.094, -0.188, -0.012], snap([GREATER[0] - 0.007, GREATER[1] - 0.0045, GREATER[2] + 0.0005])],
    w: 0.009, t: 0.0035, a: 0.2, b: 0.2, tendon: 0.25, n: 8, ends: ['hip', 'femur'],
  }));

  return out;
}

/** The hierarchy (child to parent), as src/data/anatomy/hip_thigh_muscles.json declares it. */
export const HIP_PARENT: Readonly<Record<string, string>> = {};

export function hipThighMuscleMap(): Record<string, THREE.BufferGeometry[]> {
  return hipThighLeaves();
}
export function hipThighMuscleGroups(): Record<string, THREE.BufferGeometry[]> {
  return hipThighMuscleMap();
}
export function hipThighMuscles(): THREE.BufferGeometry {
  return mergeParts(Object.values(hipThighMuscleGroups()).flat());
}
void [CONDYLE_L, CONDYLE_M, INFERIOR_RAMUS, ISCHIAL_RAMUS, PUBIC_BODY, PUBIC_TUBERCLE, SUPERIOR_RAMUS, LESSER, PATELLA, BELOW_KNEE_Y, iliac, coccyxBack, thigh, onShaft, toLocal, sheetOf, resample];
