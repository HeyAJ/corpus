import * as THREE from 'three';
import { tubeAlong, type V3 } from '../sdf';
import { warpOffsetY } from '../layout';
import { cageRing, sternumZ } from './thoracic_cage';

/**
 * SHARED HELPERS FOR THE FIRST-PASS (STUB) SHELLS OF THE SEVEN MUSCLE ORGANS.
 *
 * The muscles are a LAYER organ group (`layer: 'muscles'`, ADR-048's mechanism, the second
 * layer after the bones). Each organ was scaffolded with one honest, simple silhouette in the
 * right place so that the layer, the organ list, the search, the share link and the Structures
 * panel all work before anyone has drawn a real muscle. Nothing here is anatomy: the radii, the
 * thicknesses and the slab outlines are drawing choices made by the files that call these
 * helpers, and the content agents who draw a group properly replace its shell and delete their
 * import of this file. Once the last stub is gone this file can go too.
 *
 * ONE RULE FOR WHERE A POINT IS. Every muscle is authored in BODY coordinates (the unexploded
 * body, +x the patient's right, +y cranial, +z anterior), exactly as the skeleton shells are, so
 * an attachment is written as the bone's own number (a rib end, the pubic tubercle, the lesser
 * trochanter) and can be compared with it. `localFrame` then moves a body point to the organ's
 * own frame THROUGH THE EXPLODED STACK'S CONTINUOUS WARP (`warpOffsetY`, the same function the
 * spinal cord, the vessels and the oesophagus use). That is what lets one rectus abdominis run
 * from the costal margin (thoracic group, no offset) to the pubis (pelvic group, 4.5 cm lower)
 * and still meet both: a rigid group offset would leave it 2 cm adrift at one end. WHAT WENT
 * WRONG BEFORE, for the neck: a rigid cranial offset left the stub sternocleidomastoid ending
 * 6 cm above the sternum it must reach, which is why the warp is used here and not the group
 * offset.
 */

/** Both sides of a pair: `make(1)` (the patient's right) and `make(-1)` merged into one list. */
export function bothSides(make: (side: number) => THREE.BufferGeometry[]): THREE.BufferGeometry[] {
  return [...make(1), ...make(-1)];
}

/** Mirror a right-hand body point to the given side. */
export const onSide = (p: V3, side: number): V3 => [side * p[0], p[1], p[2]];

/** Two ways to take a body point to an organ's own frame; see `localFrame`. */
export interface Frame {
  /** For a point in the soft tissue between attachments: the exploded stack's continuous warp at the point's own height. */
  warp: (p: V3) => V3;
  /**
   * For a point ON A BONE that is drawn rigidly with its group (every bone shell is): the bone's
   * group offset, not the continuous warp. The two agree inside a group's plateau and differ in
   * the three transition bands (the femoral head and the iliac crest lie in them), so an
   * attachment written with `warp` would miss the bone it is meant to meet by up to 2 cm.
   */
  rigid: (p: V3, boneGroupY: number) => V3;
}

/**
 * The organ's frame. `origin` is organs.json `position` and `groupY` the organ's group offset,
 * which the renderer adds back, so both are taken away here. For an axial organ `groupY` is 0
 * and `origin` is [0, 0, 0], so `warp` is exactly `warpPoint`.
 */
export function localFrame(origin: V3, groupY: number): Frame {
  return {
    warp: (p) => [p[0] - origin[0], p[1] + warpOffsetY(p[1]) - origin[1] - groupY, p[2] - origin[2]],
    rigid: (p, boneGroupY) => [p[0] - origin[0], p[1] + boneGroupY - origin[1] - groupY, p[2] - origin[2]],
  };
}

/** Euclidean distance between two points. */
const dist = (a: V3, b: V3): number => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

/**
 * A SPINDLE: an ellipsoid whose long axis runs from `a` to `b`, the plain shape of a muscle belly.
 * `radius` is its half-width across, `flat` the ratio of its thickness (along `facing`) to its
 * width, so a broad flat muscle (a pectoral, a gluteal) is a spindle with `flat` below 1 whose
 * thin side faces `facing`. Low tessellation on purpose: a pair costs about 200 triangles.
 */
export function spindle(a: V3, b: V3, radius: number, flat = 1, facing: V3 = [0, 0, 1], w = 10, h = 6): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, w, h);
  g.deleteAttribute('uv');
  const length = Math.max(1e-4, dist(a, b));
  // Long axis y, thin axis z (scaled by `flat`), width axis x.
  g.scale(radius, length / 2, radius * flat);
  const y = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
  // The thin axis is the hint with its component along the muscle taken out, so it is perpendicular.
  const hint = new THREE.Vector3(facing[0], facing[1], facing[2]);
  const z = hint.sub(y.clone().multiplyScalar(hint.dot(y)));
  if (z.lengthSq() < 1e-8) z.set(0, 0, 1).sub(y.clone().multiplyScalar(y.z));
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  g.applyMatrix4(new THREE.Matrix4().makeBasis(x, y, z));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return g;
}

/** A tube of constant radius along a smooth path: a tendon, a strap, a long thin muscle. */
export function strap(points: readonly V3[], radius: number, tubular = 14, radial = 5): THREE.BufferGeometry {
  return tubeAlong(points, () => radius, { tubular, radial });
}

/**
 * A closed SLAB along a parametric surface: the broad sheets of the trunk (an intercostal layer,
 * the rectus, an oblique). `point(u, v)` is the inner face for u, v in 0..1; the slab stands
 * `thick` proud of it along the surface normal, on the side away from `away` (any point inside
 * the structure it wraps, so the sign of the normal never has to be worked out by hand). Four
 * edge strips close it, so it is a volume the absorption material can draw both faces of.
 * `nu` by `nv` cells: about 250 triangles at 8 by 6.
 */
export function slab(point: (u: number, v: number) => V3, thick: number, nu: number, nv: number, away: V3): THREE.BufferGeometry {
  const P = (u: number, v: number): THREE.Vector3 => {
    const p = point(Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v)));
    return new THREE.Vector3(p[0], p[1], p[2]);
  };
  // The normal at the middle of the patch decides which side is "out".
  const e = 0.01;
  const centre = P(0.5, 0.5);
  const nc = new THREE.Vector3().crossVectors(P(0.5 + e, 0.5).sub(P(0.5 - e, 0.5)), P(0.5, 0.5 + e).sub(P(0.5, 0.5 - e)));
  const sign = nc.dot(centre.clone().sub(new THREE.Vector3(away[0], away[1], away[2]))) >= 0 ? 1 : -1;

  const pos: number[] = [];
  const idx: number[] = [];
  const vertex = (i: number, j: number, layer: number): number => {
    const u = i / nu;
    const v = j / nv;
    const p = P(u, v);
    const n = new THREE.Vector3()
      .crossVectors(P(u + e, v).sub(P(u - e, v)), P(u, v + e).sub(P(u, v - e)))
      .normalize()
      .multiplyScalar(sign * thick * layer);
    p.add(n);
    pos.push(p.x, p.y, p.z);
    return pos.length / 3 - 1;
  };
  const inner: number[][] = [];
  const outer: number[][] = [];
  for (let j = 0; j <= nv; j++) {
    inner.push([]);
    outer.push([]);
    for (let i = 0; i <= nu; i++) {
      inner[j].push(vertex(i, j, 0));
      outer[j].push(vertex(i, j, 1));
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
  // A negative signed volume means the triangles are wound inside-out; flip them all.
  let volume = 0;
  const q = new THREE.Vector3();
  const r = new THREE.Vector3();
  const s = new THREE.Vector3();
  for (let t = 0; t < idx.length; t += 3) {
    q.set(pos[idx[t] * 3], pos[idx[t] * 3 + 1], pos[idx[t] * 3 + 2]);
    r.set(pos[idx[t + 1] * 3], pos[idx[t + 1] * 3 + 1], pos[idx[t + 1] * 3 + 2]);
    s.set(pos[idx[t + 2] * 3], pos[idx[t + 2] * 3 + 1], pos[idx[t + 2] * 3 + 2]);
    volume += q.dot(r.cross(s));
  }
  if (volume < 0) {
    for (let t = 0; t < idx.length; t += 3) {
      const tmp = idx[t + 1];
      idx[t + 1] = idx[t + 2];
      idx[t + 2] = tmp;
    }
    g.setIndex(idx);
  }
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------------ the trunk's surface */

/**
 * WHERE THE OUTSIDE OF THE TRUNK LIES. Above y = 0 it is the rib cage's own cross-section
 * (`cageRing` in thoracic_cage.ts: an ellipse at each height, wider and deeper going down), so a
 * chest-wall or back muscle stub sits against the ribs it covers. Below the cage there is no
 * rib to follow, and the abdominal wall and the pelvis are shallower: the half-width stays the
 * cage's lowest value and the two depths taper linearly to `PELVIS_Y`, ending at the front
 * where the pubic symphysis is (z 0.065 to 0.0585 plus its half-thickness, shells/
 * lower_limb_bones.ts) and at the back close to the sacrum. These two taper fractions are
 * DRAWING choices chosen to meet the pubis; they are not measurements of a waist.
 */
const PELVIS_Y = -0.15;
const FRONT_TAPER = 0.2;
const BACK_TAPER = 0.085;

/**
 * The front of the trunk is the cage ellipse only where the ribs are. Near the midline the front
 * is the sternum and the costal cartilages, which lie well behind the ellipse (the sternum's
 * front at y 0.2 is z 0.075 against the ellipse's 0.10): a sheet laid on the bare ellipse stood
 * 1.8 cm proud of the sternum and outside the glass figure. The front is therefore limited to a
 * ramp that starts at the sternum's front (`sternumZ` plus its half-thickness 0.004) and rises
 * with lateral distance (steeply high on the chest, where the sternum leans back, and almost
 * flat low down, where the cartilages run straight out) until it meets the ribs' own front
 * ends, where the ellipse takes over. The two slopes are drawing choices fitted to those ends.
 */
const STERNUM_FRONT_HALF = 0.004;
/** Ramp slope below the 6th rib's level, where the cartilages run nearly flat (ribs 5 to 7 end at z 0.087 to 0.074 across x 0.082 to 0.102), and at the top, where the sternum leans back (rib 2 ends at x 0.05, z 0.084 against the sternum's 0.064). Fitted to those ends. */
const RAMP_LOW = 0.03;
const RAMP_HIGH = 0.32;
function limitFront(y: number, x: number, z: number): number {
  if (z <= 0) return z;
  const t = Math.max(0, Math.min(1, (Math.max(y, 0) - 0.12) / 0.1));
  const slope = RAMP_LOW + (RAMP_HIGH - RAMP_LOW) * t * t * (3 - 2 * t);
  return Math.min(z, sternumZ(Math.max(y, 0)) + STERNUM_FRONT_HALF + slope * Math.abs(x));
}

/** The cross-section ellipse of the trunk at height y, angle a (0 back midline, pi/2 right side, pi front midline): x and z, patient's right positive x. */
export function trunkRing(y: number, a: number): [number, number] {
  if (y >= 0) {
    const [x, z] = cageRing(y, a);
    return [x, limitFront(y, x, z)];
  }
  const [, zFront] = cageRing(0, Math.PI);
  const [, zBack] = cageRing(0, 0);
  const [xSide] = cageRing(0, Math.PI / 2);
  const t = Math.min(1, -y / -PELVIS_Y);
  const c = Math.cos(a);
  const depth = c > 0 ? -zBack * (1 - BACK_TAPER * t) : zFront * (1 - FRONT_TAPER * t);
  const x = xSide * Math.sin(a);
  return [x, limitFront(0, x, -c * depth)];
}

/**
 * A point on the trunk's surface pushed `off` metres outward along the ellipse's normal. `side`
 * is +1 for the patient's right (the ring is already right-positive) and -1 for the left.
 */
export function trunkPoint(side: number, y: number, a: number, off = 0): V3 {
  const [x, z] = trunkRing(y, a);
  const [xs] = trunkRing(y, Math.PI / 2);
  const c = Math.cos(a);
  const [, zf] = trunkRing(y, Math.PI);
  const [, zb] = trunkRing(y, 0);
  const depth = c > 0 ? -zb : zf;
  // Gradient of x^2/A^2 + z^2/D^2: the outward normal of the ellipse.
  const nx = x / (xs * xs);
  const nz = z / (depth * depth);
  const n = Math.hypot(nx, nz) || 1;
  return [side * (x + (off * nx) / n), y, z + (off * nz) / n];
}
