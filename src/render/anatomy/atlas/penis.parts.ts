import * as THREE from 'three';
import type { PartBuilder } from '../parts';
import { chain, ellipsoid, mergeParts, polygonise, tubeAlong, type V3 } from '../sdf';
import { mulberry32 } from '../noise';
import { arcPoints, coilAround, norm, oval, ovals, perp } from './kidney.parts';

/**
 * THE INSIDE OF THE PENIS.
 *
 * The shaft is built round three columns of erectile tissue in a common sleeve of fascia.
 * Two CORPORA CAVERNOSA lie side by side on the upper (dorsal) side; each is wrapped in
 * the dense fibrous tunica albuginea, and each begins at the back as a crus attached to the
 * pubic bone. The single CORPUS SPONGIOSUM lies beneath them on the lower (ventral) side,
 * swells at the back into the bulb and at the front into the glans, and carries the urethra
 * from the bulb to the opening at the tip. Each corpus cavernosum is supplied by a deep
 * (cavernosal) artery running down its core; two dorsal arteries and a single deep dorsal
 * vein run along the upper surface, and the vein drains the shaft. In erection the arterial
 * inflow rises, the cavernous spaces fill and press the draining veins against the tunica,
 * which restricts the outflow (GRAYS42, GH14).
 *
 * FRAME. The frame of the shell in models.ts: origin at the root of the shaft, +x the
 * patient's right, +y cranial, +z anterior. The shell is a chain of four points, from the
 * root [0, 0, 0] to [0, -66, 40] mm, of radius about 11 mm, with the glans an oval beyond its
 * end, the bulb behind its root, and the two crura running up and back. Here the "dorsal" side
 * of the shaft is the side facing forward and up, because the shell hangs the shaft down and
 * forward: at every point along it the dorsal direction is perpendicular to the shaft in the
 * plane of the drawing, and the corpora, vessels and urethra are placed by their offsets from
 * the shaft's axis in that frame. The shaft's axis here is the shell's own chain of straight
 * segments, so the parts follow its pose and do not change it. The tunica is the shell's
 * chain 1.2 mm thinner, and everything inside it is kept within 9.2 mm of the axis.
 *
 * FINER STRUCTURES (the bottom of `parts`). The root (crura, bulb), its two muscles, Buck fascia,
 * the suspensory ligament, prepuce, frenulum, fossa, orifice and dorsal nerves are level-1; the
 * cavernous spaces, helicine arteries and trabeculae are drawn inside EACH corpus cavernosum
 * (the left one has its own copies, `_left`, so selecting either shows its children). The
 * first version left these out as too fine; they are drawings, not counts: 28 spaces, 8
 * coiled arteries and 12 strands a side are chosen to be seen.
 *
 * WHAT WAS DONE FOR THE EYE. The columns are drawn as round tubes of rounded sizes laid out
 * to fit the sleeve; real cross-sections are not circles and the proportions of the three
 * columns vary along the shaft. The two corpora are shown touching, where the septum
 * between them would be. The glans is drawn as a simple oval, without the corona, and the
 * circumflex veins and the fascial layers are not drawn. How full the tissue is, is shown by
 * colour, glow and the speed of the streams in the detail module, never by a change of the
 * shaft's size or pose.
 */

/** The shaft's axis, as in models.ts. */
const AX: V3[] = [
  [0, 0, 0],
  [0, -0.012, 0.022],
  [0, -0.04, 0.036],
  [0, -0.066, 0.04],
];
const SEG = AX.slice(1).map((p, i) => Math.hypot(p[0] - AX[i][0], p[1] - AX[i][1], p[2] - AX[i][2]));
const TOTAL = SEG.reduce((a, b) => a + b, 0);

/** A point on the axis at fraction u of its length. */
function axisAt(u: number): V3 {
  let d = Math.min(1, Math.max(0, u)) * TOTAL;
  for (let i = 0; i < SEG.length; i++) {
    if (d <= SEG[i] || i === SEG.length - 1) {
      const f = Math.min(1, d / SEG[i]);
      const a = AX[i];
      const b = AX[i + 1];
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    }
    d -= SEG[i];
  }
  return AX[AX.length - 1];
}

/** Unit direction of the dorsal side at u: perpendicular to the (smoothed) shaft direction. */
function dorsalAt(u: number): V3 {
  const a = axisAt(Math.max(0, u - 0.05));
  const b = axisAt(Math.min(1, u + 0.05));
  const ty = b[1] - a[1];
  const tz = b[2] - a[2];
  const l = Math.hypot(ty, tz) || 1;
  // The shaft runs down and forward (ty < 0, tz > 0); rotating its direction a quarter turn
  // in the y-z plane gives the side that faces up and forward.
  return [0, tz / l, -ty / l];
}

/** The position `x` to the patient's right and `n` toward the dorsal side of the axis at u. */
function at(u: number, x: number, n: number): V3 {
  const a = axisAt(u);
  const d = dorsalAt(u);
  return [a[0] + x, a[1] + d[1] * n, a[2] + d[2] * n];
}

const CAV_X = 0.0044;
const CAV_N = 0.0016;
const US = [0.06, 0.13, 0.2, 0.27, 0.34, 0.41, 0.48, 0.55, 0.62, 0.69, 0.76, 0.83, 0.9];

/** The core of one corpus cavernosum, from the end of its crus to the back of the glans. */
export function cavernosumPath(s: number): V3[] {
  return [
    [s * 0.02, 0.0156, -0.0268],
    [s * 0.012, 0.0108, -0.0204],
    [s * 0.0075, 0.0045, -0.0085],
    ...US.map((u) => at(u, s * CAV_X, CAV_N)),
  ];
}

/** The deep (cavernosal) artery, along the core of the same corpus. */
export function cavernosalArteryPath(s: number): V3[] {
  return cavernosumPath(s);
}

/** One dorsal artery, along the upper surface from the root toward the glans. */
export function dorsalArteryPath(s: number): V3[] {
  return [0.02, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.96].map((u) => at(u, s * 0.0022, 0.0078));
}

/** The deep dorsal vein, from the glans back toward the root: the direction of the blood. */
export function dorsalVeinPath(): V3[] {
  return [0.96, 0.88, 0.78, 0.68, 0.58, 0.48, 0.38, 0.28, 0.18, 0.08, 0.03].map((u) => at(u, 0, 0.0082));
}

/** The urethra: from the bulb, along the spongiosum, to the opening at the tip of the glans. */
export function urethraPath(): V3[] {
  return [[0, 0.003, -0.0095], [0, 0.0, -0.004], ...[0.06, 0.2, 0.34, 0.48, 0.62, 0.76, 0.9, 1.0].map((u) => at(u, 0, -0.0058)), [0, -0.077, 0.039], [0, -0.0845, 0.0405]];
}

const GLANS_C: V3 = [0, -0.076, 0.041];
const GLANS_R: V3 = [0.0113, 0.0108, 0.0113];

/** Radius of a corpus cavernosum at fraction t along its tube: the crus tapers in, the end tapers off. */
const cavRadius = (t: number): number => (t < 0.33 ? 0.0025 + (0.0045 - 0.0025) * (t / 0.33) : t > 0.9 ? 0.0045 - 0.0015 * ((t - 0.9) / 0.1) : 0.0045);

export const parts: PartBuilder = () => {
  const out: { id: string; geometry: THREE.BufferGeometry }[] = [];

  // The tunica albuginea: the shell's own chain, 1.2 mm thinner, as a closed sleeve.
  out.push({
    id: 'tunica_albuginea',
    geometry: polygonise(chain(AX, [0.0098, 0.0103, 0.0098, 0.0093]), [-0.0125, -0.0775, -0.0125], [0.0125, 0.0115, 0.0525], { cell: 0.0016 }),
  });

  // The two corpora cavernosa. A crus tapers into the shaft, and the end tapers at the glans.
  out.push({ id: 'corpus_cavernosum_right', geometry: tubeAlong(cavernosumPath(1), cavRadius, { tubular: 80, radial: 12 }) });
  out.push({ id: 'corpus_cavernosum_left', geometry: tubeAlong(cavernosumPath(-1), cavRadius, { tubular: 80, radial: 12 }) });

  // The corpus spongiosum: the bulb and a narrower column under the cavernosa.
  const spongiosum: THREE.BufferGeometry[] = [
    polygonise(ellipsoid([0, 0.003, -0.0105], [0.0085, 0.0068, 0.0095]), [-0.0095, -0.005, -0.022], [0.0095, 0.012, -0.0005], { cell: 0.001 }),
    tubeAlong(
      [[0, 0.003, -0.0095], [0, 0.0, -0.004], ...[0.06, 0.2, 0.34, 0.48, 0.62, 0.76, 0.9].map((u) => at(u, 0, -0.0058))],
      (t) => 0.0034 - 0.0006 * t,
      { tubular: 56, radial: 10 },
    ),
  ];
  out.push({ id: 'corpus_spongiosum', geometry: mergeParts(spongiosum) });

  out.push({
    id: 'glans_penis',
    geometry: polygonise(ellipsoid(GLANS_C, GLANS_R), [-0.0125, -0.0885, 0.0285], [0.0125, -0.0635, 0.0535], { cell: 0.0012 }),
  });

  out.push({ id: 'urethra', geometry: tubeAlong(urethraPath(), () => 0.0012, { tubular: 60, radial: 8 }) });

  out.push({
    id: 'cavernosal_arteries',
    geometry: mergeParts([1, -1].map((s) => tubeAlong(cavernosalArteryPath(s), () => 0.0006, { tubular: 70, radial: 6 }))),
  });
  out.push({
    id: 'dorsal_arteries',
    geometry: mergeParts([1, -1].map((s) => tubeAlong(dorsalArteryPath(s), () => 0.0006, { tubular: 60, radial: 6 }))),
  });
  out.push({ id: 'deep_dorsal_vein', geometry: tubeAlong(dorsalVeinPath(), () => 0.0009, { tubular: 60, radial: 8 }) });
  /* ====================================================== FINER STRUCTURES ===== */
  // Level-1 gaps and the children of the two corpora cavernosa (src/data/anatomy/penis.json).
  // Schematic throughout: counts and sizes are drawing choices.
  const dirAt = (u: number): V3 => {
    const a = axisAt(Math.max(0, u - 0.03));
    const b = axisAt(Math.min(1, u + 0.03));
    return norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  };

  // Root: the crura (the first stretch of each cavernosum, drawn inside it) and the bulb.
  out.push({ id: 'crura_of_penis', geometry: mergeParts([1, -1].map((s) => tubeAlong(cavernosumPath(s).slice(0, 4), (t) => 0.0019 + 0.0012 * t, { tubular: 16, radial: 8 }))) });
  out.push({ id: 'bulb_of_penis', geometry: oval([0, 0.003, -0.0105], [0.0072, 0.0058, 0.0082]) });
  // Muscles of the root: the bulbospongiosus a glass oval over the bulb, each ischiocavernosus a
  // sleeve over a crus. Both stay inside the shell's own crura and bulb.
  out.push({ id: 'bulbospongiosus', geometry: oval([0, 0.0035, -0.011], [0.0102, 0.0082, 0.0115]) });
  out.push({ id: 'ischiocavernosus', geometry: mergeParts([1, -1].map((s) => tubeAlong(cavernosumPath(s).slice(0, 4), (t) => 0.0034 + 0.0006 * t, { tubular: 16, radial: 8 }))) });

  // Buck fascia: a sleeve round all three columns, 0.5 mm inside the shell.
  out.push({
    id: 'deep_fascia',
    geometry: polygonise(chain(AX, [0.0105, 0.011, 0.0105, 0.01]), [-0.0125, -0.0775, -0.0125], [0.0125, 0.0115, 0.0525], { cell: 0.0026 }),
  });
  // Suspensory ligament: a flat band from the front of the pubic bone to the top of the shaft.
  const lig0: V3 = [0, 0.024, 0.011];
  const lig1 = at(0.04, 0, 0.0092);
  const ligMid: V3 = [(lig0[0] + lig1[0]) / 2, (lig0[1] + lig1[1]) / 2, (lig0[2] + lig1[2]) / 2];
  const ligLen = Math.hypot(lig1[0] - lig0[0], lig1[1] - lig0[1], lig1[2] - lig0[2]);
  out.push({ id: 'suspensory_ligament', geometry: oval(ligMid, [0.0038, 0.0007, ligLen / 2], [lig1[0] - lig0[0], lig1[1] - lig0[1], lig1[2] - lig0[2]]) });

  // Glans end: the prepuce as a loose glass sleeve over the base of the glans, the frenulum a
  // small fold under it, the fossa a widening of the urethra and the orifice a ring at the tip.
  const sleeveEnd: V3 = [0, -0.0725, 0.0405];
  out.push({ id: 'prepuce', geometry: tubeAlong([axisAt(0.8), axisAt(0.92), axisAt(1), sleeveEnd], () => 0.0106, { tubular: 16, radial: 14 }) });
  const dd = dorsalAt(0.97);
  out.push({ id: 'frenulum', geometry: oval([GLANS_C[0], GLANS_C[1] - dd[1] * 0.0098 - 0.0012, GLANS_C[2] - dd[2] * 0.0098], [0.0007, 0.0008, 0.0035], dirAt(1)) });
  out.push({ id: 'navicular_fossa', geometry: oval([0, -0.0795, 0.0394], [0.0017, 0.0017, 0.0024], [0, -0.0075, 0.0015]) });
  out.push({ id: 'external_urethral_orifice', geometry: tubeAlong(arcPoints([0, -0.0845, 0.0405], [0, -0.0075, 0.0015], 0.0012, 0, Math.PI * 2 * 0.95, 10), () => 0.0003, { tubular: 20, radial: 5, closed: true }) });
  // Dorsal nerves: one each side of the dorsal arteries, a little farther out.
  out.push({
    id: 'dorsal_nerves',
    geometry: mergeParts([1, -1].map((s) => tubeAlong([0.02, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.96].map((u) => at(u, s * 0.0046, 0.0079)), () => 0.0004, { tubular: 60, radial: 5 }))),
  });

  // Inside each corpus cavernosum: the cavernous spaces (ovals), helicine arteries (small
  // coiled branches of the core artery) and trabeculae (strands crossing between spaces).
  // Positions are found on the same curve the corpus tube is swept along, so they stay inside it.
  for (const [s, suffix] of [[1, ''], [-1, '_left']] as [number, string][]) {
    const pts = cavernosumPath(s);
    const curve = new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(q[0], q[1], q[2])), false, 'catmullrom', 0.5);
    const frameAt = (t: number): { c: V3; e1: V3; e2: V3; r: number } => {
      const c = curve.getPointAt(t);
      const tg = curve.getTangentAt(t);
      const [e1, e2] = perp([tg.x, tg.y, tg.z]);
      return { c: [c.x, c.y, c.z], e1, e2, r: cavRadius(t) };
    };
    const place = (t: number, rho: number, ang: number): V3 => {
      const f = frameAt(t);
      return [f.c[0] + (f.e1[0] * Math.cos(ang) + f.e2[0] * Math.sin(ang)) * f.r * rho, f.c[1] + (f.e1[1] * Math.cos(ang) + f.e2[1] * Math.sin(ang)) * f.r * rho, f.c[2] + (f.e1[2] * Math.cos(ang) + f.e2[2] * Math.sin(ang)) * f.r * rho];
    };
    const rnd = mulberry32(0x5e71 + (s > 0 ? 0 : 97));
    const spaces: { c: V3; r: V3 }[] = [];
    for (let k = 0; k < 28; k++) {
      const t = 0.1 + 0.8 * rnd();
      const ra = 0.00055 + 0.0003 * rnd();
      spaces.push({ c: place(t, 0.35 + 0.45 * rnd(), rnd() * Math.PI * 2), r: [ra, ra, ra * 1.3] });
    }
    out.push({ id: 'cavernous_spaces' + suffix, geometry: ovals(spaces) });
    const helicine: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 8; k++) {
      const t = 0.14 + 0.09 * k;
      const ang = k * 2.1;
      helicine.push(tubeAlong(coilAround([place(t, 0.12, ang), place(t, 0.68, ang)], 0.00028, 2.2, 10), () => 0.00013, { tubular: 20, radial: 4 }));
    }
    out.push({ id: 'helicine_arteries' + suffix, geometry: mergeParts(helicine) });
    const trab: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 12; k++) {
      const t = 0.12 + 0.07 * k;
      const ang = k * 1.3;
      trab.push(tubeAlong([place(t, 0.85, ang), place(t + 0.012, 0.1, ang + 1.6), place(t, 0.85, ang + Math.PI * 0.95)], () => 0.00018, { tubular: 6, radial: 4 }));
    }
    out.push({ id: 'trabeculae' + suffix, geometry: mergeParts(trab) });
  }
  return out;
};
