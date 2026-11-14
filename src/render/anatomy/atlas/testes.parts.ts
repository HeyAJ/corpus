import * as THREE from 'three';
import type { PartBuilder } from '../parts';
import { capsule, ellipsoid, mergeParts, polygonise, tubeAlong, union, type V3 } from '../sdf';
import { vasDeferensPath } from '../models';

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
 * NOT DRAWN. The septa between the lobules, the layers of the tubule wall, the tunica
 * vaginalis, the cremaster and the cord's other contents, and the scrotum.
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
  ];
};
