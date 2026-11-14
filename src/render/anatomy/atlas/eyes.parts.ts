import * as THREE from 'three';
import type { PartBuilder, PartGeometry } from '../parts';
import {
  type V3,
  ellipsoid,
  mergeParts,
  polygonise,
  tubeAlong,
} from '../sdf';

/**
 * INTERIOR PARTS OF THE EYES (atlas `eyes`).
 *
 * The shell in models.ts is two 12 mm globes at x = +/-0.031 with a steeper corneal cap
 * on the front (+z) and an optic nerve running back and medially. Everything here sits
 * about a millimetre inside that surface so the glass shell still contains it.
 *
 * ONE PART HOLDS BOTH EYES, with one exception: the pupil. The renderer scales a part
 * about a single pivot, and the two pupils must be free to differ (a pupil that does not
 * react is a sign, and the engine may one day drive them separately), so the pupil is
 * built as `pupil_right` and `pupil_left`, each a small disc authored about its own
 * centre at the model's resting diameter of 3.5 mm. detail.ts scales each one about that
 * centre, which is why the centre is exported from here as a constant.
 *
 * ANTERIOR SEGMENT, FRONT TO BACK: cornea, a few millimetres of aqueous, the iris with
 * the pupil in it, the lens. POSTERIOR: the retina lining the back two-thirds of the
 * inner wall, the optic disc where it is breached, the nerve. The globe's own wall is the
 * sclera, drawn as a thin shell open at the front where the cornea takes over.
 *
 * WHY THE SHELLS ARE THICKER THAN LIFE. Real sclera is about half a millimetre and the
 * retina a few tenths. Marching cubes cannot resolve a wall thinner than about two cells,
 * and a cell this small over two globes would blow the triangle budget for the whole
 * atlas. The walls are therefore drawn at 1.2-1.4 mm: a diagram of a coat, not a
 * measurement of one. Nothing downstream reads their thickness.
 *
 * WHAT IS LEFT OUT: the vitreous and aqueous (transparent, they are the space between the
 * parts), the ciliary body and zonules, the extra-ocular muscles, the macula and fovea,
 * the choroid, and the retinal layers. Each would be a small drawing job with no signal
 * to drive it.
 *
 * Deterministic: no randomness anywhere in this file.
 */

/** Eye-centre x for each side, metres; +x is the patient's right (the shell's own frame). */
const EYE_X = 0.031;
/** Where the pupil sits, metres, in the eye's own frame (x relative to the globe centre). */
export const PUPIL_Z = 0.0092;
/** The pupil diameter the disc is authored at, mm: the model's resting pupil. */
export const PUPIL_AUTHORED_MM = 3.5;
/** Pupil-disc centre of each eye in the organ frame: right (+x) first, then left. */
export const PUPIL_CENTRES: readonly [V3, V3] = [
  [EYE_X, 0, PUPIL_Z],
  [-EYE_X, 0, PUPIL_Z],
];

/** Optic nerve centreline of one eye, as the shell's own capsule runs, pulled in from its ends. */
export function opticNervePath(side: 1 | -1): V3[] {
  // Shell capsule: (s*0.029, 0, -0.011) to (s*0.012, 0.004, -0.04). Sample it from 5 %
  // to 95 % so the part starts inside the globe wall and stops short of the cut end.
  const a: V3 = [side * 0.029, 0, -0.011];
  const b: V3 = [side * 0.012, 0.004, -0.04];
  const out: V3[] = [];
  for (const t of [0.02, 0.35, 0.65, 0.96]) {
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  }
  return out;
}

/** An open patch of a sphere about `c`, from polar angle t0 to t1 measured from +z. */
function cap(c: V3, radius: number, t0: number, t1: number, wSeg: number, hSeg: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(radius, wSeg, hSeg, 0, Math.PI * 2, t0, t1 - t0);
  g.rotateX(Math.PI / 2); // SphereGeometry's pole is +y; the eye's axis is +z
  g.translate(c[0], c[1], c[2]);
  return g;
}

/** A flat annulus, 12 mm across with a 2 mm hole, 0.9 mm thick, facing +z, about the origin. */
function irisRing(): THREE.BufferGeometry {
  const t = 0.00045;
  const pts = [
    new THREE.Vector2(0.001, -t),
    new THREE.Vector2(0.006, -t),
    new THREE.Vector2(0.006, t),
    new THREE.Vector2(0.001, t),
    new THREE.Vector2(0.001, -t),
  ];
  const g = new THREE.LatheGeometry(pts, 48);
  g.rotateX(Math.PI / 2);
  return g;
}

const SCLERA_OUTER = 0.0109;
const SCLERA_THICK = 0.0014;
/** The plane where the sclera stops and the cornea begins, metres in front of the globe centre. */
const LIMBUS_Z = 0.0062;

export const parts: PartBuilder = () => {
  const sclera: THREE.BufferGeometry[] = [];
  const cornea: THREE.BufferGeometry[] = [];
  const iris: THREE.BufferGeometry[] = [];
  const lens: THREE.BufferGeometry[] = [];
  const retina: THREE.BufferGeometry[] = [];
  const nerve: THREE.BufferGeometry[] = [];
  const pupils: THREE.BufferGeometry[] = [];

  for (const s of [1, -1] as const) {
    const cx = s * EYE_X;
    const c: V3 = [cx, 0, 0];

    // SCLERA: the globe's wall, open in front of the limbus. A single swept sphere
    // patch: a polygonised shell thick enough to resolve cost over a hundred thousand
    // triangles for the pair of eyes, and the atlas budget is twenty-five thousand.
    // The optic canal is not cut: the nerve simply passes through the wall.
    sclera.push(cap(c, SCLERA_OUTER - SCLERA_THICK / 2, Math.acos(LIMBUS_Z / (SCLERA_OUTER - SCLERA_THICK / 2)), Math.PI, 40, 22));

    // CORNEA: a spherical cap, steeper than the globe, meeting the sclera at the limbus.
    // Chosen so it passes through the sclera's rim and its front stays 1.5 mm inside the
    // shell's own corneal bulge.
    const corneaCentre: V3 = [cx, 0, 0.0043];
    cornea.push(cap(corneaCentre, 0.0092 - 0.0003, 0, Math.acos((LIMBUS_Z - 0.0043) / (0.0092 - 0.0003)), 32, 12));

    // IRIS: a flat annulus a few millimetres behind the cornea. Its hole is the smallest
    // pupil it can make (1 mm radius); the pupil disc covers the hole at rest and is
    // scaled larger or smaller from there, so the iris never shows a gap behind it.
    const irisG = irisRing();
    irisG.translate(cx, 0, PUPIL_Z);
    iris.push(irisG);

    // PUPIL: a dark disc a hair in front of the iris, authored at 3.5 mm across.
    const pr = PUPIL_AUTHORED_MM / 2000;
    const pupilC: V3 = [cx, 0, PUPIL_Z + 0.0002];
    pupils.push(
      polygonise(ellipsoid(pupilC, [pr, pr, 0.00025]), [cx - pr - 0.0005, -pr - 0.0005, PUPIL_Z - 0.0006], [cx + pr + 0.0005, pr + 0.0005, PUPIL_Z + 0.001], { cell: 0.00025 }),
    );

    // LENS: biconvex, about 4 mm thick and 9 mm across, just behind the iris.
    lens.push(
      polygonise(ellipsoid([cx, 0, 0.0062], [0.0045, 0.0045, 0.002]), [cx - 0.0052, -0.0052, 0.0036], [cx + 0.0052, 0.0052, 0.0088], { cell: 0.0006 }),
    );

    // RETINA: the inner lining of the back two-thirds. A sphere's area behind the plane
    // z = R/3 is two-thirds of it, so that is where the lining stops. The optic disc is
    // not cut out; the nerve tube meets the lining there.
    const rMid = SCLERA_OUTER - SCLERA_THICK - 0.0004;
    retina.push(cap(c, rMid, Math.acos(1 / 3), Math.PI, 36, 20));

    // OPTIC NERVE: a tube, a little thinner than the shell's own, from the disc backwards.
    nerve.push(tubeAlong(opticNervePath(s), (t) => 0.0016 + 0.0002 * (1 - t), { tubular: 24, radial: 8 }));
  }

  const out: PartGeometry[] = [
    { id: 'sclera', geometry: mergeParts(sclera) },
    { id: 'cornea', geometry: mergeParts(cornea) },
    { id: 'iris', geometry: mergeParts(iris) },
    { id: 'pupil_right', geometry: pupils[0] },
    { id: 'pupil_left', geometry: pupils[1] },
    { id: 'lens', geometry: mergeParts(lens) },
    { id: 'retina', geometry: mergeParts(retina) },
    { id: 'optic_nerve', geometry: mergeParts(nerve) },
  ];
  return out;
};
