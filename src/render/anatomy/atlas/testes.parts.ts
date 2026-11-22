import * as THREE from 'three';
import type { PartBuilder } from '../parts';
import { capsule, ellipsoid, mergeParts, polygonise, tubeAlong, union, type V3 } from '../sdf';
import { vasDeferensPath } from '../models';
import { arcPoints, oval, ovals, perp } from './kidney.parts';

/**
 * THE INSIDE OF THE TESTES.
 *
 * Each testis is an oval gland wrapped in a tough fibrous capsule, the tunica albuginea. The
 * capsule is thickened at the back as the mediastinum, and thin septa run from it to divide
 * the gland into lobules. Each lobule holds one to a few long, tightly coiled seminiferous
 * tubules, where sperm are made; the tubules straighten and open into a network of channels
 * in the mediastinum, the rete testis. Efferent ductules carry the sperm from the rete to the
 * head of the epididymis, a single much-coiled duct that runs down the back of the testis as
 * head, body and tail, and the tail becomes the vas deferens, which climbs in the spermatic
 * cord. Between the tubules lie clusters of interstitial (Leydig) cells, which make
 * testosterone. The testicular artery reaches the testis in the cord, and the veins that
 * leave it form the pampiniform plexus around that artery (GRAYS42, GH14).
 *
 * FRAME. The frame of the shell in models.ts: origin midway between the two testes, +x the
 * patient's right. Both testes are authored in this one atlas. The shell is an oval of radii
 * 12.5, 22 and 15 mm round [+-24 mm, 0, 0] (the patient's left one hangs 6 mm lower), with
 * the epididymis as a chain of three swellings down its back and the vas deferens as a tube
 * of 1.9 mm radius. Every part here is inside that: the tunica and the lobules are 1 mm
 * inside the oval, and the coiled ducts are kept inside the radius of the shell's own
 * epididymal chain at their position.
 *
 * WHAT WAS DONE FOR THE EYE, NOT FROM MEASUREMENT. A real testis has several hundred
 * lobules and a tubule several tens of centimetres long; here there are five lobules a side
 * and one coiled tubule in each, drawn large enough to follow. The coil counts, the
 * positions of the interstitial clusters and the course of the vessels over the tunica are
 * chosen to read clearly. The vas deferens here follows the path models.ts gives it, which
 * at its start runs along the line of the epididymis and so overlaps it a little in the
 * picture. The cord is only as wide as the shell's vas tube, so the artery and the veins
 * lie against the vas inside that tube.
 *
 * FINER STRUCTURES (the second half of `parts`). The septa, tunica vaginalis with its two
 * layers, tunica vasculosa, mediastinum, spermatic cord, cremaster, scrotum and dartos were
 * left undrawn in the first version, as things that would hide the gland; they are now parts,
 * the wraps drawn as nested glass ovals (the tunica vaginalis closes all round the testis here,
 * although the real sac is bare at the back). The children of the seminiferous tubules are
 * ONE magnified cross-section of a tubule laid in the middle lobule of each testis, about three
 * times the radius of the coiled tubule: myoid cells on the outside, spermatogonia, the
 * Sertoli cells and the rings of the blood-testis barrier, then the cells of spermatogenesis
 * in order toward the lumen, and one spermatozoon on the axis. The cell counts are a handful
 * where a real tubule has thousands, the order of the layers is the textbook one, and the
 * sperm's tail is a fixed shape, not a swimming one.
 *
 * NOT DRAWN. The cord's other contents (lymphatics, nerves) and the layers of the tubule
 * wall other than those named above.
 */

const TR: V3 = [0.0125, 0.022, 0.015];
/** The oval the parts live in: the shell's oval 1.2 mm smaller, so nothing touches the surface. */
const INNER: V3 = [TR[0] - 0.0012, TR[1] - 0.0012, TR[2] - 0.0012];
const NL = 5;

export const centreOf = (s: number): V3 => [s * 0.024, s < 0 ? -0.006 : 0, 0];

/** Pull a point into the oval of a testis if it lies outside a fraction `k` of it. */
function inside(c: V3, p: V3, k: number): V3 {
  const dx = (p[0] - c[0]) / INNER[0];
  const dy = (p[1] - c[1]) / INNER[1];
  const dz = (p[2] - c[2]) / INNER[2];
  const n = Math.hypot(dx, dy, dz);
  if (n <= k) return p;
  const f = k / n;
  return [c[0] + (p[0] - c[0]) * f, c[1] + (p[1] - c[1]) * f, c[2] + (p[2] - c[2]) * f];
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/* ------------------------------------------------------------- lobules */

interface Lobule {
  a: V3;
  b: V3;
  dir: V3;
}

/** The five lobules of one testis: each runs from the mediastinum at the back toward the front. */
function lobulesOf(s: number): Lobule[] {
  const c = centreOf(s);
  const out: Lobule[] = [];
  for (let i = 0; i < NL; i++) {
    const f = i / (NL - 1);
    const sx = i % 2 === 0 ? 1 : -1;
    const a: V3 = [c[0] + 0.0004 * sx, c[1] - 0.009 + 0.018 * f, c[2] - 0.0095];
    const dir = norm([sx * 0.45, (f - 0.5) * 1.1, 0.85]);
    const b = inside(c, [a[0] + dir[0] * 0.017, a[1] + dir[1] * 0.017, a[2] + dir[2] * 0.017], 0.9);
    out.push({ a, b, dir });
  }
  return out;
}

/** A point at fraction t along a lobule's axis. */
const along = (l: Lobule, t: number): V3 => [l.a[0] + (l.b[0] - l.a[0]) * t, l.a[1] + (l.b[1] - l.a[1]) * t, l.a[2] + (l.b[2] - l.a[2]) * t];

/** The control points of the coiled tubule of one lobule, from its blind end toward the rete. */
export function tubulePath(s: number, i: number): V3[] {
  const l = lobulesOf(s)[i];
  const up = norm(cross(l.dir, [0, 1, 0]));
  const vp = norm(cross(l.dir, up));
  const pts: V3[] = [];
  const n = 18;
  for (let j = 0; j <= n; j++) {
    const t = 1 - j / n; // from the periphery back to the mediastinum
    const amp = 0.0004 + 0.0011 * t;
    const ph = 2 * Math.PI * 3.2 * t + i;
    const p = along(l, 0.08 + 0.9 * t);
    pts.push([p[0] + (up[0] * Math.sin(ph) + vp[0] * Math.cos(ph)) * amp, p[1] + (up[1] * Math.sin(ph) + vp[1] * Math.cos(ph)) * amp, p[2] + (up[2] * Math.sin(ph) + vp[2] * Math.cos(ph)) * amp]);
  }
  return pts;
}

/* ------------------------------------------------- rete and efferent ducts */

/** The centreline of the rete testis: a short channel in the mediastinum. */
export function retePath(s: number): V3[] {
  const c = centreOf(s);
  return [
    [c[0], c[1] - 0.009, c[2] - 0.0105],
    [c[0], c[1] + 0.002, c[2] - 0.0108],
    [c[0], c[1] + 0.012, c[2] - 0.0105],
  ];
}

/** One of five efferent ductules, from the top of the rete to the head of the epididymis. */
export function efferentPath(s: number, k: number): V3[] {
  const c = centreOf(s);
  const ox = (k - 2) * 0.0009;
  return [
    [c[0] + ox * 0.4, c[1] + 0.012, c[2] - 0.0105],
    [c[0] + ox + 0.0009 * (k % 2 ? 1 : -1), c[1] + 0.0155, c[2] - 0.0098],
    [c[0] + ox * 1.3 - 0.0009 * (k % 2 ? 1 : -1), c[1] + 0.0188, c[2] - 0.0092],
    [c[0] + ox * 1.5, c[1] + 0.0215, c[2] - 0.0085],
  ];
}

/* ---------------------------------------------------------- epididymis */

/**
 * The coiled duct of the epididymis, as a dense list of points from the head to the tail.
 * The coil's amplitude follows the radius of the shell's own chain (6, 3.5 and 4.5 mm at the
 * head, body and tail) so the duct stays inside it.
 */
export function epididymisPoints(s: number): V3[] {
  const d = centreOf(s)[1];
  const axis = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(s * 0.024, 0.022 + d, -0.008),
      new THREE.Vector3(s * 0.026, 0.0 + d, -0.016),
      new THREE.Vector3(s * 0.024, -0.02 + d, -0.012),
    ],
    false,
    'catmullrom',
    0.5,
  );
  const pts: V3[] = [];
  const p = new THREE.Vector3();
  const t = new THREE.Vector3();
  const z = new THREE.Vector3(0, 0, 1);
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const n = 111;
  for (let j = 0; j <= n; j++) {
    const u = j / n;
    axis.getPointAt(u, p);
    axis.getTangentAt(u, t);
    e1.crossVectors(t, z).normalize();
    e2.crossVectors(t, e1).normalize();
    const r = u < 0.5 ? 0.006 + (0.0035 - 0.006) * (u / 0.5) : 0.0035 + (0.0045 - 0.0035) * ((u - 0.5) / 0.5);
    const amp = 0.55 * (r - 0.0012);
    const ph = 2 * Math.PI * 15 * u;
    pts.push([p.x + (e1.x * Math.sin(ph) + e2.x * Math.cos(ph)) * amp, p.y + (e1.y * Math.sin(ph) + e2.y * Math.cos(ph)) * amp, p.z + (e1.z * Math.sin(ph) + e2.z * Math.cos(ph)) * amp]);
  }
  return pts;
}

/* ----------------------------------------------------- vas and the cord */

/** The vas deferens: the shell's own path, started from the tail of the epididymis. */
export function vasPath(s: number): V3[] {
  const base = vasDeferensPath(s);
  const tail: V3 = [s * 0.024, -0.02 + centreOf(s)[1], -0.012];
  // The left testis hangs lower, so its tail is below the start of the shell's path.
  return tail[1] < base[0][1] - 1e-6 ? [tail, ...base] : base;
}

/** Cord position at a height: the point on the vas deferens' curve where it reaches `y`. */
function cordAt(s: number, y: number): V3 {
  const curve = new THREE.CatmullRomCurve3(
    vasDeferensPath(s).map((q) => new THREE.Vector3(q[0], q[1], q[2])),
    false,
    'catmullrom',
    0.5,
  );
  const p = new THREE.Vector3();
  for (let u = 0; u <= 1.0001; u += 0.002) {
    curve.getPointAt(Math.min(1, u), p);
    if (p.y >= y) return [p.x, p.y, p.z];
  }
  return [p.x, p.y, p.z];
}

/** Radius from the axis of the vas at which the artery and veins lie in the cord. */
const CORD_R = 0.0015;

/** The testicular artery: down the cord, over the back of the testis and into the mediastinum. */
export function arteryPath(s: number): V3[] {
  const c = centreOf(s);
  const pts: V3[] = [];
  for (const y of [0.054, 0.046, 0.039, 0.032]) {
    const q = cordAt(s, y);
    pts.push([q[0], q[1], q[2] + CORD_R]);
  }
  pts.push(
    [c[0] + s * 0.0025, c[1] + 0.0185, c[2] - 0.0115],
    [c[0] + s * 0.0015, c[1] + 0.008, c[2] - 0.0115],
    [c[0] + s * 0.0025, c[1] + 0.001, c[2] - 0.0105],
  );
  return pts;
}

/** The branch of the artery that runs over the inside of the tunica toward the front of the testis. */
function arteryBranch(s: number, side: number): V3[] {
  const c = centreOf(s);
  const raw: V3[] = [
    [c[0] + s * 0.0025, c[1] + 0.001, c[2] - 0.0105],
    [c[0] + side * 0.0075, c[1] + 0.004, c[2] - 0.008],
    [c[0] + side * 0.0085, c[1] - 0.004, c[2] + 0.002],
    [c[0] + side * 0.004, c[1] - 0.012, c[2] + 0.009],
  ];
  return raw.map((p, i) => (i === 0 ? p : inside(c, p, 0.9)));
}

/** One of four veins of the pampiniform plexus, from the mediastinum up into the cord. */
export function veinPath(s: number, k: number): V3[] {
  const c = centreOf(s);
  const phase = [0, Math.PI, -0.6 * Math.PI, 0.1 * Math.PI][k];
  const dx = (k - 1.5) * 0.0008;
  const pts: V3[] = [
    [c[0] + dx, c[1] + 0.0, c[2] - 0.0108],
    [c[0] + dx * 0.6, c[1] + 0.008, c[2] - 0.0112],
    [c[0] + s * 0.0035 + dx, c[1] + 0.0175, c[2] - 0.0122],
  ];
  const ys = [0.032, 0.0375, 0.043, 0.0485, 0.054];
  ys.forEach((y, i) => {
    const q = cordAt(s, y);
    const a = phase + i * 1.1;
    pts.push([q[0] + Math.cos(a) * CORD_R, q[1], q[2] + Math.sin(a) * CORD_R]);
  });
  return pts;
}

/* --------------------------------------------------------------- build */

const tube = (pts: readonly V3[], r: number, tubular: number, radial: number): THREE.BufferGeometry => tubeAlong(pts, () => r, { tubular, radial });

export const parts: PartBuilder = () => {
  const extra: { id: string; geometry: THREE.BufferGeometry }[] = [];
  const tunica: THREE.BufferGeometry[] = [];
  const lobuleGeo: THREE.BufferGeometry[] = [];
  const tubules: THREE.BufferGeometry[] = [];
  const beads: THREE.BufferGeometry[] = [];
  const rete: THREE.BufferGeometry[] = [];
  const efferent: THREE.BufferGeometry[] = [];
  const head: THREE.BufferGeometry[] = [];
  const body: THREE.BufferGeometry[] = [];
  const tail: THREE.BufferGeometry[] = [];
  const vas: THREE.BufferGeometry[] = [];
  const artery: THREE.BufferGeometry[] = [];
  const plexus: THREE.BufferGeometry[] = [];

  for (const s of [1, -1]) {
    const c = centreOf(s);
    const lo: V3 = [c[0] - 0.0135, c[1] - 0.0235, c[2] - 0.0165];
    const hi: V3 = [c[0] + 0.0135, c[1] + 0.0235, c[2] + 0.0165];

    // The capsule: an oval just inside the shell.
    tunica.push(polygonise(ellipsoid(c, INNER), lo, hi, { cell: 0.0023 }));

    // Lobules: tapering wedges from the mediastinum, each holding one coiled tubule.
    const lobs = lobulesOf(s);
    lobuleGeo.push(polygonise(union(...lobs.map((l) => capsule(l.a, l.b, 0.0013, 0.0034))), lo, hi, { cell: 0.0017 }));
    for (let i = 0; i < NL; i++) tubules.push(tube(tubulePath(s, i), 0.00055, 42, 4));

    // Interstitial clusters: small beads in the spaces between neighbouring lobules.
    for (let i = 0; i < NL - 1; i++) {
      for (const t of [0.4, 0.72]) {
        const m = along(lobs[i], t);
        const n2 = along(lobs[i + 1], t);
        const g = new THREE.SphereGeometry(0.00075, 8, 6);
        g.translate((m[0] + n2[0]) / 2, (m[1] + n2[1]) / 2, (m[2] + n2[2]) / 2);
        g.deleteAttribute('uv');
        beads.push(g);
      }
    }

    // Rete: two interlacing channels, so it reads as a network and not a single tube.
    const r = retePath(s);
    const wob = (sign: number): V3[] => r.map((p, i) => add(p, [sign * (i % 2 === 0 ? -0.001 : 0.001), 0, 0]));
    rete.push(tube(wob(1), 0.0006, 24, 5), tube(wob(-1), 0.0006, 24, 5));
    for (let k = 0; k < 5; k++) efferent.push(tube(efferentPath(s, k), 0.0004, 20, 4));

    // Epididymis: head, body and tail share one dense coil, cut into three parts.
    const ep = epididymisPoints(s);
    head.push(tube(ep.slice(0, 38), 0.0007, 56, 5));
    body.push(tube(ep.slice(37, 76), 0.0006, 56, 5));
    tail.push(tube(ep.slice(75), 0.0007, 54, 5));

    vas.push(tube(vasPath(s), 0.0012, 60, 7));

    artery.push(tube(arteryPath(s), 0.0004, 40, 5), tube(arteryBranch(s, 1), 0.0003, 20, 4), tube(arteryBranch(s, -1), 0.0003, 20, 4));
    for (let k = 0; k < 4; k++) plexus.push(tube(veinPath(s, k), 0.0003, 44, 4));
  }

  /* ====================================================== FINER STRUCTURES ===== */
  // Level-1 gaps and the children of the seminiferous tubules (src/data/anatomy/testes.json).
  // Every count, radius and position below is a drawing choice, not anatomy's own figure.
  const sacs: Record<'vaginalis' | 'visceral' | 'parietal', THREE.BufferGeometry[]> = { vaginalis: [], visceral: [], parietal: [] };
  const vasculosa: THREE.BufferGeometry[] = [];
  const mediastinum: THREE.BufferGeometry[] = [];
  const septaGeo: { c: V3; r: V3; n: V3 }[] = [];
  const cordGeo: THREE.BufferGeometry[] = [];
  const cremaster: THREE.BufferGeometry[] = [];
  const cells: Record<string, THREE.BufferGeometry[]> = {
    sertoli_cells: [], blood_testis_barrier: [], myoid_cells: [], spermatogonia: [], primary_spermatocytes: [], secondary_spermatocytes: [], spermatids: [], spermatozoa: [], sperm_head: [], sperm_midpiece: [], sperm_tail: [],
  };
  const grown = (d: number): V3 => [TR[0] + d, TR[1] + d, TR[2] + d];
  for (const s of [1, -1]) {
    const c = centreOf(s);
    const lo: V3 = [c[0] - 0.0185, c[1] - 0.0285, c[2] - 0.02];
    const hi: V3 = [c[0] + 0.0185, c[1] + 0.0285, c[2] + 0.02];
    // Tunica vaginalis: the sac, with its visceral layer just inside the shell and its parietal
    // layer just outside it, as three nested glass ovals. The real sac does not close all round
    // the testis (it is bare at the back, where the vessels enter); the drawing does close.
    sacs.vaginalis.push(polygonise(ellipsoid(c, grown(0.001)), lo, hi, { cell: 0.0038 }));
    sacs.visceral.push(polygonise(ellipsoid(c, grown(-0.0004)), lo, hi, { cell: 0.0038 }));
    sacs.parietal.push(polygonise(ellipsoid(c, grown(0.0022)), lo, hi, { cell: 0.0038 }));

    // Tunica vasculosa: fine vessels lying on the inner face of the capsule, as meridian arcs.
    const face: V3 = [INNER[0] * 0.985, INNER[1] * 0.985, INNER[2] * 0.985];
    for (let k = 0; k < 7; k++) {
      const th = (k / 7) * Math.PI * 2;
      const pts: V3[] = [];
      for (let j = 0; j <= 8; j++) {
        const phi = 0.45 + (2.25 * j) / 8;
        pts.push([c[0] + face[0] * Math.sin(phi) * Math.cos(th), c[1] + face[1] * Math.cos(phi), c[2] + face[2] * Math.sin(phi) * Math.sin(th)]);
      }
      vasculosa.push(tube(pts, 0.00028, 10, 4));
    }

    // Mediastinum: a wedge of thick capsule along the back, round the rete.
    mediastinum.push(tube([[c[0], c[1] - 0.0115, c[2] - 0.01], [c[0], c[1] + 0.0, c[2] - 0.0102], [c[0], c[1] + 0.0135, c[2] - 0.0098]], 0.0021, 10, 8));

    // Septa: thin discs midway between neighbouring lobules, turned to the line joining them.
    const lobs = lobulesOf(s);
    for (let i = 0; i < NL - 1; i++) {
      const m = along(lobs[i], 0.55);
      const n2 = along(lobs[i + 1], 0.55);
      const d: V3 = [n2[0] - m[0], n2[1] - m[1], n2[2] - m[2]];
      septaGeo.push({ c: [(m[0] + n2[0]) / 2, (m[1] + n2[1]) / 2, (m[2] + n2[2]) / 2], r: [0.0042, 0.0042, 0.00022], n: norm(d) });
    }

    // Spermatic cord: a glass sleeve along the upper part of the vas path, just inside the
    // shell's own tube; the cremaster is a few muscle loops round it.
    const vas = vasDeferensPath(s).filter((q) => q[1] >= 0.03);
    if (vas.length >= 2) cordGeo.push(tube(vas, 0.0017, 40, 8));
    for (const y of [0.034, 0.04, 0.046, 0.052]) {
      const q = cordAt(s, y);
      const a = cordAt(s, y - 0.004);
      const b = cordAt(s, y + 0.004);
      cremaster.push(tube(arcPoints(q, [b[0] - a[0], b[1] - a[1], b[2] - a[2]], 0.0017, 0, Math.PI * 2 * 0.92, 10), 0.00028, 20, 4));
    }

    // A magnified cross-section of ONE seminiferous tubule, laid in the middle lobule: cell
    // layers from the outer wall to the lumen. Drawn about three times the radius of the
    // coiled tubules so the cells can be told apart; the cells are far fewer than in life.
    const l = lobs[2];
    const P = along(l, 0.72);
    const d = l.dir;
    const [e1, e2] = perp(d);
    const R = 0.0018;
    const at2 = (z: number, rho: number, ang: number): V3 => [P[0] + d[0] * z + (e1[0] * Math.cos(ang) + e2[0] * Math.sin(ang)) * rho, P[1] + d[1] * z + (e1[1] * Math.cos(ang) + e2[1] * Math.sin(ang)) * rho, P[2] + d[2] * z + (e1[2] * Math.cos(ang) + e2[2] * Math.sin(ang)) * rho];
    const radial = (z: number, ang: number): V3 => norm([(e1[0] * Math.cos(ang) + e2[0] * Math.sin(ang)), (e1[1] * Math.cos(ang) + e2[1] * Math.sin(ang)), (e1[2] * Math.cos(ang) + e2[2] * Math.sin(ang)) + 0 * z]);
    const layer = (name: string, n: number, rho: number, r: V3, stagger: number, flat = false): void => {
      const items = [];
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * Math.PI * 2 + stagger;
        const z = ((k % 3) - 1) * 0.0014;
        items.push({ c: at2(z, rho, ang), r, n: flat ? radial(z, ang) : undefined });
      }
      cells[name].push(ovals(items));
    };
    layer('myoid_cells', 14, R * 1.0, [0.0005, 0.0005, 0.00012], 0.2, true);
    layer('spermatogonia', 10, R * 0.86, [0.0002, 0.0002, 0.0002], 0.4);
    layer('primary_spermatocytes', 10, R * 0.62, [0.00028, 0.00028, 0.00028], 0.1);
    layer('secondary_spermatocytes', 8, R * 0.5, [0.00018, 0.00018, 0.00018], 0.55);
    layer('spermatids', 14, R * 0.38, [0.00013, 0.00013, 0.00013], 0.3);
    // Sertoli cells: tall columns from the base of the wall toward the lumen.
    const sertoli = [];
    for (let k = 0; k < 16; k++) {
      const ang = (k / 16) * Math.PI * 2 + 0.05;
      const z = (k % 2 === 0 ? -1 : 1) * 0.0007;
      sertoli.push({ c: at2(z, R * 0.62, ang), r: [0.00026, 0.00026, 0.0007] as V3, n: radial(z, ang) });
    }
    cells.sertoli_cells.push(ovals(sertoli));
    // The blood-testis barrier: three rings between the outer and inner compartments.
    for (const z of [-0.0016, 0, 0.0016]) {
      const ring: V3[] = [];
      for (let j = 0; j < 14; j++) ring.push(at2(z, R * 0.73, (j / 14) * Math.PI * 2));
      cells.blood_testis_barrier.push(tube(ring, 0.0001, 16, 4));
    }
    // Spermatozoa in the lumen: a few small heads with short tails (many in life).
    const heads = [];
    for (let k = 0; k < 6; k++) {
      const ang = (k / 6) * Math.PI * 2;
      const z = ((k % 3) - 1) * 0.0012;
      heads.push({ c: at2(z + 0.0004, R * 0.2, ang), r: [0.00012, 0.00008, 0.00008] as V3, n: d });
      cells.spermatozoa.push(tube([at2(z, R * 0.2, ang), at2(z - 0.0005, R * 0.12, ang + 0.4), at2(z - 0.001, R * 0.2, ang + 0.1)], 0.00003, 6, 3));
    }
    cells.spermatozoa.push(ovals(heads));
    // One spermatozoon, magnified, on the axis of the lumen: head with its acrosome cap,
    // midpiece and a tail drawn as a fixed wave. Its proportions are for legibility.
    const AX = (z: number, w = 0): V3 => at2(z, w, 0.7);
    cells.sperm_head.push(oval(AX(0.0021), [0.00034, 0.00022, 0.0005], d), oval(AX(0.0025), [0.00036, 0.00024, 0.00017], d));
    cells.sperm_midpiece.push(tube([AX(0.0015), AX(0.0012), AX(0.0009)], 0.00011, 8, 6));
    const tail: V3[] = [];
    for (let j = 0; j <= 14; j++) tail.push(AX(0.0009 - (0.0034 * j) / 14, 0.00012 * Math.sin(j * 0.9) * Math.min(1, j / 4)));
    cells.sperm_tail.push(tube(tail, 0.00005, 28, 4));
  }
  // Scrotum and dartos: two glass sacs round both testes, the muscle layer just inside the skin.
  const scrotumBox: [V3, V3] = [[-0.047, -0.037, -0.024], [0.047, 0.031, 0.024]];
  const scrotal = (k: number): THREE.BufferGeometry => polygonise(ellipsoid([0, -0.0035, 0], [0.043 * k, 0.03 * k, 0.0195 * k]), scrotumBox[0], scrotumBox[1], { cell: 0.0048 });

  extra.push(
    { id: 'tunica_vaginalis', geometry: mergeParts(sacs.vaginalis) },
    { id: 'visceral_layer', geometry: mergeParts(sacs.visceral) },
    { id: 'parietal_layer', geometry: mergeParts(sacs.parietal) },
    { id: 'tunica_vasculosa', geometry: mergeParts(vasculosa) },
    { id: 'mediastinum_testis', geometry: mergeParts(mediastinum) },
    { id: 'testicular_septa', geometry: ovals(septaGeo) },
    { id: 'spermatic_cord', geometry: mergeParts(cordGeo) },
    { id: 'cremaster_muscle', geometry: mergeParts(cremaster) },
    { id: 'scrotum', geometry: scrotal(1) },
    { id: 'dartos_muscle', geometry: scrotal(0.965) },
  );
  for (const [id, g] of Object.entries(cells)) extra.push({ id, geometry: mergeParts(g) });

  return [
    { id: 'tunica_albuginea', geometry: mergeParts(tunica) },
    { id: 'lobules', geometry: mergeParts(lobuleGeo) },
    { id: 'seminiferous_tubules', geometry: mergeParts(tubules) },
    { id: 'interstitial_cells', geometry: mergeParts(beads) },
    { id: 'rete_testis', geometry: mergeParts(rete) },
    { id: 'efferent_ductules', geometry: mergeParts(efferent) },
    { id: 'epididymis_head', geometry: mergeParts(head) },
    { id: 'epididymis_body', geometry: mergeParts(body) },
    { id: 'epididymis_tail', geometry: mergeParts(tail) },
    { id: 'vas_deferens', geometry: mergeParts(vas) },
    { id: 'testicular_artery', geometry: mergeParts(artery) },
    { id: 'pampiniform_plexus', geometry: mergeParts(plexus) },
    ...extra,
  ];
};
