import * as THREE from 'three';
import type { PartBuilder } from '../parts';
import {
  capsule,
  ellipsoid,
  halfSpace,
  intersect,
  mergeParts,
  polygonise,
  smoothUnion,
  subtract,
  torus,
  tubeAlong,
  type Sdf,
  type V3,
} from '../sdf';
import { ridged } from '../noise';

/**
 * THE INSIDE OF THE BLADDER.
 *
 * The bladder is a bag of smooth muscle, the detrusor, lined by a folded mucous membrane,
 * the mucosa. The two ureters open into its back and lower wall at the ureteric orifices;
 * the smooth triangle between those two openings and the bladder neck is the trigone, which
 * does not fold; at the neck a ring of muscle, the internal sphincter, closes the way into
 * the urethra (GRAYS42, GH14 ch. 26). The urine itself is NOT drawn here: the renderer
 * already shows the fluid level in a selected bladder, and drawing it twice would disagree.
 *
 * FRAME. Authored in the same frame as the shell in models.ts, origin at the bladder's
 * position; the shell is an ellipsoid [36, 30, 33] mm with an apex toward the navel and a
 * neck running down and back into the urethra. Every part is inside it: the detrusor wall
 * is 1.3 mm inside the shell surface and 4.5 mm thick; the mucosa and trigone sit on its
 * inner face; the neck parts are inside the shell's neck tube.
 *
 * HOW THE LINING IS DRAWN. The mucosa is a band hugging the inner face of the wall whose
 * thickness is raised by ridged noise, which gives folds (rugae) that run in no particular
 * direction; it is cut away over the trigone, which is smooth. The detail module fades the
 * folds as the bladder fills, because stretching flattens them.
 *
 * NOT DRAWN. The layers of the wall, the urothelium, the nerves, the prostate or the female
 * urethral anatomy beyond its first part; the positions of the orifices are where the
 * ureters' own centrelines meet the inner wall, and the sizes are chosen to read clearly,
 * not measured.
 */

const SHELL_RADII: V3 = [0.036, 0.03, 0.033];
const WALL_OUT = 0.0013;
const WALL_THICK = 0.0045;

const outerRadii = (d: number): V3 => [SHELL_RADII[0] - d, SHELL_RADII[1] - d, SHELL_RADII[2] - d];
const NECK_Z = -0.004;

/** Points on the inner surface of the wall: the three corners of the trigone. */
const INNER = outerRadii(WALL_OUT + WALL_THICK);
const onInner = (x: number, z: number): V3 => {
  const t = 1 - (x / INNER[0]) ** 2 - (z / INNER[2]) ** 2;
  return [x, -INNER[1] * Math.sqrt(Math.max(0, t)), z];
};
const ORIFICE_L = onInner(-0.014, -0.016);
const ORIFICE_R = onInner(0.014, -0.016);
const NECK_OPENING = onInner(0, NECK_Z);

/** Outward normal of the inner ellipsoid at a point on it. */
function innerNormal(p: V3): V3 {
  const n: V3 = [p[0] / INNER[0] ** 2, p[1] / INNER[1] ** 2, p[2] / INNER[2] ** 2];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

/** The routes the detail module sends the two jets along, and the openings they leave. */
export function orificeJets(): { left: V3[]; right: V3[] } {
  const jet = (o: V3): V3[] => {
    const n = innerNormal(o);
    // Leaves along the inward normal, bent upward as it loses speed, then arcs back down.
    const a: V3 = [o[0] - n[0] * 0.0008, o[1] - n[1] * 0.0008, o[2] - n[2] * 0.0008];
    const b: V3 = [a[0] - n[0] * 0.006, a[1] - n[1] * 0.006 + 0.0015, a[2] - n[2] * 0.006];
    const c: V3 = [a[0] - n[0] * 0.011 - Math.sign(o[0]) * 0.0015, a[1] - n[1] * 0.011 + 0.0012, a[2] - n[2] * 0.011];
    return [a, b, c];
  };
  return { left: jet(ORIFICE_L), right: jet(ORIFICE_R) };
}

/** A small closed ring on the inner wall, round an orifice. */
function ring(o: V3): THREE.BufferGeometry {
  const n = innerNormal(o);
  const up = Math.abs(n[1]) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const nv = new THREE.Vector3(n[0], n[1], n[2]);
  const e1 = new THREE.Vector3().crossVectors(nv, up).normalize();
  const e2 = new THREE.Vector3().crossVectors(nv, e1).normalize();
  const pts: V3[] = [];
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const c = Math.cos(a) * 0.0024;
    const s = Math.sin(a) * 0.0024;
    // 0.0008 into the lumen so that the ring stands proud of the wall.
    pts.push([o[0] - n[0] * 0.0008 + e1.x * c + e2.x * s, o[1] - n[1] * 0.0008 + e1.y * c + e2.y * s, o[2] - n[2] * 0.0008 + e1.z * c + e2.z * s]);
  }
  return tubeAlong(pts, () => 0.0008, { tubular: 20, radial: 6, closed: true });
}

/** The prism, along the wall normal, whose cross-section is the trigone triangle. */
function trigonePrism(grow: number): Sdf {
  const corners = [ORIFICE_L, ORIFICE_R, NECK_OPENING];
  const centre: V3 = [(corners[0][0] + corners[1][0] + corners[2][0]) / 3, (corners[0][1] + corners[1][1] + corners[2][1]) / 3, (corners[0][2] + corners[1][2] + corners[2][2]) / 3];
  const n = innerNormal(centre);
  const planes: Sdf[] = [];
  for (let i = 0; i < 3; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 3];
    const ab: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let pn: V3 = [ab[1] * n[2] - ab[2] * n[1], ab[2] * n[0] - ab[0] * n[2], ab[0] * n[1] - ab[1] * n[0]];
    // Point the plane's normal toward the centroid, so the inside of the half-space is the triangle.
    const toC = (centre[0] - a[0]) * pn[0] + (centre[1] - a[1]) * pn[1] + (centre[2] - a[2]) * pn[2];
    if (toC < 0) pn = [-pn[0], -pn[1], -pn[2]];
    const l = Math.hypot(pn[0], pn[1], pn[2]) || 1;
    const u: V3 = [pn[0] / l, pn[1] / l, pn[2] / l];
    planes.push(halfSpace([a[0] - u[0] * grow, a[1] - u[1] * grow, a[2] - u[2] * grow], pn));
  }
  return intersect(intersect(planes[0], planes[1]), planes[2]);
}

export const parts: PartBuilder = () => {
  const out: { id: string; geometry: THREE.BufferGeometry }[] = [];

  // Detrusor: a thick shell of the body of the bladder and its apex, bored through at the neck.
  const outer = smoothUnion(
    0.005,
    ellipsoid([0, 0, 0], outerRadii(WALL_OUT)),
    capsule([0, 0.022, 0.02], [0, 0.036, 0.03], 0.0045, 0.001),
  );
  const innerField = ellipsoid([0, 0, 0], INNER);
  const wall = subtract(
    subtract(outer, innerField),
    capsule([0, -0.02, NECK_Z], [0, -0.05, NECK_Z], 0.0042),
  );
  out.push({
    id: 'detrusor',
    geometry: polygonise(wall, [-0.036, -0.036, -0.036], [0.036, 0.04, 0.036], { cell: 0.0028 }),
  });

  // Trigone: a smooth plaque on the inner face, bounded by the three openings.
  const eIn = (x: number, y: number, z: number): number => innerField(x, y, z);
  const band: Sdf = (x, y, z) => {
    const e = eIn(x, y, z);
    return Math.max(e - 0.0008, -0.0014 - e);
  };
  out.push({
    id: 'trigone',
    geometry: polygonise(intersect(band, trigonePrism(0.0006)), [-0.02, -0.03, -0.024], [0.02, -0.008, 0.002], { cell: 0.0009 }),
  });

  out.push({ id: 'ureteric_orifices', geometry: mergeParts([ring(ORIFICE_L), ring(ORIFICE_R)]) });

  // Internal sphincter: a ring of muscle round the bladder neck.
  out.push({
    id: 'internal_sphincter',
    geometry: polygonise(torus([0, -0.0315, NECK_Z], 0.0043, 0.0017, 1), [-0.008, -0.036, -0.012], [0.008, -0.027, 0.004], { cell: 0.0007 }),
  });

  // The first of the urethra, leaving the neck.
  out.push({
    id: 'urethra',
    geometry: tubeAlong(
      [
        [0, -0.0325, NECK_Z],
        [0, -0.038, NECK_Z],
        [0, -0.0435, NECK_Z],
      ],
      () => 0.0032,
      { tubular: 8, radial: 10 },
    ),
  });

  // Mucosa: the folded lining. Its thickness is raised by ridged noise to make rugae, and it
  // is cut away over the trigone, which stays smooth.
  const lining: Sdf = (x, y, z) => {
    const e = eIn(x, y, z);
    const h = 0.0018 + 0.0016 * ridged(x, y, z, 230);
    return Math.max(e - 0.0008, -h - e);
  };
  out.push({
    id: 'mucosa',
    geometry: polygonise(subtract(lining, trigonePrism(0.002)), [-0.034, -0.03, -0.034], [0.034, 0.03, 0.034], { cell: 0.0026 }),
  });
  return out;
};
