import * as THREE from 'three';
import type { PartBuilder } from '../parts';
import { chain, ellipsoid, intersect, mergeParts, polygonise, tubeAlong, type Sdf, type V3 } from '../sdf';
import { fbm } from '../noise';

/**
 * THE INSIDE OF THE VAGINA AND WHAT OF THE VULVA THE SHELL CONTAINS.
 *
 * The vagina is a fibromuscular tube running up and back from the vestibule to the cervix
 * of the uterus. Its wall has a muscular coat outside and a mucous lining inside, thrown
 * into transverse folds, the rugae, chiefly on the front and back walls; the cervix projects
 * into its upper end, and the recess round the cervix is the fornix, described as anterior,
 * posterior and lateral parts (GRAYS42, GH14). Below, the vestibule is the cleft
 * between the labia minora; the erectile tissue is the clitoris, with its glans, body and
 * two crura, and the two vestibular bulbs either side of the opening; the greater
 * vestibular glands lie at the back of the bulbs (GRAYS42).
 *
 * FRAME. The shell in models.ts is a canal, flattened from front to back (squeezed by 0.62
 * in z about its own axis), whose centreline runs (0, -2, 0) -> (0, -40, 12) -> (0, -72, 36)
 * mm, radii 9.5, 9, 8 mm, joined by a smooth union to the bulbs, the glans, the body and the
 * crura of the vulva. This file REPEATS that canal field so that the wall and the folds sit a
 * fixed distance inside the shell's own surface. If models.ts changes the canal, change it
 * here too.
 *
 * WHAT IS GLASS AND WHAT IS SOLID. The wall and the vestibule enclose the lumen and so are
 * drawn as glass by the detail module. The folds, the cervix, the os, the muscle cuff, the
 * erectile tissue and the glands are content and stay solid.
 *
 * FINER STRUCTURES (T2; src/data/anatomy/vagina.json `parent`). The four layers of the wall are
 * children of `vaginal_wall` and the prepuce and frenulum children of the clitoral glans. The
 * layers are four closed surfaces at fixed depths inside the wall's own surface (the shell's
 * canal field, repeated above); the depths are drawing proportions, not measured thicknesses. The
 * hymen, the vaginal and urethral orifices, the labia, the mons, the paraurethral glands, the
 * perineal body and the vaginal artery are new level-1 parts. The vulva's soft parts (labia
 * minora and majora, mons) are drawn as glass pads beside and in front of the vestibule at
 * display positions chosen to read, not traced, and they extend a little past the shell's box.
 * The orifices are drawn as rings; the hymen as a simple ring, because its real form varies.
 * NOT DRAWN. The levator ani, the bladder neck, the fat of the labia as separate tissue and the
 * nerve supply. The cervix is only its lower part, a dome hanging from the roof of the shell,
 * sized to read, and its os faces straight down for clarity.
 */

const CANAL_PTS: V3[] = [
  [0, -0.002, 0],
  [0, -0.04, 0.012],
  [0, -0.072, 0.036],
];
const canal = chain(CANAL_PTS, [0.0095, 0.009, 0.008]);
const axisZ = (y: number): number => (y > -0.04 ? ((-0.002 - y) / 0.038) * 0.012 : 0.012 + ((-0.04 - y) / 0.032) * 0.024);
/** Signed distance to the shell's canal: negative inside, in the flattened frame of the shell. */
const e: Sdf = (x, y, z) => {
  const az = axisZ(y);
  return canal(x, y, az + (z - az) / 0.62);
};

/** Depth of the glass wall's surface below the shell surface, metres. */
const WALL = 0.0022;

const scaledSphere = (c: V3, r: V3, seg: number): THREE.BufferGeometry => {
  const g = new THREE.SphereGeometry(1, seg, Math.max(6, Math.round(seg * 0.7)));
  g.scale(r[0], r[1], r[2]);
  g.translate(c[0], c[1], c[2]);
  return g;
};

/** Where each erectile structure is; shared with the detail module for its blood streams. */
export const BULB_CENTRE = (side: 1 | -1): V3 => [side * 0.0095, -0.078, 0.04];
export const GLANS_CENTRE: V3 = [0, -0.064, 0.058];
const JUNCTION: V3 = [0, -0.0585, 0.0462];

/** Arterial inflow to a bulb: along its long axis from below. */
export const bulbPath = (side: 1 | -1): V3[] => [
  [side * 0.0095, -0.0870, 0.0400],
  [side * 0.0098, -0.0800, 0.0402],
  [side * 0.0095, -0.0720, 0.0404],
];
/** Arterial inflow to the clitoris: out along a crus, then along the body to the glans. */
export const crusPath = (side: 1 | -1): V3[] => [
  [side * 0.0165, -0.0695, 0.0305],
  [side * 0.0080, -0.0640, 0.0380],
  JUNCTION,
  [0, -0.0595, 0.0500],
  [0, -0.0615, 0.0555],
];
/** Plasma crossing the wall into the lumen: short radial routes on each side. */
export const transudatePath = (side: 1 | -1): V3[] => {
  const y = -0.055;
  const az = axisZ(y);
  return [
    [side * 0.0078, y, az],
    [side * 0.0058, y, az],
    [side * 0.0030, y, az],
  ];
};

export const parts: PartBuilder = () => {
  const out: { id: string; geometry: THREE.BufferGeometry }[] = [];
  const LO: V3 = [-0.014, -0.083, -0.009];
  const HI: V3 = [0.014, 0.01, 0.05];

  // The muscular wall: one closed surface under the shell's own.
  out.push({ id: 'vaginal_wall', geometry: polygonise((x, y, z) => e(x, y, z) + WALL, LO, HI, { cell: 0.0015 }) });

  // The rugae: transverse ridges standing in from the wall, strongest on the front and back
  // walls and absent at the very top and bottom where the canal turns into the fornix and
  // the vestibule. Their height is a sine of height up the canal, broken by noise.
  const rugae: Sdf = (x, y, z) => {
    const d = e(x, y, z);
    const az = axisZ(y);
    const dz = z - az;
    const frontBack = Math.abs(dz) / (Math.hypot(x, dz) + 1e-6);
    const ridge = Math.max(0, Math.sin((y * Math.PI * 2) / 0.0046 + 2.4 * fbm(x, y, z, 260, 2)));
    const h = 0.0004 + 0.0022 * ridge * (0.25 + 0.75 * frontBack);
    const layer = Math.max(d + (WALL - 0.0004), -(d + WALL + h));
    return Math.max(layer, y + 0.012, -0.066 - y);
  };
  out.push({ id: 'rugae', geometry: polygonise(rugae, [-0.012, -0.068, -0.008], [0.012, -0.010, 0.036], { cell: 0.0013 }) });

  // The muscle cuff round the lower third, just outside the glass wall.
  const cuff = intersect(
    (x, y, z) => Math.max(e(x, y, z) + 0.0003, -(e(x, y, z) + 0.0018)),
    (_x, y) => Math.max(y + 0.05, -0.073 - y),
  );
  out.push({ id: 'lower_third_muscle', geometry: polygonise(cuff, [-0.013, -0.075, 0.008], [0.013, -0.048, 0.046], { cell: 0.0012 }) });

  // The cervix hanging from the roof, its external os, and the fornix ring round it.
  out.push({ id: 'cervix', geometry: scaledSphere([0, 0.0006, 0], [0.0034, 0.0048, 0.003], 24) });
  const osPts: V3[] = [];
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    osPts.push([0.0009 * Math.cos(a), -0.0042, 0.0009 * Math.sin(a)]);
  }
  out.push({ id: 'external_os', geometry: tubeAlong(osPts, () => 0.00035, { tubular: 24, radial: 6, closed: true }) });
  const fornixPts: V3[] = [];
  for (let k = 0; k < 20; k++) {
    const a = (k / 20) * Math.PI * 2;
    fornixPts.push([0.0064 * Math.cos(a), -0.0018, 0.0030 * Math.sin(a)]);
  }
  out.push({ id: 'fornices', geometry: tubeAlong(fornixPts, () => 0.0011, { tubular: 48, radial: 8, closed: true }) });

  // The vestibule: a shallow glass pocket over the lower end of the canal and the bulbs.
  out.push({ id: 'vestibule', geometry: scaledSphere([0, -0.0745, 0.0385], [0.01, 0.0045, 0.0035], 28) });

  // The erectile tissue.
  out.push({ id: 'clitoral_glans', geometry: scaledSphere(GLANS_CENTRE, [0.0028, 0.0028, 0.0028], 14) });
  out.push({
    id: 'clitoral_body',
    geometry: tubeAlong([[0, -0.0615, 0.0555], [0, -0.0595, 0.05], JUNCTION], () => 0.0019, { tubular: 12, radial: 8 }),
  });
  const crura = [1, -1].map((s) =>
    tubeAlong([JUNCTION, [s * 0.008, -0.064, 0.038], [s * 0.0165, -0.0695, 0.0305]], (t) => 0.0018 - 0.0005 * t, { tubular: 16, radial: 8 }),
  );
  out.push({ id: 'clitoral_crura', geometry: mergeParts(crura) });
  out.push({
    id: 'vestibular_bulbs',
    geometry: mergeParts([1, -1].map((s) => scaledSphere(BULB_CENTRE(s as 1 | -1), [0.0028, 0.01, 0.0046], 24))),
  });
  out.push({
    id: 'vestibular_glands',
    geometry: mergeParts([1, -1].map((s) => scaledSphere([s * 0.0095, -0.0855, 0.0405], [0.0016, 0.0016, 0.0016], 10))),
  });

  // THE FOUR LAYERS OF THE WALL, outermost first, as closed surfaces inside the wall's own surface
  // (which is WALL below the shell). Coarse cells because they are smooth and nearly parallel.
  const layer = (depth: number): THREE.BufferGeometry => polygonise((x, y, z) => e(x, y, z) + WALL - depth, LO, HI, { cell: 0.0022 });
  out.push({ id: 'vaginal_adventitia', geometry: layer(-0.0004) });
  out.push({ id: 'vaginal_muscularis', geometry: layer(0.0002) });
  out.push({ id: 'vaginal_lamina_propria', geometry: layer(0.0007) });
  out.push({ id: 'vaginal_epithelium', geometry: layer(0.0011) });

  // The clitoral prepuce: the upper half of a slightly larger shell round the glans.
  const gl = GLANS_CENTRE;
  const hood = intersect(ellipsoid([gl[0], gl[1] + 0.0004, gl[2]], [0.0038, 0.0034, 0.0038]), (_x, y) => gl[1] + 0.0003 - y);
  out.push({ id: 'clitoral_prepuce', geometry: polygonise(hood, [gl[0] - 0.005, gl[1] - 0.0005, gl[2] - 0.005], [gl[0] + 0.005, gl[1] + 0.005, gl[2] + 0.005], { cell: 0.0004 }) });
  out.push({
    id: 'clitoral_frenulum',
    geometry: mergeParts(
      [1, -1].map((s) => tubeAlong([[0, gl[1] - 0.0022, gl[2] - 0.0006], [s * 0.0016, gl[1] - 0.0048, gl[2] - 0.0028], [s * 0.0024, gl[1] - 0.0068, gl[2] - 0.0052]], (t) => 0.0004 - 0.00012 * t, { tubular: 10, radial: 4 })),
    ),
  });

  // THE VULVA'S OTHER PARTS: rings, folds, pads, glands and the artery of the wall.
  const ringTilted = (c: V3, ax: number, az: number, r: number): V3[] => {
    // A ring in the plane of the vaginal opening: x across, and (0, 0.6, 0.8) up and forward.
    const pts: V3[] = [];
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      pts.push([c[0] + ax * Math.cos(a), c[1] + 0.6 * az * Math.sin(a), c[2] + 0.8 * az * Math.sin(a)]);
    }
    void r;
    return pts;
  };
  out.push({ id: 'hymen', geometry: tubeAlong(ringTilted([0, -0.0715, 0.0355], 0.0066, 0.0046, 0), () => 0.0006, { tubular: 32, radial: 6, closed: true }) });
  out.push({ id: 'vaginal_orifice', geometry: tubeAlong(ringTilted([0, -0.0748, 0.0372], 0.0072, 0.005, 0), () => 0.0004, { tubular: 32, radial: 5, closed: true }) });
  out.push({ id: 'external_urethral_orifice', geometry: scaledSphere([0, -0.0725, 0.0418], [0.0009, 0.0009, 0.0007], 8) });
  out.push({ id: 'labia_minora', geometry: mergeParts([1, -1].map((s) => scaledSphere([s * 0.0125, -0.0755, 0.0415], [0.001, 0.012, 0.0052], 14))) });
  out.push({ id: 'labia_majora', geometry: mergeParts([1, -1].map((s) => scaledSphere([s * 0.019, -0.0735, 0.0415], [0.0035, 0.016, 0.0065], 14))) });
  out.push({ id: 'mons_pubis', geometry: scaledSphere([0, -0.048, 0.0555], [0.016, 0.0075, 0.0065], 16) });
  out.push({ id: 'paraurethral_glands', geometry: mergeParts([1, -1].map((s) => scaledSphere([s * 0.0035, -0.0722, 0.0405], [0.0007, 0.0009, 0.0007], 8))) });
  out.push({ id: 'perineal_body', geometry: scaledSphere([0, -0.0795, 0.0305], [0.0055, 0.0045, 0.004], 14) });
  const arteries: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    const pts: V3[] = [-0.062, -0.05, -0.038, -0.026, -0.014].map((y) => [s * 0.008, y, axisZ(y)] as V3);
    arteries.push(tubeAlong(pts, () => 0.0006, { tubular: 24, radial: 5 }));
  }
  out.push({ id: 'vaginal_artery', geometry: mergeParts(arteries) });
  return out;
};
