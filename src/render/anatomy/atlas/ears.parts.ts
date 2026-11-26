import * as THREE from 'three';
import type { PartBuilder, PartGeometry } from '../parts';
import { mergeParts, tubeAlong, type V3 } from '../sdf';
import { bead, cord } from './gland_shared';
import { blob as ball, stick } from './gi_shared';
import {
  ANTRUM_C, ANTRUM_R, CANAL, CANALS, CAVITY_C, CAVITY_R, ENDO_DUCT, ENDO_SAC_C, FACIAL, IAM, MASTOID_C, MODIOLUS,
  OVAL_C, RECESS_C, RECESS_R, ROUND_C, SACCULE_C, TM_CENTRE, TUBE, UTRICLE_C, VEST_C, VEST_R,
  ampullaCentre, at, canalPath, cochleaAt, cochleaPoint, cochleaRail, mirror, type CanalName,
} from '../shells/ears';

/**
 * INTERIOR OF THE EARS, both sides, in the organ's own frame. The layout (canal, cavity,
 * windows, cochlea helix, canal loops, tube, nerves) is shared with the shell and lives in
 * shells/ears.ts; this file is what is drawn at each place. Every shape is illustrative: a
 * schematic of what Gray's describes, not a traced ear, and every size is a drawing choice.
 *
 * GLASS VERSUS SOLID. Walls and hollows (canal, cavity, recess, antrum, cochlear tube and
 * its scalae, vestibule, canals, tube, internal meatus, the membranes) are glass in
 * ears.detail.ts; what lies in them (ossicles, muscles, nerves, cells) is solid.
 *
 * THE FINER STRUCTURES are ENLARGED SCHEMATICS. Hair cells and otoconia are microscopic, so
 * a cluster a camera can read is drawn: a short run of the spiral organ with its inner and
 * outer hair cells, and a patch of macula with hair cells, a gel layer and crystals. Counts
 * and sizes are drawing choices; the data file says so.
 *
 * NO AURICLE: see shells/ears.ts for why.
 */

type G = THREE.BufferGeometry;
const both = (make: (s: number) => G[]): G => mergeParts([...make(1), ...make(-1)]);
const P = (id: string, geometry: G): PartGeometry => ({ id, geometry });

function ellipse(c: V3, r: V3, rot: V3 = [0, 0, 0], w = 12, h = 8): G {
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(r[0], r[1], r[2]);
  g.rotateX(rot[0]);
  g.rotateY(rot[1]);
  g.rotateZ(rot[2]);
  g.translate(c[0], c[1], c[2]);
  return g;
}

/**
 * A thin double-sided ribbon between two rails of equal length (a membrane running along
 * the cochlea). Both windings are written so that it is visible from either face.
 */
function strip(a: readonly V3[], b: readonly V3[]): G {
  const n = a.length;
  const pos: number[] = [];
  for (let i = 0; i < n; i++) pos.push(...a[i], ...b[i]);
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p = i * 2;
    idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2, p, p + 2, p + 1, p + 1, p + 2, p + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** The tympanic membrane is an oblique disc: its lower edge lies further in than its upper one. */
const TM_ROT: V3 = [0, 0.3, 0.5];
const TM_R: V3 = [0.0004, 0.0038, 0.0036];
const TM_R_CHILD: V3 = [0.00025, 0.0034, 0.0032];

/** Samples along the cochlea used by the membranes and cells. */
const N = 44;

export const parts: PartBuilder = () => {
  const out: PartGeometry[] = [];

  /* ---- external acoustic meatus ----------------------------------------------- */
  out.push(P('external_canal', both((s) => [tubeAlong(mirror(s, CANAL), () => 0.0031, { tubular: 14, radial: 8 })])));
  out.push(
    P('cartilaginous_meatus', both((s) => [tubeAlong(mirror(s, [CANAL[0], [0.0715, 0.0008, -0.0002], CANAL[1]]), () => 0.0022, { tubular: 8, radial: 6 })])),
  );
  out.push(
    P('bony_meatus', both((s) => [tubeAlong(mirror(s, [CANAL[1], CANAL[2], [0.0495, -0.0018, 0.0014]]), () => 0.0022, { tubular: 8, radial: 6 })])),
  );
  {
    // Ceruminous glands: coiled glands in the skin of the outer part, drawn as beads in the wall.
    const beads: G[] = [];
    for (const s of [1, -1]) {
      for (let k = 0; k < 9; k++) {
        const x = 0.0735 - 0.0012 * (k % 4) - 0.0025;
        const a = k * 2.4;
        beads.push(bead(at(s, [x, 0.0009 + 0.00265 * Math.cos(a), 0.0 + 0.00265 * Math.sin(a)]), 0.00055, 6, 4));
      }
    }
    out.push(P('ceruminous_glands', mergeParts(beads)));
  }

  /* ---- tympanic membrane and its parts ---------------------------------------- */
  out.push(P('tympanic_membrane', both((s) => [ellipse(at(s, TM_CENTRE), TM_R, [0, -s * TM_ROT[1], s * TM_ROT[2]])])));
  out.push(
    P('pars_tensa', both((s) => [ellipse(at(s, [TM_CENTRE[0] + 0.0001, TM_CENTRE[1] - 0.0004, TM_CENTRE[2]]), [TM_R_CHILD[0], TM_R_CHILD[1] * 0.85, TM_R_CHILD[2]], [0, -s * TM_ROT[1], s * TM_ROT[2]])])),
  );
  out.push(
    P('pars_flaccida', both((s) => [ellipse(at(s, [TM_CENTRE[0] - 0.0002, TM_CENTRE[1] + 0.0027, TM_CENTRE[2] + 0.0004]), [0.0003, 0.0009, 0.0014], [0, -s * TM_ROT[1], s * TM_ROT[2]], 8, 6)])),
  );
  out.push(P('umbo', both((s) => [bead(at(s, [TM_CENTRE[0] - 0.0004, TM_CENTRE[1] - 0.0001, TM_CENTRE[2]]), 0.0004, 7, 5)])));

  /* ---- tympanic cavity and what lies in it ------------------------------------ */
  out.push(P('middle_ear', both((s) => [ellipse(at(s, [0.0446, 0.0, 0.0006]), [0.0044, 0.0094, 0.0072], [0, 0, 0], 14, 10)])));
  out.push(P('tympanic_cavity', both((s) => [ellipse(at(s, CAVITY_C), CAVITY_R)])));
  out.push(P('epitympanic_recess', both((s) => [ellipse(at(s, RECESS_C), RECESS_R)])));
  const MALLEUS = { umbo: [0.0472, -0.002, 0.0015] as V3, neck: [0.0455, 0.003, 0.001] as V3, head: [0.044, 0.0052, 0.0008] as V3, lateral: [0.0468, 0.0028, 0.0012] as V3 };
  out.push(
    P('malleus', both((s) => [
      stick(at(s, MALLEUS.umbo), at(s, MALLEUS.neck), 0.00028, 5), // handle, fixed to the membrane
      bead(at(s, MALLEUS.lateral), 0.00033, 6, 4),
      stick(at(s, MALLEUS.neck), at(s, MALLEUS.head), 0.00033, 5),
      bead(at(s, MALLEUS.head), 0.001, 8, 6),
    ])),
  );
  const INCUS = { body: [0.043, 0.005, -0.002] as V3, shortTip: [0.042, 0.0044, -0.005] as V3, longEnd: [0.042, -0.0005, -0.0018] as V3, lenticular: [0.0413, -0.001, -0.0018] as V3 };
  out.push(
    P('incus', both((s) => [
      ball(at(s, INCUS.body), [0.0011, 0.001, 0.001], 8, 6),
      stick(at(s, INCUS.body), at(s, INCUS.shortTip), 0.00032, 4),
      stick(at(s, INCUS.body), at(s, INCUS.longEnd), 0.0003, 4),
      bead(at(s, INCUS.lenticular), 0.00028, 6, 4),
    ])),
  );
  out.push(
    P('stapes', both((s) => {
      const head = at(s, [0.0411, -0.0013, -0.0018]);
      return [
        bead(head, 0.0003, 6, 4),
        stick(head, at(s, [0.0405, -0.0007, -0.003]), 0.00016, 3), // anterior crus
        stick(head, at(s, [0.0405, -0.0019, -0.003]), 0.00016, 3), // posterior crus
        ellipse(at(s, [0.0404, -0.0013, -0.003]), [0.00018, 0.0009, 0.0016], [0, 0, 0], 8, 6), // footplate
      ];
    })),
  );
  out.push(
    P('tensor_tympani', both((s) => [
      tubeAlong(mirror(s, [[0.0372, 0.0, 0.01], [0.0398, 0.0012, 0.0075], [0.042, 0.0022, 0.0042], [0.0452, 0.003, 0.0012]]), (t) => (t < 0.62 ? 0.0007 : 0.00028), { tubular: 14, radial: 5 }),
    ])),
  );
  out.push(
    P('stapedius', both((s) => [
      tubeAlong(mirror(s, [[0.0412, -0.002, -0.01], [0.0412, -0.0015, -0.006], [0.0409, -0.0013, -0.0022]]), (t) => (t < 0.7 ? 0.0006 : 0.00022), { tubular: 10, radial: 5 }),
    ])),
  );
  out.push(
    P('chorda_tympani', both((s) => [
      cord(mirror(s, [[0.0415, 0.0045, -0.006], [0.0445, 0.005, -0.0035], [0.0448, 0.004, 0.0], [0.0443, 0.003, 0.004], [0.043, 0.001, 0.0058]]), 0.0003, 14, 4),
    ])),
  );
  out.push(P('oval_window', both((s) => [ellipse(at(s, OVAL_C), [0.0003, 0.0012, 0.0019], [0, 0, 0], 10, 6)])));
  out.push(P('round_window', both((s) => [ellipse(at(s, ROUND_C), [0.0003, 0.0011, 0.0011], [0, 0, 0], 10, 6)])));
  out.push(P('pharyngotympanic_tube', both((s) => [tubeAlong(mirror(s, TUBE), () => 0.0016, { tubular: 16, radial: 6 })])));
  out.push(P('mastoid_antrum', both((s) => [ellipse(at(s, ANTRUM_C), ANTRUM_R)])));
  {
    // Mastoid air cells: a honeycomb of small air spaces behind and below, drawn as clustered beads.
    const cells: G[] = [];
    const sites: V3[] = [[0.0462, 0.0, -0.0105], [0.0485, -0.0035, -0.0095], [0.0505, 0.002, -0.013], [0.0525, -0.0045, -0.0125], [0.0545, -0.001, -0.0115], [0.0495, -0.0075, -0.0135], [0.0535, -0.0072, -0.0105], [0.0475, 0.0035, -0.0145], [0.0515, -0.0025, -0.0158]];
    for (const s of [1, -1]) for (const p of sites) cells.push(bead(at(s, p), 0.0014, 8, 6));
    out.push(P('mastoid_air_cells', mergeParts(cells)));
  }
  out.push(P('facial_nerve_canal', both((s) => [tubeAlong(mirror(s, FACIAL), () => 0.001, { tubular: 36, radial: 6 })])));
  out.push(P('facial_nerve', both((s) => [tubeAlong(mirror(s, FACIAL), () => 0.0005, { tubular: 36, radial: 5 })])));
  void MASTOID_C;

  /* ---- the vestibule ---------------------------------------------------------- */
  out.push(P('vestibular_apparatus', both((s) => [ellipse(at(s, [0.0372, 0.0018, -0.0038]), [0.0052, 0.0066, 0.0058], [0, 0, 0], 14, 10)])));
  out.push(P('vestibule', both((s) => [ellipse(at(s, VEST_C), VEST_R)])));
  out.push(P('utricle', both((s) => [ellipse(at(s, UTRICLE_C), [0.0016, 0.0013, 0.0021])])));
  out.push(P('saccule', both((s) => [ellipse(at(s, SACCULE_C), [0.0013, 0.0014, 0.0013])])));
  // The maculae: the utricular macula lies on the floor of the utricle (roughly horizontal),
  // the saccular macula on the medial wall of the saccule (roughly vertical).
  const UMAC: V3 = [UTRICLE_C[0], UTRICLE_C[1] - 0.0010, UTRICLE_C[2]];
  const SMAC: V3 = [SACCULE_C[0] - 0.001, SACCULE_C[1], SACCULE_C[2]];
  out.push(P('maculae', both((s) => [ellipse(at(s, UMAC), [0.0013, 0.0002, 0.0017], [0, 0, 0], 8, 6), ellipse(at(s, SMAC), [0.0002, 0.0011, 0.0011], [0, 0, 0], 8, 6)])));
  {
    // Hair cells: a few short rods standing on each macula (a magnified schematic cluster).
    const hairs: G[] = [];
    const rnd = [[-0.0006, -0.0009], [0.0006, -0.0007], [0, 0], [-0.0006, 0.0008], [0.0006, 0.0009]];
    for (const s of [1, -1]) {
      for (const [dx, dz] of rnd) {
        hairs.push(stick(at(s, [UMAC[0] + dx, UMAC[1], UMAC[2] + dz]), at(s, [UMAC[0] + dx, UMAC[1] + 0.0006, UMAC[2] + dz]), 0.00013, 4));
        hairs.push(stick(at(s, [SMAC[0], SMAC[1] + dx * 0.9, SMAC[2] + dz * 0.6]), at(s, [SMAC[0] + 0.0006, SMAC[1] + dx * 0.9, SMAC[2] + dz * 0.6]), 0.00013, 4));
      }
    }
    out.push(P('vestibular_hair_cells', mergeParts(hairs)));
    // Otolithic membrane: a gel layer over the hair bundles.
    out.push(
      P('otolithic_membrane', both((s) => [ellipse(at(s, [UMAC[0], UMAC[1] + 0.0008, UMAC[2]]), [0.0013, 0.0003, 0.0017], [0, 0, 0], 8, 6), ellipse(at(s, [SMAC[0] + 0.0008, SMAC[1], SMAC[2]]), [0.0003, 0.0011, 0.0011], [0, 0, 0], 8, 6)])),
    );
    // Otoconia: small crystals in the top of the gel.
    const crystals: G[] = [];
    for (const s of [1, -1]) {
      for (const [dx, dz] of rnd) {
        crystals.push(bead(at(s, [UMAC[0] + dx * 0.9, UMAC[1] + 0.0012, UMAC[2] + dz * 0.9]), 0.00018, 5, 3));
        crystals.push(bead(at(s, [SMAC[0] + 0.0012, SMAC[1] + dx * 0.8, SMAC[2] + dz * 0.6]), 0.00018, 5, 3));
      }
    }
    out.push(P('otoconia', mergeParts(crystals)));
  }

  /* ---- semicircular canals, ampullae, cristae, cupulae ----------------------- */
  for (const name of ['anterior', 'posterior', 'lateral'] as CanalName[]) {
    const loop = CANALS[name];
    out.push(P(`${name}_semicircular_canal`, both((s) => [tubeAlong(mirror(s, canalPath(loop, 16)), () => 0.0007, { tubular: 28, radial: 5 })])));
    const amp = ampullaCentre(loop);
    out.push(P(`${name}_ampulla`, both((s) => [ellipse(at(s, amp), [0.0013, 0.0013, 0.0013], [0, 0, 0], 10, 7)])));
    // The crista is a ridge across the floor of the ampulla; the cupula is the gel dome on it.
    out.push(P(`${name}_crista`, both((s) => [ellipse(at(s, [amp[0], amp[1] - 0.0007, amp[2]]), [0.0008, 0.0002, 0.0008], [0, 0, 0], 8, 6)])));
    out.push(P(`${name}_cupula`, both((s) => [ellipse(at(s, [amp[0], amp[1] - 0.0001, amp[2]]), [0.0006, 0.0006, 0.0006], [0, 0, 0], 8, 6)])));
  }

  /* ---- the cochlea ------------------------------------------------------------ */
  out.push(P('cochlea', both((s) => [tubeAlong(mirror(s, cochleaRail(40, () => 0, () => 0)), (t) => cochleaAt(t).r, { tubular: 80, radial: 8 })])));
  // The three scalae are drawn as three thin tubes inside the cochlear tube: the vestibuli
  // above, the tympani below, and the duct (scala media) in the outer middle.
  const scala = (radial: number, axial: number, rr: number): ((s: number) => G[]) => (s) => [
    tubeAlong(mirror(s, cochleaRail(40, (t) => radial * cochleaAt(t).r / 0.00115, (t) => axial * cochleaAt(t).r / 0.00115)), (t) => rr * cochleaAt(t).r / 0.00115, { tubular: 80, radial: 5 }),
  ];
  out.push(P('scala_vestibuli', both(scala(-0.0001, 0.0004, 0.00026))));
  out.push(P('cochlear_duct', both(scala(0.0003, 0.0, 0.00026))));
  out.push(P('scala_tympani', both(scala(-0.0001, -0.0004, 0.00026))));
  {
    const k = (t: number) => cochleaAt(t).r / 0.00115;
    const rail = (radial: number, axial: number) => cochleaRail(N, (t) => radial * k(t), (t) => axial * k(t));
    // Vestibular (Reissner) membrane: between the vestibuli and the duct, slanting outward and down.
    out.push(P('vestibular_membrane', both((s) => [strip(mirror(s, rail(-0.0001, 0.0002)), mirror(s, rail(0.0005, 0.0)))])));
    // Basilar membrane: the floor of the duct, spanning from the modiolus side to the outer wall.
    out.push(P('basilar_membrane', both((s) => [strip(mirror(s, rail(-0.0004, -0.0002)), mirror(s, rail(0.0004, -0.0002)))])));
    // Stria vascularis: the vascular strip on the outer wall of the duct.
    out.push(P('stria_vascularis', both((s) => [strip(mirror(s, rail(0.0005, -0.0001)), mirror(s, rail(0.0005, 0.0003)))])));
    // Spiral organ: a ridge on the basilar membrane; its two kinds of hair cell are children.
    out.push(P('spiral_organ', both((s) => [tubeAlong(mirror(s, rail(0.00005, -0.00005)), (t) => 0.00013 * k(t), { tubular: 80, radial: 4 })])));
    // Hair cells: a magnified schematic run (the first third of the first turn onward), one row of inner cells
    // nearer the modiolus and three rows of outer cells further out, a bead per cell.
    const inner: G[] = [];
    const outer: G[] = [];
    for (let i = 0; i < 26; i++) {
      const t = 0.02 + i * 0.012;
      const kk = k(t);
      for (const s of [1, -1]) {
        inner.push(bead(at(s, cochleaPoint(t, -0.0001 * kk, 0.00012 * kk)), 0.00011 * kk, 5, 3));
        for (let row = 0; row < 3; row++) {
          outer.push(bead(at(s, cochleaPoint(t + 0.002 * row, (0.00017 + 0.00008 * row) * kk, 0.00013 * kk)), 0.0001 * kk, 5, 3));
        }
      }
    }
    out.push(P('inner_hair_cells', mergeParts(inner)));
    out.push(P('outer_hair_cells', mergeParts(outer)));
    // Tectorial membrane: the gel flap lying over the hair cells.
    out.push(P('tectorial_membrane', both((s) => [strip(mirror(s, rail(-0.0003, 0.0003)), mirror(s, rail(0.0003, 0.00028)))])));
    // Spiral ganglion: the cell bodies of the cochlear nerve, in a canal in the modiolus.
    const ganglion: G[] = [];
    for (let i = 0; i < 22; i++) {
      const t = 0.03 + i * 0.043;
      const f = cochleaAt(t);
      for (const s of [1, -1]) ganglion.push(bead(at(s, [f.c[0] - f.n[0] * f.coil * 0.62, f.c[1] - f.n[1] * f.coil * 0.62, f.c[2] - f.n[2] * f.coil * 0.62]), 0.00034 * Math.max(0.5, k(t)), 6, 4));
    }
    out.push(P('spiral_ganglion', mergeParts(ganglion)));
  }

  /* ---- nerve, internal meatus, endolymphatic duct --------------------------- */
  out.push(P('internal_acoustic_meatus', both((s) => [tubeAlong(mirror(s, IAM), () => 0.0016, { tubular: 6, radial: 6 })])));
  const VIII_FORK: V3 = [0.0338, 0.0026, 0.0004];
  out.push(P('vestibulocochlear_nerve', both((s) => [tubeAlong(mirror(s, [[0.0225, 0.0017, -0.0012], [0.0285, 0.0022, -0.0005], VIII_FORK]), () => 0.0009, { tubular: 8, radial: 6 })])));
  out.push(
    P('cochlear_nerve', both((s) => [
      cord(mirror(s, [VIII_FORK, [0.0345, 0.0005, 0.0015], [MODIOLUS[0][0] - 0.0003, MODIOLUS[0][1] + 0.0004, MODIOLUS[0][2] + 0.0005]]), 0.0004, 8, 5),
    ])),
  );
  out.push(
    P('vestibular_nerve', both((s) => [
      cord(mirror(s, [VIII_FORK, [0.0345, 0.0035, -0.0015], [0.0352, 0.0025, -0.0035]]), 0.0004, 8, 5),
    ])),
  );
  out.push(
    P('endolymphatic_duct_and_sac', both((s) => [
      tubeAlong(mirror(s, ENDO_DUCT), () => 0.0005, { tubular: 8, radial: 5 }),
      ellipse(at(s, ENDO_SAC_C), [0.0017, 0.001, 0.003], [0, 0, 0], 10, 7),
    ])),
  );

  return out;
};
