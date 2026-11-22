import * as THREE from 'three';
import type { PartBuilder } from '../parts';
import { capsule, ellipsoid, mergeParts, polygonise, smoothUnion, tubeAlong, type V3 } from '../sdf';
import { mulberry32 } from '../noise';
import { beads as beadsOf, fibonacciSphere } from './gland_shared';

/**
 * INTERIOR OF THE THYROID. The shell in models.ts is two lobes (centres x = +-16.5 mm,
 * y 4 mm, z -4 mm) joined by an isthmus that lies across the trachea; every shape here is
 * a slightly smaller copy of those so it sits just inside.
 *
 * GLASS VERSUS SOLID. The capsule, the two lobes, the isthmus and the vessels enclose or
 * carry something, so animate() draws them as glass. The follicles (colloid beads), the C
 * cells and the parathyroids are CONTENT and stay solid and tappable.
 *
 * WHY THE FOLLICLES ARE BEADS. A real follicle is a microscopic sphere of colloid; drawn to
 * scale there would be thousands. A deterministic scatter of beads (mulberry32, fixed seed)
 * conveys "many small colloid-filled spheres" without pretending to count them. The C cells
 * are sparser and smaller, scattered between the follicles in the upper-middle of each lobe.
 *
 * WHAT THE VESSELS ARE. The superior thyroid arteries arrive at the upper poles and the
 * inferior thyroid arteries from below and behind; the veins leave from the lateral face
 * and the lower pole. They are drawn only inside the shell (their intra-glandular course).
 * The parathyroids are tiny and in life lie behind the gland; two a side are placed on the
 * posterior surface. No physiological numbers are involved.
 *
 * THE FINER STRUCTURES (reveal.ts). Real follicles and cells are microscopic, so the
 * children are ENLARGED SCHEMATICS, and the data file says so in their text. Three
 * follicles are drawn per lobe at a size a camera can read: a solid colloid sphere in the
 * middle, a ring of cuboidal follicular-cell beads round it, a glass basement membrane
 * round the ring, and two loops of fine capillary running between neighbours. They are
 * stacked along the lobe on its own axis and are not a picture of where follicles lie; the
 * bead scatter of the parent `follicles` part remains the "many small follicles" drawing.
 * The parathyroid children sit inside the four parent beads: the same four glands, drawn a
 * little smaller so they lie inside, split into the upper pair and the lower pair, with a
 * handful of chief-cell beads and fewer, larger oxyphil-cell beads inside each. Cell
 * counts and sizes are drawing choices. The pyramidal lobe is a variable, inconstant
 * finger of tissue (GRAYS42), drawn as one tapering tube rising from the isthmus.
 */

/** Radius (m) of one enlarged schematic follicle's colloid, its cell ring and its membrane: drawing choices. */
const FOLLICLE = { colloid: 0.0014, cellRing: 0.0019, cell: 0.00048, membrane: 0.0026, capillary: 0.003 };
/** Where the three schematic follicles sit relative to a lobe's centre (x is mirrored per side). */
const FOLLICLE_SITES: readonly V3[] = [[0, -0.0075, 0], [0.0006, 0, 0], [0, 0.0075, 0]];

const LOBE_C = (s: number): V3 => [s * 0.0165, 0.004, -0.004];

/** A solid bead: a low-poly sphere, scaled and moved. Indexed, with normals, like polygonise output. */
function bead(c: V3, r: V3, w: number, h: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(r[0], r[1], r[2]);
  g.translate(c[0], c[1], c[2]);
  return g;
}

/** Scatter `n` beads inside a lobe's ellipsoid, within `frac` of its radii, around a y offset. */
function scatter(s: number, n: number, rad: number, frac: number, seed: number, yBias: number, w: number, h: number): THREE.BufferGeometry {
  const rnd = mulberry32(seed);
  const c = LOBE_C(s);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    let x = 0, y = 0, z = 0;
    // Rejection sampling inside the unit ball, deterministic because the PRNG is.
    for (let guard = 0; guard < 40; guard++) {
      x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1;
      if (x * x + y * y + z * z <= 1) break;
    }
    parts.push(bead([c[0] + x * 0.0068 * frac, c[1] + yBias * 0.0188 + y * 0.0188 * frac * (yBias ? 0.35 : 1), c[2] + z * 0.0062 * frac], [rad, rad, rad], w, h));
  }
  return mergeParts(parts);
}

const tube = (pts: V3[], r: number) => tubeAlong(pts, () => r, { tubular: 14, radial: 6 });

/** Vessel centrelines for one side (s = +1 patient's right). Exported for the flows. */
export function thyroidPaths(s: number): { superior: V3[]; inferior: V3[]; vSuperior: V3[]; vMiddle: V3[]; vInferior: V3[] } {
  return {
    superior: [[s * 0.0155, 0.0235, -0.003], [s * 0.015, 0.016, 0.001], [s * 0.014, 0.008, 0.0025], [s * 0.0125, 0.002, 0.0028]],
    inferior: [[s * 0.0185, -0.0155, -0.007], [s * 0.017, -0.008, -0.0075], [s * 0.0165, -0.006, -0.0075], [s * 0.015, 0.002, -0.0075]],
    vSuperior: [[s * 0.0185, 0.0, 0.003], [s * 0.02, 0.012, 0.001], [s * 0.0185, 0.0235, -0.002]],
    vMiddle: [[s * 0.02, 0.0, 0.0], [s * 0.0245, -0.002, -0.001]],
    vInferior: [[s * 0.017, -0.002, 0.0025], [s * 0.0166, -0.01, 0.001], [s * 0.016, -0.0165, -0.002]],
  };
}

export const parts: PartBuilder = () => {
  const lobeField = (s: number, rx: number, ry: number, rz: number) => ellipsoid(LOBE_C(s), [rx, ry, rz]);
  const box = (m: number): [V3, V3] => [[-0.028 + m, -0.02 + m, -0.014 + m], [0.028 - m, 0.028 - m, 0.012 - m]];
  const [bmin, bmax] = box(0);
  const cell = 0.0014;
  const isthmusRod = capsule([-0.011, -0.008, 0.006], [0.011, -0.008, 0.006], 0.003);

  const capsuleField = smoothUnion(
    0.004,
    lobeField(1, 0.008, 0.0205, 0.0073),
    lobeField(-1, 0.008, 0.0205, 0.0073),
    capsule([-0.012, -0.008, 0.006], [0.012, -0.008, 0.006], 0.0036),
  );

  const arteries: THREE.BufferGeometry[] = [];
  const veins: THREE.BufferGeometry[] = [];
  const parathyroids: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    const p = thyroidPaths(s);
    arteries.push(tube(p.superior, 0.0007), tube(p.inferior, 0.0007));
    veins.push(tube(p.vSuperior, 0.0008), tube(p.vMiddle, 0.0007), tube(p.vInferior, 0.0008));
    // Superior and inferior parathyroid on the back of each lobe.
    parathyroids.push(bead([s * 0.015, 0.008, -0.0098], [0.002, 0.0018, 0.001], 8, 6));
    parathyroids.push(bead([s * 0.015, -0.006, -0.0098], [0.002, 0.0018, 0.001], 8, 6));
  }

  const sites: V3[] = [];
  for (const s of [1, -1]) {
    const c = LOBE_C(s);
    for (const o of FOLLICLE_SITES) sites.push([c[0] + s * o[0], c[1] + o[1], c[2] + o[2]]);
  }
  const ball = (c: V3, r: number, w: number, h: number) => bead(c, [r, r, r], w, h);
  const ring = fibonacciSphere(16);
  const cells = sites.flatMap((c) => ring.map((d): V3 => [c[0] + d[0] * FOLLICLE.cellRing, c[1] + d[1] * FOLLICLE.cellRing, c[2] + d[2] * FOLLICLE.cellRing]));
  const loops = sites.flatMap((c) =>
    [0, 1].map((tilt) => {
      const pts: V3[] = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const x = Math.cos(a) * FOLLICLE.capillary;
        const y = Math.sin(a) * FOLLICLE.capillary;
        // Two loops at right angles: one round the follicle's equator (x-z), one over its poles (y-z).
        pts.push(tilt ? [c[0], c[1] + x, c[2] + y] : [c[0] + x, c[1], c[2] + y]);
      }
      return tubeAlong(pts, () => 0.0002, { tubular: 16, radial: 4, closed: true });
    }),
  );
  // The four parathyroids again, smaller, split into the upper and lower pair, plus their cells.
  const glands: { c: V3; upper: boolean }[] = [];
  for (const s of [1, -1]) {
    glands.push({ c: [s * 0.015, 0.008, -0.0098], upper: true }, { c: [s * 0.015, -0.006, -0.0098], upper: false });
  }
  const GLAND_R: V3 = [0.0016, 0.00145, 0.0008];
  const cellDirs = fibonacciSphere(11);
  const chief: V3[] = [];
  const oxyphil: V3[] = [];
  for (const g of glands) {
    cellDirs.forEach((d, i) => {
      const q: V3 = [g.c[0] + d[0] * GLAND_R[0] * 0.5, g.c[1] + d[1] * GLAND_R[1] * 0.5, g.c[2] + d[2] * GLAND_R[2] * 0.4];
      (i % 4 === 0 ? oxyphil : chief).push(q);
    });
  }

  return [
    { id: 'right_lobe', geometry: polygonise(lobeField(1, 0.0068, 0.0188, 0.0062), bmin, bmax, { cell }) },
    { id: 'left_lobe', geometry: polygonise(lobeField(-1, 0.0068, 0.0188, 0.0062), bmin, bmax, { cell }) },
    { id: 'isthmus', geometry: polygonise(isthmusRod, [-0.015, -0.014, 0.0], [0.015, -0.002, 0.012], { cell: 0.001 }) },
    { id: 'follicles', geometry: mergeParts([scatter(1, 46, 0.0009, 0.72, 11, 0, 6, 4), scatter(-1, 46, 0.0009, 0.72, 23, 0, 6, 4)]) },
    { id: 'c_cells', geometry: mergeParts([scatter(1, 12, 0.0005, 0.7, 37, 0.3, 5, 3), scatter(-1, 12, 0.0005, 0.7, 41, 0.3, 5, 3)]) },
    { id: 'capsule', geometry: polygonise(capsuleField, bmin, bmax, { cell }) },
    { id: 'thyroid_arteries', geometry: mergeParts(arteries) },
    { id: 'thyroid_veins', geometry: mergeParts(veins) },
    { id: 'parathyroids', geometry: mergeParts(parathyroids) },
    // Level 1 again: the variable pyramidal lobe, rising from the isthmus beside the midline.
    {
      id: 'pyramidal_lobe',
      geometry: tubeAlong([[0.003, -0.006, 0.006], [0.0032, 0.003, 0.0058], [0.0026, 0.012, 0.005]], (t) => 0.0018 - 0.0011 * t, { tubular: 16, radial: 8 }),
    },
    // Children of `follicles`.
    { id: 'follicular_cells', geometry: beadsOf(cells, FOLLICLE.cell, 5, 3) },
    { id: 'colloid', geometry: mergeParts(sites.map((c) => ball(c, FOLLICLE.colloid, 12, 8))) },
    { id: 'follicle_basement_membrane', geometry: mergeParts(sites.map((c) => ball(c, FOLLICLE.membrane, 14, 9))) },
    { id: 'follicle_capillaries', geometry: mergeParts(loops) },
    // Children of `parathyroids`.
    { id: 'superior_parathyroid_glands', geometry: mergeParts(glands.filter((g) => g.upper).map((g) => bead(g.c, GLAND_R, 10, 6))) },
    { id: 'inferior_parathyroid_glands', geometry: mergeParts(glands.filter((g) => !g.upper).map((g) => bead(g.c, GLAND_R, 10, 6))) },
    { id: 'chief_cells', geometry: beadsOf(chief, 0.00019, 5, 3) },
    { id: 'oxyphil_cells', geometry: beadsOf(oxyphil, 0.00027, 5, 3) },
  ];
};
