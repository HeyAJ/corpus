import * as THREE from 'three';
import type { PartBuilder } from '../parts';
import { giSegment, warpGeometry } from '../layout';
import { mulberry32 } from '../noise';
import { mergeParts, tubeAlong } from '../sdf';
import type { V3 } from '../sdf';
import { aroundFrame, blob, frameAt, helixCord, lengthwiseCord, stick } from './gi_shared';

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
 * FINER STRUCTURES (added in the textbook-depth pass). The wall is now drawn layer by layer,
 * from the lumen out, each as a child of the part that holds it: the epithelium, lamina propria
 * and muscularis mucosae inside the mucosa; a submucosa (its own part) with its mucous glands and
 * its submucosal (Meissner) plexus; the inner circular and outer longitudinal muscle, the
 * striated upper and smooth lower zones and the myenteric (Auerbach) plexus inside the muscular
 * coat; and an adventitia over everything. Four rings mark the narrowings (the cricopharyngeal,
 * aortic arch, left main bronchus and diaphragmatic constrictions) and a zigzag ring marks the
 * Z-line at the gastro-oesophageal junction. Radii are fixed fractions of the shell calibre, in
 * the order the layers lie: lumen 0.3, epithelium 0.46, lamina propria 0.52, muscularis mucosae
 * 0.555, mucosa 0.58, submucosa 0.66, inner circular 0.76, myenteric 0.79, longitudinal 0.835,
 * wall segments 0.9, adventitia 0.96. Those fractions are drawing proportions that keep the
 * layers apart so they can be told apart; they are NOT the real relative thicknesses.
 *
 * WHERE THE NARROWINGS SIT is a drawing proportion (`NARROWING_AT`, arc fractions of the
 * path), chosen to put the aortic and bronchial rings in the chest and the diaphragmatic one
 * near the hiatus; it was not measured from the body model and no distance is stated
 * anywhere, because the textbook distances are not reproduced here. The cricopharyngeal ring
 * is drawn a little below the upper sphincter, which is the same place in the body: the
 * sphincter part is the muscle, the narrowing part is the lumen it closes.
 *
 * WHAT IT DOES NOT DO. It does not model the real thickness of the wall layers (the muscle
 * coat is drawn as thin bands, not as a 3 mm shell). The striated-above, smooth-below
 * change is drawn as two sleeves with a gap between them where the textbook says the two
 * types mix; the bands themselves are drawn alike. The
 * sphincters are rings, not the crural slings and oblique fibres Gray's describes, and the
 * plexuses are decorative braids, not a traced nerve map. The submucosal glands are drawn as
 * a sparse scatter of enlarged flasks, many times life size.
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

/** Arc fractions of the four narrowings and the Z-line. Drawing proportions, not measurements (see header). */
export const NARROWING_AT = { cricopharyngeal: 0.04, aortic_arch: 0.4, bronchial: 0.5, diaphragmatic: 0.9 } as const;
export const Z_LINE_AT = 0.984;
/** Where the striated coat ends and the smooth coat begins, as arc fractions: the middle is the mixed zone. */
export const STRIATED_END = 0.36;
export const SMOOTH_START = 0.62;

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

  // ===================================================================================
  // FINER STRUCTURES (children of the wall layers; see the header for the radius order).
  // ===================================================================================
  const rOf = (frac: number) => (u: number): number => frac * shellRadius(u);

  // --- inside the mucosa: three nested layers, innermost first.
  const epithelium = segment(0.02, 0.985, 0.46, 8);
  const laminaPropria = segment(0.02, 0.985, 0.52, 8);
  const mucosalMuscle: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) mucosalMuscle.push(lengthwiseCord(curve, 0.03, 0.97, 24, (k * Math.PI) / 2, rOf(0.555), 0.00035));

  // --- the submucosa and what lies in it.
  const submucosa = segment(0.0, 1, 0.66, 8);
  const glandRand = mulberry32(0x0e50);
  const glands: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 20; i++) {
    const u = 0.08 + 0.86 * glandRand();
    const a = glandRand() * Math.PI * 2;
    const f = frameAt(curve, u);
    // The flask sits in the submucosa; a thin duct runs inward through the mucosa to the lumen.
    const body = aroundFrame(f, a, 0.665 * shellRadius(u));
    glands.push(blob(body, 0.0007, 6, 4));
    glands.push(stick(body, aroundFrame(f, a, 0.5 * shellRadius(u)), 0.00018));
  }
  const meissner: THREE.BufferGeometry[] = [
    helixCord(curve, 0.02, 0.98, 60, 9, 0, rOf(0.63), 0.00022),
    helixCord(curve, 0.02, 0.98, 60, -9, Math.PI, rOf(0.63), 0.00022),
  ];

  // --- inside the muscular coat: the two layers, the two kinds of muscle and the plexus between.
  const innerCircular: THREE.BufferGeometry[] = [];
  const innerCount = Math.floor(length / 0.009);
  for (let i = 1; i < innerCount; i++) {
    const u = i / innerCount;
    if (u < 0.03 || u > 0.965) continue;
    innerCircular.push(ringAcross(curve.getPointAt(u), curve.getTangentAt(u).normalize(), 0.76 * shellRadius(u), 0.00045, 3, 8));
  }
  const outerLong: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 6; k++) outerLong.push(lengthwiseCord(curve, 0.02, 0.975, 30, (k * Math.PI) / 3 + 0.2, rOf(0.835), 0.0006));
  const striated = segment(0.02, STRIATED_END, 0.785, 10);
  const smoothZone = segment(SMOOTH_START, 0.975, 0.785, 10);
  const auerbach: THREE.BufferGeometry[] = [
    helixCord(curve, 0.02, 0.98, 60, 11, Math.PI / 3, rOf(0.79), 0.00024),
    helixCord(curve, 0.02, 0.98, 60, -11, (4 * Math.PI) / 3, rOf(0.79), 0.00024),
  ];

  // --- the adventitia: the loose outer sleeve that fastens the tube to its neighbours.
  const adventitia = segment(0, 1, 0.96, 8);

  // --- the narrowings: a thickened ring that protrudes into the lumen at four places.
  const narrowing = (u: number): THREE.BufferGeometry =>
    ringAcross(curve.getPointAt(u), curve.getTangentAt(u).normalize(), 0.7 * shellRadius(u), 0.0012, 6, 16);

  // --- the Z-line: the ragged border where the squamous lining meets the stomach's lining,
  // drawn as a closed zigzag round the mucosal surface.
  const zf = frameAt(curve, Z_LINE_AT);
  const zig: V3[] = [];
  const teeth = 14;
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2;
    const p = aroundFrame(zf, a, 0.6 * shellRadius(Z_LINE_AT));
    const lift = (i % 2 === 0 ? 1 : -1) * 0.0012;
    zig.push([p[0] + zf.t.x * lift, p[1] + zf.t.y * lift, p[2] + zf.t.z * lift]);
  }
  const zLine = tubeAlong(zig, () => 0.00032, { tubular: teeth * 6, radial: 3, closed: true, tension: 0.2 });

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
    // --- finer structures
    { id: 'epithelium', geometry: w(epithelium) },
    { id: 'lamina_propria', geometry: w(laminaPropria) },
    { id: 'muscularis_mucosae', geometry: w(mergeParts(mucosalMuscle)) },
    { id: 'submucosa', geometry: w(submucosa) },
    { id: 'submucosal_glands', geometry: w(mergeParts(glands)) },
    { id: 'submucosal_plexus', geometry: w(mergeParts(meissner)) },
    { id: 'inner_circular_muscle', geometry: w(mergeParts(innerCircular)) },
    { id: 'outer_longitudinal_muscle', geometry: w(mergeParts(outerLong)) },
    { id: 'striated_muscle_zone', geometry: w(striated) },
    { id: 'smooth_muscle_zone', geometry: w(smoothZone) },
    { id: 'myenteric_plexus', geometry: w(mergeParts(auerbach)) },
    { id: 'adventitia', geometry: w(adventitia) },
    { id: 'narrowing_cricopharyngeal', geometry: w(narrowing(NARROWING_AT.cricopharyngeal)) },
    { id: 'narrowing_aortic_arch', geometry: w(narrowing(NARROWING_AT.aortic_arch)) },
    { id: 'narrowing_bronchial', geometry: w(narrowing(NARROWING_AT.bronchial)) },
    { id: 'narrowing_diaphragmatic', geometry: w(narrowing(NARROWING_AT.diaphragmatic)) },
    { id: 'gastro_oesophageal_junction', geometry: w(zLine) },
  ];
};
