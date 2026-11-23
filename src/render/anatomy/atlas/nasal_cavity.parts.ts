import * as THREE from 'three';
import type { PartBuilder, PartGeometry } from '../parts';
import { mergeParts, tubeAlong, type V3 } from '../sdf';
import { bead, cord } from './gland_shared';
import { blob as ball, stick } from './gi_shared';

/**
 * INTERIOR OF THE NASAL CAVITY AND SINUSES, in the organ's own frame (origin organs.json
 * [0, 0.352, 0.05]; +x the patient's right, +y up, +z forward; the shell is in
 * shells/nasal_cavity.ts). Everything is drawn for the right side at +x and mirrored, except
 * the magnified cell clusters, which are drawn once on the right.
 *
 * THE FRAME OF REFERENCE. Each side's chamber is an ellipsoid centred 8.5 mm out from the
 * midline, 8.5 mm wide, 22 mm high and 32 mm long (half-radii), and the septum is a thin
 * plate on the midline. The lateral wall at height y and distance z is therefore at
 * x = 0.0085 + 0.0085 * sqrt(1 - (y/0.022)^2 - (z/0.032)^2); every shelf, channel and
 * bead below was placed against that formula so that it sits inside the shell instead of
 * poking out, which is what the stub's septum did. These are drawing choices, not
 * measurements of any nose.
 *
 * WHAT RUNS WHERE (all from Gray's, as the data file cites). Three conchae hang from the
 * lateral wall, one above the other; under each lies its meatus (the channel it roofs). The
 * middle meatus carries the ethmoidal bulla and, below it, the semilunar hiatus, the cleft
 * the frontal, maxillary and anterior ethmoidal sinuses drain by. The sphenoethmoidal recess
 * lies above the superior concha and receives the sphenoidal sinus. The roof is the
 * cribriform plate, a sieve the olfactory nerve fila pass through; the olfactory region is
 * the patch of lining just under it. The floor is the hard palate's upper surface, and the
 * choanae are the two openings at the back into the nasopharynx.
 *
 * THE FINER STRUCTURES. Cells and glands are microscopic. The children of the respiratory
 * mucosa and the olfactory epithelium are ENLARGED SCHEMATIC CLUSTERS, one small patch of
 * wall each, with a few cells drawn at a size a camera can read. They show which cell types
 * are there and in what order they stand, not how many, and the data file says so in their
 * text. Cell counts and sizes are drawing choices.
 */

type G = THREE.BufferGeometry;
const both = (make: (s: number) => G[]): G => mergeParts([...make(1), ...make(-1)]);
const m = (s: number, p: V3): V3 => [s * p[0], p[1], p[2]];

/** An ellipsoid with optional rotation about z (the long axis then tilts in the x-y plane). */
function plate(c: V3, r: V3, rotZ = 0, w = 12, h = 8): G {
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(r[0], r[1], r[2]);
  if (rotZ !== 0) g.rotateZ(rotZ);
  g.translate(c[0], c[1], c[2]);
  return g;
}

/** An axis-aligned box, merged-friendly (no uv). */
function box(c: V3, h: V3): G {
  const g = new THREE.BoxGeometry(h[0] * 2, h[1] * 2, h[2] * 2);
  g.translate(c[0], c[1], c[2]);
  g.deleteAttribute('uv');
  return g;
}

const P = (id: string, geometry: G): PartGeometry => ({ id, geometry });

/* ----------------------------------------------------------- the three conchae */

/**
 * A concha is a curled shelf: a flat ellipsoid whose free (medial) edge hangs lower than its
 * attachment, plus a thinner rolled lip along that edge. Tilt and lip are display choices.
 */
function concha(s: number, c: V3, r: V3): G {
  const tilt = s * 0.35;
  const lipX = c[0] - r[0] * 0.8;
  return mergeParts([
    plate(m(s, c), [r[0], r[1], r[2]], tilt),
    stick(m(s, [lipX, c[1] - r[0] * 0.28 - r[1] * 0.4, c[2] - r[2] * 0.85]), m(s, [lipX, c[1] - r[0] * 0.28 - r[1] * 0.4, c[2] + r[2] * 0.85]), r[1] * 0.8, 6),
  ]);
}
const SUP_CONCHA = { c: [0.0105, 0.0125, -0.009] as V3, r: [0.003, 0.002, 0.0075] as V3 };
const MID_CONCHA = { c: [0.0115, 0.0045, 0.0] as V3, r: [0.0034, 0.0026, 0.0135] as V3 };
const INF_CONCHA = { c: [0.0108, -0.0085, 0.0015] as V3, r: [0.0036, 0.0028, 0.015] as V3 };

/* -------------------------------------------------- the cribriform sieve (lattice) */

/**
 * The plate is drawn as a lattice of thin bars, so the foramina the olfactory fila pass
 * through can be SEEN. The holes are on a 1.2 mm by 1.6 mm pitch so that the fila of the
 * olfactory cluster (below) go through real holes.
 */
const SIEVE_Y = 0.0196;
const SIEVE_BAR = 0.00015;
function cribriform(): G {
  const bars: G[] = [];
  const xs = [0.0024, 0.0036, 0.0048, 0.006, 0.0072, 0.0084];
  const zs: number[] = [];
  for (let z = -0.0062; z <= 0.0131; z += 0.0016) zs.push(z);
  for (const s of [1, -1]) {
    for (const x of xs) bars.push(box([s * x, SIEVE_Y, (zs[0] + zs[zs.length - 1]) / 2], [SIEVE_BAR, 0.00035, (zs[zs.length - 1] - zs[0]) / 2]));
    for (const z of zs) bars.push(box([s * (xs[0] + xs[xs.length - 1]) / 2, SIEVE_Y, z], [(xs[xs.length - 1] - xs[0]) / 2, 0.00035, SIEVE_BAR]));
  }
  // The crista galli, the bony blade that rises from the midline between the two sieves.
  bars.push(box([0, SIEVE_Y + 0.0013, 0.0035], [0.0007, 0.0016, 0.0035]));
  return mergeParts(bars);
}

/* ------------------------------------------- magnified schematic cell clusters */

/** Olfactory epithelium cluster: sites on a grid, right side, between the airway face and the roof. */
const OLF_X = [0.003, 0.0042, 0.0054];
const OLF_Z = [0.001, 0.0026, 0.0042, 0.0058];
const OLF_AIR = 0.017; // the surface facing the air
const OLF_BASE = 0.0189; // the base, next to the lamina propria
function olfactorySites(parity: number): V3[] {
  const out: V3[] = [];
  OLF_X.forEach((x, i) => OLF_Z.forEach((z, j) => { if ((i + j) % 2 === parity) out.push([x, 0, z]); }));
  return out;
}

/** Respiratory cluster: cells stand on the lateral wall of the inferior meatus and face medially (-x). */
const RESP_BASE = 0.014;
const RESP_APEX = 0.0125;
const RESP_Y = [-0.0112, -0.0127, -0.0142];
const RESP_Z = [-0.004, -0.0024, -0.0008, 0.0008, 0.0024, 0.004];
function respSites(): { goblet: V3[]; ciliated: V3[] } {
  const goblet: V3[] = [];
  const ciliated: V3[] = [];
  RESP_Y.forEach((y, i) => RESP_Z.forEach((z, j) => (((i + j) % 3 === 1 ? goblet : ciliated).push([0, y, z]))));
  return { goblet, ciliated };
}

export const parts: PartBuilder = () => {
  const out: PartGeometry[] = [];

  /* ---- vestibule, with the vibrissae ------------------------------------------ */
  out.push(P('nasal_vestibule', both((s) => [plate(m(s, [0.0085, -0.0115, 0.03]), [0.0058, 0.0066, 0.0048])])));
  {
    // Vibrissae: short stiff hairs in two rows on the floor and lateral wall of the vestibule, leaning in.
    const hairs: G[] = [];
    for (const s of [1, -1]) {
      for (let k = 0; k < 7; k++) {
        const a = Math.PI * (0.15 + 0.7 * (k / 6)); // around the lower half of the opening
        const bx = 0.0085 + 0.0054 * Math.cos(a);
        const by = -0.0115 - 0.0062 * Math.sin(a);
        const base: V3 = [s * bx, by, 0.032 + 0.0006 * (k % 2)];
        const tip: V3 = [s * (bx - 0.0034 * Math.cos(a)), by + 0.0042 * Math.sin(a), base[2] - 0.0012];
        hairs.push(stick(base, tip, 0.00016, 3));
      }
    }
    out.push(P('vibrissae', mergeParts(hairs)));
  }

  /* ---- the septum and its three parts ----------------------------------------- */
  out.push(P('nasal_septum', plate([0, 0, 0], [0.0016, 0.0185, 0.0285], 0, 16, 10)));
  out.push(P('septal_cartilage', plate([0, -0.003, 0.0185], [0.0011, 0.0105, 0.01])));
  out.push(P('perpendicular_plate', plate([0, 0.007, -0.006], [0.0011, 0.0105, 0.015])));
  out.push(P('vomer', plate([0, -0.0065, -0.0165], [0.0011, 0.0082, 0.0105])));

  /* ---- conchae, meatuses and the middle-meatus landmarks ---------------------- */
  out.push(P('turbinates', both((s) => [plate(m(s, [0.0125, -0.0005, 0.0005]), [0.0035, 0.0165, 0.0195], 0, 12, 8)])));
  out.push(P('superior_concha', both((s) => [concha(s, SUP_CONCHA.c, SUP_CONCHA.r)])));
  out.push(P('middle_concha', both((s) => [concha(s, MID_CONCHA.c, MID_CONCHA.r)])));
  out.push(P('inferior_concha', both((s) => [concha(s, INF_CONCHA.c, INF_CONCHA.r)])));
  out.push(P('superior_meatus', both((s) => [plate(m(s, [0.0137, 0.0085, -0.009]), [0.0012, 0.0017, 0.0065])])));
  out.push(P('middle_meatus', both((s) => [plate(m(s, [0.0143, -0.002, 0.0]), [0.0014, 0.0021, 0.0125])])));
  out.push(P('inferior_meatus', both((s) => [plate(m(s, [0.0136, -0.0125, 0.002]), [0.0014, 0.002, 0.014])])));
  out.push(P('sphenoethmoidal_recess', both((s) => [plate(m(s, [0.0082, 0.0165, -0.0145]), [0.0028, 0.0022, 0.005])])));
  out.push(P('ethmoidal_bulla', both((s) => [ball(m(s, [0.0145, 0.0075, 0.0025]), [0.0018, 0.0016, 0.0022], 10, 7)])));
  out.push(
    P('semilunar_hiatus', both((s) => [
      tubeAlong([m(s, [0.015, 0.004, 0.007]), m(s, [0.0152, 0.002, 0.003]), m(s, [0.015, 0.002, -0.001]), m(s, [0.0148, 0.0035, -0.0035])], () => 0.0005, { tubular: 10, radial: 5 }),
    ])),
  );
  out.push(P('nasolacrimal_opening', both((s) => [plate(m(s, [0.014, -0.0125, 0.0085]), [0.0006, 0.001, 0.0012], 0, 8, 6)])));

  /* ---- roof, floor, back, front ----------------------------------------------- */
  out.push(P('cribriform_plate', cribriform()));
  out.push(P('nasal_floor', both((s) => [plate(m(s, [0.0085, -0.0185, 0.0]), [0.0052, 0.0012, 0.0125])])));
  out.push(
    P('choanae', both((s) => {
      // Each choana is an oval opening in the plane of the back wall, drawn as a thin ring.
      const ring: V3[] = [];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ring.push(m(s, [0.0085 + 0.0055 * Math.cos(a), -0.002 + 0.0105 * Math.sin(a), -0.0295]));
      }
      return [tubeAlong(ring, () => 0.0006, { tubular: 24, radial: 4, closed: true })];
    })),
  );
  out.push(
    P('kiesselbach_area', both((s) => [
      plate(m(s, [0.0018, -0.004, 0.0205]), [0.0008, 0.003, 0.004], 0, 8, 6),
      // Four small arteries that meet there; this is the anastomosis the area is named for.
      cord([m(s, [0.0019, 0.0025, 0.0205]), m(s, [0.0019, -0.0005, 0.0205]), m(s, [0.0019, -0.004, 0.0205])], 0.00022),
      cord([m(s, [0.0019, -0.0125, 0.017]), m(s, [0.0019, -0.008, 0.0195]), m(s, [0.0019, -0.004, 0.0205])], 0.00022),
      cord([m(s, [0.0019, -0.004, 0.0275]), m(s, [0.0019, -0.004, 0.0235]), m(s, [0.0019, -0.004, 0.0205])], 0.00022),
      cord([m(s, [0.0019, -0.004, 0.0135]), m(s, [0.0019, -0.004, 0.0175]), m(s, [0.0019, -0.004, 0.0205])], 0.00022),
    ])),
  );

  /* ---- sinuses ---------------------------------------------------------------- */
  out.push(P('frontal_sinuses', both((s) => [plate(m(s, [0.0105, 0.03, 0.0105]), [0.0058, 0.005, 0.0062])])));
  {
    const cells: G[] = [];
    const sites: V3[] = [[0.0172, 0.0235, 0.0], [0.0194, 0.0205, 0.0075], [0.0165, 0.017, 0.0105], [0.0195, 0.0145, 0.0], [0.0167, 0.0115, 0.0075], [0.0198, 0.011, -0.0045], [0.0168, 0.0205, -0.0045], [0.0196, 0.0175, -0.005]];
    for (const s of [1, -1]) for (const p of sites) cells.push(bead(m(s, p), 0.0017, 8, 6));
    out.push(P('ethmoidal_cells', mergeParts(cells)));
  }
  out.push(P('maxillary_sinuses', both((s) => [plate(m(s, [0.028, -0.012, -0.002]), [0.0095, 0.0095, 0.0125], 0, 14, 10)])));
  out.push(P('sphenoidal_sinus', both((s) => [plate(m(s, [0.0055, 0.0115, -0.0225]), [0.0045, 0.0045, 0.006])])));

  /* ---- respiratory mucosa and its finer structures --------------------------- */
  out.push(P('respiratory_mucosa', both((s) => [plate(m(s, [0.0085, 0, 0]), [0.008, 0.0205, 0.0302], 0, 16, 10)])));
  {
    const { goblet, ciliated } = respSites();
    const bodies = ciliated.map((p) => stick([RESP_BASE, p[1], p[2]], [RESP_APEX, p[1], p[2]], 0.00046, 6));
    out.push(P('ciliated_epithelium', mergeParts(bodies)));
    // Cilia: a tuft of three short hairs on each ciliated cell, leaning toward the choana (-z),
    // the way the escalator sweeps. Drawn as their own part so the beat can move them alone.
    const tufts: G[] = [];
    for (const p of ciliated) {
      for (let k = -1; k <= 1; k++) {
        tufts.push(stick([RESP_APEX, p[1] + k * 0.00022, p[2]], [RESP_APEX - 0.0013, p[1] + k * 0.0003, p[2] - 0.0005], 0.00008, 3));
      }
    }
    out.push(P('cilia', mergeParts(tufts)));
    out.push(
      P('goblet_cells', mergeParts(goblet.flatMap((p) => [
        ball([RESP_BASE - 0.0006, p[1], p[2]], [0.0006, 0.0005, 0.0005], 8, 6),
        stick([RESP_BASE - 0.0011, p[1], p[2]], [RESP_APEX, p[1], p[2]], 0.00022, 4),
      ]))),
    );
    // Seromucous glands lie deeper than the epithelium; their ducts climb to the surface.
    const acini: G[] = [];
    const sites: V3[] = [[0.0147, -0.0115, -0.0035], [0.0147, -0.0132, -0.0004], [0.0147, -0.0118, 0.0027], [0.0147, -0.014, 0.0045], [0.015, -0.0105, 0.0008]];
    for (const p of sites) {
      acini.push(bead(p, 0.0005, 7, 5), bead([p[0] + 0.0004, p[1] + 0.0004, p[2] + 0.0005], 0.00036, 6, 4));
      acini.push(stick([p[0] - 0.0004, p[1], p[2]], [RESP_APEX, p[1] + 0.0004, p[2]], 0.00012, 3));
    }
    out.push(P('seromucous_glands', mergeParts(acini)));
  }
  {
    // Swell bodies: the large, thin-walled venous plexus of the inferior and middle concha,
    // drawn as one winding vein through each concha (right and left).
    const plexus: G[] = [];
    for (const s of [1, -1]) {
      for (const k of [INF_CONCHA, MID_CONCHA]) {
        const pts: V3[] = [];
        for (let i = 0; i <= 12; i++) {
          const z = k.c[2] + (i / 12 - 0.5) * 1.5 * k.r[2];
          pts.push(m(s, [k.c[0] + 0.0010 * Math.sin(i * 1.4), k.c[1] - 0.0006 + 0.0007 * Math.cos(i * 1.4), z]));
        }
        plexus.push(tubeAlong(pts, () => 0.0007, { tubular: 36, radial: 5 }));
      }
    }
    out.push(P('swell_bodies', mergeParts(plexus)));
  }

  /* ---- olfactory epithelium and its finer structures ------------------------- */
  out.push(
    P('olfactory_region', both((s) => [plate(m(s, [0.0045, 0.0185, 0.0045]), [0.0036, 0.0016, 0.0118])])),
  );
  out.push(P('olfactory_epithelium', both((s) => [plate(m(s, [0.0045, 0.018, 0.0045]), [0.003, 0.001, 0.01])])));
  {
    const sust = olfactorySites(0).map((p) => stick([p[0], OLF_AIR + 0.0002, p[2]], [p[0], OLF_BASE, p[2]], 0.0004, 5));
    out.push(P('sustentacular_cells', mergeParts(sust)));
    const neurons: G[] = [];
    for (const p of olfactorySites(1)) {
      const body = (OLF_AIR + OLF_BASE) / 2;
      neurons.push(bead([p[0], body, p[2]], 0.00032, 7, 5));
      neurons.push(stick([p[0], body, p[2]], [p[0], OLF_AIR - 0.0002, p[2]], 0.00012, 4)); // the dendrite
      neurons.push(bead([p[0], OLF_AIR - 0.0003, p[2]], 0.00026, 6, 4)); // its knob, which carries the cilia
      neurons.push(stick([p[0], body, p[2]], [p[0], SIEVE_Y - 0.0004, p[2]], 0.0001, 3)); // the axon
    }
    out.push(P('olfactory_receptor_neurons', mergeParts(neurons)));
    const basal: G[] = [];
    for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) basal.push(bead([OLF_X[0] + 0.0006 + 0.0012 * i, OLF_BASE - 0.0002, OLF_Z[0] + 0.0008 + 0.0016 * j], 0.00028, 6, 4));
    out.push(P('basal_cells', mergeParts(basal)));
    // Olfactory (Bowman) glands lie in the lamina propria, above the epithelium, with a duct to the surface.
    const glands: G[] = [];
    const gs: [number, number][] = [[0.0036, 0.0018], [0.0048, 0.0034], [0.0036, 0.005], [0.0048, 0.0064]];
    for (const [x, z] of gs) {
      glands.push(bead([x, OLF_BASE + 0.0006, z], 0.0004, 7, 5));
      glands.push(stick([x, OLF_BASE + 0.0003, z], [x, OLF_AIR + 0.0001, z], 0.00009, 3));
    }
    out.push(P('olfactory_glands', mergeParts(glands)));
    // Nerve fila: the axons gather, pass up through the sieve and leave toward the bulb.
    const fila: G[] = [];
    for (const p of olfactorySites(1)) {
      fila.push(cord([[p[0], SIEVE_Y - 0.0004, p[2]], [p[0], SIEVE_Y + 0.0012, p[2]], [p[0] * 0.8 + 0.0008, 0.0245, p[2] * 0.85 + 0.002], [0.0042, 0.0275, 0.004]], 0.00016, 8, 4));
    }
    out.push(P('olfactory_nerve_fila', mergeParts(fila)));
  }
  return out;
};
