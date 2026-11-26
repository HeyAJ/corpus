import * as THREE from 'three';
import type { PartBuilder, PartGeometry } from '../parts';
import { ellipsoid, halfSpace, intersect, mergeParts, polygonise, smoothUnion, type Sdf, type V3 } from '../sdf';
import { mulberry32 } from '../noise';
import { bead, beads, cord, fibonacciSphere } from './gland_shared';
import { blob } from './gi_shared';
import { PAROTID, parotidField, SUBLINGUAL, SUBMANDIBULAR, tiltedAboutY } from '../shells/salivary_glands';

/**
 * THE INSIDE OF THE SALIVARY GLANDS.
 *
 * FRAME. The organ's own, origin organs.json [0, 0.33, 0.02] (scene y 0.39 after the cranial
 * lift), +x the patient's right. The parotid and submandibular ellipsoids of the shell
 * (shells/salivary_glands.ts) are kept, and every other structure is placed against the MOUTH
 * atlas, whose frame sits 0.010 m lower and 0.022 m further forward than this one:
 * `fromMouth` converts. That is how the parotid duct ends on the cheek papilla and the
 * submandibular duct ends on the sublingual caruncle that the mouth atlas draws, instead of
 * each atlas guessing its own place for them.
 *
 * WHAT IS AND IS NOT ANATOMY. The textbook arrangement is followed: the facial nerve plexus
 * lies between a superficial and a deep part of the parotid; the parotid duct runs forward
 * across the cheek; the submandibular duct runs forward above the floor of the mouth; the
 * sublingual gland opens by many small ducts; the otic and submandibular ganglia relay the
 * parasympathetic fibres. Gland sizes, lobule counts and duct paths are DRAWING choices.
 *
 * The SALIVARY ACINUS is a magnified, schematic diagram, not a part of the head at true
 * size or in a true place: it floats in the middle of the organ so that it can be seen
 * beside the glands it explains. Its summary says so.
 *
 * HISTORY. This replaces a stub of one sphere per gland. Lobules are the bumps of a
 * smooth union of the main ellipsoid with small spheres placed on directions from a Fibonacci
 * lattice, so the outline is the same on every build.
 */

/** A point given in the mouth atlas's frame, expressed in this one. */
const fromMouth = (x: number, y: number, z: number): V3 => [x, y - 0.01, z + 0.022];
const R = (v: readonly number[], side: number): V3 => [side * v[0], v[1], v[2]];
const merge = (g: THREE.BufferGeometry[]): THREE.BufferGeometry => mergeParts(g);

/**
 * The parotid duct of the patient's right side; the left is its mirror. It leaves the front of
 * the superficial lobe, runs forward across the outside of the masseter (lateral to the ramus and
 * the coronoid, 3 mm clear of both), turns in through the buccinator and opens in the oral
 * vestibule opposite the crown of the upper second molar (Gray's). In the mouth atlas's frame
 * the crown's centre is (0.0171, 0.0019, 0.0012) (third tooth of the molar row; `QUARTER` and
 * the arch there), the vestibule's wall opposite it is x about 0.0226, and the mouth's own
 * parotid papilla bead is at (0.0232, 0.002, 0), so the duct ends 1 mm from that bead on the
 * wall at the crown's height and z. It used to end ON the bead, 1.2 mm behind the crown and
 * 2.2 mm from the vestibule tube's surface; this is closer to both.
 */
export const PAROTID_DUCT: V3[] = [[0.0625, 0.0055, -0.025], [0.0615, 0.002, -0.01], [0.059, -0.0025, 0.006], [0.048, -0.0055, 0.0185], fromMouth(0.0226, 0.0019, 0.0008)];
/** The submandibular duct of the right side. Ends on the sublingual caruncle. */
export const SUBMANDIBULAR_DUCT: V3[] = [[0.03, -0.0285, 0.014], [0.019, -0.024, 0.0225], [0.009, -0.02, 0.029], fromMouth(0.002, -0.008, 0.01)];
/** Where the magnified acinus sits, and its duct (used by the detail module for the droplets). */
const AC: V3 = [0, 0.01, 0.004];
const ac = (x: number, y: number, z: number): V3 => [AC[0] + x, AC[1] + y, AC[2] + z];
export const ACINUS_DUCT: V3[] = [ac(0, 0.0098, 0), ac(0, 0.014, 0), ac(0, 0.0195, 0)];

/* ------------------------------------------------------------------ glands */

function lobulated(c: V3, r: V3, n: number, bump: number, k: number): Sdf {
  const fields: Sdf[] = [ellipsoid(c, r)];
  for (const d of fibonacciSphere(n)) {
    fields.push(ellipsoid([c[0] + d[0] * r[0] * 0.85, c[1] + d[1] * r[1] * 0.85, c[2] + d[2] * r[2] * 0.85], [bump, bump, bump]));
  }
  return smoothUnion(k, ...fields);
}
// Centres and radii live in the shell (shells/salivary_glands.ts, which says why they moved in
// from x 34 mm and 12 mm to lie against the inner surface of the mandible's body).
const SUBMAND_C = (s: number): V3 => [s * SUBMANDIBULAR.c[0], SUBMANDIBULAR.c[1], SUBMANDIBULAR.c[2]];
const SUBMAND_R: V3 = SUBMANDIBULAR.r;
const SUBLING_C = (s: number): V3 => [s * SUBLINGUAL.c[0], SUBLINGUAL.c[1], SUBLINGUAL.c[2]];
const SUBLING_R: V3 = SUBLINGUAL.r;

function bothSides(make: (s: number) => THREE.BufferGeometry): THREE.BufferGeometry {
  return merge([make(1), make(-1)]);
}
function gland(c: V3, r: V3, n: number, bump: number, cell: number, tilt = 0, side = 1): THREE.BufferGeometry {
  // A turned gland is built in a frame centred on itself and turned by `tiltedAboutY`, so the
  // lobules turn with it; the box is the sphere that holds the gland whatever its turn.
  const f = tilt === 0 ? lobulated(c, r, n, bump, 0.0022) : tiltedAboutY(lobulated([0, 0, 0], r, n, bump, 0.0022), c, tilt, side);
  const pad = Math.max(r[0], r[1], r[2]) + bump + 0.002;
  return polygonise(f, [c[0] - pad, c[1] - pad, c[2] - pad], [c[0] + pad, c[1] + pad, c[2] + pad], { cell, maxCells: 60000 });
}
/** The lobulated parotid: the shell's three ellipsoids (superficial, deep, bridge), each with its own surface bumps. */
function parotidLobulated(s: number): THREE.BufferGeometry {
  const lobes = [PAROTID.superficial, PAROTID.deep, PAROTID.bridge].map((g, i) => lobulated([s * g.c[0], g.c[1], g.c[2]], g.r, [8, 6, 5][i], 0.0028, 0.0022));
  const f = smoothUnion(0.002, ...lobes);
  return polygonise(f, [Math.min(s * 0.038, s * 0.074), -0.018, -0.054], [Math.max(s * 0.038, s * 0.074), 0.034, -0.01], { cell: 0.0014, maxCells: 140000 });
}
/** One half of a parotid, cut by the plane of the facial nerve plexus: lateral (superficial) or medial (deep). */
function parotidHalf(s: number, lateral: boolean): THREE.BufferGeometry {
  const cut = halfSpace([s * PAROTID.plexusPlaneX, 0, 0], [lateral ? s : -s, 0, 0]);
  const f = intersect(parotidField(s, 0.0004), cut);
  return polygonise(f, [Math.min(s * 0.038, s * 0.074), -0.018, -0.054], [Math.max(s * 0.038, s * 0.074), 0.034, -0.01], { cell: 0.0014, maxCells: 140000 });
}

/* ------------------------------------------------------------------- ducts */

const duct = (path: readonly V3[], side: number, r: number): THREE.BufferGeometry => cord(path.map((p) => R(p, side)), r, 24, 6);
function sublingualDucts(): THREE.BufferGeometry {
  // The sublingual fold, in this frame, as three points; each small duct runs from the top of the gland to a point along it.
  const fold: V3[] = [fromMouth(0.0035, -0.0077, 0.0098), fromMouth(0.0062, -0.0074, 0.0045), fromMouth(0.0085, -0.0070, -0.001)];
  const parts: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    for (let k = 0; k < 8; k++) {
      const t = k / 7;
      const seg = t < 0.5 ? 0 : 1;
      const u = t < 0.5 ? t * 2 : (t - 0.5) * 2;
      const f: V3 = [fold[seg][0] + u * (fold[seg + 1][0] - fold[seg][0]), fold[seg][1] + u * (fold[seg + 1][1] - fold[seg][1]), fold[seg][2] + u * (fold[seg + 1][2] - fold[seg][2])];
      parts.push(cord([[s * 0.0095, -0.0192, f[2]], [s * f[0], f[1], f[2]]], 0.0003, 3, 4));
    }
  }
  return merge(parts);
}

/* ------------------------------------------------------------------- minor */

function minor(kind: 'labial' | 'buccal' | 'palatine' | 'lingual'): THREE.BufferGeometry {
  const rnd = mulberry32({ labial: 5, buccal: 7, palatine: 9, lingual: 13 }[kind]);
  const c: V3[] = [];
  if (kind === 'labial') {
    for (let i = 0; i < 8; i++) {
      const x = -0.01 + (0.02 * i) / 7;
      c.push(fromMouth(x, 0.0026, 0.0225), fromMouth(x * 0.9, -0.003, 0.0225));
    }
  } else if (kind === 'buccal') {
    for (let i = 0; i < 16; i++) {
      const s = i % 2 ? 1 : -1;
      c.push(fromMouth(s * 0.023, (rnd() * 2 - 1) * 0.005, -0.01 + rnd() * 0.022));
    }
  } else if (kind === 'palatine') {
    for (let i = 0; i < 16; i++) {
      const x = (rnd() * 2 - 1) * 0.01;
      const z = -0.003 + rnd() * 0.017;
      // The mouth atlas's palatal vault (atlas/mouth.parts.ts `vault`), repeated here so the two stay level.
      const roof = 0.0122 * Math.sqrt(Math.max(0, 1 - (z / 0.0275) ** 2)) - 0.0012;
      const top = Math.min(0.0108, roof);
      const edge = Math.min(0.0068, top - 0.001);
      c.push(fromMouth(x, edge + (top - edge) * (1 - Math.min(1, (x / 0.015) ** 2)) + 0.0007, z));
    }
  } else {
    for (let i = 0; i < 10; i++) c.push(fromMouth((rnd() * 2 - 1) * 0.008, -0.001, -0.012 + rnd() * 0.008));
  }
  return beads(c, 0.0007, 6, 4);
}

/* -------------------------------------------------------------------- nerves */

/**
 * The facial nerve's plexus in the parotid, right side, this frame. The trunk enters at the
 * stylomastoid foramen (between the styloid process and the mastoid process, below and behind the
 * ear canal; shells/skull.ts has both bones) and divides at the plane between the superficial and
 * deep lobes (PAROTID.plexusPlaneX) into a temporofacial division that runs up and forward and a
 * cervicofacial division that runs down and forward, each ending in two branches that cross the superficial lobe and leave the
 * gland's front edge, outside the ramus (a branch ending at the plane itself ran 1.3 mm into the ramus). The foramen is placed by a numerical search for the point equally near the
 * styloid process's root and the mastoid process's surface (see the agent's report); the branch
 * courses are drawings. They used to start at the old, higher gland.
 */
export const STYLOMASTOID_FORAMEN: V3 = [0.0525, 0.026, -0.037];
const FACIAL = {
  trunk: [STYLOMASTOID_FORAMEN, [0.0548, 0.0195, -0.0395], [0.0565, 0.0125, -0.0385]] as V3[],
  tempo: [[0.0565, 0.0125, -0.0385], [0.0575, 0.0175, -0.0325], [0.06, 0.022, -0.027]] as V3[],
  tempoBranches: [[[0.06, 0.022, -0.027], [0.0625, 0.0245, -0.0235]], [[0.06, 0.022, -0.027], [0.0625, 0.0245, -0.0295]]] as V3[][],
  cervico: [[0.0565, 0.0125, -0.0385], [0.0575, 0.007, -0.034], [0.06, 0.0, -0.029]] as V3[],
  cervicoBranches: [[[0.06, 0.0, -0.029], [0.0625, -0.0035, -0.025]], [[0.06, 0.0, -0.029], [0.0625, -0.0015, -0.0235]]] as V3[][],
};
function facial(which: 'all' | 'tempo' | 'cervico'): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    const line = (p: V3[], r: number): void => {
      parts.push(cord(p.map((q) => R(q, s)), r, 10, 4));
    };
    if (which === 'all') line(FACIAL.trunk, 0.0004);
    if (which !== 'cervico') {
      line(FACIAL.tempo, 0.00034);
      FACIAL.tempoBranches.forEach((b) => line(b, 0.00026));
    }
    if (which !== 'tempo') {
      line(FACIAL.cervico, 0.00034);
      FACIAL.cervicoBranches.forEach((b) => line(b, 0.00026));
    }
  }
  return merge(parts);
}
function ganglion(which: 'otic' | 'submandibular'): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    if (which === 'otic') {
      parts.push(bead(R([0.0465, 0.03, -0.0105], s), 0.0011, 8, 6));
      parts.push(cord([[0.0465, 0.03, -0.0105], [0.0485, 0.0255, -0.024], [0.0495, 0.02, -0.0395]].map((p) => R(p, s)), 0.00028, 6, 4));
      parts.push(cord([[0.044, 0.04, -0.012], [0.0455, 0.035, -0.0112], [0.0465, 0.03, -0.0105]].map((p) => R(p, s)), 0.00026, 6, 4));
    } else {
      parts.push(bead(R([0.0265, -0.0235, 0.018], s), 0.001, 8, 6));
      parts.push(cord([[0.0265, -0.0235, 0.018], [0.028, -0.0245, 0.0155], [0.0295, -0.0255, 0.0135]].map((p) => R(p, s)), 0.00028, 6, 4));
      parts.push(cord([[0.0265, -0.0235, 0.018], [0.021, -0.022, 0.0215], [0.0155, -0.0205, 0.0245]].map((p) => R(p, s)), 0.00028, 6, 4));
      parts.push(cord([[0.03, -0.012, 0.02], [0.028, -0.018, 0.019], [0.0265, -0.0235, 0.018]].map((p) => R(p, s)), 0.00026, 6, 4));
    }
  }
  return merge(parts);
}

/* -------------------------------------------------------------------- acinus */

const SEROUS_C = ac(-0.0055, 0.002, 0);
const SEROUS_R = 0.0028;
const MUCOUS_C = ac(0.003, 0.003, 0);
const MUCOUS_R = 0.0033;
const onSphere = (c: V3, r: number, d: V3): V3 => [c[0] + d[0] * r, c[1] + d[1] * r, c[2] + d[2] * r];
function arcs(c: V3, r: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 5; k++) {
    const phi = (k / 5) * Math.PI * 2;
    const pts: V3[] = [];
    for (let i = 0; i < 7; i++) {
      const th = ((20 + (140 * i) / 6) * Math.PI) / 180;
      pts.push(onSphere(c, r + 0.0004, [Math.sin(th) * Math.cos(phi), Math.cos(th), Math.sin(th) * Math.sin(phi)]));
    }
    out.push(cord(pts, 0.00016, 10, 3));
  }
  return out;
}
function stridations(): THREE.BufferGeometry[] {
  return [0.0105, 0.0116, 0.0127, 0.0136].map((y) => {
    const g = new THREE.TorusGeometry(0.0008, 0.00012, 3, 10);
    g.rotateX(Math.PI / 2);
    g.translate(AC[0], AC[1] + y, AC[2]);
    return g;
  });
}

/* --------------------------------------------------------------------- build */

export const parts: PartBuilder = () => {
  const out: PartGeometry[] = [];
  const add = (id: string, geometry: THREE.BufferGeometry): void => {
    out.push({ id, geometry });
  };

  add('parotid_glands', bothSides(parotidLobulated));
  add('parotid_superficial_part', bothSides((s) => parotidHalf(s, true)));
  add('parotid_deep_part', bothSides((s) => parotidHalf(s, false)));
  add('parotid_duct', merge([1, -1].map((s) => duct(PAROTID_DUCT, s, 0.0006))));
  add('submandibular_glands', bothSides((s) => gland(SUBMAND_C(s), SUBMAND_R, 7, 0.0028, 0.0014, SUBMANDIBULAR.tilt, s)));
  add('submandibular_duct', merge([1, -1].map((s) => duct(SUBMANDIBULAR_DUCT, s, 0.0006))));
  add('sublingual_glands', bothSides((s) => gland(SUBLING_C(s), SUBLING_R, 6, 0.0018, 0.0011)));
  add('sublingual_ducts', sublingualDucts());

  add('minor_salivary_glands', merge([minor('labial'), minor('buccal'), minor('palatine'), minor('lingual')]));
  add('labial_glands', minor('labial'));
  add('buccal_glands', minor('buccal'));
  add('palatine_glands', minor('palatine'));
  add('lingual_glands', minor('lingual'));

  add('intraparotid_facial_plexus', facial('all'));
  add('temporofacial_division', facial('tempo'));
  add('cervicofacial_division', facial('cervico'));

  add('parasympathetic_supply', merge([ganglion('otic'), ganglion('submandibular')]));
  add('otic_ganglion', ganglion('otic'));
  add('submandibular_ganglion', ganglion('submandibular'));

  // The magnified acinus.
  add('salivary_acinus', merge([blob(SEROUS_C, SEROUS_R + 0.001, 14, 10), blob(MUCOUS_C, MUCOUS_R + 0.001, 14, 10)]));
  add('serous_acinar_cells', beads(fibonacciSphere(9).map((d) => onSphere(SEROUS_C, SEROUS_R, d)), 0.0011, 7, 5));
  add('mucous_acinar_cells', beads(fibonacciSphere(10).map((d) => onSphere(MUCOUS_C, MUCOUS_R, d)), 0.0013, 7, 5));
  add('serous_demilunes', beads(fibonacciSphere(30).filter((d) => d[1] > 0.55).map((d) => onSphere(MUCOUS_C, MUCOUS_R + 0.0007, d)), 0.001, 7, 5));
  add('myoepithelial_cells', merge([...arcs(SEROUS_C, SEROUS_R), ...arcs(MUCOUS_C, MUCOUS_R)]));
  add('intercalated_duct', merge([
    cord([ac(-0.0055, 0.0045, 0), ac(-0.003, 0.0072, 0), ac(0, 0.0098, 0)], 0.00028, 10, 5),
    cord([ac(0.003, 0.006, 0), ac(0.0016, 0.0082, 0), ac(0, 0.0098, 0)], 0.00028, 10, 5),
  ]));
  add('striated_duct', merge([cord([ac(0, 0.0098, 0), ac(0, 0.014, 0)], 0.0007, 8, 8), ...stridations()]));
  add('excretory_duct', cord([ac(0, 0.014, 0), ac(0, 0.0195, 0)], 0.001, 8, 8));
  return out;
};
