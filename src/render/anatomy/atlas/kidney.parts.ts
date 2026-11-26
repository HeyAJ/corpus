import * as THREE from 'three';
import type { PartBuilder } from '../parts';
import {
  boundsOf,
  capsule,
  ellipsoid,
  intersect,
  mergeParts,
  polygonise,
  subtract,
  tubeAlong,
  union,
  type Sdf,
  type V3,
} from '../sdf';
import { mulberry32 } from '../noise';

/**
 * THE INSIDE OF A KIDNEY: ONE ATLAS, TWO ORGANS.
 *
 * `kidney_l` and `kidney_r` share this file. The shell in models.ts is authored once per
 * side with `med = side < 0 ? 1 : -1`, the sign of x that points at the midline, because
 * the hilum (where the artery, vein and pelvis attach) faces the spine and the aorta on
 * both sides. Everything here is therefore authored in a MEDIAL-POSITIVE frame (u, y, z):
 * u grows toward the hilum, and a point is mapped to the organ's own frame by x = med * u.
 * Fields are wrapped the same way, so the left and right kidney are mirror images of one
 * drawing and the hilum-side structures sit on the medial side of each.
 *
 * WHAT IS DRAWN, OUTSIDE IN. A fibrous capsule (glass, so the inside shows through); the
 * cortex, a hollow layer open at the hilum; nine medullary pyramids whose tips (papillae)
 * point at the sinus; the renal columns, which are cortex that dips between neighbouring
 * pyramids; a minor calyx cupping each papilla, three major calyces and the renal pelvis
 * that funnels out of the hilum into the ureter; the renal artery dividing into segmental
 * and interlobar branches that run in the columns, and the vein that accompanies it; a
 * scatter of glomeruli in the cortex; and ONE nephron, drawn enormously enlarged as a
 * continuous fine tube so that its course can be followed with the eye.
 *
 * WHAT IS NOT DRAWN. A real kidney has about a million nephrons; the one here stands for
 * all of them and its dimensions are an illustration, not a measurement. The pyramid
 * count is nine (anatomy texts say eight to eighteen, varying between people), the layout
 * is schematic rather than a traced atlas, and no dimension here is a physiological
 * constant: they are chosen to sit inside the shell and read clearly. The arcuate and
 * interlobular vessels used to be left out, on the reasoning that they would clutter the
 * cortex; they are now LEVEL-1 parts like the other named vessels, drawn thin, as one arch per
 * pyramid and four short risers on each arch. That conclusion was wrong for the same reason
 * it was wrong in the heart: a student following the blood from the renal artery to a
 * glomerulus needs every named step.
 *
 * FINER STRUCTURES (the bottom of `parts`). The hilum, sinus, fat and fascia, the calyces
 * drawn singly, the papillae, the vessels above and the juxtaglomerular apparatus are level-1.
 * The glomerulus's children (arterioles, capillary tuft, Bowman's capsule with its two
 * layers, podocytes, mesangial cells) are drawn once, at the glomerulus of the ENLARGED
 * nephron, many times larger than life, as are the nephron's own stretches, cut from the
 * nephron's tube by index (`marks`) so each lies exactly inside its parent. Two things are
 * invented for legibility and said so: the thin ascending limb is the first third of the
 * ascending leg (the real extent varies with the nephron), and the macula densa contact is a
 * thin bridge, because the loop of the enlarged nephron cannot double back to its own
 * glomerulus. The perirenal fat and the renal fascia are single closed surfaces, glass, and
 * stand outside the organ's shell, which is where they are.
 *
 * The routes the streams follow are exported (`kidneyRoutes`) from the SAME control points
 * that build the tubes, so blood, filtrate and urine run inside the vessel, tubule and
 * calyx they belong to rather than near them. This file runs in the geometry worker;
 * nothing here may touch the DOM or draw with a material.
 */

/** Centre of the renal sinus, medial-positive frame, metres. */
const C: V3 = [0.011, 0, 0.002];

/** Pyramid directions: angle psi from lateral toward anterior, elevation epsilon, group. */
const PYRAMIDS: { psi: number; eps: number; group: 0 | 1 | 2 }[] = [
  { psi: 0, eps: 68, group: 0 }, // 0 upper pole
  { psi: 35, eps: 42, group: 0 }, // 1 upper anterior
  { psi: -35, eps: 42, group: 0 }, // 2 upper posterior
  { psi: 0, eps: 3, group: 1 }, // 3 mid lateral (carries the enlarged nephron)
  { psi: 40, eps: 3, group: 1 }, // 4 mid anterior
  { psi: -40, eps: 3, group: 1 }, // 5 mid posterior
  { psi: 35, eps: -42, group: 2 }, // 6 lower anterior
  { psi: -35, eps: -42, group: 2 }, // 7 lower posterior
  { psi: 0, eps: -68, group: 2 }, // 8 lower pole
];

/** Pairs of neighbouring pyramids: between each pair runs a column and an interlobar artery. */
const GAPS: [number, number][] = [
  [0, 1], [0, 2], [1, 3], [2, 3], [3, 6], [3, 7], [6, 8], [7, 8], [1, 4], [2, 5], [4, 6], [5, 7],
];

/** Junction of the minor calyces of each group, and where each group's segmental branches end. */
const JUNCTION: V3[] = [[0.01, 0.011, 0.003], [0.007, 0, 0.002], [0.01, -0.011, 0.003]];
const ARTERY_END: V3[] = [[0.01, 0.015, 0.0065], [0.008, 0.002, 0.0075], [0.01, -0.013, 0.0065]];
const VEIN_END: V3[] = [[0.011, 0.015, 0.0105], [0.009, 0.002, 0.0115], [0.011, -0.013, 0.0105]];
const PELVIS: V3[] = [[0.015, 0.0, 0.003], [0.022, -0.006, 0.0035], [0.03, -0.014, 0.004]];

/** Cortex inner boundary (where the medulla begins), medial-positive. */
const INNER_R: V3 = [0.0193, 0.0458, 0.0118];

interface Pyramid {
  apex: V3;
  dir: V3;
  base: V3;
  tIn: number;
  radius: number;
  group: 0 | 1 | 2;
}

export const add = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Distance along a ray from `p` along `d` to the ellipsoid (centre 0, radii r), p inside. */
function rayToEllipsoid(p: V3, d: V3, r: V3): number {
  let a = 0;
  let b = 0;
  let c = -1;
  for (let i = 0; i < 3; i++) {
    a += (d[i] / r[i]) ** 2;
    b += (2 * p[i] * d[i]) / (r[i] * r[i]);
    c += (p[i] / r[i]) ** 2;
  }
  const disc = Math.max(0, b * b - 4 * a * c);
  return (-b + Math.sqrt(disc)) / (2 * a);
}

function layout(): Pyramid[] {
  return PYRAMIDS.map((p) => {
    const psi = (p.psi * Math.PI) / 180;
    const eps = (p.eps * Math.PI) / 180;
    const dir: V3 = [-Math.cos(psi) * Math.cos(eps), Math.sin(eps), Math.sin(psi) * Math.cos(eps)];
    // The sinus is a tall narrow cavity, so the papillae sit on an ellipsoid [9, 20, 4.5] mm
    // about its centre rather than on a sphere: poles reach well up and down the sinus.
    const apex: V3 = [C[0] + dir[0] * 0.009, C[1] + dir[1] * 0.02, C[2] + dir[2] * 0.0045];
    const tIn = rayToEllipsoid(apex, dir, INNER_R);
    const length = Math.max(0.007, tIn - 0.0025);
    const radius = Math.min(0.0052, length * 0.42);
    return { apex, dir, base: add(apex, dir, length), tIn, radius, group: p.group };
  });
}

/** Paths of the interlobar arteries/columns: from the sinus to the corticomedullary junction. */
function gapPaths(py: Pyramid[]): { start: V3; mid: V3; end: V3; group: 0 | 1 | 2 }[] {
  return GAPS.map(([i, j]) => {
    const a = py[i];
    const b = py[j];
    const mid: V3 = [(a.apex[0] + b.apex[0]) / 2, (a.apex[1] + b.apex[1]) / 2, (a.apex[2] + b.apex[2]) / 2];
    const bis = norm([a.dir[0] + b.dir[0], a.dir[1] + b.dir[1], a.dir[2] + b.dir[2]]);
    const tEnd = rayToEllipsoid(mid, bis, INNER_R) - 0.0012;
    const group: 0 | 1 | 2 = mid[1] > 0.008 ? 0 : mid[1] < -0.008 ? 2 : 1;
    return { start: add(mid, bis, 0.002), mid: add(mid, bis, tEnd * 0.5), end: add(mid, bis, tEnd), group };
  });
}

interface Nephron {
  points: V3[];
  radii: number[];
  glomerulus: V3;
  /** Index in `points` where the collecting duct begins. */
  duct: number;
  papilla: V3;
  /**
   * First index of each named stretch of the tube, in order, with a final entry at the last
   * index. The finer-structure parts (proximal tubule, limbs, duct ...) are drawn from these
   * slices so that a child lies exactly along its parent and never beside it.
   */
  marks: Record<string, number>;
  /** The axis the enlarged nephron runs along, papilla toward cortex, and the cortex start. */
  dir: V3;
  tIn: number;
}

/**
 * The enlarged nephron, in the pyramid that points laterally. Points are spaced about a
 * millimetre apart so that "fraction along the curve" is close to "fraction along the
 * index", which is how the radius is assigned. All offsets are in the frame of that
 * pyramid's axis: s along it from the papilla, `a` across (z), `b` across (y).
 */
function buildNephron(p: Pyramid): Nephron {
  const pts: V3[] = [];
  const rad: number[] = [];
  const at = (s: number, a: number, b: number): V3 => [p.apex[0] + p.dir[0] * s, p.apex[1] + p.dir[1] * s + b, p.apex[2] + p.dir[2] * s + a];
  const push = (v: V3, r: number): void => {
    pts.push(v);
    rad.push(r);
  };
  const sc = p.tIn; // start of the cortex along the axis
  const glomerulus = at(sc + 0.0037, 0.003, 0.0035);
  const marks: Record<string, number> = {};
  const mark = (name: string): void => {
    marks[name] = pts.length;
  };
  mark('bowman');

  // 1. Bowman's capsule: a fat short run of tube, with the glomerular tuft sitting inside it.
  for (let k = 0; k < 4; k++) push(at(sc + 0.0062 - 0.0014 * k, 0.003, 0.0035), 0.0017);
  // 2. Proximal convoluted tubule: a tangle wandering about the capsule.
  mark('pct');
  for (let k = 0; k < 16; k++) {
    push(at(sc + 0.002 + 0.001 * Math.sin(0.9 * k), 0.003 + 0.0021 * Math.cos(1.3 * k + 1), 0.0035 + 0.0021 * Math.sin(1.3 * k + 1)), 0.0006);
  }
  // 3. Descending limb: thin, straight down the pyramid beside its axis.
  mark('descending');
  const sLoop = 0.3 * sc;
  const down = Math.round((sc + 0.0015 - sLoop) / 0.0012);
  for (let k = 0; k <= down; k++) push(at(sc + 0.0015 - ((sc + 0.0015 - sLoop) * k) / down, 0.0016, 0), 0.00035);
  // 4. The hairpin of the loop of Henle.
  mark('hairpin');
  for (let k = 1; k < 6; k++) {
    const ang = (Math.PI * k) / 6;
    push(at(sLoop - 0.0016 * Math.sin(ang), 0.0016 * Math.cos(ang), 0), 0.0006);
  }
  // 5. Thick ascending limb back to the cortex on the far side of the axis.
  mark('ascending');
  for (let k = 0; k <= down; k++) push(at(sLoop + ((sc + 0.003 - sLoop) * k) / down, -0.0016, 0), 0.0006);
  // 6. Distal convoluted tubule: a second, smaller tangle beside the first.
  mark('dct');
  for (let k = 0; k < 10; k++) {
    push(at(sc + 0.0035 + 0.0008 * Math.sin(0.9 * k), -0.003 + 0.0015 * Math.cos(1.5 * k), -0.002 + 0.0015 * Math.sin(1.5 * k)), 0.0006);
  }
  // 7. Collecting duct: onto the axis, then straight down to the papilla.
  const duct = pts.length;
  mark('duct');
  push(at(sc + 0.0025, 0, 0), 0.0008);
  const n = Math.round((sc + 0.0025 - 0.0008) / 0.0012);
  for (let k = 1; k <= n; k++) {
    const s = sc + 0.0025 - ((sc + 0.0017) * k) / n;
    push(at(s, 0, 0), 0.0008 - 0.0002 * (k / n));
  }
  marks.end = pts.length - 1;
  return { points: pts, radii: rad, glomerulus, duct, papilla: at(0.0008, 0, 0), marks, dir: p.dir, tIn: p.tIn };
}

/** A low-poly indexed ball for each centre: 24 triangles, welded, with outward normals. */
function balls(centres: V3[], r: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const seg = 6;
  for (const c of centres) {
    const base = pos.length / 3;
    const verts: V3[] = [[0, 1, 0], [0, -1, 0]];
    for (const polar of [Math.PI / 3, (2 * Math.PI) / 3]) {
      for (let k = 0; k < seg; k++) {
        const az = (k / seg) * Math.PI * 2 + (polar > 1.6 ? Math.PI / seg : 0);
        verts.push([Math.sin(polar) * Math.cos(az), Math.cos(polar), Math.sin(polar) * Math.sin(az)]);
      }
    }
    for (const v of verts) {
      pos.push(c[0] + v[0] * r, c[1] + v[1] * r, c[2] + v[2] * r);
      nor.push(v[0], v[1], v[2]);
    }
    for (let k = 0; k < seg; k++) {
      const k1 = (k + 1) % seg;
      idx.push(base, base + 2 + k1, base + 2 + k); // top fan
      idx.push(base + 1, base + 2 + seg + k, base + 2 + seg + k1); // bottom fan
      idx.push(base + 2 + k, base + 2 + k1, base + 2 + seg + k); // band, two triangles
      idx.push(base + 2 + k1, base + 2 + seg + k1, base + 2 + seg + k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/* ------------------------------------------------ shared drawing helpers (G3 atlases) */

/*
 * The six urinary and male atlases (kidney, ureters, bladder, prostate, testes, penis) are
 * drawn by one hand and need the same few things for their finer structures: a low-poly
 * oval that can be flattened and turned, a ring of points round an axis, a polyline sampled
 * by fraction and a deterministic scatter. They are kept here, in the first of the six files,
 * and imported by the others, because a seventh file only for them would sit outside the
 * list of files this work was allowed to touch. Everything is deterministic (seeded, no
 * Math.random) and every size is a drawing choice, never a measurement.
 */

/** A low-poly oval: radii (across, across, along `axis`), turned so its z points along `axis`. */
export function oval(c: V3, radii: V3, axis?: V3): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 7, 4);
  g.scale(radii[0], radii[1], radii[2]);
  if (axis) {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(axis[0], axis[1], axis[2]).normalize());
    g.applyQuaternion(q);
  }
  g.translate(c[0], c[1], c[2]);
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

/** Many ovals merged into one geometry. */
export function ovals(items: { c: V3; r: V3; n?: V3 }[]): THREE.BufferGeometry {
  return mergeParts(items.map((o) => oval(o.c, o.r, o.n)));
}

/** Two unit vectors perpendicular to `axis` and to each other. */
export function perp(axis: V3): [V3, V3] {
  const a = norm(axis);
  const helper: V3 = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = norm([a[1] * helper[2] - a[2] * helper[1], a[2] * helper[0] - a[0] * helper[2], a[0] * helper[1] - a[1] * helper[0]]);
  const e2 = norm([a[1] * e1[2] - a[2] * e1[1], a[2] * e1[0] - a[0] * e1[2], a[0] * e1[1] - a[1] * e1[0]]);
  return [e1, e2];
}

/** `n + 1` points on a circle of `radius` about `c`, in the plane perpendicular to `axis`, from angle a0 to a1. */
export function arcPoints(c: V3, axis: V3, radius: number, a0: number, a1: number, n: number): V3[] {
  const [e1, e2] = perp(axis);
  const out: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = n === 0 ? a0 : a0 + ((a1 - a0) * i) / n;
    const ca = Math.cos(a) * radius;
    const sa = Math.sin(a) * radius;
    out.push([c[0] + e1[0] * ca + e2[0] * sa, c[1] + e1[1] * ca + e2[1] * sa, c[2] + e1[2] * ca + e2[2] * sa]);
  }
  return out;
}

/** The point at fraction u (0..1) along a polyline, by index. */
export function polyAt(path: readonly V3[], u: number): V3 {
  const f = Math.min(1, Math.max(0, u)) * (path.length - 1);
  const i = Math.min(path.length - 2, Math.floor(f));
  const t = f - i;
  const a = path[i];
  const b = path[i + 1];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** A helix wound round a polyline: `turns` turns, `n` points, radius `amp`. For capillaries wound round a tubule. */
export function coilAround(path: readonly V3[], amp: number, turns: number, n: number, phase = 0): V3[] {
  const out: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const p = polyAt(path, u);
    const q = polyAt(path, Math.min(1, u + 0.02));
    const r = polyAt(path, Math.max(0, u - 0.02));
    const [e1, e2] = perp([q[0] - r[0], q[1] - r[1], q[2] - r[2]]);
    const a = phase + u * turns * Math.PI * 2;
    out.push([p[0] + (e1[0] * Math.cos(a) + e2[0] * Math.sin(a)) * amp, p[1] + (e1[1] * Math.cos(a) + e2[1] * Math.sin(a)) * amp, p[2] + (e1[2] * Math.cos(a) + e2[2] * Math.sin(a)) * amp]);
  }
  return out;
}

/** `n` roughly even directions on a sphere (the golden-spiral layout), unit vectors. */
export function sphereDirs(n: number): V3[] {
  const out: V3[] = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    out.push([Math.cos(ga * i) * r, y, Math.sin(ga * i) * r]);
  }
  return out;
}

/* ------------------------------------------------------------ fields (u-frame) */

const SHELL_R: V3 = [0.0285, 0.055, 0.021];
const grow = (d: number): V3 => [SHELL_R[0] - d, SHELL_R[1] - d, SHELL_R[2] - d];
const hilumCut = (extra: number): Sdf => ellipsoid([0.036, 0, 0.004], [0.0215 + extra, 0.0215 + extra, 0.0195 + extra]);
const hollow = (outer: number, inner: number, cut: number): Sdf =>
  subtract(subtract(ellipsoid([0, 0, 0], grow(outer)), ellipsoid([0, 0, 0], grow(inner))), hilumCut(cut));

/** The routes the streams follow, for the detail module: in the organ's own frame. */
export interface KidneyRoutes {
  bloodIn: V3[][];
  bloodOut: V3[][];
  filtrate: V3[];
  urine: V3[][];
  exit: V3;
}

/** Medial-positive to organ frame: x = med * u. */
const med = (organ: string): number => (organ === 'kidney_l' ? 1 : -1);

export function kidneyRoutes(organ: string): KidneyRoutes {
  const m = med(organ);
  const f = (p: V3): V3 => [m * p[0], p[1], p[2]];
  const py = layout();
  const gaps = gapPaths(py);
  const neph = buildNephron(py[3]);
  const artEntry: V3 = [0.033, 0.008, 0.0045];
  const artBranch: V3 = [0.02, 0.006, 0.0035];
  const veinEntry: V3 = [0.033, 0.002, 0.0095];
  const veinBranch: V3 = [0.02, 0.002, 0.0095];
  // One representative interlobar route per group keeps the stream count low.
  const rep = [0, 1, 2].map((g) => gaps.find((q) => q.group === g) ?? gaps[0]);
  const bloodIn = rep.map((q, g) => [artEntry, artBranch, ARTERY_END[g], q.mid, q.end].map(f));
  const bloodOut = rep.map((q, g) => {
    const sh = (p: V3): V3 => [p[0], p[1], p[2] + 0.0016];
    return [sh(q.end), sh(q.mid), VEIN_END[g], veinBranch, veinEntry].map(f);
  });
  const urine = py.map((p) => {
    const cupNeck = add(p.apex, p.dir, -0.0045);
    return [add(p.apex, p.dir, 0.001), p.apex, cupNeck, JUNCTION[p.group], ...PELVIS].map(f);
  });
  return { bloodIn, bloodOut, filtrate: neph.points.map(f), urine, exit: f(PELVIS[2]) };
}

export const parts: PartBuilder = (params) => {
  const m = med(params.organ);
  const f = (p: V3): V3 => [m * p[0], p[1], p[2]];
  const wrap = (g: Sdf): Sdf => (x, y, z) => g(m * x, y, z);
  const box = (lo: V3, hi: V3): { min: V3; max: V3 } => {
    const x0 = Math.min(m * lo[0], m * hi[0]);
    const x1 = Math.max(m * lo[0], m * hi[0]);
    return { min: [x0, lo[1], lo[2]], max: [x1, hi[1], hi[2]] };
  };
  const tube = (pts: V3[], radius: (t: number) => number, tubular: number, radial = 7): THREE.BufferGeometry =>
    tubeAlong(pts.map(f), radius, { tubular, radial });

  const py = layout();
  const gaps = gapPaths(py);
  const neph = buildNephron(py[3]);
  const out: { id: string; geometry: THREE.BufferGeometry }[] = [];

  // Capsule and cortex: two hollow layers, both open at the hilum.
  const capsuleF = hollow(0.0006, 0.0036, 0.0015);
  const cortexF = hollow(0.004, 0.0092, 0.0022);
  const bb = box([-0.03, -0.058, -0.024], [0.03, 0.058, 0.024]);
  out.push({ id: 'renal_capsule', geometry: polygonise(wrap(capsuleF), bb.min, bb.max, { cell: 0.0036 }) });
  out.push({ id: 'renal_cortex', geometry: polygonise(wrap(cortexF), bb.min, bb.max, { cell: 0.0034 }) });

  // Medullary pyramids: cones whose broad base meets the cortex and whose tip is the papilla.
  const cones = py.map((p) => capsule(p.apex, p.base, 0.0012, p.radius));
  const pb = boundsOf(py.flatMap((p) => [p.apex, p.base]), 0.008);
  const pbox = box(pb.min, pb.max);
  out.push({ id: 'renal_medulla', geometry: polygonise(wrap(union(...cones)), pbox.min, pbox.max, { cell: 0.002 }) });

  // Renal columns: cortex between the pyramids, one tube per gap.
  out.push({
    id: 'renal_columns',
    geometry: mergeParts(gaps.map((g) => tube([g.start, g.mid, add(g.end, norm(add(g.end, g.start, -1)), 0.0025)], () => 0.002, 10, 8))),
  });

  // Calyces and pelvis: a cup round every papilla, three major calyces, the funnel.
  const pelvis: THREE.BufferGeometry[] = [];
  for (const p of py) {
    const mouth = add(p.apex, p.dir, 0.0025);
    const floor = add(p.apex, p.dir, -0.001);
    const neck = add(p.apex, p.dir, -0.0045);
    pelvis.push(tube([mouth, floor, neck, JUNCTION[p.group]], (t) => (t < 0.3 ? 0.003 - 0.0045 * t : 0.0016), 10, 8));
  }
  for (let g = 0; g < 3; g++) {
    const half: V3 = [(JUNCTION[g][0] + PELVIS[0][0]) / 2, (JUNCTION[g][1] + PELVIS[0][1]) / 2, (JUNCTION[g][2] + PELVIS[0][2]) / 2];
    pelvis.push(tube([JUNCTION[g], half, PELVIS[0]], () => 0.0026, 8, 8));
  }
  pelvis.push(tube(PELVIS, (t) => 0.005 - 0.002 * t, 14, 10));
  out.push({ id: 'renal_pelvis', geometry: mergeParts(pelvis) });

  // Renal artery and its segmental and interlobar branches.
  const artEntry: V3 = [0.033, 0.008, 0.0045];
  const artBranch: V3 = [0.02, 0.006, 0.0035];
  const artery: THREE.BufferGeometry[] = [tube([artEntry, [0.027, 0.0075, 0.004], artBranch], () => 0.003, 8, 9)];
  for (let g = 0; g < 3; g++) artery.push(tube([artBranch, [(artBranch[0] + ARTERY_END[g][0]) / 2, (artBranch[1] + ARTERY_END[g][1]) / 2 + 0.002 * (1 - g), 0.006], ARTERY_END[g]], () => 0.0017, 6, 6));
  for (const q of gaps) artery.push(tube([ARTERY_END[q.group], q.mid, q.end], (t) => 0.0012 - 0.0003 * t, 6, 6));
  out.push({ id: 'renal_artery', geometry: mergeParts(artery) });

  // Renal vein: the same gaps, a little anterior and a little wider, draining to the hilum.
  const veinEntry: V3 = [0.033, 0.002, 0.0095];
  const veinBranch: V3 = [0.02, 0.002, 0.0095];
  const vein: THREE.BufferGeometry[] = [tube([veinBranch, [0.027, 0.002, 0.0095], veinEntry], () => 0.0036, 8, 9)];
  for (let g = 0; g < 3; g++) vein.push(tube([veinBranch, [(veinBranch[0] + VEIN_END[g][0]) / 2, (veinBranch[1] + VEIN_END[g][1]) / 2, 0.0115], VEIN_END[g]], () => 0.002, 6, 6));
  for (const q of gaps) {
    const sh = (p: V3): V3 => [p[0], p[1], p[2] + 0.0016];
    vein.push(tube([VEIN_END[q.group], sh(q.mid), sh(q.end)], (t) => 0.0014 - 0.0003 * t, 6, 6));
  }
  out.push({ id: 'renal_vein', geometry: mergeParts(vein) });

  // Glomeruli: seeded rejection sampling inside the cortex layer, away from both faces.
  const rnd = mulberry32(0x6b1d);
  const solid = intersect(ellipsoid([0, 0, 0], grow(0.0048)), (x, y, z) => -ellipsoid([0, 0, 0], grow(0.0084))(x, y, z));
  const centres: V3[] = [];
  for (let tries = 0; tries < 6000 && centres.length < 100; tries++) {
    const u = (rnd() * 2 - 1) * 0.0275;
    const y = (rnd() * 2 - 1) * 0.0535;
    const z = (rnd() * 2 - 1) * 0.0195;
    if (u > 0.013 || solid(u, y, z) > -0.0005) continue;
    centres.push(f([u, y, z]));
  }
  centres.push(f(neph.glomerulus));
  out.push({ id: 'glomeruli', geometry: balls(centres, 0.00085) });

  // The nephron: one continuous tube, radius assigned by index along it.
  const n = neph.points.length - 1;
  out.push({
    id: 'nephron',
    geometry: tube(neph.points, (t) => neph.radii[Math.min(n, Math.round(t * n))], n * 2, 6),
  });
  /* ============================================================ FINER STRUCTURES ===== */
  // Everything below is a LEVEL-1 gap or a child (src/data/anatomy/kidney.json, `parent`).
  // All of it is schematic: counts, sizes and positions are drawing choices.

  // Hilum: a closed ring where the cortex stops and the vessels and pelvis go through, laid
  // on the shell's own surface (an ellipse whose depth follows the shell ellipsoid, pulled
  // 1.2 mm inside it so it never pokes through the glass).
  const hilumLoop: V3[] = [];
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2;
    const y = 0.0155 * Math.cos(a);
    const z = 0.004 + 0.0075 * Math.sin(a);
    const t = Math.max(0, 1 - (y / SHELL_R[1]) ** 2 - (z / SHELL_R[2]) ** 2);
    hilumLoop.push([SHELL_R[0] * Math.sqrt(t) - 0.0012, y, z]);
  }
  out.push({ id: 'hilum', geometry: tubeAlong(hilumLoop.map(f), () => 0.0012, { tubular: 36, radial: 6, closed: true }) });

  // Renal sinus: a glass envelope round the space the pelvis and vessels occupy.
  const sinusBox = box([-0.002, -0.025, -0.008], [0.023, 0.025, 0.012]);
  out.push({ id: 'renal_sinus', geometry: polygonise(wrap(ellipsoid([C[0], 0, C[2]], [0.0105, 0.021, 0.0072])), sinusBox.min, sinusBox.max, { cell: 0.0022 }) });

  // Perirenal fat and renal fascia: two glass envelopes OUTSIDE the capsule, both open at
  // the hilum. They stand a little outside the organ's shell on purpose, because that is where
  // they are; they are the only parts of this atlas that do.
  const outerBox = box([-0.037, -0.064, -0.029], [0.037, 0.064, 0.029]);
  // Each is a single closed surface, not a hollow shell: two hollow shells a millimetre thick
  // cost about fifty thousand triangles at the grid this needs, and as glass the outer face
  // alone says what the part is.
  const fatF = subtract(ellipsoid([0, 0, 0], grow(-0.0028)), hilumCut(0.004));
  const fasciaF = subtract(ellipsoid([0, 0, 0], grow(-0.0056)), hilumCut(0.006));
  out.push({ id: 'perirenal_fat', geometry: polygonise(wrap(fatF), outerBox.min, outerBox.max, { cell: 0.0042 }) });
  out.push({ id: 'renal_fascia', geometry: polygonise(wrap(fasciaF), outerBox.min, outerBox.max, { cell: 0.0046 }) });

  // Calyces: the same centrelines as the pelvis part, drawn thinner and in their own colour.
  const minor: THREE.BufferGeometry[] = [];
  for (const p of py) {
    const mouth = add(p.apex, p.dir, 0.0025);
    const floor = add(p.apex, p.dir, -0.001);
    const neck = add(p.apex, p.dir, -0.0045);
    minor.push(tube([mouth, floor, neck, JUNCTION[p.group]], (t) => (t < 0.3 ? 0.0024 - 0.0035 * t : 0.0012), 10, 7));
  }
  out.push({ id: 'minor_calyces', geometry: mergeParts(minor) });
  const major: THREE.BufferGeometry[] = [];
  for (let g = 0; g < 3; g++) {
    const half: V3 = [(JUNCTION[g][0] + PELVIS[0][0]) / 2, (JUNCTION[g][1] + PELVIS[0][1]) / 2, (JUNCTION[g][2] + PELVIS[0][2]) / 2];
    major.push(tube([JUNCTION[g], half, PELVIS[0]], () => 0.002, 8, 7));
  }
  out.push({ id: 'major_calyces', geometry: mergeParts(major) });

  // Papillae: one cone on each pyramid, narrow end toward the calyx.
  out.push({
    id: 'renal_papillae',
    geometry: mergeParts(py.map((p) => tube([add(p.apex, p.dir, 0.0032), p.apex, add(p.apex, p.dir, -0.0007)], (t) => 0.0017 - 0.001 * t, 6, 7))),
  });

  // Interlobar vessels: the artery and vein branches of the gaps, thinner than their parents.
  const shZ = (p: V3): V3 => [p[0], p[1], p[2] + 0.0016];
  out.push({ id: 'interlobar_arteries', geometry: mergeParts(gaps.map((q) => tube([ARTERY_END[q.group], q.mid, q.end], (t) => 0.0009 - 0.0002 * t, 6, 5))) });
  out.push({ id: 'interlobar_veins', geometry: mergeParts(gaps.map((q) => tube([VEIN_END[q.group], shZ(q.mid), shZ(q.end)], (t) => 0.0011 - 0.0003 * t, 6, 5))) });

  // Arcuate vessels arch over the base of each pyramid; interlobular vessels rise from them.
  const arcA: THREE.BufferGeometry[] = [];
  const arcV: THREE.BufferGeometry[] = [];
  const ilA: THREE.BufferGeometry[] = [];
  const ilV: THREE.BufferGeometry[] = [];
  py.forEach((p, i) => {
    const ra = p.radius * 1.02;
    const ca = add(p.base, p.dir, 0.0004);
    const cv = add(p.base, p.dir, -0.0005);
    arcA.push(tube(arcPoints(ca, p.dir, ra, 0.3 + i, 0.3 + i + 4.7, 14), () => 0.0005, 14, 4));
    arcV.push(tube(arcPoints(cv, p.dir, ra, 0.3 + i, 0.3 + i + 4.7, 14), () => 0.0006, 14, 4));
    for (let k = 0; k < 4; k++) {
      const ang = 0.3 + i + 0.6 + k * 1.1;
      const [a0] = arcPoints(ca, p.dir, ra, ang, ang, 0);
      const [v0] = arcPoints(cv, p.dir, ra, ang + 0.35, ang + 0.35, 0);
      ilA.push(tube([a0, add(a0, p.dir, 0.0028), add(a0, p.dir, 0.0055)], () => 0.0004, 4, 4));
      ilV.push(tube([v0, add(v0, p.dir, 0.0028), add(v0, p.dir, 0.0052)], () => 0.0005, 4, 4));
    }
  });
  out.push({ id: 'arcuate_arteries', geometry: mergeParts(arcA) });
  out.push({ id: 'arcuate_veins', geometry: mergeParts(arcV) });
  out.push({ id: 'interlobular_arteries', geometry: mergeParts(ilA) });
  out.push({ id: 'interlobular_veins', geometry: mergeParts(ilV) });

  /* ---- the enlarged glomerulus and its children (parent: glomeruli) ---- */
  const G = neph.glomerulus;
  const nd = neph.dir;
  const [e1, e2] = perp(nd);
  const pole = add(G, nd, 0.0016); // the vascular pole faces away from the urinary pole
  const wrapPts = (pts: V3[]): V3[] => pts.map(f);
  out.push({ id: 'bowmans_capsule', geometry: oval(f(G), [0.0015, 0.0015, 0.0015]) });
  out.push({ id: 'parietal_layer', geometry: oval(f(G), [0.00162, 0.00162, 0.00162]) });
  out.push({ id: 'visceral_layer', geometry: oval(f(G), [0.00122, 0.00122, 0.00122]) });
  const loops: V3[] = [];
  for (let k = 0; k <= 60; k++) {
    const t = (k / 60) * Math.PI * 2 * 3;
    loops.push(add(add(add(G, e1, 0.00085 * Math.sin(t)), e2, 0.00085 * Math.cos(1.3 * t)), nd, 0.0008 * Math.sin(2.3 * t + 1)));
  }
  out.push({ id: 'glomerular_capillaries', geometry: tubeAlong(wrapPts(loops), () => 0.00018, { tubular: 70, radial: 5 }) });
  const aff: V3[] = [add(add(G, nd, 0.0009), e1, 0.0006), add(add(G, nd, 0.002), e1, 0.0012), add(add(G, nd, 0.0035), e1, 0.002)];
  const eff: V3[] = [add(add(G, nd, 0.0009), e1, -0.0006), add(add(G, nd, 0.002), e1, -0.0012), add(add(G, nd, 0.0035), e1, -0.0021)];
  out.push({ id: 'afferent_arteriole', geometry: tubeAlong(wrapPts(aff), () => 0.00032, { tubular: 8, radial: 6 }) });
  out.push({ id: 'efferent_arteriole', geometry: tubeAlong(wrapPts(eff), () => 0.00026, { tubular: 8, radial: 6 }) });
  out.push({
    id: 'podocytes',
    geometry: ovals(sphereDirs(24).map((d) => ({ c: f(add(G, d, 0.00112)), r: [0.00016, 0.00016, 0.00009] as V3, n: [m * d[0], d[1], d[2]] as V3 }))),
  });
  out.push({
    id: 'mesangial_cells',
    geometry: ovals(sphereDirs(10).map((d, i) => ({ c: f(add(G, d, 0.0003 + 0.00012 * (i % 3))), r: [0.00014, 0.00011, 0.00011] as V3, n: [m * d[0], d[1], d[2]] as V3 }))),
  });

  /* ---- juxtaglomerular apparatus, at the vascular pole ---- */
  out.push({ id: 'juxtaglomerular_apparatus', geometry: oval(f(add(pole, nd, 0.0004)), [0.00082, 0.00082, 0.00082]) });
  const granular: { c: V3; r: V3; n?: V3 }[] = [];
  for (let k = 0; k < 7; k++) {
    const ph = (k / 7) * Math.PI * 2;
    const base = polyAt(aff, 0.1 + 0.18 * (k % 3));
    granular.push({ c: f(add(add(base, e2, 0.00022 * Math.cos(ph)), nd, 0.00022 * Math.sin(ph))), r: [0.00018, 0.00018, 0.00018] });
  }
  out.push({ id: 'granular_cells', geometry: ovals(granular) });
  out.push({ id: 'extraglomerular_mesangium', geometry: ovals([{ c: f(add(pole, nd, 0.0005)), r: [0.0003, 0.0003, 0.00042], n: e1 }]) });

  /* ---- the enlarged nephron's stretches (parent: nephron) ---- */
  const mk = neph.marks;
  const seg = (a: number, b: number, scale: number, tubular: number, radial = 6): THREE.BufferGeometry => {
    const slice = neph.points.slice(a, b + 1);
    const rs = neph.radii.slice(a, b + 1);
    const last = slice.length - 1;
    return tubeAlong(slice.map(f), (t) => rs[Math.min(last, Math.round(t * last))] * scale, { tubular: Math.max(4, tubular), radial });
  };
  const ascStart = mk.ascending;
  const ascEnd = mk.dct - 1;
  const thinEnd = ascStart + Math.round((ascEnd - ascStart) * 0.3);
  out.push({ id: 'proximal_convoluted_tubule', geometry: seg(mk.pct, mk.descending, 0.85, (mk.descending - mk.pct) * 3) });
  out.push({ id: 'descending_limb', geometry: seg(mk.descending, mk.hairpin, 0.8, (mk.hairpin - mk.descending) * 2) });
  out.push({ id: 'thin_ascending_limb', geometry: seg(ascStart, thinEnd, 0.55, (thinEnd - ascStart) * 2) });
  out.push({ id: 'thick_ascending_limb', geometry: seg(thinEnd, ascEnd, 0.85, (ascEnd - thinEnd) * 2) });
  out.push({ id: 'distal_convoluted_tubule', geometry: seg(mk.dct, mk.duct, 0.85, (mk.duct - mk.dct) * 3) });
  out.push({ id: 'connecting_tubule', geometry: seg(mk.duct, mk.duct + 2, 0.85, 8) });
  out.push({ id: 'collecting_duct', geometry: seg(mk.duct + 2, mk.end, 0.85, (mk.end - mk.duct) * 2) });
  const mdPt = neph.points[ascEnd];
  out.push({ id: 'macula_densa', geometry: oval(f(mdPt), [0.0009, 0.0009, 0.0005], nd) });
  out.push({ id: 'macula_densa_link', geometry: tubeAlong(wrapPts([mdPt, add(polyAt([mdPt, pole], 0.5), e2, 0.0006), pole]), () => 0.00018, { tubular: 12, radial: 5 }) });

  // Cells of the collecting duct: larger pale principal cells, a few dark intercalated cells.
  const principal: { c: V3; r: V3 }[] = [];
  const intercalated: { c: V3; r: V3 }[] = [];
  const [d1, d2] = perp(nd);
  for (let i = mk.duct + 2; i <= mk.end; i++) {
    const c = neph.points[i];
    const rad = neph.radii[i] * 0.85;
    const ring = (ang: number, k: number): V3 => add(add(c, d1, Math.cos(ang) * rad * k), d2, Math.sin(ang) * rad * k);
    for (let a = 0; a < (i % 2 ? 2 : 1); a++) principal.push({ c: f(ring(i * 0.9 + a * Math.PI, 1)), r: [0.00028, 0.00028, 0.00028] });
    if (i % 3 === 0) intercalated.push({ c: f(ring(i * 0.9 + Math.PI / 2, 1)), r: [0.00018, 0.00018, 0.00018] });
  }
  out.push({ id: 'principal_cells', geometry: ovals(principal) });
  out.push({ id: 'intercalated_cells', geometry: ovals(intercalated) });

  // Capillaries wound round the convoluted tubules, and the hairpin vasa recta beside the loop.
  const pctPts = neph.points.slice(mk.pct, mk.descending + 1);
  const dctPts = neph.points.slice(mk.dct, mk.duct + 1);
  out.push({
    id: 'peritubular_capillaries',
    geometry: mergeParts([
      tubeAlong(wrapPts(coilAround(pctPts, 0.0009, 5, 60)), () => 0.00016, { tubular: 90, radial: 4 }),
      tubeAlong(wrapPts(coilAround(dctPts, 0.0009, 3, 36, 1)), () => 0.00016, { tubular: 54, radial: 4 }),
    ]),
  });
  const loopPts = neph.points.slice(mk.descending, ascEnd + 1).map((p): V3 => [p[0], p[1] + 0.0011, p[2]]);
  out.push({ id: 'vasa_recta', geometry: tubeAlong(wrapPts(loopPts), () => 0.0002, { tubular: loopPts.length * 2, radial: 4 }) });
  return out;
};
