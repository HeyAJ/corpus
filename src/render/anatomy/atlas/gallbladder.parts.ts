import * as THREE from 'three';
import type { PartBuilder } from '../parts';
import { capsule, halfSpace, intersect, polygonise, smoothUnion, subtract, tubeAlong } from '../sdf';
import type { Sdf, V3 } from '../sdf';

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

/** The neck, which the detail module uses as the pivot when the bag shrinks. */
export const GB_NECK: V3 = N;

/** Routes for the three bile streams. */
export function gallbladderPaths(): { hepatic: V3[]; fill: V3[]; empty: V3[] } {
  const mid = (a: V3, b: V3): V3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const cysticMid = mid(N, JUNCTION);
  return {
    hepatic: [CHD_START, JUNCTION, CBD_MID, CBD_END],
    fill: [JUNCTION, cysticMid, N, mid(N, B), B],
    empty: [B, mid(N, B), N, cysticMid, JUNCTION, CBD_MID, CBD_END],
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

  return [
    { id: 'fundus', geometry: polygonise(fundusField, lo, hi, { cell }) },
    { id: 'body', geometry: polygonise(bodyField, lo, hi, { cell }) },
    { id: 'neck', geometry: polygonise(neckField, lo, hi, { cell: 0.001 }) },
    { id: 'bile', geometry: polygonise(bile, lo, hi, { cell: 0.0011 }) },
    { id: 'cystic_duct', geometry: duct([N, lerp3(N, JUNCTION, 0.5), JUNCTION], 0.0021) },
    { id: 'spiral_fold', geometry: spiral() },
    { id: 'common_hepatic_duct', geometry: duct([CHD_START, lerp3(CHD_START, JUNCTION, 0.5), JUNCTION], 0.0022) },
    { id: 'common_bile_duct', geometry: duct([JUNCTION, CBD_MID, CBD_END], 0.0024) },
  ];
};
