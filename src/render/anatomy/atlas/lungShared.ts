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
    out.push({ a: nodes[n.parent].p, b: n.p, ra: radii[n.level - 1] * scale, rb: radii[n.level] * scale });
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

/** A cluster of alveolar sacs: four bumpy spheres fused, each far larger than a real alveolus so it can be seen. */
function alveolarCluster(centre: V3, seed: number): THREE.BufferGeometry {
  const rnd = mulberry32(seed);
  const sacs: Sdf[] = [];
  for (let k = 0; k < 4; k++) {
    const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    const o = 0.0028;
    sacs.push(sphere([centre[0] + o * s * Math.cos(th), centre[1] + o * u, centre[2] + o * s * Math.sin(th)], 0.0024 + rnd() * 0.0006));
  }
  const f = smoothUnion(0.001, ...sacs);
  const bumpy: Sdf = (x, y, z) => f(x, y, z) + 0.0004 * fbm(x, y, z, 700, 2);
  const r = 0.0085;
  return polygonise(bumpy, [centre[0] - r, centre[1] - r, centre[2] - r], [centre[0] + r, centre[1] + r, centre[2] + r], { cell: 0.0015, pad: 1 });
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
  const sacs: THREE.BufferGeometry[] = [];
  let n = 0;
  for (const t of trees) for (const leaf of t.leaves) sacs.push(alveolarCluster(leaf, 977 * (n++ + 1) + (side < 0 ? 1 : 2)));
  out.push({ id: 'alveoli', geometry: mergeParts(sacs) });
  // The pleura: the lung's outer skin, drawn a little inside the shell and a little outside the lobes.
  out.push({
    id: 'pleura',
    geometry: polygonise(offset(lungBaseField(side), -0.0006), LUNG_BOX_MIN, LUNG_BOX_MAX, { cell: 0.0065 }),
  });
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
    },
  };
}
