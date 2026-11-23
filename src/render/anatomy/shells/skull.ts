import * as THREE from 'three';
import {
  capsule,
  ellipsoid,
  intersect,
  mergeParts,
  mirroredX,
  offset,
  polygonise,
  roundBox,
  smoothUnion,
  subtract,
  union,
  type Sdf,
  type V3,
} from '../sdf';

/**
 * SKULL, SHELL (and the signed-distance fields its atlas is cut from).
 *
 * A LAYER organ (organs.json `layer: "bones"`): built only while the bones layer is on or the
 * skull is selected, never at load. FRAME: the BRAIN's own frame (origin organs.json [0, 0.42, 0],
 * cranial group, rigid lift), +x the patient's right, +y cranial, +z anterior. Every number
 * below is a drawing choice fitted to the neighbouring shells (brain, eyes, nasal cavity, mouth,
 * ears), none is a measurement of a skull.
 *
 * WHAT WENT WRONG IN THE STUB. It was an ellipsoid of the brain's bounding box, so a brain
 * lobe at the base poked out of it (the brain's floor is at -0.093 beside the foramen magnum
 * and the ellipsoid ended at -0.062), and nothing had an orbit or a nose, so the eyes sat in a
 * solid block. The skull is now a HOLLOW bone: the outer surface minus the cranial cavity,
 * the orbits, the nasal aperture, the foramen magnum and the ear canals.
 *
 * THE CRANIAL CAVITY IS CUT TO THE BRAIN, NOT TO A BOX. A rounded box gives the roof, the
 * sides, the front and the back, and the FLOOR is a table of heights (FLOOR_MM below) fitted
 * to the lower surface of the brain shell: the lowest brain vertex within 7.5 mm of each
 * (x, z) cell, taken as a minimum so it is never above the brain, blurred, kept under the
 * unblurred minimum and lowered 3 mm. That is what gives the stepped base a skull has (the
 * anterior fossa high, the middle lower, the posterior lowest, a funnel to the foramen
 * magnum) and guarantees the brain sits inside, which the probe in the atlas notes checks
 * by evaluating the field at every brain vertex. If the brain shell is redrawn, regenerate
 * the table (the generator is described in the atlas file's header) and re-run that probe.
 *
 * KNOWN CONFLICT IN THE NEIGHBOURING SHELLS, NOT FIXED HERE. The brain shell reaches 4.7 mm
 * into the upper part of each eyeball and the ears atlas puts the inner ear inside the
 * brain's temporal lobe (the brain's lowest surface there is 41 mm below its origin, the
 * cochlea is 36 to 43). A true skull has bone between them (the orbital roof, the petrous
 * ridge). Here the cavity is cut to the brain, so the bone wall hugs the brain and the globe
 * and the inner ear poke through it by those few millimetres. The external canal is therefore
 * a dimple ending 1 mm short of the cranial cavity rather than a tube to the drum.
 *
 * Exported for the atlas (atlas/skull.parts.ts), which cuts this one bone field into the
 * individual bones: shapes, not geometry, are shared, so each caller polygonises at its own
 * resolution.
 */

/** Wall thickness of the vault. A display choice (about the thickness a plain drawing gives). */
export const SKULL_WALL = 0.0065;

/** Cell size, metres, of the merged shell. Coarse: the bones are seen through absorbing bone tint. */
const SHELL_CELL = 0.0074;

/**
 * Brain floor height by (x, z), millimetres: row i is |x| = i x 7.5 mm, column j is
 * z = -97.5 + j x 7.5 mm. Derived once from the brain shell (see the header).
 */
const FLOOR_MM: readonly (readonly number[])[] = [
  [-49.4, -49.4, -49.4, -60.0, -63.5, -64.8, -68.1, -73.3, -93.6, -95.9, -95.9, -94.2, -77.7, -62.3, -57.0, -43.1, -37.4, -33.7, -32.4, -28.7, -25.4, -20.6, -15.9, -13.1],
  [-49.4, -49.4, -49.4, -59.6, -63.3, -64.7, -68.0, -72.4, -90.2, -95.6, -95.9, -92.1, -73.2, -60.9, -56.7, -43.0, -37.8, -34.5, -32.6, -30.2, -27.6, -23.9, -18.8, -15.0],
  [-21.6, -26.1, -35.3, -55.0, -63.6, -66.4, -67.7, -69.8, -73.0, -75.0, -76.6, -69.9, -63.2, -58.4, -52.3, -43.0, -39.3, -36.9, -35.5, -34.4, -32.5, -29.7, -25.6, -19.4],
  [-10.9, -17.1, -29.4, -59.6, -64.1, -66.6, -68.0, -68.1, -68.9, -68.6, -66.4, -61.9, -56.2, -51.0, -46.9, -43.8, -41.6, -40.5, -39.9, -38.9, -35.8, -33.0, -27.8, -23.4],
  [-3.0, -10.2, -25.1, -59.6, -64.1, -66.6, -68.0, -68.0, -67.1, -66.6, -62.4, -56.8, -51.9, -48.5, -46.6, -46.5, -45.5, -44.2, -43.0, -41.7, -39.0, -35.1, -28.3, -25.7],
  [0.7, -6.5, -21.8, -56.2, -63.7, -66.4, -67.8, -67.8, -66.4, -66.0, -61.9, -56.2, -50.1, -47.8, -47.8, -47.8, -46.7, -46.7, -45.1, -43.2, -40.8, -35.9, -29.7, -25.5],
  [2.8, -3.2, -16.5, -53.4, -60.3, -64.3, -66.8, -66.6, -65.3, -63.3, -60.1, -51.9, -48.9, -47.8, -47.8, -47.8, -47.0, -47.0, -46.0, -44.0, -40.8, -37.2, -29.5, -22.7],
  [1.6, -1.2, -10.7, -25.8, -56.4, -60.9, -62.0, -63.3, -63.3, -60.5, -52.8, -47.9, -47.0, -47.6, -47.6, -47.1, -47.0, -46.9, -46.0, -43.7, -39.6, -35.9, -22.2, -17.7],
  [1.6, -0.7, -6.7, -17.8, -29.2, -52.8, -55.4, -56.9, -56.2, -46.6, -42.7, -43.0, -44.7, -46.0, -46.6, -46.4, -46.0, -45.6, -43.2, -39.2, -36.0, -25.6, -15.4, -12.3],
  [1.0, -0.9, -5.0, -12.9, -20.3, -52.8, -27.1, -27.4, -28.0, -31.2, -35.0, -38.2, -40.6, -41.9, -42.5, -42.5, -41.8, -40.1, -35.8, -29.6, -21.7, -25.6, -10.4, -8.6],
  [0.7, -1.2, -12.0, -12.0, -16.1, -19.9, -19.0, -19.1, -20.6, -25.6, -32.4, -36.3, -39.2, -40.8, -41.4, -41.4, -40.6, -39.3, -35.8, -29.0, -17.9, -12.4, -8.0, -7.1],
];
const FLOOR_STEP = 0.0075;
const FLOOR_Z0 = -0.0975;

/** Floor height at (x, z): bilinear in the table, clamped at its edges. */
function floorAt(x: number, z: number): number {
  const fx = Math.min(FLOOR_MM.length - 1, Math.abs(x) / FLOOR_STEP);
  const fz = Math.max(0, Math.min(FLOOR_MM[0].length - 1, (z - FLOOR_Z0) / FLOOR_STEP));
  const i = Math.min(FLOOR_MM.length - 2, Math.floor(fx));
  const j = Math.min(FLOOR_MM[0].length - 2, Math.floor(fz));
  const tx = fx - i;
  const tz = fz - j;
  const a = FLOOR_MM[i][j] * (1 - tz) + FLOOR_MM[i][j + 1] * tz;
  const b = FLOOR_MM[i + 1][j] * (1 - tz) + FLOOR_MM[i + 1][j + 1] * tz;
  return (a * (1 - tx) + b * tx) * 0.001;
}

/** Where the skull's named landmarks are, local frame. Shared with the atlas so parts agree with the shell. */
export const SKULL_LANDMARKS = {
  /** Eye globe centres, from the eyes shell: x = +-0.031, y -0.034, z 0.062. */
  globe: [0.031, -0.034, 0.062] as V3,
  /** Orbit rim centre and apex (right side; x is mirrored). */
  orbitRim: [0.031, -0.034, 0.088] as V3,
  orbitApex: [0.013, -0.032, 0.024] as V3,
  /** Foramen magnum axis: the cord's centreline at the skull base (paths.ts) is z = -0.026. */
  foramenMagnum: [0, -0.1, -0.026] as V3,
  /** The pituitary's own bounding box centre, brain atlas: x 0, y -0.030..-0.014, z 0.005..0.014. */
  sella: [0, -0.0262, 0.0095] as V3,
  /** Right-hand external acoustic meatus: lateral opening and inner end (ears atlas puts the meatus at y -0.035, z -0.011). */
  meatusOuter: [0.082, -0.035, -0.011] as V3,
  meatusInner: [0.0725, -0.035, -0.011] as V3,
  /** The jaw joint (right side): condyle head, and the fossa on the temporal bone above it. */
  condyle: [0.0605, -0.0585, -0.0155] as V3,
  fossa: [0.0605, -0.0505, -0.0125] as V3,
  /** Mouth: lower and upper alveolar ridges, from the mouth atlas's teeth (y -0.107..-0.093). */
  mandibleRidgeY: -0.1065,
  maxillaRidgeY: -0.0925,
};

/** A superellipsoid: exponent 2 is an ellipsoid, larger is boxier. Approximate distance (scaled by the smallest radius). */
function superEllipsoid(c: V3, r: V3, p: number): Sdf {
  const minR = Math.min(r[0], r[1], r[2]);
  return (x, y, z) => {
    const a = Math.abs((x - c[0]) / r[0]);
    const b = Math.abs((y - c[1]) / r[1]);
    const d = Math.abs((z - c[2]) / r[2]);
    return (Math.pow(Math.pow(a, p) + Math.pow(b, p) + Math.pow(d, p), 1 / p) - 1) * minR;
  };
}

/**
 * The centreline of the two dental arches (half arches are mirrored). The mouth atlas puts
 * the teeth at x = +-0.020 for the molars, +-0.016 the premolars, +-0.010 the canines and
 * +-0.007 the incisors, z 0.036 to 0.062, so the arches run through those places.
 */
const UPPER_ARCH_PTS: V3[] = [
  [-0.0195, -0.0885, 0.034],
  [-0.0185, -0.0885, 0.0445],
  [-0.0145, -0.0885, 0.0545],
  [-0.0085, -0.0885, 0.0605],
  [0, -0.0885, 0.0635],
  [0.0085, -0.0885, 0.0605],
  [0.0145, -0.0885, 0.0545],
  [0.0185, -0.0885, 0.0445],
  [0.0195, -0.0885, 0.034],
  [0.021, -0.0885, 0.02],
];

/**
 * Tooth sockets, right side as (x, z), one per tooth: two incisors, a canine, two premolars
 * and three molars, which is Gray's eight a side, put under the corresponding teeth of the
 * mouth atlas. The same positions serve the upper and the lower jaw.
 */
export const TOOTH_SOCKETS: readonly (readonly [number, number])[] = [
  [0.003, 0.0625],
  [0.0075, 0.0603],
  [0.0112, 0.0578],
  [0.0142, 0.0548],
  [0.0165, 0.0512],
  [0.0185, 0.0462],
  [0.0193, 0.0412],
  [0.0195, 0.0365],
];

/** The sockets of the upper jaw cut into the bottom of the maxillary arch, or of the lower into the top of the mandible. */
export function toothSockets(upper: boolean): Sdf {
  const y = upper ? SKULL_LANDMARKS.maxillaRidgeY - 0.0004 : SKULL_LANDMARKS.mandibleRidgeY + 0.0004;
  const sockets = TOOTH_SOCKETS.map(([x, z]) => ellipsoid([x, y, z], [0.0026, 0.0045, 0.0026]));
  return mirroredX(union(...sockets));
}

/** A tube of constant radius along straight segments, with the vertical axis squashed (a flat bar). */
function bar(points: readonly V3[], radius: number, flatten: number): Sdf {
  const segs: Sdf[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    segs.push(capsule([a[0], a[1] * flatten, a[2]], [b[0], b[1] * flatten, b[2]], radius));
  }
  const u = union(...segs);
  return (x, y, z) => u(x, y * flatten, z);
}

/** The cranial cavity: the space the brain sits in. */
export function cranialCavity(): Sdf {
  // Exponent 3 and these radii are the smallest superellipsoid that holds every vertex of the
  // brain above its floor with a margin of 2 to 3 per cent of the radius (found by a search
  // over the exponent, see the atlas notes): a rounded box of the same size left the top
  // corners 8 mm clear of the brain and read as a box from the front.
  const vault = superEllipsoid([0, -0.003, -0.002], [0.0725, 0.0628, 0.0885], 3);
  // The brainstem runs down below the vault's flat bottom to the foramen magnum, so the cavity
  // has a funnel there; the floor table already follows the brainstem, this lets the box reach.
  const funnel = capsule([0, -0.05, -0.012], [0, -0.1, -0.026], 0.02, 0.0135);
  // Below the equator the brain's lobes hang lower and wider than the superellipsoid
  // (the cerebellum's corners were 4 mm outside it), so the lower half also has the old
  // rounded box, and the floor table trims what is not needed.
  const lower = intersect(roundBox([0, -0.003, -0.002], [0.0715, 0.0625, 0.0865], 0.04), (_x, y) => y + 0.015);
  const space = union(vault, lower, funnel);
  return (x, y, z) => Math.max(space(x, y, z), floorAt(x, z) - 0.002 - y);
}

/** The two orbits: cones from the rim back to the optic canal. */
export function orbitCavity(grow = 0.0015): Sdf {
  const [rx, ry, rz] = SKULL_LANDMARKS.orbitRim;
  const [ax, ay, az] = SKULL_LANDMARKS.orbitApex;
  // Two cones, because the eyeball sits in the front half of the socket and the socket
  // narrows only behind it: the first draft ran one cone from rim to apex and left the
  // eye's lateral side 8 mm outside it. The first is parallel to the eye's axis down to the
  // back of the globe, the second narrows to the optic canal.
  const back: V3 = [rx, ry, 0.05];
  return mirroredX(
    union(
      capsule([rx, ry, rz + 0.01], back, 0.0195 + grow, 0.0152 + grow),
      capsule(back, [ax, ay, az], 0.0152 + grow, 0.006 + grow),
    ),
  );
}

/** The nasal passages, a pair of chambers with a median bony septum between them. */
export function nasalPassage(): Sdf {
  return mirroredX(ellipsoid([0.0105, -0.068, 0.052], [0.0088, 0.0225, 0.0365]));
}

/** The maxillary sinuses, hollow inside the maxilla (the nasal atlas owns the sinus itself; this is its bony wall). */
export function maxillarySinus(): Sdf {
  return mirroredX(ellipsoid([0.028, -0.08, 0.048], [0.0105, 0.0105, 0.0135]));
}

/** Everything that is bone, other than the mandible and the hyoid, before it is hollowed. */
export function outerEnvelope(): Sdf {
  const cavity = cranialCavity();
  // The vault's OUTSIDE is rounder than its inside. The cavity is cut to a boxy brain, and a
  // wall that is a constant offset of it read as a rounded box from the front (the first
  // draft). The outer surface is a superellipsoid (exponent 2.1, close to an ellipsoid's 2,
  // where the brain's own is near 3), which keeps a thin wall at the brain's top corners and a
  // thick one at the sides, and a floor wall that follows the stepped base below it.
  const vaultOuter = superEllipsoid([0, -0.003, -0.002], [0.0775, 0.0685, 0.0925], 2.1);
  const thinWall = offset(cavity, 0.0032);
  const floorWall = intersect(offset(cavity, SKULL_WALL), (_x, y) => y + 0.035);
  const wall = union(vaultOuter, thinWall, floorWall);
  const [gx, gy] = SKULL_LANDMARKS.globe;
  const face = union(
    ellipsoid([0, -0.03, 0.058], [0.052, 0.021, 0.027]), // brow, nasal root and the rims of the orbits
    mirroredX(ellipsoid([0.022, -0.067, 0.045], [0.027, 0.0265, 0.034])), // maxillary body (cheek)
    ellipsoid([0, -0.056, 0.074], [0.011, 0.02, 0.013]), // nasal bridge and the front of the nose
    bar(UPPER_ARCH_PTS, 0.0048, 0.85), // the alveolar arch of the maxilla
    ellipsoid([0, -0.0915, 0.04], [0.0185, 0.0034, 0.026]), // the hard palate: the floor of the nose and the roof of the mouth
    mirroredX(ellipsoid([gx + 0.016, gy - 0.014, 0.055], [0.012, 0.0125, 0.0135])), // zygomatic body (cheekbone)
    mirroredX(capsule([0.0585, -0.045, 0.043], [0.0665, -0.0425, 0.01], 0.0042)), // zygomatic arch, front
    mirroredX(capsule([0.0665, -0.0425, 0.01], [0.0645, -0.0405, -0.012], 0.0042)), // zygomatic arch, back
    mirroredX(ellipsoid([0.06, -0.058, -0.03], [0.0095, 0.0145, 0.011])), // mastoid process
    mirroredX(capsule([0.049, -0.06, -0.0125], [0.044, -0.084, 0.001], 0.0023)), // styloid process
    mirroredX(capsule([0.0165, -0.06, 0.022], [0.0185, -0.0865, 0.029], 0.0042)), // pterygoid process
    ellipsoid([0, -0.068, -0.0815], [0.016, 0.0125, 0.0105]), // external occipital protuberance and the nuchal ridge
    mirroredX(ellipsoid([0.0105, -0.0845, -0.0245], [0.009, 0.0065, 0.0125])), // occipital condyle
    ellipsoid([0, -0.058, -0.01], [0.017, 0.019, 0.04]), // the clivus and the basilar part
  );
  return smoothUnion(0.003, wall, face);
}

/** The foramen magnum: a vertical hole through the skull base along the cord's centreline. */
function foramenMagnumHole(): Sdf {
  const [x, y, z] = SKULL_LANDMARKS.foramenMagnum;
  return capsule([x, y + 0.04, z], [x, y - 0.03, z], 0.0125);
}

/** The bony external acoustic meatus on each side, a dimple that stops short of the cranial cavity. */
function meatusHole(): Sdf {
  return mirroredX(capsule(SKULL_LANDMARKS.meatusOuter, SKULL_LANDMARKS.meatusInner, 0.0045));
}

/** The hollow bone of the skull without the lower jaw and the hyoid: one field. */
export function skullBone(): Sdf {
  const env = outerEnvelope();
  const cavity = cranialCavity();
  // The orbit must not cut into the roof of the cranial cavity: keep a roof one wall thick
  // under the brain (the brain shell reaches into the eyeball, see the header).
  const orbit = orbitCavity();
  const keepRoof = offset(cavity, 0.0035);
  const orbitCut = (x: number, y: number, z: number) => Math.max(orbit(x, y, z), -keepRoof(x, y, z));
  const others = union(nasalPassage(), maxillarySinus(), foramenMagnumHole(), meatusHole(), toothSockets(true));
  return (x, y, z) => {
    const e = env(x, y, z);
    if (e > 0.002) return e;
    return Math.max(e, -cavity(x, y, z), -orbitCut(x, y, z), -others(x, y, z));
  };
}

/** The lower jaw (mandible), one field: body, rami, condyles and coronoid processes. */
export function mandibleField(): Sdf {
  const half: V3[] = [
    [0, -0.1155, 0.0645],
    [0.0085, -0.1155, 0.062],
    [0.0145, -0.1155, 0.0555],
    [0.0185, -0.1155, 0.0445],
    [0.0195, -0.1155, 0.0335],
    [0.0215, -0.1155, 0.019],
    [0.0295, -0.1148, 0.004],
    [0.0475, -0.1145, -0.02],
  ];
  const body = mirroredX(bar(half, 0.0043, 0.56));
  const ramus = mirroredX(ellipsoid([0.0545, -0.083, -0.0155], [0.0036, 0.0305, 0.0185]));
  const angle = mirroredX(ellipsoid([0.05, -0.1135, -0.021], [0.006, 0.0075, 0.007]));
  const [cx, cy, cz] = SKULL_LANDMARKS.condyle;
  const condyle = mirroredX(union(capsule([0.0565, -0.07, -0.0165], [cx, cy, cz], 0.004), ellipsoid([cx, cy, cz], [0.0055, 0.0032, 0.0038])));
  const coronoid = mirroredX(ellipsoid([0.0525, -0.0675, 0.0035], [0.0028, 0.0105, 0.0075]));
  const chin = ellipsoid([0, -0.1195, 0.0625], [0.0105, 0.0055, 0.004]);
  const solid = smoothUnion(0.002, body, ramus, angle, condyle, coronoid, chin);
  const sockets = toothSockets(false);
  return (x, y, z) => {
    const d = solid(x, y, z);
    return d > 0.002 ? d : Math.max(d, -sockets(x, y, z));
  };
}

/** The hyoid: a body and a pair of greater and of lesser horns, free of every other bone. */
export function hyoidField(): Sdf {
  const body = ellipsoid([0, -0.1155, 0.0225], [0.0095, 0.0035, 0.0032]);
  const greater = mirroredX(capsule([0.0085, -0.1155, 0.0215], [0.0235, -0.114, 0.0], 0.0024));
  const lesser = mirroredX(capsule([0.0085, -0.1135, 0.0225], [0.0105, -0.1085, 0.0215], 0.0016));
  return smoothUnion(0.0015, body, greater, lesser);
}

/** Bounds of the whole skull, local frame, with a margin. */
export const SKULL_BOUNDS: { min: V3; max: V3 } = { min: [-0.086, -0.13, -0.1], max: [0.086, 0.07, 0.095] };

/**
 * The SHELL is the skull's solid silhouette, not the hollow bone. The absorption material draws
 * a closed surface on both faces, so one closed surface already reads as a volume the brain is
 * seen through; a hollow vault would double the triangles to draw a second surface that adds
 * nothing at that density. (The hollow bone, cut into its separate bones, is the atlas.) The
 * orbits, the nasal aperture and the foramen magnum are cut out so the face has sockets and a
 * nose and the shell shows where the eyes and the airway go.
 */
export function skull(): THREE.BufferGeometry {
  const env = outerEnvelope();
  const cuts = union(orbitCavity(), nasalPassage(), foramenMagnumHole(), meatusHole());
  const solid: Sdf = (x, y, z) => {
    const e = env(x, y, z);
    return e > 0.002 ? e : Math.max(e, -cuts(x, y, z));
  };
  const field = union(solid, mandibleField(), hyoidField());
  return mergeParts([polygonise(field, SKULL_BOUNDS.min, SKULL_BOUNDS.max, { cell: SHELL_CELL })]);
}

// Re-exported so the atlas needs one import for the operators it combines with these fields.
export { intersect, subtract };
