import * as THREE from 'three';
import type { PartBuilder } from '../parts';
import { ellipsoid, mergeParts, polygonise, tubeAlong, type V3 } from '../sdf';
import { mulberry32 } from '../noise';

/**
 * THE INSIDE OF THE OVARIES.
 *
 * An ovary is an almond-shaped organ with a dense fibrous capsule, the tunica albuginea,
 * under which lies the cortex, which holds the follicles at every stage of development and
 * the scars they leave; the medulla at the centre is looser connective tissue carrying the
 * blood vessels, which enter and leave at the hilum on the border that is attached to the
 * broad ligament (GRAYS42, GH14). This file draws both ovaries, side by side, as the
 * shell in models.ts does: one mesh, the right ovary at x = +0.05 and the left at x = -0.05
 * (+x is the patient's right), each an ellipsoid [15.5, 8.5, 7.5] mm with a pitted surface.
 *
 * WHAT IS GLASS AND WHAT IS SOLID. The tunica, the cortex boundary and the medulla enclose
 * other parts, so the detail module draws them as glass; the vessels are tubes carrying a
 * stream, so they are glass too. The follicles, the oocyte, the corpus luteum and the scar
 * are the content a viewer should be able to tap, and stay solid.
 *
 * ONE DOMINANT FOLLICLE, in the right ovary only, drawn at its LARGEST so the detail module
 * can only ever scale it down (it can never leave the shell). The corpus luteum is built at
 * the same place, because the corpus luteum forms from the wall of the follicle that
 * ovulated; the corpus albicans, the pale scar of an earlier cycle, is in the left ovary.
 * Which ovary carries the follicle is a drawing choice: in a real cycle the dominant follicle
 * alternates unpredictably, and the model has no side.
 *
 * NOT DRAWN. The ovarian ligament, the mesovarium, the nerve plexus, the theca and
 * granulosa layers of the follicle wall, the stroma's cell types, or any particular
 * count of follicles: the small follicles are scattered beads whose number and sizes were
 * chosen to read clearly, not counted. Primordial follicles are drawn far larger than they
 * are, because at true scale they would be invisible.
 */

/** Ellipsoid radii of the shell, metres, and the x of the right ovary's centre. */
const SHELL: V3 = [0.0155, 0.0085, 0.0075];
const CX = 0.05;
/** Layers, as inward offsets from the shell surface: tunica 1.2 mm in, cortex floor 3.2 mm. */
const TUNICA: V3 = [SHELL[0] - 0.0012, SHELL[1] - 0.0012, SHELL[2] - 0.0012];
const CORTEX: V3 = [SHELL[0] - 0.0032, SHELL[1] - 0.0032, SHELL[2] - 0.0032];
const MEDULLA: V3 = [0.0085, 0.003, 0.0024];

/** The dominant follicle's centre (right ovary) and its largest radius, metres. */
export const FOLLICLE_CENTRE: V3 = [CX + 0.0045, 0.0005, -0.0005];
export const FOLLICLE_RADIUS = 0.0038;
/** The corpus luteum fills the follicle's place, a little smaller than the follicle was. */
export const LUTEUM_RADIUS = 0.0033;
/** The scar of an earlier cycle in the left ovary. */
export const ALBICANS_CENTRE: V3 = [-CX - 0.0035, 0.0028, 0];
/** Where the oocyte sits inside the follicle, on the side nearest the surface. */
export const OOCYTE_CENTRE: V3 = [FOLLICLE_CENTRE[0] + 0.0018, FOLLICLE_CENTRE[1] + 0.0016, FOLLICLE_CENTRE[2] + 0.0003];

/** The hilum of each ovary: the anterior border, where the vessels enter and leave. */
export const hilum = (side: 1 | -1): V3 => [side * CX + side * 0.0012, -0.0022, 0.0053];

/** Route of the ovarian artery into the medulla, and of the vein out, for one side. */
export function vesselPaths(side: 1 | -1): { artery: V3[]; vein: V3[] } {
  const x = side * CX;
  const h = hilum(side);
  return {
    artery: [
      [h[0], h[1] + 0.0004, h[2]],
      [x + side * 0.0008, -0.0014, 0.0038],
      [x + side * 0.0002, -0.0005, 0.0016],
      [x - side * 0.0035, 0.0003, 0.0006],
      [x - side * 0.0068, 0.0006, 0.0002],
    ],
    vein: [
      [x - side * 0.0066, -0.0004, -0.0006],
      [x - side * 0.0028, -0.0010, 0.0002],
      [x + side * 0.0004, -0.0018, 0.0014],
      [x + side * 0.0014, -0.0027, 0.0036],
      [h[0] + side * 0.0003, h[1] - 0.0004, h[2] - 0.0002],
    ],
  };
}

/** A route from the follicle's wall to the surface towards the fimbriae, for the oocyte stream. */
export const OOCYTE_ROUTE: V3[] = [
  [FOLLICLE_CENTRE[0] + 0.0020, FOLLICLE_CENTRE[1] + 0.0020, FOLLICLE_CENTRE[2] + 0.0004],
  [CX + 0.0095, 0.0042, 0.0007],
  [CX + 0.0115, 0.0058, 0.0011],
];

const scaledSphere = (c: V3, r: V3, seg: number): THREE.BufferGeometry => {
  const g = new THREE.SphereGeometry(1, seg, Math.max(6, Math.round(seg * 0.7)));
  g.scale(r[0], r[1], r[2]);
  g.translate(c[0], c[1], c[2]);
  return g;
};

/** Beads on the cortex: positions inside the band between the tunica and the cortex floor. */
function beads(side: 1 | -1, count: number, seed: number, rMin: number, rMax: number, keepClear: readonly (readonly [V3, number])[]): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const mid: V3 = [(TUNICA[0] + CORTEX[0]) / 2, (TUNICA[1] + CORTEX[1]) / 2, (TUNICA[2] + CORTEX[2]) / 2];
  const geoms: THREE.BufferGeometry[] = [];
  let guard = 0;
  while (geoms.length < count && guard++ < count * 40) {
    // A uniform direction on the sphere, mapped onto the ellipsoid half-way down the cortex.
    const u = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const p: V3 = [side * CX + mid[0] * s * Math.cos(a), mid[1] * u, mid[2] * s * Math.sin(a)];
    // The anterior border is the hilum: no follicles where the vessels come in.
    if (p[2] > 0.0032 && Math.abs(p[0] - side * CX) < 0.006 && p[1] < 0.002) continue;
    let clear = true;
    for (const [c, d] of keepClear) if (Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) < d) clear = false;
    if (!clear) continue;
    const r = rMin + (rMax - rMin) * rand();
    geoms.push(scaledSphere(p, [r, r, r], 6));
  }
  return mergeParts(geoms);
}

export const parts: PartBuilder = () => {
  const out: { id: string; geometry: THREE.BufferGeometry }[] = [];
  const sides = [1, -1] as const;
  const box = (r: V3, pad: number): [V3, V3] => [
    [-r[0] - pad, -r[1] - pad, -r[2] - pad],
    [r[0] + pad, r[1] + pad, r[2] + pad],
  ];
  const both = (radii: V3, cell: number, bump = 0): THREE.BufferGeometry => {
    const gs: THREE.BufferGeometry[] = [];
    for (const s of sides) {
      const base = ellipsoid([0, 0, 0], radii);
      const [lo, hi] = box(radii, 0.001);
      const g = polygonise(bump > 0 ? (x, y, z) => base(x, y, z) + bump * Math.sin(x * 900) * Math.sin(z * 700) : base, lo, hi, { cell });
      g.translate(s * CX, 0, 0);
      gs.push(g);
    }
    return mergeParts(gs);
  };

  // The capsule, a single closed surface just under the shell; the cortex floor; the medulla.
  out.push({ id: 'tunica_albuginea', geometry: both(TUNICA, 0.0014) });
  out.push({ id: 'cortex', geometry: both(CORTEX, 0.0013, 0.00015) });
  out.push({ id: 'medulla', geometry: both(MEDULLA, 0.0008) });

  // Vessels: a trunk entering at the hilum and a branch into the medulla, both sides.
  const arteries: THREE.BufferGeometry[] = [];
  const veins: THREE.BufferGeometry[] = [];
  for (const s of sides) {
    const p = vesselPaths(s);
    arteries.push(tubeAlong(p.artery, (t) => 0.00042 - 0.00018 * t, { tubular: 24, radial: 8 }));
    veins.push(tubeAlong(p.vein, (t) => 0.00032 + 0.00018 * t, { tubular: 24, radial: 8 }));
    // A side branch of each, a short twig reaching into the cortex floor.
    const x = s * CX;
    arteries.push(tubeAlong([[x + s * 0.0002, -0.0005, 0.0016], [x + s * 0.0010, 0.0016, 0.0010], [x + s * 0.0030, 0.0030, 0.0004]], (t) => 0.00026 - 0.0001 * t, { tubular: 12, radial: 6 }));
    veins.push(tubeAlong([[x + s * 0.0030, 0.0022, -0.0003], [x + s * 0.0012, 0.0008, 0.0006], [x + s * 0.0004, -0.0018, 0.0014]], (t) => 0.0002 + 0.00012 * t, { tubular: 12, radial: 6 }));
  }
  out.push({ id: 'ovarian_artery', geometry: mergeParts(arteries) });
  out.push({ id: 'ovarian_vein', geometry: mergeParts(veins) });

  // Small follicles. The right ovary keeps clear of the dominant follicle, the left of the scar.
  const clearR: readonly (readonly [V3, number])[] = [[FOLLICLE_CENTRE, 0.0062]];
  const clearL: readonly (readonly [V3, number])[] = [[ALBICANS_CENTRE, 0.0035]];
  out.push({
    id: 'primordial_follicles',
    geometry: mergeParts([beads(1, 34, 0x0a11, 0.00035, 0.0005, clearR), beads(-1, 34, 0x0b22, 0.00035, 0.0005, clearL)]),
  });
  out.push({
    id: 'growing_follicles',
    geometry: mergeParts([beads(1, 7, 0x0c33, 0.0007, 0.001, clearR), beads(-1, 8, 0x0d44, 0.0007, 0.001, clearL)]),
  });

  // The dominant follicle at its largest, and the oocyte with its cumulus inside it.
  out.push({ id: 'dominant_follicle', geometry: scaledSphere(FOLLICLE_CENTRE, [FOLLICLE_RADIUS, FOLLICLE_RADIUS, FOLLICLE_RADIUS], 28) });
  out.push({ id: 'oocyte', geometry: scaledSphere(OOCYTE_CENTRE, [0.0006, 0.0006, 0.0006], 10) });

  // Corpus luteum: a convoluted, thick-walled body, so the sphere is crenellated.
  const lum = ellipsoid(FOLLICLE_CENTRE, [LUTEUM_RADIUS, LUTEUM_RADIUS, LUTEUM_RADIUS]);
  out.push({
    id: 'corpus_luteum',
    geometry: polygonise(
      (x, y, z) => lum(x, y, z) + 0.00028 * Math.sin(x * 2300 + 1) * Math.sin(y * 2100) * Math.sin(z * 2500 + 2),
      [FOLLICLE_CENTRE[0] - 0.0042, FOLLICLE_CENTRE[1] - 0.0042, FOLLICLE_CENTRE[2] - 0.0042],
      [FOLLICLE_CENTRE[0] + 0.0042, FOLLICLE_CENTRE[1] + 0.0042, FOLLICLE_CENTRE[2] + 0.0042],
      { cell: 0.0004 },
    ),
  });

  // Corpus albicans: a small, irregular scar.
  const alb = ellipsoid(ALBICANS_CENTRE, [0.0017, 0.001, 0.0012]);
  out.push({
    id: 'corpus_albicans',
    geometry: polygonise(
      (x, y, z) => alb(x, y, z) + 0.0002 * Math.sin(x * 3000) * Math.sin(z * 2600 + 1),
      [ALBICANS_CENTRE[0] - 0.0024, ALBICANS_CENTRE[1] - 0.002, ALBICANS_CENTRE[2] - 0.002],
      [ALBICANS_CENTRE[0] + 0.0024, ALBICANS_CENTRE[1] + 0.002, ALBICANS_CENTRE[2] + 0.002],
      { cell: 0.00028 },
    ),
  });
  return out;
};
