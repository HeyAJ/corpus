import * as THREE from 'three';
import { chain, mergeParts, type Sdf, type V3 } from '../sdf';
import {
  CLAVICLE_PTS, CONDYLES, GLENOID_CENTRE, HEAD, HEAD_R, HUMERUS_MAX, HUMERUS_MIN, HUMERUS_SHAFT_R, SCAPULA_MAX,
  SCAPULA_MIN, SCAPULA_THICK, SHAFT_PTS, SOCKET_DIR, humerusField, scapulaField, scapulaZ, spineY,
} from './upper_limb_bones';
import { ribPointsBody } from './thoracic_cage';

/**
 * SHOULDER AND UPPER ARM MUSCLES: THE SHELL, AND THE GEOMETRY THE INTERIOR SHARES. A LAYER organ of
 * the muscles layer, in the thoracic group.
 *
 * FRAME. Origin organs.json [0, 0.2, 0], the shoulder and arm bones' own origin, because every
 * muscle here wraps or joins those bones; the thoracic group has no exploded-stack offset. Every
 * muscle is AUTHORED IN BODY COORDINATES FOR THE PATIENT'S RIGHT SIDE (+x), exactly as the bones
 * are, and the left is the same shape mirrored in x. An attachment is therefore written as the
 * bone's own number and can be compared with it.
 *
 * WHERE EACH MUSCLE GOES, AND HOW IT IS KEPT HONEST. A landmark is never typed in by eye: it is a
 * rough guess (the bone's own parameters, such as the greater tubercle's centre plus an offset
 * towards the facet Gray's names) that `surfacePoint` snaps to the nearest point of THIS
 * skeleton's surface (`BONES`, the union of the scapula, humerus, clavicle and the upper ribs). A
 * belly is a flattened tube or a sheet that leaves that landmark and runs to the next one.
 * AFTER the shape is built, `clearOf` pushes every vertex that lies inside any bone out to
 * `BONE_MARGIN` along the bone's own gradient, so no muscle passes through bone by construction;
 * the size of that push is a measure of how good the route was (`BUILD_STATS` records the worst
 * raw penetration per part before the push, printed by the attachment probe). WHAT WENT WRONG
 * BEFORE: the stub placed spindles by eye at the right height and several of them stood inside
 * the humerus's tuberosity; a route that is checked only by looking passes every time.
 *
 * LAYERS, from Gray's. The deltoid is the outermost muscle of the shoulder, a sheet over the
 * humeral head and the greater tubercle; under it the four muscles of the rotator cuff end in
 * tendons that blend into the joint capsule round the head (drawn as a thin cap, the parent of
 * the four); the biceps lies over the brachialis on the front of the arm, the coracobrachialis
 * medial to it, and the triceps behind the humerus with its medial head deepest.
 *
 * THE GLASS ARM. The figure's arm is narrow (x 0.20 at the shoulder) and ends at the elbow, so
 * the biceps, brachialis and triceps are slim and end where the humerus's condyles end. The
 * radius and ulna are not in this skeleton, so the biceps tendon (radial tuberosity), the
 * brachialis (coronoid process and ulnar tuberosity) and the triceps (olecranon) end in a short
 * tendon at the elbow instead of on a bone, and say so in their summaries. The forearm and hand
 * muscles are not drawn. The pectoralis major's humeral insertion (the chest wall organ's
 * muscle), the latissimus dorsi's (the back organ's) and the trapezius (the back and neck
 * organs') are not drawn here.
 *
 * Every radius, thickness and offset below is a DRAWING choice made to fit this body's shallow
 * arm and to clear its bones; none is a measured muscle size.
 */

export const ORIGIN: V3 = [0, 0.2, 0];
const T = SCAPULA_THICK;

/* ------------------------------------------------------------------ the skeleton, as one field */

/** Bound a field in a box: outside the box (plus a pad) the distance to the box is a safe lower bound, so a far point costs nothing. */
function boxed(f: Sdf, lo: V3, hi: V3, pad = 0.02): Sdf {
  return (x, y, z) => {
    const dx = Math.max(lo[0] - x, 0, x - hi[0]);
    const dy = Math.max(lo[1] - y, 0, y - hi[1]);
    const dz = Math.max(lo[2] - z, 0, z - hi[2]);
    const out = Math.hypot(dx, dy, dz);
    return out > pad ? out : f(x, y, z);
  };
}

/** The right clavicle as a chain of capsules along its own curve, with the radius `clavicleRadius` of the bones file gives (slightly generous). */
function clavicleField(): Sdf {
  const curve = new THREE.CatmullRomCurve3(CLAVICLE_PTS.map((p) => new THREE.Vector3(...p)), false, 'catmullrom', 0.5);
  const pts: V3[] = [];
  const radii: number[] = [];
  for (let k = 0; k <= 24; k++) {
    const t = k / 24;
    const p = curve.getPointAt(t);
    pts.push([p.x, p.y, p.z]);
    radii.push(t < 0.12 ? 0.0062 - 0.02 * t : t < 0.85 ? 0.0042 : 0.0042 + 0.012 * (t - 0.85));
  }
  return chain(pts, radii);
}

/** Ribs 1 to 9 of the right side: the cage that the scapula's front and the subscapularis lie against. */
function ribsField(): Sdf {
  const fields: Sdf[] = [];
  for (let n = 1; n <= 9; n++) fields.push(chain(ribPointsBody(n), 0.0038));
  return (x, y, z) => {
    let d = Infinity;
    for (const f of fields) d = Math.min(d, f(x, y, z));
    return d;
  };
}

let bonesCache: Sdf | null = null;
/** The right shoulder girdle, humerus and upper ribs, negative inside bone. */
export function BONES(): Sdf {
  if (bonesCache) return bonesCache;
  const scapula = boxed(scapulaField(), SCAPULA_MIN, SCAPULA_MAX);
  const humerus = boxed(humerusField(), HUMERUS_MIN, HUMERUS_MAX);
  const clavicle = boxed(clavicleField(), [0.01, 0.268, -0.02], [0.16, 0.298, 0.06]);
  const ribs = boxed(ribsField(), [0, 0.0, -0.13], [0.15, 0.31, 0.12]);
  bonesCache = (x, y, z) => Math.min(scapula(x, y, z), humerus(x, y, z), clavicle(x, y, z), ribs(x, y, z));
  return bonesCache;
}

const EPS = 0.0003;
function gradient(f: Sdf, p: V3): V3 {
  const gx = f(p[0] + EPS, p[1], p[2]) - f(p[0] - EPS, p[1], p[2]);
  const gy = f(p[0], p[1] + EPS, p[2]) - f(p[0], p[1] - EPS, p[2]);
  const gz = f(p[0], p[1], p[2] + EPS) - f(p[0], p[1], p[2] - EPS);
  const n = Math.hypot(gx, gy, gz) || 1;
  return [gx / n, gy / n, gz / n];
}

/** The nearest point of the bone surface to `guess`, found by walking down the field's gradient. */
export function surfacePoint(guess: V3): V3 {
  const f = BONES();
  let p: V3 = guess;
  for (let i = 0; i < 12; i++) {
    const d = f(p[0], p[1], p[2]);
    if (Math.abs(d) < 0.00005) break;
    const n = gradient(f, p);
    p = [p[0] - n[0] * d, p[1] - n[1] * d, p[2] - n[2] * d];
  }
  return p;
}

/** A point `off` metres outside the bone surface nearest to `guess`. */
export function above(guess: V3, off: number): V3 {
  const s = surfacePoint(guess);
  const n = gradient(BONES(), s);
  return [s[0] + n[0] * off, s[1] + n[1] * off, s[2] + n[2] * off];
}

/** How far a muscle's vertices are kept from bone, metres: a hair, so a muscle reads as lying ON the bone it attaches to. A display choice. */
export const BONE_MARGIN = 0.0003;

/** Push every vertex that lies inside bone (or nearer than the margin) out along the field's gradient. Returns the worst raw penetration, metres (0 when none). */
export function clearOf(g: THREE.BufferGeometry, field: Sdf = BONES(), margin = BONE_MARGIN): number {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  let worst = 0;
  for (let i = 0; i < pos.count; i++) {
    let p: V3 = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const d0 = field(p[0], p[1], p[2]);
    if (d0 >= margin) continue;
    if (-d0 > worst) worst = -d0;
    for (let k = 0; k < 8; k++) {
      const d = field(p[0], p[1], p[2]);
      if (d >= margin) break;
      const n = gradient(field, p);
      const push = margin - d + 0.00002;
      p = [p[0] + n[0] * push, p[1] + n[1] * push, p[2] + n[2] * push];
    }
    pos.setXYZ(i, p[0], p[1], p[2]);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return worst;
}

/* ------------------------------------------------------------------ the humerus's own numbers */

/** Centre and radius of the humeral shaft at height y, from the bone file's own centreline and radii (the shaft only, y 0.1885 to 0.2325). */
export function shaftAt(y: number): { c: V3; r: number } {
  const n = SHAFT_PTS.length;
  for (let i = 0; i < n - 1; i++) {
    const a = SHAFT_PTS[i];
    const b = SHAFT_PTS[i + 1];
    if (y <= a[1] && y >= b[1]) {
      const t = (a[1] - y) / (a[1] - b[1]);
      return {
        c: [a[0] + (b[0] - a[0]) * t, y, a[2] + (b[2] - a[2]) * t],
        r: HUMERUS_SHAFT_R[i] + (HUMERUS_SHAFT_R[i + 1] - HUMERUS_SHAFT_R[i]) * t,
      };
    }
  }
  const e = y > SHAFT_PTS[0][1] ? 0 : n - 1;
  return { c: [SHAFT_PTS[e][0], y, SHAFT_PTS[e][2]], r: HUMERUS_SHAFT_R[e] };
}

/** A point beside the shaft at height y, in the direction (dx, dz) of the horizontal plane (+x lateral, +z anterior), `off` outside the shaft's surface. */
export function aroundShaft(y: number, dx: number, dz: number, off: number): V3 {
  const { c, r } = shaftAt(y);
  const n = Math.hypot(dx, dz) || 1;
  return [c[0] + (dx / n) * (r + off), y, c[2] + (dz / n) * (r + off)];
}

/** A point on the back of the scapular plate at (x, y): the plate's mid-surface less half its thickness. */
export const plateBack = (x: number, y: number): V3 => [x, y, scapulaZ(x, y) - T / 2];
/** A point on the front of the plate at (x, y). */
export const plateFront = (x: number, y: number): V3 => [x, y, scapulaZ(x, y) + T / 2];

/* ------------------------------------------------------------------ geometry builders */

/** A piecewise profile: (t, value) control points, interpolated with a smoothstep between them. */
export type Prof = readonly (readonly [number, number])[];
export function prof(p: Prof): (t: number) => number {
  return (t) => {
    if (t <= p[0][0]) return p[0][1];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i];
      const b = p[i + 1];
      if (t <= b[0]) {
        const u = (t - a[0]) / (b[0] - a[0] || 1);
        const s = u * u * (3 - 2 * u);
        return a[1] + (b[1] - a[1]) * s;
      }
    }
    return p[p.length - 1][1];
  };
}

/** Flip a closed mesh's winding when its signed volume is negative, so it is never drawn inside out. */
export function orient(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const idx = g.getIndex();
  if (!idx) return g;
  let volume = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let t = 0; t < idx.count; t += 3) {
    a.fromBufferAttribute(pos, idx.getX(t));
    b.fromBufferAttribute(pos, idx.getX(t + 1));
    c.fromBufferAttribute(pos, idx.getX(t + 2));
    volume += a.dot(b.cross(c));
  }
  if (volume < 0) {
    for (let t = 0; t < idx.count; t += 3) {
      const i1 = idx.getX(t + 1);
      idx.setX(t + 1, idx.getX(t + 2));
      idx.setX(t + 2, i1);
    }
  }
  g.computeVertexNormals();
  return g;
}

export interface TubeSpec {
  path: readonly V3[];
  /** Half-width across the muscle (along the second axis of the cross-section), by fraction along the path. */
  width: (t: number) => number;
  /** Half-thickness along the facing direction, by fraction along the path. */
  thick: (t: number) => number;
  /** Which way the thin axis points at a point (a flat muscle lies with its thin side against the bone). Default: a round section. */
  facing?: (p: V3) => V3;
  tubular?: number;
  radial?: number;
}

/**
 * A MUSCLE BELLY: an elliptical tube along a smooth path with a width and a thickness that vary
 * along it (a spindle, a strap, a tendon), closed at both ends by a fan to the path's end
 * points, so the end of the muscle is exactly the landmark it was routed to.
 */
export function muscleTube(spec: TubeSpec): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(spec.path.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', 0.5);
  const tubular = spec.tubular ?? 14;
  const radial = spec.radial ?? 8;
  const pos: number[] = [];
  const idx: number[] = [];
  const P = new THREE.Vector3();
  const Tn = new THREE.Vector3();
  const N = new THREE.Vector3();
  const B = new THREE.Vector3();
  let last = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    curve.getPointAt(t, P);
    curve.getTangentAt(t, Tn);
    const hint = spec.facing ? spec.facing([P.x, P.y, P.z]) : [last.x, last.y, last.z];
    N.set(hint[0], hint[1], hint[2]);
    N.sub(Tn.clone().multiplyScalar(N.dot(Tn)));
    if (N.lengthSq() < 1e-10) N.set(0, 0, 1).sub(Tn.clone().multiplyScalar(Tn.z));
    N.normalize();
    last = N.clone();
    B.crossVectors(Tn, N).normalize();
    const w = Math.max(1e-5, spec.width(t));
    const h = Math.max(1e-5, spec.thick(t));
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      pos.push(
        P.x + N.x * h * Math.cos(a) + B.x * w * Math.sin(a),
        P.y + N.y * h * Math.cos(a) + B.y * w * Math.sin(a),
        P.z + N.z * h * Math.cos(a) + B.z * w * Math.sin(a),
      );
    }
  }
  for (let i = 0; i < tubular; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const b = i * radial + ((j + 1) % radial);
      const c = (i + 1) * radial + ((j + 1) % radial);
      const d = (i + 1) * radial + j;
      idx.push(a, b, c, a, c, d);
    }
  }
  const s = curve.getPointAt(0);
  const e = curve.getPointAt(1);
  const si = pos.length / 3;
  pos.push(s.x, s.y, s.z);
  const ei = si + 1;
  pos.push(e.x, e.y, e.z);
  for (let j = 0; j < radial; j++) {
    const jn = (j + 1) % radial;
    idx.push(si, jn, j);
    idx.push(ei, tubular * radial + j, tubular * radial + jn);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return orient(g);
}

/**
 * A SHEET with thickness over a parametric surface: `point(u, v)` is the inner face (u across,
 * v along, both 0..1); the sheet stands `thick` outside it, on the side away from `away`.
 * Four edge strips close it. The deltoid and the cuff's cap are sheets.
 */
export function sheet(point: (u: number, v: number) => V3, thick: number, nu: number, nv: number, away: V3): THREE.BufferGeometry {
  const e = 0.01;
  const Pt = (u: number, v: number): THREE.Vector3 => {
    const p = point(Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v)));
    return new THREE.Vector3(p[0], p[1], p[2]);
  };
  const normalAt = (u: number, v: number): THREE.Vector3 => {
    const du = Pt(u + e, v).sub(Pt(u - e, v));
    const dv = Pt(u, v + e).sub(Pt(u, v - e));
    const n = new THREE.Vector3().crossVectors(du, dv).normalize();
    // The outward side is the one facing away from the point `away` (inside whatever the sheet wraps).
    const out = Pt(u, v).sub(new THREE.Vector3(away[0], away[1], away[2]));
    return out.dot(n) < 0 ? n.negate() : n;
  };
  const pos: number[] = [];
  const idx: number[] = [];
  const inner: number[][] = [];
  const outer: number[][] = [];
  for (let j = 0; j <= nv; j++) {
    inner.push([]);
    outer.push([]);
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const v = j / nv;
      const p = Pt(u, v);
      const n = normalAt(u, v).multiplyScalar(thick);
      pos.push(p.x, p.y, p.z);
      inner[j].push(pos.length / 3 - 1);
      pos.push(p.x + n.x, p.y + n.y, p.z + n.z);
      outer[j].push(pos.length / 3 - 1);
    }
  }
  const quad = (a: number, b: number, c: number, d: number): void => {
    idx.push(a, b, c, a, c, d);
  };
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      quad(outer[j][i], outer[j][i + 1], outer[j + 1][i + 1], outer[j + 1][i]);
      quad(inner[j][i], inner[j + 1][i], inner[j + 1][i + 1], inner[j][i + 1]);
    }
  }
  for (let i = 0; i < nu; i++) {
    quad(inner[0][i], inner[0][i + 1], outer[0][i + 1], outer[0][i]);
    quad(outer[nv][i], outer[nv][i + 1], inner[nv][i + 1], inner[nv][i]);
  }
  for (let j = 0; j < nv; j++) {
    quad(outer[j][0], outer[j + 1][0], inner[j + 1][0], inner[j][0]);
    quad(inner[j][nu], inner[j + 1][nu], outer[j + 1][nu], outer[j][nu]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return orient(g);
}

/** Reflect a right-side geometry in x (the left side), restoring its winding. */
export function mirrorX(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const m = g.clone();
  const pos = m.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setX(i, -pos.getX(i));
  const idx = m.getIndex();
  if (idx) {
    for (let t = 0; t < idx.count; t += 3) {
      const b = idx.getX(t + 1);
      idx.setX(t + 1, idx.getX(t + 2));
      idx.setX(t + 2, b);
    }
  }
  m.computeVertexNormals();
  return m;
}

/** Take a body-frame geometry into the organ's own frame. */
export function toLocal(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.translate(-ORIGIN[0], -ORIGIN[1], -ORIGIN[2]);
  return g;
}

const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale3 = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const unit3 = (a: V3): V3 => {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};

/* ------------------------------------------------------------------ the landmarks (this skeleton's own surface) */

/**
 * Each landmark below is a rough guess taken from a bone's own parameters, snapped onto the bone
 * surface. The guess says WHICH region Gray's names (the superior facet of the greater tubercle,
 * the infraglenoid tubercle); the snap makes it a point on THIS bone.
 */
const GREATER_TUBERCLE: V3 = [0.1705, 0.2405, -0.011];
const LESSER_TUBERCLE: V3 = [0.1625, 0.2385, 0.0085];
const GLENOID_TOP: V3 = [GLENOID_CENTRE[0] - 0.0012, GLENOID_CENTRE[1] + 0.0132, GLENOID_CENTRE[2] + 0.0006];
const GLENOID_BOTTOM: V3 = [GLENOID_CENTRE[0] - 0.0012, GLENOID_CENTRE[1] - 0.0132, GLENOID_CENTRE[2] - 0.0012];
const CORACOID_TIP: V3 = [0.1455, 0.2585, 0.022];

export interface Landmark {
  muscle: string;
  end: 'origin' | 'insertion';
  what: string;
  point: V3;
}
/** Every attachment on a drawn bone, for the attachment probe (the distance from each to the nearest vertex of its muscle must be at most 3 mm). */
export const ATTACHMENTS: Landmark[] = [];
function mark(muscle: string, end: Landmark['end'], what: string, guess: V3): V3 {
  const p = surfacePoint(guess);
  // Each part is built once per call and a sheet's landmark is asked for more than once: record it once.
  if (!ATTACHMENTS.some((a) => a.muscle === muscle && a.what === what)) ATTACHMENTS.push({ muscle, end, what, point: p });
  return p;
}
/** Per-part numbers the probes print: the worst raw bone penetration before clearing, and how many vertices were moved. */
export const BUILD_STATS: Record<string, { worstRawPenetration_m: number; triangles: number }> = {};

/* ------------------------------------------------------------------ the muscles (right side, body frame) */

type Builder = () => THREE.BufferGeometry[];

/** A flat muscle's thin axis points away from the plate's front, towards its back (-z), until it nears the head, where it turns radial. */
const backFacing = (p: V3): V3 => {
  const s = Math.min(1, Math.max(0, (p[0] - 0.118) / 0.03));
  const radial = unit3(sub3(p, HEAD));
  return unit3([radial[0] * s, radial[1] * s, -(1 - s) + radial[2] * s]);
};
const frontFacing = (p: V3): V3 => {
  const s = Math.min(1, Math.max(0, (p[0] - 0.118) / 0.03));
  const radial = unit3(sub3(p, HEAD));
  return unit3([radial[0] * s, radial[1] * s, (1 - s) + radial[2] * s]);
};
const radialFacing = (p: V3): V3 => unit3(sub3(p, HEAD));

/** Deltoid origin: the lateral third of the clavicle (front), the acromion (middle) and the spine of the scapula (back), as an ordered line from front to back. */
function deltoidOrigins(): { line: V3[]; cuts: [number, number] } {
  const curve = new THREE.CatmullRomCurve3(CLAVICLE_PTS.map((p) => new THREE.Vector3(...p)), false, 'catmullrom', 0.5);
  const line: V3[] = [];
  for (const t of [0.6, 0.7, 0.8, 0.9, 0.97]) {
    const c = curve.getPointAt(t);
    line.push(surfacePoint([c.x, c.y + 0.004, c.z]));
  }
  const nClav = line.length;
  // The acromion's outer margin, from its tip back to where it joins the spine.
  for (const g of [[0.1555, 0.2765, -0.0105], [0.1515, 0.2725, -0.019], [0.1445, 0.2655, -0.0235]] as V3[]) line.push(surfacePoint(g));
  const nAcro = line.length;
  // The spine's lower lip, lateral to medial.
  for (const x of [0.122, 0.108, 0.094, 0.08, 0.066]) {
    const y = spineY(x);
    line.push(surfacePoint([x, y - 0.003, scapulaZ(x, y) - 0.0045 - 0.0015]));
  }
  return { line, cuts: [(nClav - 0.5) / (line.length - 1), (nAcro - 0.5) / (line.length - 1)] };
}

function deltoidSheet(u0: number, u1: number, thick: number, nu: number): THREE.BufferGeometry {
  const { line } = deltoidOrigins();
  const curve = new THREE.CatmullRomCurve3(line.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
  const tub = mark('deltoid', 'insertion', 'deltoid tuberosity of the humerus', [0.186, 0.188, 0.002]);
  return sheet(
    (u, v) => {
      const uu = u0 + (u1 - u0) * u;
      const o = curve.getPointAt(uu);
      const O: V3 = [o.x, o.y, o.z];
      // The insertion is a short ridge, so the sheet ends as a band and not as a point.
      const T: V3 = [tub[0], tub[1] + 0.006 * (0.5 - uu), tub[2] + 0.0012 * (0.5 - uu)];
      const dir = unit3(add3(scale3(unit3(sub3(O, HEAD)), 0.5), [0.45, 0.1, 0]));
      const C = add3(HEAD, scale3(dir, 0.04));
      const a = (1 - v) * (1 - v);
      const b = 2 * (1 - v) * v;
      const c = v * v;
      return [a * O[0] + b * C[0] + c * T[0], a * O[1] + b * C[1] + c * T[1], a * O[2] + b * C[2] + c * T[2]];
    },
    thick,
    nu,
    8,
    HEAD,
  );
}

/** The cuff's cap: a thin sleeve over the head where the four tendons blend into the capsule. */
function cuffCap(): THREE.BufferGeometry {
  const az = Math.atan2(SOCKET_DIR[2], SOCKET_DIR[0]);
  return sheet(
    (u, v) => {
      const phi = az - 1.7 + 3.4 * u;
      const theta = -0.3 + 1.5 * v;
      const R = HEAD_R + 0.0016;
      return [HEAD[0] + R * Math.cos(theta) * Math.cos(phi), HEAD[1] + R * Math.sin(theta), HEAD[2] + R * Math.cos(theta) * Math.sin(phi)];
    },
    0.0028,
    18,
    8,
    HEAD,
  );
}

/** The biceps axis at height y: in front of the shaft, a little medial, standing off by the brachialis's thickness. */
export const bicepsAxis = (y: number, lateral = 0): V3 => {
  const { c, r } = shaftAt(y);
  return [c[0] - 0.0028 + lateral, y, c[2] + r + 0.0052 + 0.0095];
};
/** Heights of the biceps belly's centreline control points, and its radius along it (a drawing choice that fits the glass arm). Shared with the interior, which places the magnified schematics inside it. */
export const BICEPS_YS = [0.2105, 0.195, 0.175, 0.155, 0.14, 0.1345];
export const BICEPS_RADIUS = prof([[0, 0.0016], [0.2, 0.0074], [0.55, 0.0096], [0.85, 0.0074], [1, 0.0022]]);
/** How far inside the biceps belly a body-frame point is: negative inside (the distance to the axis less the belly's radius there). Used to check that the schematics lie inside the muscle. */
export function bicepsInside(p: V3): number {
  const curve = new THREE.CatmullRomCurve3(BICEPS_YS.map((y) => new THREE.Vector3(...bicepsAxis(y))), false, 'catmullrom', 0.5);
  let best = Infinity;
  let bt = 0;
  for (let k = 0; k <= 120; k++) {
    const q = curve.getPointAt(k / 120);
    const d = Math.hypot(q.x - p[0], q.y - p[1], q.z - p[2]);
    if (d < best) {
      best = d;
      bt = k / 120;
    }
  }
  return best - BICEPS_RADIUS(bt);
}

/** The triceps axis at height y: behind the shaft. */
const tricepsAxis = (y: number, lateral = 0): V3 => {
  const { c, r } = shaftAt(y);
  return [c[0] - 0.0015 + lateral, y, c[2] - r - 0.0102];
};

const BUILDERS: Record<string, Builder> = {
  deltoid: () => [deltoidSheet(0, 1, 0.0075, 22)],
  deltoid_anterior: () => [deltoidSheet(0, 0.3, 0.0055, 8)],
  deltoid_middle: () => [deltoidSheet(0.3, 0.62, 0.0055, 8)],
  deltoid_posterior: () => [deltoidSheet(0.62, 1, 0.0055, 10)],

  rotator_cuff: () => [cuffCap()],

  supraspinatus: () => {
    const a = above(plateBack(0.064, 0.2575), 0.0022);
    const b = above(plateBack(0.095, 0.259), 0.0024);
    const end = mark('supraspinatus', 'insertion', 'superior facet of the greater tubercle', add3(GREATER_TUBERCLE, [-0.003, 0.0098, 0]));
    mark('supraspinatus', 'origin', 'supraspinous fossa (medial part)', plateBack(0.064, 0.2575));
    const neck = above(lerp3(b, end, 0.62), 0.0030);
    const endUp = above(end, 0.0006);
    return [muscleTube({
      path: [above(plateBack(0.064, 0.2575), 0.0006), a, b, neck, endUp],
      width: prof([[0, 0.0075], [0.35, 0.0085], [0.7, 0.0045], [1, 0.0019]]),
      thick: prof([[0, 0.0016], [0.3, 0.0034], [0.72, 0.0026], [1, 0.0014]]),
      facing: backFacing,
      tubular: 16,
    })];
  },
  infraspinatus: () => {
    const o = mark('infraspinatus', 'origin', 'infraspinous fossa (medial part)', plateBack(0.082, 0.208));
    const a = above(o, 0.0006);
    const b = above(plateBack(0.108, 0.222), 0.0024);
    const end = mark('infraspinatus', 'insertion', 'middle facet of the greater tubercle', add3(GREATER_TUBERCLE, [0.003, 0.003, -0.0072]));
    const neck = above(lerp3(b, end, 0.6), 0.0028);
    return [muscleTube({
      path: [a, above(plateBack(0.095, 0.214), 0.0025), b, neck, above(end, 0.0006)],
      width: prof([[0, 0.0165], [0.4, 0.0105], [0.75, 0.0045], [1, 0.0019]]),
      thick: prof([[0, 0.0015], [0.3, 0.0034], [0.75, 0.0026], [1, 0.0014]]),
      facing: backFacing,
      tubular: 16,
    })];
  },
  teres_minor: () => {
    const o = mark('teres_minor', 'origin', 'dorsal surface of the lateral border of the scapula (upper part)', plateBack(0.117, 0.208));
    const end = mark('teres_minor', 'insertion', 'inferior facet of the greater tubercle', add3(GREATER_TUBERCLE, [0.002, -0.006, -0.0065]));
    const mid = above(lerp3(above(o, 0.003), end, 0.5), 0.0028);
    return [muscleTube({
      path: [above(o, 0.0006), above(o, 0.0028), mid, above(end, 0.0006)],
      width: prof([[0, 0.0048], [0.5, 0.0044], [1, 0.0018]]),
      thick: prof([[0, 0.0014], [0.45, 0.0028], [1, 0.0013]]),
      facing: backFacing,
      tubular: 14,
    })];
  },
  subscapularis: () => {
    const o = mark('subscapularis', 'origin', 'subscapular fossa (medial part)', plateFront(0.078, 0.208));
    const end = mark('subscapularis', 'insertion', 'lesser tubercle of the humerus', add3(LESSER_TUBERCLE, [-0.0035, 0, 0.0035]));
    const a = above(o, 0.0020);
    const b = above(plateFront(0.108, 0.218), 0.0024);
    const c = above(lerp3(b, end, 0.55), 0.0030);
    return [muscleTube({
      path: [above(o, 0.0006), a, b, c, above(end, 0.0006)],
      width: prof([[0, 0.0175], [0.4, 0.0125], [0.75, 0.0055], [1, 0.0022]]),
      thick: prof([[0, 0.0012], [0.3, 0.0020], [0.75, 0.0018], [1, 0.0012]]),
      facing: frontFacing,
      tubular: 16,
    })];
  },
  teres_major: () => {
    const o = mark('teres_major', 'origin', 'dorsal surface of the inferior angle of the scapula', plateBack(0.072, 0.1665));
    const end = mark('teres_major', 'insertion', 'medial lip of the intertubercular sulcus', [0.1635, 0.2255, 0.0098]);
    const w1 = above(plateBack(0.094, 0.18), 0.0034);
    const w2 = above([0.135, 0.206, scapulaZ(0.12, 0.2) - 0.008], 0.0032);
    const sh = shaftAt(0.2205);
    const w3 = above([sh.c[0] - 0.7 * (sh.r + 0.004), 0.2205, sh.c[2] - 0.7 * (sh.r + 0.004)], 0.0030);
    return [muscleTube({
      path: [above(o, 0.0006), above(o, 0.0030), w1, w2, w3, above(end, 0.0006)],
      width: prof([[0, 0.0070], [0.4, 0.0078], [0.85, 0.0050], [1, 0.0022]]),
      thick: prof([[0, 0.0014], [0.4, 0.0034], [0.85, 0.0026], [1, 0.0014]]),
      facing: backFacing,
      tubular: 18,
    })];
  },
  coracobrachialis: () => {
    const o = mark('coracobrachialis', 'origin', 'tip of the coracoid process', add3(CORACOID_TIP, [0.0012, -0.0006, 0.0022]));
    const end = mark('coracobrachialis', 'insertion', 'medial surface of the humeral shaft, middle third', aroundShaft(0.19, -1, 0.12, 0));
    const w = aroundShaft(0.228, -0.7, 0.7, 0.0045);
    return [muscleTube({
      path: [above(o, 0.0006), above(o, 0.0024), w, aroundShaft(0.205, -0.95, 0.3, 0.0034), above(end, 0.0006)],
      width: prof([[0, 0.0022], [0.45, 0.0046], [0.85, 0.0034], [1, 0.0016]]),
      thick: prof([[0, 0.0022], [0.45, 0.0034], [0.85, 0.0026], [1, 0.0014]]),
      facing: radialFacing,
      tubular: 16,
    })];
  },
  brachialis: () => {
    const o = mark('brachialis', 'origin', 'anterior surface of the humerus, distal half', aroundShaft(0.19, 0, 1, 0));
    const pts: V3[] = [above(o, 0.0006)];
    for (const y of [0.178, 0.165, 0.152, 0.141]) pts.push(aroundShaft(y, 0.05, 1, 0.0026));
    pts.push([0.1895, 0.1325, 0.0215]);
    return [muscleTube({
      path: pts,
      width: prof([[0, 0.0050], [0.4, 0.0092], [0.8, 0.0078], [1, 0.0024]]),
      thick: prof([[0, 0.0012], [0.4, 0.0026], [0.8, 0.0022], [1, 0.0012]]),
      facing: () => [0, 0, 1],
      tubular: 16,
    })];
  },

  biceps_brachii: () => [muscleTube({
    path: BICEPS_YS.map((y) => bicepsAxis(y)),
    width: BICEPS_RADIUS,
    thick: BICEPS_RADIUS,
    tubular: 16,
  })],
  biceps_long_head: () => {
    const ys = [0.208, 0.19, 0.17, 0.152, 0.141];
    return [muscleTube({
      path: ys.map((y) => bicepsAxis(y, 0.0028)),
      width: prof([[0, 0.0016], [0.25, 0.0050], [0.55, 0.0060], [0.85, 0.0046], [1, 0.0022]]),
      thick: prof([[0, 0.0016], [0.25, 0.0050], [0.55, 0.0060], [0.85, 0.0046], [1, 0.0022]]),
      tubular: 14,
    })];
  },
  biceps_long_head_tendon: () => {
    const o = mark('biceps_long_head_tendon', 'origin', 'supraglenoid tubercle (long head)', add3(GLENOID_TOP, [0, 0.0012, 0]));
    const top = above([0.158, 0.264, 0.001], 0.0016);
    const groove: V3 = [0.1688, 0.2478, 0.0099];
    const pts: V3[] = [above(o, 0.0008), above(lerp3(o, top, 0.5), 0.0016), top, above([0.1665, 0.2545, 0.0083], 0.0016), groove];
    for (const y of [0.238, 0.226, 0.214, 0.206]) {
      const t = (0.247 - y) / (0.247 - 0.213);
      pts.push([0.1685 + 0.001 * t, y, 0.0098 - 0.0010 * t]);
    }
    return [muscleTube({
      path: pts,
      width: prof([[0, 0.0015], [0.5, 0.0017], [1, 0.0017]]),
      thick: prof([[0, 0.0015], [0.5, 0.0017], [1, 0.0017]]),
      tubular: 28,
      radial: 6,
    })];
  },
  biceps_short_head: () => {
    const ys = [0.208, 0.19, 0.17, 0.152, 0.141];
    return [muscleTube({
      path: ys.map((y) => bicepsAxis(y, -0.0028)),
      width: prof([[0, 0.0016], [0.25, 0.0046], [0.55, 0.0056], [0.85, 0.0044], [1, 0.0022]]),
      thick: prof([[0, 0.0016], [0.25, 0.0046], [0.55, 0.0056], [0.85, 0.0044], [1, 0.0022]]),
      tubular: 14,
    })];
  },
  biceps_short_head_tendon: () => {
    const o = mark('biceps_short_head_tendon', 'origin', 'tip of the coracoid process (short head, with coracobrachialis)', add3(CORACOID_TIP, [0.0012, -0.0006, 0.0022]));
    const w1 = above([0.152, 0.25, 0.0275], 0.0022);
    const w2 = above(aroundShaft(0.228, -0.45, 0.9, 0.0075), 0.0010);
    return [muscleTube({
      path: [above(o, 0.0006), above(o, 0.0030), w1, w2, bicepsAxis(0.2105, -0.0028)],
      width: prof([[0, 0.0016], [0.5, 0.0019], [1, 0.0017]]),
      thick: prof([[0, 0.0016], [0.5, 0.0019], [1, 0.0017]]),
      tubular: 20,
      radial: 6,
    })];
  },

  triceps_brachii: () => {
    const ys = [0.222, 0.205, 0.185, 0.165, 0.148, 0.137];
    return [muscleTube({
      path: ys.map((y) => tricepsAxis(y)),
      width: prof([[0, 0.0020], [0.2, 0.0082], [0.55, 0.0102], [0.85, 0.0074], [1, 0.0026]]),
      thick: prof([[0, 0.0020], [0.2, 0.0082], [0.55, 0.0102], [0.85, 0.0074], [1, 0.0026]]),
      tubular: 16,
    })];
  },
  triceps_long_head: () => {
    const o = mark('triceps_long_head', 'origin', 'infraglenoid tubercle (long head)', add3(GLENOID_BOTTOM, [-0.003, -0.002, -0.003]));
    const w1 = above(add3(GLENOID_BOTTOM, [0.003, -0.012, -0.007]), 0.0030);
    const ys = [0.21, 0.19, 0.17, 0.152, 0.141];
    return [muscleTube({
      path: [above(o, 0.0006), above(o, 0.0030), w1, ...ys.map((y) => tricepsAxis(y, -0.0026))],
      width: prof([[0, 0.0016], [0.25, 0.0032], [0.5, 0.0062], [0.85, 0.0050], [1, 0.0024]]),
      thick: prof([[0, 0.0016], [0.25, 0.0032], [0.5, 0.0062], [0.85, 0.0050], [1, 0.0024]]),
      tubular: 22,
    })];
  },
  triceps_lateral_head: () => {
    const o = mark('triceps_lateral_head', 'origin', 'posterior surface of the humerus above the radial groove (lateral head)', aroundShaft(0.216, 0.75, -0.65, 0));
    const ys = [0.2, 0.18, 0.162, 0.148, 0.139];
    return [muscleTube({
      path: [above(o, 0.0006), ...ys.map((y) => tricepsAxis(y, 0.0030))],
      width: prof([[0, 0.0016], [0.2, 0.0042], [0.55, 0.0064], [0.85, 0.0048], [1, 0.0024]]),
      thick: prof([[0, 0.0016], [0.2, 0.0042], [0.55, 0.0064], [0.85, 0.0048], [1, 0.0024]]),
      tubular: 16,
    })];
  },
  triceps_medial_head: () => {
    const o = mark('triceps_medial_head', 'origin', 'posterior surface of the humerus below the radial groove (medial head)', aroundShaft(0.2, -0.2, -1, 0));
    const pts: V3[] = [above(o, 0.0006)];
    for (const y of [0.186, 0.17, 0.155, 0.143]) pts.push(aroundShaft(y, -0.1, -1, 0.0032));
    pts.push(tricepsAxis(0.137));
    return [muscleTube({
      path: pts,
      width: prof([[0, 0.0040], [0.4, 0.0070], [0.85, 0.0058], [1, 0.0026]]),
      thick: prof([[0, 0.0014], [0.4, 0.0030], [0.85, 0.0030], [1, 0.0022]]),
      facing: (p) => {
        const { c } = shaftAt(p[1]);
        return unit3([p[0] - c[0], 0, p[2] - c[2]]);
      },
      tubular: 16,
    })];
  },
  triceps_tendon: () => {
    const e = tricepsAxis(0.137);
    const end: V3 = [CONDYLES.trochlea.c[0] + 0.001, 0.1305, CONDYLES.trochlea.c[2] - 0.0245];
    return [muscleTube({
      path: [e, lerp3(e, end, 0.5), end],
      width: prof([[0, 0.0048], [0.6, 0.0040], [1, 0.0020]]),
      thick: prof([[0, 0.0016], [0.6, 0.0014], [1, 0.0010]]),
      facing: () => [0, 0, 1],
      tubular: 8,
    })];
  },
};

/** Part ids whose geometry is in `BUILDERS`: every macroscopic muscle and its heads. */
export const MUSCLE_IDS = Object.keys(BUILDERS);

/** The ids drawn in the unselected shell: the L1 muscles and the four cuff muscles (children of the cuff). */
export const SHELL_IDS = [
  'deltoid', 'rotator_cuff', 'supraspinatus', 'infraspinatus', 'teres_minor', 'subscapularis', 'teres_major', 'coracobrachialis',
  'biceps_brachii', 'brachialis', 'triceps_brachii',
];

const rawCache = new Map<string, THREE.BufferGeometry>();
/** One part's right-side geometry in the body frame, merged and cleared of bone. Cached. */
function rawRight(id: string): THREE.BufferGeometry {
  let g = rawCache.get(id);
  if (!g) {
    g = mergeParts(BUILDERS[id]());
    const worst = clearOf(g);
    BUILD_STATS[id] = { worstRawPenetration_m: worst, triangles: (g.getIndex()?.count ?? 0) / 3 };
    rawCache.set(id, g);
  }
  return g;
}

/**
 * The geometry of each muscle (and head) by the part's id in src/data/anatomy/shoulder_arm_muscles.json,
 * both sides, in the organ's frame. Fresh clones on every call: the callers merge and dispose them.
 */
export function shoulderArmMuscleGroups(ids: readonly string[] = MUSCLE_IDS): Record<string, THREE.BufferGeometry[]> {
  const out: Record<string, THREE.BufferGeometry[]> = {};
  for (const id of ids) {
    const r = rawRight(id);
    out[id] = [toLocal(r.clone()), toLocal(mirrorX(r))];
  }
  return out;
}

export function shoulderArmMuscles(): THREE.BufferGeometry {
  return mergeParts(Object.values(shoulderArmMuscleGroups(SHELL_IDS)).flat());
}
