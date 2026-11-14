import * as THREE from 'three';
import type { PartBuilder } from '../parts';
import { giSegment, warpGeometry } from '../layout';
import { mulberry32 } from '../noise';
import { mergeParts, tubeAlong } from '../sdf';
import type { V3 } from '../sdf';

/**
 * INTERIOR PARTS OF THE OESOPHAGUS.
 *
 * WHAT THIS DRAWS. The shell in models.ts is one narrow tube swept along the authored
 * oesophageal centreline, pinched at each end where the two sphincters are. Inside that
 * glass we draw the four things a physiology student is asked to name about the swallowed
 * bolus's route: the upper sphincter at the pharyngeal end, the mucosal lining that the
 * bolus actually touches, the muscle coat that pushes it down (circular bands and four
 * longitudinal strips), and the lower sphincter at the gastric end. A fifth, small part -
 * the scatter of mucous glands in the wall - is there because the lining is not a dry
 * tube: it is lubricated, and the glands are what a reader will look for.
 *
 * HOW IT STAYS INSIDE THE SHELL. The shell's calibre function is copied below (it is not
 * exported from models.ts and this file may only import its exported helpers), and every
 * part is a fixed fraction of it: the mucosa at 0.62 of the shell radius, the muscle at
 * 0.84. That is the whole trick, and the reason the parts follow the pinch at both ends
 * for free. If models.ts ever changes `oesophagus()`, change `shellRadius` to match.
 *
 * WHAT IT DOES NOT DO. It does not model the wall layers' real thicknesses (the muscle
 * coat is drawn as thin bands on the glass-side of the lumen, not as a 3 mm shell), and
 * it does not distinguish the striated upper third from the smooth lower part: both are
 * drawn alike. The sphincters are rings, not the oblique fibres and crural slings that
 * Gray's describes; the text in the JSON says what they really are.
 *
 * Built in unexploded body coordinates, then passed through `warpGeometry` exactly as the
 * shell is, so it follows the exploded stack.
 */

/** The same points the shell is swept along: a short run up to the pharynx, then the gut centreline. */
function oesophagusPoints(): V3[] {
  return [[0.002, 0.37, -0.014], ...giSegment('oesophagus')];
}

/** The shell's radius at arc fraction t. Copied from models.ts `oesophagus()`; see header. */
function shellRadius(t: number): number {
  return 0.0086 * (1 - 0.28 * Math.exp(-Math.pow((t - 0.97) / 0.035, 2)) - 0.2 * Math.exp(-Math.pow(t / 0.04, 2)));
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
 * Parallel-transported frames along a curve: at each sample a point, a tangent and two
 * perpendiculars that do not spin about the tangent. Used to run a strip along the tube
 * at a fixed angle round it without it corkscrewing.
 */
function framesAlong(curve: THREE.CatmullRomCurve3, count: number): Frame[] {
  const out: Frame[] = [];
  let prevN: THREE.Vector3 | null = null;
  for (let i = 0; i < count; i++) {
    const u = i / (count - 1);
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

export const parts: PartBuilder = () => {
  const points = oesophagusPoints();
  // Same spline settings as tubeAlong's defaults, which is what the shell used.
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
    false,
    'catmullrom',
    0.5,
  );
  const length = curve.getLength();

  // --- mucosa: the lining, a thinner tube that narrows with the shell at each end.
  const mucosa = tubeAlong(points, (t) => 0.62 * shellRadius(t), { tubular: 90, radial: 12 });

  // --- muscularis: circular bands every few millimetres, plus four longitudinal strips.
  const muscle: THREE.BufferGeometry[] = [];
  const bandSpacing = 0.0045;
  const bandCount = Math.floor(length / bandSpacing);
  for (let i = 1; i < bandCount; i++) {
    const u = i / bandCount;
    // Leave the two ends to the sphincters.
    if (u < 0.03 || u > 0.965) continue;
    muscle.push(ringAcross(curve.getPointAt(u), curve.getTangentAt(u).normalize(), 0.84 * shellRadius(u), 0.0006, 3, 12));
  }
  const frames = framesAlong(curve, 70);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const line: V3[] = frames.map((f, i) => {
      const r = 0.84 * shellRadius(i / (frames.length - 1));
      return [f.p.x + (f.n.x * ca + f.b.x * sa) * r, f.p.y + (f.n.y * ca + f.b.y * sa) * r, f.p.z + (f.n.z * ca + f.b.z * sa) * r];
    });
    muscle.push(tubeAlong(line, () => 0.0007, { tubular: 70, radial: 3 }));
  }

  // --- sphincters: two thick rings each, a millimetre or so apart, so they read as
  // a short thickened zone rather than a wire.
  const sphincter = (u: number, major: number, minor: number, along: number[]): THREE.BufferGeometry => {
    const rings = along.map((d) => {
      const uu = Math.min(0.999, Math.max(0.001, u + d / length));
      return ringAcross(curve.getPointAt(uu), curve.getTangentAt(uu).normalize(), major, minor, 6, 16);
    });
    return mergeParts(rings);
  };
  const upper = sphincter(0.012, 0.0058, 0.001, [-0.0012, 0.0012]);
  const lower = sphincter(0.97, 0.0045, 0.0012, [-0.0016, 0.0, 0.0016]);

  // --- mucous glands: a seeded scatter of small bumps on the mucosal surface.
  const rand = mulberry32(0x0e50);
  const glands: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 42; i++) {
    const u = 0.08 + 0.84 * rand();
    const a = rand() * Math.PI * 2;
    const f = frames[Math.min(frames.length - 1, Math.round(u * (frames.length - 1)))];
    const r = 0.62 * shellRadius(u);
    const bump = new THREE.SphereGeometry(0.0008, 4, 3);
    bump.translate(
      f.p.x + (f.n.x * Math.cos(a) + f.b.x * Math.sin(a)) * r,
      f.p.y + (f.n.y * Math.cos(a) + f.b.y * Math.sin(a)) * r,
      f.p.z + (f.n.z * Math.cos(a) + f.b.z * Math.sin(a)) * r,
    );
    glands.push(bump);
  }

  return [
    { id: 'upper_sphincter', geometry: warpGeometry(upper) },
    { id: 'mucosa', geometry: warpGeometry(mucosa) },
    { id: 'muscularis', geometry: warpGeometry(mergeParts(muscle)) },
    { id: 'submucosal_glands', geometry: warpGeometry(mergeParts(glands)) },
    { id: 'lower_sphincter', geometry: warpGeometry(lower) },
  ];
};
