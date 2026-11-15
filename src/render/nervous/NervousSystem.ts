import * as THREE from 'three';
import type { SimSnapshot } from '../../bridge/types';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildCentrelines, type Centreline } from '../vascular/centrelines';
import { organDef, warpPoint } from '../anatomy/layout';
import { SPINAL_CORD_PATH, spinalCordRadius } from '../anatomy/models';

/**
 * THE NERVOUS-SYSTEM OVERLAY.
 *
 * Source for every course: Standring S (ed.), Gray's Anatomy: The Anatomical Basis of
 * Clinical Practice, 42nd edition (Elsevier, 2020), the chapters on the spinal cord and
 * nerve roots, the brachial, lumbar and sacral plexuses, the cranial nerves (optic, vagus),
 * the thoracic wall (intercostal nerves), the phrenic nerve and the autonomic nervous
 * system (sympathetic trunk, splanchnic nerves, the prevertebral ganglia, the pelvic
 * splanchnic nerves and the pudendal nerve). Where I was not sure of a course I left the
 * nerve out rather than guess: there is no facial, trigeminal or glossopharyngeal nerve,
 * no sensory dermatome map, no digital branches, and no cranial parasympathetic outflow
 * other than the vagus.
 *
 * THIS IS A DRAWING, NOT A MODEL. Nothing here is read by the simulation. Coordinates
 * are authored in the same body frame as src/data/organs.json and vasculature.json
 * (+x = the patient's right, +y up, +z forward; the viewer mirrors the whole body once).
 * The vessel file is the landmark frame: nerves run with arteries in neurovascular
 * bundles, so the limb and trunk courses are taken from the matching artery's own
 * centreline plus a small offset rather than invented. Where the vessels stop (the model
 * has no forearm, shin or foot vessels) the courses simply continue in the same
 * direction for a display length; those tails are a diagram and the comment at each says so.
 *
 * THE EXPLODED STACK. The organ stack is moved apart by region (organs.json
 * `groupLayout`), and anything long and continuous goes through `warpPoint` so it
 * stretches across the gaps; the spinal cord itself does. Every nerve point therefore goes
 * through `warpPoint` too, which is what keeps a root attached to the cord and a vagal
 * branch attached to the organ it supplies. The vessel overlay is drawn WITHOUT that warp,
 * so in the abdomen and pelvis a nerve sits up to 4.5 cm off the artery it was derived
 * from while both are on. That is the vessel overlay's offset, not an error in the nerve.
 *
 * COLOUR. The textbook convention: somatic amber-ochre, sympathetic red-orange,
 * parasympathetic blue-violet. A pale yellow multiplied onto a cream page is nearly
 * invisible, so each class takes a saturated tint at a high absorbance; the blue-violet
 * is the strongest because it has to read against red organs.
 *
 * ONE MESH PER CLASS. The tubes are in the multiply bucket (renderOrder 12), the same
 * bucket as the vessel walls and the organ shells, so the order-independence argument in
 * VascularSystem.ts holds unchanged: multiplication commutes. Three merged meshes, and no
 * other draw call: the impulses are NOT particles. A point sprite blended additively is
 * invisible on a pale page, and nerves run out over the page in the limbs. Instead each
 * tube's fragment shader modulates its own absorbance along its length, so an impulse is
 * a short darker, more saturated dash that travels along the nerve. That costs no
 * per-frame CPU at all: a hidden overlay costs nothing, and a visible one writes a
 * handful of uniforms per frame.
 *
 * WHAT THE DASHES MEAN. Space along every nerve is cut into slots; a hash of the slot
 * decides whether it carries a dash, and the nerve's activity sets the fraction of slots
 * that do. So a quiet nerve shows an occasional dash and a busy one a crowded line.
 * The activity per class comes from `snapshot.anatomy.nerves`, which the sim derives:
 *   sympathetic chain, splanchnics, cardiac accelerators -> nerves.sympathetic
 *   vagus, its cardiac and pulmonary branches            -> nerves.parasympathetic
 *   pelvic splanchnics (S2-S4)                           -> nerves.parasympathetic
 *   limb nerves, intercostals                            -> nerves.motor (exertion, shivering, seizure)
 *   spinal root stubs                                    -> max(motor, sensory)
 *   phrenic                                              -> a burst during inspiration (resp.inflation rising), silent when apnoeic
 *   optic nerve                                          -> no field exists; a constant sparse trickle
 * The pudendal nerve rides the motor channel: it is somatic and no pelvic-floor field exists.
 *
 * DASH SPEED IS A DISPLAY CONSTANT. Real conduction runs from roughly 1 m/s in
 * unmyelinated fibres to about 100 m/s in the largest myelinated ones, which would cross
 * the whole body inside a single frame, so no velocity here is data. One speed serves
 * every class, deliberately: giving the classes different speeds would suggest a measured
 * difference that this picture does not carry. The slot length, dash length, the resting
 * floor of lit slots and the line densities are display constants too. All dashes run
 * away from the central nervous system (the efferent direction) except the optic nerve,
 * which runs toward it; most of the vagus really carries traffic the other way, and the
 * picture does not claim otherwise.
 */

/* ------------------------------------------------------------------ display constants */

/** Slot length along a nerve, metres. Display constant. */
const SLOT_M = 0.05;
/** Dash travel speed, metres per second. Display constant; see the header. */
const DASH_SPEED = 0.09;
/** Fraction of slots lit at zero activity, so a resting nerve is quiet, not dead. Display constant. */
const FLOOR_LIT = 0.1;
/** Seconds over which the activity uniforms follow the snapshot. Display constant. */
const ACT_TAU = 0.35;
/** The phrenic burst follows the breath, so it must be quicker than the others. */
const PHRENIC_TAU = 0.08;
/** Trickle on the optic nerve: no sim field exists for it. */
const OPTIC_TRICKLE = 0.25;

/** Activity channels. Index into the `uAct` uniform array. */
const G = { motor: 0, roots: 1, phrenic: 2, sympathetic: 3, vagal: 4, pelvic: 5, optic: 6 } as const;
type Group = (typeof G)[keyof typeof G];
const N_CHANNELS = 8;
/** Colour class of each channel: 0 somatic, 1 sympathetic, 2 parasympathetic. */
const GROUP_CLASS: number[] = [0, 0, 0, 1, 2, 2, 0, 0];

interface ClassStyle {
  name: string;
  tint: number;
  /** Absorbance of the plain nerve and the extra a dash adds. Display constants. */
  base: number;
  dash: number;
}
const CLASSES: ClassStyle[] = [
  { name: 'NerveSomatic', tint: 0xe6c21a, base: 1.1, dash: 1.8 },
  { name: 'NerveSympathetic', tint: 0xff6a10, base: 1.3, dash: 1.6 },
  { name: 'NerveParasympathetic', tint: 0x3a30f0, base: 1.2, dash: 1.5 },
];

/** Rigid cranial group offset, metres (organs.json groupLayout.cranial). */
const CRANIAL_OFFSET_Y = 0.06;

/* ------------------------------------------------------------------------ geometry helpers */

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Cord centre z at a body height, by linear interpolation along the drawn cord path. */
function cordZ(y: number): number {
  const p = SPINAL_CORD_PATH;
  if (y >= p[0][1]) return p[0][2];
  for (let i = 1; i < p.length; i++) {
    if (y >= p[i][1]) {
      const f = (y - p[i][1]) / (p[i - 1][1] - p[i][1]);
      return p[i][2] + (p[i - 1][2] - p[i][2]) * f;
    }
  }
  return p[p.length - 1][2];
}

/* Body heights of the 31 root pairs. C and T follow the cervical and thoracic cord; L and S
 * are crowded onto the conus and cauda equina, as they really are: the lumbar and sacral
 * cord segments sit behind the lower thoracic vertebrae, and their roots run down the
 * canal before they leave it. Heights are display positions along the drawn cord. */
const LEVELS: { name: string; y: number; slope: number; len: number }[] = [];
for (let i = 0; i < 8; i++) LEVELS.push({ name: `C${i + 1}`, y: 0.386 - i * 0.0163, slope: 0.15, len: 0.022 });
for (let i = 0; i < 12; i++) LEVELS.push({ name: `T${i + 1}`, y: 0.262 - i * 0.0135, slope: 0.5, len: 0.022 });
[0.098, 0.082, 0.066, 0.05, 0.035].forEach((y, i) => LEVELS.push({ name: `L${i + 1}`, y, slope: 1.2, len: 0.026 }));
[0.02, -0.005, -0.03, -0.055, -0.08].forEach((y, i) => LEVELS.push({ name: `S${i + 1}`, y, slope: 2.2, len: 0.026 }));
LEVELS.push({ name: 'Co1', y: -0.1, slope: 2.6, len: 0.018 });

interface RootGeom {
  start: THREE.Vector3;
  end: THREE.Vector3;
}

/** Raw (unwarped) stub of one root on one side. */
function rootGeom(level: string, s: 1 | -1): RootGeom {
  const L = LEVELS.find((l) => l.name === level);
  if (!L) throw new Error(`no root ${level}`);
  const r = spinalCordRadius(L.y);
  const z = cordZ(L.y);
  const start = v3(s * r * 0.8, L.y, z + r * 0.2);
  const dir = v3(s * 0.8, -L.slope, 0.6).normalize();
  const end = start.clone().addScaledVector(dir, L.len);
  return { start, end };
}

interface PathDef {
  group: Group;
  radius: number;
  /** Radius multiplier at the far end; 1 keeps the tube parallel. */
  taper: number;
  pts: THREE.Vector3[];
  /** Impulses on or off (a short link that is purely structural stays plain). */
  dashes: boolean;
  /** Points are already in final (exploded) coordinates: skip the warp. Used by the head. */
  final: boolean;
}
interface BeadDef {
  group: Group;
  radius: number;
  at: THREE.Vector3;
}

export class NervousSystem {
  readonly root = new THREE.Group();

  private readonly meshes: THREE.Mesh[] = [];
  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly shared = {
    uTime: { value: 0 },
    uAct: { value: new Float32Array(N_CHANNELS) },
  };
  private readonly target = new Float32Array(N_CHANNELS);
  private time = 0;
  private triangles = 0;
  private haveSnapshot = false;

  private lastInflation = 0;
  private inspiring = false;
  private apnoeic = false;

  private readonly paths: PathDef[] = [];
  private readonly beads: BeadDef[] = [];

  constructor() {
    this.root.visible = false;
    this.author();
    this.build();
    // Channels that never see a snapshot field still need a sensible start.
    this.target[G.optic] = OPTIC_TRICKLE;
    this.shared.uAct.value[G.optic] = OPTIC_TRICKLE;
  }

  /* ------------------------------------------------------------------------- authoring */

  private nerve(group: Group, radius: number, pts: THREE.Vector3[], taper = 0.7, final = false): void {
    this.paths.push({ group, radius, taper, pts, dashes: true, final });
  }
  private bead(group: Group, radius: number, at: THREE.Vector3): void {
    this.beads.push({ group, radius, at });
  }

  /** Courses are authored per side; `s` is +1 for the patient's right (+x). */
  private author(): void {
    const lines = new Map<string, Centreline>();
    for (const c of buildCentrelines()) lines.set(c.id, c);
    const art = (base: string, s: 1 | -1) => `${base}_${s > 0 ? 'r' : 'l'}`;

    /** `n` points along a named vessel between fractions u0..u1, shifted by an offset. */
    const seg = (id: string, u0: number, u1: number, n: number, ox: number, oy: number, oz: number) => {
      const c = lines.get(id);
      if (!c) throw new Error(`no vessel ${id}`);
      const out: THREE.Vector3[] = [];
      for (let k = 0; k < n; k++) {
        const u = n === 1 ? u0 : u0 + ((u1 - u0) * k) / (n - 1);
        const i = Math.max(0, Math.min(c.positions.length - 1, Math.round(u * (c.positions.length - 1))));
        out.push(c.positions[i].clone().add(v3(ox, oy, oz)));
      }
      return out;
    };
    const first = (id: string) => lines.get(id)!.positions[0].clone();
    const last = (id: string) => {
      const p = lines.get(id)!.positions;
      return p[p.length - 1].clone();
    };

    const organ = (id: string) => {
      const d = organDef(id);
      return v3(d.position[0] + d.layoutOffset[0], d.position[1] + d.layoutOffset[1], d.position[2] + d.layoutOffset[2]);
    };

    /* ---- 1. SPINAL NERVE ROOTS: 31 pairs of short stubs, so the segmental pattern reads. */
    for (const L of LEVELS) {
      for (const s of [1, -1] as const) {
        const g = rootGeom(L.name, s);
        const mid = g.start.clone().lerp(g.end, 0.5);
        // The cervical enlargement's roots (C5-T1) feed the arm and are drawn thicker.
        const feedsArm = ['C5', 'C6', 'C7', 'C8', 'T1'].includes(L.name);
        this.nerve(G.roots, feedsArm ? 0.0016 : 0.0011, [g.start, mid, g.end], 0.75);
      }
    }
    const end = (name: string, s: 1 | -1) => rootGeom(name, s).end;

    for (const s of [1, -1] as const) {
      /* ---- 2. SOMATIC. */

      // Brachial plexus (C5-T1): five roots converge over the first rib, run behind the
      // clavicle alongside the subclavian artery, and divide at the axilla into the
      // median, ulnar and radial nerves (Standring, brachial plexus). The trunk/division/
      // cord stages are not drawn; they are a rearrangement, not a different course.
      const conv = v3(s * 0.042, 0.279, -0.02);
      for (const n of ['C5', 'C6', 'C7', 'C8', 'T1']) {
        const e = end(n, s);
        this.nerve(G.motor, 0.0014, [e, e.clone().lerp(conv, 0.5).add(v3(0, 0.002, -0.002)), conv], 0.9);
      }
      const trunk = [conv, ...seg(art('subclavian', s), 0.35, 1, 4, 0, 0.007, -0.010)];
      this.nerve(G.motor, 0.0024, trunk, 0.9);
      const axilla = trunk[trunk.length - 1];

      // Arm: brachial artery points (vessel frame) with a bundle offset per nerve.
      const bra = art('brachial', s);
      const elbow = last(bra);
      // Forearm and hand are NOT in the vessel file. The tail continues down and slightly
      // out for a display length (forearm 0.105, hand 0.03); it is a diagram.
      const fore = v3(s * 0.2, -1, 0.12).normalize();
      const wrist = elbow.clone().addScaledVector(fore, 0.105);
      const hand = wrist.clone().addScaledVector(fore, 0.03);
      const armNerve = (group: Group, radius: number, ao: [number, number, number], fo: [number, number, number]) => {
        const pts = [axilla.clone(), ...seg(bra, 0, 1, 5, ao[0], ao[1], ao[2])];
        pts.push(elbow.clone().addScaledVector(fore, 0.05).add(v3(fo[0], fo[1], fo[2])));
        pts.push(wrist.clone().add(v3(fo[0], fo[1], fo[2])));
        pts.push(hand.clone().add(v3(fo[0], fo[1], fo[2])));
        this.nerve(group, radius, pts, 0.6);
      };
      // Median: anterolateral to the artery in the upper arm, midline of the forearm.
      armNerve(G.motor, 0.0016, [s * 0.003, 0, 0.006], [0, 0, 0.008]);
      // Ulnar: medial and posterior to the artery, the medial side of the forearm.
      armNerve(G.motor, 0.0016, [-s * 0.006, 0, -0.006], [-s * 0.010, 0, 0.002]);
      // Radial: posterior to the humerus, then the lateral side of the forearm.
      armNerve(G.motor, 0.0018, [s * 0.004, 0, -0.010], [s * 0.010, 0, -0.002]);

      // Intercostal nerves T1-T11: each runs forward in its intercostal space, a rib
      // ellipse, sloping down toward the sternum. The ellipse is a display cage matched
      // to the lung and heart positions in organs.json, not a traced rib cage. T12 is the
      // subcostal nerve and is left out.
      for (let i = 0; i < 11; i++) {
        const lv = `T${i + 1}`;
        const e = end(lv, s);
        const y0 = e.y;
        const t = Math.max(0, Math.min(1, (0.27 - y0) / 0.12));
        const sc = 0.42 + 0.58 * (t * t * (3 - 2 * t));
        const a = 0.112 * sc;
        const b = 0.083 * sc;
        const pts: THREE.Vector3[] = [e];
        const steps = 7;
        for (let k = 0; k <= steps; k++) {
          const th = 0.3 + ((Math.PI - 0.4) * k) / steps;
          const drop = 0.03 * Math.pow(th / Math.PI, 1.3);
          pts.push(v3(s * a * Math.sin(th), y0 - drop, -0.0085 - b * Math.cos(th)));
        }
        this.nerve(G.motor, 0.0008, pts, 0.8);
      }

      // Lumbar plexus (L1-L4): in the psoas, lateral to the aorta. Femoral nerve to the
      // thigh and obturator nerve to the medial thigh (Standring, lumbar plexus).
      const lp = v3(s * 0.04, 0.0, -0.048);
      for (const n of ['L2', 'L3', 'L4']) {
        const e = end(n, s);
        this.nerve(G.motor, 0.0016, [e, e.clone().lerp(lp, 0.55).add(v3(0, -0.004, -0.004)), lp], 0.9);
      }
      const fem = art('femoral', s);
      const inguinal = first(fem).add(v3(s * 0.010, 0, 0.003));
      const femPts = [lp.clone(), v3(s * 0.052, -0.065, -0.034), inguinal, ...seg(fem, 0.15, 1, 4, s * 0.010, 0, 0.004)];
      // Below the knee the femoral nerve continues as the saphenous nerve with the long
      // saphenous vein, down the medial leg. Ankle is a display length below the knee.
      const knee = last(art('popliteal', s));
      const ankle = knee.clone().add(v3(-s * 0.002, -0.19, -0.004));
      femPts.push(knee.clone().add(v3(-s * 0.008, -0.02, 0.006)), ankle.clone().add(v3(-s * 0.010, 0.02, 0.006)), ankle.clone().add(v3(-s * 0.010, 0, 0.004)));
      this.nerve(G.motor, 0.0026, femPts, 0.45);
      // Obturator: along the pelvic side wall, through the obturator canal to the adductors.
      this.nerve(G.motor, 0.0014, [lp.clone(), v3(s * 0.036, -0.09, -0.028), v3(s * 0.04, -0.15, -0.012), v3(s * 0.036, -0.175, 0.0), v3(s * 0.03, -0.215, 0.008), v3(s * 0.032, -0.25, 0.012)], 0.7);

      // Sacral plexus (L4-S3) -> sciatic nerve, which divides at the popliteal fossa into
      // the tibial nerve and the common fibular nerve. Leaves the pelvis through the
      // greater sciatic foramen and runs down the back of the thigh.
      const sp = v3(s * 0.04, -0.085, -0.064);
      for (const n of ['L4', 'L5', 'S1', 'S2', 'S3']) {
        const e = end(n, s);
        this.nerve(G.motor, 0.0016, [e, e.clone().lerp(sp, 0.5).add(v3(s * 0.004, 0, -0.002)), sp], 0.9);
      }
      const fork = v3(s * 0.053, -0.282, -0.032);
      this.nerve(G.motor, 0.0034, [sp.clone(), v3(s * 0.05, -0.125, -0.052), v3(s * 0.053, -0.18, -0.045), v3(s * 0.054, -0.24, -0.038), fork], 0.8);
      // Tibial: straight down the back of the leg, behind the medial malleolus, onto the sole.
      this.nerve(G.motor, 0.002, [fork.clone(), v3(s * 0.051, -0.33, -0.02), v3(s * 0.05, -0.4, -0.016), v3(s * 0.048, -0.48, -0.016), v3(s * 0.046, -0.525, -0.012), v3(s * 0.044, -0.545, 0.02), v3(s * 0.044, -0.555, 0.06)], 0.5);
      // Common fibular: round the neck of the fibula, then forward onto the dorsum of the foot.
      this.nerve(G.motor, 0.002, [fork.clone(), v3(s * 0.062, -0.31, -0.026), v3(s * 0.066, -0.345, -0.008), v3(s * 0.064, -0.4, 0.01), v3(s * 0.058, -0.48, 0.016), v3(s * 0.056, -0.545, 0.05), v3(s * 0.056, -0.552, 0.075)], 0.5);

      // Pudendal nerve (S2-S4): out through the greater sciatic foramen, round the ischial
      // spine, forward through the pudendal canal to the perineum. Rides the motor channel.
      const pu = v3(s * 0.036, -0.105, -0.058);
      for (const n of ['S2', 'S3', 'S4']) {
        const e = end(n, s);
        this.nerve(G.motor, 0.0011, [e, e.clone().lerp(pu, 0.5).add(v3(s * 0.003, 0, -0.002)), pu], 0.9);
      }
      this.nerve(G.motor, 0.0013, [pu, v3(s * 0.035, -0.14, -0.04), v3(s * 0.032, -0.19, -0.02), v3(s * 0.016, -0.235, 0.0), v3(s * 0.006, -0.25, 0.022)], 0.6);

      /* ---- 3. CRANIAL. */

      // Phrenic (C3-C5): down the side of the neck, over the first rib, beside the
      // pericardium (right: by the right atrium and venae cavae; left: over the left
      // ventricle) to the dome of the diaphragm.
      const c4 = end('C4', s);
      for (const n of ['C3', 'C5']) {
        const e = end(n, s);
        this.nerve(G.phrenic, 0.001, [e, e.clone().lerp(c4, 0.7).add(v3(0, -0.002, 0.002)), c4], 0.9);
      }
      this.nerve(
        G.phrenic,
        0.0015,
        s > 0
          ? [c4, v3(0.034, 0.32, -0.012), v3(0.04, 0.275, 0.0), v3(0.045, 0.24, 0.012), v3(0.048, 0.17, 0.014), v3(0.05, 0.1, 0.004), v3(0.046, 0.075, 0.002)]
          : [c4, v3(-0.034, 0.32, -0.012), v3(-0.05, 0.275, 0.0), v3(-0.06, 0.24, 0.014), v3(-0.073, 0.15, 0.02), v3(-0.066, 0.095, 0.012), v3(-0.058, 0.072, 0.004)],
        0.7,
      );

      /* ---- 4. AUTONOMIC. */

      // Pelvic splanchnic nerves (S2-S4): the sacral parasympathetic outflow, to the
      // pelvic plexus and on to the bladder and the genital organs.
      const pp = v3(s * 0.022, -0.17, -0.026);
      for (const n of ['S2', 'S3', 'S4']) {
        const e = end(n, s);
        this.nerve(G.pelvic, 0.001, [e.clone().add(v3(-s * 0.004, 0, 0.004)), e.clone().lerp(pp, 0.5).add(v3(0, 0, 0.012)), pp], 0.9);
      }
      // The bladder and the genital organs: one target point between the male prostate
      // and the female uterus and vagina (organs.json puts them within a centimetre).
      const bladder = organ('bladder').add(v3(s * 0.016, -0.006, -0.004));
      const genital = v3(s * 0.01, -0.222, 0.0);
      this.nerve(G.pelvic, 0.0012, [pp.clone(), v3(s * 0.022, -0.18, -0.012), bladder], 0.7);
      this.nerve(G.pelvic, 0.0012, [pp.clone(), v3(s * 0.016, -0.2, -0.012), genital], 0.7);
    }

    // Chain, ganglia and everything that hangs off the chain.
    this.authorSympathetic(seg, first, organ, end, art);
    this.authorVagus(seg, first, last, organ, art);
    this.authorOptic();
  }

  private authorSympathetic(
    seg: (id: string, u0: number, u1: number, n: number, ox: number, oy: number, oz: number) => THREE.Vector3[],
    first: (id: string) => THREE.Vector3,
    organ: (id: string) => THREE.Vector3,
    end: (name: string, s: 1 | -1) => THREE.Vector3,
    art: (base: string, s: 1 | -1) => string,
  ): void {
    // Chain beads by level, per side. T1-L2 are the spinal stubs' own ends (the white
    // rami communicantes leave the cord at T1-L2 and meet the chain); the cervical
    // ganglia and the sacral ones are placed beside the cord by height.
    const beadAt = new Map<string, THREE.Vector3>();
    const chain: Record<string, THREE.Vector3[]> = { r: [], l: [] };
    for (const s of [1, -1] as const) {
      const k = s > 0 ? 'r' : 'l';
      const put = (name: string, p: THREE.Vector3, rad: number) => {
        beadAt.set(`${name}${k}`, p);
        chain[k].push(p);
        this.bead(G.sympathetic, rad, p);
      };
      // Superior, middle and inferior (stellate) cervical ganglia: placed in front of the
      // cervical column at their usual heights (C2-C3, C6, C7-T1).
      put('SCG', v3(s * 0.021, 0.372, cordZ(0.372) + 0.036), 0.0042);
      put('MCG', v3(s * 0.021, 0.322, cordZ(0.322) + 0.032), 0.0028);
      put('STG', v3(s * 0.024, 0.286, cordZ(0.286) + 0.028), 0.0036);
      for (let i = 1; i <= 12; i++) put(`T${i}`, end(`T${i}`, s).clone(), 0.0024);
      for (let i = 1; i <= 5; i++) put(`L${i}`, end(`L${i}`, s).clone(), 0.0024);
      for (let i = 1; i <= 4; i++) put(`S${i}`, end(`S${i}`, s).clone().add(v3(-s * 0.008, 0, 0.004)), 0.002);
      // Ganglion impar: where the two chains meet in front of the coccyx. One bead only.
    }
    const impar = v3(0, -0.108, cordZ(-0.1) + 0.034);
    this.bead(G.sympathetic, 0.0022, impar);
    for (const k of ['r', 'l']) {
      const pts = [...chain[k], impar.clone()];
      this.nerve(G.sympathetic, 0.0012, pts, 0.9);
    }

    const cardiacPlexus = v3(-0.006, 0.222, 0.004);
    // Cardiac targets: the sinoatrial node region, the atrioventricular node region and
    // the left ventricle. Display positions inside the heart of organs.json.
    const sa = v3(0.014, 0.196, 0.024);
    const av = v3(-0.002, 0.168, 0.012);
    const lv = v3(-0.034, 0.14, 0.034);

    for (const s of [1, -1] as const) {
      const k = s > 0 ? 'r' : 'l';
      // Cardiac accelerator (sympathetic cardiac) nerves: from the cervical ganglia and
      // the upper thoracic chain to the cardiac plexus at the base of the heart.
      for (const [nm, mid] of [
        ['MCG', v3(s * 0.016, 0.285, -0.004)],
        ['STG', v3(s * 0.016, 0.262, 0.0)],
        ['T3', v3(s * 0.02, 0.24, -0.018)],
      ] as const) {
        const b = beadAt.get(`${nm}${k}`)!;
        this.nerve(G.sympathetic, 0.0009, [b.clone(), mid.clone(), cardiacPlexus.clone().add(v3(0, 0, 0.003))], 0.8);
      }

      // Greater splanchnic (T5-T9), lesser (T10-T11): converge down the side of the
      // vertebral column, pierce the diaphragm and end in the coeliac and superior
      // mesenteric ganglia.
      const join = v3(s * 0.024, 0.115, -0.052);
      const cg = v3(-0.016 + s * 0.011, 0.088, -0.032);
      const smg = v3(-0.016 + s * 0.010, 0.07, -0.032);
      for (const n of ['T5', 'T7', 'T9']) {
        const b = beadAt.get(`${n}${k}`)!;
        this.nerve(G.sympathetic, 0.001, [b.clone(), b.clone().lerp(join, 0.5).add(v3(s * 0.002, 0, -0.004)), join.clone()], 0.9);
      }
      this.nerve(G.sympathetic, 0.0014, [join.clone(), v3(s * 0.02, 0.098, -0.044), v3(s * 0.014, 0.092, -0.036), cg.clone()], 0.8);
      const lesserJoin = v3(s * 0.022, 0.1, -0.05);
      for (const n of ['T10', 'T11']) {
        const b = beadAt.get(`${n}${k}`)!;
        this.nerve(G.sympathetic, 0.0009, [b.clone(), b.clone().lerp(lesserJoin, 0.5), lesserJoin.clone()], 0.9);
      }
      this.nerve(G.sympathetic, 0.0011, [lesserJoin.clone(), v3(s * 0.017, 0.085, -0.04), smg.clone()], 0.8);
      this.bead(G.sympathetic, 0.0048, cg);
      this.bead(G.sympathetic, 0.0034, smg);

      // From the coeliac ganglion: the adrenal medulla (preganglionic fibres end here
      // directly on the chromaffin cells), then the gut along the arteries.
      const adr = organ(s > 0 ? 'adrenal_r' : 'adrenal_l');
      this.nerve(G.sympathetic, 0.0011, [cg.clone(), cg.clone().lerp(adr, 0.5).add(v3(0, 0, -0.006)), adr], 0.8);
      // Renal plexus along the renal artery.
      this.nerve(G.sympathetic, 0.0009, [smg.clone(), ...seg(art('renal_artery', s), 0, 1, 4, 0, 0.004, 0.004)], 0.7);
    }
    // Coeliac plexus fibres to the liver, spleen and stomach, and the superior
    // mesenteric plexus to the small bowel, each running with its artery.
    const cgL = v3(-0.016 - 0.011, 0.088, -0.032);
    const cgR = v3(-0.016 + 0.011, 0.088, -0.032);
    this.nerve(G.sympathetic, 0.0009, [cgR.clone(), ...seg('hepatic_artery', 0, 1, 4, 0, 0.005, 0.003)], 0.7);
    this.nerve(G.sympathetic, 0.0009, [cgL.clone(), ...seg('splenic_artery', 0, 1, 5, 0, 0.005, 0.003)], 0.7);
    this.nerve(G.sympathetic, 0.0009, [cgL.clone(), ...seg('left_gastric', 0, 1, 3, 0, 0.004, 0.003)], 0.7);
    this.nerve(G.sympathetic, 0.001, [v3(-0.016, 0.07, -0.032), ...seg('sma', 0.05, 1, 6, -0.006, 0, 0.004)], 0.5);

    // Cardiac plexus onward to the heart, sympathetic side (offset in z from the vagal).
    this.nerve(G.sympathetic, 0.001, [cardiacPlexus.clone().add(v3(0, 0, 0.003)), sa.clone().add(v3(0, 0, 0.004))], 0.7);
    this.nerve(G.sympathetic, 0.001, [cardiacPlexus.clone().add(v3(0, 0, 0.003)), av.clone().add(v3(0, 0, 0.004))], 0.7);
    this.nerve(G.sympathetic, 0.001, [av.clone().add(v3(0, 0, 0.004)), lv.clone()], 0.7);

    // Lumbar splanchnic nerves (L1-L2) to the inferior mesenteric ganglion at the origin
    // of the inferior mesenteric artery, then with that artery to the hindgut; the
    // hypogastric plexus and the two hypogastric nerves carry sympathetic fibres on to the
    // pelvic plexus.
    const img = first('ima').add(v3(0, 0, -0.002));
    this.bead(G.sympathetic, 0.0028, img);
    for (const s of [1, -1] as const) {
      const k = s > 0 ? 'r' : 'l';
      const b = beadAt.get(`L2${k}`)!;
      this.nerve(G.sympathetic, 0.001, [b.clone(), v3(s * 0.012, 0.025, -0.05), img.clone()], 0.8);
    }
    this.nerve(G.sympathetic, 0.001, [img.clone(), ...seg('ima', 0.1, 1, 5, 0.004, 0, 0.004)], 0.6);
    const hyp = v3(0, -0.032, -0.036);
    this.nerve(G.sympathetic, 0.0012, [img.clone(), v3(-0.004, -0.01, -0.034), hyp], 0.8);
    for (const s of [1, -1] as const) {
      this.nerve(G.sympathetic, 0.0011, [hyp.clone(), v3(s * 0.012, -0.1, -0.042), v3(s * 0.02, -0.15, -0.034), v3(s * 0.022, -0.17, -0.026)], 0.7);
    }
  }

  private authorVagus(
    seg: (id: string, u0: number, u1: number, n: number, ox: number, oy: number, oz: number) => THREE.Vector3[],
    first: (id: string) => THREE.Vector3,
    last: (id: string) => THREE.Vector3,
    organ: (id: string) => THREE.Vector3,
    art: (base: string, s: 1 | -1) => string,
  ): void {
    void last;
    const cardiacPlexus = v3(-0.006, 0.222, 0.004);
    const sa = v3(0.014, 0.196, 0.024);
    const av = v3(-0.002, 0.168, 0.012);

    // THE VAGUS (cranial nerve X): out of the medulla (the top of the drawn cord) through
    // the jugular foramen, down the carotid sheath behind the common carotid artery, then
    // to the thoracic organs and the foregut. The right vagus passes in front of the
    // subclavian artery and reaches the back of the oesophagus (posterior vagal trunk); the left
    // passes between the left carotid and subclavian arteries, crosses the aortic arch's
    // left side and reaches the front of the oesophagus (anterior vagal trunk).
    const stomachLesser = [v3(-0.012, 0.105, -0.008), v3(-0.03, 0.094, -0.002), v3(-0.058, 0.08, 0.004), v3(-0.07, 0.05, 0.006)];
    for (const s of [1, -1] as const) {
      const carotid = art('carotid', s);
      const neck = seg(carotid, 1, 0, 6, s * 0.008, 0, -0.010);
      const top = [v3(s * 0.004, 0.388, -0.026), v3(s * 0.016, 0.39, -0.02)];
      let thorax: THREE.Vector3[];
      let abdomen: THREE.Vector3[];
      if (s > 0) {
        thorax = [v3(0.014, 0.254, -0.006), v3(0.018, 0.236, -0.018), v3(0.02, 0.21, -0.03), v3(0.008, 0.18, -0.03), v3(0.004, 0.15, -0.022), v3(0.0, 0.12, -0.016)];
        abdomen = [v3(-0.006, 0.1, -0.016), v3(-0.008, 0.09, -0.022)];
      } else {
        thorax = [v3(-0.03, 0.252, -0.004), v3(-0.044, 0.238, -0.006), v3(-0.052, 0.215, -0.018), v3(-0.03, 0.18, -0.012), v3(-0.012, 0.15, -0.006), v3(-0.014, 0.118, -0.002)];
        abdomen = [v3(-0.018, 0.1, 0.0)];
      }
      const main = [...top, ...neck, ...thorax, ...abdomen];
      this.nerve(G.vagal, 0.0017, main, 0.6);

      // Cardiac branches to the cardiac plexus (cervical and thoracic cardiac branches).
      const nk = neck[Math.floor(neck.length / 2)];
      this.nerve(G.vagal, 0.0009, [nk.clone(), v3(s * 0.014, 0.262, 0.004), v3(s * 0.006, 0.238, 0.006), cardiacPlexus.clone().add(v3(0, 0, -0.002))], 0.8);
      // Pulmonary branches to the lung roots and on along the lobar bronchi.
      const hilum = s > 0 ? [v3(0.02, 0.21, -0.03), v3(0.045, 0.212, -0.02), v3(0.07, 0.21, -0.006), v3(0.092, 0.186, 0.004)] : [v3(-0.052, 0.215, -0.018), v3(-0.064, 0.208, -0.008), v3(-0.068, 0.205, -0.002), v3(-0.088, 0.182, 0.004)];
      this.nerve(G.vagal, 0.001, hilum, 0.7);
    }
    // Cardiac plexus onward to the nodes (vagal side, offset opposite the sympathetic).
    this.nerve(G.vagal, 0.001, [cardiacPlexus.clone().add(v3(0, 0, -0.002)), sa.clone().add(v3(0, 0, -0.003))], 0.7);
    this.nerve(G.vagal, 0.001, [cardiacPlexus.clone().add(v3(0, 0, -0.002)), av.clone().add(v3(0, 0, -0.003))], 0.7);

    // Anterior trunk (mostly left vagus): the gastric branches along the lesser
    // curvature, and the hepatic branch to the liver.
    this.nerve(G.vagal, 0.0013, [v3(-0.018, 0.1, 0.0), ...stomachLesser.slice(1).map((p) => p.clone().add(v3(0, 0.002, 0.006)))], 0.5);
    const liver = organ('liver');
    this.nerve(G.vagal, 0.0011, [v3(-0.018, 0.1, 0.0), v3(-0.008, 0.088, 0.008), v3(0.012, 0.078, 0.008), liver.clone().add(v3(-0.01, 0.01, 0))], 0.7);
    // Posterior trunk (mostly right vagus): posterior gastric branches, and the coeliac
    // branch to the coeliac ganglion and along the superior mesenteric artery to the gut.
    this.nerve(G.vagal, 0.0013, [v3(-0.008, 0.09, -0.022), ...stomachLesser.slice(1).map((p) => p.clone().add(v3(0, 0.002, -0.008)))], 0.5);
    const coeliacGanglion = v3(-0.016 + 0.011, 0.088, -0.032);
    this.nerve(G.vagal, 0.0013, [v3(-0.008, 0.09, -0.022), coeliacGanglion.clone().add(v3(0, 0, 0.004))], 0.8);
    this.nerve(G.vagal, 0.001, [coeliacGanglion.clone().add(v3(0, 0, 0.004)), ...seg('sma', 0.1, 1, 6, 0.007, 0, 0.002)], 0.5);
    void first;
  }

  private authorOptic(): void {
    // Optic nerves (II): from the back of each globe through the optic canal to the
    // chiasm, then a short stub of each optic tract. Coordinates are local to the eyes
    // organ (globe at x = +-0.031, nerve toward -z, as the eye model itself draws it) and
    // go through the organ's own position; the head sits on a rigid group offset, so these
    // points are NOT passed through `warpPoint`. Dashes run toward the brain.
    const d = organDef('eyes');
    const base = v3(d.position[0] + d.layoutOffset[0], d.position[1] + d.layoutOffset[1], d.position[2] + d.layoutOffset[2]);
    // The head sits on the cranial group's rigid offset (organs.json groupLayout).
    base.add(v3(0, CRANIAL_OFFSET_Y, 0));
    for (const s of [1, -1] as const) {
      const p = (x: number, y: number, z: number) => base.clone().add(v3(s * x, y, z));
      const pts = [p(0.029, 0, -0.011), p(0.02, 0.002, -0.026), p(0.012, 0.004, -0.04), p(0.004, 0.004, -0.05), p(0, 0.003, -0.056)];
      this.nerve(G.optic, 0.0022, pts, 0.9, true);
      const tract = [p(0, 0.003, -0.056), p(0.008, 0.004, -0.066), p(0.016, 0.005, -0.076)];
      this.nerve(G.optic, 0.0018, tract, 0.8, true);
    }
  }

  /* ---------------------------------------------------------------------------- build */

  private build(): void {
    const geoms: THREE.BufferGeometry[][] = [[], [], []];
    let seed = 0;

    for (const path of this.paths) {
      const pts = path.pts.map((p) => {
        if (path.final) return p.clone();
        const w = warpPoint([p.x, p.y, p.z]);
        return v3(w[0], w[1], w[2]);
      });
      const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
      const length = curve.getLength();
      if (!(length > 1e-5)) continue;
      const tubular = Math.max(4, Math.min(80, Math.round(length / 0.006)));
      const radial = path.radius > 0.0016 ? 6 : 4;
      const geo = new THREE.TubeGeometry(curve, tubular, 1, radial, false);
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      const count = pos.count;
      const arcs = new Float32Array(count);
      const seeds = new Float32Array(count);
      const groups = new Float32Array(count);
      const centre = new THREE.Vector3();
      const v = new THREE.Vector3();
      const sd = path.dashes ? 1 + (seed++ % 997) * 0.731 : -1;
      for (let i = 0; i <= tubular; i++) {
        const t = i / tubular;
        curve.getPointAt(t, centre);
        const r = path.radius * (1 - (1 - path.taper) * t);
        for (let j = 0; j <= radial; j++) {
          const k = i * (radial + 1) + j;
          v.fromBufferAttribute(pos, k).sub(centre).multiplyScalar(r).add(centre);
          pos.setXYZ(k, v.x, v.y, v.z);
          arcs[k] = t * length;
          seeds[k] = sd;
          groups[k] = path.group;
        }
      }
      geo.deleteAttribute('uv');
      geo.setAttribute('aArc', new THREE.BufferAttribute(arcs, 1));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
      geo.setAttribute('aGrp', new THREE.BufferAttribute(groups, 1));
      geoms[GROUP_CLASS[path.group]].push(geo);
    }

    for (const b of this.beads) {
      const w = warpPoint([b.at.x, b.at.y, b.at.z]);
      const geo = new THREE.SphereGeometry(b.radius, 8, 6);
      geo.translate(w[0], w[1], w[2]);
      geo.deleteAttribute('uv');
      const n = geo.getAttribute('position').count;
      geo.setAttribute('aArc', new THREE.BufferAttribute(new Float32Array(n), 1));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(n).fill(-1), 1));
      geo.setAttribute('aGrp', new THREE.BufferAttribute(new Float32Array(n).fill(b.group), 1));
      geoms[GROUP_CLASS[b.group]].push(geo);
    }

    for (let c = 0; c < 3; c++) {
      if (geoms[c].length === 0) continue;
      const merged = mergeGeometries(geoms[c], false);
      for (const g of geoms[c]) g.dispose();
      if (!merged) continue;
      const style = CLASSES[c];
      const material = new THREE.ShaderMaterial({
        name: style.name,
        uniforms: {
          uTime: this.shared.uTime,
          uAct: this.shared.uAct,
          uTint: { value: new THREE.Color(style.tint) },
          uBase: { value: style.base },
          uDash: { value: style.dash },
          uSlot: { value: SLOT_M },
          uSpeed: { value: DASH_SPEED },
          uFloor: { value: FLOOR_LIT },
        },
        vertexShader: /* glsl */ `
          uniform float uAct[${N_CHANNELS}];
          attribute float aArc;
          attribute float aSeed;
          attribute float aGrp;
          varying vec3 vNormalW;
          varying vec3 vViewDirW;
          varying float vArc;
          varying float vSeed;
          varying float vAct;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vNormalW = normalize(mat3(modelMatrix) * normal);
            vViewDirW = cameraPosition - wp.xyz;
            vArc = aArc;
            vSeed = aSeed;
            vAct = uAct[int(aGrp + 0.5)];
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uTint;
          uniform float uBase;
          uniform float uDash;
          uniform float uSlot;
          uniform float uSpeed;
          uniform float uFloor;
          uniform float uTime;
          varying vec3 vNormalW;
          varying vec3 vViewDirW;
          varying float vArc;
          varying float vSeed;
          varying float vAct;
          float hash(float k, float s) {
            return fract(sin(k * 12.9898 + s * 78.233) * 43758.5453);
          }
          void main() {
            vec3 N = normalize(vNormalW);
            vec3 V = normalize(vViewDirW);
            float path = 1.0 / max(abs(dot(N, V)), 0.55);
            float dens = uBase;
            if (vSeed > 0.0) {
              // Slots scroll along the nerve at the display speed; a hash of the slot
              // decides whether it carries a dash, and the activity sets how many do.
              float slot = (vArc - uTime * uSpeed) / uSlot;
              float k = floor(slot);
              float f = fract(slot);
              float lit = step(hash(k, vSeed), uFloor + (1.0 - uFloor) * vAct);
              float dash = smoothstep(0.0, 0.1, f) * (1.0 - smoothstep(0.26, 0.36, f));
              dens += uDash * lit * dash;
            }
            vec3 T = exp(-dens * path * (1.0 - uTint));
            gl_FragColor = vec4(T, 1.0);
          }
        `,
        // BUCKET 1: multiply, order-independent with the organ shells and vessel walls.
        blending: THREE.CustomBlending,
        blendSrc: THREE.DstColorFactor,
        blendDst: THREE.ZeroFactor,
        depthWrite: false,
        depthTest: true,
        transparent: true,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(merged, material);
      mesh.renderOrder = 12;
      mesh.frustumCulled = false;
      this.root.add(mesh);
      this.meshes.push(mesh);
      this.materials.push(material);
      const idx = merged.getIndex();
      this.triangles += idx ? idx.count / 3 : merged.getAttribute('position').count / 3;
    }
    // The authoring lists are not needed any more.
    this.paths.length = 0;
    this.beads.length = 0;
  }

  /* --------------------------------------------------------------------------- runtime */

  setVisible(on: boolean): void {
    this.root.visible = on;
  }

  /** Called at snapshot rate, not per frame. */
  pushSnapshot(s: SimSnapshot): void {
    const n = s.anatomy?.nerves;
    if (!n) return;
    const t = this.target;
    t[G.motor] = n.motor;
    t[G.roots] = Math.max(n.motor, n.sensory);
    t[G.sympathetic] = n.sympathetic;
    t[G.vagal] = n.parasympathetic;
    t[G.pelvic] = n.parasympathetic;
    // Phrenic: motor neurons fire during INSPIRATION, so the burst is on while the lung
    // is filling and off while it empties, and absent when the body is apnoeic. The sim's
    // inflation curve rises through inspiration and decays afterwards, so "rising" is
    // inspiration without the renderer needing to know the inspiratory fraction.
    const infl = s.resp.inflation;
    this.apnoeic = s.resp.apnoeic;
    this.inspiring = infl > this.lastInflation + 1e-4;
    this.lastInflation = infl;
    t[G.phrenic] = this.apnoeic ? 0 : this.inspiring ? 1 : 0;
    t[G.optic] = OPTIC_TRICKLE;
    this.haveSnapshot = true;
  }

  /** Per-frame: advance the dash clock and ease the activity uniforms. dt in seconds. */
  update(dt: number): void {
    if (!this.root.visible) return;
    this.time = (this.time + dt) % 20000;
    this.shared.uTime.value = this.time;
    if (!this.haveSnapshot) return;
    const cur = this.shared.uAct.value;
    for (let i = 0; i < N_CHANNELS; i++) {
      const tau = i === G.phrenic ? PHRENIC_TAU : ACT_TAU;
      cur[i] += (this.target[i] - cur[i]) * (1 - Math.exp(-dt / tau));
    }
  }

  dispose(): void {
    for (const m of this.meshes) m.geometry.dispose();
    for (const m of this.materials) m.dispose();
  }

  get triangleCount(): number {
    return this.triangles;
  }
}

