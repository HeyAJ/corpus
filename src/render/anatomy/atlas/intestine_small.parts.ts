import * as THREE from 'three';
import type { PartBuilder } from '../parts';
import { giPath, giSegment } from '../layout';
import { mulberry32 } from '../noise';
import { mergeParts, polygonise, roundBox, tubeAlong } from '../sdf';
import type { V3 } from '../sdf';

/**
 * INTERIOR PARTS OF THE SMALL INTESTINE.
 *
 * WHAT THIS DRAWS. The shell in models.ts is one long tube swept along the duodenum,
 * jejunum and ileum centrelines with a ripple that stands for the circular folds. Inside it
 * we draw, from the outside in: the muscular wall (a glass sleeve over everything); the
 * three regions as narrower glass tubes (they carry the chyme, so they must not hide it);
 * the circular folds (plicae circulares) as thin rings, close together in the duodenum and
 * jejunum and sparse in the ileum; the chyme itself as a string of solid boluses with
 * constrictions between them, which is what a segmenting gut looks like; the Peyer's
 * patches, a few oval beads on the ileal wall; the ileocaecal junction at the end; the
 * mesenteric arterial arcades and their veins; and ONE short stretch of jejunum drawn
 * opened out and ENLARGED, with its villi, each carrying a capillary loop (the mucosa part)
 * and a central lacteal (the lacteals part, which also carries the lymph trunk away).
 *
 * THE VILLI ARE NOT TO SCALE. The mucosa patch is a flat slab in the one empty pocket of the
 * bounding box (upper left, above the jejunal coils) and its villi are drawn several times
 * life size so that a reader can see a capillary and a lacteal in each. Its summary says so.
 *
 * HOW IT STAYS INSIDE THE SHELL. Everything is built on the SAME spline the shell is swept
 * along (the whole duodenum-jejunum-ileum path, tension 0.42, parametrised by arc length) so
 * the coils line up exactly; the three regions are sub-ranges of it, cut where the authored
 * centrelines meet. Radii are fixed fractions of the shell's calibre function, copied below
 * from `intestineSmall()` because models.ts does not export it. If that function changes,
 * change `baseRadius` to match. Body coordinates, not warped, as the shell is.
 *
 * WHAT IT DOES NOT DO. It does not draw the mesentery as a membrane (only its vessels), nor
 * the submucosal and myenteric plexuses, nor the crypts. The arcades are a fan from one
 * point, not a traced vascular atlas. The bowel's real length is not reproduced: the model's
 * coils are the model's coils.
 */

const TENSION = 0.42;

/** The shell's calibre at arc fraction g (without its ripple). Copied from models.ts. */
const baseRadius = (g: number): number => 0.0122 - 0.0026 * g;

/** Fractions of the shell radius each layer is drawn at. The shell's ripple only thins it to 0.965. */
const R_WALL = 0.9;
const R_REGION = 0.78;
const R_FOLD = 0.745;
const R_PEYER = 0.72;

let cachedCurve: THREE.CatmullRomCurve3 | null = null;

/** The whole small-bowel spline: the shell's own. */
export function bowelCurve(): THREE.CatmullRomCurve3 {
  if (cachedCurve === null) {
    cachedCurve = new THREE.CatmullRomCurve3(
      giPath(['duodenum', 'jejunum', 'ileum']).map((p) => new THREE.Vector3(p[0], p[1], p[2])),
      false,
      'catmullrom',
      TENSION,
    );
  }
  return cachedCurve;
}

/** Arc fraction of the curve nearest to a point (the junctions between the three centrelines). */
function nearestU(curve: THREE.CatmullRomCurve3, p: V3): number {
  const n = 1200;
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

/** Where duodenum ends and jejunum ends, as arc fractions of the whole bowel. */
export function regionBreaks(): [number, number] {
  const curve = bowelCurve();
  const duo = giSegment('duodenum');
  const jej = giSegment('jejunum');
  return [nearestU(curve, duo[duo.length - 1]), nearestU(curve, jej[jej.length - 1])];
}

/** Points along the bowel between two arc fractions, about every `step` metres. */
export function bowelPoints(u0: number, u1: number, step: number): V3[] {
  const curve = bowelCurve();
  const n = Math.max(3, Math.ceil(((u1 - u0) * curve.getLength()) / step));
  const out: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const p = curve.getPointAt(u0 + ((u1 - u0) * i) / n);
    out.push([p.x, p.y, p.z]);
  }
  return out;
}

/** The slab of opened, enlarged jejunum: where it is, in body coordinates. */
export const VILLI_SLAB = { centre: [-0.052, -0.0225, 0.006] as V3, half: [0.016, 0.0013, 0.014] as V3, villusHeight: 0.0045 };

/** Where the mesenteric arcades start and end; the detail module draws blood along the same lines. */
export interface MesentericLayout {
  root: V3;
  hub: V3;
  /** Points on the bowel wall the branches reach, ordered by angle round the hub. */
  ends: V3[];
  /** Arterial branch paths from the hub to each end (three points). */
  branches: V3[][];
}

let cachedLayout: MesentericLayout | null = null;

export function mesentericLayout(): MesentericLayout {
  if (cachedLayout !== null) return cachedLayout;
  const curve = bowelCurve();
  const [b0] = regionBreaks();
  const root: V3 = [0.002, -0.034, -0.004];
  const hub: V3 = [0.0, -0.062, -0.016];
  const raw: V3[] = [];
  // Sixteen landmarks spread over the jejunum and ileum (everything after the duodenum).
  for (let i = 0; i < 16; i++) {
    const p = curve.getPointAt(b0 + (0.97 - b0) * (i / 15));
    const dx = hub[0] - p.x;
    const dy = hub[1] - p.y;
    const dz = hub[2] - p.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    // Stop on the wall's near side rather than at the centreline.
    raw.push([p.x + (dx / len) * 0.0085, p.y + (dy / len) * 0.0085, p.z + (dz / len) * 0.0085]);
  }
  const ends = raw.sort((p, q) => Math.atan2(p[1] - hub[1], p[0] - hub[0]) - Math.atan2(q[1] - hub[1], q[0] - hub[0]));
  const branches: V3[][] = ends.map((e) => [
    hub,
    [hub[0] + (e[0] - hub[0]) * 0.5, hub[1] + (e[1] - hub[1]) * 0.5 + 0.004, hub[2] + (e[2] - hub[2]) * 0.5],
    e,
  ]);
  cachedLayout = { root, hub, ends, branches };
  return cachedLayout;
}

/** The superior mesenteric artery: from above the root down to the hub of the arcades. */
export function arteryTrunk(): V3[] {
  const { root, hub } = mesentericLayout();
  return [[-0.002, 0.004, -0.012], [root[0], root[1] + 0.012, root[2] - 0.004], root, [0.001, -0.048, -0.01], hub];
}

/** The superior mesenteric vein, from the hub up to where it joins the portal system (top of the box). */
export function veinTrunk(): V3[] {
  const { root, hub } = mesentericLayout();
  return [[hub[0] + 0.003, hub[1], hub[2] + 0.002], [0.004, -0.048, -0.008], [root[0] + 0.003, root[1], root[2] + 0.001], [0.006, -0.02, -0.006], [0.008, 0.004, -0.008]];
}

/** A venous branch runs beside each arterial one, offset a little so the two are both visible. */
export function veinBranch(k: number): V3[] {
  return mesentericLayout().branches[k].map((p): V3 => [p[0] + 0.0012, p[1], p[2] + 0.0014]);
}

/** The collecting vein that drains the enlarged villus patch into the trunk. */
export function slabVein(): V3[] {
  const S = VILLI_SLAB;
  const top = S.centre[1] + S.half[1] + 0.0004;
  return [[S.centre[0] + 0.004, top, S.centre[2] + 0.008], [-0.04, -0.027, 0.006], [-0.02, -0.031, 0.004], [0.001, -0.033, -0.001], [0.0055, -0.032, -0.003]];
}

/** The lymph trunk that carries chyle from the lacteals up past the root of the mesentery. */
export function lymphTrunk(): V3[] {
  const S = VILLI_SLAB;
  const top = S.centre[1] + S.half[1] + 0.0004;
  return [[S.centre[0] - 0.004, top, S.centre[2] + 0.008], [-0.042, -0.0225, 0.0], [-0.02, -0.027, -0.004], [-0.004, -0.024, -0.008], [-0.003, -0.01, -0.012], [-0.002, 0.002, -0.014]];
}

/** Where the lacteals begin: the tips of the villi in the patch. */
export function lacteal0(): V3 {
  const S = VILLI_SLAB;
  return [S.centre[0], S.centre[1] + S.half[1] + S.villusHeight * 0.6, S.centre[2]];
}

const Z_AXIS = new THREE.Vector3(0, 0, 1);

function ringAcross(centre: THREE.Vector3, tangent: THREE.Vector3, major: number, minor: number, radial: number, tubular: number): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(major, minor, radial, tubular);
  const q = new THREE.Quaternion().setFromUnitVectors(Z_AXIS, tangent);
  g.applyMatrix4(new THREE.Matrix4().compose(centre, q, new THREE.Vector3(1, 1, 1)));
  return g;
}

/** A thin straight tube between two points, as cheap as a 3-sided prism. */
function stick(a: V3, b: V3, radius: number): THREE.BufferGeometry {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const g = new THREE.CylinderGeometry(radius, radius, len, 3, 1, true);
  const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

/** A sub-range of the bowel as a tube whose radius is `frac` times the shell's calibre. */
function bowelTube(u0: number, u1: number, frac: number, radial: number): THREE.BufferGeometry {
  const pts = bowelPoints(u0, u1, 0.005);
  return tubeAlong(pts, (t) => frac * baseRadius(u0 + (u1 - u0) * t), { tubular: pts.length, radial, tension: 0.5 });
}

export const parts: PartBuilder = () => {
  const curve = bowelCurve();
  const length = curve.getLength();
  const [b0, b1] = regionBreaks();

  // --- the three regions (glass in the detail module) and the muscular wall over them.
  const duodenum = bowelTube(0, b0, R_REGION, 7);
  const jejunum = bowelTube(b0, b1, R_REGION, 7);
  const ileum = bowelTube(b1, 1, R_REGION, 7);
  const wallPts = bowelPoints(0, 1, 0.008);
  const wall = tubeAlong(wallPts, (t) => R_WALL * baseRadius(t), { tubular: wallPts.length, radial: 8, tension: 0.5 });

  // --- chyme: boluses with constrictions between, so the string is visibly segmented.
  const boluses = 70;
  const lumenPts = bowelPoints(0, 1, 0.005);
  const lumen = tubeAlong(
    lumenPts,
    (t) => baseRadius(t) * 0.5 * (0.3 + 0.7 * Math.pow(Math.sin(Math.PI * boluses * t), 2)),
    { tubular: Math.round(lumenPts.length * 1.5), radial: 5, tension: 0.5 },
  );

  // --- plicae circulares: dense in duodenum and jejunum, sparse and fading in the ileum.
  const plicae: THREE.BufferGeometry[] = [];
  const spacing = [0.007, 0.008, 0.022];
  const regions: [number, number][] = [[0, b0], [b0, b1], [b1, b1 + (1 - b1) * 0.6]];
  regions.forEach(([u0, u1], k) => {
    const n = Math.floor(((u1 - u0) * length) / spacing[k]);
    for (let i = 1; i < n; i++) {
      const u = u0 + ((u1 - u0) * i) / n;
      plicae.push(ringAcross(curve.getPointAt(u), curve.getTangentAt(u).normalize(), R_FOLD * baseRadius(u), 0.0007, 3, 8));
    }
  });

  // --- Peyer's patches: oval beads on the ileal wall, on the side away from the mesentery.
  const rand = mulberry32(0x9e7e5);
  const patches: THREE.BufferGeometry[] = [];
  const hub = mesentericLayout().hub;
  for (let i = 0; i < 9; i++) {
    const u = b1 + (0.93 - b1) * ((i + 0.3 + 0.4 * rand()) / 9);
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u).normalize();
    // Radially outward from the hub, with the tangent component removed: the antimesenteric side.
    const out = new THREE.Vector3(p.x - hub[0], p.y - hub[1], p.z - hub[2]);
    out.addScaledVector(t, -out.dot(t)).normalize();
    const bead = new THREE.SphereGeometry(1, 10, 7);
    bead.scale(0.0036 + 0.002 * rand(), 0.0016, 0.0022);
    // The bead's long axis (x) is laid along the bowel.
    const m = new THREE.Matrix4().makeBasis(t, out, new THREE.Vector3().crossVectors(t, out));
    const pos = p.clone().addScaledVector(out, R_PEYER * baseRadius(u));
    bead.applyMatrix4(new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z).multiply(m));
    patches.push(bead);
  }

  // --- ileocaecal junction: a lipped valve at the very end of the ileum.
  const vu = 0.975;
  const gv = baseRadius(vu);
  const valve = mergeParts([
    ringAcross(curve.getPointAt(vu), curve.getTangentAt(vu).normalize(), 0.5 * gv, 0.0017, 6, 14),
    ringAcross(curve.getPointAt(vu - 0.006), curve.getTangentAt(vu - 0.006).normalize(), 0.62 * gv, 0.0011, 6, 14),
  ]);

  // --- mesentery's vessels: arterial arcades and a vein beside each branch.
  const lay = mesentericLayout();
  const vessels: THREE.BufferGeometry[] = [];
  vessels.push(tubeAlong(arteryTrunk(), () => 0.0014, { tubular: 24, radial: 6 }));
  vessels.push(tubeAlong(veinTrunk(), () => 0.0018, { tubular: 24, radial: 6 }));
  vessels.push(tubeAlong(slabVein(), () => 0.0011, { tubular: 20, radial: 5 }));
  lay.branches.forEach((b, k) => {
    vessels.push(tubeAlong(b, () => 0.0007, { tubular: 4, radial: 4 }));
    vessels.push(tubeAlong(veinBranch(k), () => 0.0006, { tubular: 4, radial: 3 }));
  });
  const at = (e: V3): V3 => [lay.hub[0] + (e[0] - lay.hub[0]) * 0.72, lay.hub[1] + (e[1] - lay.hub[1]) * 0.72, lay.hub[2] + (e[2] - lay.hub[2]) * 0.72];
  for (let i = 0; i + 1 < lay.branches.length; i++) {
    const pa = at(lay.branches[i][2]);
    const pc = at(lay.branches[i + 1][2]);
    const mid: V3 = [(pa[0] + pc[0]) / 2, (pa[1] + pc[1]) / 2, (pa[2] + pc[2]) / 2];
    // Bow each arcade outwards, away from the hub.
    const ox = mid[0] - lay.hub[0];
    const oy = mid[1] - lay.hub[1];
    const oz = mid[2] - lay.hub[2];
    const ol = Math.hypot(ox, oy, oz) || 1;
    vessels.push(tubeAlong([pa, [mid[0] + (ox / ol) * 0.003, mid[1] + (oy / ol) * 0.003, mid[2] + (oz / ol) * 0.003], pc], () => 0.0004, { tubular: 6, radial: 4 }));
  }

  // --- the enlarged, opened stretch: a slab with villi and capillary loops (mucosa), and
  // a central lacteal in each villus plus the lymph trunk (lacteals).
  const S = VILLI_SLAB;
  const slab = polygonise(
    roundBox(S.centre, S.half, 0.0008),
    [S.centre[0] - S.half[0] - 0.002, S.centre[1] - S.half[1] - 0.002, S.centre[2] - S.half[2] - 0.002],
    [S.centre[0] + S.half[0] + 0.002, S.centre[1] + S.half[1] + 0.002, S.centre[2] + S.half[2] + 0.002],
    { cell: 0.0017 },
  );
  const vr = mulberry32(0x71111);
  const villi: THREE.BufferGeometry[] = [slab];
  const lacteals: THREE.BufferGeometry[] = [];
  const baseY = S.centre[1] + S.half[1];
  const h = S.villusHeight;
  for (let ix = 0; ix < 9; ix++) {
    for (let iz = 0; iz < 8; iz++) {
      const x = -0.064 + ix * 0.003 + (vr() - 0.5) * 0.0008;
      const z = -0.004 + iz * 0.0031 + (vr() - 0.5) * 0.0008;
      const v = new THREE.CylinderGeometry(0.0004, 0.0009, h, 5, 1, false);
      v.translate(x, baseY + h / 2, z);
      villi.push(v);
      lacteals.push(stick([x, baseY + 0.0003, z], [x, baseY + h * 0.85, z], 0.00016));
      villi.push(stick([x - 0.00035, baseY + 0.0003, z], [x - 0.0003, baseY + h * 0.8, z], 0.00012));
      villi.push(stick([x + 0.00035, baseY + 0.0003, z], [x + 0.0003, baseY + h * 0.8, z], 0.00012));
    }
  }
  lacteals.push(tubeAlong(lymphTrunk(), () => 0.0011, { tubular: 28, radial: 5 }));

  return [
    { id: 'duodenum', geometry: duodenum },
    { id: 'jejunum', geometry: jejunum },
    { id: 'ileum', geometry: ileum },
    { id: 'muscular_wall', geometry: wall },
    { id: 'lumen_contents', geometry: lumen },
    { id: 'plicae_circulares', geometry: mergeParts(plicae) },
    { id: 'mucosa_villi', geometry: mergeParts(villi) },
    { id: 'lacteals', geometry: mergeParts(lacteals) },
    { id: 'peyers_patches', geometry: mergeParts(patches) },
    { id: 'ileocaecal_junction', geometry: valve },
    { id: 'mesenteric_vessels', geometry: mergeParts(vessels) },
  ];
};
