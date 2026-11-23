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
 * WHAT THE FIRST VERSION LEFT OUT, AND THE SECOND PASS ADDS. The first version drew only the
 * coats, iris, pupil, lens, retina and nerve, and left out the vitreous and aqueous (they
 * are transparent, so they were "the space between the parts"), the ciliary body and
 * zonules, the extra-ocular muscles, the macula and fovea, the choroid, the retinal layers,
 * the lids and the tear drainage. All of those are now parts. Two consequences are worth
 * stating, because each caused a wrong first draft:
 *   - A part that contains others has to be GLASS or its contents are invisible. The sclera
 *     and cornea were opaque and hid the choroid and retina behind them; eyes.detail.ts now
 *     draws every container (coats, chambers, vitreous, lids, conjunctiva) as glass.
 *   - Layers a tenth of a millimetre apart cannot be drawn to scale. The ten retinal layers
 *     are stacked caps about 0.1 mm apart, in textbook order from the choroid inwards, and
 *     the four corneal layers likewise. The thickness of each is a drawing choice and says
 *     nothing about the real ratio of the layers.
 *
 * Positions below are in the eye's own frame (+z the front, +y up, +x the patient's right),
 * and the same recipe is built for each eye with `s` = +1 (right) and -1 (left). "Medial"
 * is towards the nose, which is -s in x; "lateral" is +s. Each eye is a mirror image, and the
 * lacrimal drainage lies on the nose side of each.
 *
 * ILLUSTRATIVE, NOT TRACED. The lids, muscles, glands and ducts are placed by eye for
 * plausible relative position, not from any measured orbit. The muscle origins are
 * drawn at one ring at the back of the socket; the real insertions are at set distances
 * behind the limbus, and the ones drawn here are approximations of that.
 *
 * COARSE ON PURPOSE. The atlas was held to about twice its triangles from before it had
 * children, so every new part is a low-resolution swept tube or a few-segment sphere patch,
 * and the sclera and retina caps (which were 40 x 22 and 36 x 20) were thinned to match.
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

/** Eye frame, relative to the globe centre: a point on a sphere of radius R at polar angle t from the front axis and azimuth p (0 = patient's left-of-axis side as SphereGeometry measures it). */
function onSphere(c: V3, R: number, t: number, dx: number, dy: number): V3 {
  // (dx, dy) is a direction in the frontal plane; it need not be normalised.
  const n = Math.hypot(dx, dy) || 1;
  return [c[0] + (R * Math.sin(t) * dx) / n, c[1] + (R * Math.sin(t) * dy) / n, c[2] + R * Math.cos(t)];
}

/** A patch of a sphere about the BACK pole (-z), angular radius t0..t1 from that pole, turned about y by `yaw`. */
function backPatch(c: V3, radius: number, t0: number, t1: number, w: number, h: number, yaw = 0): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(radius, w, h, 0, Math.PI * 2, t0, t1 - t0);
  g.rotateX(Math.PI / 2);
  g.rotateY(Math.PI); // pole to -z
  if (yaw) g.rotateY(yaw);
  g.translate(c[0], c[1], c[2]);
  return g;
}

/** A closed solid of revolution about the eye's axis from (r, z) points, scaled about its middle by k. */
function lathe(poly: readonly (readonly [number, number])[], c: V3, k = 1, segments = 20): THREE.BufferGeometry {
  const zc = poly.reduce((a, p) => a + p[1], 0) / poly.length;
  const pts = poly.map((p) => new THREE.Vector2(p[0] * k, zc + (p[1] - zc) * k));
  const g = new THREE.LatheGeometry(pts, segments);
  g.rotateX(Math.PI / 2); // lathe axis y -> eye axis z
  g.translate(c[0], c[1], c[2]);
  return g;
}

/** A small ellipsoid, a few segments only. */
function bean(c: V3, rx: number, ry: number, rz: number, w = 7, h = 5): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(rx, ry, rz);
  g.translate(c[0], c[1], c[2]);
  return g;
}

/** A thin straight-ish tube through points. */
function line(pts: readonly V3[], radius: number | ((t: number) => number), tubular = 8, radial = 4): THREE.BufferGeometry {
  return tubeAlong(pts, typeof radius === 'number' ? () => radius : (t) => radius(t), { tubular, radial });
}

/** A sphere patch for a lid: azimuth range chosen so the patch is the upper (+1) or lower (-1) half. */
function lidPatch(c: V3, radius: number, t0: number, t1: number, upper: boolean, w = 16, h = 4): THREE.BufferGeometry {
  // SphereGeometry azimuths, once the pole is turned from +y to +z, put the upper half of
  // the front at phi in (pi, 2pi) and the lower half in (0, pi). A margin of 0.3 rad is left
  // at each corner of the eye so the two lids do not meet in a closed ring.
  const start = upper ? Math.PI + 0.3 : 0.3;
  const g = new THREE.SphereGeometry(radius, w, h, start, Math.PI - 0.6, t0, t1 - t0);
  g.rotateX(Math.PI / 2);
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


/** How far the optic disc sits to the nose side of the back pole, radians (the shell's nerve leaves 2 mm medial of the globe centre on an 11 mm radius). */
export const DISC_YAW = Math.atan(0.0019 / 0.0108);

/**
 * The retinal layers: id, radius (m), and angular extent from the back pole (rad), in
 * order from the choroid inwards. Radii are about 0.1 mm apart (a drawing choice, see the
 * header); the rods and cones share a radius and divide the cap between them, cones in the
 * middle and rods outside, as a simplification.
 */
const RETINA_LAYERS: readonly (readonly [string, number, number, number])[] = [
  ['retinal_pigment_epithelium', 0.0095, 0, 1.9],
  ['rods', 0.0094, 0.45, 1.9],
  ['cones', 0.0094, 0, 0.9],
  ['outer_nuclear_layer', 0.0093, 0, 1.9],
  ['outer_plexiform_layer', 0.0092, 0, 1.9],
  ['horizontal_cells', 0.009, 0.2, 1.9],
  ['bipolar_cells', 0.0089, 0, 1.9],
  ['amacrine_cells', 0.0088, 0, 1.9],
  ['ganglion_cells', 0.0087, 0, 1.9],
  ['nerve_fibre_layer', 0.0086, 0, 1.9],
];

/** The corneal layers, front to back: id and cap radius (m), about 0.1 mm apart (a drawing choice). */
const CORNEA_LAYERS: readonly (readonly [string, number])[] = [
  ['corneal_epithelium', 0.00915],
  ['bowman_layer', 0.00903],
  ['corneal_stroma', 0.0088],
  ['descemet_membrane', 0.00868],
  ['corneal_endothelium', 0.00858],
];

/** The aqueous-filled space in front of the iris, as (r, z) of a closed polygon about the eye's axis. */
const ANTERIOR_CHAMBER: readonly (readonly [number, number])[] = [
  [0, 0.0129], [0.004, 0.0119], [0.006, 0.0105], [0.0075, 0.0085], [0.0072, 0.0097], [0.006, 0.0099], [0.0012, 0.0099], [0, 0.0099], [0, 0.0129],
];
/** The thin space between the iris and the lens and ciliary body. */
const POSTERIOR_CHAMBER: readonly (readonly [number, number])[] = [
  [0.0012, 0.0088], [0.007, 0.0089], [0.0072, 0.0052], [0.0048, 0.0062], [0.002, 0.0083], [0.0012, 0.0088],
];
/** The vitreous: everything behind the lens, inside the retina. */
const VITREOUS: readonly (readonly [number, number])[] = [
  [0, 0.0042], [0.003, 0.0046], [0.0046, 0.0062], [0.0065, 0.005], [0.008, 0.002], [0.008, -0.002], [0.007, -0.0045], [0.0054, -0.0063], [0.003, -0.0077], [0, -0.0083], [0, 0.0042],
];

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
    sclera.push(cap(c, SCLERA_OUTER - SCLERA_THICK / 2, Math.acos(LIMBUS_Z / (SCLERA_OUTER - SCLERA_THICK / 2)), Math.PI, 32, 16));

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
    retina.push(cap(c, rMid, Math.acos(1 / 3), Math.PI, 28, 14));

    // OPTIC NERVE: a tube, a little thinner than the shell's own, from the disc backwards.
    nerve.push(tubeAlong(opticNervePath(s), (t) => 0.0016 + 0.0002 * (1 - t), { tubular: 24, radial: 8 }));
  }


  // ------------------------------------------------------------------ second pass
  const conj: THREE.BufferGeometry[] = [];
  const lids: THREE.BufferGeometry[] = [];
  const tarsal: THREE.BufferGeometry[] = [];
  const meibomian: THREE.BufferGeometry[] = [];
  const lacGland: THREE.BufferGeometry[] = [];
  const puncta: THREE.BufferGeometry[] = [];
  const canal: THREE.BufferGeometry[] = [];
  const sac: THREE.BufferGeometry[] = [];
  const duct: THREE.BufferGeometry[] = [];
  const ring: THREE.BufferGeometry[] = [];
  const mus: Record<string, THREE.BufferGeometry[]> = { sr: [], ir: [], mr: [], lr: [], so: [], io: [], lp: [] };
  const choroid: THREE.BufferGeometry[] = [];
  const ciliary: THREE.BufferGeometry[] = [];
  const zonule: THREE.BufferGeometry[] = [];
  const aqueous: THREE.BufferGeometry[] = [];
  const antCh: THREE.BufferGeometry[] = [];
  const postCh: THREE.BufferGeometry[] = [];
  const vitreous: THREE.BufferGeometry[] = [];
  const tm: THREE.BufferGeometry[] = [];
  const schlemm: THREE.BufferGeometry[] = [];
  const macula: THREE.BufferGeometry[] = [];
  const fovea: THREE.BufferGeometry[] = [];
  const disc: THREE.BufferGeometry[] = [];
  const artery: THREE.BufferGeometry[] = [];
  const vein: THREE.BufferGeometry[] = [];
  const layers: Record<string, THREE.BufferGeometry[]> = {};
  for (const [id] of RETINA_LAYERS) layers[id] = [];
  const lensParts: Record<string, THREE.BufferGeometry[]> = { lens_capsule: [], lens_cortex: [], lens_nucleus: [] };
  const corneaLayers: Record<string, THREE.BufferGeometry[]> = {};
  for (const [id] of CORNEA_LAYERS) corneaLayers[id] = [];

  for (const s of [1, -1] as const) {
    const cx = s * EYE_X;
    const c: V3 = [cx, 0, 0];

    // CONJUNCTIVA: a thin sheet over the front of the sclera from the limbus back past the equator.
    conj.push(
      (() => {
        const g = new THREE.SphereGeometry(0.0112, 20, 4, 0, Math.PI * 2, 0.97, 0.85);
        g.rotateX(Math.PI / 2);
        g.translate(cx, 0, 0);
        return g;
      })(),
    );

    // EYELIDS AND TARSAL PLATES. The lid margin is drawn at the same polar angle all round,
    // so the opening is a round window rather than an almond; a simplification.
    lids.push(lidPatch(c, 0.0122, 0.95, 1.95, true), lidPatch(c, 0.0122, 1.0, 1.95, false));
    tarsal.push(lidPatch(c, 0.0119, 0.97, 1.3, true, 16, 3), lidPatch(c, 0.0119, 1.02, 1.3, false, 16, 3));
    // TARSAL GLANDS: a row of short tubes in each plate, each running from near the margin
    // across the plate. Eight is a drawing choice (a real lid has more).
    for (const upper of [true, false]) {
      for (let k = 0; k < 8; k++) {
        const phi = (upper ? Math.PI + 0.45 : 0.45) + (k / 7) * (Math.PI - 0.9);
        const pts: V3[] = [0.99, 1.14, 1.27].map((t) => {
          // The same azimuth convention as lidPatch: x = -R cos(phi) sin(t) before the turn,
          // y = -R sin(phi) sin(t) after it, z = R cos(t).
          const R = 0.0118;
          return [cx - R * Math.cos(phi) * Math.sin(t), -R * Math.sin(phi) * Math.sin(t), R * Math.cos(t)] as V3;
        });
        meibomian.push(line(pts, 0.00022, 4, 3));
      }
    }

    // TEARS: gland above and lateral; puncta, canaliculi, sac and duct on the nose side.
    lacGland.push(bean([cx + s * 0.0085, 0.0098, 0.0012], 0.0035, 0.0016, 0.0025, 8, 5));
    const punctumUp: V3 = [cx - s * 0.0112, 0.0012, 0.0046];
    const punctumDown: V3 = [cx - s * 0.0112, -0.0012, 0.0046];
    puncta.push(bean(punctumUp, 0.0003, 0.0003, 0.0003, 6, 4), bean(punctumDown, 0.0003, 0.0003, 0.0003, 6, 4));
    const sacC: V3 = [cx - s * 0.0185, -0.0003, 0.0018];
    canal.push(
      line([punctumUp, [cx - s * 0.0145, 0.0012, 0.0034], [sacC[0], 0.0006, sacC[2]]], 0.00022, 6, 4),
      line([punctumDown, [cx - s * 0.0145, -0.0012, 0.0034], [sacC[0], -0.0012, sacC[2]]], 0.00022, 6, 4),
    );
    sac.push(bean(sacC, 0.0016, 0.0042, 0.0016, 8, 6));
    // The duct runs down to the opening in the front of the inferior meatus that the nasal atlas
    // draws at nasal-frame (0.014, -0.0125, 0.0085), i.e. eye-frame (0.014, -0.0465, -0.0015).
    duct.push(line([[sacC[0], -0.0042, sacC[2]], [cx - s * 0.0182, -0.011, 0.0008], [s * 0.0134, -0.026, 0.0], [s * 0.0138, -0.038, -0.0008], [s * 0.014, -0.0465, -0.0015]], 0.0007, 14, 6));

    // THE MUSCLES. Origins on a ring round the nerve at the apex of the socket; recti run
    // forward over the globe to insert in front of its equator.
    const nerve = opticNervePath(s);
    const A = nerve[0];
    const B = nerve[3];
    const apex: V3 = [A[0] + (B[0] - A[0]) * 0.9, A[1] + (B[1] - A[1]) * 0.9, A[2] + (B[2] - A[2]) * 0.9];
    const nDir = new THREE.Vector3(B[0] - A[0], B[1] - A[1], B[2] - A[2]).normalize();
    const torus = new THREE.TorusGeometry(0.0022, 0.0004, 4, 12);
    torus.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), nDir));
    torus.translate(apex[0], apex[1], apex[2]);
    ring.push(torus);
    const RM = 0.0117; // the muscle runs just outside the sclera
    const belly = (t: number) => 0.0003 + 0.0006 * Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.85));
    const rectus = (key: string, dx: number, dy: number) => {
      const o: V3 = [apex[0] + dx * 0.0022, apex[1] + dy * 0.0022, apex[2]];
      mus[key].push(line([o, onSphere(c, RM, 2.55, dx, dy), onSphere(c, RM, 2.0, dx, dy), onSphere(c, RM, 1.5, dx, dy)], belly, 14, 5));
    };
    rectus('sr', 0, 1);
    rectus('ir', 0, -1);
    rectus('mr', -s, 0);
    rectus('lr', s, 0);
    // SUPERIOR OBLIQUE: along the upper nasal wall to a pulley, then back under the superior
    // rectus to insert behind the equator on the upper lateral side.
    const trochlea: V3 = [cx - s * 0.0072, 0.0128, 0.003];
    mus.so.push(line([[apex[0] - s * 0.0012, apex[1] + 0.0016, apex[2]], [cx - s * 0.0095, 0.0112, -0.012], trochlea, onSphere(c, RM, 1.45, s * 0.1, 1), onSphere(c, RM, 1.85, s * 0.45, 0.89)], belly, 18, 5));
    // INFERIOR OBLIQUE: from the floor of the socket near the nose, under the globe, to the lower lateral side.
    mus.io.push(line([[cx - s * 0.0095, -0.0125, 0.0015], onSphere(c, RM, 1.55, -s * 0.35, -0.94), onSphere(c, RM, 1.8, s * 0.15, -0.99), onSphere(c, RM, 2.0, s * 0.7, -0.7)], belly, 16, 5));
    // LEVATOR: from the apex, over the top of the globe, to the upper lid.
    mus.lp.push(line([[apex[0], apex[1] + 0.003, apex[2]], [s * 0.022, 0.0125, -0.02], [cx - s * 0.002, 0.014, -0.004], [cx, 0.0126, 0.0034]], (t) => 0.0003 + 0.0005 * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.05)), 14, 5));

    // CHOROID: a glass cap between the sclera (0.0102) and the retina (0.0091).
    choroid.push(backPatch(c, 0.0097, 0, 1.9, 16, 8));

    // CILIARY BODY: a ring behind the iris root; ZONULES: threads from its inner edge to the lens equator.
    const ct = new THREE.TorusGeometry(0.0079, 0.0009, 6, 24);
    ct.translate(cx, 0, 0.0066);
    ciliary.push(ct);
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      zonule.push(line([[cx + 0.007 * Math.cos(a), 0.007 * Math.sin(a), 0.0066], [cx + 0.0047 * Math.cos(a), 0.0047 * Math.sin(a), 0.0062]], 0.00009, 1, 3));
    }

    // AQUEOUS: the front chamber and the thin space behind the iris, as two closed volumes.
    // The parent shows both at full size; each child is the same volume a little smaller, so
    // that it sits inside the parent's glass when the children are shown.
    aqueous.push(lathe(ANTERIOR_CHAMBER, c), lathe(POSTERIOR_CHAMBER, c));
    antCh.push(lathe(ANTERIOR_CHAMBER, c, 0.9));
    postCh.push(lathe(POSTERIOR_CHAMBER, c, 0.9));
    vitreous.push(lathe(VITREOUS, c, 1, 20));

    // DRAINAGE ANGLE: the meshwork at the angle and the sinus just outside it.
    const tmT = new THREE.TorusGeometry(0.0086, 0.0003, 4, 24);
    tmT.translate(cx, 0, 0.007);
    tm.push(tmT);
    const sinus = new THREE.TorusGeometry(0.009, 0.00022, 4, 24);
    sinus.translate(cx, 0, 0.0066);
    schlemm.push(sinus);

    // MACULA, FOVEA AND DISC on the inner face of the retina. The disc is on the nose side
    // of the back pole, where the shell's optic nerve meets the globe.
    macula.push(backPatch(c, 0.00855, 0, 0.3, 12, 3));
    fovea.push(backPatch(c, 0.00848, 0, 0.08, 8, 2));
    disc.push(backPatch(c, 0.0085, 0, 0.17, 10, 2, s * DISC_YAW));

    // RETINAL VESSELS: a trunk inside the nerve to the disc, then four branches over the
    // inner surface; the vein runs alongside the artery. Branch directions are drawn, not traced.
    const RV = 0.00845;
    const discPt = (R: number, dth: number, dph: number): V3 => {
      // A point at polar angle `th` from the back pole and azimuth `ph` (0 = temporal), then yawed like the disc.
      const th = dth;
      const lx = s * Math.sin(th) * Math.cos(dph);
      const ly = Math.sin(th) * Math.sin(dph);
      const lz = -Math.cos(th);
      return [cx + R * lx, R * ly, R * lz];
    };
    const D0 = discPt(RV, DISC_YAW, Math.PI); // the disc, nasal
    const trunkA: V3 = [nerve[2][0] + s * 0.0001, nerve[2][1] + 0.0002, nerve[2][2]];
    artery.push(line([trunkA, nerve[1], D0], 0.0002, 8, 4));
    vein.push(line([[trunkA[0], trunkA[1] - 0.0004, trunkA[2]], [nerve[1][0], nerve[1][1] - 0.0004, nerve[1][2]], D0], 0.00024, 8, 4));
    for (const [phStart, phEnd] of [[2.4, 1.2], [3.9, 5.0], [2.7, 2.4], [3.6, 3.9]] as const) {
      const path = (off: number): V3[] => [
        D0,
        discPt(RV, 0.5, phStart + off),
        discPt(RV, 0.95, (phStart + phEnd) / 2 + off),
        discPt(RV, 1.4, phEnd + off),
      ];
      artery.push(line(path(0.05), 0.00016, 10, 4));
      vein.push(line(path(-0.05), 0.0002, 10, 4));
    }

    // THE TEN LAYERS OF THE RETINA, from the choroid inwards, as stacked caps. The rods are
    // drawn in the periphery and the cones in the centre, which is a simplification: cones
    // are found throughout the retina, only most dense at the centre.
    for (const [id, radius, t0, t1] of RETINA_LAYERS) layers[id].push(backPatch(c, radius, t0, t1, 14, 5));

    // LENS in three nested shells.
    const lensC: V3 = [cx, 0, 0.0062];
    lensParts.lens_capsule.push(bean(lensC, 0.00468, 0.00468, 0.00208, 12, 6));
    lensParts.lens_cortex.push(bean(lensC, 0.0043, 0.0043, 0.0019, 12, 6));
    lensParts.lens_nucleus.push(bean(lensC, 0.0025, 0.0025, 0.0011, 12, 6));

    // CORNEA in five layers, each a cap of its own radius about the same centre as the cornea part.
    const tLimb = Math.acos((LIMBUS_Z - 0.0043) / (0.0092 - 0.0003));
    for (const [id, radius] of CORNEA_LAYERS) {
      const g = new THREE.SphereGeometry(radius, 16, 4, 0, Math.PI * 2, 0, tLimb);
      g.rotateX(Math.PI / 2);
      g.translate(cx, 0, 0.0043);
      corneaLayers[id].push(g);
    }
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
    { id: 'conjunctiva', geometry: mergeParts(conj) },
    { id: 'eyelids', geometry: mergeParts(lids) },
    { id: 'tarsal_plates', geometry: mergeParts(tarsal) },
    { id: 'tarsal_glands', geometry: mergeParts(meibomian) },
    { id: 'lacrimal_gland', geometry: mergeParts(lacGland) },
    { id: 'lacrimal_puncta', geometry: mergeParts(puncta) },
    { id: 'lacrimal_canaliculi', geometry: mergeParts(canal) },
    { id: 'lacrimal_sac', geometry: mergeParts(sac) },
    { id: 'nasolacrimal_duct', geometry: mergeParts(duct) },
    { id: 'extraocular_muscles', geometry: mergeParts(ring) },
    { id: 'superior_rectus', geometry: mergeParts(mus.sr) },
    { id: 'inferior_rectus', geometry: mergeParts(mus.ir) },
    { id: 'medial_rectus', geometry: mergeParts(mus.mr) },
    { id: 'lateral_rectus', geometry: mergeParts(mus.lr) },
    { id: 'superior_oblique', geometry: mergeParts(mus.so) },
    { id: 'inferior_oblique', geometry: mergeParts(mus.io) },
    { id: 'levator_palpebrae', geometry: mergeParts(mus.lp) },
    { id: 'choroid', geometry: mergeParts(choroid) },
    { id: 'ciliary_body', geometry: mergeParts(ciliary) },
    { id: 'zonular_fibres', geometry: mergeParts(zonule) },
    { id: 'aqueous_humour', geometry: mergeParts(aqueous) },
    { id: 'anterior_chamber', geometry: mergeParts(antCh) },
    { id: 'posterior_chamber', geometry: mergeParts(postCh) },
    { id: 'vitreous_body', geometry: mergeParts(vitreous) },
    { id: 'trabecular_meshwork', geometry: mergeParts(tm) },
    { id: 'scleral_venous_sinus', geometry: mergeParts(schlemm) },
    { id: 'macula', geometry: mergeParts(macula) },
    { id: 'fovea', geometry: mergeParts(fovea) },
    { id: 'optic_disc', geometry: mergeParts(disc) },
    { id: 'central_retinal_artery', geometry: mergeParts(artery) },
    { id: 'central_retinal_vein', geometry: mergeParts(vein) },
  ];
  for (const [id] of RETINA_LAYERS) out.push({ id, geometry: mergeParts(layers[id]) });
  for (const id of Object.keys(lensParts)) out.push({ id, geometry: mergeParts(lensParts[id]) });
  for (const [id] of CORNEA_LAYERS) out.push({ id, geometry: mergeParts(corneaLayers[id]) });
  return out;
};
