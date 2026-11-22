import * as THREE from 'three';
import type { PartBuilder } from '../parts';
import { mulberry32 } from '../noise';
import { ovals } from './kidney.parts';
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
 * stroma was once left undrawn (the front of the gland was empty and the capsule alone
 * marked it) and is now a glass slab across the front. The urethra is drawn as a gently curved tube, and the vesicle's folding is shown as a
 * single coil, since the real tube is several times longer than the vesicle.
 *
 * FINER STRUCTURES (bottom of `parts`). The anterior stroma, utricle, sinus, ducts, neurovascular
 * bundles, bulbourethral glands and the glandular tissue are level-1; the acini and corpora
 * amylacea are its children. Lobules, acini and amylacea are scattered by a seeded generator
 * inside the peripheral zone; their number and size are illustrative.
 *
 * NOT DRAWN. The smooth muscle of the stroma, the nerves inside the
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
  /* ====================================================== FINER STRUCTURES ===== */
  // Level-1 gaps and the glands' children (src/data/anatomy/prostate.json). Schematic.

  // Anterior fibromuscular stroma: the gland-free band across the front, a glass slab of the
  // gland's own oval in front of a plane, with the urethra's bore left open.
  const front = subtract(intersect(ellipsoid([0, 0, 0], [G[0] * 0.97, G[1] * 0.97, G[2] * 0.97]), halfSpace([0, 0, 0.0072], [0, 0, 1])), bore);
  out.push({ id: 'anterior_fibromuscular_stroma', geometry: polygonise(front, [-0.02, -0.0145, 0.0065], [0.02, 0.0145, 0.0135], { cell: 0.0013 }) });

  // The utricle: a blind pouch running up and back from the colliculus between the two
  // ejaculatory ducts.
  out.push({ id: 'prostatic_utricle', geometry: tubeAlong([[0, -0.0013, 0.0016], [0, 0.0012, 0.0002], [0, 0.0038, -0.0021]], (t) => 0.0006 - 0.0002 * t, { tubular: 10, radial: 6 }) });

  // Prostatic sinus: the groove either side of the colliculus, as a thin strand on the wall.
  out.push({ id: 'prostatic_sinus', geometry: mergeParts([1, -1].map((s) => tubeAlong([[s * 0.0019, 0.0022, 0.0021], [s * 0.0021, -0.0015, 0.0023], [s * 0.0019, -0.0058, 0.0027]], () => 0.00042, { tubular: 14, radial: 5 }))) });

  // Ducts: a few fine channels from the sinus out into the peripheral zone.
  const ducts: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    [0.0012, -0.0012, -0.0036, -0.006].forEach((y, k) => {
      ducts.push(tubeAlong([[s * 0.0019, y, 0.0024], [s * (0.0045 + 0.0008 * k), y - 0.0012, -0.0006], [s * (0.0085 + 0.001 * k), y - 0.0024, -0.0042]], () => 0.00035, { tubular: 8, radial: 4 }));
    });
  }
  out.push({ id: 'prostatic_ducts', geometry: mergeParts(ducts) });

  // Neurovascular bundles: one tube each side, on the back-and-side of the capsule, 5 % outside it.
  const bundle = (s: number): V3[] =>
    [0.0105, 0.005, -0.0005, -0.006, -0.0105].map((y) => {
      const r = Math.sqrt(Math.max(0, 1 - (y / G[1]) ** 2));
      return [s * G[0] * r * 0.75 * 1.06, y, -G[2] * r * 0.66 * 1.06] as V3;
    });
  out.push({ id: 'neurovascular_bundles', geometry: mergeParts([1, -1].map((s) => tubeAlong(bundle(s), () => 0.0008, { tubular: 16, radial: 6 }))) });

  // Bulbourethral glands: a small oval each side below the gland, a thin duct to the urethra.
  const cowper: { c: V3; r: V3 }[] = [];
  const cowperDucts: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    cowper.push({ c: [s * 0.0085, -0.0245, -0.001], r: [0.0034, 0.003, 0.003] });
    cowperDucts.push(tubeAlong([[s * 0.0075, -0.0235, -0.0005], [s * 0.0035, -0.0215, 0.0012], [0, -0.0195, 0.0025]], () => 0.00035, { tubular: 8, radial: 4 }));
  }
  out.push({ id: 'bulbourethral_glands', geometry: mergeParts([ovals(cowper), ...cowperDucts]) });

  // Glandular tissue: lobules scattered through the peripheral zone by a seeded generator, each
  // with a few acini (small spheres) round it. The count is a drawing choice.
  const rnd = mulberry32(0x9057);
  const lobules: V3[] = [];
  for (let tries = 0; tries < 4000 && lobules.length < 30; tries++) {
    const p: V3 = [(rnd() * 2 - 1) * G[0], (rnd() * 2 - 1) * G[1], -rnd() * G[2]];
    if (peripheral(p[0], p[1], p[2]) > -0.0017) continue;
    if (lobules.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < 0.0032)) continue;
    lobules.push(p);
  }
  out.push({ id: 'prostatic_glands', geometry: ovals(lobules.map((c) => ({ c, r: [0.0012, 0.0012, 0.0012] as V3 }))) });
  const acini: { c: V3; r: V3 }[] = [];
  lobules.forEach((c, i) => {
    for (let k = 0; k < 3; k++) {
      const a = i * 1.7 + (k * Math.PI * 2) / 3;
      acini.push({ c: [c[0] + 0.0011 * Math.cos(a), c[1] + 0.0011 * Math.sin(a), c[2] + 0.0005 * Math.cos(2 * a)], r: [0.0004, 0.0004, 0.0004] });
    }
  });
  out.push({ id: 'secretory_acini', geometry: ovals(acini) });
  out.push({ id: 'corpora_amylacea', geometry: ovals(lobules.slice(0, 9).map((c, i) => ({ c: [c[0], c[1], c[2] + 0.0002 * (i % 2)] as V3, r: [0.00045, 0.00045, 0.00045] as V3 }))) });
  return out;
};
