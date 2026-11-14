import * as THREE from 'three';
import type { PartBuilder, PartGeometry } from '../parts';
import {
  capsule,
  displaced,
  displacedNear,
  ellipsoid,
  intersect,
  mergeParts,
  offset,
  polygonise,
  smoothSubtract,
  smoothUnion,
  subtract,
  tubeAlong,
  union,
} from '../sdf';
import type { Sdf, V3 } from '../sdf';
import { ridged } from '../noise';

/**
 * INTERIOR OF THE BRAIN: twenty-one parts that sit inside the shell built by `brain()` in
 * ../models.ts, in the same frame (origin at the organ's position, +x the patient's right,
 * +y cranial, +z anterior, metres).
 *
 * HOW THE CORTEX IS MADE. The shell is two hemispheres (a smooth union of four ellipsoids
 * each), cut by the lateral fissure and the central sulcus, and then wrinkled by a ridged
 * noise that moves the surface inward. This file rebuilds that same per-hemisphere field,
 * wrinkles and all, so that a cortical part is a true curved slab that FOLLOWS the folds:
 * the region between a surface 3.5 mm inside the shell and a smooth surface 10.5 mm
 * inside it. The inner surface is deliberately the smooth one, so the slab is thicker
 * under a gyral crown than in a sulcal floor, as grey matter is. The noise is evaluated
 * at the true world position, so it is the very same noise the shell used.
 *
 * Each lobe is then that slab intersected with a REGION written as a signed function of
 * position (negative inside). The regions partition the slab: the central sulcus is a
 * plane that leans forward as it goes down the side of the hemisphere, the precentral and
 * postcentral gyri are strips either side of it, the lateral fissure is a plane that
 * separates the temporal lobe from everything above it, and so on. The cingulate gyrus is
 * subtracted from its neighbours so that no two parts draw the same surface.
 *
 * WHAT THIS IS NOT. It is not a traced atlas or a parcellation of a real brain: every
 * position is chosen by eye from the proportions the anatomy texts give, to be
 * recognisable and correctly related (the hypothalamus below the thalamus, the pituitary
 * hanging from it on a stalk, the hippocampus curling round behind the amygdala). The
 * ventricles are not drawn, so the deep structures are packed more tightly than in life.
 *
 * It runs in the geometry worker: only sdf, noise and three. Deterministic, no Math.random.
 */

/* ---------------------------------------------------------------- the shell */

/**
 * One hemisphere of the shell, before the fissure, the sulcus and the wrinkles. These
 * four ellipsoids are copied from `brain()` in models.ts. If that function changes, this
 * must change with it, or the cortical slabs will stop sitting inside the shell; the
 * probe .cache/probes/brain_parts.ts measures the depth of every vertex to catch that.
 */
function hemisphereBase(s: number): Sdf {
  return smoothUnion(
    0.014,
    ellipsoid([s * 0.0335, 0.008, -0.004], [0.0325, 0.047, 0.076]),
    ellipsoid([s * 0.03, 0.006, 0.042], [0.029, 0.038, 0.036]), // frontal lobe
    ellipsoid([s * 0.03, 0.01, -0.05], [0.028, 0.036, 0.03]), // occipital lobe
    ellipsoid([s * 0.047, -0.026, 0.012], [0.0185, 0.019, 0.044]), // temporal lobe
  );
}

/** The hemisphere after the two named grooves are cut, still smooth. Used for the inner surface. */
function hemisphereCut(s: number): Sdf {
  let h = hemisphereBase(s);
  h = smoothSubtract(0.004, h, capsule([s * 0.068, -0.01, 0.05], [s * 0.064, 0.004, -0.014], 0.004));
  h = smoothSubtract(0.003, h, capsule([s * 0.008, 0.056, -0.004], [s * 0.058, 0.02, 0.006], 0.003));
  return h;
}

/** The hemisphere exactly as the shell draws it, wrinkles included (same noise, same band). */
function hemisphereWrinkled(s: number): Sdf {
  return displacedNear(
    hemisphereCut(s),
    (x, y, z) => {
      const a = ridged(x, y * 1.15, z, 62);
      const b = ridged(x + 0.37, y, z * 0.9 + 0.11, 118);
      return 0.0031 * a * a * a + 0.0012 * b * b;
    },
    0.011,
  );
}

/* ---------------------------------------------------------------- 2D arches */

/**
 * Distance, in the sagittal (z, y) plane only, to a polyline of tapering capsules, minus
 * the radius. Extruded along x it is a curved band: the corpus callosum and the cingulate
 * gyrus both follow a C-shaped curve in the midline and are wide in x. `pts` are [z, y].
 */
function arch2D(pts: readonly (readonly [number, number])[], radii: readonly number[]): Sdf {
  const n = pts.length - 1;
  return (_x, y, z) => {
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const az = pts[i][0];
      const ay = pts[i][1];
      const bz = pts[i + 1][0] - az;
      const by = pts[i + 1][1] - ay;
      const pz = z - az;
      const py = y - ay;
      const len2 = bz * bz + by * by || 1e-12;
      let t = (pz * bz + py * by) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(pz - bz * t, py - by * t) - (radii[i] + (radii[i + 1] - radii[i]) * t);
      if (d < best) best = d;
    }
    return best;
  };
}

/** The callosal curve as [z, y]: rostrum, genu, body, splenium. Sits in the midline. */
const CALLOSUM_PTS: readonly (readonly [number, number])[] = [
  [0.031, 0.005],
  [0.034, 0.011],
  [0.028, 0.0155],
  [0.014, 0.0175],
  [0, 0.0178],
  [-0.014, 0.0175],
  [-0.028, 0.0145],
  [-0.034, 0.0085],
  [-0.032, 0.004],
];
const CALLOSUM_R: readonly number[] = [0.0028, 0.0042, 0.0034, 0.003, 0.003, 0.003, 0.0036, 0.0046, 0.0032];

/** The cingulate curve: the same C, one band higher, so the gyrus arches over the callosum. */
const CINGULATE_PTS: readonly (readonly [number, number])[] = [
  [0.034, 0.017],
  [0.03, 0.025],
  [0.016, 0.0275],
  [0, 0.0278],
  [-0.016, 0.0275],
  [-0.03, 0.022],
  [-0.034, 0.014],
];

/* ------------------------------------------------------------ cortical lobes */

/** Slab thickness: outer surface this far inside the shell, inner surface this far. */
const SLAB_OUT = 0.0035;
const SLAB_IN = 0.0105;

/** z of the central sulcus at distance `ax` from the midline: it leans forward going laterally. */
const centralZ = (ax: number): number => -0.0056 + 0.2 * ax;

/** The lateral fissure as a plane in the y-z plane: y of the fissure at a given z. */
const fissureY = (z: number): number => -0.01 + 0.21875 * (0.05 - z);

/*
 * REGIONS, signed functions of position, negative inside. They use |x| so that one
 * function serves both hemispheres. Intersection is max, subtraction is max(a, -b).
 */
const cingulateRegion = ((): Sdf => {
  const arch = arch2D(CINGULATE_PTS, [0.0055, 0.0055, 0.0055, 0.0055, 0.0055, 0.0055, 0.0055]);
  return (x, y, z) => Math.max(arch(x, y, z), Math.abs(x) - 0.0145);
})();

/** Temporal lobe: below the lateral fissure, behind the temporal pole, and lateral or posterior. */
const temporalRegion: Sdf = (x, y, z) => {
  const ax = Math.abs(x);
  return Math.max(y - fissureY(z), -0.04 - z, z - 0.06, Math.min(0.024 - ax, z - 0.02));
};

const prefrontalRegion: Sdf = (x, _y, z) => centralZ(Math.abs(x)) + 0.018 - z;
const motorRegion: Sdf = (x, y, z) => {
  const zc = centralZ(Math.abs(x));
  return Math.max(zc + 0.001 - z, z - (zc + 0.018), fissureY(z) - y);
};
const somatosensoryRegion: Sdf = (x, y, z) => {
  const zc = centralZ(Math.abs(x));
  return Math.max(zc - 0.012 - z, z - (zc - 0.001), fissureY(z) - y);
};
const parietalRegion: Sdf = (x, y, z) =>
  Math.max(z - (centralZ(Math.abs(x)) - 0.012), -0.04 - z, fissureY(z) - y);
const occipitalRegion: Sdf = (_x, _y, z) => z + 0.04;

/** The slab of one hemisphere, then a lobe cut from it, then the cingulate removed from it. */
function cortexSide(s: number, region: Sdf, min: V3, max: V3, cell: number, keepCingulate = false): THREE.BufferGeometry {
  const slab = subtract(offset(hemisphereWrinkled(s), -SLAB_OUT), offset(hemisphereCut(s), -SLAB_IN));
  let field = intersect(slab, region);
  if (!keepCingulate) field = subtract(field, cingulateRegion);
  return polygonise(field, min, max, { cell });
}

/** Both hemispheres of a lobe, merged. `x0..x1` are the box in |x|; z and y are shared. */
function cortex(region: Sdf, y: [number, number], z: [number, number], cell: number, keepCingulate = false): THREE.BufferGeometry {
  const sides: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    const lo = s > 0 ? 0 : -0.074;
    const hi = s > 0 ? 0.074 : 0;
    sides.push(cortexSide(s, region, [lo, y[0], z[0]], [hi, y[1], z[1]], cell, keepCingulate));
  }
  return mergeParts(sides);
}

/** The cingulate gyrus: the medial slab within a band round the cingulate curve. */
function cingulate(cell: number): THREE.BufferGeometry {
  const sides: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    sides.push(
      cortexSide(s, cingulateRegion, [s > 0 ? 0 : -0.02, 0.01, -0.05], [s > 0 ? 0.02 : 0, 0.045, 0.05], cell, true),
    );
  }
  return mergeParts(sides);
}

/* --------------------------------------------------------------- deep parts */

/** Run a field once per side and merge, for bilateral structures that are not in contact. */
function bilateral(make: (s: number) => THREE.BufferGeometry): THREE.BufferGeometry {
  return mergeParts([make(1), make(-1)]);
}

function corpusCallosum(): THREE.BufferGeometry {
  // A curved band, widest in the body, narrowing to the genu and the splenium; the limiter
  // ellipsoid rounds its lateral edges so it reads as a fan of fibres, not a plank.
  const band = intersect(arch2D(CALLOSUM_PTS, CALLOSUM_R), ellipsoid([0, 0.011, 0], [0.0155, 0.04, 0.046]));
  return polygonise(band, [-0.02, -0.005, -0.045], [0.02, 0.03, 0.045], { cell: 0.0013 });
}

function thalamus(): THREE.BufferGeometry {
  const oval = (s: number): Sdf => ellipsoid([s * 0.0105, 0, -0.008], [0.0075, 0.0085, 0.0135]);
  // The interthalamic adhesion: the grey bridge that crosses the third ventricle in most brains.
  const adhesion = capsule([-0.006, 0.0, -0.004], [0.006, 0.0, -0.004], 0.0025);
  return polygonise(smoothUnion(0.003, oval(1), oval(-1), adhesion), [-0.022, -0.014, -0.03], [0.022, 0.014, 0.012], {
    cell: 0.0013,
  });
}

function hypothalamus(): THREE.BufferGeometry {
  const half = (s: number): Sdf =>
    smoothUnion(
      0.002,
      ellipsoid([s * 0.0045, -0.012, 0.004], [0.0045, 0.0035, 0.007]),
      // Mammillary body: the small round swelling at the back of the floor of the hypothalamus.
      ellipsoid([s * 0.0032, -0.0148, -0.0045], [0.0025, 0.0025, 0.0025]),
    );
  return polygonise(smoothUnion(0.003, half(1), half(-1)), [-0.012, -0.022, -0.012], [0.012, -0.006, 0.016], {
    cell: 0.0008,
  });
}

function pituitary(): THREE.BufferGeometry {
  const stalk = tubeAlong(
    [
      [0, -0.0145, 0.007],
      [0, -0.0185, 0.0082],
      [0, -0.0225, 0.0092],
    ],
    (t) => 0.0011 - 0.0003 * t,
    { tubular: 10, radial: 8 },
  );
  // The gland itself: wider than it is tall, as it sits in its bony fossa.
  const gland = polygonise(ellipsoid([0, -0.0265, 0.0095], [0.0055, 0.0035, 0.0045]), [-0.009, -0.032, 0.003], [0.009, -0.021, 0.016], {
    cell: 0.0006,
  });
  return mergeParts([stalk, gland]);
}

function pineal(): THREE.BufferGeometry {
  return polygonise(ellipsoid([0, -0.0005, -0.0285], [0.003, 0.003, 0.0042]), [-0.006, -0.005, -0.034], [0.006, 0.005, -0.023], {
    cell: 0.0005,
  });
}

function hippocampus(): THREE.BufferGeometry {
  // A seahorse: head forward in the medial temporal lobe, body curving back and UP round the
  // thalamus, tail rising towards the splenium where the fornix begins.
  const path: V3[] = [
    [0.03, -0.032, 0.02],
    [0.034, -0.027, 0.008],
    [0.035, -0.02, -0.008],
    [0.032, -0.01, -0.022],
    [0.026, 0.0, -0.03],
    [0.021, 0.007, -0.03],
  ];
  return bilateral((s) =>
    tubeAlong(
      path.map((p): V3 => [s * p[0], p[1], p[2]]),
      (t) => 0.0046 - 0.0024 * t,
      { tubular: 48, radial: 12 },
    ),
  );
}

function amygdala(): THREE.BufferGeometry {
  return bilateral((s) =>
    polygonise(ellipsoid([s * 0.03, -0.026, 0.027], [0.005, 0.005, 0.0065]), [s * 0.03 - 0.01, -0.036, 0.016], [s * 0.03 + 0.01, -0.016, 0.038], {
      cell: 0.0006,
    }),
  );
}

function basalGanglia(): THREE.BufferGeometry {
  // Caudate: a comma, fat head beside the frontal horn, body arching up and back over the
  // thalamus, thin tail following the temporal horn down towards the amygdala.
  const caudate: V3[] = [
    [0.0165, 0.0155, 0.026],
    [0.0185, 0.0225, 0.012],
    [0.0205, 0.0235, -0.004],
    [0.0235, 0.0185, -0.018],
    [0.0275, 0.006, -0.022],
    [0.0305, -0.008, -0.012],
    [0.031, -0.014, 0.002],
  ];
  const radii = [0.0058, 0.0052, 0.0042, 0.003, 0.0022, 0.0016, 0.0014];
  return bilateral((s) => {
    const tail = tubeAlong(
      caudate.map((p): V3 => [s * p[0], p[1], p[2]]),
      (t) => {
        const f = t * (radii.length - 1);
        const i = Math.min(radii.length - 2, Math.floor(f));
        return radii[i] + (radii[i + 1] - radii[i]) * (f - i);
      },
      { tubular: 56, radial: 10 },
    );
    // Putamen: the lens-shaped nucleus lateral to the internal capsule.
    const putamen = polygonise(ellipsoid([s * 0.028, 0.0, 0.008], [0.0055, 0.01, 0.016]), [s * 0.028 - 0.009, -0.014, -0.01], [s * 0.028 + 0.009, 0.014, 0.026], {
      cell: 0.0012,
    });
    return mergeParts([tail, putamen]);
  });
}

function nucleusAccumbens(): THREE.BufferGeometry {
  return bilateral((s) =>
    polygonise(ellipsoid([s * 0.0115, 0.008, 0.027], [0.0045, 0.0042, 0.0045]), [s * 0.0115 - 0.008, 0.001, 0.02], [s * 0.0115 + 0.008, 0.015, 0.034], {
      cell: 0.0006,
    }),
  );
}

function insula(): THREE.BufferGeometry {
  // A shallow plate of cortex tucked deep to the lateral fissure.
  return bilateral((s) =>
    polygonise(ellipsoid([s * 0.05, -0.003, 0.012], [0.004, 0.012, 0.017]), [s * 0.05 - 0.008, -0.018, -0.008], [s * 0.05 + 0.008, 0.012, 0.032], {
      cell: 0.0009,
    }),
  );
}

/* ---------------------------------------------------------- stem, cerebellum */

function midbrain(): THREE.BufferGeometry {
  return polygonise(capsule([0, -0.014, -0.0125], [0, -0.034, -0.0145], 0.0095, 0.009), [-0.014, -0.046, -0.028], [0.014, -0.002, 0.0], {
    cell: 0.0011,
  });
}

function pons(): THREE.BufferGeometry {
  // The anterior bulge of the pons carries the transverse fibres across to the cerebellum.
  return polygonise(ellipsoid([0, -0.0475, -0.007], [0.0145, 0.0105, 0.0125]), [-0.02, -0.06, -0.024], [0.02, -0.034, 0.01], {
    cell: 0.0011,
  });
}

function medulla(): THREE.BufferGeometry {
  return polygonise(capsule([0, -0.0575, -0.019], [0, -0.084, -0.0255], 0.0078, 0.0055), [-0.012, -0.092, -0.036], [0.012, -0.05, -0.008], {
    cell: 0.0009,
  });
}

function cerebellum(): THREE.BufferGeometry {
  // Same recipe as the shell's cerebellum, shrunk 1.6 mm, with the folia at 0.7 of their
  // amplitude so the leaves stay inside the shell's own leaves.
  const lobe = (s: number): Sdf => ellipsoid([s * 0.027, -0.044, -0.046], [0.0284, 0.0194, 0.0254]);
  const vermis = ellipsoid([0, -0.043, -0.05], [0.0104, 0.0174, 0.0244]);
  const body = smoothUnion(0.008, lobe(1), lobe(-1), vermis);
  const folia = displaced(body, (_x, y, z) => 0.0008 * Math.sin((y + z * 0.35) * 950));
  return polygonise(folia, [-0.062, -0.068, -0.078], [0.062, -0.022, -0.016], { cell: 0.0016 });
}

/* ------------------------------------------------------------------- export */

export const parts: PartBuilder = (): PartGeometry[] => {
  const g = (id: string, geometry: THREE.BufferGeometry): PartGeometry => ({ id, geometry });
  const cell = 0.0026;
  return [
    g('prefrontal_cortex', cortex(prefrontalRegion, [-0.03, 0.06], [0.0, 0.084], cell)),
    g('motor_cortex', cortex(motorRegion, [-0.01, 0.06], [-0.012, 0.03], cell)),
    g('somatosensory_cortex', cortex(somatosensoryRegion, [-0.01, 0.06], [-0.03, 0.01], cell)),
    g('parietal_lobe', cortex(parietalRegion, [-0.01, 0.06], [-0.045, 0.0], cell)),
    g('temporal_lobe', cortex(temporalRegion, [-0.056, 0.01], [-0.045, 0.062], cell)),
    g('occipital_lobe', cortex(occipitalRegion, [-0.04, 0.052], [-0.086, -0.036], cell)),
    g('insula', insula()),
    g('cingulate_cortex', cingulate(0.0022)),
    g('corpus_callosum', corpusCallosum()),
    g('thalamus', thalamus()),
    g('hypothalamus', hypothalamus()),
    g('pituitary', pituitary()),
    g('pineal', pineal()),
    g('hippocampus', hippocampus()),
    g('amygdala', amygdala()),
    g('basal_ganglia', basalGanglia()),
    g('nucleus_accumbens', nucleusAccumbens()),
    g('midbrain', midbrain()),
    g('pons', pons()),
    g('medulla', medulla()),
    g('cerebellum', cerebellum()),
  ];
};

// `union` is imported for symmetry with the other atlases; keep the reference so the
// import list stays honest if a part later needs a plain union.
void union;
