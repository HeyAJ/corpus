import * as THREE from 'three';
import type { PartBuilder, PartGeometry } from '../parts';
import { mergeParts, tubeAlong, type V3 } from '../sdf';
import { MUSCLE_IDS, bicepsAxis, shoulderArmMuscleGroups } from '../shells/shoulder_arm_muscles';

/**
 * THE INSIDE OF THE SHOULDER AND UPPER ARM MUSCLES, in the organ's own frame (origin organs.json [0, 0.2, 0]).
 *
 * TWO KINDS OF PART.
 *
 * (1) THE MUSCLES. Every muscle, head and tendon is the SAME geometry the shell uses
 * (`shoulderArmMuscleGroups`, shells/shoulder_arm_muscles.ts: routed from its origin to its
 * insertion on THIS skeleton and cleared of bone), drawn here as separate parts under the id the
 * atlas file (src/data/anatomy/shoulder_arm_muscles.json) gives them. A head is built inside its
 * parent's volume (the biceps heads and the triceps heads lie inside the belly of the whole
 * muscle; the three parts of the deltoid are thinner copies of the whole sheet, over the same
 * inner face), so when the parent turns to glass the heads can be seen through it. The rotator
 * cuff's own geometry is the thin cap where the four tendons blend into the joint capsule; the
 * four muscles are its children and are not inside it.
 *
 * (2) MAGNIFIED SCHEMATICS OF MUSCLE TISSUE, ILLUSTRATIVE AND NOT TRUE SIZE OR PLACE. A fascicle,
 * a muscle fibre, a sarcomere, a neuromuscular junction, a muscle spindle and a Golgi tendon
 * organ are drawn once, in the patient's right biceps, one above the next along its axis, each
 * a few millimetres across so that all six fit inside the belly. A real sarcomere is about a
 * thousand times smaller than this one; every size, count and spacing here is a DRAWING choice
 * made so the structure can be told apart, and the atlas summaries say so. Counts follow no
 * textbook (a real fibre has far more myofibrils, a real thin filament is surrounded by three
 * thick ones in a pattern this does not copy). Each schematic is authored in its own frame
 * (y along the muscle, z towards the front of the arm) and then set down at its place on the
 * biceps's axis; `schematicVertices` below lets a probe check that every vertex lies inside the belly.
 *
 * WHAT WENT WRONG BEFORE: the stub drew four silhouettes and no heads, no tendons and no tissue,
 * so the biceps could not be told from a sausage and the neuromuscular junction, the thing a
 * muscle relaxant acts on, was not in the body at all.
 */

const SEED = 0x6d75;
/** A small deterministic generator, so the schematics are the same on every build. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A scaled sphere centred at c. */
function blob(c: V3, r: V3, w = 8, h = 5): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, w, h);
  g.deleteAttribute('uv');
  g.scale(r[0], r[1], r[2]);
  g.translate(c[0], c[1], c[2]);
  return g;
}
/** A tube of constant radius along a path. */
const rod = (pts: V3[], r: number, tubular = 4, radial = 5): THREE.BufferGeometry => tubeAlong(pts, () => r, { tubular, radial });
/** A cylinder along y (closed unless `open`). */
function cyl(c: V3, r: number, half: number, open = false, radial = 10): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, half * 2, radial, 1, open);
  g.deleteAttribute('uv');
  g.translate(c[0], c[1], c[2]);
  return g;
}
/** A ring in the plane y = c[1]. */
function ring(c: V3, major: number, minor: number): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(major, minor, 4, 14);
  g.deleteAttribute('uv');
  g.rotateX(Math.PI / 2);
  g.translate(c[0], c[1], c[2]);
  return g;
}
/** A rod along y between two heights, at (x, z). */
const along = (x: number, z: number, y0: number, y1: number, r: number, radial = 5): THREE.BufferGeometry =>
  rod([[x, y0, z], [x, (y0 + y1) / 2, z], [x, y1, z]], r, 2, radial);

/** Where each schematic sits along the biceps, as heights in the body frame, top to bottom (a drawing choice that keeps all six inside the belly). */
export const SCHEMATIC_Y = {
  muscle_fascicle: 0.1985,
  muscle_fibre: 0.1865,
  sarcomere: 0.1745,
  neuromuscular_junction: 0.1625,
  muscle_spindle: 0.1505,
  golgi_tendon_organ: 0.1405,
} as const;
export type SchematicId = keyof typeof SCHEMATIC_Y;

/** Sarcomere proportions: half the A band, half the whole sarcomere, drawing choices that keep a visible I band and H zone. */
const SARC_A = 0.003;
const SARC_L = 0.0052;

/** The geometry of one schematic's parts, each in the schematic's own frame centred on its origin. */
function schematic(id: SchematicId): Record<string, THREE.BufferGeometry[]> {
  const rand = rng(SEED + Math.round(SCHEMATIC_Y[id] * 1e4));
  switch (id) {
    case 'muscle_fascicle': {
      // Seven fibres in a hexagonal pack; the endomysium is one thin sleeve round each, the perimysium one round the pack, the epimysium the outer sleeve.
      const centres: [number, number][] = [[0, 0]];
      for (let k = 0; k < 6; k++) centres.push([0.0021 * Math.cos((k * Math.PI) / 3), 0.0021 * Math.sin((k * Math.PI) / 3)]);
      return {
        muscle_fascicle: centres.map(([x, z]) => cyl([x, 0, z], 0.00093, 0.0040, false, 7)),
        endomysium: centres.map(([x, z]) => cyl([x, 0, z], 0.00106, 0.0041, true, 8)),
        perimysium: [cyl([0, 0, 0], 0.0033, 0.0040, true, 14)],
        epimysium: [cyl([0, 0, 0], 0.0038, 0.0041, true, 16)],
      };
    }
    case 'muscle_fibre': {
      const nuclei: V3[] = [[0.0023, -0.0018, 0.0008], [-0.0016, 0.0012, 0.0018], [0.0004, 0.0030, -0.0023]];
      const mito: V3[] = [];
      for (let k = 0; k < 9; k++) {
        const a = rand() * Math.PI * 2;
        const r = 0.0018 + rand() * 0.0006;
        mito.push([r * Math.cos(a), -0.0042 + rand() * 0.0084, r * Math.sin(a)]);
      }
      const ringYs = [-0.0030, -0.0010, 0.0010, 0.0030];
      const cisternae: THREE.BufferGeometry[] = [];
      for (const y of ringYs) {
        for (const side of [-1, 1]) {
          for (let k = 0; k < 3; k++) {
            const a = (k / 3) * Math.PI * 2 + (side > 0 ? 0.4 : 0);
            cisternae.push(blob([0.0021 * Math.cos(a), y + side * 0.00042, 0.0021 * Math.sin(a)], [0.00036, 0.00016, 0.00036], 5, 3));
          }
        }
      }
      const myofibrils: THREE.BufferGeometry[] = [along(0, 0, -0.0044, 0.0044, 0.00032, 5)];
      for (let k = 0; k < 6; k++) myofibrils.push(along(0.00075 * Math.cos((k * Math.PI) / 3), 0.00075 * Math.sin((k * Math.PI) / 3), -0.0044, 0.0044, 0.00032, 5));
      const sr: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 6; k++) sr.push(along(0.00135 * Math.cos(((k + 0.5) * Math.PI) / 3), 0.00135 * Math.sin(((k + 0.5) * Math.PI) / 3), -0.0044, 0.0044, 0.00017, 4));
      return {
        muscle_fibre: [cyl([0, 0, 0], 0.0030, 0.0048, false, 14)],
        sarcolemma: [cyl([0, 0, 0], 0.00315, 0.0048, true, 14)],
        t_tubules: ringYs.map((y) => ring([0, y, 0], 0.0024, 0.0002)),
        sarcoplasmic_reticulum: sr,
        terminal_cisternae: cisternae,
        peripheral_nuclei: nuclei.map((c) => {
          const a = Math.atan2(c[2], c[0]);
          return blob([0.0024 * Math.cos(a), c[1], 0.0024 * Math.sin(a)], [0.0005, 0.0013, 0.0005], 7, 5);
        }),
        mitochondria: mito.map((c) => blob(c, [0.00048, 0.00085, 0.00048], 6, 4)),
        myofibrils,
        satellite_cell: [blob([-0.0034, -0.0012, 0.0003], [0.0003, 0.0011, 0.0009], 7, 5)],
      };
    }
    case 'sarcomere': {
      const thickAt: [number, number][] = [[0.0010, 0.0010], [-0.0010, 0.0010], [0.0010, -0.0010], [-0.0010, -0.0010]];
      const thinAt: [number, number][] = [[0.0021, 0], [-0.0021, 0], [0, 0.0021], [0, -0.0021], [0.0015, 0.0015], [-0.0015, 0.0015], [0.0015, -0.0015], [-0.0015, -0.0015]];
      const thin: THREE.BufferGeometry[] = [];
      const tropomyosin: THREE.BufferGeometry[] = [];
      const troponin: THREE.BufferGeometry[] = [];
      for (const side of [-1, 1]) {
        for (const [x, z] of thinAt) {
          thin.push(along(x, z, side * SARC_L, side * 0.0012, 0.00017, 4));
          tropomyosin.push(along(x * 1.07, z * 1.07, side * (SARC_L - 0.0003), side * 0.0014, 0.00008, 3));
          for (const y of [0.0044, 0.0034]) troponin.push(blob([x * 1.1, side * y, z * 1.1], [0.00026, 0.00026, 0.00026], 4, 3));
        }
      }
      const heads: THREE.BufferGeometry[] = [];
      for (const [x, z] of thickAt) {
        for (const side of [-1, 1]) {
          for (const y of [0.0011, 0.0019, 0.0027]) {
            heads.push(blob([x * 1.5, side * y, z * 1.5], [0.00024, 0.00024, 0.00024], 4, 3));
          }
        }
      }
      const titin: THREE.BufferGeometry[] = [];
      for (const side of [-1, 1]) {
        for (const [x, z] of thickAt) {
          const px = x * 1.35;
          const pz = z * 1.35;
          titin.push(rod([[px, side * SARC_L, pz], [px + 0.0002, side * 0.0044, pz], [px - 0.0002, side * 0.0037, pz], [px, side * SARC_A, pz]], 0.00007, 6, 3));
        }
      }
      return {
        sarcomere: [cyl([0, 0, 0], 0.0037, SARC_L, true, 14)],
        z_discs: [-1, 1].map((s) => cyl([0, s * SARC_L, 0], 0.0034, 0.0002, false, 14)),
        i_band: [-1, 1].map((s) => cyl([0, (s * (SARC_L + SARC_A)) / 2, 0], 0.0032, (SARC_L - SARC_A) / 2, false, 12)),
        a_band: [cyl([0, 0, 0], 0.0032, SARC_A, false, 12)],
        h_zone: [cyl([0, 0, 0], 0.0029, 0.0009, false, 12)],
        m_line: [cyl([0, 0, 0], 0.0029, 0.00013, false, 12)],
        thin_filaments: thin,
        troponin,
        tropomyosin,
        thick_filaments: thickAt.map(([x, z]) => along(x, z, -SARC_A, SARC_A, 0.00045, 6)),
        myosin_heads: heads,
        titin,
      };
    }
    case 'neuromuscular_junction': {
      // The stack runs along z: the nerve terminal on the front side, the cleft below it, the muscle fibre's end plate beneath that.
      const vesicles: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 14; k++) {
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(rand()) * 0.0021;
        vesicles.push(blob([r * Math.cos(a), r * Math.sin(a), 0.0018 + rand() * 0.0014], [0.00023, 0.00023, 0.00023], 5, 3));
      }
      const enzymes: THREE.BufferGeometry[] = [];
      for (let ix = -2; ix <= 2; ix++) {
        for (let iy = -1; iy <= 1; iy++) {
          if (Math.hypot(ix, iy) > 2.2) continue;
          enzymes.push(blob([ix * 0.0012, iy * 0.0014, 0.0004], [0.00017, 0.00017, 0.00017], 4, 3));
        }
      }
      const folds: THREE.BufferGeometry[] = [];
      const receptors: THREE.BufferGeometry[] = [];
      for (let k = -2; k <= 3; k++) {
        const y = (k - 0.5) * 0.0013;
        folds.push(rod([[-0.0031, y, -0.0002], [0, y, -0.0002], [0.0031, y, -0.0002]], 0.00028, 4, 4));
        for (const x of [-0.0013, 0.0013]) receptors.push(blob([x, y, 0.00012], [0.00018, 0.00018, 0.00014], 4, 3));
      }
      return {
        neuromuscular_junction: [blob([0, 0, 0], [0.0045, 0.0045, 0.0049], 12, 8)],
        motor_axon_terminal: [blob([0, 0, 0.0024], [0.0030, 0.0030, 0.0015], 12, 8)],
        synaptic_vesicles: vesicles,
        synaptic_cleft: [blob([0, 0, 0.0006], [0.0033, 0.0033, 0.00035], 12, 6)],
        acetylcholinesterase: enzymes,
        motor_end_plate: [blob([0, 0, -0.0011], [0.0038, 0.0038, 0.0012], 12, 8)],
        junctional_folds: folds,
        nicotinic_receptors: receptors,
        terminal_schwann_cell: [blob([0, 0, 0.0034], [0.0036, 0.0036, 0.0011], 12, 6)],
      };
    }
    case 'muscle_spindle': {
      // A capsule round three thin fibres, each with a swelling at its middle, and a spiral sensory ending wound round the middle of one.
      const pieces: THREE.BufferGeometry[] = [blob([0, 0, 0], [0.0028, 0.0048, 0.0028], 12, 8)];
      const at: [number, number][] = [[0, 0], [0.0009, 0.0006], [-0.0009, 0.0006]];
      for (const [x, z] of at) {
        pieces.push(along(x, z, -0.0049, 0.0049, 0.00032, 5));
        pieces.push(blob([x, 0, z], [0.0007, 0.0012, 0.0007], 7, 5));
      }
      const helix: V3[] = [];
      for (let k = 0; k <= 18; k++) {
        const a = (k / 18) * Math.PI * 6;
        helix.push([0.0011 * Math.cos(a), -0.0013 + (k / 18) * 0.0026, 0.0011 * Math.sin(a)]);
      }
      pieces.push(rod(helix, 0.00016, 36, 3));
      return { muscle_spindle: pieces };
    }
    case 'golgi_tendon_organ': {
      // Tendon strands running through a capsule, with branches of one sensory fibre woven between them, and the fibre leaving the side.
      const pieces: THREE.BufferGeometry[] = [blob([0, 0, 0], [0.0024, 0.0034, 0.0024], 12, 8)];
      for (let k = 0; k < 5; k++) pieces.push(along(0.0009 * Math.cos((k * 2 * Math.PI) / 5), 0.0009 * Math.sin((k * 2 * Math.PI) / 5), -0.0042, 0.0042, 0.0005, 5));
      for (const phase of [0, Math.PI]) {
        const helix: V3[] = [];
        for (let k = 0; k <= 14; k++) {
          const a = phase + (k / 14) * Math.PI * 4;
          helix.push([0.0015 * Math.cos(a), -0.0024 + (k / 14) * 0.0048, 0.0015 * Math.sin(a)]);
        }
        pieces.push(rod(helix, 0.00015, 28, 3));
      }
      pieces.push(rod([[0.0018, 0, 0], [0.0030, 0.0004, 0.0004], [0.0044, 0.0010, 0.0006]], 0.00028, 6, 4));
      return { golgi_tendon_organ: pieces };
    }
  }
}

/** Where a schematic sits, in the organ's own frame: on the biceps axis at its height. */
export function schematicCentre(id: SchematicId): V3 {
  const a = bicepsAxis(SCHEMATIC_Y[id]);
  return [a[0], a[1] - 0.2, a[2]];
}

/** Every schematic vertex in the body frame, with its schematic's id, for the containment probe. */
export function schematicVertices(): { id: string; p: V3 }[] {
  const out: { id: string; p: V3 }[] = [];
  for (const id of Object.keys(SCHEMATIC_Y) as SchematicId[]) {
    const c = schematicCentre(id);
    for (const gs of Object.values(schematic(id))) {
      for (const g of gs) {
        const pos = g.getAttribute('position');
        for (let i = 0; i < pos.count; i++) out.push({ id, p: [pos.getX(i) + c[0], pos.getY(i) + c[1] + 0.2, pos.getZ(i) + c[2]] });
      }
    }
  }
  return out;
}

export const parts: PartBuilder = () => {
  const out: PartGeometry[] = [];
  const groups = shoulderArmMuscleGroups(MUSCLE_IDS);
  for (const id of MUSCLE_IDS) out.push({ id, geometry: mergeParts(groups[id]) });
  for (const sid of Object.keys(SCHEMATIC_Y) as SchematicId[]) {
    const c = schematicCentre(sid);
    for (const [id, geoms] of Object.entries(schematic(sid))) {
      const merged = mergeParts(geoms);
      merged.translate(c[0], c[1], c[2]);
      out.push({ id, geometry: merged });
    }
  }
  return out;
};
