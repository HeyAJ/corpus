import * as THREE from 'three';
import type { PartBuilder, PartGeometry } from '../parts';
import {
  boundsOf,
  capsule,
  displaced,
  ellipsoid,
  intersect,
  mergeParts,
  offset,
  polygonise,
  smoothSubtract,
  smoothUnion,
  sphere,
  subtract,
  tubeAlong,
  union,
} from '../sdf';
import type { Sdf, V3 } from '../sdf';

/**
 * INTERIOR OF THE BRAIN: twenty-one parts that sit inside the shell built by `brain()` in
 * ../models.ts, in the same frame (origin at the organ's position, +x the patient's right,
 * +y cranial, +z anterior, metres).
 *
 * HOW THE CORTEX IS MADE. The shell is two hemispheres (a smooth union of four ellipsoids
 * each), cut by the lateral fissure and the central sulcus, and then wrinkled by a ridged
 * noise that moves the surface inward by up to about 4 mm. This file rebuilds the smooth,
 * cut hemisphere and makes a cortical part a curved slab 7 mm thick whose outer face is
 * 4.5 mm inside it, so the slab stays inside the wrinkled shell. The wrinkles themselves
 * are NOT repeated: they multiply the surface area, and with it the triangle count,
 * about threefold, which the budget for this showcase cannot afford (the 3 mm grid
 * that fits the budget could not resolve them anyway).
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
const SLAB_OUT = 0.0045;
const SLAB_IN = 0.0125;

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
function cortexSide(
  s: number,
  region: Sdf,
  min: V3,
  max: V3,
  cell: number,
  keepCingulate = false,
  slabOut = SLAB_OUT,
  slabIn = SLAB_IN,
): THREE.BufferGeometry {
  const slab = subtract(offset(hemisphereCut(s), -slabOut), offset(hemisphereCut(s), -slabIn));
  let field = intersect(slab, region);
  if (!keepCingulate) field = subtract(field, cingulateRegion);
  return polygonise(field, min, max, { cell });
}

/** Both hemispheres of a lobe, merged. `x0..x1` are the box in |x|; z and y are shared. */
function cortex(
  region: Sdf,
  y: [number, number],
  z: [number, number],
  cell: number,
  keepCingulate = false,
  slabOut = SLAB_OUT,
  slabIn = SLAB_IN,
): THREE.BufferGeometry {
  const sides: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    const lo = s > 0 ? 0 : -0.074;
    const hi = s > 0 ? 0.074 : 0;
    sides.push(cortexSide(s, region, [lo, y[0], z[0]], [hi, y[1], z[1]], cell, keepCingulate, slabOut, slabIn));
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
  return polygonise(band, [-0.02, -0.005, -0.045], [0.02, 0.03, 0.045], { cell: 0.003 });
}

function thalamus(): THREE.BufferGeometry {
  const oval = (s: number): Sdf => ellipsoid([s * 0.0105, 0, -0.008], [0.0075, 0.0085, 0.0135]);
  // The interthalamic adhesion: the grey bridge that crosses the third ventricle in most brains.
  const adhesion = capsule([-0.006, 0.0, -0.004], [0.006, 0.0, -0.004], 0.0025);
  return polygonise(smoothUnion(0.003, oval(1), oval(-1), adhesion), [-0.022, -0.014, -0.03], [0.022, 0.014, 0.012], {
    cell: 0.0022,
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
    cell: 0.0016,
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
    cell: 0.0012,
  });
  return mergeParts([stalk, gland]);
}

function pineal(): THREE.BufferGeometry {
  return polygonise(ellipsoid([0, -0.0005, -0.0285], [0.003, 0.003, 0.0042]), [-0.006, -0.005, -0.034], [0.006, 0.005, -0.023], {
    cell: 0.001,
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
      { tubular: 36, radial: 8 },
    ),
  );
}

function amygdala(): THREE.BufferGeometry {
  return bilateral((s) =>
    polygonise(ellipsoid([s * 0.03, -0.026, 0.027], [0.005, 0.005, 0.0065]), [s * 0.03 - 0.01, -0.036, 0.016], [s * 0.03 + 0.01, -0.016, 0.038], {
      cell: 0.0018,
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
      { tubular: 40, radial: 8 },
    );
    // Putamen: the lens-shaped nucleus lateral to the internal capsule.
    const putamen = polygonise(ellipsoid([s * 0.028, 0.0, 0.008], [0.0055, 0.01, 0.016]), [s * 0.028 - 0.009, -0.014, -0.01], [s * 0.028 + 0.009, 0.014, 0.026], {
      cell: 0.003,
    });
    return mergeParts([tail, putamen]);
  });
}

function nucleusAccumbens(): THREE.BufferGeometry {
  return bilateral((s) =>
    polygonise(ellipsoid([s * 0.0115, 0.008, 0.027], [0.0045, 0.0042, 0.0045]), [s * 0.0115 - 0.008, 0.001, 0.02], [s * 0.0115 + 0.008, 0.015, 0.034], {
      cell: 0.0016,
    }),
  );
}

function insula(): THREE.BufferGeometry {
  // A shallow plate of cortex tucked deep to the lateral fissure.
  return bilateral((s) =>
    polygonise(ellipsoid([s * 0.05, -0.003, 0.012], [0.004, 0.012, 0.017]), [s * 0.05 - 0.008, -0.018, -0.008], [s * 0.05 + 0.008, 0.012, 0.032], {
      cell: 0.0025,
    }),
  );
}

/* ---------------------------------------------------------- stem, cerebellum */

function midbrain(): THREE.BufferGeometry {
  return polygonise(capsule([0, -0.014, -0.0125], [0, -0.034, -0.0145], 0.0095, 0.009), [-0.014, -0.046, -0.028], [0.014, -0.002, 0.0], {
    cell: 0.0025,
  });
}

function pons(): THREE.BufferGeometry {
  // The anterior bulge of the pons carries the transverse fibres across to the cerebellum.
  return polygonise(ellipsoid([0, -0.0475, -0.007], [0.0145, 0.0105, 0.0125]), [-0.02, -0.06, -0.024], [0.02, -0.034, 0.01], {
    cell: 0.0025,
  });
}

function medulla(): THREE.BufferGeometry {
  return polygonise(capsule([0, -0.0575, -0.019], [0, -0.084, -0.0255], 0.0078, 0.0055), [-0.012, -0.092, -0.036], [0.012, -0.05, -0.008], {
    cell: 0.0022,
  });
}

function cerebellum(): THREE.BufferGeometry {
  // Same recipe as the shell's cerebellum, shrunk 1.6 mm, with the folia at 0.7 of their
  // amplitude so the leaves stay inside the shell's own leaves.
  const lobe = (s: number): Sdf => ellipsoid([s * 0.027, -0.044, -0.046], [0.0284, 0.0194, 0.0254]);
  const vermis = ellipsoid([0, -0.043, -0.05], [0.0104, 0.0174, 0.0244]);
  const body = smoothUnion(0.008, lobe(1), lobe(-1), vermis);
  const folia = displaced(body, (_x, y, z) => 0.0008 * Math.sin((y + z * 0.35) * 950));
  return polygonise(folia, [-0.062, -0.068, -0.078], [0.062, -0.022, -0.016], { cell: 0.004 });
}

/* ================================================================ FINER STRUCTURES */

/*
 * THE TEXTBOOK-DEPTH LAYER (added with the structures-within-structures work).
 *
 * Everything below is drawn from cheap primitives on purpose. The first twenty-one parts spend
 * about forty thousand triangles, and the contract for children is that an atlas may roughly
 * double that and no more, so a nucleus is a low-poly ellipsoid (about a hundred triangles), a
 * nerve or vessel is a thin tube, and only the things that really are surfaces (the cortical
 * areas, the sulci, the meninges, the callosal segments) are polygonised, on coarse grids.
 *
 * WHAT IT IS NOT. Every position is chosen by eye from the relations the anatomy texts give and
 * is NOT a traced atlas. The deep structures are packed more tightly than in life because the
 * ventricles were not drawn when the first parts were laid out, and a few things are drawn
 * larger than life so that they can be seen at all: the cell clusters in the pituitary and the
 * layers of the cortical column are MAGNIFIED SCHEMATICS (a display choice, not a scale), and
 * the cortical column is one column standing for the whole sheet. Nerves and arteries follow
 * plausible paths, not measured ones; nerves are stubs that stop where the skull's openings
 * would begin, because the skull is not drawn. Nothing here is a measurement.
 *
 * A PARENT THAT ONLY GROUPS (ventricles, cranial nerves, arterial circle, sinuses, cerebellar
 * peduncles) is drawn as its children made 30 to 40 per cent fatter, so that when the children
 * fade in (reveal.ts) their surfaces sit inside the parent's and never z-fight with it.
 */

const unit = new THREE.Vector3(0, 1, 0);

/** An ellipsoid from a low-poly sphere. Normals are transformed with the matrix, so the seam stays smooth. */
function blob(c: V3, r: V3, w = 10, h = 7): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, w, h);
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(c[0], c[1], c[2]), new THREE.Quaternion(), new THREE.Vector3(r[0], r[1], r[2])));
  return g;
}
const ball = (c: V3, r: number, w = 10, h = 7): THREE.BufferGeometry => blob(c, [r, r, r], w, h);

const mir = (pts: readonly V3[], s: number): V3[] => pts.map((p): V3 => [s * p[0], p[1], p[2]]);
const both = (make: (s: number) => THREE.BufferGeometry): THREE.BufferGeometry => mergeParts([make(1), make(-1)]);

/** A piecewise-linear radius along a tube, `radii` spread evenly over t in 0..1. */
function lin(radii: readonly number[], k = 1): (t: number) => number {
  if (radii.length === 1) return () => k * radii[0];
  return (t) => {
    const f = Math.min(radii.length - 1.000001, Math.max(0, t * (radii.length - 1)));
    const i = Math.floor(f);
    return k * (radii[i] + (radii[i + 1] - radii[i]) * (f - i));
  };
}
function tube(pts: readonly V3[], radii: readonly number[], k = 1, radial = 5): THREE.BufferGeometry {
  // A grouping parent (k above 1) is only ever seen from far away, behind its children, so it
  // gets half the rings and fewer sides: this is how the interior stays under its triangle budget.
  const coarse = k > 1;
  return tubeAlong(pts, lin(radii, k), {
    tubular: Math.max(coarse ? 6 : 8, Math.round(pts.length * (coarse ? 2.5 : 4))),
    radial: coarse ? 4 : radial,
  });
}
const tube2 = (pts: readonly V3[], radii: readonly number[], k = 1): THREE.BufferGeometry =>
  both((s) => tube(mir(pts, s), radii, k));

/**
 * Walk from a point inside a field along `dir` and return the point where the field equals
 * `-depth` (that far inside the surface). The field must be negative at `from` and increase
 * along the ray; every use below starts well inside the hemisphere or the hull.
 */
function surfaceAlong(f: Sdf, from: V3, dir: V3, depth: number): V3 {
  const n = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const at = (t: number): V3 => [from[0] + (dir[0] / n) * t, from[1] + (dir[1] / n) * t, from[2] + (dir[2] / n) * t];
  let t0 = 0;
  let t1 = 0.14;
  for (let i = 0; i < 40; i++) {
    const m = 0.5 * (t0 + t1);
    const p = at(m);
    if (f(p[0], p[1], p[2]) < -depth) t0 = m;
    else t1 = m;
  }
  return at(t0);
}

/* ----------------------------------------------------------- cortical areas */

/** A named cortical area: the cortical slab inside a sphere on the surface. Same slab as the lobes, slightly thinner. */
function patch(s: number, from: V3, dir: V3, r: number, cell = 0.0034): THREE.BufferGeometry {
  const c = surfaceAlong(hemisphereCut(s), [s * from[0], from[1], from[2]], [s * dir[0], dir[1], dir[2]], 0.0085);
  const region = sphere(c, r);
  const slab = subtract(offset(hemisphereCut(s), -(SLAB_OUT + 0.0006)), offset(hemisphereCut(s), -(SLAB_IN - 0.0006)));
  return polygonise(intersect(slab, region), [c[0] - r, c[1] - r, c[2] - r], [c[0] + r, c[1] + r, c[2] + r], { cell });
}
const patches = (from: V3, dir: V3, r: number): THREE.BufferGeometry => both((s) => patch(s, from, dir, r));

/** A groove: the part of a capsule that lies inside the hemisphere, i.e. what the shell carved out. */
function groove(a: V3, b: V3, r: number, cell: number): THREE.BufferGeometry {
  return both((s) => {
    const A: V3 = [s * a[0], a[1], a[2]];
    const B: V3 = [s * b[0], b[1], b[2]];
    const field = intersect(capsule(A, B, r), offset(hemisphereBase(s), -0.0012));
    const box = boundsOf([A, B], r + 0.003);
    return polygonise(field, box.min, box.max, { cell });
  });
}

/** One schematic cortical column: six thin discs stacked along the surface normal. */
function corticalLayers(): THREE.BufferGeometry[] {
  const f = hemisphereCut(1);
  const top = surfaceAlong(f, [0.0335, 0.03, -0.0036], [0.3, 0.95, 0], 0.0045);
  const e = 0.0006;
  const n = new THREE.Vector3(
    f(top[0] + e, top[1], top[2]) - f(top[0] - e, top[1], top[2]),
    f(top[0], top[1] + e, top[2]) - f(top[0], top[1] - e, top[2]),
    f(top[0], top[1], top[2] + e) - f(top[0], top[1], top[2] - e),
  ).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(unit, n);
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    // Display choices: a 1.1 mm disc every 1.25 mm of depth, 3.4 mm across, one per layer.
    const depth = 0.0052 + i * 0.00125;
    const c = new THREE.Vector3(top[0], top[1], top[2]).addScaledVector(n, -(depth - 0.0045));
    const g = new THREE.CylinderGeometry(0.0034, 0.0034, 0.0011, 16, 1);
    g.applyMatrix4(new THREE.Matrix4().compose(c, q, new THREE.Vector3(1, 1, 1)));
    out.push(g);
  }
  return out;
}

/* ------------------------------------------------------------- the hull, meninges */

/** The smooth outer envelope of the brain (the shell without its wrinkles). */
function brainHull(bridge: boolean): Sdf {
  const cer = smoothUnion(
    0.008,
    ellipsoid([0.027, -0.044, -0.046], [0.03, 0.021, 0.027]),
    ellipsoid([-0.027, -0.044, -0.046], [0.03, 0.021, 0.027]),
    ellipsoid([0, -0.043, -0.05], [0.012, 0.019, 0.026]),
  );
  const stem = smoothUnion(
    0.004,
    capsule([0, -0.012, -0.012], [0, -0.032, -0.014], 0.0115, 0.011),
    ellipsoid([0, -0.045, -0.008], [0.0165, 0.0135, 0.014]),
    capsule([0, -0.056, -0.018], [0, -0.086, -0.026], 0.0095, 0.007),
  );
  const cerebrum = union(hemisphereBase(1), hemisphereBase(-1), ellipsoid([0, -0.012, -0.004], [0.02, 0.024, 0.05]));
  // The dura bridges the cleft between the hemispheres as the falx cerebri; the pia and arachnoid do not
  // need it (the pia follows the cortex into the cleft), so the bridge is optional.
  const body = smoothUnion(0.005, cerebrum, cer, stem);
  return bridge ? union(body, ellipsoid([0, 0.025, -0.004], [0.012, 0.03, 0.07])) : body;
}
const HULL_TIGHT = brainHull(false);
const HULL_DURA = brainHull(true);

/**
 * One meningeal layer: the hull pushed out by `d`. Coarse grid on purpose (the field is smooth and
 * each layer would otherwise cost several thousand triangles). The layers are 1.2, 3.0 and 5.0 mm
 * out and the grouping part 6.8 mm: display spacings that keep them apart, not membrane thicknesses.
 */
function meningeal(hull: Sdf, d: number, cell = 0.012): THREE.BufferGeometry {
  return polygonise(offset(hull, d), [-0.085, -0.105, -0.1], [0.085, 0.075, 0.098], { cell });
}

/** y of the top of a field at (x, z): the highest point where it is negative. */
function topY(f: Sdf, x: number, z: number): number {
  let y = 0.09;
  while (y > -0.1 && f(x, y, z) > 0) y -= 0.0008;
  return y;
}

/* ----------------------------------------------------------------- ventricles */

const LV_MAIN: V3[] = [
  [0.0065, 0.0065, 0.034],
  [0.007, 0.0085, 0.022],
  [0.0105, 0.0115, 0.007],
  [0.0135, 0.0125, -0.009],
  [0.0185, 0.0105, -0.023],
  [0.0205, 0.007, -0.037],
  [0.0195, 0.004, -0.049],
];
const LV_MAIN_R = [0.0016, 0.0033, 0.0032, 0.003, 0.0036, 0.0024, 0.0013];
const LV_TEMPORAL: V3[] = [
  [0.0215, 0.0075, -0.024],
  [0.03, -0.003, -0.023],
  [0.037, -0.0105, -0.0125],
  [0.0375, -0.0125, 0.0],
  [0.036, -0.0135, 0.01],
];
const LV_TEMPORAL_R = [0.0024, 0.0022, 0.002, 0.0017, 0.0013];
const FORAMEN: V3[] = [
  [0.0075, 0.0095, 0.0075],
  [0.0035, 0.0075, 0.0062],
  [0.0006, 0.0062, 0.0052],
];
const AQUEDUCT: V3[] = [
  [0, -0.0075, -0.0105],
  [0, -0.0155, -0.0135],
  [0, -0.03, -0.0165],
  [0, -0.0395, -0.0205],
];

function ventricles(k: number): Record<string, THREE.BufferGeometry> {
  return {
    lateral: both((s) => mergeParts([tube(mir(LV_MAIN, s), LV_MAIN_R, k, 6), tube(mir(LV_TEMPORAL, s), LV_TEMPORAL_R, k, 6)])),
    third: blob([0, -0.001, -0.001], [0.0011 * k, 0.0095 * k, 0.0105 * k], 10, 8),
    fourth: blob([0, -0.05, -0.0225], [0.0058 * k, 0.0075 * k, 0.003 * k], 10, 8),
    aqueduct: tube(AQUEDUCT, [0.0009], k, 6),
    foramina: tube2(FORAMEN, [0.0009], k),
  };
}

function choroidPlexus(): THREE.BufferGeometry {
  return mergeParts([
    both((s) =>
      mergeParts([
        tube(
          mir(
            [
              [0.0135, 0.0095, 0.004],
              [0.016, 0.0105, -0.01],
              [0.0205, 0.0085, -0.022],
            ],
            s,
          ),
          [0.0012, 0.0014, 0.0013],
          1,
          4,
        ),
        // The glomus: the bulky tuft in the atrium of the lateral ventricle.
        ball([s * 0.0205, 0.0085, -0.0245], 0.0024),
      ]),
    ),
    tube(
      [
        [0, 0.0078, 0.004],
        [0, 0.0078, -0.006],
      ],
      [0.0011],
    ),
    blob([0, -0.0515, -0.0235], [0.003, 0.003, 0.0012]),
  ]);
}

/* ------------------------------------------------------------------ vessels */

const SSS_Z: readonly number[] = [0.062, 0.04, 0.015, -0.01, -0.035, -0.058, -0.076];
const sagittalSinus = (k: number): THREE.BufferGeometry => {
  const pts: V3[] = SSS_Z.map((z): V3 => [0, topY(offset(HULL_DURA, 0.0028), 0, z), z]);
  return tube(pts, [0.0017], k, 6);
};
const SINUS_PATHS = {
  inferior: [
    [0, 0.0345, 0.03],
    [0, 0.0365, 0.008],
    [0, 0.0345, -0.016],
    [0, 0.029, -0.032],
  ] as V3[],
  straight: [
    [0, 0.026, -0.034],
    [0, 0.014, -0.044],
    [0, 0.006, -0.062],
    [0, -0.002, -0.079],
  ] as V3[],
  transverse: [
    [0, -0.002, -0.0785],
    [0.02, -0.009, -0.0745],
    [0.04, -0.0155, -0.06],
    [0.0555, -0.0225, -0.043],
  ] as V3[],
  sigmoid: [
    [0.0555, -0.0225, -0.043],
    [0.0585, -0.03, -0.035],
    [0.0575, -0.04, -0.0345],
    [0.052, -0.052, -0.033],
    [0.046, -0.062, -0.028],
  ] as V3[],
  cavernous: [
    [0.0125, -0.0305, 0.0045],
    [0.0125, -0.0295, 0.0135],
  ] as V3[],
};
function sinuses(k: number): Record<string, THREE.BufferGeometry> {
  return {
    superior: sagittalSinus(k),
    inferior: tube(SINUS_PATHS.inferior, [0.0012], k, 6),
    straight: tube(SINUS_PATHS.straight, [0.0016], k, 6),
    transverse: tube2(SINUS_PATHS.transverse, [0.002, 0.002], k),
    sigmoid: tube2(SINUS_PATHS.sigmoid, [0.0022, 0.0022], k),
    cavernous: tube2(SINUS_PATHS.cavernous, [0.0028], k),
  };
}

const ART = {
  ica: [
    [0.0215, -0.0425, 0.0035],
    [0.0175, -0.0335, 0.0105],
    [0.0145, -0.0265, 0.0158],
    [0.0135, -0.0225, 0.0195],
  ] as V3[],
  vertebral: [
    [0.0105, -0.082, -0.0165],
    [0.0085, -0.072, -0.0155],
    [0.0045, -0.0635, -0.0125],
    [0.0005, -0.0565, -0.0078],
  ] as V3[],
  basilar: [
    [0, -0.0565, -0.0075],
    [0, -0.052, 0.0005],
    [0, -0.0465, 0.0045],
    [0, -0.04, 0.0035],
    [0, -0.0345, -0.0065],
  ] as V3[],
  aca: [
    [0.0135, -0.0225, 0.0195],
    [0.0085, -0.0185, 0.0235],
    [0.0035, -0.0165, 0.025],
    [0.0028, -0.012, 0.0335],
    [0.0025, 0.001, 0.041],
    [0.0025, 0.0125, 0.042],
    [0.0025, 0.0225, 0.034],
    [0.0025, 0.0238, 0.015],
    [0.0025, 0.023, -0.002],
  ] as V3[],
  mca: [
    [0.0135, -0.0225, 0.0195],
    [0.024, -0.0225, 0.0195],
    [0.036, -0.018, 0.0175],
    [0.046, -0.0105, 0.0145],
    [0.0545, -0.002, 0.0105],
  ] as V3[],
  pca: [
    [0.0015, -0.0335, -0.0075],
    [0.0085, -0.032, -0.0075],
    [0.015, -0.0305, -0.0115],
    [0.0215, -0.0265, -0.0185],
    [0.0245, -0.0155, -0.034],
    [0.0215, -0.0035, -0.05],
  ] as V3[],
  pcom: [
    [0.0135, -0.0265, 0.0145],
    [0.0125, -0.0295, 0.004],
    [0.0095, -0.0315, -0.0065],
  ] as V3[],
  acom: [
    [-0.0035, -0.0165, 0.025],
    [0.0035, -0.0165, 0.025],
  ] as V3[],
};
function arteries(k: number): Record<string, THREE.BufferGeometry> {
  return {
    ica: tube2(ART.ica, [0.0019, 0.0017, 0.0015, 0.0014], k),
    vertebral: tube2(ART.vertebral, [0.0014], k),
    basilar: tube(ART.basilar, [0.0016, 0.0017, 0.0016, 0.0015, 0.0014], k),
    aca: tube2(ART.aca, [0.0012], k),
    mca: tube2(ART.mca, [0.0015, 0.0014, 0.0012, 0.0011, 0.001], k),
    pca: tube2(ART.pca, [0.0013, 0.0012, 0.0011, 0.001, 0.0009, 0.0008], k),
    comm: mergeParts([tube2(ART.pcom, [0.0008], k), tube(ART.acom, [0.0008], k)]),
  };
}

/* ------------------------------------------------------------- cranial nerves */

interface Nerve {
  pts: V3[];
  r: number[];
  extra?: (s: number, k: number) => THREE.BufferGeometry;
}
const NERVES: Record<string, Nerve> = {
  cn_i_olfactory: { pts: [], r: [] }, // built specially: it follows the surface of the frontal lobe
  cn_ii_optic: {
    pts: [
      [0.0045, -0.0155, 0.0185],
      [0.0075, -0.0165, 0.0235],
      [0.0095, -0.018, 0.0285],
    ],
    r: [0.0018],
  },
  cn_iii_oculomotor: {
    pts: [
      [0.003, -0.0265, -0.003],
      [0.0075, -0.0275, 0.006],
      [0.012, -0.0305, 0.0145],
    ],
    r: [0.0011],
  },
  cn_iv_trochlear: {
    pts: [
      [0.002, -0.031, -0.0215],
      [0.0095, -0.0345, -0.0185],
      [0.0135, -0.037, -0.006],
      [0.0155, -0.038, 0.01],
    ],
    r: [0.0006],
  },
  cn_v_trigeminal: {
    pts: [
      [0.0145, -0.0465, -0.0105],
      [0.0215, -0.0475, -0.004],
      [0.0285, -0.0475, 0.0045],
    ],
    r: [0.0026, 0.002, 0.0017],
    extra: (s, k) => blob([s * 0.0315, -0.0475, 0.0065], [0.0032 * k, 0.0022 * k, 0.0035 * k]),
  },
  cn_vi_abducens: {
    pts: [
      [0.003, -0.0545, -0.002],
      [0.0042, -0.049, 0.012],
      [0.0072, -0.04, 0.0225],
    ],
    r: [0.0008],
  },
  cn_vii_facial: {
    pts: [
      [0.0135, -0.0565, -0.0125],
      [0.024, -0.0575, -0.003],
      [0.032, -0.057, 0.0],
    ],
    r: [0.0009],
  },
  cn_viii_vestibulocochlear: {
    pts: [
      [0.0145, -0.0585, -0.015],
      [0.027, -0.06, -0.012],
      [0.036, -0.059, -0.008],
    ],
    r: [0.0014],
  },
  cn_ix_glossopharyngeal: {
    pts: [
      [0.009, -0.065, -0.017],
      [0.016, -0.068, -0.0145],
      [0.022, -0.0705, -0.012],
    ],
    r: [0.0009],
  },
  cn_x_vagus: {
    pts: [
      [0.0085, -0.069, -0.019],
      [0.0145, -0.0735, -0.0165],
      [0.021, -0.0765, -0.014],
    ],
    r: [0.0012],
  },
  cn_xi_accessory: {
    pts: [
      [0.006, -0.083, -0.0245],
      [0.0125, -0.0845, -0.0225],
      [0.0195, -0.0855, -0.02],
    ],
    r: [0.0009],
  },
  cn_xii_hypoglossal: {
    pts: [
      [0.0042, -0.068, -0.0085],
      [0.0085, -0.073, -0.0045],
      [0.0125, -0.0765, -0.0015],
    ],
    r: [0.001],
  },
};
function olfactory(k: number): THREE.BufferGeometry {
  // The tract lies in a groove on the underside of the frontal lobe, so it is placed on the hull's
  // underside by walking down from inside the lobe; the bulb is the swelling at its front end.
  const pts: V3[] = [0.03, 0.044, 0.056].map((z) => surfaceAlong(HULL_TIGHT, [0.011, -0.004, z], [0, -1, 0], 0.0012));
  const bulb = surfaceAlong(HULL_TIGHT, [0.011, -0.004, 0.066], [0, -1, 0], 0.0006);
  return both((s) => mergeParts([tube(mir(pts, s), [0.0014], k), blob([s * bulb[0], bulb[1], bulb[2]], [0.003 * k, 0.0024 * k, 0.005 * k])]));
}
function nerves(k: number): Record<string, THREE.BufferGeometry> {
  const out: Record<string, THREE.BufferGeometry> = {};
  for (const [id, n] of Object.entries(NERVES)) {
    if (id === 'cn_i_olfactory') {
      out[id] = olfactory(k);
      continue;
    }
    out[id] = both((s) => {
      const t = tube(mir(n.pts, s), n.r, k);
      return n.extra ? mergeParts([t, n.extra(s, k)]) : t;
    });
  }
  return out;
}

/* --------------------------------------------------------- brainstem structures */

function brainstemNuclei(): Record<string, THREE.BufferGeometry> {
  const RET: V3[] = [
    [0.0035, -0.079, -0.0225],
    [0.0035, -0.058, -0.017],
    [0.0035, -0.044, -0.012],
    [0.0035, -0.032, -0.0125],
    [0.0035, -0.018, -0.011],
  ];
  const RAPHE: V3[] = [
    [0, -0.08, -0.0235],
    [0, -0.062, -0.0185],
    [0, -0.0475, -0.0135],
    [0, -0.034, -0.0125],
    [0, -0.022, -0.0115],
  ];
  return {
    cerebral_peduncles: tube2(
      [
        [0.005, -0.034, -0.0085],
        [0.0075, -0.024, -0.007],
        [0.0105, -0.0135, -0.0045],
      ],
      [0.0024, 0.0028, 0.0026],
    ),
    superior_colliculi: both((s) => blob([s * 0.0035, -0.0185, -0.0205], [0.0027, 0.0024, 0.0024])),
    inferior_colliculi: both((s) => blob([s * 0.0036, -0.0285, -0.0198], [0.0028, 0.0024, 0.0024])),
    substantia_nigra: both((s) => blob([s * 0.007, -0.0235, -0.0095], [0.0028, 0.0085, 0.0018], 8, 8)),
    red_nucleus: both((s) => ball([s * 0.0035, -0.023, -0.0125], 0.003)),
    reticular_formation: tube2(RET, [0.0016, 0.002, 0.0022, 0.002, 0.0016]),
    locus_coeruleus: both((s) => blob([s * 0.003, -0.0475, -0.0155], [0.0012, 0.0035, 0.0012], 8, 8)),
    raphe_nuclei: tube(RAPHE, [0.0011, 0.0013, 0.0013, 0.0012, 0.001]),
    ventral_tegmental_area: both((s) => ball([s * 0.0025, -0.0215, -0.0072], 0.002, 8, 6)),
  };
}

/* ------------------------------------------------------------- deep structures */

const HIPPO_PATH: V3[] = [
  [0.03, -0.032, 0.02],
  [0.034, -0.027, 0.008],
  [0.035, -0.02, -0.008],
  [0.032, -0.01, -0.022],
  [0.026, 0.0, -0.03],
  [0.021, 0.007, -0.03],
];
/** A subfield: the hippocampal curve offset across its section by (dx, dy), as a fraction of its radius. */
function subfield(dx: number, dy: number, rf: number): THREE.BufferGeometry {
  return both((s) => {
    const pts = HIPPO_PATH.map((p, i): V3 => {
      const r = 0.0046 - 0.0024 * (i / (HIPPO_PATH.length - 1));
      return [s * (p[0] + dx * r), p[1] + dy * r, p[2]];
    });
    return tubeAlong(pts, (t) => rf * (0.0046 - 0.0024 * t), { tubular: 16, radial: 5 });
  });
}

const CAUDATE: V3[] = [
  [0.0165, 0.0155, 0.026],
  [0.0185, 0.0225, 0.012],
  [0.0205, 0.0235, -0.004],
  [0.0235, 0.0185, -0.018],
  [0.0275, 0.006, -0.022],
  [0.0305, -0.008, -0.012],
  [0.031, -0.014, 0.002],
];
const CAUDATE_R = [0.0058, 0.0052, 0.0042, 0.003, 0.0022, 0.0016, 0.0014];

/** A segment of the callosal band, with its radius scaled to sit just inside the whole organ. */
function callosalSegment(a: number, b: number): THREE.BufferGeometry {
  const pts = CALLOSUM_PTS.slice(a, b + 1);
  const rad = CALLOSUM_R.slice(a, b + 1).map((r) => r * 0.88);
  const band = intersect(arch2D(pts, rad), ellipsoid([0, 0.011, 0], [0.0145, 0.04, 0.046]));
  const box = boundsOf(
    pts.map(([z, y]): V3 => [0, y, z]),
    0.006,
  );
  return polygonise(band, [-0.02, box.min[1], box.min[2]], [0.02, box.max[1], box.max[2]], { cell: 0.004 });
}

/* -------------------------------------------------------------------- build */

function finer(): PartGeometry[] {
  const out: PartGeometry[] = [];
  const g = (id: string, geometry: THREE.BufferGeometry): void => {
    out.push({ id, geometry });
  };

  // Cortical areas. Landmarks are on the right hemisphere's frame; Broca and Wernicke are drawn on the
  // left only, because language is dominant on the left in most people.
  g('premotor_cortex', patches([0.03, 0.01, 0.029], [0.015, 0.0255, 0], 0.011));
  g('supplementary_motor_area', patches([0.03, 0.034, 0.02], [-1, 0.2, 0], 0.01));
  g('frontal_eye_field', patches([0.03, 0.015, 0.046], [0.012, 0.0256, 0], 0.009));
  g('brocas_area', patch(-1, [0.03, 0.01, 0.032], [1, 0, 0], 0.0085));
  g('wernickes_area', patch(-1, [0.03, -0.005, -0.02], [1, 0, 0], 0.0095));
  g('primary_auditory_cortex', both((s) => blob([s * 0.054, -0.0045, -0.003], [0.0035, 0.0018, 0.008], 10, 6)));
  g('primary_visual_cortex', patches([0.03, 0.004, -0.062], [-1, 0, 0], 0.0115));
  g('precentral_gyrus', cortex((x, y, z) => {
    const zc = centralZ(Math.abs(x));
    return Math.max(zc + 0.003 - z, z - (zc + 0.0115), fissureY(z) - y);
  }, [-0.01, 0.06], [-0.012, 0.03], 0.0055, false, SLAB_OUT + 0.0007, SLAB_IN - 0.0007));
  g('postcentral_gyrus', cortex((x, y, z) => {
    const zc = centralZ(Math.abs(x));
    return Math.max(zc - 0.0105 - z, z - (zc - 0.0015), fissureY(z) - y);
  }, [-0.01, 0.06], [-0.03, 0.01], 0.0055, false, SLAB_OUT + 0.0007, SLAB_IN - 0.0007));
  g('central_sulcus', groove([0.008, 0.056, -0.004], [0.058, 0.02, 0.006], 0.0026, 0.003));
  g('lateral_sulcus', groove([0.068, -0.01, 0.05], [0.064, 0.004, -0.014], 0.0036, 0.003));
  corticalLayers().forEach((c, i) => g('cortex_layer_' + (i + 1), c));

  // Olfactory bulb and tract, optic chiasm and tracts, mammillary bodies, fornix, septum.
  g('olfactory_bulb_tract', olfactory(1.15));
  g(
    'optic_chiasm',
    mergeParts([
      blob([0, -0.0155, 0.0165], [0.0058, 0.0014, 0.0022]),
      tube2(
        [
          [0.004, -0.0155, 0.0145],
          [0.0105, -0.0135, 0.004],
          [0.0155, -0.0105, -0.004],
          [0.0185, -0.0075, -0.0135],
        ],
        [0.0016, 0.0015, 0.0014, 0.0013],
      ),
    ]),
  );
  g('mammillary_bodies', both((s) => ball([s * 0.0034, -0.0158, -0.0052], 0.003)));
  g(
    'fornix',
    both((s) =>
      tubeAlong(
        mir(
          [
            [0.021, 0.008, -0.029],
            [0.017, 0.0105, -0.022],
            [0.012, 0.0105, -0.012],
            [0.006, 0.01, 0.004],
            [0.0045, 0.002, 0.008],
            [0.0042, -0.007, 0.006],
            [0.0035, -0.0125, 0.0],
            [0.0032, -0.0145, -0.0042],
          ],
          s,
        ),
        () => 0.0012,
        { tubular: 24, radial: 5 },
      ),
    ),
  );
  g('septum_pellucidum', blob([0, 0.0105, 0.019], [0.0007, 0.0042, 0.0125], 6, 8));

  // Ventricles and choroid plexus.
  const vParent = ventricles(1.32);
  g('ventricles', mergeParts(Object.values(vParent)));
  const v = ventricles(1);
  g('lateral_ventricles', v.lateral);
  g('third_ventricle', v.third);
  g('fourth_ventricle', v.fourth);
  g('cerebral_aqueduct', v.aqueduct);
  g('interventricular_foramina', v.foramina);
  g('choroid_plexus', choroidPlexus());

  // Meninges.
  g('meninges', meningeal(HULL_DURA, 0.0068, 0.016));
  g('dura_mater', meningeal(HULL_DURA, 0.005));
  g('arachnoid_mater', meningeal(HULL_TIGHT, 0.003));
  g('pia_mater', meningeal(HULL_TIGHT, 0.0012));

  // Dural venous sinuses.
  g('dural_venous_sinuses', mergeParts(Object.values(sinuses(1.3))));
  const sn = sinuses(1);
  g('superior_sagittal_sinus', sn.superior);
  g('inferior_sagittal_sinus', sn.inferior);
  g('straight_sinus', sn.straight);
  g('transverse_sinuses', sn.transverse);
  g('sigmoid_sinuses', sn.sigmoid);
  g('cavernous_sinuses', sn.cavernous);

  // Arterial circle.
  g('cerebral_arterial_circle', mergeParts(Object.values(arteries(1.35))));
  const ar = arteries(1);
  g('internal_carotid_artery', ar.ica);
  g('vertebral_arteries', ar.vertebral);
  g('basilar_artery', ar.basilar);
  g('anterior_cerebral_arteries', ar.aca);
  g('middle_cerebral_arteries', ar.mca);
  g('posterior_cerebral_arteries', ar.pca);
  g('communicating_arteries', ar.comm);

  // Cranial nerves.
  g('cranial_nerves', mergeParts(Object.values(nerves(1.4))));
  for (const [id, geo] of Object.entries(nerves(1))) g(id, geo);

  // Brainstem nuclei and the internal capsule.
  for (const [id, geo] of Object.entries(brainstemNuclei())) g(id, geo);
  g(
    'internal_capsule',
    both((s) =>
      mergeParts([
        tube(
          mir(
            [
              [0.0335, 0.044, 0.004],
              [0.026, 0.028, 0.0035],
              [0.0198, 0.014, 0.0],
              [0.0175, 0.002, -0.0045],
              [0.0125, -0.0105, -0.0065],
            ],
            s,
          ),
          [0.0026, 0.0022, 0.002, 0.002, 0.0018],
        ),
        tube(
          mir(
            [
              [0.02, 0.0125, 0.001],
              [0.0195, 0.0075, 0.014],
              [0.019, 0.0, 0.021],
            ],
            s,
          ),
          [0.0018],
        ),
      ]),
    ),
  );

  // Basal ganglia: children sit just inside the parent's own surfaces (0.88 of its size).
  g(
    'caudate_nucleus',
    both((s) => tubeAlong(mir(CAUDATE, s), lin(CAUDATE_R, 0.88), { tubular: 24, radial: 6 })),
  );
  g('putamen', both((s) => blob([s * 0.028, 0.0, 0.008], [0.0048, 0.0088, 0.014], 10, 8)));
  g('globus_pallidus', both((s) => blob([s * 0.0215, -0.001, 0.006], [0.003, 0.0055, 0.0065], 10, 8)));
  g('subthalamic_nucleus', both((s) => blob([s * 0.0105, -0.0135, -0.0085], [0.0028, 0.0013, 0.0018], 8, 6)));

  // Thalamic nuclei.
  g('lateral_geniculate_nucleus', both((s) => blob([s * 0.0155, -0.0055, -0.0185], [0.0025, 0.002, 0.0028], 8, 6)));
  g('medial_geniculate_nucleus', both((s) => blob([s * 0.0105, -0.0062, -0.0198], [0.0022, 0.002, 0.0024], 8, 6)));
  g('vpl_nucleus', both((s) => blob([s * 0.0135, -0.0025, -0.0045], [0.0025, 0.0028, 0.0035], 8, 6)));
  g('vpm_nucleus', both((s) => blob([s * 0.0085, -0.0025, -0.0045], [0.0022, 0.0028, 0.0033], 8, 6)));
  g('pulvinar', both((s) => blob([s * 0.0115, 0.0035, -0.017], [0.0042, 0.0035, 0.0035], 8, 6)));

  // Hypothalamic nuclei (inside the hypothalamus, which is about 9 mm wide and 14 mm long here).
  g('suprachiasmatic_nucleus', both((s) => ball([s * 0.0016, -0.0105, 0.0105], 0.0012, 8, 6)));
  g('paraventricular_nucleus', both((s) => blob([s * 0.0016, -0.0092, 0.0045], [0.0011, 0.0016, 0.0018], 8, 6)));
  g('supraoptic_nucleus', both((s) => blob([s * 0.0042, -0.0125, 0.0085], [0.0013, 0.001, 0.0015], 8, 6)));
  g('arcuate_nucleus', both((s) => ball([s * 0.0012, -0.0143, 0.005], 0.0011, 8, 6)));
  g('ventromedial_nucleus', both((s) => ball([s * 0.0035, -0.0125, 0.0035], 0.0015, 8, 6)));
  g('lateral_hypothalamic_area', both((s) => blob([s * 0.0066, -0.0115, 0.0045], [0.0013, 0.0018, 0.0035], 8, 6)));

  // Hippocampal subfields and the entorhinal cortex.
  g('dentate_gyrus', subfield(-0.3, 0.4, 0.3));
  g('ca3_field', subfield(0.05, -0.45, 0.3));
  g('ca1_field', subfield(0.45, 0.3, 0.3));
  g('subiculum', subfield(-0.5, -0.25, 0.28));
  g('entorhinal_cortex', both((s) => blob([s * 0.0285, -0.038, 0.012], [0.0045, 0.0025, 0.0055], 8, 6)));

  // Amygdala nuclei.
  g('basolateral_amygdala', both((s) => blob([s * 0.0322, -0.0285, 0.0265], [0.0027, 0.0025, 0.0035], 8, 6)));
  g('central_amygdala', both((s) => ball([s * 0.0275, -0.0235, 0.0295], 0.0015, 8, 6)));

  // Pituitary: lobes, stalk and (magnified, schematic) cell clusters in the anterior lobe.
  g('anterior_pituitary', blob([0, -0.0265, 0.0112], [0.0045, 0.003, 0.0025], 10, 7));
  g('posterior_pituitary', blob([0, -0.0265, 0.0073], [0.0035, 0.0028, 0.0022], 10, 7));
  g('infundibulum', tubeAlong([[0, -0.0145, 0.007], [0, -0.0185, 0.0082], [0, -0.0225, 0.0092]], () => 0.0007, { tubular: 8, radial: 6 }));
  const cells: [string, V3][] = [
    ['somatotrophs', [-0.0022, -0.0272, 0.0115]],
    ['lactotrophs', [0.0022, -0.0272, 0.0115]],
    ['corticotrophs', [0, -0.0258, 0.0122]],
    ['thyrotrophs', [-0.0018, -0.0262, 0.0103]],
    ['gonadotrophs', [0.0018, -0.0262, 0.0103]],
  ];
  for (const [id, c] of cells) g(id, ball(c, 0.0009, 6, 5));

  // Cerebellum.
  g('cerebellar_vermis', blob([0, -0.043, -0.05], [0.0088, 0.0148, 0.0208], 10, 8));
  g('cerebellar_hemispheres', both((s) => blob([s * 0.0345, -0.044, -0.046], [0.0215, 0.0165, 0.0215], 10, 8)));
  const pedParts = (k: number): Record<string, THREE.BufferGeometry> => ({
    sup: tube2(
      [
        [0.01, -0.04, -0.032],
        [0.0075, -0.035, -0.025],
        [0.004, -0.03, -0.018],
      ],
      [0.0018, 0.0016, 0.0014],
      k,
    ),
    mid: tube2(
      [
        [0.012, -0.047, -0.012],
        [0.0185, -0.046, -0.022],
        [0.024, -0.045, -0.034],
      ],
      [0.0035, 0.0034, 0.0032],
      k,
    ),
    inf: tube2(
      [
        [0.007, -0.064, -0.022],
        [0.011, -0.058, -0.03],
        [0.016, -0.052, -0.036],
      ],
      [0.0022, 0.002, 0.0018],
      k,
    ),
  });
  g('cerebellar_peduncles', mergeParts(Object.values(pedParts(1.3))));
  const pp = pedParts(1);
  g('superior_cerebellar_peduncle', pp.sup);
  g('middle_cerebellar_peduncle', pp.mid);
  g('inferior_cerebellar_peduncle', pp.inf);
  g('deep_cerebellar_nuclei', both((s) => blob([s * 0.0105, -0.04, -0.0405], [0.0105, 0.0042, 0.0042], 10, 7)));
  g('dentate_nucleus', both((s) => blob([s * 0.0165, -0.04, -0.0405], [0.003, 0.003, 0.003], 8, 6)));
  g('emboliform_nucleus', both((s) => ball([s * 0.0105, -0.04, -0.0405], 0.0014, 8, 6)));
  g('globose_nucleus', both((s) => ball([s * 0.0072, -0.04, -0.0405], 0.0013, 8, 6)));
  g('fastigial_nucleus', both((s) => ball([s * 0.0035, -0.04, -0.0405], 0.0016, 8, 6)));

  // Corpus callosum segments.
  g('callosal_rostrum', callosalSegment(0, 1));
  g('callosal_genu', callosalSegment(1, 3));
  g('callosal_body', callosalSegment(3, 5));
  g('callosal_splenium', callosalSegment(5, 8));
  return out;
}

/* ------------------------------------------------------------------- export */

export const parts: PartBuilder = (): PartGeometry[] => {
  const g = (id: string, geometry: THREE.BufferGeometry): PartGeometry => ({ id, geometry });
  const cell = 0.0042;
  return [
    g('prefrontal_cortex', cortex(prefrontalRegion, [-0.03, 0.06], [0.0, 0.084], cell)),
    g('motor_cortex', cortex(motorRegion, [-0.01, 0.06], [-0.012, 0.03], cell)),
    g('somatosensory_cortex', cortex(somatosensoryRegion, [-0.01, 0.06], [-0.03, 0.01], cell)),
    g('parietal_lobe', cortex(parietalRegion, [-0.01, 0.06], [-0.045, 0.0], cell)),
    g('temporal_lobe', cortex(temporalRegion, [-0.056, 0.01], [-0.045, 0.062], cell)),
    g('occipital_lobe', cortex(occipitalRegion, [-0.04, 0.052], [-0.086, -0.036], cell)),
    g('insula', insula()),
    g('cingulate_cortex', cingulate(0.003)),
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
    ...finer(),
  ];
};

// `union` is imported for symmetry with the other atlases; keep the reference so the
// import list stays honest if a part later needs a plain union.
void union;
