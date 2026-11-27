import * as THREE from 'three';
import { mergeParts, type Sdf, type V3 } from '../sdf';
import {
  CLAVICLE_PTS, SCAPULA_THICK, SHAFT_PTS, humerusField, scapulaField, scapulaZ, spineY,
} from './upper_limb_bones';
import { ribPointsBody } from './thoracic_cage';
import {
  COLUMN_LEVELS, SACRAL_SHIFT, SACRUM_TOP, coccyxField, placement, sacrumField, shapeOf, vertebraParts,
  type Level,
} from './vertebral_column';
import { hipBoneField, wingPoint } from './lower_limb_bones';
import { skullBone } from './skull';
import { slab, trunkPoint, trunkRing } from './muscle_stub';

/**
 * BACK MUSCLES, SHELL: THE MUSCLES OF THE BACK AT TEXTBOOK DEPTH.
 * A LAYER organ of the muscles layer, and an AXIAL one like the vertebral column it moves.
 *
 * FRAME. Origin organs.json [0, 0, 0], group `axial` (offset 0): authored in the exploded body
 * and carried by the stack's continuous warp exactly as the spinal cord and the column are. A
 * vertebra's landmark is taken through `placement` (which already includes the warp at that
 * vertebra); a rib's is the rib's own body-frame number (the thoracic group has no offset); the
 * ilium and the sacrum are RIGID in the pelvic group, so a point on them is the body number less
 * 0.045 (the ilium) or plus `SACRAL_SHIFT` (the sacrum and the coccyx), as the bones' own shells do.
 *
 * HOW A MUSCLE IS PLACED (this replaced a stub whose spine table was 2.3 cm in front of the true
 * spinous tips, so its muscles lay inside the bone). Nothing is placed by eye:
 *  - an ATTACHMENT is a landmark read off the skeleton's own files (a spinous tip through the
 *    vertebra's placement, a transverse process tip, the angle of a rib, the medial border and
 *    the spine of the scapula, the clavicle, the acromion, the intertubercular sulcus, the iliac
 *    crest, the median sacral crest, the occiput and the mastoid by marching a ray to the skull's
 *    own field);
 *  - the body of the muscle between two attachments is carried over the trunk by `railPoints`:
 *    the two ends are the landmarks exactly, and between them the muscle lies on the trunk's
 *    cross-section (the rib cage's ellipse, `trunkPoint`) at the height and the angle round it
 *    that the two ends interpolate, pushed outward just far enough to clear every bone under it
 *    (`clearanceOff` sphere-traces the bones' own fields inward from outside until it touches).
 *    So a muscle over the scapula stands off the scapula, one in the gutter beside the spine
 *    stands off the laminae and the ribs' angles, and none can pass through a bone;
 *  - a LAYER is an extra standoff (`lift`) equal to the thickness of what lies deeper, named at
 *    each muscle.
 * The thicknesses, widths and the stencil of the dilation (a muscle bridges the ridges of the ribs
 * and does not dip between them) are DRAWING CHOICES. No muscle size here is a measurement.
 *
 * THE GLASS. The glass figure was fitted to the viscera with a few millimetres over the ribs, so
 * the superficial muscles (trapezius, latissimus dorsi) stand outside it in places; the number is
 * printed by the probe and reported, and the glass is not changed here.
 */

export const ORIGIN: V3 = [0, 0, 0];

/* ---------------------------------------------------------------- the bones a back muscle must clear */

const PELVIS_SHIFT = -0.045;

interface Seg { a: V3; b: V3; r: number }
const boneFields: { deep: Sdf | null; all: Sdf | null } = { deep: null, all: null };

/**
 * The bones near the back of the trunk as ONE field in scene coordinates, for the right half
 * (x is taken as |x|, which is exact for every bone here but the midline ones, symmetric by
 * construction): the twelve ribs (capsules along their own control points), every vertebra's own
 * field through its inverse placement, the sacrum and coccyx, the hip bone, the scapula, the
 * clavicle, the humerus. Negative inside. It is a distance ESTIMATE (a union of fields), which is
 * all a sphere trace needs.
 */
export function trunkBoneSd(girdle = true): Sdf {
  const cached = boneFields[girdle ? 'all' : 'deep'];
  if (cached) return cached;
  const ribs: Seg[] = [];
  for (let n = 1; n <= 12; n++) {
    const p = ribPointsBody(n);
    for (let i = 0; i < p.length - 1; i++) ribs.push({ a: p[i], b: p[i + 1], r: i === 0 ? 0.0044 : 0.0038 });
  }
  const clav: Seg[] = [];
  for (let i = 0; i < CLAVICLE_PTS.length - 1; i++) clav.push({ a: CLAVICLE_PTS[i], b: CLAVICLE_PTS[i + 1], r: 0.0045 });
  const shaft: Seg[] = [];
  for (let i = 0; i < SHAFT_PTS.length - 1; i++) shaft.push({ a: SHAFT_PTS[i], b: SHAFT_PTS[i + 1], r: 0.0095 });
  const segDist = (s: Seg, x: number, y: number, z: number): number => {
    const bx = s.b[0] - s.a[0], by = s.b[1] - s.a[1], bz = s.b[2] - s.a[2];
    const px = x - s.a[0], py = y - s.a[1], pz = z - s.a[2];
    const l2 = bx * bx + by * by + bz * bz || 1e-12;
    const t = Math.max(0, Math.min(1, (px * bx + py * by + pz * bz) / l2));
    return Math.hypot(px - bx * t, py - by * t, pz - bz * t) - s.r;
  };
  const levels = COLUMN_LEVELS.map((l) => ({ l, inv: placement(l).clone().invert(), whole: null as Sdf | null }));
  const v = new THREE.Vector3();
  const scap = scapulaField();
  const hum = humerusField();
  const sac = sacrumField();
  const coc = coccyxField();
  const hip = hipBoneField();
  const field: Sdf = (x0, y, z) => {
    const x = Math.abs(x0);
    let d = 1;
    // Ribs, only the ones at this height.
    if (y > 0.02 && y < 0.33) {
      for (const s of ribs) {
        if (Math.abs(y - s.a[1]) > 0.09 && Math.abs(y - s.b[1]) > 0.09) continue;
        d = Math.min(d, segDist(s, x, y, z));
      }
    }
    // Vertebrae within reach of the height (a thoracic spinous process drops 4 cm below its body).
    if (x < 0.045) {
      for (const e of levels) {
        if (y > e.l.y + 0.03 || y < e.l.y - 0.065) continue;
        v.set(x0, y, z).applyMatrix4(e.inv);
        e.whole ??= vertebraParts(e.l).whole;
        d = Math.min(d, e.whole(v.x, v.y, v.z));
      }
    }
    if (y < SACRUM_TOP + 0.01 && y > -0.23 && x < 0.06) {
      d = Math.min(d, sac(x0, y - SACRAL_SHIFT, z), coc(x0, y - SACRAL_SHIFT, z));
    }
    if (y < -0.005 && y > -0.2 && x > 0.01) d = Math.min(d, hip(x, y - PELVIS_SHIFT, z));
    if (!girdle) return d;
    if (y > 0.14 && y < 0.3 && x > 0.04) d = Math.min(d, scap(x, y, z));
    if (y > 0.26 && y < 0.3 && x > 0.01) for (const s of clav) d = Math.min(d, segDist(s, x, y, z));
    if (y > 0.12 && y < 0.3 && x > 0.14) {
      d = Math.min(d, hum(x, y, z));
      for (const s of shaft) d = Math.min(d, segDist(s, x, y, z));
    }
    return d;
  };
  boneFields[girdle ? 'all' : 'deep'] = field;
  return field;
}

/* ------------------------------------------------------------------------------ landmarks */

const _v = new THREE.Vector3();
const levelOf = (name: string): Level => {
  const l = COLUMN_LEVELS.find((e) => e.name === name);
  if (!l) throw new Error(`back muscles: no vertebra ${name}`);
  return l;
};

/**
 * A point on the SPINOUS PROCESS of a vertebra, `f` of the way from its base (0) to its tip (1),
 * `lateral` metres to the patient's right of the midline: the vertebra's own shape and placement.
 */
export function spinous(name: string, f = 1, lateral = 0): V3 {
  const l = levelOf(name);
  const s = shapeOf(l);
  const a = s.canalR + s.archR + 0.0006;
  const baseZ = -(a + s.archR * 0.5);
  const tipZ = -(a + s.archR + s.spineLen);
  const r = s.archR * 0.85;
  const dz = tipZ - baseZ;
  const dy = -s.spineDrop;
  const len = Math.hypot(dz, dy) || 1;
  // At the tip the muscle meets the end of the process (one more radius along its own axis, except for a bifid tip, whose two
  // prongs leave the midline between them); along the shaft it meets the side of the process.
  const tipExtra = f >= 0.99 && !s.bifid ? r : 0;
  const x = lateral !== 0 && f < 0.99 ? r + 0.0002 : lateral;
  _v.set(x, dy * f + (dy / len) * tipExtra, baseZ + dz * f + (dz / len) * tipExtra).applyMatrix4(placement(l));
  return [_v.x, _v.y, _v.z];
}
/** The tip of the right TRANSVERSE PROCESS of a vertebra, `f` of the way out from the arch (the end of the process when f is 1). */
export function transverse(name: string, f = 1): V3 {
  const l = levelOf(name);
  const s = shapeOf(l);
  const a = s.canalR + s.archR + 0.0006;
  const z1 = l.kind === 'thoracic' ? -0.004 : 0.002;
  const len = Math.hypot(s.transLen, z1 - 0.002) || 1;
  const r = s.archR * 1.15;
  const extra = f >= 0.99 ? r : 0;
  _v.set(a + s.transLen * f + (s.transLen / len) * extra, 0, 0.002 + (z1 - 0.002) * f + ((z1 - 0.002) / len) * extra - (f < 0.99 ? r : 0)).applyMatrix4(placement(l));
  return [_v.x, _v.y, _v.z];
}
/** The angle of rib n (its most posterior curve) and its tubercle, right side, body frame. */
const RIB_R = 0.0038;
export const ribAngle = (n: number): V3 => { const p = ribPointsBody(n)[4]; return [p[0], p[1], p[2] - RIB_R]; };
export const ribTubercle = (n: number): V3 => { const p = ribPointsBody(n)[3]; return [p[0], p[1], p[2] - RIB_R]; };
/** A little lateral to the angle, where the slips of the lower ribs end. */
export const ribBeyondAngle = (n: number): V3 => { const p = ribPointsBody(n)[5]; return [p[0], p[1], p[2] - RIB_R * 0.7]; };

/** The back surface of the right scapular plate at (x, y), a coat of `off` metres behind it. */
export const scapBack = (x: number, y: number, off = 0): V3 => [x, y, scapulaZ(x, y) - SCAPULA_THICK / 2 - off];
/** The crest of the spine of the scapula at x (upper surface), standing 4.5 mm behind the plate as the bone's own ridge does. */
export const scapSpine = (x: number, up = 0.003): V3 => [x, spineY(x) + up, scapulaZ(x, spineY(x)) - 0.0045 - 0.0027];
/** The floor of the intertubercular sulcus of the humerus: the axis of the groove's cutter (shells/upper_limb_bones.ts SULCUS_A, SULCUS_B), at a height. */
export const sulcus = (y = 0.226): V3 => {
  const t = (0.247 - y) / (0.247 - 0.213);
  return [0.1685 + (0.1695 - 0.1685) * t, y, 0.0098 + (0.0088 - 0.0098) * t];
};
/** The iliac crest at wing coordinate s (the top of the plate's outline), outer lip, scene (the ilium is rigid in the pelvic group). */
export function iliacCrest(s: number): V3 {
  const top: [number, number][] = [[0, -0.052], [0.02, -0.04], [0.05, -0.03], [0.085, -0.032], [0.115, -0.045], [0.14, -0.058]];
  let y = top[0][1];
  for (let i = 0; i < top.length - 1; i++) {
    if (s >= top[i][0] && s <= top[i + 1][0]) y = top[i][1] + ((top[i + 1][1] - top[i][1]) * (s - top[i][0])) / (top[i + 1][0] - top[i][0]);
  }
  const p = wingPoint(s, y - 0.0005, 0.0055 + 0.0005);
  return [p[0], p[1] + PELVIS_SHIFT, p[2]];
}
/** The median sacral crest at height y (body), a point just behind the posterior wall of the sacrum, scene. */
export function sacralCrest(y: number, x = 0): V3 {
  const f = sacrumField();
  let z = -0.14;
  while (f(x, y, z) > 0 && z < 0) z += 0.0005;
  return [x, y + SACRAL_SHIFT, z - 0.0004];
}

/** Skull landmarks by marching a ray to the skull's own field (frame: scene y = local y + 0.48). */
const SKULL_Y = 0.48;
let skullField: Sdf | null = null;
function skullHit(from: V3, dir: V3): V3 {
  skullField ??= skullBone();
  const f = skullField;
  const p = new THREE.Vector3(from[0], from[1] - SKULL_Y, from[2]);
  const d = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
  // A fixed small step near the surface and a larger one far from it. (An earlier sphere trace that stepped by the field's own
  // value overshot the thin occipital shell and ran off to infinity: the skull's field is a hollow bone, not an exact distance.)
  for (let i = 0; i < 700; i++) {
    const s = f(p.x, p.y, p.z);
    if (s < 0) break;
    p.addScaledVector(d, Math.min(0.004, Math.max(0.0004, s * 0.4)));
  }
  return [p.x, p.y + SKULL_Y, p.z];
}
/** Occipital bone at (x, y): the back of the skull, found marching forward from behind. */
export const occiput = (x: number, y: number): V3 => skullHit([x, y, -0.15], [0, 0, 1]);
/** The right mastoid process, found marching in from the side at a height and depth. */
export const mastoid = (y: number, z: number): V3 => skullHit([0.12, y, z], [-1, 0, 0]);

/* ------------------------------------------------------------------ the trunk's cross-section */

interface RC { y: number; a: number; off: number }

/** Ring coordinates of a right-side point: height, angle round the cage ellipse, and signed distance outside it. */
export function ringCoords(p: V3): RC {
  const x = Math.abs(p[0]);
  const y = p[1];
  const z = p[2];
  const d2 = (a: number): number => {
    const [rx, rz] = trunkRing(y, a);
    return (x - rx) ** 2 + (z - rz) ** 2;
  };
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i <= 60; i++) {
    const v = d2((Math.PI * i) / 60);
    if (v < bd) { bd = v; best = i; }
  }
  let lo = Math.max(0, ((best - 1) * Math.PI) / 60);
  let hi = Math.min(Math.PI, ((best + 1) * Math.PI) / 60);
  for (let k = 0; k < 30; k++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (d2(m1) < d2(m2)) hi = m2; else lo = m1;
  }
  const a = (lo + hi) / 2;
  const [xs] = trunkRing(y, Math.PI / 2);
  const depth = z < 0 ? -trunkRing(y, 0)[1] : trunkRing(y, Math.PI)[1];
  const outside = (x / xs) ** 2 + (z / depth) ** 2 > 1;
  return { y, a, off: (outside ? 1 : -1) * Math.sqrt(d2(a)) };
}

/** The angle round the ring at which the ellipse is at lateral distance x (the right side). */
export function angleForX(y: number, x: number): number {
  let lo = 0;
  let hi = Math.PI / 2;
  const [xs] = trunkRing(y, Math.PI / 2);
  if (x >= xs) return Math.PI / 2;
  for (let k = 0; k < 30; k++) {
    const m = (lo + hi) / 2;
    if (trunkRing(y, m)[0] < x) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}

/**
 * How far outside the ring (metres) a muscle's CENTRE must stand at (y, a) to clear every bone by
 * `gap`: found by sphere-tracing inward from outside until the bones' field is `gap` away, as the
 * maximum over a small stencil so the muscle bridges the ridges of the ribs. `floor` is the least
 * allowed (the ribs' own radius for a muscle that lies on the cage).
 */
export function clearanceOff(y: number, a: number, gap: number, floor = 0.0036, girdle = true, dy = 0.006, da = 0.07): number {
  const sd = trunkBoneSd(girdle);
  let worst = floor;
  for (const sy of [-dy, 0, dy]) {
    for (const sa of [-da, 0, da]) {
      const yy = y + sy;
      const aa = Math.max(0, Math.min(Math.PI, a + sa));
      let off = 0.07;
      for (let it = 0; it < 14; it++) {
        const p = trunkPoint(1, yy, aa, off);
        const d = sd(p[0], p[1], p[2]);
        if (d - gap < 0.0002) break;
        off -= Math.max(0.0003, d - gap);
        if (off < floor) break;
      }
      worst = Math.max(worst, off);
    }
  }
  return worst;
}

export interface Anchor { p: V3; rc: RC }
/** A landmark with its ring coordinates; midline landmarks (x = 0) are given the angle 0 explicitly. */
export const anchor = (p: V3): Anchor => ({ p, rc: ringCoords(p) });

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface RailOptions {
  /** Clearance from the bones under the muscle's inner face (a ribbon passes its half-thickness). */
  gap?: number;
  /** Extra standoff for the muscles that lie over a deeper layer, as a function of the point's ring coordinates. */
  lift?: (rc: RC) => number;
  /** The least offset the muscle's inner face may have: the outer surface of a deeper muscle it lies over (0 where there is none). */
  above?: (rc: RC) => number;
  /** Least offset from the ring. */
  floor?: number;
  /** Points per rail beyond the first. */
  steps?: number;
  /** False for a muscle that lies deep to the shoulder girdle (the erector spinae under the scapula's reach): the scapula, clavicle and humerus are then not obstacles. */
  girdle?: boolean;
}

/**
 * ONE RAIL OF A MUSCLE: from landmark A to landmark B (right-side coordinates), `steps + 1` points. The ends are the
 * landmarks exactly. In between the point lies on the trunk's ellipse at the height and angle the
 * ends interpolate, pushed out by whichever is larger of the ends' interpolated offset (which keeps
 * the rail smooth into the landmark) and the clearance the bones demand, the two blended by
 * `smoothstep` so the rail meets each landmark without a kink.
 */
export function railPoints(A: Anchor, B: Anchor, o: RailOptions = {}): V3[] {
  const K = o.steps ?? 8;
  const gap = o.gap ?? 0.0005;
  const out: V3[] = [];
  for (let k = 0; k <= K; k++) {
    const t = k / K;
    if (k === 0) { out.push(A.p); continue; }
    if (k === K) { out.push(B.p); continue; }
    const y = A.rc.y + (B.rc.y - A.rc.y) * t;
    const a = A.rc.a + (B.rc.a - A.rc.a) * t;
    const lin = A.rc.off + (B.rc.off - A.rc.off) * t;
    const rc: RC = { y, a, off: lin };
    const w = smoothstep(0, 0.22, Math.min(t, 1 - t));
    const drape = Math.max(clearanceOff(y, a, gap, o.floor, o.girdle ?? true), o.above ? o.above(rc) : 0) + (o.lift ? o.lift(rc) * w : 0);
    out.push(trunkPoint(1, y, a, lin + (drape - lin) * w));
  }
  return out;
}

const onSide = (p: V3, side: number): V3 => [side * p[0], p[1], p[2]];

/**
 * A SHEET from a list of rails (right-side coordinates): a closed slab `thick` proud of the rails'
 * surface, mirrored to the given side. `across` points are bilinearly interpolated, so the sheet is
 * continuous between rails; `inside` is a point inside the trunk so the slab grows outward.
 */
export function sheet(rails: V3[][], side: number, thick: number, inside: V3 = [0, 0.1, -0.02]): THREE.BufferGeometry {
  const nu = rails.length - 1;
  const nv = rails[0].length - 1;
  const at = (u: number, v: number): V3 => {
    const fu = Math.min(nu - 1e-9, u * nu);
    const i = Math.floor(fu);
    const tu = fu - i;
    const fv = Math.min(nv - 1e-9, v * nv);
    const j = Math.floor(fv);
    const tv = fv - j;
    const g = (ii: number, jj: number): V3 => rails[ii][jj];
    const mix = (c: number): number =>
      (1 - tu) * ((1 - tv) * g(i, j)[c] + tv * g(i, j + 1)[c]) + tu * ((1 - tv) * g(i + 1, j)[c] + tv * g(i + 1, j + 1)[c]);
    return onSide([mix(0), mix(1), mix(2)], side);
  };
  return slab(at, thick, nu, nv, onSide(inside, side));
}

/**
 * A BELLY: a closed tube of ELLIPTICAL cross-section along a path, `rw(t)` half-width and `rt(t)`
 * half-thickness, the thin axis along `facing` (the direction the muscle's outer face looks). A
 * muscle belly with tendon at either end: the profile goes thin at the ends.
 */
export function belly(
  path: readonly V3[], rw: (t: number) => number, rt: (t: number) => number, facing: (p: THREE.Vector3) => THREE.Vector3,
  tubular = 12, radial = 8,
): THREE.BufferGeometry {
  const kept: V3[] = [];
  for (const p of path) {
    const q = kept[kept.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) > 0.0015) kept.push(p);
  }
  if (kept.length === 1) kept.push([kept[0][0], kept[0][1] + 0.001, kept[0][2]]);
  const curve = new THREE.CatmullRomCurve3(kept.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', 0.5);
  const pos: number[] = [];
  const idx: number[] = [];
  const T = new THREE.Vector3();
  const C = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    curve.getPointAt(t, C);
    curve.getTangentAt(t, T);
    const N = facing(C).clone();
    N.addScaledVector(T, -N.dot(T));
    if (N.lengthSq() < 1e-10) N.set(0, 0, -1).addScaledVector(T, T.z);
    N.normalize();
    const S = new THREE.Vector3().crossVectors(T, N).normalize();
    const w = Math.max(1e-4, rw(t));
    const th = Math.max(1e-4, rt(t));
    for (let j = 0; j < radial; j++) {
      const ph = (2 * Math.PI * j) / radial;
      pos.push(C.x + S.x * Math.cos(ph) * w + N.x * Math.sin(ph) * th, C.y + S.y * Math.cos(ph) * w + N.y * Math.sin(ph) * th, C.z + S.z * Math.cos(ph) * w + N.z * Math.sin(ph) * th);
    }
  }
  for (let i = 0; i < tubular; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const b = i * radial + ((j + 1) % radial);
      idx.push(a, b, b + radial, a, b + radial, a + radial);
    }
  }
  for (const [i, end] of [[0, 0], [tubular, 1]] as const) {
    curve.getPointAt(end, C);
    pos.push(C.x, C.y, C.z);
    const c = pos.length / 3 - 1;
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const b = i * radial + ((j + 1) % radial);
      if (end === 0) idx.push(c, b, a); else idx.push(c, a, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  orient(g);
  g.computeVertexNormals();
  return g;
}

/** A mirror image across the midline (x negated, triangles re-wound), for a muscle built once on the right. */
export function mirrorGeo(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const m = g.clone();
  const p = m.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setX(i, -p.getX(i));
  orient(m);
  m.computeVertexNormals();
  return m;
}

/**
 * LAST STEP FOR A MUSCLE'S SURFACE: move every vertex that lies inside a bone out along the bone field's gradient until it is
 * `margin` clear. The courses are cleared at their control points, but a tube or a sheet between two of them can still cut a corner
 * of a bone; this is what makes "no muscle passes through a bone" true of the mesh and not only of its guides. `yShift` is added to the
 * vertex's y before the field is read (a muscle authored in an organ frame that is offset from the field's frame).
 */
export function declip(g: THREE.BufferGeometry, sd: Sdf, margin = 0.0002, yShift = 0): THREE.BufferGeometry {
  const p = g.getAttribute('position');
  const e = 0.0005;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    for (let k = 0; k < 4; k++) {
      const d = sd(x, y + yShift, z) - margin;
      if (d >= 0) break;
      const gx = sd(x + e, y + yShift, z) - sd(x - e, y + yShift, z);
      const gy = sd(x, y + yShift + e, z) - sd(x, y + yShift - e, z);
      const gz = sd(x, y + yShift, z + e) - sd(x, y + yShift, z - e);
      const n = Math.hypot(gx, gy, gz) || 1;
      x -= (gx / n) * d; y -= (gy / n) * d; z -= (gz / n) * d;
    }
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

/** Wind the triangles so the signed volume is positive (outward faces). */
export function orient(g: THREE.BufferGeometry): void {
  const p = g.getAttribute('position');
  const idx = g.getIndex();
  if (!idx) return;
  let vol = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < idx.count; t += 3) {
    a.fromBufferAttribute(p, idx.getX(t));
    b.fromBufferAttribute(p, idx.getX(t + 1));
    c.fromBufferAttribute(p, idx.getX(t + 2));
    vol += a.dot(b.cross(c));
  }
  if (vol < 0) {
    for (let t = 0; t < idx.count; t += 3) {
      const s = idx.getX(t + 1);
      idx.setX(t + 1, idx.getX(t + 2));
      idx.setX(t + 2, s);
    }
  }
}

/** A belly's outline: tendon at each end (a fraction of the length), fusiform between. A drawing choice. */
export const fusiform = (t: number, a = 0.12, b = 0.12, tendon = 0.2): number => {
  if (t < a || t > 1 - b) return tendon;
  const s = (t - a) / (1 - a - b);
  // sin(pi) is a hair below zero in floating point at the far end of the belly, and a negative number has no real 0.6 power.
  return Math.max(tendon, Math.pow(Math.max(0, Math.sin(Math.PI * s)), 0.6));
};
/** Facing for a muscle on the back of the trunk: out and backward from the spine. */
export const backFacing = (p: THREE.Vector3): THREE.Vector3 => new THREE.Vector3(p.x * 0.6, 0, p.z + 0.02).normalize();

/** A ribbon belly along a rail made of two anchors: the middle follows the trunk. `w`, `t` are the peak half-width and half-thickness. */
export function ribbonBetween(
  A: Anchor, B: Anchor, w: number, t: number, o: RailOptions & { a?: number; b?: number; tendon?: number } = {}, mid: readonly V3[] = [],
): THREE.BufferGeometry {
  const pts = railPoints(A, B, { ...o, gap: o.gap ?? t + 0.0005, steps: o.steps ?? 8 });
  const path = mid.length ? [pts[0], ...mid, pts[pts.length - 1]] : pts;
  return belly(path, (u) => w * fusiform(u, o.a, o.b, o.tendon ?? 0.2), (u) => t * fusiform(u, o.a, o.b, o.tendon ?? 0.2), backFacing, Math.max(8, path.length), 6);
}

/**
 * A ribbon belly along a LANE: a path whose lateral distance from the midline is `x(y)` and whose
 * height runs through the given y values, laid on the trunk and clear of the bones.
 */
export function laneBelly(
  ys: readonly number[], x: (y: number) => number, w: (u: number) => number, t: (u: number) => number,
  o: { lift?: number; gap?: number; floor?: number; girdle?: boolean; ends?: { bottom?: V3; top?: V3 } } = {},
): THREE.BufferGeometry {
  const pts: V3[] = [];
  const tm = t(0.5);
  ys.forEach((y, i) => {
    const u = i / (ys.length - 1);
    const a = angleForX(y, x(y));
    const off = clearanceOff(y, a, (o.gap ?? 0.0005) + t(u), o.floor ?? 0.0036, o.girdle ?? false) + (o.lift ?? 0);
    pts.push(trunkPoint(1, y, a, off));
  });
  void tm;
  if (o.ends?.bottom) pts[0] = o.ends.bottom;
  if (o.ends?.top) pts[pts.length - 1] = o.ends.top;
  return belly(pts, w, t, backFacing, Math.max(10, Math.round(ys.length * 1.1)), 7);
}


/* ------------------------------------------------------------------------------ the muscles */

const A = (p: V3): Anchor => anchor(p);
/** A midline landmark: its ring angle is exactly the back midline. */
const M = (p: V3): Anchor => ({ p, rc: { ...ringCoords(p), a: 0 } });
/** The geometry and its mirror image, for a muscle built once on the right. */
const pair = (g: THREE.BufferGeometry): THREE.BufferGeometry[] => [g, mirrorGeo(g)];
const sides = (make: (side: number) => THREE.BufferGeometry[]): THREE.BufferGeometry[] => [...make(1), ...make(-1)];

/** The right clavicle's posterior face at fraction t of its length (body frame). */
function clavPost(t: number): V3 {
  const c = new THREE.CatmullRomCurve3(CLAVICLE_PTS.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', 0.5);
  const p = c.getPointAt(t);
  return [p.x, p.y + 0.001, p.z - 0.0045];
}

/** A fan of rails from origins to insertions: built once for the right side, drawn on both. */
function fan(origins: Anchor[], inserts: Anchor[], thick: number, o: RailOptions = {}): THREE.BufferGeometry[] {
  const rails = origins.map((a, i) => railPoints(a, inserts[i], o));
  return sides((s) => [sheet(rails, s, thick)]);
}

/** Over the rhomboids and the levator, a superficial sheet stands a layer proud; lateral to them it lies on the scapula. A layer is a drawing choice. */
const OVER_SCAPULA_LIFT = 0.003;
const liftOverScapula = (rc: RC): number => (rc.y > 0.15 && rc.y < 0.31 ? OVER_SCAPULA_LIFT * (1 - smoothstep(0.5, 0.9, rc.a)) : 0);

/**
 * THE ERECTOR SPINAE LAYER. Its half-thickness at height y (thicker over the lumbar gutter than
 * the thoracic one; a drawing choice) and the lateral extent of the gutter it fills: from beside the
 * spinous processes to the angles of the ribs in the chest, narrower in the loin. `erectorTop` is
 * the offset of its outer surface from the ring, so the muscles that lie over it (the serrati
 * posteriores, the rhomboids, the splenii, the latissimus, the trapezius and the fascia) are
 * laid on that surface and not through it.
 */
const erectorHalf = (y: number): number => 0.0035 + 0.0025 * (1 - smoothstep(0.0, 0.06, y));
const erectorEdge = (y: number): number => 0.072 + 0.025 * smoothstep(0.0, 0.06, y);
function erectorTop(rc: RC): number {
  if (rc.y > 0.33 || rc.y < -0.13) return 0;
  const x = trunkPoint(1, rc.y, rc.a, 0)[0];
  const edge = erectorEdge(rc.y);
  const f = smoothstep(0.003, 0.012, x) * (1 - smoothstep(edge - 0.008, edge + 0.004, x));
  if (f <= 0.001) return 0;
  const h = erectorHalf(rc.y);
  return f * (clearanceOff(rc.y, rc.a, h + 0.0005, 0.0036, false) + h + 0.0004);
}

/** The pieces of each LEAF muscle, keyed by the leaf's part id in src/data/anatomy/back_muscles.json. */
export function backMuscleLeaves(): Record<string, THREE.BufferGeometry[]> {
  const out: Record<string, THREE.BufferGeometry[]> = {};
  const sp = (n: string, f = 1, lat = 0): Anchor => (lat === 0 ? M(spinous(n, f)) : A(spinous(n, f, lat)));
  const eop = occiput(0, 0.412);

  /* ---- trapezius: three parts of one diamond; the superficial layer */
  out.trapezius_descending = fan(
    [M(eop), sp('C2'), sp('C4'), sp('C6'), sp('C7')],
    [0.6, 0.68, 0.76, 0.86, 0.96].map((t) => A(clavPost(t))),
    0.0035, { above: erectorTop, lift: liftOverScapula, steps: 10 },
  );
  out.trapezius_transverse = fan(
    [sp('C7'), sp('T1'), sp('T2'), sp('T3')],
    [A([0.1455, 0.2765, -0.0225]), A(scapSpine(0.126)), A(scapSpine(0.1)), A(scapSpine(0.076))],
    0.0035, { above: erectorTop, lift: liftOverScapula, steps: 10 },
  );
  out.trapezius_ascending = fan(
    ['T4', 'T6', 'T8', 'T10', 'T12'].map((n) => sp(n)),
    [0.068, 0.063, 0.059, 0.056, 0.053].map((x) => A(scapSpine(x))),
    0.0035, { above: erectorTop, lift: liftOverScapula, steps: 12 },
  );

  /* ---- latissimus dorsi: the broad sheet of the lower back and the flat tendon to the humerus */
  const apex: V3 = [0.151, 0.206, -0.04];
  const apexSpread = [-0.008, -0.004, 0, 0.004, 0.008].map((d): V3 => [apex[0] + d * 0.3, apex[1] + d, apex[2]]);
  const latOrigins: Anchor[] = [sp('T7'), sp('T9'), sp('T11'), sp('L2'), sp('L4'), M(sacralCrest(-0.12)), A(iliacCrest(0.045)), A(iliacCrest(0.085))];
  const latInserts = latOrigins.map((_, i) => A(apexSpread[Math.min(4, Math.floor((i * 5) / latOrigins.length))]));
  out.latissimus_dorsi = [
    ...fan(latOrigins, latInserts, 0.0035, { above: erectorTop, lift: () => 0.0025, steps: 12 }),
    ...sides((s) => [
      belly(
        ([apex, [0.1515, 0.214, -0.024], [0.155, 0.222, 0.0035], [0.1585, 0.2255, 0.0112], sulcus(0.226)] as V3[]).map((p) => onSide(p, s)),
        () => 0.0065, () => 0.0013, () => new THREE.Vector3(0, 0, -1), 12, 6,
      ),
    ]),
  ];

  /* ---- rhomboids: deep to the trapezius, from the spinous processes to the scapula's medial border */
  out.rhomboid_minor = fan([sp('C7'), sp('T1')], [A(scapBack(0.052, 0.2475, 0.0005)), A(scapBack(0.0515, 0.2435, 0.0005))], 0.003, { steps: 8, above: erectorTop });
  out.rhomboid_major = fan(
    [sp('T2'), sp('T3'), sp('T4'), sp('T5')],
    [0.2, 0.19, 0.178, 0.166].map((y, i) => A(scapBack(0.0505 + 0.0013 * i + 0.002, y, 0.0005))),
    0.003, { steps: 8, above: erectorTop },
  );

  /* ---- levator scapulae: four slips from the transverse processes of the upper cervical vertebrae to the scapula's superior angle and the medial border above the spine */
  const levIns: V3[] = [scapBack(0.053, 0.2615, 0.0005), scapBack(0.0515, 0.2575, 0.0005), scapBack(0.051, 0.2535, 0.0005), scapBack(0.0505, 0.2495, 0.0005)];
  out.levator_scapulae = ['C1', 'C2', 'C3', 'C4'].flatMap((n, i) => pair(ribbonBetween(A(transverse(n)), A(levIns[i]), 0.0042, 0.003, { steps: 8 })));

  /* ---- the two serrati posteriores: thin sheets, deep to the rhomboids and the latissimus */
  out.serratus_posterior_superior = fan(
    ['C7', 'T1', 'T2', 'T3'].map((n) => sp(n)),
    [2, 3, 4, 5].map((n) => A(ribBeyondAngle(n))),
    0.0022, { steps: 8, above: erectorTop },
  );
  out.serratus_posterior_inferior = fan(
    ['T11', 'T12', 'L1', 'L2'].map((n) => sp(n)),
    [9, 10, 11, 12].map((n) => A(ribBeyondAngle(n))),
    0.0022, { steps: 8, above: erectorTop },
  );

  /* ---- the splenii: deep to the trapezius, from the nuchal ligament and the upper thoracic spines to the skull and the cervical transverse processes */
  out.splenius_capitis = fan(
    [sp('C4'), sp('C6'), sp('C7'), sp('T1'), sp('T3')],
    [A(occiput(0.034, 0.4185)), A(occiput(0.046, 0.4185)), A(mastoid(0.4175, -0.054)), A(mastoid(0.4135, -0.05)), A(mastoid(0.4115, -0.046))],
    0.003, { steps: 10, above: erectorTop, lift: () => 0.002 },
  );
  out.splenius_cervicis = fan(
    [sp('T3'), sp('T5'), sp('T6')].map((a) => a),
    [A(transverse('C1')), A(transverse('C2')), A(transverse('C3'))],
    0.0028, { steps: 10, above: erectorTop, lift: () => 0.002 },
  );

  /* ---- the erector spinae: three columns in the gutter beside the spine */
  const lane = (pts: readonly (readonly [number, number])[]) => (y: number): number => {
    for (let i = 0; i < pts.length - 1; i++) {
      if (y >= pts[i][0] && y <= pts[i + 1][0]) return pts[i][1] + ((pts[i + 1][1] - pts[i][1]) * (y - pts[i][0])) / (pts[i + 1][0] - pts[i][0]);
    }
    return y < pts[0][0] ? pts[0][1] : pts[pts.length - 1][1];
  };
  const ys = (a: number, b: number, n: number): number[] => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
  const erT = (y0: number, y1: number, a: number, b: number) => (u: number): number => erectorHalf(y0 + (y1 - y0) * u) * fusiform(u, a, b, 0.3);
  out.iliocostalis = pair(laneBelly(
      ys(-0.065, 0.3254, 18), lane([[-0.07, 0.05], [0.0, 0.06], [0.07, 0.085], [0.2, 0.085], [0.28, 0.06], [0.33, 0.03]]),
      (u) => 0.011 * fusiform(u, 0.1, 0.12, 0.25), erT(-0.065, 0.3254, 0.1, 0.12),
      { ends: { bottom: iliacCrest(0.04), top: transverse('C6') } },
  ));
  out.longissimus = pair(laneBelly(
      ys(-0.12, 0.4, 26), lane([[-0.12, 0.012], [-0.03, 0.03], [0.1, 0.04], [0.3, 0.036], [0.4, 0.05]]),
      (u) => 0.0105 * fusiform(u, 0.08, 0.1, 0.22), erT(-0.12, 0.4, 0.08, 0.1),
      { ends: { bottom: sacralCrest(-0.1, 0.012), top: mastoid(0.4115, -0.046) } },
  ));
  out.spinalis = pair(laneBelly(
      ys(-0.03, 0.378, 16), () => 0.011, (u) => 0.0042 * fusiform(u, 0.1, 0.1, 0.3), (u) => 0.0038 * fusiform(u, 0.1, 0.1, 0.3),
      { ends: { bottom: spinous('L2', 0.8, 0.0045), top: spinous('C2', 0.8, 0.0035) } },
  ));

  /* ---- the deep (transversospinal) layer: semispinalis, multifidus, rotatores */
  out.semispinalis = pair(laneBelly(
    ys(0.14, 0.411, 16), lane([[0.14, 0.0266], [0.3, 0.02], [0.405, 0.018]]),
    (u) => (0.006 + 0.004 * u) * fusiform(u, 0.1, 0.1, 0.25), (u) => (0.0035 + 0.0025 * u) * fusiform(u, 0.1, 0.1, 0.3),
    { floor: -0.03, ends: { bottom: transverse('T8'), top: occiput(0.016, 0.411) } },
  ));
  out.multifidus = pair(laneBelly(
    ys(-0.12, 0.372, 24), () => 0.012, (u) => 0.0048 * fusiform(u, 0.06, 0.1, 0.3), (u) => 0.0036 * fusiform(u, 0.06, 0.1, 0.3),
    { floor: -0.03, ends: { bottom: sacralCrest(-0.1, 0.007), top: spinous('C2', 0.5, 0.0035) } },
  ));
  // Rotatores: short slips, each from a transverse process to the base of the spinous process of the vertebra above.
  out.rotatores = ['T12', 'T11', 'T10', 'T9', 'T8', 'T7', 'T6', 'T5', 'T4', 'T3', 'T2'].flatMap((n, i, all) => {
    void all;
    const upper = `T${12 - i - 1}`;
    return pair(belly([transverse(n, 0.8), spinous(upper, 0.2, 0.003)], () => 0.0026, () => 0.0022, backFacing, 3, 5));
  });
  // Interspinales: paired slips between the tips of adjacent spinous processes (cervical and lumbar regions).
  out.interspinales = [['C2', 'C3'], ['C3', 'C4'], ['C4', 'C5'], ['C5', 'C6'], ['C6', 'C7'], ['L1', 'L2'], ['L2', 'L3'], ['L3', 'L4'], ['L4', 'L5']].flatMap(([u, l]) =>
    pair(belly([spinous(u, 0.85, 0.0028), spinous(l, 0.85, 0.0028)], () => 0.0019, () => 0.0019, backFacing, 2, 5)),
  );
  // Intertransversarii: slips between the tips of adjacent transverse processes (cervical and lumbar).
  out.intertransversarii = [['C2', 'C3'], ['C3', 'C4'], ['C4', 'C5'], ['C5', 'C6'], ['C6', 'C7'], ['L1', 'L2'], ['L2', 'L3'], ['L3', 'L4'], ['L4', 'L5']].flatMap(([u, l]) =>
    pair(belly([transverse(u, 0.9), transverse(l, 0.9)], () => 0.0026, () => 0.0026, backFacing, 2, 5)),
  );

  /* ---- the suboccipital muscles: four short muscles between the atlas, the axis and the occiput */
  out.rectus_capitis_posterior_minor = pair(belly([spinous('C1', 1, 0.0015), occiput(0.009, 0.4045)], () => 0.0032 , () => 0.0022, backFacing, 5, 6));
  out.rectus_capitis_posterior_major = pair(belly([spinous('C2', 0.85, 0.0022), occiput(0.022, 0.4105)], () => 0.0045, () => 0.0028, backFacing, 5, 6));
  out.obliquus_capitis_inferior = pair(belly([spinous('C2', 0.8, 0.003), transverse('C1', 0.95)], () => 0.004, () => 0.0028, backFacing, 5, 6));
  out.obliquus_capitis_superior = pair(belly([transverse('C1', 0.95), occiput(0.04, 0.414)], () => 0.004, () => 0.0028, backFacing, 5, 6));

  /* ---- the thoracolumbar fascia: the posterior layer, a thin aponeurosis over the erector spinae from the spinous processes to the lateral raphe */
  const raphe = (y: number): Anchor => {
    const a = angleForX(y, 0.075);
    const off = clearanceOff(y, a, 0.0006, 0.0036) + 2 * erectorHalf(y) + 0.0005;
    return A(trunkPoint(1, y, a, off));
  };
  const fasciaRows = [spinous('T10'), spinous('T12'), spinous('L2'), spinous('L4'), sacralCrest(-0.125)];
  out.thoracolumbar_fascia = fan(fasciaRows.map((p) => M(p)), fasciaRows.map((p) => raphe(p[1])), 0.0013, { above: erectorTop, steps: 6 });

  // Every vertex clear of the bones (see `declip`); the girdle is included because a superficial muscle must clear the scapula too.
  const bonesAll = trunkBoneSd(true);
  for (const gs of Object.values(out)) for (const g of gs) declip(g, bonesAll);
  return out;
}

/** The hierarchy of the atlas (child to parent), as src/data/anatomy/back_muscles.json declares it. */
export const BACK_PARENT: Readonly<Record<string, string>> = {
  trapezius_descending: 'trapezius', trapezius_transverse: 'trapezius', trapezius_ascending: 'trapezius',
  rhomboid_minor: 'rhomboid_muscles', rhomboid_major: 'rhomboid_muscles',
  iliocostalis: 'erector_spinae', longissimus: 'erector_spinae', spinalis: 'erector_spinae',
  transversospinales: 'deep_back_muscles', interspinales: 'deep_back_muscles', intertransversarii: 'deep_back_muscles',
  semispinalis: 'transversospinales', multifidus: 'transversospinales', rotatores: 'transversospinales',
  rectus_capitis_posterior_major: 'suboccipital_muscles', rectus_capitis_posterior_minor: 'suboccipital_muscles',
  obliquus_capitis_superior: 'suboccipital_muscles', obliquus_capitis_inferior: 'suboccipital_muscles',
};

/** Every part's geometry, a parent being the union of its children (the same geometry, so that a parent shown alone is the whole muscle). */
export function backMuscleMap(): Record<string, THREE.BufferGeometry[]> {
  const leaves = backMuscleLeaves();
  const out: Record<string, THREE.BufferGeometry[]> = { ...leaves };
  const add = (id: string, from: string[]): void => {
    out[id] = from.flatMap((c) => out[c]);
  };
  add('trapezius', ['trapezius_descending', 'trapezius_transverse', 'trapezius_ascending']);
  add('rhomboid_muscles', ['rhomboid_major', 'rhomboid_minor']);
  add('erector_spinae', ['iliocostalis', 'longissimus', 'spinalis']);
  add('transversospinales', ['semispinalis', 'multifidus', 'rotatores']);
  add('deep_back_muscles', ['transversospinales', 'interspinales', 'intertransversarii']);
  add('suboccipital_muscles', ['rectus_capitis_posterior_major', 'rectus_capitis_posterior_minor', 'obliquus_capitis_superior', 'obliquus_capitis_inferior']);
  return out;
}

/** The geometry of each LEVEL-1 part with its children merged, keyed by the part's id: what the shell is made of. */
export function backMuscleGroups(): Record<string, THREE.BufferGeometry[]> {
  const all = backMuscleMap();
  const top = [
    'trapezius', 'latissimus_dorsi', 'rhomboid_muscles', 'levator_scapulae', 'serratus_posterior_superior', 'serratus_posterior_inferior',
    'splenius_capitis', 'splenius_cervicis', 'erector_spinae', 'deep_back_muscles', 'suboccipital_muscles', 'thoracolumbar_fascia',
  ];
  return Object.fromEntries(top.map((id) => [id, all[id]]));
}

export function backMuscles(): THREE.BufferGeometry {
  return mergeParts(Object.values(backMuscleGroups()).flat());
}
