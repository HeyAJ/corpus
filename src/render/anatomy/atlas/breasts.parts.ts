import * as THREE from 'three';
import type { PartBuilder } from '../parts';
import { ellipsoid, halfSpace, intersect, mergeParts, polygonise, tubeAlong, type V3 } from '../sdf';
import { mulberry32 } from '../noise';

/**
 * INTERIOR OF THE BREAST, in the register of an anatomy textbook. The shell in models.ts is
 * one dome per side (centre x = +-72 mm, y -4 mm, z -12 mm, flattened against the chest
 * wall at z = -30 mm) with the nipple on its front; both sides are authored here in one
 * frame, mirrored by the sign `s` (+1 = the patient's right).
 *
 * STRUCTURE, FRONT TO BACK. Nipple and areola on the skin; the lactiferous ducts converge
 * on the nipple, each widening into a sinus just behind it; they drain the glandular lobes,
 * which radiate round the nipple like the spokes of a wheel, each ending in a cluster of
 * lobules (drawn as small beads). Fat (the adipose envelope, glass) fills the space round
 * them. Suspensory ligaments (Cooper's) are fibrous bands that run from the pectoral fascia
 * on the chest wall to the skin. Lymph vessels collect from the areola and the gland and
 * run outwards and upwards to the lymph nodes towards the axilla, which lies beyond the
 * upper outer edge of the dome; the nodes are drawn at that edge.
 *
 * Lobe count and lobule placement are a clear schematic: twelve lobes a side, placed by a
 * fixed pattern and a seeded generator so the result is deterministic. A real breast has
 * about fifteen to twenty, and no number here is a measurement.
 *
 * FINER STRUCTURES (T2; src/data/anatomy/breasts.json `parent`). New level-1 parts: the lactiferous
 * sinuses (a swelling on each duct behind the nipple), the areolar (Montgomery) glands, the
 * retromammary space and the axillary tail. One lobule per breast is drawn as a MAGNIFIED
 * SCHEMATIC at the end of a single lobe (a glass sphere), holding a terminal duct that branches,
 * a handful of alveoli and a basket of myoepithelial cells round each: the numbers of twigs and
 * alveoli are chosen to read, not counted. The textbook puts the alveoli inside the terminal duct
 * lobular unit, a fourth level; the three are drawn as siblings under the lobule to keep the tree
 * at three levels. GLASS versus SOLID is
 * decided in the detail file: the adipose envelope, ducts, lymph vessels and fascia are
 * glass; lobes, nipple, areola, ligaments and nodes are solid.
 */

const C = (s: number): V3 => [s * 0.072, -0.004, -0.012];
const NIP = (s: number): V3 => [s * 0.074, -0.012, 0.024];
const P0 = (s: number): V3 => [s * 0.074, -0.012, 0.0175];
const LOBES = 12;

function bead(c: V3, r: V3, w: number, h: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(r[0], r[1], r[2]);
  g.translate(c[0], c[1], c[2]);
  return g;
}

const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Where lobe i ends, deep in the gland, in the radial pattern round the nipple axis. */
function lobeEnd(s: number, i: number): V3 {
  const phi = (i * Math.PI * 2) / LOBES + 0.26;
  const theta = 1.08 + 0.12 * Math.sin(3 * phi);
  const c = C(s);
  return [c[0] + 0.05 * 0.72 * Math.sin(theta) * Math.cos(phi), c[1] + 0.052 * 0.72 * Math.sin(theta) * Math.sin(phi), c[2] - 0.036 * 0.72 * Math.cos(theta)];
}

/** Duct centrelines (lobe to nipple tip) and lymph vessels (areola to axillary nodes), per side. Exported for the flows. */
export function breastPaths(s: number): { ducts: V3[][]; lymph: V3[][]; nodeAt: V3 } {
  const ducts: V3[][] = [];
  for (let i = 0; i < LOBES; i++) {
    const phi = (i * Math.PI * 2) / LOBES + 0.26;
    const nip = NIP(s);
    const start = lerp3(P0(s), lobeEnd(s, i), 0.5);
    ducts.push([
      start,
      lerp3(start, P0(s), 0.6),
      [nip[0] + Math.cos(phi) * 0.0012, nip[1] + Math.sin(phi) * 0.0012, 0.0185],
      [nip[0] + Math.cos(phi) * 0.0007, nip[1] + Math.sin(phi) * 0.0007, 0.0255],
    ]);
  }
  const E: V3 = [s * 0.104, 0.028, -0.014];
  const lymph: V3[][] = [
    [[s * 0.083, -0.006, 0.019], [s * 0.092, 0.006, 0.0125], [s * 0.1, 0.016, 0.002], E],
    [[s * 0.078, -0.02, 0.016], [s * 0.093, -0.01, 0.004], [s * 0.101, 0.008, -0.008], E],
    [[s * 0.062, 0.01, 0.015], [s * 0.08, 0.022, 0.006], [s * 0.094, 0.027, -0.006], E],
  ];
  return { ducts, lymph, nodeAt: E };
}

/** The one schematic lobule: where it is, how big, and which way its duct enters. */
function lobuleFrame(s: number): { centre: V3; radius: number; inward: V3 } {
  const end = lobeEnd(s, 2);
  const d = P0(s);
  const l = Math.hypot(d[0] - end[0], d[1] - end[1], d[2] - end[2]) || 1;
  return { centre: end, radius: 0.0042, inward: [(d[0] - end[0]) / l, (d[1] - end[1]) / l, (d[2] - end[2]) / l] };
}

function lobuleParts(s: number): { lobule: THREE.BufferGeometry; duct: THREE.BufferGeometry; alveoli: THREE.BufferGeometry; myo: THREE.BufferGeometry } {
  const f = lobuleFrame(s);
  const [cx, cy, cz] = f.centre;
  const duct: THREE.BufferGeometry[] = [];
  const alv: THREE.BufferGeometry[] = [];
  const myo: THREE.BufferGeometry[] = [];
  const entry: V3 = [cx + f.inward[0] * 0.0036, cy + f.inward[1] * 0.0036, cz + f.inward[2] * 0.0036];
  const hub: V3 = [cx, cy, cz];
  duct.push(tubeAlong([entry, lerp3(entry, hub, 0.5), hub], () => 0.00032, { tubular: 8, radial: 4 }));
  // Twigs fan away from the entry, over the half of the sphere that faces away from it.
  const TWIGS = 5;
  for (let k = 0; k < TWIGS; k++) {
    const a = (k / TWIGS) * Math.PI * 2 + 0.4;
    // A direction mostly opposite the entry, spread round it.
    const ref: V3 = Math.abs(f.inward[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const e1: V3 = [f.inward[1] * ref[2] - f.inward[2] * ref[1], f.inward[2] * ref[0] - f.inward[0] * ref[2], f.inward[0] * ref[1] - f.inward[1] * ref[0]];
    const l1 = Math.hypot(e1[0], e1[1], e1[2]) || 1;
    const u1: V3 = [e1[0] / l1, e1[1] / l1, e1[2] / l1];
    const u2: V3 = [f.inward[1] * u1[2] - f.inward[2] * u1[1], f.inward[2] * u1[0] - f.inward[0] * u1[2], f.inward[0] * u1[1] - f.inward[1] * u1[0]];
    const dir: V3 = [
      -0.6 * f.inward[0] + 0.8 * (Math.cos(a) * u1[0] + Math.sin(a) * u2[0]),
      -0.6 * f.inward[1] + 0.8 * (Math.cos(a) * u1[1] + Math.sin(a) * u2[1]),
      -0.6 * f.inward[2] + 0.8 * (Math.cos(a) * u1[2] + Math.sin(a) * u2[2]),
    ];
    const tip: V3 = [cx + dir[0] * 0.0026, cy + dir[1] * 0.0026, cz + dir[2] * 0.0026];
    duct.push(tubeAlong([hub, lerp3(hub, tip, 0.6), tip], (t) => 0.00026 - 0.0001 * t, { tubular: 8, radial: 4 }));
    // Two alveoli at each twig's end, each wrapped by a basket of two thin rings.
    for (const off of [-1, 1]) {
      const c: V3 = [tip[0] + off * u1[0] * 0.0005, tip[1] + off * u1[1] * 0.0005, tip[2] + off * u1[2] * 0.0005];
      alv.push(bead(c, [0.0006, 0.0006, 0.0006], 8, 5));
      for (const plane of [0, 1]) {
        const ring: V3[] = [];
        for (let m = 0; m < 10; m++) {
          const b = (m / 10) * Math.PI * 2;
          const x = 0.00082 * Math.cos(b);
          const y = 0.00082 * Math.sin(b);
          ring.push(plane === 0 ? [c[0] + x, c[1] + y, c[2]] : [c[0], c[1] + x, c[2] + y]);
        }
        myo.push(tubeAlong(ring, () => 0.00011, { tubular: 10, radial: 3, closed: true }));
      }
    }
  }
  return { lobule: bead(f.centre, [f.radius, f.radius, f.radius], 20, 14), duct: mergeParts(duct), alveoli: mergeParts(alv), myo: mergeParts(myo) };
}

export const parts: PartBuilder = () => {
  const lobes: THREE.BufferGeometry[] = [];
  const ducts: THREE.BufferGeometry[] = [];
  const nipple: THREE.BufferGeometry[] = [];
  const areola: THREE.BufferGeometry[] = [];
  const adipose: THREE.BufferGeometry[] = [];
  const ligaments: THREE.BufferGeometry[] = [];
  const fascia: THREE.BufferGeometry[] = [];
  const lymph: THREE.BufferGeometry[] = [];
  const nodes: THREE.BufferGeometry[] = [];
  const rnd = mulberry32(0xb4ea57);

  for (const s of [1, -1]) {
    const c = C(s);
    const nip = NIP(s);
    const paths = breastPaths(s);

    // Glandular lobes: a tapering tube from the nipple base outwards, ending in lobule beads.
    for (let i = 0; i < LOBES; i++) {
      const end = lobeEnd(s, i);
      lobes.push(tubeAlong([P0(s), lerp3(P0(s), end, 0.5), end], (t) => 0.0012 + 0.0022 * t, { tubular: 10, radial: 6 }));
      for (const t of [0.55, 0.72, 0.86, 1.0]) {
        const p = lerp3(P0(s), end, t);
        lobes.push(bead([p[0] + (rnd() - 0.5) * 0.003, p[1] + (rnd() - 0.5) * 0.003, p[2] + (rnd() - 0.5) * 0.002], [0.0026, 0.0026, 0.0026], 7, 4));
      }
    }
    for (const d of paths.ducts) {
      // The sinus: the duct widens just behind the nipple (t about 0.75).
      ducts.push(tubeAlong(d, (t) => 0.0006 + 0.0005 * Math.exp(-(((t - 0.75) / 0.12) ** 2)), { tubular: 12, radial: 5 }));
    }

    nipple.push(bead([nip[0], nip[1], 0.0225], [0.0035, 0.0035, 0.0048], 10, 8));
    areola.push(bead([nip[0], nip[1], 0.0195], [0.0115, 0.0115, 0.0016], 16, 6));

    // Fat: the dome, a little inside the shell, cut flat at the chest wall.
    adipose.push(
      polygonise(intersect(ellipsoid(c, [0.046, 0.048, 0.0335]), halfSpace([0, 0, -0.0285], [0, 0, 1])), [c[0] - 0.05, -0.056, -0.032], [c[0] + 0.05, 0.048, 0.03], { cell: 0.004 }),
    );

    // Pectoral fascia: a thin sheet on the chest wall.
    fascia.push(bead([c[0], c[1], -0.0262], [0.037, 0.039, 0.0016], 24, 8));

    // Suspensory ligaments: from the fascia forward to the skin.
    for (let i = 0; i < 14; i++) {
      const psi = (i * Math.PI * 2) / 14;
      const alpha = 0.35 + 0.8 * (0.5 + 0.5 * Math.sin(5 * psi + 1));
      const rel: V3 = [0.046 * 0.93 * Math.sin(alpha) * Math.cos(psi), 0.048 * 0.93 * Math.sin(alpha) * Math.sin(psi), 0.0335 * 0.93 * Math.cos(alpha)];
      const end: V3 = [c[0] + rel[0], c[1] + rel[1], c[2] + rel[2]];
      const start: V3 = [c[0] + rel[0] * 0.95, c[1] + rel[1] * 0.95, -0.0262];
      const mid = lerp3(start, end, 0.5);
      ligaments.push(tubeAlong([start, [mid[0] + rel[0] * 0.05, mid[1] + rel[1] * 0.05, mid[2]], end], () => 0.0004, { tubular: 8, radial: 4 }));
    }

    for (const l of paths.lymph) lymph.push(tubeAlong(l, () => 0.0006, { tubular: 14, radial: 5 }));
    const E = paths.nodeAt;
    nodes.push(bead(E, [0.003, 0.0022, 0.0022], 8, 5));
    nodes.push(bead([E[0] - s * 0.004, E[1] - 0.004, E[2] - 0.001], [0.002, 0.0016, 0.0016], 8, 5));
    nodes.push(bead([E[0] + s * 0.0005, E[1] - 0.007, E[2] + 0.001], [0.0018, 0.0015, 0.0015], 8, 5));
  }

  // FINER STRUCTURES and the new level-1 parts.
  const sinuses: THREE.BufferGeometry[] = [];
  const montgomery: THREE.BufferGeometry[] = [];
  const retro: THREE.BufferGeometry[] = [];
  const tail: THREE.BufferGeometry[] = [];
  const lob: ReturnType<typeof lobuleParts>[] = [];
  for (const s of [1, -1]) {
    const c = C(s);
    const nip = NIP(s);
    for (const d of breastPaths(s).ducts) {
      // The sinus: the swelling at about three quarters of the way from the lobe to the nipple.
      sinuses.push(bead(lerp3(d[1], d[2], 0.45), [0.0011, 0.0011, 0.0015], 8, 5));
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.2;
      montgomery.push(bead([nip[0] + 0.0085 * Math.cos(a), nip[1] + 0.0085 * Math.sin(a), 0.0207], [0.0007, 0.0007, 0.0006], 6, 4));
    }
    retro.push(bead([c[0], c[1], -0.0245], [0.036, 0.038, 0.0007], 24, 8));
    const E = breastPaths(s).nodeAt;
    tail.push(tubeAlong([[s * 0.086, 0.016, -0.009], [s * 0.094, 0.022, -0.0115], [E[0] - s * 0.004, E[1] - 0.001, E[2] + 0.0005]], (t) => 0.0042 - 0.0022 * t, { tubular: 14, radial: 8 }));
    lob.push(lobuleParts(s));
  }

  return [
    { id: 'lactiferous_sinuses', geometry: mergeParts(sinuses) },
    { id: 'areolar_glands', geometry: mergeParts(montgomery) },
    { id: 'retromammary_space', geometry: mergeParts(retro) },
    { id: 'axillary_tail', geometry: mergeParts(tail) },
    { id: 'breast_lobule', geometry: mergeParts(lob.map((l) => l.lobule)) },
    { id: 'terminal_duct_lobular_unit', geometry: mergeParts(lob.map((l) => l.duct)) },
    { id: 'alveoli', geometry: mergeParts(lob.map((l) => l.alveoli)) },
    { id: 'myoepithelial_cells', geometry: mergeParts(lob.map((l) => l.myo)) },
    { id: 'glandular_lobes', geometry: mergeParts(lobes) },
    { id: 'lactiferous_ducts', geometry: mergeParts(ducts) },
    { id: 'nipple', geometry: mergeParts(nipple) },
    { id: 'areola', geometry: mergeParts(areola) },
    { id: 'adipose_tissue', geometry: mergeParts(adipose) },
    { id: 'suspensory_ligaments', geometry: mergeParts(ligaments) },
    { id: 'pectoral_fascia', geometry: mergeParts(fascia) },
    { id: 'lymphatics', geometry: mergeParts(lymph) },
    { id: 'lymph_nodes', geometry: mergeParts(nodes) },
  ];
};
