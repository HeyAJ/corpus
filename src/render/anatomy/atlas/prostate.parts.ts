import * as THREE from 'three';
import type { PartBuilder } from '../parts';
import { capsule, chain, ellipsoid, halfSpace, intersect, mergeParts, polygonise, subtract, tubeAlong, union, type Sdf, type V3 } from '../sdf';

/**
 * THE INSIDE OF THE PROSTATE AND SEMINAL VESICLES.
 *
 * The prostate is a chestnut-sized gland that surrounds the first part of the urethra just
 * below the bladder. It is described in zones: the PERIPHERAL zone, the largest, makes up the
 * back and sides of the gland; the CENTRAL zone is a wedge at the base that is pierced by the
 * two ejaculatory ducts; the TRANSITION zone is two small lobes lying against the urethra
 * itself. In front lies a band of fibromuscular tissue with no glands. The two ejaculatory
 * ducts, each formed where the duct of a seminal vesicle meets the end of a vas deferens,
 * run forward and down through the central zone and open on the back wall of the urethra on
 * a small mound, the seminal colliculus. Each seminal vesicle is a folded, coiled tube lying
 * behind the bladder, and the dilated end of each vas deferens, the ampulla, lies against it
 * (GRAYS42, GH14).
 *
 * FRAME. The frame of the shell in models.ts: origin at the centre of the gland, +x the
 * patient's right, +y cranial, +z anterior. The shell is an oval of radii 20, 15 and 14 mm,
 * with two seminal vesicles and two ampullae joined to it, so all of these are in this atlas.
 * The capsule here is 1.5 mm inside the oval, the zones fill it, and the vesicles and
 * ampullae are drawn thinner than their shell tubes so that they sit well within them.
 *
 * WHAT WAS DONE FOR THE EYE. The zone boundaries are smooth ovals chosen to give each zone
 * its usual place and relative size, not traced boundaries; the anterior fibromuscular
 * stroma is not drawn, so the front of the gland is left empty and the capsule alone marks
 * it. The urethra is drawn as a gently curved tube, and the vesicle's folding is shown as a
 * single coil, since the real tube is several times longer than the vesicle.
 *
 * NOT DRAWN. The gland's ducts and acini, the smooth muscle of the stroma, the nerves of the
 * neurovascular bundles, the venous plexus around the capsule and the external sphincter.
 */

const G: V3 = [0.0185, 0.0135, 0.0125];

/** The prostatic urethra: a gently curved tube through the gland, top to bottom. */
export const URETHRA: V3[] = [
  [0, 0.0128, 0.002],
  [0, 0.004, 0.003],
  [0, -0.004, 0.004],
  [0, -0.0128, 0.002],
];
const URETHRA_R = 0.0017;

/** Where the ejaculatory ducts open on the back wall of the urethra. */
const COLLICULUS: V3 = [0, -0.0015, 0.0021];

/** One ampulla of the vas deferens, from the top toward the gland, patient-side `s`. */
export function ampullaPath(s: number): V3[] {
  return [
    [s * 0.0115, 0.033, -0.0195],
    [s * 0.0075, 0.022, -0.0155],
    [s * 0.0045, 0.0115, -0.0112],
  ];
}

/** One ejaculatory duct, from the base of the gland to the colliculus. */
export function ductPath(s: number): V3[] {
  return [
    [s * 0.0045, 0.0115, -0.0112],
    [s * 0.0045, 0.0075, -0.0075],
    [s * 0.003, 0.002, -0.0035],
    [s * 0.0012, -0.0013, 0.0015],
  ];
}

/** The route of an emission: ampulla, ejaculatory duct, then on down the urethra. */
export function emissionPath(s: number): V3[] {
  return [...ampullaPath(s), ...ductPath(s).slice(1), [0, -0.0055, 0.0038], [0, -0.0128, 0.002]];
}

/** The coiled lumen of a seminal vesicle, from its blind tip to its base. */
function vesicleCoil(s: number): V3[] {
  const a = new THREE.Vector3(s * 0.03, 0.03, -0.024);
  const b = new THREE.Vector3(s * 0.006, 0.014, -0.014);
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  const e1 = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 0, 1)).normalize();
  const e2 = new THREE.Vector3().crossVectors(dir, e1).normalize();
  const pts: V3[] = [];
  const n = 36;
  const p = new THREE.Vector3();
  for (let j = 0; j <= n; j++) {
    const u = j / n;
    const amp = 0.0017 * Math.sin(Math.PI * Math.min(1, 0.15 + u * 1.2)) * 0.9 + 0.0003;
    const ph = 2 * Math.PI * 4 * u;
    p.copy(a).lerp(b, 0.03 + 0.94 * u);
    pts.push([p.x + (e1.x * Math.sin(ph) + e2.x * Math.cos(ph)) * amp, p.y + (e1.y * Math.sin(ph) + e2.y * Math.cos(ph)) * amp, p.z + (e1.z * Math.sin(ph) + e2.z * Math.cos(ph)) * amp]);
  }
  return pts;
}

export const parts: PartBuilder = () => {
  const gland = ellipsoid([0, 0, 0], G);
  const bore: Sdf = chain(URETHRA, URETHRA_R + 0.0004);

  const central = subtract(intersect(gland, ellipsoid([0, 0.0055, -0.0042], [0.0105, 0.0058, 0.0058])), bore);
  const transition = subtract(
    subtract(intersect(gland, union(ellipsoid([0.0055, 0, 0.0035], [0.0048, 0.0075, 0.005]), ellipsoid([-0.0055, 0, 0.0035], [0.0048, 0.0075, 0.005]))), bore),
    central,
  );
  const wholePosterior = intersect(gland, halfSpace([0, 0, 0.004], [0, 0, -1]));
  const peripheral = subtract(subtract(subtract(wholePosterior, central), transition), bore);

  const lo: V3 = [-0.02, -0.0145, -0.0135];
  const hi: V3 = [0.02, 0.0145, 0.0135];

  const out: { id: string; geometry: THREE.BufferGeometry }[] = [];
  out.push({ id: 'prostatic_capsule', geometry: polygonise(gland, lo, hi, { cell: 0.0012 }) });
  out.push({ id: 'peripheral_zone', geometry: polygonise(peripheral, lo, hi, { cell: 0.0014 }) });
  out.push({ id: 'central_zone', geometry: polygonise(central, lo, hi, { cell: 0.0012 }) });
  out.push({ id: 'transition_zone', geometry: polygonise(transition, lo, hi, { cell: 0.0012 }) });
  out.push({ id: 'prostatic_urethra', geometry: tubeAlong(URETHRA, () => URETHRA_R, { tubular: 24, radial: 10 }) });

  // The seminal colliculus: a small mound on the back wall of the urethra.
  out.push({ id: 'seminal_colliculus', geometry: polygonise(ellipsoid(COLLICULUS, [0.0012, 0.0016, 0.001]), [-0.003, -0.004, 0], [0.003, 0.001, 0.004], { cell: 0.0004 }) });

  out.push({
    id: 'ejaculatory_ducts',
    geometry: mergeParts([1, -1].map((s) => tubeAlong(ductPath(s), () => 0.0006, { tubular: 28, radial: 6 }))),
  });

  // Seminal vesicles: glass sacs, 1.2 mm inside the shell's own, each holding a coiled lumen.
  const vesicle = (s: number): Sdf => capsule([s * 0.006, 0.014, -0.014], [s * 0.03, 0.03, -0.024], 0.0042, 0.005);
  out.push({
    id: 'seminal_vesicles',
    geometry: polygonise(union(vesicle(1), vesicle(-1)), [-0.036, 0.009, -0.03], [0.036, 0.036, -0.0178], { cell: 0.0015 }),
  });
  out.push({
    id: 'vesicle_lumen',
    geometry: mergeParts([1, -1].map((s) => tubeAlong(vesicleCoil(s), () => 0.0007, { tubular: 80, radial: 5 }))),
  });
  out.push({
    id: 'ampullae',
    geometry: mergeParts([1, -1].map((s) => tubeAlong(ampullaPath(s), () => 0.0016, { tubular: 24, radial: 8 }))),
  });
  return out;
};
