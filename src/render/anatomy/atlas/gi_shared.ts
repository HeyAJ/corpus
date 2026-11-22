import * as THREE from 'three';
import { mergeParts, tubeAlong } from '../sdf';
import type { V3 } from '../sdf';

/**
 * SMALL DRAWING HELPERS SHARED BY THE FOUR GUT ATLASES (oesophagus, stomach, small and large
 * intestine).
 *
 * WHY A SHARED FILE. The textbook-depth pass added, to each of the four gut atlases, the layers
 * of the wall (serosa, muscle coats, submucosa, mucosa), the nerve plexuses between them and a
 * magnified cluster of cells. Every one of those is the same handful of operations: find a
 * point at some angle round a tube, lay a thin cord along it, scatter a small blob on the
 * wall, hang a flat sheet between two lines. The four atlases each had their own private copy
 * of `ringAcross` already (written when the first atlas was drawn); copying the new helpers
 * four more times would have made four slightly different versions of the same function, so
 * they live here and the older private copies were left alone rather than risk changing
 * parts that already render correctly.
 *
 * WHAT THIS FILE DRAWS. Nothing by itself. It only builds geometry for the atlases to name.
 * Every shape here is ILLUSTRATIVE: cells are drawn many times life size so that a reader can
 * tell a goblet cell from an enterocyte, and nothing is to scale. The atlases' own headers say
 * which things are enlarged.
 *
 * Pure three.js geometry, no DOM, so it can run in the geometry worker like the atlas files.
 */

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** A point on a curve with two perpendiculars to its tangent. */
export interface Frame {
  p: THREE.Vector3;
  t: THREE.Vector3;
  n: THREE.Vector3;
  b: THREE.Vector3;
}

/** The frame at arc fraction `u`. Not parallel-transported: fine for one object at one place. */
export function frameAt(curve: THREE.Curve<THREE.Vector3>, u: number): Frame {
  const p = curve.getPointAt(u);
  const t = curve.getTangentAt(u).normalize();
  const ref = Math.abs(t.z) < 0.9 ? Z_AXIS : new THREE.Vector3(1, 0, 0);
  const n = new THREE.Vector3().crossVectors(t, ref).normalize();
  const b = new THREE.Vector3().crossVectors(t, n).normalize();
  return { p, t, n, b };
}

/**
 * Parallel-transported frames between two arc fractions: the perpendiculars do not spin about
 * the tangent, so a cord run at a fixed angle round the tube does not corkscrew by accident.
 */
export function framesAlong(curve: THREE.Curve<THREE.Vector3>, count: number, u0 = 0, u1 = 1): Frame[] {
  const out: Frame[] = [];
  let prevN: THREE.Vector3 | null = null;
  for (let i = 0; i < count; i++) {
    const u = u0 + ((u1 - u0) * i) / (count - 1);
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u).normalize();
    let n: THREE.Vector3;
    if (prevN === null) {
      const ref = Math.abs(t.z) < 0.9 ? Z_AXIS : new THREE.Vector3(1, 0, 0);
      n = new THREE.Vector3().crossVectors(t, ref).normalize();
    } else {
      n = prevN.clone().addScaledVector(t, -prevN.dot(t)).normalize();
    }
    const b = new THREE.Vector3().crossVectors(t, n).normalize();
    out.push({ p, t, n, b });
    prevN = n;
  }
  return out;
}

/** The point `r` out from the frame's centre at `angle` round the tube. */
export function aroundFrame(f: Frame, angle: number, r: number): V3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [f.p.x + (f.n.x * c + f.b.x * s) * r, f.p.y + (f.n.y * c + f.b.y * s) * r, f.p.z + (f.n.z * c + f.b.z * s) * r];
}

/** The unit vector pointing outward from the tube axis at `angle`. */
export function outwardFrame(f: Frame, angle: number): THREE.Vector3 {
  return f.n.clone().multiplyScalar(Math.cos(angle)).addScaledVector(f.b, Math.sin(angle)).normalize();
}

/** A thin ring lying across the tube at `centre` (its normal is `tangent`). */
export function ringAcross(centre: THREE.Vector3, tangent: THREE.Vector3, major: number, minor: number, radial = 3, tubular = 12): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(major, minor, radial, tubular);
  const q = new THREE.Quaternion().setFromUnitVectors(Z_AXIS, tangent);
  g.applyMatrix4(new THREE.Matrix4().compose(centre, q, new THREE.Vector3(1, 1, 1)));
  return g;
}

/** A straight thin prism between two points, as cheap as a tube can be. */
export function stick(a: V3, b: V3, radius: number, sides = 3): THREE.BufferGeometry {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const g = new THREE.CylinderGeometry(radius, radius, Math.max(len, 1e-6), sides, 1, true);
  const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir);
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

/** A small ellipsoid (a cell, a gland body, a tag of fat) at `c`. `r` is one radius or three. */
export function blob(c: V3, r: number | V3, widthSegments = 7, heightSegments = 5): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, widthSegments, heightSegments);
  const s: V3 = typeof r === 'number' ? [r, r, r] : r;
  g.scale(s[0], s[1], s[2]);
  g.translate(c[0], c[1], c[2]);
  return g;
}

/** An ellipsoid with its long axis along `axis`, centred on `c`. */
export function blobAlong(c: V3, axis: V3, along: number, across: number, widthSegments = 7, heightSegments = 5): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, widthSegments, heightSegments);
  g.scale(across, along, across);
  const dir = new THREE.Vector3(axis[0], axis[1], axis[2]).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir);
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(c[0], c[1], c[2]), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

/** A cone from `base` to `tip` (a goblet cell's stem, an incisure marker). */
export function cone(base: V3, tip: V3, radius: number, sides = 6): THREE.BufferGeometry {
  const len = Math.hypot(tip[0] - base[0], tip[1] - base[1], tip[2] - base[2]);
  const g = new THREE.ConeGeometry(radius, Math.max(len, 1e-6), sides, 1);
  const dir = new THREE.Vector3(tip[0] - base[0], tip[1] - base[1], tip[2] - base[2]).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir);
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3((base[0] + tip[0]) / 2, (base[1] + tip[1]) / 2, (base[2] + tip[2]) / 2), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

/**
 * A flat sheet hung between two polylines of the same length (a mesentery, an omentum, a
 * mesocolon). Both faces are written, because a sheet seen from behind would otherwise vanish.
 */
export function ribbon(top: readonly V3[], bottom: readonly V3[]): THREE.BufferGeometry {
  const n = Math.min(top.length, bottom.length);
  const pos: number[] = [];
  for (let i = 0; i < n; i++) pos.push(top[i][0], top[i][1], top[i][2]);
  for (let i = 0; i < n; i++) pos.push(bottom[i][0], bottom[i][1], bottom[i][2]);
  const idx: number[] = [];
  for (let i = 0; i + 1 < n; i++) {
    const a = i;
    const b = i + 1;
    const c = n + i;
    const d = n + i + 1;
    idx.push(a, c, b, b, c, d, a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Move geometry built in a LOCAL frame (origin at its base, +y toward its tip) so that its
 * base sits at `origin`, its tip points along `up`, and it is `scale` times the size.
 * Used to stand one gland or one villus on the wall, pointing at the lumen.
 */
export function placed(g: THREE.BufferGeometry, origin: V3, up: V3, scale = 1): THREE.BufferGeometry {
  const dir = new THREE.Vector3(up[0], up[1], up[2]).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir);
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(origin[0], origin[1], origin[2]), q, new THREE.Vector3(scale, scale, scale)));
  return g;
}

/**
 * A cord that winds `turns` times round a tube between arc fractions `u0` and `u1`, at
 * `radiusAt(u)` from the axis. A nerve plexus drawn as a braid is two of these turning
 * opposite ways. `radiusAt` is the caller's own calibre function, so the braid follows the
 * shell's pinches.
 */
export function helixCord(
  curve: THREE.Curve<THREE.Vector3>,
  u0: number,
  u1: number,
  samples: number,
  turns: number,
  phase: number,
  radiusAt: (u: number) => number,
  cordRadius: number,
): THREE.BufferGeometry {
  const frames = framesAlong(curve, samples, u0, u1);
  const line: V3[] = frames.map((f, i) => {
    const u = u0 + ((u1 - u0) * i) / (samples - 1);
    return aroundFrame(f, phase + turns * Math.PI * 2 * (i / (samples - 1)), radiusAt(u));
  });
  return tubeAlong(line, () => cordRadius, { tubular: samples * 2, radial: 3 });
}

/** A cord running straight along a tube at a fixed angle round it. */
export function lengthwiseCord(
  curve: THREE.Curve<THREE.Vector3>,
  u0: number,
  u1: number,
  samples: number,
  angle: number,
  radiusAt: (u: number) => number,
  cordRadius: number,
): THREE.BufferGeometry {
  return helixCord(curve, u0, u1, samples, 0, angle, radiusAt, cordRadius);
}

/** Merge a list into one geometry, or an empty one if the list is empty. */
export function mergeAll(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return list.length === 0 ? new THREE.BufferGeometry() : mergeParts(list);
}
