import * as THREE from 'three';
import {
  ellipsoid, halfSpace, intersect, mergeParts, offset, polygonise, smoothSubtract, smoothUnion, sphere,
  tubeAlong, type Sdf, type V3,
} from '../sdf';
import { fbm, mulberry32 } from '../noise';
import type { PartGeometry } from '../parts';
import type { SimSnapshot } from '../../../bridge/types';
import type { DetailContext, FlowSpec, OrganDetailSpec } from '../detail/types';
import { DEOXYGENATED, OXYGENATED, bloodColour } from '../detail/blood';

/**
 * WHAT BOTH LUNGS SHARE: THE LOBES, THE AIRWAY TREE, THE VESSELS AND THE ALVEOLI.
 *
 * `lung_l` and `lung_r` are separate atlases because the engine reports them as separate
 * organs, but they are the same machine drawn twice: a mass of tissue cut into lobes by
 * the fissures, entered at the hilum by a bronchus and a pulmonary artery and left by
 * pulmonary veins, with the bronchus dividing again and again until it ends in clusters of
 * alveoli. Everything that does not depend on the side lives here, so that the two
 * atlases differ only in the one thing that really differs: how many lobes there are.
 *
 * WORKER-SAFE. This file is imported by the geometry worker (for the parts) and by the
 * main thread (the detail modules need the same centrelines to run their particles along),
 * so it imports only the modelling toolkit and the part type.
 *
 * THE SHELL IS COPIED, NOT IMPORTED. `lung()` in models.ts is private and returns a mesh,
 * not a field; a lobe has to be a field intersected with a half-space, so the shell's
 * recipe (two ellipsoids, a flattened mediastinal face, the diaphragmatic hollow, the
 * cardiac impression and the hilum) is repeated here WITHOUT the fissure cuts, which this
 * file applies itself as lobe boundaries. If the shell's proportions change in models.ts
 * this must change with it; the bounds check in the probe is what notices.
 *
 * WHAT IT DOES NOT DO. The branching is a deterministic space-dividing tree (each lobe's
 * volume is split in two along its widest axis, three times), not a traced bronchial atlas:
 * the real tree has about twenty-three generations and its branching is irregular. It is
 * drawn to show that the airway divides, that the vessels run with it and that the veins
 * run apart from it, not to be counted.
 */

export type LobeId = 'upper_lobe' | 'middle_lobe' | 'lower_lobe';

export const LUNG_BOX_MIN: V3 = [-0.066, -0.124, -0.072];
export const LUNG_BOX_MAX: V3 = [0.066, 0.12, 0.072];

/** Where the bronchus and the vessels enter, in the lung's own frame. */
export function hilum(side: -1 | 1): V3 {
  const med = side < 0 ? 1 : -1;
  return [med * 0.047, 0.012, -0.004];
}

/** The lung as one mass, with no fissures: the shell recipe of models.ts without its cuts. */
export function lungBaseField(side: -1 | 1): Sdf {
  const med = side < 0 ? 1 : -1;
  const left = side < 0;
  let f = smoothUnion(
    0.035,
    ellipsoid([-med * 0.004, -0.04, 0], [0.058, 0.082, 0.066]),
    ellipsoid([med * 0.012, 0.05, -0.006], [0.036, 0.066, 0.044]),
  );
  f = smoothSubtract(0.014, f, halfSpace([med * 0.042, 0, 0], [med, 0, 0]));
  f = smoothSubtract(0.012, f, ellipsoid([med * 0.03, -0.165, 0.0], [0.11, 0.07, 0.1]));
  f = left
    ? smoothSubtract(0.012, f, ellipsoid([med * 0.062, -0.04, 0.03], [0.04, 0.055, 0.046]))
    : smoothSubtract(0.012, f, ellipsoid([med * 0.066, -0.035, 0.022], [0.034, 0.045, 0.04]));
  return smoothSubtract(0.006, f, sphere([med * 0.047, 0.012, -0.004], 0.014));
}

/* The oblique fissure plane passes through (0, 0.012, 0) with normal (0, 1, 0.9). */
const NORM = Math.hypot(1, 0.9);
const NY = 1 / NORM;
const NZ = 0.9 / NORM;

/** Lobe boundaries: the side of each fissure the lobe lies on, held `margin` metres off the plane. */
function lobePlanes(side: -1 | 1, lobe: LobeId, margin: number): Sdf[] {
  const above = (m: number): Sdf => halfSpace([0, 0.012 + NY * m, NZ * m], [0, 1, 0.9]);
  const below = (m: number): Sdf => halfSpace([0, 0.012 - NY * m, -NZ * m], [0, -1, -0.9]);
  if (lobe === 'lower_lobe') return [below(margin)];
  if (side < 0) return [above(margin)];
  // Right lung: the horizontal fissure (y = 0.03) divides what lies above the oblique one.
  if (lobe === 'upper_lobe') return [above(margin), halfSpace([0, 0.03 + margin, 0], [0, 1, 0])];
  return [above(margin), halfSpace([0, 0.03 - margin, 0], [0, -1, 0])];
}

/** One lobe as a field, drawn in from the shell by `inset` and from each fissure by `margin`. */
export function lobeField(side: -1 | 1, lobe: LobeId, inset: number, margin: number): Sdf {
  const base = offset(lungBaseField(side), -inset);
  let f = base;
  for (const p of lobePlanes(side, lobe, margin)) f = intersect(f, p);
  return f;
}

export function lobesOf(side: -1 | 1): LobeId[] {
  return side < 0 ? ['upper_lobe', 'lower_lobe'] : ['upper_lobe', 'middle_lobe', 'lower_lobe'];
}

/* ------------------------------------------------------------------ trees */

interface TNode {
  p: V3;
  level: number;
  parent: number;
}

export interface Seg {
  /** Tree level of the node this segment ends at: 1 lobar bronchus, 2 segmental, 3 bronchiole, 4 terminal. */
  level?: number;
  a: V3;
  b: V3;
  ra: number;
  rb: number;
}

export interface LobeTree {
  lobe: LobeId;
  /** Airway segments, lobar bronchus first, three further divisions. */
  bronchi: Seg[];
  /** Pulmonary artery branches running with the airway. */
  arteries: Seg[];
  /** Pulmonary vein branches running apart from it. */
  veins: Seg[];
  /** Ends of the smallest airways: where alveolar clusters sit. */
  leaves: V3[];
  /** Hilum-to-periphery centrelines, a few per lobe, for the particle streams. */
  airPaths: V3[][];
  arteryPaths: V3[][];
  veinPaths: V3[][];
}

/** Radii by tree level, metres: tapering from a lobar bronchus to a small airway. */
const BR = [0.003, 0.0023, 0.0017, 0.0012, 0.00085];
const ART = 0.78;
const VR = [0.0026, 0.002, 0.0015, 0.0011];

function lobePoints(side: -1 | 1, lobe: LobeId): V3[] {
  const f = lobeField(side, lobe, 0.009, 0.009);
  const pts: V3[] = [];
  const step = 0.006;
  for (let x = LUNG_BOX_MIN[0]; x <= LUNG_BOX_MAX[0]; x += step)
    for (let y = LUNG_BOX_MIN[1]; y <= LUNG_BOX_MAX[1]; y += step)
      for (let z = LUNG_BOX_MIN[2]; z <= LUNG_BOX_MAX[2]; z += step) if (f(x, y, z) < 0) pts.push([x, y, z]);
  return pts;
}

function centroid(pts: readonly V3[]): V3 {
  let x = 0, y = 0, z = 0;
  for (const p of pts) { x += p[0]; y += p[1]; z += p[2]; }
  const n = Math.max(1, pts.length);
  return [x / n, y / n, z / n];
}

/** Axis (0..2) of the given variance rank: 0 the widest, 1 the next. */
function axisByVariance(pts: readonly V3[], c: V3, rank: 0 | 1): 0 | 1 | 2 {
  const v = [0, 0, 0];
  for (const p of pts) for (let k = 0; k < 3; k++) v[k] += (p[k] - c[k]) * (p[k] - c[k]);
  const order = [0, 1, 2].sort((a, b) => v[b] - v[a] || a - b);
  return order[rank] as 0 | 1 | 2;
}

function lerp3(a: V3, b: V3, t: number): V3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Divide a lobe's volume `tubes` times, from `root`; returns the nodes and the indices of the ends. */
function grow(pts: V3[], root: V3, tubes: number, rank: 0 | 1): { nodes: TNode[]; leaves: number[] } {
  const nodes: TNode[] = [{ p: root, level: 0, parent: -1 }];
  const leaves: number[] = [];
  const rec = (set: V3[], from: number, level: number): void => {
    const c = centroid(set);
    // The lobar bronchus stops short of the lobe's middle; the last tube reaches nearly to its ends.
    const frac = level === tubes - 1 ? 0.9 : level === 0 ? 0.55 : 0.65;
    const idx = nodes.length;
    nodes.push({ p: lerp3(nodes[from].p, c, frac), level: level + 1, parent: from });
    if (level + 1 === tubes || set.length < 4) { leaves.push(idx); return; }
    const axis = axisByVariance(set, c, rank);
    const lo = set.filter((p) => p[axis] < c[axis]);
    const hi = set.filter((p) => p[axis] >= c[axis]);
    if (lo.length === 0 || hi.length === 0) { leaves.push(idx); return; }
    rec(lo, idx, level + 1);
    rec(hi, idx, level + 1);
  };
  rec(pts, 0, 0);
  return { nodes, leaves };
}

function segsOf(nodes: readonly TNode[], radii: readonly number[], scale: number, maxLevel: number): Seg[] {
  const out: Seg[] = [];
  for (const n of nodes) {
    if (n.parent < 0 || n.level > maxLevel) continue;
    out.push({ level: n.level, a: nodes[n.parent].p, b: n.p, ra: radii[n.level - 1] * scale, rb: radii[n.level] * scale });
  }
  return out;
}

function pathTo(nodes: readonly TNode[], idx: number): V3[] {
  const out: V3[] = [];
  for (let i = idx; i >= 0; i = nodes[i].parent) out.unshift(nodes[i].p);
  return out;
}

/** Nodes moved sideways, perpendicular to the way the branch arrives, so a vessel runs beside its airway. */
function shifted(nodes: readonly TNode[], sign: number): TNode[] {
  return nodes.map((n, i) => {
    const ref = n.parent < 0 ? nodes.findIndex((m) => m.parent === i) : i;
    const from = n.parent < 0 ? n.p : nodes[n.parent].p;
    const to = n.parent < 0 ? nodes[ref].p : n.p;
    let dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    // cross(d, up), or cross(d, x) when the branch is nearly vertical
    let sx: number, sy: number, sz: number;
    if (Math.abs(dy) < 0.9) { sx = dz; sy = 0; sz = -dx; } else { sx = 0; sy = -dz; sz = dy; }
    const sl = Math.hypot(sx, sy, sz) || 1;
    const d = (BR[n.level] * (1 + ART) + 0.0004) * sign;
    return { p: [n.p[0] + (sx / sl) * d, n.p[1] + (sy / sl) * d, n.p[2] + (sz / sl) * d] as V3, level: n.level, parent: n.parent };
  });
}

const treeCache = new Map<number, LobeTree[]>();

/** Every lobe's airway, artery and vein trees. Deterministic, built once per side. */
export function lungTrees(side: -1 | 1): LobeTree[] {
  const cached = treeCache.get(side);
  if (cached) return cached;
  // The tree starts 10 mm lateral of the hilum's centre: the shell's mediastinal face is flat at
  // x = 42 mm and the pocket's centre lies beyond it, so a root there would stand outside the lung.
  const hc = hilum(side);
  const h: V3 = [hc[0] - (side < 0 ? 1 : -1) * 0.01, hc[1], hc[2]];
  const trees: LobeTree[] = [];
  const leafCounts: Record<LobeId, number> = side < 0
    ? { upper_lobe: 5, middle_lobe: 0, lower_lobe: 5 }
    : { upper_lobe: 4, middle_lobe: 3, lower_lobe: 5 };
  for (const lobe of lobesOf(side)) {
    const pts = lobePoints(side, lobe);
    const br = grow(pts, h, 4, 0);
    const aNodes = shifted(br.nodes, 1);
    const vRoot: V3 = [h[0], h[1] - 0.007, h[2] + 0.004];
    const vn = grow(pts, vRoot, 3, 1);
    // Leaves in tree order, thinned evenly to the number of alveolar clusters this lobe gets.
    const want = leafCounts[lobe];
    const leaves: V3[] = [];
    for (let k = 0; k < want; k++) leaves.push(br.nodes[br.leaves[Math.floor(((k + 0.5) * br.leaves.length) / want)]].p);
    const pick = (ls: number[], n: number): number[] => {
      const r: number[] = [];
      for (let k = 0; k < n; k++) r.push(ls[Math.floor(((k + 0.5) * ls.length) / n)]);
      return r;
    };
    // Arteries end at the level-3 nodes (one tube shorter than the airway).
    const aLeaves = br.nodes.map((n, i) => (n.level === 3 ? i : -1)).filter((i) => i >= 0);
    trees.push({
      lobe,
      bronchi: segsOf(br.nodes, BR, 1, 4),
      arteries: segsOf(aNodes, BR, ART, 3),
      veins: segsOf(vn.nodes, VR, 1, 3),
      leaves,
      airPaths: pick(br.leaves, 2).map((i) => pathTo(br.nodes, i)),
      arteryPaths: pick(aLeaves, 2).map((i) => pathTo(aNodes, i)),
      veinPaths: pick(vn.leaves, 2).map((i) => pathTo(vn.nodes, i)),
    });
  }
  treeCache.set(side, trees);
  return trees;
}

/* --------------------------------------------------------------- geometry */

function tubes(segs: readonly Seg[]): THREE.BufferGeometry {
  return mergeParts(
    segs.map((s) => tubeAlong([s.a, s.b], (t) => s.ra + (s.rb - s.ra) * t, { tubular: 4, radial: 6 })),
  );
}

/** The four sacs of one alveolar cluster: centre and radius of each, deterministic from the seed. */
export function clusterSacs(centre: V3, seed: number): { c: V3; r: number }[] {
  const rnd = mulberry32(seed);
  const sacs: { c: V3; r: number }[] = [];
  for (let k = 0; k < 4; k++) {
    const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    const o = 0.0028;
    sacs.push({ c: [centre[0] + o * s * Math.cos(th), centre[1] + o * u, centre[2] + o * s * Math.sin(th)], r: 0.0024 + rnd() * 0.0006 });
  }
  return sacs;
}

/** A cluster of alveolar sacs: four bumpy spheres fused, each far larger than a real alveolus so it can be seen. */
function alveolarCluster(centre: V3, seed: number): THREE.BufferGeometry {
  const f = smoothUnion(0.001, ...clusterSacs(centre, seed).map((s) => sphere(s.c, s.r)));
  const bumpy: Sdf = (x, y, z) => f(x, y, z) + 0.0004 * fbm(x, y, z, 700, 2);
  const r = 0.0085;
  return polygonise(bumpy, [centre[0] - r, centre[1] - r, centre[2] - r], [centre[0] + r, centre[1] + r, centre[2] + r], { cell: 0.0015, pad: 1 });
}

/** Every alveolar cluster of one side: where it sits (the airway's end) and the seed that shapes it. */
export function lungClusters(side: -1 | 1): { leaf: V3; seed: number }[] {
  const out: { leaf: V3; seed: number }[] = [];
  let n = 0;
  for (const t of lungTrees(side)) for (const leaf of t.leaves) out.push({ leaf, seed: 977 * (n++ + 1) + (side < 0 ? 1 : 2) });
  return out;
}

/** Every part of one lung, in the order the atlas JSON lists them. */
export function buildLungParts(side: -1 | 1): PartGeometry[] {
  const out: PartGeometry[] = [];
  for (const lobe of lobesOf(side)) {
    // 3.4 mm off each fissure plane so a lobe stays inside the shell's own (wider) cut.
    out.push({
      id: lobe,
      geometry: polygonise(lobeField(side, lobe, 0.0015, 0.0034), LUNG_BOX_MIN, LUNG_BOX_MAX, { cell: 0.0055 }),
    });
  }
  const trees = lungTrees(side);
  out.push({ id: 'bronchial_tree', geometry: mergeParts(trees.map((t) => tubes(t.bronchi))) });
  out.push({ id: 'pulmonary_arteries', geometry: mergeParts(trees.map((t) => tubes(t.arteries))) });
  out.push({ id: 'pulmonary_veins', geometry: mergeParts(trees.map((t) => tubes(t.veins))) });
  out.push({ id: 'alveoli', geometry: mergeParts(lungClusters(side).map((c) => alveolarCluster(c.leaf, c.seed))) });
  // The pleura: the lung's outer skin, drawn a little inside the shell and a little outside the lobes.
  out.push({
    id: 'pleura',
    geometry: polygonise(offset(lungBaseField(side), -0.0006), LUNG_BOX_MIN, LUNG_BOX_MAX, { cell: 0.0065 }),
  });
  out.push(...buildLungChildren(side));
  return out;
}

/* ------------------------------------------------------- finer structures */

/**
 * THE LEVEL-1 GAPS AND THE CHILDREN OF BOTH LUNGS (src/data/anatomy/lung_*.json, `parent`).
 *
 * Everything here is ILLUSTRATIVE and hand-placed in the lung's own frame; none of it is a
 * traced atlas. Surfaces of the lung (apex, costal, mediastinal, diaphragmatic, cardiac
 * notch) are triangles cut from ONE coarse copy of the lung's outer surface by where their
 * centre lies, so they tile it and never lie on top of one another. The bronchopulmonary
 * segments are the lobe divided by nearest seed point (a Voronoi division of the lobe in its
 * own box), so their names and neighbours follow Gray's but their boundaries are a drawing
 * choice. The alveolar cells, capillaries, pores and the respiratory membrane are drawn as a
 * MAGNIFIED SCHEMATIC on the alveolar clusters (a cell is far smaller than drawn) and are
 * not to scale to each other. Counts (how many nodes, how many pores) are schematic.
 *
 * COST. Children are hidden until their parent is looked at (reveal.ts), but they are still
 * built when the organ opens, so every one is kept small: low-poly spheres and thin tubes,
 * and meshes polygonised on a coarse grid. Earlier drafts used the lobe grid for the
 * segments and the pleura and put the lung at about three times its old triangle count.
 */

const SEG_NAMES: Record<number, Record<string, { lobe: LobeId; seed: V3 }>> = {
  // seed = (anterior 0..1, height 0..1, medial 0..1) inside the lobe's own bounding box.
  [-1]: {
    seg_apicoposterior: { lobe: 'upper_lobe', seed: [0.2, 0.9, 0.4] },
    seg_anterior: { lobe: 'upper_lobe', seed: [0.9, 0.6, 0.5] },
    seg_superior_lingular: { lobe: 'upper_lobe', seed: [0.8, 0.25, 0.5] },
    seg_inferior_lingular: { lobe: 'upper_lobe', seed: [0.6, 0.02, 0.5] },
    seg_superior: { lobe: 'lower_lobe', seed: [0.2, 0.9, 0.5] },
    seg_anteromedial_basal: { lobe: 'lower_lobe', seed: [0.8, 0.1, 0.8] },
    seg_lateral_basal: { lobe: 'lower_lobe', seed: [0.5, 0.1, 0.0] },
    seg_posterior_basal: { lobe: 'lower_lobe', seed: [0.05, 0.15, 0.5] },
  },
  [1]: {
    seg_apical: { lobe: 'upper_lobe', seed: [0.5, 0.95, 0.4] },
    seg_posterior: { lobe: 'upper_lobe', seed: [0.1, 0.6, 0.2] },
    seg_anterior: { lobe: 'upper_lobe', seed: [0.9, 0.55, 0.6] },
    seg_lateral: { lobe: 'middle_lobe', seed: [0.5, 0.5, 0.1] },
    seg_medial: { lobe: 'middle_lobe', seed: [0.5, 0.5, 0.9] },
    seg_superior: { lobe: 'lower_lobe', seed: [0.2, 0.9, 0.5] },
    seg_medial_basal: { lobe: 'lower_lobe', seed: [0.4, 0.1, 0.9] },
    seg_anterior_basal: { lobe: 'lower_lobe', seed: [0.9, 0.15, 0.4] },
    seg_lateral_basal: { lobe: 'lower_lobe', seed: [0.5, 0.1, 0.0] },
    seg_posterior_basal: { lobe: 'lower_lobe', seed: [0.0, 0.15, 0.5] },
  },
};

const boxCache = new Map<string, { min: V3; max: V3 }>();
function lobeBox(side: -1 | 1, lobe: LobeId): { min: V3; max: V3 } {
  const key = `${side}${lobe}`;
  const hit = boxCache.get(key);
  if (hit) return hit;
  const pts = lobePoints(side, lobe);
  const b = { min: [1, 1, 1] as number[], max: [-1, -1, -1] as number[] };
  for (const p of pts) for (let k = 0; k < 3; k++) { b.min[k] = Math.min(b.min[k], p[k]); b.max[k] = Math.max(b.max[k], p[k]); }
  const out = { min: b.min as unknown as V3, max: b.max as unknown as V3 };
  boxCache.set(key, out);
  return out;
}

/** A low-poly sphere scaled to radii `r`, optionally turned so its local z points along `n`. A few dozen triangles. */
export function blob(c: V3, r: number | V3, n?: V3, w = 6, h = 4): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, w, h);
  const q = new THREE.Quaternion();
  if (n) q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(n[0], n[1], n[2]).normalize());
  const rs = typeof r === 'number' ? [r, r, r] : r;
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(c[0], c[1], c[2]), q, new THREE.Vector3(rs[0], rs[1], rs[2])));
  g.deleteAttribute('uv');
  return g;
}

export function thin(a: V3, b: V3, r: number, radial = 4): THREE.BufferGeometry {
  return tubeAlong([a, b], () => r, { tubular: 2, radial });
}

/** A closed ring of tube round `c`, in the plane perpendicular to `axis`. */
export function ring(c: V3, axis: V3, R: number, r: number, tubular = 10, radial = 3): THREE.BufferGeometry {
  const n = new THREE.Vector3(axis[0], axis[1], axis[2]).normalize();
  const u = new THREE.Vector3().crossVectors(n, Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
  const v = new THREE.Vector3().crossVectors(n, u);
  const pts: V3[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    pts.push([c[0] + R * (u.x * Math.cos(a) + v.x * Math.sin(a)), c[1] + R * (u.y * Math.cos(a) + v.y * Math.sin(a)), c[2] + R * (u.z * Math.cos(a) + v.z * Math.sin(a))]);
  }
  return tubeAlong(pts, () => r, { tubular, radial, closed: true });
}

/** The triangles of `g` whose centre satisfies `keep`, re-indexed as their own mesh. */
function trianglesWhere(g: THREE.BufferGeometry, keep: (x: number, y: number, z: number) => boolean): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  const idx = g.getIndex()!;
  const remap = new Map<number, number>();
  const P: number[] = [];
  const N: number[] = [];
  const I: number[] = [];
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
    const x = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
    const y = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
    const z = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
    if (!keep(x, y, z)) continue;
    for (const v of [a, b, c]) {
      let m = remap.get(v);
      if (m === undefined) {
        m = P.length / 3;
        remap.set(v, m);
        P.push(pos.getX(v), pos.getY(v), pos.getZ(v));
        N.push(nor.getX(v), nor.getY(v), nor.getZ(v));
      }
      I.push(m);
    }
  }
  if (I.length === 0) {
    // An empty selection would make an unrenderable part; keep one degenerate triangle at the origin.
    P.push(0, 0, 0, 0, 0, 0, 0, 0, 0);
    N.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    I.push(0, 1, 2);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  out.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N), 3));
  out.setIndex(I);
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/** A flat sheet on a plane through `o` spanned by unit vectors u, v, kept only where `keep` holds at all four corners of a cell. */
function planeSheet(o: V3, u: V3, v: V3, uMax: number, vMax: number, step: number, keep: (x: number, y: number, z: number) => boolean): THREE.BufferGeometry {
  const nu = Math.round((2 * uMax) / step), nv = Math.round((2 * vMax) / step);
  const at = (i: number, j: number): V3 => {
    const a = -uMax + i * step, b = -vMax + j * step;
    return [o[0] + u[0] * a + v[0] * b, o[1] + u[1] * a + v[1] * b, o[2] + u[2] * a + v[2] * b];
  };
  const ok: boolean[] = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const p = at(i, j); ok.push(keep(p[0], p[1], p[2])); }
  const P: number[] = [];
  const I: number[] = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const p = at(i, j); P.push(p[0], p[1], p[2]); }
  const row = nu + 1;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
      if (ok[a] && ok[b] && ok[c] && ok[d]) I.push(a, c, b, b, c, d);
    }
  }
  if (I.length === 0) I.push(0, 1, 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  g.setIndex(I);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Direction at right angles to a segment, used to lay a small vessel beside its airway. */
function beside(s: Seg, k: number): { a: V3; b: V3 } {
  let dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], dz = s.b[2] - s.a[2];
  const l = Math.hypot(dx, dy, dz) || 1;
  dx /= l; dy /= l; dz /= l;
  let px = dy, py = -dx, pz = 0;
  if (Math.hypot(px, py, pz) < 0.3) { px = 0; py = dz; pz = -dy; }
  const pl = Math.hypot(px, py, pz) || 1;
  const d = k * (s.ra + 0.0007) / pl;
  return { a: [s.a[0] + px * d, s.a[1] + py * d, s.a[2] + pz * d], b: [s.b[0] + px * d, s.b[1] + py * d, s.b[2] + pz * d] };
}

/** One closed copy of the lung's outer surface, `grow` metres outside the pleura (negative: inside), on a coarse grid. */
function skin(side: -1 | 1, grow: number, cell: number): THREE.BufferGeometry {
  const pad = 0.02;
  return polygonise(
    offset(lungBaseField(side), grow),
    [LUNG_BOX_MIN[0] - pad, LUNG_BOX_MIN[1] - pad, LUNG_BOX_MIN[2] - pad],
    [LUNG_BOX_MAX[0] + pad, LUNG_BOX_MAX[1] + pad, LUNG_BOX_MAX[2] + pad],
    { cell },
  );
}

function ligamentSheet(side: -1 | 1): THREE.BufferGeometry {
  const med = side < 0 ? 1 : -1;
  const x = med * 0.039;
  const P: number[] = [];
  const I: number[] = [];
  const rows = 6;
  // A fold narrowing downward: the double sheet of pleura hanging from the root.
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const y = -0.002 - 0.07 * t;
    const w = 0.006 * (1 - t) + 0.0005;
    P.push(x, y, -0.004 - w, x, y, -0.004 + w);
  }
  for (let i = 0; i < rows; i++) { const a = i * 2; I.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  g.setIndex(I);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Every finer structure of one lung, in the lung's own frame. */
export function buildLungChildren(side: -1 | 1): PartGeometry[] {
  const out: PartGeometry[] = [];
  const med = side < 0 ? 1 : -1;
  const left = side < 0;
  const trees = lungTrees(side);
  const hc = hilum(side);
  const h: V3 = [hc[0] - med * 0.01, hc[1], hc[2]];

  /* --- surfaces, tiled from one coarse copy of the outer surface --- */
  const surf = skin(side, -0.0008, 0.0085);
  // Order matters: the first test a triangle passes names it. The cardiac impression is tested before the mediastinal face.
  const classify = (x: number, y: number, z: number): string => {
    if (y > 0.088) return 'apex';
    if (y < -0.092) return 'diaphragmatic_surface';
    if (left) {
      const dx = (x - med * 0.062) / 0.052, dy = (y + 0.04) / 0.067, dz = (z - 0.03) / 0.058;
      if (dx * dx + dy * dy + dz * dz < 1 && z > 0.0) return 'cardiac_notch';
    }
    if (med * x > 0.028) return 'mediastinal_surface';
    return 'costal_surface';
  };
  const names = ['apex', 'costal_surface', 'mediastinal_surface', 'diaphragmatic_surface'].concat(left ? ['cardiac_notch'] : []);
  for (const n of names) out.push({ id: n, geometry: trianglesWhere(surf, (x, y, z) => classify(x, y, z) === n) });
  surf.dispose();

  /* --- fissures and the lingula --- */
  const base = lungBaseField(side);
  out.push({
    id: 'oblique_fissure',
    geometry: planeSheet([0, 0.012, 0], [1, 0, 0], [0, -NZ, NY], 0.07, 0.14, 0.0075, (x, y, z) => base(x, y, z) < -0.0015),
  });
  if (left) {
    const upper = lobeField(-1, 'upper_lobe', 0.0015, 0.0034);
    out.push({
      id: 'lingula',
      geometry: polygonise((x, y, z) => Math.max(upper(x, y, z), y - 0.004), LUNG_BOX_MIN, LUNG_BOX_MAX, { cell: 0.0075 }),
    });
  } else {
    out.push({
      id: 'horizontal_fissure',
      geometry: planeSheet([0, 0.03, 0], [1, 0, 0], [0, 0, 1], 0.07, 0.07, 0.0075, (x, y, z) => base(x, y, z) < -0.0015 && y + 0.9 * z > 0.018),
    });
  }

  /* --- the root and what hangs from it --- */
  out.push({
    id: 'hilum',
    geometry: mergeParts([
      thin(h, [hc[0] + med * 0.004, hc[1], hc[2]], 0.0032, 6),
      thin([h[0], h[1] + 0.005, h[2] - 0.002], [hc[0] + med * 0.004, hc[1] + 0.006, hc[2] - 0.002], 0.0026, 6),
      thin([h[0], h[1] - 0.007, h[2] + 0.004], [hc[0] + med * 0.004, hc[1] - 0.008, hc[2] + 0.004], 0.0022, 6),
      thin([h[0], h[1] - 0.011, h[2] - 0.004], [hc[0] + med * 0.004, hc[1] - 0.012, hc[2] - 0.004], 0.0018, 6),
    ]),
  });
  out.push({ id: 'pulmonary_ligament', geometry: ligamentSheet(side) });
  const small = trees.flatMap((t) => t.bronchi.filter((s) => (s.level ?? 9) <= 3));
  out.push({ id: 'bronchial_arteries', geometry: mergeParts(small.map((s) => { const q = beside(s, 1); return thin(q.a, q.b, 0.0004, 3); })) });
  out.push({ id: 'bronchial_veins', geometry: mergeParts(small.map((s) => { const q = beside(s, -1); return thin(q.a, q.b, 0.0004, 3); })) });
  const nodeAt: V3[] = [[-0.004, 0.009, 0.006], [-0.002, 0.005, -0.008], [-0.006, -0.008, 0.007], [-0.003, -0.01, -0.006], [-0.007, 0.0, 0.0]];
  out.push({
    id: 'hilar_lymph_nodes',
    geometry: mergeParts(nodeAt.map((o, i) => blob([h[0] + med * (0.002 + o[0]), hc[1] + o[1], hc[2] + o[2]], [0.0028, 0.002 + 0.0003 * (i % 2), 0.002], undefined, 7, 5))),
  });

  /* --- pleura: four closed copies of the outer surface, one inside the pleura and three outside --- */
  out.push({ id: 'visceral_pleura', geometry: skin(side, -0.0016, 0.012) });
  out.push({ id: 'pleural_cavity', geometry: skin(side, 0.0018, 0.012) });
  out.push({ id: 'parietal_pleura', geometry: skin(side, 0.0036, 0.012) });
  const recess = skin(side, 0.007, 0.012);
  out.push({ id: 'costodiaphragmatic_recess', geometry: trianglesWhere(recess, (x, y) => y < -0.085 && med * x < 0.012) });
  recess.dispose();

  /* --- airway generations --- */
  const lvl = (n: number): Seg[] => trees.flatMap((t) => t.bronchi.filter((s) => s.level === n));
  const tubesOf = (segs: Seg[], k: number): THREE.BufferGeometry =>
    mergeParts(segs.map((s) => tubeAlong([s.a, s.b], (t) => (s.ra + (s.rb - s.ra) * t) * k, { tubular: 3, radial: 5 })));
  out.push({ id: 'main_bronchus', geometry: thin([h[0] + med * 0.006, h[1], h[2]], h, 0.0028, 7) });
  out.push({ id: 'lobar_bronchi', geometry: tubesOf(lvl(1), 0.8) });
  out.push({ id: 'segmental_bronchi', geometry: tubesOf(lvl(2), 0.8) });
  out.push({ id: 'bronchioles', geometry: tubesOf(lvl(3), 0.8) });
  out.push({ id: 'terminal_bronchioles', geometry: tubesOf(lvl(4), 0.8) });

  /* --- alveolar zone: magnified schematic on every cluster --- */
  const respB: THREE.BufferGeometry[] = [], ducts: THREE.BufferGeometry[] = [], sacsG: THREE.BufferGeometry[] = [];
  const t1: THREE.BufferGeometry[] = [], t2: THREE.BufferGeometry[] = [], mac: THREE.BufferGeometry[] = [];
  const cap: THREE.BufferGeometry[] = [], mem: THREE.BufferGeometry[] = [], pore: THREE.BufferGeometry[] = [];
  for (const cl of lungClusters(side)) {
    const sacs = clusterSacs(cl.leaf, cl.seed);
    const mid = lerp3(cl.leaf, sacs[0].c, 0.5);
    respB.push(thin(cl.leaf, mid, 0.0007));
    ducts.push(thin(mid, sacs[1].c, 0.0005, 3), thin(mid, sacs[2].c, 0.0005, 3));
    for (const s of sacs) sacsG.push(blob(s.c, s.r * 0.92, undefined, 5, 3));
    const dir = (s: { c: V3 }): V3 => {
      const d: V3 = [s.c[0] - cl.leaf[0], s.c[1] - cl.leaf[1], s.c[2] - cl.leaf[2]];
      const l = Math.hypot(d[0], d[1], d[2]) || 1;
      return [d[0] / l, d[1] / l, d[2] / l];
    };
    for (const k of [0, 1]) {
      const d = dir(sacs[k]);
      t1.push(blob([sacs[k].c[0] + d[0] * sacs[k].r * 0.85, sacs[k].c[1] + d[1] * sacs[k].r * 0.85, sacs[k].c[2] + d[2] * sacs[k].r * 0.85], [0.0011, 0.0011, 0.00025], d, 5, 3));
    }
    for (const k of [2, 3]) {
      const d = dir(sacs[k]);
      t2.push(blob([sacs[k].c[0] + d[0] * sacs[k].r * 0.8, sacs[k].c[1] + d[1] * sacs[k].r * 0.8 + 0.0006, sacs[k].c[2] + d[2] * sacs[k].r * 0.8], 0.00048, undefined, 5, 3));
    }
    mac.push(blob([cl.leaf[0], cl.leaf[1], cl.leaf[2]], 0.0009, undefined, 5, 3));
    cap.push(ring(sacs[0].c, [0, 1, 0.3], sacs[0].r * 0.97, 0.00025));
    mem.push(blob(sacs[1].c, sacs[1].r * 0.8, undefined, 5, 3), blob(sacs[3].c, sacs[3].r * 0.8, undefined, 5, 3));
    const pa = sacs[0].c, pb = sacs[1].c;
    pore.push(ring([(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2], [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], 0.0005, 0.00015, 8, 3));
  }
  out.push({ id: 'respiratory_bronchioles', geometry: mergeParts(respB) });
  out.push({ id: 'alveolar_ducts', geometry: mergeParts(ducts) });
  out.push({ id: 'alveolar_sacs', geometry: mergeParts(sacsG) });
  out.push({ id: 'type_i_pneumocytes', geometry: mergeParts(t1) });
  out.push({ id: 'type_ii_pneumocytes', geometry: mergeParts(t2) });
  out.push({ id: 'alveolar_macrophages', geometry: mergeParts(mac) });
  out.push({ id: 'alveolar_capillaries', geometry: mergeParts(cap) });
  out.push({ id: 'respiratory_membrane', geometry: mergeParts(mem) });
  out.push({ id: 'alveolar_pores', geometry: mergeParts(pore) });

  /* --- bronchopulmonary segments: the lobe divided by nearest seed --- */
  const table = SEG_NAMES[side];
  const entries = Object.entries(table);
  for (const [id, e] of entries) {
    const box = lobeBox(side, e.lobe);
    const mates = entries.filter(([, o]) => o.lobe === e.lobe).map(([, o]) => o.seed);
    const lobe = lobeField(side, e.lobe, 0.002, 0.004);
    const norm = (x: number, y: number, z: number): V3 => [
      (z - box.min[2]) / (box.max[2] - box.min[2]),
      (y - box.min[1]) / (box.max[1] - box.min[1]),
      med > 0 ? (x - box.min[0]) / (box.max[0] - box.min[0]) : (box.max[0] - x) / (box.max[0] - box.min[0]),
    ];
    const f: Sdf = (x, y, z) => {
      const q = norm(x, y, z);
      let mine = 0, other = Infinity;
      for (const s of mates) {
        const d = Math.hypot(q[0] - s[0], q[1] - s[1], q[2] - s[2]);
        if (s === e.seed) mine = d; else other = Math.min(other, d);
      }
      // 0.04 m: the scale that turns the unit-box distance gap into a field a grid can follow; the 0.8 mm gap keeps neighbours apart.
      return Math.max(lobe(x, y, z), (mine - other) * 0.04 + 0.0008);
    };
    out.push({ id, geometry: polygonise(f, LUNG_BOX_MIN, LUNG_BOX_MAX, { cell: 0.0095 }) });
  }
  return out;
}

/* ----------------------------------------------------------- the animation */

const pickInflation = (s: SimSnapshot): number => s.resp.inflation;

/** A colour from three 0..1 channels, as the integer three.js takes. No allocation. */
function rgb(r: number, g: number, b: number): number {
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

const bloodScratch = new THREE.Color();

/**
 * Blood colour from saturation, as the integer a stream takes. The ramp itself is the one
 * every interior shares (../detail/blood.ts), so the pulmonary artery here is the colour of
 * the right ventricle that fills it and the pulmonary veins the colour of the left atrium
 * they drain into.
 */
export function bloodColor(sat: number): number {
  return bloodColour(bloodScratch, sat).getHex();
}

/**
 * WHAT IS GLASS IN A LUNG, AND WHY. A lobe is a mass of tissue with the airway tree, the
 * vessels and the alveoli INSIDE it, and the pleura wraps the lobes; drawn solid, a lung
 * was three opaque lumps and nothing else. So the pleura and the lobes are panes (see
 * `setOpacity` in ../detail/types.ts), and the bronchi and vessels, which carry the air
 * and blood streams inside them, are panes too, a little denser so the tree still reads as
 * a tree. Only the alveoli stay solid: they are where the exchange happens and the thing a
 * finger should land on. A lobe's pane fills in slightly as the lung inflates. These are
 * drawing choices.
 */
const PLEURA_GLASS = 0.07;
const LOBE_GLASS = 0.14;
const LOBE_GLASS_INFLATED = 0.08;
const AIRWAY_GLASS = 0.5;
const VESSEL_GLASS = 0.55;
/** Opacity of each finer structure that must be a pane (drawing choices). Segments carry the lobe's own faint glass. */
const CHILD_GLASS: [string, number][] = [
  ['apex', 0.3], ['costal_surface', 0.22], ['mediastinal_surface', 0.3], ['diaphragmatic_surface', 0.3], ['cardiac_notch', 0.35],
  ['oblique_fissure', 0.45], ['horizontal_fissure', 0.45], ['lingula', 0.2], ['pulmonary_ligament', 0.5],
  ['visceral_pleura', 0.1], ['pleural_cavity', 0.08], ['parietal_pleura', 0.1], ['costodiaphragmatic_recess', 0.3],
  ['main_bronchus', 0.6], ['lobar_bronchi', 0.6], ['segmental_bronchi', 0.6], ['bronchioles', 0.6], ['terminal_bronchioles', 0.6],
  ['alveoli', 0.5], ['alveolar_sacs', 0.4], ['respiratory_membrane', 0.35],
  ...['seg_apicoposterior', 'seg_anterior', 'seg_superior_lingular', 'seg_inferior_lingular', 'seg_superior', 'seg_anteromedial_basal',
    'seg_lateral_basal', 'seg_posterior_basal', 'seg_apical', 'seg_posterior', 'seg_lateral', 'seg_medial', 'seg_medial_basal',
    'seg_anterior_basal'].map((id): [string, number] => [id, 0.2]),
];
const BRONCHIAL_CHILDREN = ['main_bronchus', 'lobar_bronchi', 'segmental_bronchi', 'bronchioles', 'terminal_bronchioles'];
const LOBES = ['upper_lobe', 'middle_lobe', 'lower_lobe'] as const;

/** The air column's direction and speed, from the sign and size of the change in inflation. */
export interface BreathTracker {
  /** Call once per frame; returns the stream rate: positive hilum-to-periphery, 0 in apnoea. */
  update(ctx: DetailContext): number;
}

/**
 * WHY THE DIRECTION IS READ FROM THE CHANGE IN INFLATION. `resp.cyclePhase` says where in the
 * breath the body is, but the inspiratory fraction is the engine's business; the inflation
 * itself says unambiguously whether the lung is filling or emptying, and how fast. The sign
 * is held (with a small dead band) so the stream does not flicker at the top and bottom of
 * a breath, where the change passes through zero, and the rate is proportional to the speed
 * of that change, so a gasp streams faster than a sigh.
 */
export function breathTracker(): BreathTracker {
  let last = Number.NaN;
  let smooth = 0;
  let dir = 1;
  return {
    update(ctx) {
      const infl = ctx.lerp(pickInflation);
      if (Number.isNaN(last) || ctx.time < ctx.dt * 1.5) { last = infl; smooth = 0; }
      const d = ctx.dt > 0 ? (infl - last) / ctx.dt : 0;
      last = infl;
      smooth += (d - smooth) * Math.min(1, ctx.dt * 8);
      if (Math.abs(smooth) > 0.02) dir = smooth > 0 ? 1 : -1;
      if (ctx.snapshot.resp.apnoeic || ctx.reducedMotion) return 0;
      return dir * Math.min(3, Math.abs(smooth) * 1.6);
    },
  };
}

/** Cardiac stand-still: no organised output, so no blood moves. */
export function circulationStopped(s: SimSnapshot): boolean {
  const r = s.cardio.rhythm;
  return r === 'vfib' || r === 'asystole' || r === 'pea';
}

/** The flows and per-frame behaviour of one lung. */
export function makeLungDetail(side: -1 | 1): OrganDetailSpec {
  const air: string[] = [];
  const art: string[] = [];
  const vein: string[] = [];
  const tracker = breathTracker();
  return {
    flows: () => {
      air.length = 0; art.length = 0; vein.length = 0;
      const out: FlowSpec[] = [];
      for (const t of lungTrees(side)) {
        t.airPaths.forEach((path, k) => {
          const id = `air_${t.lobe}_${k}`;
          air.push(id);
          out.push({ id, path, count: 26, size: 0.0014, color: 0xbfe3f0, speed: 0.06, spread: 0.0006 });
        });
        t.arteryPaths.forEach((path, k) => {
          const id = `artery_${t.lobe}_${k}`;
          art.push(id);
          out.push({ id, path, count: 24, size: 0.0016, color: DEOXYGENATED, speed: 0.05, spread: 0.0005 });
        });
        // The vein paths run hilum-to-periphery like the rest; the stream is run backwards.
        t.veinPaths.forEach((path, k) => {
          const id = `vein_${t.lobe}_${k}`;
          vein.push(id);
          out.push({ id, path, count: 24, size: 0.0016, color: OXYGENATED, speed: 0.05, spread: 0.0005 });
        });
      }
      return out;
    },
    animate: (ctx) => {
      const s = ctx.snapshot;
      const bc = Math.max(0, Math.min(1, s.fluids.bronchoconstriction));
      const airRate = tracker.update(ctx) * (1 - 0.5 * bc);
      const stopped = circulationStopped(s) || ctx.reducedMotion;
      const blood = stopped ? 0 : Math.max(0, Math.min(3, s.cardio.cardiacOutput_L_per_min / 5));
      const artColor = bloodColor(s.transport.venousSat);
      const veinColor = bloodColor(s.transport.arterialSat);
      for (const id of air) {
        const f = ctx.flow(id);
        if (!f) continue;
        f.setRate(airRate);
        f.setDensity(1 - 0.7 * bc);
      }
      for (const id of art) {
        const f = ctx.flow(id);
        if (!f) continue;
        f.setRate(blood);
        f.setColor(artColor);
      }
      for (const id of vein) {
        const f = ctx.flow(id);
        if (!f) continue;
        f.setRate(-blood);
        f.setColor(veinColor);
      }
      const inflation = Math.max(0, Math.min(1, ctx.lerp(pickInflation)));
      const alv = ctx.part('alveoli');
      if (alv) alv.setGlow(Math.min(1, ctx.activity('alveoli') + 0.35 * inflation));
      const tree = ctx.part('bronchial_tree');
      if (tree) {
        tree.setOpacity(AIRWAY_GLASS);
        if (bc > 0) {
          const c = tree.baseColor;
          const k = 0.8 * bc;
          tree.setColor(rgb(c.r + (0.85 - c.r) * k, c.g + (0.5 - c.g) * k, c.b + (0.23 - c.b) * k));
        }
      }
      // The vessels take the colour of the blood in them, as their streams do.
      const arteries = ctx.part('pulmonary_arteries');
      if (arteries) {
        arteries.setOpacity(VESSEL_GLASS);
        arteries.setColor(artColor);
      }
      const veins = ctx.part('pulmonary_veins');
      if (veins) {
        veins.setOpacity(VESSEL_GLASS);
        veins.setColor(veinColor);
      }
      for (const id of LOBES) ctx.part(id)?.setOpacity(LOBE_GLASS + LOBE_GLASS_INFLATED * inflation);
      ctx.part('pleura')?.setOpacity(PLEURA_GLASS);
      // Finer structures. Each sits inside something glass, so each is a pane too, a little
      // denser than what holds it so it reads. Opacities are drawing choices, not data.
      for (const [id, o] of CHILD_GLASS) ctx.part(id)?.setOpacity(o);
      for (const id of BRONCHIAL_CHILDREN) {
        const part = ctx.part(id);
        if (part && bc > 0) {
          const c = part.baseColor;
          const k = 0.8 * bc;
          part.setColor(rgb(c.r + (0.85 - c.r) * k, c.g + (0.5 - c.g) * k, c.b + (0.23 - c.b) * k));
        }
      }
    },
  };
}
