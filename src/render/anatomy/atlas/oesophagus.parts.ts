import * as THREE from 'three';
import type { PartBuilder } from '../parts';
import { giSegment, warpGeometry } from '../layout';
import { mergeParts, tubeAlong } from '../sdf';
import type { V3 } from '../sdf';

/**
 * INTERIOR PARTS OF THE OESOPHAGUS.
 *
 * WHAT THIS DRAWS. The shell in models.ts is one narrow tube swept along the authored
 * oesophageal centreline, pinched at each end where the two sphincters are. Inside it we
 * draw, from the outside in: the vagal plexus on the surface (a braid of fine cords); the
 * wall as three GLASS segments, cervical, thoracic and abdominal, which carry everything
 * else; the muscular coat (circular bands and four longitudinal strips); the mucosa; and
 * the lumen, a narrow glass channel that the swallowed bolus is shown travelling in. The
 * upper and lower oesophageal sphincters are short thickened rings of solid tissue at the
 * two ends, because they are the things a user should be able to tap.
 *
 * HOW IT STAYS INSIDE THE SHELL. The shell's calibre function is copied below (it is not
 * exported from models.ts and this file may only import its exported helpers), and every
 * part is a fixed fraction of it, so all of them follow the pinch at both ends for free:
 * wall segments 0.9, plexus 0.86, muscle 0.8, mucosa 0.58, lumen 0.3. If models.ts ever
 * changes `oesophagus()`, change `shellRadius` to match. The segments are sub-ranges of the
 * one spline, cut at fractions of its arc length (`CERVICAL_END`, `ABDOMINAL_START`), which
 * are drawing proportions chosen to look like the textbook picture, not measurements.
 *
 * WHAT IT DOES NOT DO. It does not model the real thickness of the wall layers (the muscle
 * coat is drawn as thin bands, not as a 3 mm shell). The striated-above, smooth-below
 * change in the muscle is described in the data file but the bands are drawn alike. The
 * sphincters are rings, not the crural slings and oblique fibres Gray's describes, and the
 * plexus is a decorative braid, not a traced nerve map.
 *
 * Built in unexploded body coordinates, then passed through `warpGeometry` exactly as the
 * shell is, so it follows the exploded stack.
 */

/** Arc fractions where the cervical segment ends and the abdominal one begins. */
export const CERVICAL_END = 0.17;
export const ABDOMINAL_START = 0.94;

/** The same points the shell is swept along: a short run up to the pharynx, then the gut centreline. */
export function oesophagusPoints(): V3[] {
  return [[0.002, 0.37, -0.014], ...giSegment('oesophagus')];
}

/** The shell's radius at arc fraction t. Copied from models.ts `oesophagus()`; see header. */
function shellRadius(t: number): number {
  return 0.0086 * (1 - 0.28 * Math.exp(-Math.pow((t - 0.97) / 0.035, 2)) - 0.2 * Math.exp(-Math.pow(t / 0.04, 2)));
}

/**
 * Where along the whole path (0..1) a point `s` of the way along the engine's
 * oesophagus segment lies. The path begins with a short run up to the pharynx that the
 * engine's segment does not have, so the segment is the later part of the path.
 */
export function pathFractionOf(s: number): number {
  const pts = oesophagusPoints();
  let total = 0;
  let first = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
    if (i === 1) first = d;
    total += d;
  }
  const front = first / total;
  return front + Math.min(1, Math.max(0, s)) * (1 - front);
}

let cachedCurve: THREE.CatmullRomCurve3 | null = null;

/** The oesophagus spline, built as tubeAlong builds the shell's (centripetal off, tension 0.5). */
export function oesophagusCurve(): THREE.CatmullRomCurve3 {
  if (cachedCurve === null) {
    cachedCurve = new THREE.CatmullRomCurve3(
      oesophagusPoints().map((p) => new THREE.Vector3(p[0], p[1], p[2])),
      false,
      'catmullrom',
      0.5,
    );
  }
  return cachedCurve;
}

/** Centreline points of the lumen between two arc fractions, unwarped. */
export function oesophagusLine(u0: number, u1: number, count: number): V3[] {
  const curve = oesophagusCurve();
  const out: V3[] = [];
  for (let i = 0; i < count; i++) {
    const p = curve.getPointAt(u0 + ((u1 - u0) * i) / (count - 1));
    out.push([p.x, p.y, p.z]);
  }
  return out;
}

const Z_AXIS = new THREE.Vector3(0, 0, 1);

/** A thin ring of the given radii, lying across the tube at `centre` (normal = `tangent`). */
function ringAcross(centre: THREE.Vector3, tangent: THREE.Vector3, major: number, minor: number, radial: number, tubular: number): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(major, minor, radial, tubular);
  const q = new THREE.Quaternion().setFromUnitVectors(Z_AXIS, tangent);
  g.applyMatrix4(new THREE.Matrix4().compose(centre, q, new THREE.Vector3(1, 1, 1)));
  return g;
}

interface Frame {
  p: THREE.Vector3;
  t: THREE.Vector3;
  n: THREE.Vector3;
  b: THREE.Vector3;
}

/**
 * Parallel-transported frames along a curve between two arc fractions: at each sample a
 * point, a tangent and two perpendiculars that do not spin about the tangent. Used to run a
 * strip along the tube at a fixed angle round it without it corkscrewing.
 */
function framesAlong(curve: THREE.CatmullRomCurve3, count: number, u0 = 0, u1 = 1): Frame[] {
  const out: Frame[] = [];
  let prevN: THREE.Vector3 | null = null;
  for (let i = 0; i < count; i++) {
    const u = u0 + ((u1 - u0) * i) / (count - 1);
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u).normalize();
    let n: THREE.Vector3;
    if (prevN === null) {
      const ref = Math.abs(t.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
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

/** A tube over arc fractions [u0, u1] with radius `frac` times the shell's. */
function segment(u0: number, u1: number, frac: number, radial: number): THREE.BufferGeometry {
  const curve = oesophagusCurve();
  const n = Math.max(4, Math.ceil(((u1 - u0) * curve.getLength()) / 0.005));
  const pts: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const p = curve.getPointAt(u0 + ((u1 - u0) * i) / n);
    pts.push([p.x, p.y, p.z]);
  }
  return tubeAlong(pts, (t) => frac * shellRadius(u0 + (u1 - u0) * t), { tubular: n, radial, tension: 0.5 });
}

export const parts: PartBuilder = () => {
  const curve = oesophagusCurve();
  const length = curve.getLength();

  // --- the wall, in three glass segments (the same radius, so they join without a step).
  const cervical = segment(0.0, CERVICAL_END, 0.9, 12);
  const thoracic = segment(CERVICAL_END, ABDOMINAL_START, 0.9, 12);
  const abdominal = segment(ABDOMINAL_START, 1, 0.9, 12);

  // --- mucosa and lumen: nested narrower tubes.
  const mucosa = segment(0, 1, 0.58, 10);
  const lumen = segment(0, 1, 0.3, 8);

  // --- muscularis: circular bands every few millimetres, plus four longitudinal strips.
  const muscle: THREE.BufferGeometry[] = [];
  const bandSpacing = 0.0045;
  const bandCount = Math.floor(length / bandSpacing);
  for (let i = 1; i < bandCount; i++) {
    const u = i / bandCount;
    // Leave the two ends to the sphincters.
    if (u < 0.03 || u > 0.965) continue;
    muscle.push(ringAcross(curve.getPointAt(u), curve.getTangentAt(u).normalize(), 0.8 * shellRadius(u), 0.0006, 3, 12));
  }
  const frames = framesAlong(curve, 70);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const line: V3[] = frames.map((f, i) => {
      const r = 0.8 * shellRadius(i / (frames.length - 1));
      return [f.p.x + (f.n.x * ca + f.b.x * sa) * r, f.p.y + (f.n.y * ca + f.b.y * sa) * r, f.p.z + (f.n.z * ca + f.b.z * sa) * r];
    });
    muscle.push(tubeAlong(line, () => 0.0007, { tubular: 70, radial: 3 }));
  }

  // --- vagal plexus: the two vagal trunks lie on the front and back of the lower oesophagus
  // and interlace into a plexus; drawn as two opposed helical cords and two straight ones.
  const plexus: THREE.BufferGeometry[] = [];
  const pf = framesAlong(curve, 140);
  const braid = (turns: number, phase: number): V3[] =>
    pf.map((f, i) => {
      const u = i / (pf.length - 1);
      const a = phase + turns * Math.PI * 2 * u;
      const r = 0.86 * shellRadius(u);
      return [f.p.x + (f.n.x * Math.cos(a) + f.b.x * Math.sin(a)) * r, f.p.y + (f.n.y * Math.cos(a) + f.b.y * Math.sin(a)) * r, f.p.z + (f.n.z * Math.cos(a) + f.b.z * Math.sin(a)) * r];
    });
  plexus.push(tubeAlong(braid(7, 0), () => 0.0003, { tubular: 280, radial: 3 }));
  plexus.push(tubeAlong(braid(-7, Math.PI), () => 0.0003, { tubular: 280, radial: 3 }));
  plexus.push(tubeAlong(braid(0, Math.PI / 2), () => 0.0004, { tubular: 70, radial: 3 }));
  plexus.push(tubeAlong(braid(0, (3 * Math.PI) / 2), () => 0.0004, { tubular: 70, radial: 3 }));

  // --- sphincters: two or three thick rings each, a millimetre or so apart, so they read
  // as a short thickened zone rather than a wire.
  const sphincter = (u: number, major: number, minor: number, along: number[]): THREE.BufferGeometry => {
    const rings = along.map((d) => {
      const uu = Math.min(0.999, Math.max(0.001, u + d / length));
      return ringAcross(curve.getPointAt(uu), curve.getTangentAt(uu).normalize(), major, minor, 6, 16);
    });
    return mergeParts(rings);
  };
  const upper = sphincter(0.012, 0.0058, 0.001, [-0.0012, 0.0012]);
  const lower = sphincter(0.97, 0.0045, 0.0012, [-0.0016, 0.0, 0.0016]);

  const w = (g: THREE.BufferGeometry): THREE.BufferGeometry => warpGeometry(g);
  return [
    { id: 'upper_sphincter', geometry: w(upper) },
    { id: 'cervical_segment', geometry: w(cervical) },
    { id: 'thoracic_segment', geometry: w(thoracic) },
    { id: 'abdominal_segment', geometry: w(abdominal) },
    { id: 'mucosa', geometry: w(mucosa) },
    { id: 'muscularis', geometry: w(mergeParts(muscle)) },
    { id: 'lumen', geometry: w(lumen) },
    { id: 'lower_sphincter', geometry: w(lower) },
    { id: 'vagal_plexus', geometry: w(mergeParts(plexus)) },
  ];
};
