import * as THREE from 'three';
import type { PartBuilder } from '../parts';
import { giPath, giSegment, warpGeometry } from '../layout';
import { APPENDIX_PATH } from '../models';
import { mulberry32 } from '../noise';
import { mergeParts, tubeAlong } from '../sdf';
import type { V3 } from '../sdf';
import { blobAlong, frameAt, lengthwiseCord, placed, ribbon } from './gi_shared';

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
 * FINER STRUCTURES (textbook-depth pass). The hepatic flexure (end of the ascending colon) and
 * the splenic flexure (end of the transverse colon) are short glass sleeves just wider than
 * the segments they join. The epiploic appendages are a scatter of small fatty tags on the
 * transverse, descending and sigmoid colon (their number and positions are schematic). The
 * mesocolon is two flat fans, one for the transverse and one for the sigmoid colon. The rectum
 * has three transverse folds drawn as half-rings on alternating sides. The ANAL CANAL is the
 * last stretch of the path (`ANAL_START`, a drawing proportion of the arc, not a measured
 * length); inside it the anal columns are longitudinal ridges, the pectinate line a closed
 * zigzag, and the two sphincters thick ring clusters (internal inside, external outside). In
 * the mucosa, ONE small enlarged patch of two colonic crypts stands on the wall of the
 * ascending colon with its goblet cells and columnar surface cells, drawn many times life size;
 * cell counts and positions are schematic. The ileocaecal valve is drawn by the small-intestine
 * atlas (its `ileocaecal_junction` part) and is not repeated here.
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
/** Where the anal canal begins, as an arc fraction of the whole path: a drawing proportion, not a length. */
export const ANAL_START = 0.95;
/** Arc fractions of the three rectal transverse folds (drawing proportions). */
const RECTAL_FOLDS = [0.895, 0.92, 0.94] as const;
/** Size of one enlarged colonic crypt in its own frame (display choice). */
const CRYPT_H = 0.0055;
/** Where the enlarged crypt patch stands: arc fraction in the ascending colon, and angle round it. */
const CRYPT_AT = { u: 0.12, angle: 1.9 } as const;
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

  // ===================================================================================
  // FINER STRUCTURES
  // ===================================================================================
  const flexure = (u: number): THREE.BufferGeometry => colonTube(u - 0.02, u + 0.02, 0.94, 8, true);

  const tagRand = mulberry32(0xe91c);
  const tags: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 42; i++) {
    // On the transverse colon (after the hepatic flexure) and everything down to the sigmoid's end.
    const u = ends[1] + 0.04 + (ends[4] - ends[1] - 0.08) * tagRand();
    const a = tagRand() * Math.PI * 2;
    const base = wallPoint(u, 1.0, a);
    const far = wallPoint(u, 1.25, a);
    const dir: V3 = [far[0] - base[0], far[1] - base[1], far[2] - base[2]];
    const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const reach = 0.0026 + 0.0012 * tagRand();
    tags.push(blobAlong([base[0] + (dir[0] / l) * reach, base[1] + (dir[1] / l) * reach, base[2] + (dir[2] / l) * reach], dir, reach, 0.0013, 6, 4));
  }

  const mesoTop = (u0: number, u1: number): V3[] => Array.from({ length: 16 }, (_, i) => wallPoint(u0 + ((u1 - u0) * i) / 15, 1.0, Math.PI * 0.6));
  const transTop = mesoTop(ends[1] + 0.02, ends[2] - 0.02);
  const sigTop = mesoTop(ends[3] + 0.02, ends[4] - 0.02);
  const mesocolon = mergeParts([
    ribbon(transTop, transTop.map((q): V3 => [q[0], -0.048, -0.02])),
    ribbon(sigTop, sigTop.map((q): V3 => [q[0], q[1] + 0.012, q[2] - 0.022])),
  ]);

  // Rectal folds: half-rings on alternating sides, protruding into the lumen.
  const rectalFolds = mergeParts(
    RECTAL_FOLDS.map((u, k) => {
      const g = new THREE.TorusGeometry(0.72 * shellRadius(u), 0.0012, 4, 10, Math.PI);
      const t = curve.getTangentAt(u).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(Z_AXIS, t);
      const spin = new THREE.Quaternion().setFromAxisAngle(t, k * 2.1 + 0.4);
      g.applyMatrix4(new THREE.Matrix4().compose(curve.getPointAt(u), spin.multiply(q), new THREE.Vector3(1, 1, 1)));
      return g;
    }),
  );

  const analCanal = colonTube(ANAL_START, 1, 0.85, 8, true);
  const analColumns = mergeParts(
    [0, 1, 2, 3, 4, 5].map((k) => lengthwiseCord(curve, ANAL_START + 0.004, 0.978, 8, (k * Math.PI) / 3, (u) => 0.58 * shellRadius(u), 0.0006)),
  );
  const pectinateU = 0.975;
  const pf = frameAt(curve, pectinateU);
  const pectinate = ((): THREE.BufferGeometry => {
    const zig: V3[] = [];
    const teeth = 10;
    for (let i = 0; i < teeth * 2; i++) {
      const a = (i / (teeth * 2)) * Math.PI * 2;
      const r = 0.62 * shellRadius(pectinateU);
      const lift = (i % 2 === 0 ? 1 : -1) * 0.0007;
      zig.push([
        pf.p.x + (pf.n.x * Math.cos(a) + pf.b.x * Math.sin(a)) * r + pf.t.x * lift,
        pf.p.y + (pf.n.y * Math.cos(a) + pf.b.y * Math.sin(a)) * r + pf.t.y * lift,
        pf.p.z + (pf.n.z * Math.cos(a) + pf.b.z * Math.sin(a)) * r + pf.t.z * lift,
      ]);
    }
    return tubeAlong(zig, () => 0.0003, { tubular: teeth * 6, radial: 3, closed: true, tension: 0.2 });
  })();
  const sphincterRings = (us: number[], frac: number, minor: number): THREE.BufferGeometry =>
    mergeParts(us.map((u) => ringAcross(curve.getPointAt(u), curve.getTangentAt(u).normalize(), frac * shellRadius(u), minor, 5, 14)));
  const internalSphincter = sphincterRings([0.958, 0.966, 0.974, 0.982], 0.74, 0.0011);
  const externalSphincter = sphincterRings([0.972, 0.982, 0.992], 0.82, 0.0009);

  // --- the enlarged colonic crypts, built in a local frame (base y = 0, mouth y = CRYPT_H) and stood
  // on the wall of the ascending colon, pointing at the lumen.
  const cryptFrame = frameAt(curve, CRYPT_AT.u);
  const cryptOrigin = wallPoint(CRYPT_AT.u, 0.69, CRYPT_AT.angle);
  const cryptUp: V3 = ((): V3 => {
    const o = wallPoint(CRYPT_AT.u, 1.0, CRYPT_AT.angle);
    const c = cryptFrame.p;
    return [c.x - o[0], c.y - o[1], c.z - o[2]];
  })();
  const cryptLocal = (build: (xo: number) => THREE.BufferGeometry[]): THREE.BufferGeometry =>
    mergeParts([-0.0017, 0.0017].flatMap((xo) => build(xo)).map((g) => placed(g, cryptOrigin, cryptUp, 1)));
  const cr = mulberry32(0xc7a9);
  const cryptTubes = cryptLocal((xo) => [tubeAlong([[xo, CRYPT_H + 0.0004, 0], [xo, CRYPT_H * 0.5, 0], [xo, 0, 0]], () => 0.0009, { tubular: 10, radial: 7 })]);
  const gobletCells = cryptLocal((xo) => Array.from({ length: 9 }, (_, i) => {
    const a = (i / 9) * Math.PI * 2 + cr() * 0.5;
    return blobAlong([xo + Math.cos(a) * 0.0012, 0.0006 + (i / 9) * (CRYPT_H - 0.0014), Math.sin(a) * 0.0012], [0, 1, 0], 0.0007, 0.0005, 6, 4);
  }));
  const colonocytes = cryptLocal((xo) => Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2;
    return blobAlong([xo + Math.cos(a) * 0.0017, CRYPT_H + 0.0006, Math.sin(a) * 0.0017], [0, 1, 0], 0.0008, 0.0004, 6, 4);
  }));

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
    // --- finer structures
    { id: 'hepatic_flexure', geometry: w(flexure(ends[1])) },
    { id: 'splenic_flexure', geometry: w(flexure(ends[2])) },
    { id: 'epiploic_appendages', geometry: w(mergeParts(tags)) },
    { id: 'mesocolon', geometry: w(mesocolon) },
    { id: 'rectal_transverse_folds', geometry: w(rectalFolds) },
    { id: 'anal_canal', geometry: w(analCanal) },
    { id: 'anal_columns', geometry: w(analColumns) },
    { id: 'pectinate_line', geometry: w(pectinate) },
    { id: 'internal_anal_sphincter', geometry: w(internalSphincter) },
    { id: 'external_anal_sphincter', geometry: w(externalSphincter) },
    { id: 'colonic_crypts', geometry: w(cryptTubes) },
    { id: 'goblet_cells', geometry: w(gobletCells) },
    { id: 'colonocytes', geometry: w(colonocytes) },
  ];
};
