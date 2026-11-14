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
  return out;
};
