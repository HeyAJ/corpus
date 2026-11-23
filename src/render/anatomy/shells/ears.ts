import * as THREE from 'three';
import { mergeParts, tubeAlong, type V3 } from '../sdf';

/**
 * EARS, SHELL AND SHARED LAYOUT. Both ears in one organ, the pattern the eyes use.
 *
 * Frame: origin at organs.json [0, 0.386, -0.012]. The height is the eyes' own (0.386, then
 * lifted 0.06 with the cranial group): the brief is "temporal region at about eye level".
 * In z it is 7.2 cm behind the globes (z 0.06), the order of the distance from pupil to ear
 * canal in an adult head. Every position below is written for the RIGHT ear (+x) with X the
 * distance from the midline; `at(s, ...)` puts it on side s.
 *
 * NO AURICLE. The outer ear (the pinna) is left out on purpose. The glass body outline
 * (`src/render/body/outlineModel.ts`) is fitted to the organ shells, so a flap standing out
 * from the temporal region would pull the glass head out into two handles, and there is no
 * face or hair for it to read against. The external acoustic meatus therefore simply opens
 * at the lateral limit of the shell, where the head's own surface is. The atlas says so.
 *
 * WHY THE LAYOUT LIVES IN THE SHELL FILE. The shell, the atlas parts and nothing else need
 * the same canal, cavity, cochlea and canal loops, and the shell file is the one both can
 * import without a cycle (it imports only sdf). Every size is a drawing choice made so that
 * the parts fit inside the shell and read at a camera distance a person can use; none is a
 * measurement. The cochlea turns follow Gray's account of the bony cochlea (two and
 * three-quarter turns), drawn as a tapering helix.
 *
 * THE PHARYNGOTYMPANIC TUBE runs from the front wall of the tympanic cavity forward, medially
 * and down to the nasopharynx. Its end (X 0.012, y -0.011, z 0.006 here, which is scene
 * x 0.012, y 0.435, z -0.006) is aligned with the lateral wall of the pharynx stub, whose
 * centreline rises through x 0 to 0.002, z -0.01 to -0.008 with a radius that grows to about
 * 0.012 at the top; agent hn1 draws the tubal opening there.
 */

export const at = (s: number, p: V3): V3 => [s * p[0], p[1], p[2]];
export const mirror = (s: number, pts: readonly V3[]): V3[] => pts.map((p) => at(s, p));

/** External acoustic meatus centreline, lateral end first (X, y, z). */
export const CANAL: readonly V3[] = [
  [0.0745, 0.001, -0.0005],
  [0.066, 0.0005, 0.0004],
  [0.056, -0.001, 0.0012],
  [0.0485, -0.002, 0.0015],
];
/** Centre of the tympanic membrane, which closes the canal's inner end. */
export const TM_CENTRE: V3 = [0.0478, -0.002, 0.0015];
/** Tympanic cavity: centre and radii (medial wall at X 0.0404). */
export const CAVITY_C: V3 = [0.0441, -0.0018, 0.0012];
export const CAVITY_R: V3 = [0.0037, 0.0056, 0.0056];
export const RECESS_C: V3 = [0.0443, 0.0045, 0.0];
export const RECESS_R: V3 = [0.0032, 0.0026, 0.0036];
export const ANTRUM_C: V3 = [0.044, 0.005, -0.0075];
export const ANTRUM_R: V3 = [0.0024, 0.0022, 0.003];
export const MASTOID_C: V3 = [0.05, -0.003, -0.0125];
export const MASTOID_R: V3 = [0.0075, 0.0085, 0.0055];
/** Oval and round windows on the medial wall of the cavity. */
export const OVAL_C: V3 = [0.0404, -0.0013, -0.003];
export const ROUND_C: V3 = [0.0405, -0.005, -0.0012];
/** Vestibule centre and radii; utricle behind and above, saccule in front and below. */
export const VEST_C: V3 = [0.0372, 0.0008, -0.0032];
export const VEST_R: V3 = [0.0033, 0.0034, 0.0036];
export const UTRICLE_C: V3 = [0.0366, 0.0028, -0.004];
export const SACCULE_C: V3 = [0.0372, -0.0016, -0.0008];
/** Pharyngotympanic tube, tympanic end first. */
export const TUBE: readonly V3[] = [
  [0.043, -0.0035, 0.006],
  [0.036, -0.005, 0.0085],
  [0.027, -0.0075, 0.008],
  [0.019, -0.0095, 0.0072],
  [0.012, -0.011, 0.0062],
];
/** Internal acoustic meatus, medial (brain) end first. */
export const IAM: readonly V3[] = [
  [0.0255, 0.002, -0.001],
  [0.0295, 0.0024, -0.0003],
  [0.0335, 0.0028, 0.0005],
];
/** Facial nerve, from the internal acoustic meatus round the cavity to the stylomastoid end. */
export const FACIAL: readonly V3[] = [
  [0.0255, 0.0015, -0.0005],
  [0.0335, 0.006, 0.0065],
  [0.04, 0.0045, 0.001],
  [0.0412, 0.004, -0.0045],
  [0.0412, -0.001, -0.0072],
  [0.041, -0.007, -0.0085],
  [0.0405, -0.0115, -0.0085],
];
/** Endolymphatic duct (from the vestibule) and the sac on the back of the petrous bone. */
export const ENDO_DUCT: readonly V3[] = [
  [0.035, 0.002, -0.006],
  [0.0325, 0.0035, -0.009],
  [0.03, 0.003, -0.0125],
];
export const ENDO_SAC_C: V3 = [0.029, 0.0028, -0.0135];

/* ----------------------------------------------------------------- the cochlea */

const COCHLEA_BASE: V3 = [0.0372, -0.004, 0.0015];
const COCHLEA_APEX: V3 = [0.038, -0.0075, 0.0125];
/** Turns of the bony cochlea (Gray's): a drawing of the count, not a measurement of any ear. */
export const COCHLEA_TURNS = 2.75;
const COCHLEA_R0 = 0.003;
const COCHLEA_TAPER = 0.72;
const COCHLEA_TUBE_R0 = 0.00115;

export interface CochleaFrame {
  /** Centre of the cochlear tube at t (0 at the base, 1 at the apex). */
  c: V3;
  /** Unit vector from the modiolus outward through the tube centre. */
  n: V3;
  /** Unit vector along the modiolus, base to apex. */
  a: V3;
  /** Radius of the whole bony tube at t. */
  r: number;
  /** Radius of the coil (distance of the tube centre from the modiolus). */
  coil: number;
}

const unit = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

const AXIS = unit([COCHLEA_APEX[0] - COCHLEA_BASE[0], COCHLEA_APEX[1] - COCHLEA_BASE[1], COCHLEA_APEX[2] - COCHLEA_BASE[2]]);
const AXIS_LEN = Math.hypot(COCHLEA_APEX[0] - COCHLEA_BASE[0], COCHLEA_APEX[1] - COCHLEA_BASE[1], COCHLEA_APEX[2] - COCHLEA_BASE[2]);
const U = unit(cross(AXIS, [0, 1, 0]));
const W = unit(cross(AXIS, U));

/** The cochlea's frame at t, for the RIGHT ear. */
export function cochleaAt(t: number): CochleaFrame {
  const theta = Math.PI * 2 * COCHLEA_TURNS * t;
  const coil = COCHLEA_R0 * (1 - COCHLEA_TAPER * t);
  const n: V3 = [
    U[0] * Math.cos(theta) + W[0] * Math.sin(theta),
    U[1] * Math.cos(theta) + W[1] * Math.sin(theta),
    U[2] * Math.cos(theta) + W[2] * Math.sin(theta),
  ];
  const h = AXIS_LEN * t;
  return {
    c: [COCHLEA_BASE[0] + AXIS[0] * h + n[0] * coil, COCHLEA_BASE[1] + AXIS[1] * h + n[1] * coil, COCHLEA_BASE[2] + AXIS[2] * h + n[2] * coil],
    n,
    a: AXIS,
    r: COCHLEA_TUBE_R0 * (1 - 0.5 * t),
    coil,
  };
}

/** A point on the cochlea at t, offset `radial` along n and `axial` along the modiolus. */
export function cochleaPoint(t: number, radial: number, axial: number): V3 {
  const f = cochleaAt(t);
  return [f.c[0] + f.n[0] * radial + f.a[0] * axial, f.c[1] + f.n[1] * radial + f.a[1] * axial, f.c[2] + f.n[2] * radial + f.a[2] * axial];
}

/** The modiolus, base to apex (the bony core the tube winds round). */
export const MODIOLUS: readonly V3[] = [
  [COCHLEA_BASE[0], COCHLEA_BASE[1], COCHLEA_BASE[2]],
  [COCHLEA_APEX[0] - AXIS[0] * 0.0005, COCHLEA_APEX[1] - AXIS[1] * 0.0005, COCHLEA_APEX[2] - AXIS[2] * 0.0005],
];

/** Sample the helix at `n + 1` evenly spaced t, each point offset as `cochleaPoint` does. */
export function cochleaRail(n: number, radial: (t: number) => number, axial: (t: number) => number, t0 = 0, t1 = 1): V3[] {
  const out: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    out.push(cochleaPoint(t, radial(t), axial(t)));
  }
  return out;
}

/* ------------------------------------------------------ the semicircular canals */

export type CanalName = 'anterior' | 'posterior' | 'lateral';

export interface CanalLoop {
  centre: V3;
  /** Two unit vectors spanning the plane of the loop. */
  p: V3;
  q: V3;
  radius: number;
  /** The arc runs from phi0 to phi1 (radians) in the (p, q) plane. */
  phi0: number;
  phi1: number;
  /** Which end of the arc carries the ampulla. */
  ampullaAtStart: boolean;
}

const DEG = Math.PI / 180;
const V = VEST_C;
const SIN45 = Math.SQRT1_2;
/**
 * Three roughly perpendicular loops. The anterior and posterior canals are vertical and lie
 * in planes at right angles to each other, 45 degrees to the sagittal plane; the lateral
 * canal is near horizontal. Each is a 300 degree arc whose gap sits against the vestibule,
 * where it opens into it. Tilt of the lateral canal is left out: a drawing choice.
 */
export const CANALS: Record<CanalName, CanalLoop> = {
  anterior: {
    centre: [V[0] + SIN45 * 0.001, V[1] + 0.0033, V[2] + SIN45 * 0.001],
    p: [SIN45, 0, SIN45],
    q: [0, 1, 0],
    radius: 0.0027,
    phi0: -60 * DEG,
    phi1: 240 * DEG,
    ampullaAtStart: true,
  },
  posterior: {
    centre: [V[0], V[1] + 0.0014, V[2] - 0.003],
    p: [SIN45, 0, -SIN45],
    q: [0, 1, 0],
    radius: 0.0027,
    phi0: -60 * DEG,
    phi1: 240 * DEG,
    ampullaAtStart: false,
  },
  lateral: {
    centre: [0.0382, 0.0013, -0.009],
    p: [1, 0, 0],
    q: [0, 0, 1],
    radius: 0.0022,
    phi0: 120 * DEG,
    phi1: 420 * DEG,
    ampullaAtStart: false,
  },
};

/** A point on a loop at fraction f of the arc (0 start, 1 end), radius scaled by `k`. */
export function canalPoint(loop: CanalLoop, f: number, k = 1): V3 {
  const phi = loop.phi0 + (loop.phi1 - loop.phi0) * f;
  const cp = Math.cos(phi) * loop.radius * k;
  const sp = Math.sin(phi) * loop.radius * k;
  return [
    loop.centre[0] + loop.p[0] * cp + loop.q[0] * sp,
    loop.centre[1] + loop.p[1] * cp + loop.q[1] * sp,
    loop.centre[2] + loop.p[2] * cp + loop.q[2] * sp,
  ];
}

export function canalPath(loop: CanalLoop, n = 14, k = 1): V3[] {
  const out: V3[] = [];
  for (let i = 0; i <= n; i++) out.push(canalPoint(loop, i / n, k));
  return out;
}

/** The ampulla: the dilated end of a canal that carries the sense organ. */
export function ampullaCentre(loop: CanalLoop): V3 {
  return canalPoint(loop, loop.ampullaAtStart ? 0.04 : 0.96);
}

function ball(c: V3, r: V3, w = 10, h = 7): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(r[0], r[1], r[2]);
  g.translate(c[0], c[1], c[2]);
  return g;
}

/**
 * The shell. One ear is a merge of primitives (a swept canal, ellipsoids for the cavity,
 * mastoid and vestibule, a helical tube for the cochlea, three arcs for the canals and the
 * auditory tube); the silhouette does not need the smooth blending the other shells use, and
 * merged tubes cost far fewer triangles than a marching-cubes surface of a coil.
 */
export function ears(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    const m = (p: V3) => at(s, p);
    const ell = (c: V3, r: V3) => ball(m(c), r);
    parts.push(tubeAlong(mirror(s, CANAL), () => 0.0036, { tubular: 14, radial: 8 }));
    parts.push(ell(CAVITY_C, [CAVITY_R[0] + 0.0006, CAVITY_R[1] + 0.0008, CAVITY_R[2] + 0.0008]));
    parts.push(ell(RECESS_C, [RECESS_R[0] + 0.0006, RECESS_R[1] + 0.0006, RECESS_R[2] + 0.0006]));
    parts.push(ell(ANTRUM_C, [ANTRUM_R[0] + 0.0006, ANTRUM_R[1] + 0.0006, ANTRUM_R[2] + 0.0006]));
    parts.push(ell(MASTOID_C, MASTOID_R));
    parts.push(ell(VEST_C, [VEST_R[0] + 0.0006, VEST_R[1] + 0.0006, VEST_R[2] + 0.0006]));
    parts.push(tubeAlong(mirror(s, TUBE), () => 0.002, { tubular: 14, radial: 6 }));
    parts.push(tubeAlong(mirror(s, IAM), () => 0.0019, { tubular: 6, radial: 6 }));
    parts.push(tubeAlong(mirror(s, ENDO_DUCT), () => 0.0009, { tubular: 6, radial: 5 }));
    parts.push(ell(ENDO_SAC_C, [0.0019, 0.0012, 0.0032]));
    parts.push(
      tubeAlong(mirror(s, cochleaRail(40, () => 0, () => 0)), (t) => COCHLEA_TUBE_R0 * (1 - 0.5 * t) + 0.0003, { tubular: 48, radial: 5 }),
    );
    for (const name of ['anterior', 'posterior', 'lateral'] as const) {
      const loop = CANALS[name];
      parts.push(tubeAlong(mirror(s, canalPath(loop, 16)), () => 0.001, { tubular: 20, radial: 4 }));
      parts.push(ball(m(ampullaCentre(loop)), [0.0016, 0.0016, 0.0016], 8, 6));
    }
  }
  return mergeParts(parts);
}
