import * as THREE from 'three';
import type { PartBuilder } from '../parts';
import { giPath, giSegment, warpGeometry } from '../layout';
import { APPENDIX_PATH } from '../models';
import { mulberry32 } from '../noise';
import { mergeParts, tubeAlong } from '../sdf';
import type { V3 } from '../sdf';

/**
 * INTERIOR PARTS OF THE LARGE INTESTINE.
 *
 * WHAT THIS DRAWS. The shell in models.ts is one tube swept along the caecum, ascending,
 * transverse, descending and sigmoid colon and the rectum, with a haustral ripple, plus the
 * appendix off the base of the caecum. Inside it we draw, from the outside in: the six
 * segments and the appendix as glass tubes (they carry the contents, so they must not hide
 * them); the three taeniae coli, the longitudinal muscle bands that run the length of the
 * colon on its surface; the haustra, drawn as the semilunar folds that mark the pouches
 * between the bands; a glass mucosal lining; and the faecal contents as a string of solid
 * masses.
 *
 * HOW IT STAYS INSIDE THE SHELL. Everything is built on the SAME spline the shell is swept
 * along (the whole giPath, tension 0.45, parametrised by arc length) so the frame lines up
 * exactly, and every radius is a fixed fraction of the shell's own calibre function, which
 * is copied below from `intestineLarge()` because models.ts does not export it (only
 * APPENDIX_PATH is). If that function changes, change `shellRadius` and `CALIBRE` to match.
 * The segments are sub-ranges of the one spline, cut where the authored centrelines meet.
 * The shell's calibre is interpolated by index along the authored points, not by arc length,
 * and this file does the same, for the same reason: the match is then exact.
 *
 * WHAT IT DOES NOT DO. The taeniae are round cords, not flat ribbons; the haustra do not
 * move; the rectum's three transverse folds, the anal canal's sphincters and the crypts of
 * the mucosa are not drawn. The 'haustra' part is the fold at each constriction, not the
 * pouch itself, which is the glass segment's own bulging outline.
 *
 * Built in unexploded body coordinates, then passed through `warpGeometry` exactly as the
 * shell is.
 */

const TENSION = 0.45;
const SEGMENTS = ['caecum', 'colon_ascending', 'colon_transverse', 'colon_descending', 'colon_sigmoid', 'rectum'] as const;
const CALIBRE: Record<string, number> = {
  caecum: 0.0235,
  colon_ascending: 0.021,
  colon_transverse: 0.019,
  colon_descending: 0.0165,
  colon_sigmoid: 0.0145,
  rectum: 0.018,
};
/** Number of haustral half-waves in the shell's ripple, copied from models.ts (sin^2(t * pi * 58)). */
const HAUSTRA = 58;

/** Fractions of the shell radius each layer is drawn at. */
const R_SEGMENT = 0.88;
const R_MUCOSA = 0.7;
const R_TAENIA = 0.8;

let cached: { curve: THREE.CatmullRomCurve3; calibre: number[] } | null = null;

function setup(): { curve: THREE.CatmullRomCurve3; calibre: number[] } {
  if (cached !== null) return cached;
  const calibre: number[] = [];
  for (const s of SEGMENTS) {
    const n = giSegment(s).length;
    for (let i = calibre.length === 0 ? 0 : 1; i < n; i++) calibre.push(CALIBRE[s]);
  }
  calibre[calibre.length - 1] = 0.008; // anal canal
  const curve = new THREE.CatmullRomCurve3(
    giPath([...SEGMENTS]).map((p) => new THREE.Vector3(p[0], p[1], p[2])),
    false,
    'catmullrom',
    TENSION,
  );
  cached = { curve, calibre };
  return cached;
}

/** The shell's calibre at arc fraction t, without the haustral ripple. */
function baseRadius(t: number): number {
  const { calibre } = setup();
  const f = t * (calibre.length - 1);
  const i = Math.min(calibre.length - 2, Math.floor(f));
  return calibre[i] + (calibre[i + 1] - calibre[i]) * (f - i);
}

/** How far the ripple has gathered the wall into a pouch at t: 0 at a constriction, 1 mid-pouch; fades over the rectum. */
function haustral(t: number): number {
  return Math.pow(Math.sin(t * Math.PI * HAUSTRA), 2) * Math.max(0, 1 - Math.max(0, t - 0.86) / 0.06);
}

/** The shell's radius at arc fraction t, copied from models.ts `intestineLarge()`. */
export function shellRadius(t: number): number {
  return baseRadius(t) * (0.9 + 0.2 * haustral(t));
}

/** The large-bowel spline: the shell's own. */
export function colonCurve(): THREE.CatmullRomCurve3 {
  return setup().curve;
}

function nearestU(curve: THREE.CatmullRomCurve3, p: V3): number {
  const n = 1500;
  const pts = curve.getSpacedPoints(n);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i <= n; i++) {
    const d = (pts[i].x - p[0]) ** 2 + (pts[i].y - p[1]) ** 2 + (pts[i].z - p[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i / n;
    }
  }
  return best;
}

/** Arc fraction at which each named segment ENDS (the last is 1). */
export function segmentEnds(): number[] {
  const curve = setup().curve;
  return SEGMENTS.map((s, i) => {
    if (i === SEGMENTS.length - 1) return 1;
    const pts = giSegment(s);
    return nearestU(curve, pts[pts.length - 1]);
  });
}

/** Points on the colon between two arc fractions, about every `step` metres, unwarped. */
export function colonPoints(u0: number, u1: number, step: number): V3[] {
  const curve = setup().curve;
  const n = Math.max(3, Math.ceil(((u1 - u0) * curve.getLength()) / step));
  const out: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const p = curve.getPointAt(u0 + ((u1 - u0) * i) / n);
    out.push([p.x, p.y, p.z]);
  }
  return out;
}

/** A point on the wall at arc fraction u, `frac` of the shell radius out, at angle `angle` round the bowel. */
export function wallPoint(u: number, frac: number, angle: number): V3 {
  const curve = setup().curve;
  const p = curve.getPointAt(u);
  const t = curve.getTangentAt(u).normalize();
  const ref = Math.abs(t.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const n = new THREE.Vector3().crossVectors(t, ref).normalize();
  const b = new THREE.Vector3().crossVectors(t, n).normalize();
  const r = frac * shellRadius(u);
  return [
    p.x + (n.x * Math.cos(angle) + b.x * Math.sin(angle)) * r,
    p.y + (n.y * Math.cos(angle) + b.y * Math.sin(angle)) * r,
    p.z + (n.z * Math.cos(angle) + b.z * Math.sin(angle)) * r,
  ];
}

const Z_AXIS = new THREE.Vector3(0, 0, 1);

function ringAcross(centre: THREE.Vector3, tangent: THREE.Vector3, major: number, minor: number, radial: number, tubular: number): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(major, minor, radial, tubular);
  const q = new THREE.Quaternion().setFromUnitVectors(Z_AXIS, tangent);
  g.applyMatrix4(new THREE.Matrix4().compose(centre, q, new THREE.Vector3(1, 1, 1)));
  return g;
}

/** A sub-range of the colon as a tube whose radius is `frac` times the shell's radius (ripple included unless `smooth`). */
function colonTube(u0: number, u1: number, frac: number, radial: number, smooth = false): THREE.BufferGeometry {
  const pts = colonPoints(u0, u1, 0.007);
  const at = (t: number): number => u0 + (u1 - u0) * t;
  return tubeAlong(pts, (t) => frac * (smooth ? 0.9 * baseRadius(at(t)) : shellRadius(at(t))), {
    tubular: Math.round(pts.length * (smooth ? 1.2 : 2.4)),
    radial,
    tension: 0.5,
  });
}

export const parts: PartBuilder = () => {
  const curve = setup().curve;
  const ends = segmentEnds();
  const starts = [0, ...ends.slice(0, -1)];
  const range = (k: number): [number, number] => [starts[k], ends[k]];

  // --- the six segments, glass in the detail module.
  const seg = SEGMENTS.map((_, k) => colonTube(range(k)[0], range(k)[1], R_SEGMENT, 8));

  // --- the appendix: a narrow blind tube, glass.
  const appendix = tubeAlong(APPENDIX_PATH, (t) => 0.8 * (0.0034 - 0.0012 * t), { tubular: 16, radial: 6 });

  // --- taeniae coli: three cords, 120 degrees apart, from the caecum to the end of the sigmoid
  // (they spread into the rectal wall's continuous longitudinal coat, which is not drawn).
  const stop = ends[4];
  const taeniae = [0.5, 0.5 + (2 * Math.PI) / 3, 0.5 + (4 * Math.PI) / 3].map((a) => {
    const n = Math.ceil((stop * curve.getLength()) / 0.01);
    const line: V3[] = [];
    for (let i = 0; i <= n; i++) line.push(wallPoint((stop * i) / n, R_TAENIA, a));
    return tubeAlong(line, () => 0.0008, { tubular: n, radial: 4, tension: 0.5 });
  });

  // --- haustra: a semilunar fold at each constriction of the ripple, fading over the rectum.
  const haustraFolds: THREE.BufferGeometry[] = [];
  for (let k = 1; k < HAUSTRA; k++) {
    const u = k / HAUSTRA;
    if (u > 0.86 || u < 0.01) continue;
    haustraFolds.push(ringAcross(curve.getPointAt(u), curve.getTangentAt(u).normalize(), 0.7 * baseRadius(u), 0.0014, 3, 10));
  }

  // --- mucosa: a smooth glass lining the whole length (the rectum included).
  const mucosa = colonTube(0, 1, R_MUCOSA, 6, true);

  // --- faecal contents: solid masses, fewer and denser than the small bowel's chyme.
  const rand = mulberry32(0xc010);
  const lumenPts = colonPoints(0, 1, 0.006);
  const masses = 34;
  const phase = Array.from({ length: masses }, () => rand() * 0.25);
  const lumen = tubeAlong(
    lumenPts,
    (t) => {
      const k = Math.min(masses - 1, Math.floor(t * masses));
      const x = t * masses - k;
      const bulge = Math.pow(Math.sin(Math.PI * Math.min(1, x + phase[k] * 0.3)), 2);
      return baseRadius(t) * 0.36 * (0.3 + 0.7 * bulge);
    },
    { tubular: lumenPts.length * 2, radial: 5, tension: 0.5 },
  );

  const w = (g: THREE.BufferGeometry): THREE.BufferGeometry => warpGeometry(g);
  return [
    { id: 'caecum', geometry: w(seg[0]) },
    { id: 'appendix', geometry: w(appendix) },
    { id: 'colon_ascending', geometry: w(seg[1]) },
    { id: 'colon_transverse', geometry: w(seg[2]) },
    { id: 'colon_descending', geometry: w(seg[3]) },
    { id: 'colon_sigmoid', geometry: w(seg[4]) },
    { id: 'rectum', geometry: w(seg[5]) },
    { id: 'taeniae_coli', geometry: w(mergeParts(taeniae)) },
    { id: 'haustra', geometry: w(mergeParts(haustraFolds)) },
    { id: 'lumen_contents', geometry: w(lumen) },
    { id: 'mucosa', geometry: w(mucosa) },
  ];
};
