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
 * cortical radiate vessels are left out; the interlobar arteries simply end at the
 * corticomedullary junction.
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

const add = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const norm = (a: V3): V3 => {
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

  // 1. Bowman's capsule: a fat short run of tube, with the glomerular tuft sitting inside it.
  for (let k = 0; k < 4; k++) push(at(sc + 0.0062 - 0.0014 * k, 0.003, 0.0035), 0.0017);
  // 2. Proximal convoluted tubule: a tangle wandering about the capsule.
  for (let k = 0; k < 16; k++) {
    push(at(sc + 0.002 + 0.001 * Math.sin(0.9 * k), 0.003 + 0.0021 * Math.cos(1.3 * k + 1), 0.0035 + 0.0021 * Math.sin(1.3 * k + 1)), 0.0006);
  }
  // 3. Descending limb: thin, straight down the pyramid beside its axis.
  const sLoop = 0.3 * sc;
  const down = Math.round((sc + 0.0015 - sLoop) / 0.0012);
  for (let k = 0; k <= down; k++) push(at(sc + 0.0015 - ((sc + 0.0015 - sLoop) * k) / down, 0.0016, 0), 0.00035);
  // 4. The hairpin of the loop of Henle.
  for (let k = 1; k < 6; k++) {
    const ang = (Math.PI * k) / 6;
    push(at(sLoop - 0.0016 * Math.sin(ang), 0.0016 * Math.cos(ang), 0), 0.0006);
  }
  // 5. Thick ascending limb back to the cortex on the far side of the axis.
  for (let k = 0; k <= down; k++) push(at(sLoop + ((sc + 0.003 - sLoop) * k) / down, -0.0016, 0), 0.0006);
  // 6. Distal convoluted tubule: a second, smaller tangle beside the first.
  for (let k = 0; k < 10; k++) {
    push(at(sc + 0.0035 + 0.0008 * Math.sin(0.9 * k), -0.003 + 0.0015 * Math.cos(1.5 * k), -0.002 + 0.0015 * Math.sin(1.5 * k)), 0.0006);
  }
  // 7. Collecting duct: onto the axis, then straight down to the papilla.
  const duct = pts.length;
  push(at(sc + 0.0025, 0, 0), 0.0008);
  const n = Math.round((sc + 0.0025 - 0.0008) / 0.0012);
  for (let k = 1; k <= n; k++) {
    const s = sc + 0.0025 - ((sc + 0.0017) * k) / n;
    push(at(s, 0, 0), 0.0008 - 0.0002 * (k / n));
  }
  return { points: pts, radii: rad, glomerulus, duct, papilla: at(0.0008, 0, 0) };
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
  return out;
};
