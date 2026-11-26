import * as THREE from 'three';
import type { PartBuilder } from '../parts';
import {
  ellipsoid,
  halfSpace,
  intersect,
  mergeParts,
  polygonise,
  smoothUnion,
  subtract,
  tubeAlong,
  chain,
  type Sdf,
  type V3,
} from '../sdf';
import { fbm, mulberry32 } from '../noise';
import { PANCREAS_PATH } from '../models';

/**
 * THE INSIDE OF THE PANCREAS: the five regions of the gland, the two ducts, the exocrine
 * tissue, the islets and the splenic vessels that run along its back.
 *
 * Authored in BODY coordinates, the frame of the shell in models.ts (organ position
 * [0, 0, 0]); models.ts does not pass the pancreas through `warpGeometry`, so neither do we.
 * The tail points to the patient's left (-x) and ends at the splenic hilum; the head sits
 * inside the curve of the duodenum at +x (GRAYS42).
 *
 * THE FIELD IS THE SHELL'S OWN. `gland()` repeats the shell's chain-and-uncinate
 * expression without the lobulating noise, and every part is pulled inwards by at least
 * 1.8 mm, which is more than the noise can move the surface (1.6 mm), so nothing pokes
 * through. The same trick as the uterus.
 *
 * THE REGIONS ARE SLICES. Tail, body, neck and head are the gland cut by vertical planes
 * at fixed x, and the uncinate process is the hook-shaped lower medial corner of the head,
 * cut out of it. The cuts are drawing choices: the real boundaries are conventional
 * (the neck is simply the part in front of the portal vein) and none is measured. All five
 * enclose the ducts and the islets, so the detail module draws them as glass.
 *
 * WHAT IS DRAWN LARGER THAN LIFE. The islets are a few tenths of a millimetre across; here
 * they are beads over a millimetre across so that they can be seen and tapped, and there
 * are tens of them rather than about a million. Their density rises towards the tail,
 * where the islets of the real gland are most numerous (GH14; GRAYS42). The ducts and
 * vessels are drawn thicker than a real main duct (a few millimetres) would scale to a
 * gland drawn at this size; they are for reading, not measuring.
 */

/** The shell's chain radii, one per path point (models.ts). */
const RADII = [0.008, 0.011, 0.0125, 0.0115, 0.019];
const UNCINATE_C: V3 = [0.01, -0.036, -0.027];
const UNCINATE_R: V3 = [0.012, 0.009, 0.008];

/** Plane positions along x that divide tail, body, neck and head. Drawing choices. */
const X_TAIL = -0.045;
const X_BODY = -0.008;
const X_NECK = 0.01;

/** Inward margin from the shell, metres: more than the shell's lobulating noise (1.6 mm). */
const MARGIN = 0.0018;

function gland(): Sdf {
  return smoothUnion(0.006, chain(PANCREAS_PATH, RADII), ellipsoid(UNCINATE_C, UNCINATE_R));
}

function inward(f: Sdf, d: number): Sdf {
  return (x, y, z) => f(x, y, z) + d;
}

/** Linear interpolation of the shell's centreline and radius by x (the gland runs mostly along x). */
function along(x: number): { y: number; z: number; r: number } {
  const P = PANCREAS_PATH;
  if (x <= P[0][0]) return { y: P[0][1], z: P[0][2], r: RADII[0] };
  for (let i = 0; i < P.length - 1; i++) {
    if (x <= P[i + 1][0]) {
      const t = (x - P[i][0]) / (P[i + 1][0] - P[i][0]);
      return {
        y: P[i][1] + t * (P[i + 1][1] - P[i][1]),
        z: P[i][2] + t * (P[i + 1][2] - P[i][2]),
        r: RADII[i] + t * (RADII[i + 1] - RADII[i]),
      };
    }
  }
  const n = P.length - 1;
  return { y: P[n][1], z: P[n][2], r: RADII[n] };
}

/** The main pancreatic duct (of Wirsung): tail to the ampulla on the duodenal side of the head. */
export const DUCT_PATH: V3[] = [
  [-0.07, 0.021, -0.03],
  [-0.05, 0.0175, -0.0305],
  [-0.025, 0.011, -0.03],
  [0.0, -0.003, -0.0285],
  [0.016, -0.0145, -0.0265],
  [0.034, -0.027, -0.026],
];

/** The accessory duct (of Santorini): leaves the main duct in the head, ends at the minor papilla. */
export const ACCESSORY_PATH: V3[] = [
  [0.006, -0.0073, -0.0278],
  [0.017, -0.0075, -0.0255],
  [0.03, -0.01, -0.0235],
];

const VESSEL_X = [0.004, -0.014, -0.032, -0.05, -0.062, -0.07];

/**
 * The splenic artery runs along the upper border of the body and tail, a little behind the
 * midline of the gland, from the coeliac side (neck) to the splenic hilum (tail). The
 * offset is a fraction of the local gland radius so it stays inside the thin tail, and it
 * wanders a little, as the real artery is tortuous.
 */
export function arteryPath(): V3[] {
  return VESSEL_X.map((x, i) => {
    const a = along(x);
    const wob = 0.0012 * Math.sin(i * 2.1);
    return [x, a.y + 0.5 * a.r + wob, a.z - 0.16 * a.r] as V3;
  });
}

/** Tail to neck: the splenic vein runs on the back of the gland and joins the portal vein. */
export function veinPath(): V3[] {
  return VESSEL_X.slice()
    .reverse()
    .map((x, i) => {
      const a = along(x);
      const wob = 0.0008 * Math.sin(i * 1.7 + 1);
      return [x, a.y - 0.18 * a.r + wob, a.z - 0.5 * a.r] as V3;
    });
}

/** Where the islet beads are drawn; used by the detail module for the hormone streams' origins. */
export const BETA_ORIGIN: V3 = [-0.04, 0.0105, -0.03];
export const ALPHA_ORIGIN: V3 = [-0.062, 0.0155, -0.0295];

export const parts: PartBuilder = () => {
  const out: { id: string; geometry: THREE.BufferGeometry }[] = [];
  const g = gland();
  const body = inward(g, MARGIN);
  const cell = 0.002;
  const Y0 = -0.05;
  const Y1 = 0.04;
  const Z0 = -0.052;
  const Z1 = -0.006;
  const slab = (x0: number, x1: number) => ({ min: [x0, Y0, Z0] as V3, max: [x1, Y1, Z1] as V3 });
  const right = (x: number) => halfSpace([x, 0, 0], [1, 0, 0]); // keeps x > the plane
  const left = (x: number) => halfSpace([x, 0, 0], [-1, 0, 0]); // keeps x < the plane

  const uncinateRegion = ellipsoid([0.01, -0.037, -0.026], [0.015, 0.012, 0.012]);

  // TAIL: left of X_TAIL, towards the splenic hilum.
  let b = slab(-0.09, X_TAIL + 0.002);
  out.push({ id: 'tail', geometry: polygonise(intersect(body, left(X_TAIL)), b.min, b.max, { cell }) });
  // BODY.
  b = slab(X_TAIL - 0.002, X_BODY + 0.002);
  out.push({ id: 'body', geometry: polygonise(intersect(body, intersect(right(X_TAIL), left(X_BODY))), b.min, b.max, { cell }) });
  // NECK: the short constricted part in front of the portal vein.
  b = slab(X_BODY - 0.002, X_NECK + 0.002);
  out.push({ id: 'neck', geometry: polygonise(subtract(intersect(body, intersect(right(X_BODY), left(X_NECK))), uncinateRegion), b.min, b.max, { cell }) });
  // HEAD without its hook.
  b = slab(X_NECK - 0.002, 0.048);
  out.push({ id: 'head', geometry: polygonise(subtract(intersect(body, right(X_NECK)), uncinateRegion), b.min, b.max, { cell }) });
  // UNCINATE PROCESS: the hook of the head that passes behind the superior mesenteric vessels.
  b = { min: [-0.008, -0.05, -0.042] as V3, max: [0.03, -0.022, -0.01] as V3 };
  out.push({ id: 'uncinate_process', geometry: polygonise(intersect(body, uncinateRegion), b.min, b.max, { cell: 0.0014 }) });

  // ACINAR TISSUE: the exocrine lobules as a lumpy envelope well inside the gland, so that the
  // two glass layers (region and lobules) read as separate skins and the duct runs through both.
  const lobulated: Sdf = (x, y, z) => g(x, y, z) + 0.0035 - 0.0011 * fbm(x, y, z, 260, 2);
  out.push({ id: 'acinar_tissue', geometry: polygonise(lobulated, [-0.09, Y0, Z0], [0.048, Y1, Z1], { cell: 0.0026 }) });

  // DUCTS.
  out.push({ id: 'main_duct', geometry: tubeAlong(DUCT_PATH, (t) => 0.0011 + 0.0007 * t, { tubular: 60, radial: 10 }) });
  out.push({ id: 'accessory_duct', geometry: tubeAlong(ACCESSORY_PATH, () => 0.0007, { tubular: 16, radial: 8 }) });

  // ISLETS OF LANGERHANS: beads scattered through the tissue, denser towards the tail.
  // Rejection sampling inside the gland field, deterministic.
  const rnd = mulberry32(0x151e7);
  const beads: THREE.BufferGeometry[] = [];
  let guard = 0;
  while (beads.length < 70 && guard++ < 20000) {
    const x = -0.082 + 0.12 * rnd();
    const y = -0.045 + 0.08 * rnd();
    const z = -0.05 + 0.04 * rnd();
    const keep = 0.15 + 0.85 * Math.min(1, Math.max(0, (0.03 - x) / 0.1));
    const r = 0.0009 + 0.0005 * rnd();
    if (rnd() > keep) continue;
    if (g(x, y, z) > -(MARGIN + r + 0.0012)) continue;
    const s = new THREE.SphereGeometry(r, 7, 5);
    s.translate(x, y, z);
    s.deleteAttribute('uv');
    beads.push(s);
  }
  out.push({ id: 'islets', geometry: mergeParts(beads) });

  // SPLENIC VESSELS: artery and vein along the back of the body and tail, joined into one part.
  out.push({
    id: 'splenic_vessels',
    geometry: mergeParts([
      tubeAlong(arteryPath(), () => 0.0013, { tubular: 40, radial: 8 }),
      tubeAlong(veinPath(), (t) => 0.0014 + 0.0006 * t, { tubular: 40, radial: 8 }),
    ]),
  });
  out.push(...finerParts(g));
  return out;
};

/* -------------------------------------------------- finer structures (T2) */

/**
 * ONE MAGNIFIED ACINUS AND ONE MAGNIFIED ISLET, DRAWN INSIDE THE GLAND.
 *
 * Added after the first atlas as pure additions (no id moved). The cells of the pancreas are
 * thousands of times smaller than the gland is drawn, so, as for the liver's lobule, one
 * example of each is drawn enlarged inside the tissue that holds it and labelled as such:
 *
 *   - THE ACINUS (children of the acinar tissue): a ring of pyramid-shaped acinar cells round a
 *     small lumen, their narrow ends towards it, each holding a few zymogen granules at the
 *     lumen end, where the cell releases them; one or two centroacinar cells at the mouth of
 *     the acinus; and an intercalated duct that leads away to join the main duct (GRAYS42,
 *     GH14 ch. 65). The cell count, the number of granules and the sizes are LAYOUT CHOICES
 *     for legibility, not measurements. The acinus is placed beside the main duct, in
 *     whichever direction leaves the most room inside the gland.
 *   - THE ISLET (children of the islets part): a cluster of beads, one per cell, in the five
 *     types the texts name (alpha, beta, delta, PP and epsilon). The beads are laid out in
 *     bands only so that the types can be told apart; the bands, the proportions of the
 *     types and the bead size are drawing choices and are not an arrangement taken from
 *     any text. Placement is seeded, so it is identical on every load.
 *
 * Nothing here changes the existing parts. Every bead and cell is kept inside the gland field
 * with the same margin the existing islet beads use, so none can poke through the shell.
 */

/** The main duct's centre at fraction f (0..1) of the way along its path, by piecewise-linear interpolation. */
function ductAt(f: number): V3 {
  const n = DUCT_PATH.length - 1;
  const x = Math.min(n - 1e-9, Math.max(0, f * n));
  const i = Math.floor(x);
  const u = x - i;
  const a = DUCT_PATH[i];
  const b = DUCT_PATH[i + 1];
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

/** Of eight directions round the duct, the centre that sits deepest inside the gland. */
function roomiest(g: Sdf, from: V3, dist: number): V3 {
  let best: V3 = from;
  let bestD = Infinity;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    // The duct runs mostly along x, so the room lies in the y-z plane.
    const c: V3 = [from[0], from[1] + dist * Math.cos(a), from[2] + dist * Math.sin(a)];
    const d = g(c[0], c[1], c[2]);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const unit3 = (a: V3): V3 => {
  const l = len3(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const mix3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function ball(c: V3, r: number): THREE.BufferGeometry {
  const s = new THREE.SphereGeometry(r, 6, 4);
  s.translate(c[0], c[1], c[2]);
  s.deleteAttribute('uv');
  return s;
}

function finerParts(g: Sdf): { id: string; geometry: THREE.BufferGeometry }[] {
  const out: { id: string; geometry: THREE.BufferGeometry }[] = [];
  const rnd = mulberry32(0x2ac14);

  // ---- the acinus
  const D = ductAt(0.22);
  const A = roomiest(g, D, 0.0048);
  const toDuct = unit3(sub3(D, A));
  const rho = 0.0031;
  const cells: THREE.BufferGeometry[] = [];
  const granules: THREE.BufferGeometry[] = [];
  const dirs: V3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const total = 14;
  for (let i = 0; i < total; i++) {
    const y = 1 - (2 * (i + 0.5)) / total;
    const rr = Math.sqrt(Math.max(0, 1 - y * y));
    const d = unit3([Math.cos(golden * i) * rr, y, Math.sin(golden * i) * rr]);
    // Leave the side facing the duct open: the lumen's mouth.
    if (d[0] * toDuct[0] + d[1] * toDuct[1] + d[2] * toDuct[2] > 0.62) continue;
    dirs.push(d);
  }
  for (const d of dirs) {
    const apex: V3 = [A[0] + d[0] * 0.0007, A[1] + d[1] * 0.0007, A[2] + d[2] * 0.0007];
    const base: V3 = [A[0] + d[0] * rho, A[1] + d[1] * rho, A[2] + d[2] * rho];
    cells.push(tubeAlong([apex, mix3(apex, base, 0.5), base], (t) => 0.00035 + 0.0008 * t, { tubular: 4, radial: 6 }));
    for (let k = 0; k < 2; k++) {
      const at = 0.0011 + 0.0006 * k + 0.0002 * rnd();
      const off: V3 = [(rnd() - 0.5) * 0.0004, (rnd() - 0.5) * 0.0004, (rnd() - 0.5) * 0.0004];
      granules.push(ball([A[0] + d[0] * at + off[0], A[1] + d[1] * at + off[1], A[2] + d[2] * at + off[2]], 0.00022));
    }
  }
  out.push({ id: 'acinar_cells', geometry: mergeParts(cells) });
  out.push({ id: 'zymogen_granules', geometry: mergeParts(granules) });

  // Centroacinar cells: two flattened beads at the mouth of the acinus.
  const mouth = mix3(A, D, 0.3);
  const cen: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const b = new THREE.SphereGeometry(0.0006, 6, 4);
    b.scale(1, 1, 0.55);
    b.translate(mouth[0] + side * 0.0007, mouth[1] + side * 0.0004, mouth[2]);
    b.deleteAttribute('uv');
    cen.push(b);
  }
  out.push({ id: 'centroacinar_cells', geometry: mergeParts(cen) });

  // Intercalated ducts: from the mouth to the main duct, with a short side twig.
  const via = mix3(mouth, D, 0.55);
  const twigEnd: V3 = [via[0] - 0.0016, via[1] + 0.0008, via[2] + 0.0006];
  out.push({
    id: 'intercalated_ducts',
    geometry: mergeParts([
      tubeAlong([mouth, via, mix3(via, D, 0.7)], () => 0.0004, { tubular: 8, radial: 6 }),
      tubeAlong([via, twigEnd], () => 0.0003, { tubular: 4, radial: 5 }),
    ]),
  });

  // ---- the islet
  const D2 = ductAt(0.45);
  const C = roomiest(g, D2, 0.0058);
  const R = 0.0034;
  const pts: V3[] = [];
  let guard = 0;
  while (pts.length < 30 && guard++ < 5000) {
    const p: V3 = [C[0] + (rnd() * 2 - 1) * R, C[1] + (rnd() * 2 - 1) * R, C[2] + (rnd() * 2 - 1) * R];
    if (len3(sub3(p, C)) > R) continue;
    if (g(p[0], p[1], p[2]) > -(MARGIN + 0.0006 + 0.0012)) continue;
    if (pts.some((q) => len3(sub3(p, q)) < 0.0011)) continue;
    pts.push(p);
  }
  pts.sort((a, b) => len3(sub3(a, C)) - len3(sub3(b, C)));
  // Innermost 14 beta, next 8 shared by delta (3), PP (3) and epsilon (2), outermost 8 alpha.
  const band = (from: number, to: number): V3[] => pts.slice(from, Math.min(to, pts.length));
  const bead = (list: V3[]): THREE.BufferGeometry => mergeParts(list.map((p) => ball(p, 0.00055)));
  const mid = band(14, 22);
  out.push({ id: 'beta_cells', geometry: bead(band(0, 14)) });
  out.push({ id: 'delta_cells', geometry: bead(mid.slice(0, 3)) });
  out.push({ id: 'pp_cells', geometry: bead(mid.slice(3, 6)) });
  out.push({ id: 'epsilon_cells', geometry: bead(mid.slice(6, 8)) });
  out.push({ id: 'alpha_cells', geometry: bead(band(22, 30)) });
  return out;
}
