import * as THREE from 'three';
import type { PartBuilder } from '../parts';
import { capsule, ellipsoid, halfSpace, intersect, mergeParts, polygonise, smoothUnion, subtract, torus, tubeAlong } from '../sdf';
import type { Sdf, V3 } from '../sdf';
import { mulberry32 } from '../noise';

/**
 * THE INSIDE OF THE GALLBLADDER AND THE DUCTS THAT SERVE IT.
 *
 * The gallbladder is a pear-shaped bag on the underside of the liver. Its rounded end is the
 * FUNDUS, its main part the BODY, and its tapering end the NECK, which bends into the
 * CYSTIC DUCT. The cystic duct joins the COMMON HEPATIC DUCT, coming down from the liver, to
 * make the COMMON BILE DUCT, which runs on to the duodenum. The cystic duct's lining is
 * thrown into a spiral fold, the spiral valve of Heister (GRAYS42, GH14 ch. 65).
 *
 * FRAME. The shell's own (models.ts `gallbladder()`): origin at the organ's position, +x the
 * patient's right, +y cranial, +z anterior. The shell is a chain of three spheres along
 * F (fundus) -> B (body) -> N (neck) with radii 13.5, 12 and 5 mm, plus a short cystic-duct
 * capsule; this file repeats those three centres, because the shell does not export them.
 *
 * WHAT IS DRAWN. The wall, in three pieces (fundus, body, neck) that meet on planes across
 * the axis, each 1.2 mm inside the shell so that it can be drawn as glass; the stored bile,
 * a solid that fills the lumen with a margin of about 2.3 mm to the wall, and which the detail
 * module scales to show how full the bag is; the cystic duct and, inside it, a helical
 * fold; and the first stretches of the common hepatic and common bile ducts.
 *
 * WHAT IS COMPROMISED. The shell contains the gallbladder and only about 14 mm of its duct,
 * so the junction with the common hepatic duct is drawn only 8 mm up the cystic duct, and
 * the two main ducts are short stubs kept inside the shell's bounding box; the common bile
 * duct runs down behind the neck, medial to the shell's own surface, as it does behind the
 * first part of the duodenum in life. Lengths and radii are chosen to read clearly, not
 * measured, and the spiral's turns are a drawing choice.
 */

const F: V3 = [0.006, -0.024, 0.012];
const B: V3 = [0.0, -0.004, 0.004];
const N: V3 = [-0.01, 0.016, -0.006];
/** Where the cystic duct meets the common hepatic duct. */
export const JUNCTION: V3 = [-0.0155, 0.0215, -0.009];
const CHD_START: V3 = [-0.0195, 0.0255, -0.0118];
const CBD_MID: V3 = [-0.0175, 0.011, -0.0115];
const CBD_END: V3 = [-0.019, -0.002, -0.012];
/**
 * Where the common bile duct ends in the hepatopancreatic ampulla (of Vater), a short way below
 * CBD_END, just beyond the shell's bounding box, as the duct stubs already are. In life the ampulla lies in the wall of the
 * duodenum, which this atlas does not draw; it is placed here, at the end of the duct, so that
 * the duct has somewhere to end (GRAYS42). The position is a drawing choice.
 */
export const AMPULLA: V3 = [-0.019, -0.0085, -0.012];

/** The neck, which the detail module uses as the pivot when the bag shrinks. */
export const GB_NECK: V3 = N;

/** Routes for the three bile streams. */
export function gallbladderPaths(): { hepatic: V3[]; fill: V3[]; empty: V3[] } {
  const mid = (a: V3, b: V3): V3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const cysticMid = mid(N, JUNCTION);
  return {
    hepatic: [CHD_START, JUNCTION, CBD_MID, CBD_END, AMPULLA],
    fill: [JUNCTION, cysticMid, N, mid(N, B), B],
    empty: [B, mid(N, B), N, cysticMid, JUNCTION, CBD_MID, CBD_END, AMPULLA],
  };
}

/** A three-sphere chain along F, B, N with the given radii, smoothly joined. */
function chain3(r: [number, number, number]): Sdf {
  return smoothUnion(0.003, capsule(F, B, r[0], r[1]), capsule(B, N, r[1], r[2]));
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function spiral(): THREE.BufferGeometry {
  const d = new THREE.Vector3(...sub(JUNCTION, N));
  const len = d.length();
  d.normalize();
  const ref = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const e1 = new THREE.Vector3().crossVectors(d, ref).normalize();
  const e2 = new THREE.Vector3().crossVectors(d, e1).normalize();
  const turns = 3;
  const pts: V3[] = [];
  for (let i = 0; i <= 30; i++) {
    const t = 0.08 + 0.84 * (i / 30);
    const a = t * turns * Math.PI * 2;
    const c = Math.cos(a) * 0.0011;
    const s = Math.sin(a) * 0.0011;
    pts.push([
      N[0] + d.x * len * t + e1.x * c + e2.x * s,
      N[1] + d.y * len * t + e1.y * c + e2.y * s,
      N[2] + d.z * len * t + e1.z * c + e2.z * s,
    ]);
  }
  return tubeAlong(pts, () => 0.0004, { tubular: 60, radial: 5 });
}

export const parts: PartBuilder = () => {
  // The wall, 1.2 mm inside the shell's radii (13.5, 12, 5 mm).
  const wall = chain3([0.0123, 0.0108, 0.0038]);
  // Cut planes across the axis. A halfSpace's inside is the side its normal points to.
  const toFundus = sub(F, B);
  const toNeck = sub(N, B);
  const fundusPlane = halfSpace(lerp3(F, B, 0.6), toFundus);
  const neckPlane = halfSpace(lerp3(B, N, 0.5), toNeck);
  const fundusField = intersect(wall, fundusPlane);
  const neckField = intersect(wall, neckPlane);
  // The body is what is behind both planes: negate each plane (subtract removes its inside).
  const bodyField = subtract(subtract(wall, fundusPlane), neckPlane);

  const lo: V3 = [-0.026, -0.04, -0.018];
  const hi: V3 = [0.022, 0.03, 0.028];
  const cell = 0.0012;
  const bile = chain3([0.0098, 0.0086, 0.0018]);

  const duct = (pts: V3[], r: number): THREE.BufferGeometry => tubeAlong(pts, () => r, { tubular: 16, radial: 10 });

  const base = [
    { id: 'fundus', geometry: polygonise(fundusField, lo, hi, { cell }) },
    { id: 'body', geometry: polygonise(bodyField, lo, hi, { cell }) },
    { id: 'neck', geometry: polygonise(neckField, lo, hi, { cell: 0.001 }) },
    { id: 'bile', geometry: polygonise(bile, lo, hi, { cell: 0.0011 }) },
    { id: 'cystic_duct', geometry: duct([N, lerp3(N, JUNCTION, 0.5), JUNCTION], 0.0021) },
    { id: 'spiral_fold', geometry: spiral() },
    { id: 'common_hepatic_duct', geometry: duct([CHD_START, lerp3(CHD_START, JUNCTION, 0.5), JUNCTION], 0.0022) },
    { id: 'common_bile_duct', geometry: duct([JUNCTION, CBD_MID, CBD_END], 0.0024) },
  ];
  return [...base, ...finerParts(), ...wallLayers(lo, hi)];
};

/* -------------------------------------------------- finer structures (T2) */

/**
 * THE WALL IN LAYERS, THE FOLDS OF THE LINING, THE POUCH, THE ARTERY AND THE OUTLET.
 *
 * Added after the first atlas as pure additions (no id moved).
 *
 *   - WALL LAYERS. The textbook wall is, from the lumen out: columnar epithelium, lamina
 *     propria, a muscle layer, perimuscular connective tissue and the serosa (GRAYS42). Each is
 *     drawn as one closed glass surface, the wall's own chain of spheres shrunk by a fixed depth,
 *     so they nest inside the three wall pieces. THE SPACING IS NOT THE LAYERS' REAL RELATIVE
 *     THICKNESS: it is a fraction of a millimetre per layer so that all five fit between the
 *     wall pieces' surface and the stored bile, and they are placed so that each can be seen
 *     as its own skin. They run over the whole bag, neck included; the data file nests them
 *     under the body piece, as five siblings and not a chain, to stay inside the depth cap.
 *   - MUCOSAL FOLDS. Twelve short ridges wandering over the inside of the wall, drawn as thin
 *     tubes from a seeded walk so the pattern is the same on every load. The real folds form
 *     a network; this one is schematic and its count is a drawing choice.
 *   - HARTMANN'S POUCH is a small bulge on the underside of the neck, drawn as a glass ellipsoid
 *     that stays inside the shell.
 *   - THE CYSTIC ARTERY comes in near the neck and divides into two branches that run over the
 *     wall, outside the wall pieces. Course and calibre are drawing choices.
 *   - THE AMPULLA AND ITS SPHINCTER. A last stretch of the common bile duct leads into a
 *     small bulb, the hepatopancreatic ampulla, where the pancreatic duct joins it (a short
 *     stub is drawn). A ring of muscle, the sphincter of Oddi, collars its lower end; the
 *     detail module opens and closes it. The pancreas atlas draws the pancreatic duct's own
 *     end; the two are not placed to meet, because the organs' frames differ.
 */

/** Wall radii at the fundus, body and neck (1.2 mm inside the shell's 13.5, 12 and 5 mm). */
const WALL_R: [number, number, number] = [0.0123, 0.0108, 0.0038];

/** Wall layer names and depths (metres) below the wall pieces' surface: a display spacing. */
const LAYERS: readonly (readonly [string, number])[] = [
  ['serosa', 0.0002],
  ['perimuscular_connective_tissue', 0.0005],
  ['muscularis', 0.0008],
  ['lamina_propria', 0.0011],
  ['columnar_epithelium', 0.0014],
];

const norm3 = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The wall's axis as a polyline, parameterised 0 (fundus) to 1 (neck), and a frame round it. */
const AXIS_D = norm3(sub(N, F));
const AXIS_E1 = norm3(cross3(AXIS_D, [1, 0, 0]));
const AXIS_E2 = cross3(AXIS_D, AXIS_E1);

/** Centre and wall radius at parameter t along F -> B -> N. */
function axisAt(t: number): { c: V3; r: number } {
  if (t <= 0.5) {
    const u = t * 2;
    return { c: lerp3(F, B, u), r: WALL_R[0] + (WALL_R[1] - WALL_R[0]) * u };
  }
  const u = (t - 0.5) * 2;
  return { c: lerp3(B, N, u), r: WALL_R[1] + (WALL_R[2] - WALL_R[1]) * u };
}

/** A point on the cylinder `inset` metres inside (negative: outside) the wall, at angle theta. */
function onWall(t: number, theta: number, inset: number): V3 {
  const { c, r } = axisAt(t);
  const rr = r - inset;
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  return [
    c[0] + rr * (ct * AXIS_E1[0] + st * AXIS_E2[0]),
    c[1] + rr * (ct * AXIS_E1[1] + st * AXIS_E2[1]),
    c[2] + rr * (ct * AXIS_E1[2] + st * AXIS_E2[2]),
  ];
}

function wallLayers(lo: V3, hi: V3): { id: string; geometry: THREE.BufferGeometry }[] {
  return LAYERS.map(([id, d]) => ({
    id,
    geometry: polygonise(chain3([WALL_R[0] - d, WALL_R[1] - d, WALL_R[2] - d]), lo, hi, { cell: 0.0022 }),
  }));
}

function finerParts(): { id: string; geometry: THREE.BufferGeometry }[] {
  const out: { id: string; geometry: THREE.BufferGeometry }[] = [];
  const tube = (pts: V3[], r: number, radial = 6): THREE.BufferGeometry =>
    tubeAlong(pts, () => r, { tubular: Math.max(6, pts.length * 3), radial });

  // Mucosal folds: seeded random walks in (t, theta) over the inside of the wall.
  const rng = mulberry32(0x6a11b);
  const folds: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 12; i++) {
    let t = 0.1 + 0.75 * rng();
    let th = rng() * Math.PI * 2;
    let dt = (rng() - 0.5) * 0.12;
    let dth = (rng() - 0.5) * 0.9;
    const pts: V3[] = [];
    for (let k = 0; k < 6; k++) {
      pts.push(onWall(Math.min(0.95, Math.max(0.05, t)), th, 0.0016));
      t += dt;
      th += dth;
      dt += (rng() - 0.5) * 0.06;
      dth += (rng() - 0.5) * 0.5;
    }
    folds.push(tube(pts, 0.0003, 4));
  }
  out.push({ id: 'mucosal_folds', geometry: mergeParts(folds) });

  // Hartmann's pouch: a bulge on the underside of the neck, inside the shell.
  const pc = onWall(0.66, 2.2, 0.0026);
  const pouch = ellipsoid(pc, [0.0034, 0.0042, 0.0034]);
  out.push({ id: 'hartmanns_pouch', geometry: polygonise(pouch, [pc[0] - 0.006, pc[1] - 0.006, pc[2] - 0.006], [pc[0] + 0.006, pc[1] + 0.006, pc[2] + 0.006], { cell: 0.001 }) });

  // Cystic artery: a trunk to the neck, then two branches over the body, just outside the wall.
  const lead: V3 = [-0.0215, 0.0255, -0.0085];
  const trunk = tube([lead, onWall(0.93, 0.5, -0.0005), onWall(0.78, 0.5, -0.0005), onWall(0.68, 0.5, -0.0005)], 0.0004, 6);
  const branchA = tube([onWall(0.68, 0.5, -0.0005), onWall(0.55, 0.1, -0.0005), onWall(0.4, -0.2, -0.0005), onWall(0.25, -0.35, -0.0005)], 0.0003, 6);
  const branchB = tube([onWall(0.68, 0.5, -0.0005), onWall(0.55, 0.9, -0.0005), onWall(0.4, 1.15, -0.0005), onWall(0.27, 1.3, -0.0005)], 0.0003, 6);
  out.push({ id: 'cystic_artery', geometry: mergeParts([trunk, branchA, branchB]) });

  // Ampulla: the last stretch of the common bile duct, a bulb, and the stub of the pancreatic duct.
  const bulb = polygonise(ellipsoid(AMPULLA, [0.0031, 0.0042, 0.0031]), [AMPULLA[0] - 0.006, AMPULLA[1] - 0.007, AMPULLA[2] - 0.006], [AMPULLA[0] + 0.006, AMPULLA[1] + 0.007, AMPULLA[2] + 0.006], { cell: 0.001 });
  bulb.deleteAttribute('uv');
  const lead2 = tube([CBD_END, [CBD_END[0], (CBD_END[1] + AMPULLA[1]) / 2, CBD_END[2]], [AMPULLA[0], AMPULLA[1] + 0.0015, AMPULLA[2]]], 0.0024, 10);
  const stub = tube([[AMPULLA[0], AMPULLA[1], AMPULLA[2] - 0.0033], [AMPULLA[0], AMPULLA[1], AMPULLA[2] - 0.0045]], 0.0012, 8);
  out.push({ id: 'hepatopancreatic_ampulla', geometry: mergeParts([bulb, lead2, stub]) });

  // Sphincter of Oddi: a ring of muscle round the lower end of the ampulla.
  const ringC: V3 = [AMPULLA[0], AMPULLA[1] - 0.0035, AMPULLA[2]];
  out.push({ id: 'sphincter_of_oddi', geometry: polygonise(torus(ringC, 0.0032, 0.0012, 1), [ringC[0] - 0.006, ringC[1] - 0.004, ringC[2] - 0.006], [ringC[0] + 0.006, ringC[1] + 0.004, ringC[2] + 0.006], { cell: 0.0008 }) });
  return out;
}
