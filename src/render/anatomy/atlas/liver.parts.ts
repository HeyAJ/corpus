import * as THREE from 'three';
import type { PartBuilder } from '../parts';
import {
  capsule,
  ellipsoid,
  halfSpace,
  intersect,
  mergeParts,
  offset,
  polygonise,
  smoothSubtract,
  smoothUnion,
  sphere,
  subtract,
  tubeAlong,
} from '../sdf';
import type { Sdf, V3 } from '../sdf';
import { mulberry32 } from '../noise';

/**
 * INTERIOR PARTS OF THE LIVER.
 *
 * The frame is the liver shell's own (models.ts `liver()`): origin at the organ's position,
 * +x the patient's right (the big right lobe), +y cranial, +z anterior, metres.
 *
 * WHAT IS BUILT. The falciform ligament; four lobes as glass-ready closed surfaces a few millimetres inside the
 * shell (right, left, caudate, quadrate); the portal triad entering at the porta hepatis on
 * the visceral surface (portal vein, hepatic artery, bile duct) and dividing into right and
 * left branches that keep dividing; the three hepatic veins converging up and back to the
 * groove of the inferior vena cava; and ONE hepatic lobule drawn enlarged on the front of
 * the right lobe, large enough to follow: a hexagon with a portal triad at each corner,
 * sinusoids converging on the central vein.
 *
 * WHAT IS DELIBERATELY NOT BUILT. Real vascular trees have tens of generations. These have
 * three or four, grown by a seeded recursive rule that keeps every branch inside the shell;
 * they are illustrative of the branching pattern and make no claim about where any
 * individual branch runs. The shell's fine texture noise is not reproduced, so the shell
 * replica below differs from the shell by about a millimetre; every part is kept several
 * millimetres inside it so that does not matter.
 *
 * WHY THE TREES ARE GROWN AND NOT TRACED. There is no traced atlas in this repository and
 * the brief forbids inventing a number; a branching rule needs only angles and lengths
 * that are display choices, stated as such. Each tree is deterministic (mulberry32 with a
 * fixed seed) so the geometry is byte-identical on every load.
 */

/* ------------------------------------------------------------- shell replica */

/**
 * The shell's own field, without its noise. Kept in step with `liver()` in models.ts by
 * hand: if the shell is reshaped this must follow, and the probe in
 * .cache/probes/abdo_parts.ts reports any part that has ended up outside the real mesh.
 */
export function liverShellField(): Sdf {
  let f = smoothUnion(
    0.03,
    ellipsoid([0.03, 0.0, -0.005], [0.062, 0.062, 0.058]),
    ellipsoid([-0.055, 0.016, 0.012], [0.05, 0.03, 0.03]),
  );
  f = smoothSubtract(0.02, f, halfSpace([0.0, -0.022, 0], [-0.5, -1, -0.35]));
  f = smoothSubtract(0.006, f, sphere([0.02, -0.046, 0.026], 0.014));
  f = smoothSubtract(0.004, f, capsule([-0.02, 0.052, 0.046], [-0.022, -0.03, 0.04], 0.004));
  f = smoothSubtract(0.006, f, capsule([-0.012, 0.062, -0.046], [-0.012, -0.03, -0.05], 0.012));
  return f;
}

/** Depth of the lobes' surfaces below the shell's, metres: a display choice. */
const LOBE_INSET = 0.0035;

/* ------------------------------------------------------------ vector helpers */

type Vec = [number, number, number];
const add = (a: V3, b: V3, k = 1): Vec => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const scaleV = (a: V3, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V3, b: V3): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): Vec => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/* ------------------------------------------------------------- branching rule */

interface Node {
  pts: V3[];
  r0: number;
  r1: number;
  kids: Node[];
}

/** How far inside the shell a branch's centreline must stay, beyond its own radius. */
const VESSEL_MARGIN = 0.0025;

/**
 * Grow one branch from `start` along `dir` and, while `depth` allows, two children that
 * leave it at about `angle` radians either side of a randomly chosen plane. A branch that
 * would leave the shell is shortened up to four times and then dropped, so the tree fills
 * the lobe it is in and stops at its surface. Radii fall by a fixed factor per generation;
 * that factor is a drawing choice, not a measured branching ratio.
 */
function grow(
  inside: Sdf,
  start: V3,
  dir: V3,
  len: number,
  r0: number,
  depth: number,
  rng: () => number,
  angle: number,
): Node | null {
  const d = norm(dir);
  let s = cross(d, [rng() - 0.5, rng() - 0.5, rng() - 0.5]);
  if (Math.hypot(s[0], s[1], s[2]) < 1e-6) s = [0, 1, 0];
  s = norm(s);
  let l = len;
  let end: V3 = start;
  let mid: V3 = start;
  let ok = false;
  const need = -(r0 + VESSEL_MARGIN);
  for (let k = 0; k < 5; k++) {
    const bend = (rng() - 0.5) * 0.25 * l;
    end = add(start, d, l);
    mid = add(add(start, d, l * 0.5), s, bend);
    if (inside(end[0], end[1], end[2]) <= need && inside(mid[0], mid[1], mid[2]) <= need) {
      ok = true;
      break;
    }
    l *= 0.75;
  }
  if (!ok) return null;
  const r1 = r0 * 0.8;
  const node: Node = { pts: [start, mid, end], r0, r1, kids: [] };
  if (depth > 0) {
    for (const sign of [1, -1]) {
      const a = angle * (0.8 + 0.4 * rng());
      const cd = norm(add(scaleV(d, Math.cos(a)), s, sign * Math.sin(a)));
      const kid = grow(inside, end, cd, l * 0.8, r1 * 0.9, depth - 1, rng, angle);
      if (kid) node.kids.push(kid);
    }
  }
  return node;
}

function collect(node: Node, out: Node[]): Node[] {
  out.push(node);
  for (const k of node.kids) collect(k, out);
  return out;
}

function treeGeometry(root: Node): THREE.BufferGeometry {
  const tubes = collect(root, []).map((n) =>
    tubeAlong(n.pts, (t) => n.r0 + (n.r1 - n.r0) * t, { tubular: 6, radial: 6 }),
  );
  return mergeParts(tubes);
}

/** Every root-to-leaf route through a tree, as one polyline each. */
function leafPaths(node: Node, prefix: V3[] = []): V3[][] {
  const here = prefix.length === 0 ? node.pts : node.pts.slice(1);
  const path = [...prefix, ...here];
  if (node.kids.length === 0) return [path];
  const out: V3[][] = [];
  for (const k of node.kids) out.push(...leafPaths(k, path));
  return out;
}

function trunk(pts: V3[], r0: number, r1: number, kids: (Node | null)[]): Node {
  return { pts, r0, r1, kids: kids.filter((k): k is Node => k !== null) };
}

/* ------------------------------------------------------------------- the trees */

interface LiverTrees {
  portal: Node;
  artery: Node;
  bile: Node;
  veins: Node[];
}

/** Where the portal triad enters, on the visceral surface at the porta hepatis. */
const PORTAL_ENTRY: V3 = [0.0, -0.0255, -0.004];
const PORTAL_SPLIT: V3 = [0.004, -0.021, -0.006];
const ARTERY_ENTRY: V3 = [-0.004, -0.0255, 0.003];
const ARTERY_SPLIT: V3 = [-0.001, -0.022, 0.002];
const BILE_ENTRY: V3 = [0.008, -0.0255, 0.004];
const BILE_SPLIT: V3 = [0.006, -0.021, 0.004];
/** The three hepatic veins reach the vena cava groove near here, up and back. */
const VENA_CAVA_END: V3 = [-0.006, 0.026, -0.024];

let cache: LiverTrees | null = null;

function trees(): LiverTrees {
  if (cache) return cache;
  const shell = liverShellField();
  const rng = mulberry32(0x11ae3);
  const portal = trunk([PORTAL_ENTRY, PORTAL_SPLIT], 0.0036, 0.0033, [
    grow(shell, PORTAL_SPLIT, [1, 0.25, -0.15], 0.026, 0.0031, 3, rng, 0.55),
    grow(shell, PORTAL_SPLIT, [-1, 0.3, 0.4], 0.022, 0.0025, 3, rng, 0.55),
  ]);
  const artery = trunk([ARTERY_ENTRY, ARTERY_SPLIT], 0.0016, 0.0015, [
    grow(shell, ARTERY_SPLIT, [1, 0.2, 0.2], 0.024, 0.0014, 3, rng, 0.6),
    grow(shell, ARTERY_SPLIT, [-1, 0.3, 0.55], 0.02, 0.0012, 3, rng, 0.6),
  ]);
  const bile = trunk([BILE_ENTRY, BILE_SPLIT], 0.0019, 0.0017, [
    grow(shell, BILE_SPLIT, [1, 0.15, 0.3], 0.022, 0.0015, 3, rng, 0.6),
    grow(shell, BILE_SPLIT, [-1, 0.3, 0.6], 0.018, 0.0013, 3, rng, 0.6),
  ]);
  // The veins are grown OUTWARD from the cava end, then drawn as draining inward.
  const veins: Node[] = [];
  const specs: [V3, V3, number][] = [
    [VENA_CAVA_END, [1, -0.55, 0.1], 0.03], // right hepatic vein
    [VENA_CAVA_END, [0.2, -0.8, 0.6], 0.028], // middle
    [VENA_CAVA_END, [-1, -0.5, 0.45], 0.026], // left
  ];
  for (const [root, dir, len] of specs) {
    const v = grow(shell, root, dir, len, 0.0034, 3, rng, 0.6);
    if (!v) throw new Error('liver: a hepatic vein could not be grown inside the shell');
    veins.push(v);
  }
  cache = { portal, artery, bile, veins };
  return cache;
}

/** Root-to-leaf routes for the detail file's flows. Veins run leaf to root (draining). */
export function liverPaths(): { portal: V3[][]; artery: V3[][]; bile: V3[][]; veins: V3[][] } {
  const t = trees();
  return {
    portal: leafPaths(t.portal),
    artery: leafPaths(t.artery),
    bile: leafPaths(t.bile).map((p) => [...p].reverse()),
    veins: t.veins.flatMap((v) => leafPaths(v)).map((p) => [...p].reverse()),
  };
}

/* ------------------------------------------------------------------ the lobule */

export interface LobuleFrame {
  p: Vec;
  u: Vec;
  v: Vec;
  n: Vec;
  /** Circumradius of the hexagon, metres. Enlarged enormously for the sake of being followed. */
  R: number;
  /** Slab depth along -n. */
  depth: number;
}

let lobuleCache: LobuleFrame | null = null;

/** Where the enlarged lobule sits: flat on the front of the right lobe, just inside it. */
export function lobuleFrame(): LobuleFrame {
  if (lobuleCache) return lobuleCache;
  const inner = offset(liverShellField(), -0.003);
  const cx = 0.042;
  const cy = 0.012;
  let z = 0.07;
  while (z > -0.05 && inner(cx, cy, z) > 0) z -= 0.0005;
  const e = 0.0008;
  const nn = norm([
    inner(cx + e, cy, z) - inner(cx - e, cy, z),
    inner(cx, cy + e, z) - inner(cx, cy - e, z),
    inner(cx, cy, z + e) - inner(cx, cy, z - e),
  ]);
  const ref: V3 = Math.abs(nn[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(add(ref, nn, -(ref[0] * nn[0] + ref[1] * nn[1] + ref[2] * nn[2])));
  const v = cross(nn, u);
  lobuleCache = { p: [cx, cy, z], u, v, n: nn, R: 0.0125, depth: 0.007 };
  return lobuleCache;
}

/** A point in the lobule's own frame: a, b in the tangent plane, c inward from the front face. */
export function lobulePoint(a: number, b: number, c: number): Vec {
  const f = lobuleFrame();
  return [
    f.p[0] + f.u[0] * a + f.v[0] * b - f.n[0] * c,
    f.p[1] + f.u[1] * a + f.v[1] * b - f.n[1] * c,
    f.p[2] + f.u[2] * a + f.v[2] * b - f.n[2] * c,
  ];
}

/** Corner k of the hexagon at fraction `f` of the circumradius, at depth c. */
export function lobuleCorner(k: number, f: number, c: number): Vec {
  const th = (Math.PI / 3) * k + Math.PI / 6;
  return lobulePoint(Math.cos(th) * lobuleFrame().R * f, Math.sin(th) * lobuleFrame().R * f, c);
}

function quad(pos: number[], idx: number[], a: V3, b: V3, c: V3, d: V3): void {
  const base = pos.length / 3;
  pos.push(...a, ...b, ...c, ...d);
  idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function lobuleGeometry(): THREE.BufferGeometry {
  const f = lobuleFrame();
  const pos: number[] = [];
  const idx: number[] = [];
  const w = 0.0012;
  const h = f.depth;
  for (let k = 0; k < 6; k++) {
    const k2 = (k + 1) % 6;
    const ot = lobuleCorner(k, 1, 0);
    const ot2 = lobuleCorner(k2, 1, 0);
    const it = lobuleCorner(k, 1 - w / f.R, 0);
    const it2 = lobuleCorner(k2, 1 - w / f.R, 0);
    const ob = lobuleCorner(k, 1, h);
    const ob2 = lobuleCorner(k2, 1, h);
    const ib = lobuleCorner(k, 1 - w / f.R, h);
    const ib2 = lobuleCorner(k2, 1 - w / f.R, h);
    quad(pos, idx, ot, ot2, it2, it);
    quad(pos, idx, ot, ot2, ob2, ob);
    quad(pos, idx, it, it2, ib2, ib);
  }
  const frame = new THREE.BufferGeometry();
  frame.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  frame.setIndex(idx);
  frame.computeVertexNormals();

  const pieces: THREE.BufferGeometry[] = [frame];
  const mid = h * 0.5;
  // Central vein, running along the lobule's axis.
  pieces.push(tubeAlong([lobulePoint(0, 0, 0.0004), lobulePoint(0, 0, h)], () => 0.0022, { tubular: 2, radial: 8 }));
  for (let k = 0; k < 6; k++) {
    // Portal triad at the corner: portal venule, hepatic arteriole, bile ductule.
    const c = lobuleCorner(k, 0.9, mid);
    const sideways = lobuleCorner(k, 0.78, mid);
    const toward = lobuleCorner((k + 1) % 6, 0.9, mid);
    const venule = new THREE.SphereGeometry(0.0011, 6, 4).translate(c[0], c[1], c[2]);
    const arteriole = new THREE.SphereGeometry(0.0006, 6, 4).translate(sideways[0], sideways[1], sideways[2]);
    const dx = (toward[0] - c[0]) * 0.18;
    const dy = (toward[1] - c[1]) * 0.18;
    const dz = (toward[2] - c[2]) * 0.18;
    const ductule = new THREE.SphereGeometry(0.0007, 6, 4).translate(c[0] + dx, c[1] + dy, c[2] + dz);
    pieces.push(venule, arteriole, ductule);
    // The sinusoid: corner to central vein, bowed a little so six do not read as spokes.
    const a = lobuleCorner(k, 0.82, mid);
    const th = (Math.PI / 3) * k + Math.PI / 6;
    const bowed = lobulePoint(
      Math.cos(th + 0.18) * f.R * 0.45,
      Math.sin(th + 0.18) * f.R * 0.45,
      mid,
    );
    const b = lobulePoint(Math.cos(th) * 0.0026, Math.sin(th) * 0.0026, mid);
    pieces.push(tubeAlong([a, bowed, b], () => 0.0005, { tubular: 6, radial: 4 }));
  }
  return mergeParts(pieces);
}

/* -------------------------------------------------- finer structures (T2) */

/**
 * THE SURFACE LANDMARKS, THE EIGHT SEGMENTS AND THE FINE STRUCTURE OF THE LOBULE.
 *
 * Added after the first atlas, as pure additions: no existing part moved and no id changed.
 *
 *   - LANDMARKS ON THE SURFACE (bare area, coronary and triangular ligaments, the groove for
 *     the vena cava, the porta hepatis) are thin SKINS of the shell: the shell's own field
 *     taken between two small depths and limited to a region by a sphere or capsule. A skin
 *     patch therefore always lies on the surface it names, whatever the shell does. Depths
 *     (1.2 to 3.2 mm) sit between the lobes' surfaces (3.5 mm in) and the shell, so a patch
 *     neither touches a lobe nor leaves the liver. The positions of the regions are drawing
 *     choices placed from the anatomy texts' descriptions (GRAYS42), not measured.
 *   - THE FIBROUS (GLISSON) CAPSULE is one closed glass surface just under the shell.
 *   - THE ROUND AND VENOUS LIGAMENTS are capsules clipped to the inside of the shell.
 *   - COUINAUD SEGMENTS are named regions of the two lobes, cut by planes. The planes are
 *     simplified: the real boundaries are oblique and follow the hepatic and portal veins.
 *     Segment I is the caudate lobe, which already exists; segment IV's lower part is the
 *     quadrate lobe, which already exists; so IV here is the medial part of the left lobe.
 *     Every plane is a drawing choice.
 *   - THE LOBULE'S FINE STRUCTURE lives in the enlarged lobule's own frame (`lobuleFrame`):
 *     central vein, the portal triad and its three members, plates of hepatocytes between
 *     the sinusoids, the sinusoids with Kupffer cells on their walls, the perisinusoidal
 *     space (of Disse) around each sinusoid with a stellate (Ito) cell in it, the bile
 *     canaliculi, and three concentric zones. EVERYTHING there is a magnified schematic: a
 *     real lobule is about a thousand times smaller than this drawing, the cells are drawn
 *     as beads and slabs, and the counts (six sinusoids, a dozen Kupffer cells) are layout
 *     choices. The zones are drawn as concentric rings, which is the textbook simplification
 *     of the acinus (zone 1 nearest the portal triads, zone 3 nearest the central vein), not
 *     its true diamond shape.
 *
 * DEPTH. The textbook chain lobule -> portal triad -> venule is level 3, and lobule ->
 * sinusoid -> Kupffer cell is level 3 as well; the acinar zones are drawn as three siblings
 * of the lobule's other level-2 children instead of a nested chain, to stay inside the cap.
 */

/** Skin of the shell between depths d0 and d1 (metres below the surface), limited to `region`. */
function skin(region: Sdf, d0: number, d1: number): Sdf {
  const shell = liverShellField();
  return intersect(region, subtract(offset(shell, -d0), offset(shell, -d1)));
}

const LIVER_LO: V3 = [-0.115, -0.07, -0.07];
const LIVER_HI: V3 = [0.1, 0.068, 0.064];

/** The lobule's frame as a matrix: x along u, y INWARD from the front face, z along v. */
function lobuleMatrix(origin: V3, x?: V3, z?: V3): THREE.Matrix4 {
  const f = lobuleFrame();
  const inward = new THREE.Vector3(-f.n[0], -f.n[1], -f.n[2]);
  const ex = new THREE.Vector3(...(x ?? f.u));
  const ez = new THREE.Vector3(...(z ?? f.v));
  const m = new THREE.Matrix4().makeBasis(ex, inward, ez);
  m.setPosition(origin[0], origin[1], origin[2]);
  return m;
}

/** Flip the winding of a closed mesh whose signed volume is negative, so its normals point out. */
function outward(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const idx = g.getIndex();
  if (!idx) return g;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let vol = 0;
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(pos, idx.getX(i));
    b.fromBufferAttribute(pos, idx.getX(i + 1));
    c.fromBufferAttribute(pos, idx.getX(i + 2));
    vol += a.dot(b.cross(c));
  }
  if (vol < 0) {
    for (let i = 0; i < idx.count; i += 3) {
      const t = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, t);
    }
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

/** A flat ring in the lobule's plane between two radii, `thick` deep, starting `c0` in from the front face. */
function lobuleRing(r0: number, r1: number, c0: number, thick: number): THREE.BufferGeometry {
  const profile = [
    new THREE.Vector2(r0, 0),
    new THREE.Vector2(r1, 0),
    new THREE.Vector2(r1, thick),
    new THREE.Vector2(r0, thick),
    new THREE.Vector2(r0, 0),
  ];
  const g = new THREE.LatheGeometry(profile, 36);
  g.applyMatrix4(lobuleMatrix(lobulePoint(0, 0, c0)));
  return outward(g);
}

/** The path a sinusoid follows in the lobule, corner to central vein (the detail file draws the same). */
function sinusoidPath(k: number): V3[] {
  const mid = lobuleFrame().depth * 0.5;
  const th = (Math.PI / 3) * k + Math.PI / 6;
  const R = lobuleFrame().R;
  return [
    lobuleCorner(k, 0.82, mid),
    lobulePoint(Math.cos(th + 0.18) * R * 0.45, Math.sin(th + 0.18) * R * 0.45, mid),
    lobulePoint(Math.cos(th) * 0.0026, Math.sin(th) * 0.0026, mid),
  ];
}

/** The path a bile canaliculus follows, from the middle out to the corner's ductule. */
function canaliculusPath(k: number): V3[] {
  const mid = lobuleFrame().depth * 0.5 + 0.0012;
  const th = (Math.PI / 3) * k + Math.PI / 6;
  const R = lobuleFrame().R;
  const c = lobuleCorner(k, 0.9, mid);
  const t = lobuleCorner((k + 1) % 6, 0.9, mid);
  return [
    lobulePoint(Math.cos(th) * 0.004, Math.sin(th) * 0.004, mid),
    lobulePoint(Math.cos(th - 0.18) * R * 0.5, Math.sin(th - 0.18) * R * 0.5, mid),
    [c[0] + (t[0] - c[0]) * 0.18, c[1] + (t[1] - c[1]) * 0.18, c[2] + (t[2] - c[2]) * 0.18],
  ];
}

function bead(p: V3, r: number): THREE.BufferGeometry {
  const s = new THREE.SphereGeometry(r, 6, 4);
  s.translate(p[0], p[1], p[2]);
  s.deleteAttribute('uv');
  return s;
}

function lobuleFine(): { id: string; geometry: THREE.BufferGeometry }[] {
  const f = lobuleFrame();
  const h = f.depth;
  const mid = h * 0.5;
  const out: { id: string; geometry: THREE.BufferGeometry }[] = [];
  const tube = (pts: V3[], r: number, radial = 6): THREE.BufferGeometry =>
    tubeAlong(pts, () => r, { tubular: Math.max(2, pts.length * 3), radial });

  // Central vein: the lobule's draining vessel, a little wider than the parent's own tube.
  out.push({ id: 'central_vein', geometry: tube([lobulePoint(0, 0, 0.0003), lobulePoint(0, 0, h - 0.0002)], 0.0024, 12) });

  // Portal triad: a connective-tissue sheath at every corner, with its three members in it.
  const sheath: THREE.BufferGeometry[] = [];
  const venule: THREE.BufferGeometry[] = [];
  const arteriole: THREE.BufferGeometry[] = [];
  const ductule: THREE.BufferGeometry[] = [];
  const top = 0.0006;
  const bottom = h - 0.0006;
  for (let k = 0; k < 6; k++) {
    const c = lobuleCorner(k, 0.9, 0);
    const side = lobuleCorner(k, 0.78, 0);
    const toward = lobuleCorner((k + 1) % 6, 0.9, 0);
    const alongEdge: V3 = [c[0] + (toward[0] - c[0]) * 0.18, c[1] + (toward[1] - c[1]) * 0.18, c[2] + (toward[2] - c[2]) * 0.18];
    // Inward (depth) direction is -n; shifting a point by `d` along it moves it deeper.
    const deep = (p: V3, d: number): V3 => [p[0] - f.n[0] * d, p[1] - f.n[1] * d, p[2] - f.n[2] * d];
    const centre: V3 = [(c[0] + side[0] + alongEdge[0]) / 3, (c[1] + side[1] + alongEdge[1]) / 3, (c[2] + side[2] + alongEdge[2]) / 3];
    sheath.push(tube([deep(centre, top), deep(centre, bottom)], 0.0026, 8));
    venule.push(tube([deep(c, top + 0.0004), deep(c, bottom - 0.0004)], 0.0011, 8));
    arteriole.push(tube([deep(side, top + 0.0004), deep(side, bottom - 0.0004)], 0.0006, 6));
    ductule.push(tube([deep(alongEdge, top + 0.0004), deep(alongEdge, bottom - 0.0004)], 0.0007, 6));
  }
  out.push({ id: 'portal_triad', geometry: mergeParts(sheath) });
  out.push({ id: 'portal_venule', geometry: mergeParts(venule) });
  out.push({ id: 'hepatic_arteriole', geometry: mergeParts(arteriole) });
  out.push({ id: 'bile_ductule', geometry: mergeParts(ductule) });

  // Hepatocyte plates: slabs midway between neighbouring sinusoids, running from near the central vein to near the edge.
  const plates: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 6; k++) {
    const th = (Math.PI / 3) * k + Math.PI / 3;
    const radial: V3 = [
      Math.cos(th) * f.u[0] + Math.sin(th) * f.v[0],
      Math.cos(th) * f.u[1] + Math.sin(th) * f.v[1],
      Math.cos(th) * f.u[2] + Math.sin(th) * f.v[2],
    ];
    const tangent: V3 = [
      -Math.sin(th) * f.u[0] + Math.cos(th) * f.v[0],
      -Math.sin(th) * f.u[1] + Math.cos(th) * f.v[1],
      -Math.sin(th) * f.u[2] + Math.cos(th) * f.v[2],
    ];
    const box = new THREE.BoxGeometry(0.0064, h * 0.7, 0.0007);
    box.applyMatrix4(lobuleMatrix(lobulePoint(Math.cos(th) * 0.007, Math.sin(th) * 0.007, mid), radial, tangent));
    box.deleteAttribute('uv');
    plates.push(box);
  }
  out.push({ id: 'hepatocyte_plates', geometry: mergeParts(plates) });

  // Sinusoids, Kupffer cells on their walls, the perisinusoidal space and a stellate cell in each.
  const sinus: THREE.BufferGeometry[] = [];
  const kupffer: THREE.BufferGeometry[] = [];
  const space: THREE.BufferGeometry[] = [];
  const stellate: THREE.BufferGeometry[] = [];
  const along = (pts: V3[], t: number): V3 => {
    // Piecewise-linear point at fraction t of a three-point path.
    const seg = t < 0.5 ? 0 : 1;
    const u = t < 0.5 ? t * 2 : (t - 0.5) * 2;
    const a = pts[seg];
    const b = pts[seg + 1];
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  };
  for (let k = 0; k < 6; k++) {
    const path = sinusoidPath(k);
    sinus.push(tube(path, 0.0007));
    space.push(tube(path, 0.0013));
    kupffer.push(bead(along(path, 0.35), 0.0008), bead(along(path, 0.7), 0.0008));
    const s = along(path, 0.55);
    // A stellate cell lies in the space, beside the sinusoid and not in it: shifted along the tangent.
    const th = (Math.PI / 3) * k + Math.PI / 6;
    const tang: V3 = [
      -Math.sin(th) * f.u[0] + Math.cos(th) * f.v[0],
      -Math.sin(th) * f.u[1] + Math.cos(th) * f.v[1],
      -Math.sin(th) * f.u[2] + Math.cos(th) * f.v[2],
    ];
    stellate.push(bead([s[0] + tang[0] * 0.0008, s[1] + tang[1] * 0.0008, s[2] + tang[2] * 0.0008], 0.0005));
  }
  out.push({ id: 'sinusoids', geometry: mergeParts(sinus) });
  out.push({ id: 'kupffer_cells', geometry: mergeParts(kupffer) });
  out.push({ id: 'perisinusoidal_space', geometry: mergeParts(space) });
  out.push({ id: 'stellate_cells', geometry: mergeParts(stellate) });

  // Bile canaliculi: thin tubes from the middle out to the ductule at the corner.
  const canal: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 6; k++) canal.push(tube(canaliculusPath(k), 0.0004, 5));
  out.push({ id: 'bile_canaliculi', geometry: mergeParts(canal) });

  // Zones 1 (periportal, outermost), 2 and 3 (around the central vein) as three flat rings.
  out.push({ id: 'acinar_zone_1', geometry: lobuleRing(0.0078, 0.0106, mid - 0.0006, 0.0012) });
  out.push({ id: 'acinar_zone_2', geometry: lobuleRing(0.0052, 0.0078, mid - 0.0006, 0.0012) });
  out.push({ id: 'acinar_zone_3', geometry: lobuleRing(0.0028, 0.0052, mid - 0.0006, 0.0012) });
  return out;
}

function finerParts(right: Sdf, left: Sdf): { id: string; geometry: THREE.BufferGeometry }[] {
  const shell = liverShellField();
  const out: { id: string; geometry: THREE.BufferGeometry }[] = [];

  // Surface landmarks.
  const patch = (id: string, region: Sdf, lo: V3, hi: V3, d0 = 0.0012, d1 = 0.0032): void => {
    out.push({ id, geometry: polygonise(skin(region, d0, d1), lo, hi, { cell: 0.0022 }) });
  };
  const bareCentre: V3 = [0.03, 0.026, -0.058];
  patch('bare_area', sphere(bareCentre, 0.024), [0.0, 0.0, -0.07], [0.06, 0.056, -0.03]);
  patch(
    'coronary_ligament',
    subtract(sphere(bareCentre, 0.034), sphere(bareCentre, 0.0235)),
    [-0.01, -0.01, -0.07],
    [0.07, 0.066, -0.02],
  );
  // Two thin sheets at the lateral tips, one on each lobe.
  patch('triangular_ligaments', smoothUnion(0.002, sphere([0.088, 0.018, -0.022], 0.012), sphere([-0.098, 0.016, 0.012], 0.011)), [-0.115, -0.01, -0.04], [0.1, 0.04, 0.03]);
  patch('porta_hepatis', sphere([0.003, -0.027, 0.0], 0.013), [-0.014, -0.045, -0.014], [0.02, -0.01, 0.014]);
  patch('ivc_groove', capsule([-0.012, 0.062, -0.046], [-0.012, -0.03, -0.05], 0.0145), [-0.032, -0.04, -0.07], [0.012, 0.07, -0.02]);

  // Ligaments inside the cleft and the fissure: capsules clipped to the shell.
  const clipped = (a: V3, b: V3, r: number): Sdf => intersect(capsule(a, b, r), offset(shell, -0.001));
  out.push({
    id: 'ligamentum_teres',
    geometry: polygonise(clipped([-0.0212, -0.008, 0.03], [-0.0212, 0.012, 0.0345], 0.0012), [-0.03, -0.02, 0.02], [-0.012, 0.025, 0.045], { cell: 0.0008 }),
  });
  out.push({
    id: 'ligamentum_venosum',
    geometry: polygonise(clipped([-0.012, -0.004, -0.016], [-0.0125, 0.028, -0.033], 0.0012), [-0.022, -0.012, -0.045], [0.0, 0.04, -0.005], { cell: 0.001 }),
  });

  // The capsule round the whole organ: one closed surface.
  out.push({ id: 'fibrous_capsule', geometry: polygonise(offset(shell, -0.0014), LIVER_LO, LIVER_HI, { cell: 0.007 }) });

  // Couinaud segments, cut from the lobes' own fields a little inside them.
  const cut = 0.0004;
  const seg = (id: string, lobe: Sdf, ...planes: Sdf[]): void => {
    let f: Sdf = offset(lobe, -0.0012);
    for (const p of planes) f = intersect(f, p);
    out.push({ id, geometry: polygonise(f, LIVER_LO, LIVER_HI, { cell: 0.007 }) });
  };
  const yAbove = (y: number): Sdf => halfSpace([0, y + cut, 0], [0, 1, 0]);
  const yBelow = (y: number): Sdf => halfSpace([0, y - cut, 0], [0, -1, 0]);
  const zFront = (z: number): Sdf => halfSpace([0, 0, z + cut], [0, 0, 1]);
  const zBack = (z: number): Sdf => halfSpace([0, 0, z - cut], [0, 0, -1]);
  const xLeftOf = (x: number): Sdf => halfSpace([x - cut, 0, 0], [-1, 0, 0]);
  const xRightOf = (x: number): Sdf => halfSpace([x + cut, 0, 0], [1, 0, 0]);
  seg('segment_v', right, yBelow(0.003), zFront(-0.006));
  seg('segment_vi', right, yBelow(0.003), zBack(-0.006));
  seg('segment_vii', right, yAbove(0.003), zBack(-0.006));
  seg('segment_viii', right, yAbove(0.003), zFront(-0.006));
  seg('segment_ii', left, xLeftOf(-0.052), yAbove(0.016));
  seg('segment_iii', left, xLeftOf(-0.052), yBelow(0.016));
  seg('segment_iv', left, xRightOf(-0.052));

  out.push(...lobuleFine());
  return out;
}

/* ---------------------------------------------------------------------- parts */

export const parts: PartBuilder = () => {
  const shell = liverShellField();
  const inner = offset(shell, -LOBE_INSET);
  const caudate = ellipsoid([0.008, 0.006, -0.032], [0.012, 0.02, 0.01]);
  const quadrate = ellipsoid([0.0, -0.02, 0.024], [0.012, 0.012, 0.016]);
  const rightSide = halfSpace([-0.0205, 0, 0], [1, 0, 0]);
  const leftSide = halfSpace([-0.0215, 0, 0], [-1, 0, 0]);
  const gap = 0.0007;

  const right = subtract(
    subtract(intersect(inner, rightSide), offset(caudate, gap)),
    offset(quadrate, gap),
  );
  const left = intersect(inner, leftSide);
  const cell = 0.0045;

  const t = trees();
  const base = [
    { id: 'right_lobe', geometry: polygonise(right, [-0.03, -0.068, -0.066], [0.096, 0.066, 0.06], { cell }) },
    { id: 'left_lobe', geometry: polygonise(left, [-0.11, -0.03, -0.04], [-0.016, 0.05, 0.046], { cell: 0.004 }) },
    {
      id: 'caudate_lobe',
      geometry: polygonise(intersect(inner, caudate), [-0.008, -0.026, -0.048], [0.026, 0.034, -0.014], { cell: 0.0028 }),
    },
    {
      id: 'quadrate_lobe',
      geometry: polygonise(intersect(inner, quadrate), [-0.016, -0.036, 0.004], [0.016, -0.004, 0.044], { cell: 0.0028 }),
    },
    {
      // The falciform ligament: a thin sheet of peritoneum standing in the cleft between the
      // right and left lobes on the front of the liver. It is the landmark that divides the
      // two lobes on the anterior surface; drawn as a flat ellipsoid in the gap left at
      // x = -0.021 so that it neither overlaps a lobe nor leaves the shell.
      id: 'falciform_ligament',
      geometry: polygonise(
        intersect(ellipsoid([-0.021, 0.012, 0.034], [0.0016, 0.034, 0.0085]), offset(shell, -0.0012)),
        [-0.026, -0.03, 0.02],
        [-0.016, 0.06, 0.05],
        { cell: 0.0008 },
      ),
    },
    { id: 'portal_vein', geometry: treeGeometry(t.portal) },
    { id: 'hepatic_artery', geometry: treeGeometry(t.artery) },
    { id: 'hepatic_veins', geometry: mergeParts(t.veins.map(treeGeometry)) },
    { id: 'bile_ducts', geometry: treeGeometry(t.bile) },
    { id: 'lobules', geometry: lobuleGeometry() },
  ];
  return [...base, ...finerParts(right, left)];
};
