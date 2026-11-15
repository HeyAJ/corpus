import * as THREE from 'three';
import {
  capsule,
  chain,
  displaced,
  displacedNear,
  ellipsoid,
  halfSpace,
  intersect,
  mergeParts,
  polygonise,
  slab,
  smoothSubtract,
  smoothUnion,
  sphere,
  torus,
  tubeAlong,
  union,
  type Sdf,
  type V3,
} from './sdf';
import { fbm, ridged } from './noise';
import { giPath, giSegment, organDef, warpGeometry } from './layout';

/**
 * THE ORGAN SHELLS.
 *
 * One authored shape per organ: the surface every organ is drawn with while it is not
 * selected, the thing a tap lands on, and the envelope its interior is shown through
 * when it is. Each is a signed-distance recipe (see sdf.ts for why) written in the
 * organ's own frame - origin at the organ's position in organs.json, +x the PATIENT'S
 * right, +y cranial, +z anterior, metres - or, for the long structures whose position
 * is [0, 0, 0], directly in body coordinates.
 *
 * WHAT WAS WRONG WITH THE FIRST GENERATION, organ by organ, because each of these is a
 * thing a student would have been taught incorrectly by the picture:
 *
 *   - the heart was a tapered ball with no chambers, no great vessels and its apex
 *     tilted toward the patient's RIGHT;
 *   - the lungs had no lobes (the fissure was a 5 % dent), and both were the same shape
 *     although the right has three lobes and the left has two and a notch for the heart;
 *   - the liver, spleen and kidneys were ellipsoids, so the kidney had no hilum and the
 *     liver no left lobe;
 *   - the stomach was a symmetric lathe, the trachea did not divide, the oesophagus
 *     ended on the wrong side of the midline and the duodenum was not a C;
 *   - and there was no thyroid, adrenal, thymus, gallbladder, diaphragm, ureter, spinal
 *     cord, eye or reproductive organ at all.
 *
 * WHAT THESE ARE NOT. They are drawings made from the proportions in Gray's Anatomy and
 * Guyton & Hall (CREDITS.md), not segmentations of anybody's scan. Sizes are adult
 * means; nothing here varies with the body's mass or height, and
 * docs/MODEL_LIMITATIONS.md says so.
 *
 * COST. Everything is built once, synchronously, at load: about thirty grids of fifty
 * to a hundred and fifty thousand cells. The cell sizes below are the coarsest that
 * keep each organ's smallest feature (a fissure, a cartilage ring) - they are what the
 * load time is spent on, so raise one only if a feature is actually being lost.
 */

export interface ModelParams {
  /** Gestational age in weeks, for the two shapes that change with it. */
  gestationWeeks?: number;
}

const TAU = Math.PI * 2;

function local(points: readonly V3[], origin: V3): [number, number, number][] {
  return points.map((p) => [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]]);
}

const merge = mergeParts;

/* ------------------------------------------------------------------ brain */

/**
 * Cerebrum (two hemispheres, four lobes each, a longitudinal fissure and the two
 * sulci everybody can name), cerebellum with its folia and vermis, and a brainstem
 * that is visibly midbrain, pons and medulla.
 */
function brain(): THREE.BufferGeometry {
  const hemisphere = (s: number): Sdf =>
    smoothUnion(
      0.014,
      ellipsoid([s * 0.0335, 0.008, -0.004], [0.0325, 0.047, 0.076]),
      ellipsoid([s * 0.03, 0.006, 0.042], [0.029, 0.038, 0.036]), // frontal lobe
      ellipsoid([s * 0.03, 0.01, -0.05], [0.028, 0.036, 0.03]), // occipital lobe
      ellipsoid([s * 0.047, -0.026, 0.012], [0.0185, 0.019, 0.044]), // temporal lobe
    );

  // The hemispheres are joined by a PLAIN union so the cleft between them stays a
  // cleft; what holds them together is the mass of the diencephalon and the corpus
  // callosum low in the midline, as in a real brain.
  let cerebrum = union(hemisphere(1), hemisphere(-1), ellipsoid([0, -0.012, -0.004], [0.02, 0.024, 0.05]));

  for (const s of [1, -1]) {
    // Lateral (Sylvian) fissure, over the top of the temporal lobe.
    cerebrum = smoothSubtract(0.004, cerebrum, capsule([s * 0.068, -0.01, 0.05], [s * 0.064, 0.004, -0.014], 0.004));
    // Central sulcus: the boundary between frontal (motor) and parietal (sensory) cortex.
    cerebrum = smoothSubtract(0.003, cerebrum, capsule([s * 0.008, 0.056, -0.004], [s * 0.058, 0.02, 0.006], 0.003));
  }

  // Gyri and sulci. Positive displacement moves the surface INWARD, so the ridge lines
  // of the noise become grooves. Two scales: the named folds and the texture on them.
  const cortex = displacedNear(
    cerebrum,
    (x, y, z) => {
      const a = ridged(x, y * 1.15, z, 62);
      const b = ridged(x + 0.37, y, z * 0.9 + 0.11, 118);
      return 0.0031 * a * a * a + 0.0012 * b * b;
    },
    0.011,
  );

  const cerebellum = displaced(
    smoothUnion(
      0.008,
      ellipsoid([0.027, -0.044, -0.046], [0.03, 0.021, 0.027]),
      ellipsoid([-0.027, -0.044, -0.046], [0.03, 0.021, 0.027]),
      ellipsoid([0, -0.043, -0.05], [0.012, 0.019, 0.026]), // vermis
    ),
    // Folia: fine, nearly horizontal leaves, tilted a little so they follow the surface.
    (_x, y, z) => 0.0011 * Math.sin((y + z * 0.35) * 950),
  );

  const brainstem = smoothUnion(
    0.004,
    capsule([0, -0.012, -0.012], [0, -0.032, -0.014], 0.0115, 0.011), // midbrain
    ellipsoid([0, -0.045, -0.008], [0.0165, 0.0135, 0.014]), // pons: the anterior bulge
    capsule([0, -0.056, -0.018], [0, -0.086, -0.026], 0.0095, 0.007), // medulla
  );

  return polygonise(smoothUnion(0.005, cortex, cerebellum, brainstem), [-0.072, -0.094, -0.086], [0.072, 0.06, 0.084], {
    cell: 0.0034,
  });
}

/* ------------------------------------------------------------------- eyes */

function eyes(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    const field = smoothUnion(
      0.002,
      sphere([s * 0.031, 0, 0], 0.012), // the globe, 24 mm
      sphere([s * 0.031, 0, 0.0072], 0.0078), // cornea: a steeper cap on the front
      capsule([s * 0.029, 0, -0.011], [s * 0.012, 0.004, -0.04], 0.0022, 0.002), // optic nerve
    );
    const x0 = Math.min(s * 0.008, s * 0.045);
    const x1 = Math.max(s * 0.008, s * 0.045);
    parts.push(polygonise(field, [x0, -0.014, -0.044], [x1, 0.014, 0.017], { cell: 0.0016 }));
  }
  return merge(parts);
}

/* ------------------------------------------------------------ spinal cord */

/** Spinal cord centreline, unexploded body coordinates, foramen magnum to the sacrum. */
export const SPINAL_CORD_PATH: [number, number, number][] = [
  [0, 0.39, -0.026],
  [0, 0.36, -0.03],
  [0, 0.33, -0.034],
  [0, 0.29, -0.05],
  [0, 0.22, -0.078],
  [0, 0.15, -0.08],
  [0, 0.09, -0.07],
  [0, 0.045, -0.062],
  [0, -0.03, -0.066],
  [0, -0.1, -0.078],
];

/**
 * Cord radius at a body height. Two enlargements - cervical for the arms, lumbar for
 * the legs - because that is where the extra motor neurons are; a taper to the conus
 * medullaris at about L1-L2; and below it the cauda equina, drawn as one tapering
 * bundle rather than as its individual roots.
 */
export function spinalCordRadius(y: number): number {
  const bump = (centre: number, width: number) => Math.exp(-Math.pow((y - centre) / width, 2));
  if (y < 0.045) {
    const f = Math.max(0, Math.min(1, (0.045 - y) / 0.145));
    return 0.0036 * (1 - f) + 0.0016 * f;
  }
  const conus = Math.max(0, Math.min(1, (y - 0.045) / 0.03));
  return (0.0048 + 0.0019 * bump(0.315, 0.03) + 0.0014 * bump(0.085, 0.028)) * (0.75 + 0.25 * conus);
}

function spinalCord(): THREE.BufferGeometry {
  const g = tubeAlong(SPINAL_CORD_PATH, (_t, p) => spinalCordRadius(p.y), { tubular: 120, radial: 10 });
  return warpGeometry(g);
}

/* ---------------------------------------------------------------- thyroid */

function thyroid(): THREE.BufferGeometry {
  const field = smoothUnion(
    0.004,
    ellipsoid([0.0165, 0.004, -0.004], [0.009, 0.022, 0.0085]),
    ellipsoid([-0.0165, 0.004, -0.004], [0.009, 0.022, 0.0085]),
    capsule([-0.012, -0.008, 0.006], [0.012, -0.008, 0.006], 0.0045), // isthmus, across the trachea
  );
  return polygonise(field, [-0.028, -0.02, -0.014], [0.028, 0.028, 0.012], { cell: 0.0018 });
}

/* ----------------------------------------------------------------- thymus */

function thymus(): THREE.BufferGeometry {
  const lobes = smoothUnion(
    0.006,
    ellipsoid([0.011, 0.002, 0], [0.013, 0.03, 0.0065]),
    ellipsoid([-0.011, -0.002, 0], [0.013, 0.03, 0.0065]),
  );
  const field = displacedNear(lobes, (x, y, z) => 0.0011 * fbm(x, y, z, 210, 2), 0.006);
  return polygonise(field, [-0.026, -0.034, -0.009], [0.026, 0.034, 0.009], { cell: 0.0022 });
}

/* ------------------------------------------------------------------ heart */

/**
 * The heart, in the orientation it actually lies: base up, back and to the right; apex
 * down, forward and to the LEFT. Four chambers, both auricles, and the roots of the
 * aorta, the pulmonary trunk, both venae cavae and the four pulmonary veins, which are
 * what make it read as a heart rather than as a strawberry.
 *
 * The vessel stubs are aimed along the first points of the matching segments in
 * vasculature.json, so the vascular overlay continues out of them.
 */
function heart(): THREE.BufferGeometry {
  const rv = capsule([0.012, 0.014, 0.014], [-0.03, -0.046, 0.022], 0.027, 0.011);
  const lv = capsule([-0.008, 0.016, -0.008], [-0.044, -0.052, 0.012], 0.031, 0.013);
  let ventricles = smoothUnion(0.01, rv, lv);
  // Anterior interventricular groove: where the left anterior descending artery runs.
  ventricles = smoothSubtract(0.005, ventricles, capsule([-0.006, 0.02, 0.036], [-0.038, -0.046, 0.03], 0.0035));

  const field = smoothUnion(
    0.007,
    ventricles,
    ellipsoid([0.03, 0.022, 0.0], [0.02, 0.027, 0.022]), // right atrium
    ellipsoid([-0.012, 0.036, -0.028], [0.026, 0.02, 0.017]), // left atrium, posterior
    ellipsoid([0.016, 0.042, 0.022], [0.012, 0.009, 0.009]), // right auricle
    ellipsoid([-0.038, 0.034, 0.0], [0.01, 0.008, 0.011]), // left auricle
    chain([[-0.002, 0.03, 0.002], [0.006, 0.058, 0.0], [0.014, 0.084, -0.008]], 0.0138), // ascending aorta
    chain([[-0.012, 0.03, 0.02], [-0.014, 0.054, 0.012], [-0.01, 0.072, -0.008]], 0.0128), // pulmonary trunk
    capsule([0.034, 0.04, -0.004], [0.036, 0.09, -0.014], 0.0092), // superior vena cava
    capsule([0.03, 0.006, -0.012], [0.03, -0.024, -0.02], 0.0105), // inferior vena cava
    capsule([-0.03, 0.04, -0.034], [-0.055, 0.046, -0.036], 0.0055), // left pulmonary veins
    capsule([-0.03, 0.03, -0.036], [-0.055, 0.03, -0.04], 0.0055),
    capsule([0.006, 0.04, -0.036], [0.045, 0.046, -0.04], 0.0055), // right pulmonary veins
    capsule([0.006, 0.03, -0.038], [0.045, 0.03, -0.042], 0.0055),
  );

  return polygonise(field, [-0.064, -0.068, -0.05], [0.058, 0.102, 0.05], { cell: 0.003 });
}

/* ------------------------------------------------------------------ lungs */

/**
 * A lung. `side` is -1 for the left (the organ sits at -x) and +1 for the right.
 *
 * The right lung has three lobes, divided by an oblique and a horizontal fissure; the
 * left has two, divided by the oblique fissure alone, and gives up its anterior
 * inferior corner to the heart (the cardiac notch). The fissures are cut all the way
 * through, so each lobe is its own closed surface - which is what a lobe is.
 */
function lung(side: -1 | 1): THREE.BufferGeometry {
  // Direction of the midline as seen from this lung.
  const med = side < 0 ? 1 : -1;
  const left = side < 0;

  let f = smoothUnion(
    0.035,
    ellipsoid([-med * 0.004, -0.04, 0], [0.058, 0.082, 0.066]),
    ellipsoid([med * 0.012, 0.05, -0.006], [0.036, 0.066, 0.044]),
  );
  // Mediastinal surface: flattened where it faces the heart and great vessels.
  f = smoothSubtract(0.014, f, halfSpace([med * 0.042, 0, 0], [med, 0, 0]));
  // Base: hollowed by the dome of the diaphragm.
  f = smoothSubtract(0.012, f, ellipsoid([med * 0.03, -0.165, 0.0], [0.11, 0.07, 0.1]));
  // Cardiac impression - deep on the left, where it becomes the notch.
  f = left
    ? smoothSubtract(0.012, f, ellipsoid([med * 0.062, -0.04, 0.03], [0.04, 0.055, 0.046]))
    : smoothSubtract(0.012, f, ellipsoid([med * 0.066, -0.035, 0.022], [0.034, 0.045, 0.04]));
  // Hilum: where the bronchus and the vessels enter.
  f = smoothSubtract(0.006, f, sphere([med * 0.047, 0.012, -0.004], 0.014));

  // Oblique fissure: high at the back, low at the front.
  const obliquePoint: V3 = [0, 0.012, 0];
  const obliqueNormal: V3 = [0, 1, 0.9];
  f = smoothSubtract(0.0025, f, slab(obliquePoint, obliqueNormal, 0.0022));

  if (!left) {
    // Horizontal fissure: runs forward from the oblique fissure, so it exists only on
    // the anterior-superior side of that plane. It is what makes a middle lobe.
    const horizontal = intersect(slab([0, 0.03, 0], [0, 1, 0], 0.0022), halfSpace(obliquePoint, obliqueNormal));
    f = smoothSubtract(0.0025, f, horizontal);
  }

  return polygonise(f, [-0.066, -0.124, -0.072], [0.066, 0.12, 0.072], { cell: 0.0044 });
}

/* ---------------------------------------------------------------- trachea */

/** Carina and the ends of the two main bronchi, body coordinates. Shared with the airway detail. */
export const CARINA: V3 = [0, 0.254, 0.004];
export const BRONCHUS_RIGHT_END: V3 = [0.03, 0.228, -0.002];
export const BRONCHUS_LEFT_END: V3 = [-0.03, 0.222, -0.002];

function trachea(): THREE.BufferGeometry {
  const trunk = chain(
    [
      [0, 0.352, 0],
      [0, 0.32, 0.002],
      [0, 0.285, 0.004],
      [CARINA[0], CARINA[1], CARINA[2]],
    ],
    0.0098,
  );
  // Sixteen to twenty C-shaped cartilage rings: ridges on the front and sides only,
  // because the back wall is muscle (it is what lets a swallowed bolus bulge forward).
  const ringed = displaced(trunk, (_x, y, z) => {
    if (y > 0.35 || y < 0.258) return 0;
    const ring = Math.max(0, Math.sin((y * TAU) / 0.0058));
    const anterior = Math.max(0, Math.min(1, (z + 0.004) / 0.007));
    return -0.0011 * ring * anterior;
  });
  const field = smoothUnion(
    0.004,
    ringed,
    ellipsoid([0, 0.364, 0.004], [0.0155, 0.014, 0.014]), // thyroid cartilage of the larynx
    torus([0, 0.3505, 0.002], 0.0105, 0.0028, 1), // cricoid ring
    // The right main bronchus is wider, shorter and more vertical than the left, which
    // is why an inhaled object usually ends up in the right lung.
    capsule(CARINA, BRONCHUS_RIGHT_END, 0.0078, 0.0068),
    capsule(CARINA, BRONCHUS_LEFT_END, 0.0068, 0.006),
  );
  return polygonise(field, [-0.04, 0.212, -0.014], [0.04, 0.38, 0.022], { cell: 0.002 });
}

/* -------------------------------------------------------------- diaphragm */

/**
 * Height of the diaphragm above its own origin at a point of its footprint, metres.
 *
 * Two domes with the central tendon a little lower between them; the right dome sits
 * higher because the liver is under it. Shared with the detail view, which draws the
 * tendon and the three openings on this surface.
 */
export function diaphragmHeight(x: number, z: number): number {
  const right = 0.046 - 0.085 * (Math.pow((x - 0.05) / 0.095, 2) + Math.pow(z / 0.1, 2));
  const left = 0.036 - 0.085 * (Math.pow((x + 0.055) / 0.092, 2) + Math.pow(z / 0.1, 2));
  // Smooth maximum, so the saddle between the domes is rounded rather than creased.
  const k = 0.012;
  const h = Math.max(k - Math.abs(right - left), 0) / k;
  return Math.max(right, left) + h * h * k * 0.25;
}

/** Semi-axes of the diaphragm's footprint: it is as wide as the two lungs and about as deep. */
export const DIAPHRAGM_FOOTPRINT: readonly [number, number] = [0.118, 0.08];

/**
 * The diaphragm, as ONE surface rather than a slab with two faces.
 *
 * It is a sheet of muscle a few millimetres thick, and the absorption material draws
 * every surface a ray crosses as a wall of tissue (materials/OrganAbsorption.ts). Built
 * as a thin solid it would be crossed twice and read as dark as an organ; built as a
 * single sheet it is crossed once and reads as the membrane it is - and costs a
 * thousand triangles instead of thirty thousand.
 */
function diaphragm(): THREE.BufferGeometry {
  const rings = 14;
  const sectors = 48;
  const positions: number[] = [0, diaphragmHeight(0, 0), 0];
  for (let r = 1; r <= rings; r++) {
    // Rings bunch toward the rim, where the sheet turns down most steeply.
    const f = Math.pow(r / rings, 0.8);
    for (let a = 0; a < sectors; a++) {
      const theta = (a / sectors) * TAU;
      const x = DIAPHRAGM_FOOTPRINT[0] * f * Math.cos(theta);
      const z = DIAPHRAGM_FOOTPRINT[1] * f * Math.sin(theta);
      positions.push(x, diaphragmHeight(x, z), z);
    }
  }
  const indices: number[] = [];
  for (let a = 0; a < sectors; a++) indices.push(0, 1 + ((a + 1) % sectors), 1 + a);
  for (let r = 1; r < rings; r++) {
    const inner = 1 + (r - 1) * sectors;
    const outer = 1 + r * sectors;
    for (let a = 0; a < sectors; a++) {
      const b = (a + 1) % sectors;
      indices.push(inner + a, inner + b, outer + a, inner + b, outer + b, outer + a);
    }
  }
  const sheet = new THREE.BufferGeometry();
  sheet.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  sheet.setIndex(indices);
  sheet.computeVertexNormals();

  // The two crura that anchor it to the lumbar spine; the right is the longer.
  const crus = (s: number, bottom: number) =>
    tubeAlong(
      [
        [s * 0.014, diaphragmHeight(s * 0.014, -0.07), -0.07],
        [s * 0.011, -0.05, -0.064],
        [s * 0.008, bottom, -0.058],
      ],
      (t) => 0.006 - 0.0025 * t,
      { tubular: 16, radial: 7 },
    );
  return merge([sheet, crus(1, -0.098), crus(-1, -0.084)]);
}

/* ------------------------------------------------------------- oesophagus */

function oesophagus(): THREE.BufferGeometry {
  const points: [number, number, number][] = [[0.002, 0.37, -0.014], ...giSegment('oesophagus')];
  const g = tubeAlong(
    points,
    // Narrowed at each end by its sphincters; the lower one is what reflux gets past.
    (t) => 0.0086 * (1 - 0.28 * Math.exp(-Math.pow((t - 0.97) / 0.035, 2)) - 0.2 * Math.exp(-Math.pow(t / 0.04, 2))),
    { tubular: 90, radial: 12 },
  );
  return warpGeometry(g);
}

/* ------------------------------------------------------------------ liver */

/**
 * The liver: a large right lobe, a smaller left lobe tapering across the midline, a
 * sloping visceral surface, the notch of the falciform ligament on the front and the
 * groove the inferior vena cava runs in at the back.
 */
function liver(): THREE.BufferGeometry {
  let f = smoothUnion(
    0.03,
    ellipsoid([0.03, 0.0, -0.005], [0.062, 0.062, 0.058]),
    ellipsoid([-0.055, 0.016, 0.012], [0.05, 0.03, 0.03]),
  );
  // Visceral (inferior) surface: faces down, back and to the left.
  f = smoothSubtract(0.02, f, halfSpace([0.0, -0.022, 0], [-0.5, -1, -0.35]));
  // Gallbladder fossa.
  f = smoothSubtract(0.006, f, sphere([0.02, -0.046, 0.026], 0.014));
  // Falciform ligament: the line that divides right from left on the anterior surface.
  f = smoothSubtract(0.004, f, capsule([-0.02, 0.052, 0.046], [-0.022, -0.03, 0.04], 0.004));
  // Groove for the inferior vena cava.
  f = smoothSubtract(0.006, f, capsule([-0.012, 0.062, -0.046], [-0.012, -0.03, -0.05], 0.012));
  const field = displacedNear(f, (x, y, z) => 0.0012 * fbm(x, y, z, 55, 2), 0.011);
  return polygonise(field, [-0.112, -0.07, -0.068], [0.098, 0.068, 0.062], { cell: 0.004 });
}

/* ------------------------------------------------------------ gallbladder */

function gallbladder(): THREE.BufferGeometry {
  const field = smoothUnion(
    0.003,
    chain(
      [
        [0.006, -0.024, 0.012], // fundus
        [0.0, -0.004, 0.004], // body
        [-0.01, 0.016, -0.006], // neck
      ],
      [0.0135, 0.012, 0.005],
    ),
    capsule([-0.01, 0.016, -0.006], [-0.02, 0.026, -0.012], 0.0028, 0.0022), // cystic duct
  );
  return polygonise(field, [-0.026, -0.04, -0.018], [0.022, 0.032, 0.028], { cell: 0.002 });
}

/* ---------------------------------------------------------------- stomach */

/**
 * The stomach, swept along the same authored centreline the bolus travels, so what is
 * swallowed is always drawn inside it: cardia, a fundus that domes above the cardia,
 * body, antrum and a narrow pylorus that ends to the RIGHT of the midline.
 */
function stomach(): THREE.BufferGeometry {
  const origin = organDef('stomach').position;
  const line = local(giSegment('stomach'), origin);
  const fundus = local([[-0.052, 0.094, 0.002]], origin)[0];
  const field = smoothUnion(
    0.012,
    chain(line, [0.011, 0.022, 0.031, 0.032, 0.028, 0.02, 0.009]),
    sphere(fundus, 0.027),
  );
  return polygonise(field, [-0.066, -0.066, -0.04], [0.068, 0.07, 0.044], { cell: 0.0036 });
}

/* --------------------------------------------------------------- pancreas */

/** Pancreas, body coordinates: tail at the splenic hilum, head inside the duodenal C. */
export const PANCREAS_PATH: [number, number, number][] = [
  [-0.075, 0.022, -0.03],
  [-0.05, 0.018, -0.03],
  [-0.025, 0.012, -0.03],
  [0.0, -0.002, -0.028],
  [0.022, -0.02, -0.024],
];

function pancreas(): THREE.BufferGeometry {
  const gland = smoothUnion(
    0.006,
    chain(PANCREAS_PATH, [0.008, 0.011, 0.0125, 0.0115, 0.019]),
    ellipsoid([0.01, -0.036, -0.027], [0.012, 0.009, 0.008]), // uncinate process
  );
  // Lobulated: the pancreas has no capsule to smooth it over.
  const field = displacedNear(gland, (x, y, z) => 0.0016 * fbm(x, y, z, 180, 2), 0.008);
  return polygonise(field, [-0.088, -0.05, -0.05], [0.046, 0.04, -0.004], { cell: 0.0026 });
}

/* ----------------------------------------------------------------- spleen */

function spleen(): THREE.BufferGeometry {
  let f: Sdf = ellipsoid([0, 0, 0], [0.027, 0.05, 0.021]);
  // Visceral surface and hilum, facing forward and toward the midline.
  f = smoothSubtract(0.012, f, ellipsoid([0.03, 0, 0.012], [0.02, 0.04, 0.016]));
  // The notches on its superior border - the feature a palpating hand looks for.
  f = smoothSubtract(0.003, f, sphere([-0.004, 0.03, 0.022], 0.006));
  f = smoothSubtract(0.003, f, sphere([-0.006, 0.012, 0.024], 0.005));
  return polygonise(f, [-0.03, -0.054, -0.025], [0.03, 0.054, 0.025], { cell: 0.0028 });
}

/* --------------------------------------------------------------- adrenals */

function adrenal(side: -1 | 1): THREE.BufferGeometry {
  // The left gland is a crescent draped over the kidney's upper pole; the right is a
  // pyramid tucked behind the vena cava. They really are different shapes.
  const field =
    side < 0
      ? smoothSubtract(0.003, ellipsoid([0, 0, 0], [0.017, 0.011, 0.006]), sphere([0.004, -0.016, 0], 0.013))
      : smoothUnion(
          0.004,
          ellipsoid([0, -0.002, 0], [0.014, 0.009, 0.006]),
          capsule([0, 0, 0], [0.002, 0.013, 0], 0.006, 0.002),
        );
  return polygonise(field, [-0.02, -0.014, -0.009], [0.02, 0.018, 0.009], { cell: 0.0013 });
}

/* ---------------------------------------------------------------- kidneys */

function kidney(side: -1 | 1): THREE.BufferGeometry {
  const med = side < 0 ? 1 : -1;
  let f: Sdf = ellipsoid([0, 0, 0], [0.0285, 0.055, 0.021]);
  // The hilum: the notch that makes it a bean, where artery, vein and ureter attach.
  f = smoothSubtract(0.01, f, ellipsoid([med * 0.036, 0, 0.004], [0.018, 0.022, 0.02]));
  // The renal pelvis emerging from it and turning down into the ureter.
  f = smoothUnion(0.004, f, capsule([med * 0.014, 0, 0.002], [med * 0.03, -0.014, 0.004], 0.0065, 0.004));
  return polygonise(f, [-0.034, -0.058, -0.024], [0.034, 0.058, 0.024], { cell: 0.0028 });
}

/** The two ureters, body coordinates: renal pelvis to the trigone of the bladder. */
export const URETER_LEFT: [number, number, number][] = [
  [-0.032, -0.002, -0.046],
  [-0.034, -0.06, -0.04],
  [-0.04, -0.125, -0.02],
  [-0.035, -0.165, -0.03],
  [-0.014, -0.198, -0.004],
];
export const URETER_RIGHT: [number, number, number][] = [
  [0.032, -0.014, -0.046],
  [0.034, -0.065, -0.04],
  [0.04, -0.125, -0.02],
  [0.035, -0.165, -0.03],
  [0.014, -0.198, -0.004],
];

function ureters(): THREE.BufferGeometry {
  const radius = () => 0.0024;
  return merge([
    warpGeometry(tubeAlong(URETER_LEFT, radius, { tubular: 56, radial: 8 })),
    warpGeometry(tubeAlong(URETER_RIGHT, radius, { tubular: 56, radial: 8 })),
  ]);
}

/* ------------------------------------------------------------- intestines */

function intestineSmall(): THREE.BufferGeometry {
  const path = giPath(['duodenum', 'jejunum', 'ileum']);
  return tubeAlong(
    path,
    // Duodenum and jejunum are wider and thicker-walled than the ileum; the ripple is
    // the valvulae conniventes showing through.
    (t) => (0.0122 - 0.0026 * t) * (1 + 0.035 * Math.sin(t * 620)),
    { tubular: 380, radial: 9, tension: 0.42 },
  );
}

/** The appendix, body coordinates, off the base of the caecum. */
export const APPENDIX_PATH: [number, number, number][] = [
  [0.074, -0.134, -0.012],
  [0.064, -0.15, -0.006],
  [0.058, -0.168, -0.002],
];

function intestineLarge(): THREE.BufferGeometry {
  const segments = ['caecum', 'colon_ascending', 'colon_transverse', 'colon_descending', 'colon_sigmoid', 'rectum'];
  const path = giPath(segments);

  // Calibre at each authored point: widest at the caecum, narrowing round the frame,
  // widening again at the rectal ampulla and closing at the anal canal.
  const calibreAt: number[] = [];
  const table: Record<string, number> = {
    caecum: 0.0235,
    colon_ascending: 0.021,
    colon_transverse: 0.019,
    colon_descending: 0.0165,
    colon_sigmoid: 0.0145,
    rectum: 0.018,
  };
  for (const s of segments) {
    const n = giSegment(s).length;
    for (let i = calibreAt.length === 0 ? 0 : 1; i < n; i++) calibreAt.push(table[s]);
  }
  calibreAt[calibreAt.length - 1] = 0.008; // anal canal

  const colon = tubeAlong(
    path,
    (t) => {
      const f = t * (calibreAt.length - 1);
      const i = Math.min(calibreAt.length - 2, Math.floor(f));
      const base = calibreAt[i] + (calibreAt[i + 1] - calibreAt[i]) * (f - i);
      // Haustra: the sacculations the taeniae coli gather the colon into. They fade out
      // over the rectum, which has none.
      const haustra = Math.pow(Math.sin(t * Math.PI * 58), 2) * Math.max(0, 1 - Math.max(0, t - 0.86) / 0.06);
      return base * (0.9 + 0.2 * haustra);
    },
    { tubular: 300, radial: 12, tension: 0.45 },
  );
  const appendix = tubeAlong(APPENDIX_PATH, (t) => 0.0034 - 0.0012 * t, { tubular: 20, radial: 7 });
  return warpGeometry(merge([colon, appendix]));
}

/* ---------------------------------------------------------------- bladder */

function bladder(): THREE.BufferGeometry {
  const field = smoothUnion(
    0.006,
    ellipsoid([0, 0, 0], [0.036, 0.03, 0.033]),
    capsule([0, 0.022, 0.02], [0, 0.036, 0.03], 0.006, 0.002), // apex, toward the umbilicus
    capsule([0, -0.026, -0.004], [0, -0.04, -0.004], 0.008, 0.005), // neck and first of the urethra
  );
  return polygonise(field, [-0.04, -0.046, -0.037], [0.04, 0.04, 0.037], { cell: 0.003 });
}

/* ------------------------------------------------------- male reproductive */

function prostate(): THREE.BufferGeometry {
  const vesicle = (s: number): Sdf =>
    displacedNear(
      capsule([s * 0.006, 0.014, -0.014], [s * 0.03, 0.03, -0.024], 0.0055, 0.0065),
      (x, y, z) => 0.0011 * fbm(x, y, z, 260, 2),
      0.006,
    );
  const field = smoothUnion(
    0.004,
    ellipsoid([0, 0, 0], [0.02, 0.015, 0.014]),
    vesicle(1),
    vesicle(-1),
    capsule([0.004, 0.014, -0.012], [0.012, 0.034, -0.02], 0.003), // ampulla of the vas deferens
    capsule([-0.004, 0.014, -0.012], [-0.012, 0.034, -0.02], 0.003),
  );
  return polygonise(field, [-0.04, -0.018, -0.034], [0.04, 0.04, 0.017], { cell: 0.002 });
}

/** One vas deferens, in the testes' own frame, from the tail of the epididymis to the back of the bladder. */
export function vasDeferensPath(s: number): [number, number, number][] {
  return [
    [s * 0.024, -0.02, -0.012],
    [s * 0.027, 0.01, -0.018],
    [s * 0.03, 0.045, -0.012],
    [s * 0.044, 0.085, 0.002],
    [s * 0.056, 0.115, -0.006],
    [s * 0.04, 0.125, -0.03],
    [s * 0.014, 0.1, -0.045],
  ];
}

function testes(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    // The left testis usually hangs a little lower than the right.
    const drop = s < 0 ? -0.006 : 0;
    const field = smoothUnion(
      0.003,
      ellipsoid([s * 0.024, drop, 0], [0.0125, 0.022, 0.015]),
      chain(
        [
          [s * 0.024, 0.022 + drop, -0.008], // head of the epididymis
          [s * 0.026, 0.0 + drop, -0.016],
          [s * 0.024, -0.02 + drop, -0.012], // tail
        ],
        [0.006, 0.0035, 0.0045],
      ),
    );
    const x0 = Math.min(s * 0.008, s * 0.04);
    const x1 = Math.max(s * 0.008, s * 0.04);
    parts.push(polygonise(field, [x0, -0.032, -0.022], [x1, 0.03, 0.017], { cell: 0.002 }));
    parts.push(tubeAlong(vasDeferensPath(s), () => 0.0019, { tubular: 60, radial: 7 }));
  }
  return merge(parts);
}

function penis(): THREE.BufferGeometry {
  const field = smoothUnion(
    0.004,
    chain(
      [
        [0, 0, 0],
        [0, -0.012, 0.022],
        [0, -0.04, 0.036],
        [0, -0.066, 0.04],
      ],
      [0.011, 0.0115, 0.011, 0.0105],
    ),
    ellipsoid([0, -0.076, 0.041], [0.0125, 0.012, 0.0125]), // glans
    ellipsoid([0, 0.004, -0.012], [0.012, 0.01, 0.014]), // bulb
    capsule([0.004, 0.006, -0.014], [0.024, 0.018, -0.03], 0.005, 0.004), // crura, to the pubic rami
    capsule([-0.004, 0.006, -0.014], [-0.024, 0.018, -0.03], 0.005, 0.004),
  );
  return polygonise(field, [-0.03, -0.09, -0.036], [0.03, 0.024, 0.056], { cell: 0.0022 });
}

/* ----------------------------------------------------- female reproductive */

/** One uterine tube, in the uterus's own frame, from the cornu to the fimbriated end. */
export function uterineTubePath(s: number): [number, number, number][] {
  return [
    [s * 0.019, 0.074, 0.024],
    [s * 0.04, 0.086, 0.016],
    [s * 0.058, 0.084, 0.004],
    [s * 0.066, 0.07, -0.006],
    [s * 0.06, 0.056, -0.01],
  ];
}

/**
 * Height of the uterine fundus above the external os, metres, by gestational week.
 *
 * Landmarks from standard obstetric teaching (Cunningham et al., Williams Obstetrics
 * 25e, ch. 9): the fundus is at the pubic symphysis at about 12 weeks and at the
 * umbilicus at about 20; between 20 and 34 weeks the symphysis-fundal height in
 * centimetres tracks the gestational age in weeks; near term the presenting part
 * engages and the fundus drops a little. This is a drawing rule for the size of the
 * shape, not a quantity the simulation reads.
 */
export function fundalHeight(weeks: number): number {
  const w = Math.max(0, Math.min(42, weeks));
  const stops: [number, number][] = [
    [0, 0.082],
    [6, 0.085],
    [12, 0.115],
    [20, 0.215],
    [36, 0.36],
    [40, 0.345],
    [42, 0.345],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (w <= stops[i][0]) {
      const [w0, h0] = stops[i - 1];
      const [w1, h1] = stops[i];
      return h0 + ((h1 - h0) * (w - w0)) / (w1 - w0);
    }
  }
  return stops[stops.length - 1][1];
}

/** Centre and semi-axes of the gravid uterine body for a gestational age. Shared with the fetus. */
export function gravidBody(weeks: number): { centre: V3; radii: V3 } {
  const h = fundalHeight(weeks);
  const ry = (h - 0.02) / 2;
  // It rises out of the pelvis and comes forward against the abdominal wall as it grows.
  return { centre: [0, 0.02 + ry, 0.02 + 0.2 * h], radii: [0.31 * h, ry, 0.23 * h] };
}

function uterus(params: ModelParams): THREE.BufferGeometry {
  const weeks = params.gestationWeeks ?? 0;
  const cervix = capsule([0, 0, 0], [0, 0.024, 0.006], 0.0115, 0.0125);

  if (weeks < 6) {
    // The non-pregnant uterus: a pear tipped forward over the bladder (anteverted).
    const field = smoothUnion(0.012, cervix, ellipsoid([0, 0.052, 0.02], [0.0235, 0.03, 0.0165]));
    const body = polygonise(field, [-0.028, -0.014, -0.014], [0.028, 0.086, 0.04], { cell: 0.0022 });
    const tubes = [1, -1].map((s) =>
      // The tube widens from the isthmus at the uterus to the ampulla, where
      // fertilisation happens, and ends in the fimbriae that sweep the ovary.
      tubeAlong(uterineTubePath(s), (t) => 0.0019 + 0.0034 * t * t, { tubular: 40, radial: 8 }),
    );
    return merge([body, ...tubes]);
  }

  const { centre, radii } = gravidBody(weeks);
  const wall = smoothUnion(0.014, cervix, ellipsoid(centre, radii));
  const cell = Math.max(0.0024, radii[1] / 26);
  // The lower z bound was `centre[2] - radii[2] - 0.004`, which for a body that has come
  // forward (centre z = 0.02 + 0.2h) is above the cervix's back wall (z = -0.0125 at the
  // external os) and sliced the cervix off flat. The atlas builder's `boxOf` already
  // takes the lower of -0.014 and that bound; this box now does the same.
  const body = polygonise(
    wall,
    [-radii[0] - 0.004, -0.014, Math.min(-0.014, centre[2] - radii[2] - 0.004)],
    [radii[0] + 0.004, centre[1] + radii[1] + 0.004, centre[2] + radii[2] + 0.004],
    { cell },
  );
  const parts = [body];

  if (weeks >= 10) {
    // The placenta: a disc on the upper posterior wall. Drawn as its own closed surface
    // inside the uterus, so it shows through the wall as a denser patch.
    const thickness = 0.006 + 0.012 * (fundalHeight(weeks) / 0.36);
    const placenta = ellipsoid(
      [0, centre[1] + 0.42 * radii[1], centre[2] - radii[2] + thickness + 0.004],
      [0.58 * radii[0], 0.4 * radii[1], thickness],
    );
    parts.push(
      polygonise(
        placenta,
        [-0.6 * radii[0], centre[1], centre[2] - radii[2]],
        [0.6 * radii[0], centre[1] + 0.86 * radii[1], centre[2] - radii[2] + 2 * thickness + 0.01],
        { cell: Math.max(0.002, thickness / 2.2) },
      ),
    );
  }
  for (const s of [1, -1]) {
    // The tubes are carried up with the fundus.
    const lift = centre[1] + 0.55 * radii[1] - 0.074;
    const spread = Math.max(0, radii[0] * 0.72 - 0.019);
    const path = uterineTubePath(s).map((p) => [p[0] + s * spread, p[1] + lift, p[2] + centre[2] - 0.02] as V3);
    parts.push(tubeAlong(path, (t) => 0.0019 + 0.0034 * t * t, { tubular: 40, radial: 8 }));
  }
  return merge(parts);
}

function ovaries(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    // Almond-sized, and pitted by the follicles ripening under the surface.
    const field = displacedNear(ellipsoid([s * 0.05, 0, 0], [0.0155, 0.0085, 0.0075]), (x, y, z) => 0.0009 * fbm(x, y, z, 330, 2), 0.005);
    parts.push(polygonise(field, [s * 0.05 - 0.018, -0.011, -0.01], [s * 0.05 + 0.018, 0.011, 0.01], { cell: 0.0015 }));
  }
  return merge(parts);
}

function vagina(): THREE.BufferGeometry {
  // The canal is a collapsed tube, wider from side to side than front to back; the
  // field is evaluated in a frame squeezed along z to flatten it.
  const canal = chain(
    [
      [0, -0.002, 0.0],
      [0, -0.04, 0.012],
      [0, -0.072, 0.036],
    ],
    [0.0095, 0.009, 0.008],
  );
  const flattened: Sdf = (x, y, z) => {
    // Squeeze about the canal's own axis, which leans forward as it descends.
    const axisZ = y > -0.04 ? ((-0.002 - y) / 0.038) * 0.012 : 0.012 + ((-0.04 - y) / 0.032) * 0.024;
    return canal(x, y, axisZ + (z - axisZ) / 0.62);
  };
  const field = smoothUnion(
    0.003,
    flattened,
    // The erectile tissue of the vulva: the two vestibular bulbs either side of the
    // opening, and the clitoris - glans, body and the crura that anchor it. These are
    // the structures that engorge during arousal, the homologue of the penile corpora.
    ellipsoid([0.0095, -0.078, 0.04], [0.004, 0.012, 0.006]),
    ellipsoid([-0.0095, -0.078, 0.04], [0.004, 0.012, 0.006]),
    sphere([0, -0.064, 0.058], 0.004),
    capsule([0, -0.062, 0.056], [0, -0.058, 0.046], 0.003),
    capsule([0, -0.058, 0.046], [0.017, -0.07, 0.03], 0.003, 0.0022),
    capsule([0, -0.058, 0.046], [-0.017, -0.07, 0.03], 0.003, 0.0022),
  );
  return polygonise(field, [-0.022, -0.094, -0.012], [0.022, 0.01, 0.066], { cell: 0.0019 });
}

function breasts(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    let f: Sdf = ellipsoid([s * 0.072, -0.004, -0.012], [0.05, 0.052, 0.036]);
    // Flat against the chest wall.
    f = smoothSubtract(0.01, f, halfSpace([0, 0, -0.03], [0, 0, -1]));
    f = smoothUnion(0.003, f, sphere([s * 0.074, -0.012, 0.024], 0.005));
    parts.push(polygonise(f, [s * 0.072 - 0.054, -0.06, -0.034], [s * 0.072 + 0.054, 0.052, 0.032], { cell: 0.0045 }));
  }
  return merge(parts);
}

/* ------------------------------------------------------------------ fetus */

/** Weight Hadlock's regression gives at 40 weeks, grams: the size the fetal model is authored at. */
const TERM_WEIGHT_G = Math.exp(0.578 + 0.332 * 40 - 0.00354 * 40 * 40);

/**
 * Fetal weight by gestational age, grams: ln W = 0.578 + 0.332 GA - 0.00354 GA^2
 * (Hadlock, Harrist and Martinez-Poyer 1991, Radiology 181:129-133, whose abstract
 * gives the two ends of the curve - 35 g at 10 weeks and 3,619 g at 40 - that this
 * expression reproduces). The study covers 10 to 40 weeks; below 10 the embryo is held
 * at the 10-week size rather than extrapolated.
 */
export function fetalWeight_g(weeks: number): number {
  const w = Math.max(10, Math.min(40, weeks));
  return Math.exp(0.578 + 0.332 * w - 0.00354 * w * w);
}

/** Linear scale of the fetal model at a gestational age: the cube root of the weight ratio. */
export function fetalScale(weeks: number): number {
  return Math.cbrt(fetalWeight_g(weeks) / TERM_WEIGHT_G);
}

export interface FetalFit {
  /** The scale the cited weight asks for: `fetalScale(weeks)`. */
  wanted: number;
  /** The largest uniform scale at which every vertex, cord included, is inside the sac. */
  fitMax: number;
  /** The scale actually used: min(wanted, clearance * fitMax). */
  scale: number;
  /** True when the cavity, not the weight, set the scale. */
  clamped: boolean;
  /** Where the term-frame origin goes, in the uterus frame (the fetus shares its origin). */
  offset: V3;
}

/** Fraction of the exact vertex fit that is used, so the polygonised sac's cell error cannot let a vertex through. */
const FETAL_CLEARANCE = 0.97;

/**
 * SIZE AND PLACE OF THE FETUS FOR A GESTATIONAL AGE.
 *
 * WHAT WAS WRONG. `fetus()` builds the one term-sized, head-down figure and nothing ever
 * scaled or moved it: `fetalScale` was referenced by no caller, and OrganSet rebuilt only
 * the uterus per week. So at 24 weeks a term-sized fetus, authored about the external os,
 * hung out of the bottom of a uterus a third its size, through the pelvis, head below the
 * body. The shell is not rebuilt per week any more; the WHOLE organ (shell, and by
 * following the shell's transform every interior part and flow stream authored in the
 * term frame) is given one uniform scale and one offset.
 *
 * THE SIZE RULE. The repository cites a fetal WEIGHT by week (Hadlock 1991, via
 * `fetalWeight_g`) and no fetal length by week. The linear scale is therefore
 * `fetalScale(weeks)` = (weight(w) / weight(40 wk))^(1/3): isometric scaling, a drawing
 * rule derived from the cited weight, NOT a measured length. Before 10 weeks Hadlock's
 * regression does not apply, so the embryo is drawn at the 10-week size, not extrapolated.
 *
 * THE FIT. The scale the weight asks for is larger than the sac the uterus model draws at
 * EVERY week (the model's gravid body is about 16 cm deep at term, a flexed term fetus is
 * about 15 cm deep in the figure's own frame, and the sac is smaller than the body by the
 * wall and the lining). It is not shrunk silently: `wanted` and `fitMax` are both
 * returned so callers and the report can say by how much, and the result is clamped to
 * the largest uniform scale at which every vertex, the cord included, lies inside the
 * sac ellipsoid (the same radii the uterus atlas draws, passed in as `sac`), centred on
 * the middle of the figure's bounding box. That is closed form: for the ellipsoid
 * sum((s(v-c)/R)^2) <= 1, s = 1 / max_v |(v - c)/R|.
 */
export function fetalFit(weeks: number, positions: ArrayLike<number>, sacCentre: V3, sac: V3): FetalFit {
  const wanted = fetalScale(weeks);
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < lo[k]) lo[k] = v;
      if (v > hi[k]) hi[k] = v;
    }
  }
  const c: V3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  let worst = 0;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const dx = (positions[i] - c[0]) / sac[0];
    const dy = (positions[i + 1] - c[1]) / sac[1];
    const dz = (positions[i + 2] - c[2]) / sac[2];
    worst = Math.max(worst, dx * dx + dy * dy + dz * dz);
  }
  const fitMax = worst > 0 ? 1 / Math.sqrt(worst) : wanted;
  const scale = Math.min(wanted, FETAL_CLEARANCE * fitMax);
  return {
    wanted,
    fitMax,
    scale,
    clamped: scale < wanted,
    offset: [sacCentre[0] - scale * c[0], sacCentre[1] - scale * c[1], sacCentre[2] - scale * c[2]],
  };
}

/**
 * A fetus at term size, head down (the usual presentation at term), curled into the
 * flexed attitude a uterus holds it in, with the first of its cord.
 * The shell is always built at term size; its size and place for a given week are
 * applied to the whole organ by `fetalFit` (see there). It is a figure, not a growth
 * model, so the proportions of a 12-week fetus are those of a small term baby.
 */
function fetus(): THREE.BufferGeometry {
  const limb = (s: number): Sdf =>
    union(
      capsule([s * 0.034, 0.1, 0.012], [s * 0.04, 0.03, 0.066], 0.019, 0.016), // thigh, flexed
      capsule([s * 0.04, 0.03, 0.066], [s * 0.022, 0.102, 0.084], 0.014, 0.011), // lower leg
      ellipsoid([s * 0.02, 0.118, 0.09], [0.009, 0.018, 0.009]), // foot
      capsule([s * 0.05, -0.05, 0.012], [s * 0.056, 0.0, 0.046], 0.013, 0.012), // upper arm
      capsule([s * 0.056, 0.0, 0.046], [s * 0.02, -0.044, 0.068], 0.011, 0.009), // forearm, across the chest
    );
  const field = smoothUnion(
    0.012,
    sphere([0, -0.13, 0.014], 0.05), // head, chin on chest
    ellipsoid([0, -0.012, 0.008], [0.046, 0.086, 0.042]), // trunk
    ellipsoid([0, 0.104, 0.0], [0.044, 0.04, 0.038]), // pelvis
    limb(1),
    limb(-1),
  );
  const body = polygonise(field, [-0.074, -0.184, -0.046], [0.074, 0.15, 0.104], { cell: 0.0052 });
  const cord = tubeAlong(
    [
      [0, 0.02, 0.05],
      [0.03, 0.06, 0.08],
      [0.05, 0.12, 0.05],
      [0.03, 0.17, 0.0],
      [0.0, 0.2, -0.05],
    ],
    () => 0.006,
    { tubular: 40, radial: 7 },
  );
  return merge([body, cord]);
}

/* --------------------------------------------------------------- dispatch */

const BUILDERS: Record<string, (params: ModelParams) => THREE.BufferGeometry> = {
  brain,
  eyes,
  spinal_cord: spinalCord,
  thyroid,
  thymus,
  heart,
  lung_l: () => lung(-1),
  lung_r: () => lung(1),
  trachea,
  diaphragm,
  oesophagus,
  liver,
  gallbladder,
  stomach,
  pancreas,
  spleen,
  adrenal_l: () => adrenal(-1),
  adrenal_r: () => adrenal(1),
  kidney_l: () => kidney(-1),
  kidney_r: () => kidney(1),
  ureters,
  intestine_small: intestineSmall,
  intestine_large: intestineLarge,
  bladder,
  prostate,
  testes,
  penis,
  uterus,
  ovaries,
  vagina,
  breasts,
  fetus,
};

export function modelNames(): string[] {
  return Object.keys(BUILDERS);
}

/** Build one organ's shell. Throws on an unknown name: a missing organ should be loud. */
export function buildModel(model: string, params: ModelParams = {}): THREE.BufferGeometry {
  const builder = BUILDERS[model];
  if (!builder) throw new Error(`anatomy: no model named "${model}"`);
  const geometry = builder(params);
  geometry.computeBoundingSphere();
  return geometry;
}
