import * as THREE from 'three';
import type { PartBuilder, PartGeometry } from '../parts';
import { warpPoint } from '../layout';
import { mergeParts, tubeAlong, type V3 } from '../sdf';
import { mulberry32 } from '../noise';
import { beads, cord, ribbon as sheet } from './gland_shared';
import { blob } from './gi_shared';

/**
 * THE INSIDE OF THE PHARYNX: wall, muscles, openings, recesses and the ring of tonsils.
 *
 * AN AXIAL ORGAN, DRAWN IN SCENE COORDINATES. The shell (shells/pharynx.ts) is authored in
 * unexploded body coordinates and bent by `warpGeometry`, because it must meet the
 * oesophagus after the head has been lifted away from the neck. Between body y 0.385 and
 * 0.405 that warp stretches 2 cm into 8 cm. If the parts were drawn in body coordinates and
 * warped like the shell, a 1 mm ridge there would become a 4 mm ridge, so a muscle sheet, a
 * ring and a tonsil would each come out four times too tall. Instead the shell's own
 * CENTRELINE is warped once (`CENTRE`, sampled by arc length exactly as the shell's rings
 * are) and every structure is placed on that line in SCENE metres with the shell's own
 * radius profile (`radiusAt`). The levels (laryngo-, oro-, nasopharynx) are cut at scene
 * heights, which is where the mouth and the nose are, not at body heights.
 *
 * WHAT IS AND IS NOT ANATOMY. The textbook order is followed (constrictors overlapping from
 * below upward on the outside, the raphe at the back, the auditory tube openings in the side
 * wall of the nasopharynx, the tonsils in a ring); the levels' heights are chosen against
 * the mouth shell (its floor at scene y 0.368, its roof 0.392) and the shell's own top at
 * about 0.45. Sizes, counts and the shape of recesses are drawing choices. The enlarged
 * tonsil section is a magnified diagram floating in the lumen, not at true size or place.
 *
 * KNOWN MISMATCH, NOT FIXED HERE. The shell's centreline lies at scene z -0.014 to -0.008,
 * while the mouth's cavity ends at z 0.015, so a gap of about 2 cm separates the fauces from
 * the oropharynx's front wall. The shells' positions belong to the orchestrator; the atlas
 * draws the openings on the pharynx's own front wall.
 */

const PATH: V3[] = [
  [0.002, 0.37, -0.014],
  [0.002, 0.381, -0.012],
  [0.001, 0.392, -0.01],
  [0, 0.4, -0.008],
];
const CURVE = new THREE.CatmullRomCurve3(PATH.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', 0.5);
const SAMPLES = 160;
/** The shell's centreline after the axial warp, by arc length. */
const CENTRE: V3[] = [];
for (let i = 0; i <= SAMPLES; i++) {
  const p = CURVE.getPointAt(i / SAMPLES);
  CENTRE.push(warpPoint([p.x, p.y, p.z]));
}
/** The shell's radius profile (shells/pharynx.ts). */
const radiusAt = (t: number): number => 0.0075 + 0.0045 * Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5);

/** Centre of the lumen at arc fraction t. */
function cs(t: number): V3 {
  const f = Math.max(0, Math.min(1, t)) * SAMPLES;
  const i = Math.min(SAMPLES - 1, Math.floor(f));
  const u = f - i;
  const a = CENTRE[i];
  const b = CENTRE[i + 1];
  return [a[0] + u * (b[0] - a[0]), a[1] + u * (b[1] - a[1]), a[2] + u * (b[2] - a[2])];
}
/** Arc fraction at scene height y (the centreline rises monotonically). */
export function tOfY(y: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (cs(mid)[1] < y) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
/** The centre of the lumen at a scene height. */
export function centreAt(y: number): V3 {
  return cs(tOfY(y));
}
/** A point at scene height y on the wall at angle `theta` (0 behind, +90 degrees the patient's right, 180 in front), at `k` of the radius. */
function wall(y: number, thetaDeg: number, k: number): V3 {
  const t = tOfY(y);
  const c = cs(t);
  const r = radiusAt(t) * k;
  const th = (thetaDeg * Math.PI) / 180;
  return [c[0] + r * Math.sin(th), c[1], c[2] - r * Math.cos(th)];
}
/** A point on the front wall at height y and sideways offset x, at `k` of the radius. */
function front(y: number, x: number, k: number): V3 {
  const t = tOfY(y);
  const c = cs(t);
  const r = radiusAt(t) * k;
  return [c[0] + x, y, c[2] + Math.sqrt(Math.max(0, r * r - x * x))];
}

/** Scene heights of the level boundaries and of the named landmarks (display choices against the mouth shell). */
const Y_BOTTOM = 0.37;
const Y_HYOID = 0.376;
const Y_PALATE = 0.392;
const Y_TOP = 0.4505;
/** The three muscle sheets: [bottom, top, fraction of the wall radius]. The lowest is outermost. */
export const CONSTRICTORS = {
  inferior: [0.37, 0.384, 0.975],
  middle: [0.38, 0.4, 0.965],
  superior: [0.396, 0.428, 0.955],
} as const;
export type ConstrictorId = keyof typeof CONSTRICTORS;
/** Where each sheet's axis is, for the squeeze in the detail module: [x, y, z] at mid-height. */
export function constrictorPivot(id: ConstrictorId): V3 {
  const [y0, y1] = CONSTRICTORS[id];
  return cs(tOfY((y0 + y1) / 2));
}

/* --------------------------------------------------------------------- builders */

const merge = (g: THREE.BufferGeometry[]): THREE.BufferGeometry => mergeParts(g);

/** A tube round the centreline between two heights, at a fraction of the wall radius: a level of the pharynx as glass. */
function segment(y0: number, y1: number, k: number): THREE.BufferGeometry {
  const t0 = tOfY(y0);
  const t1 = tOfY(y1);
  const pts: V3[] = [];
  const n = 8;
  for (let i = 0; i <= n; i++) pts.push(cs(t0 + ((t1 - t0) * i) / n));
  return tubeAlong(pts, (u) => radiusAt(t0 + (t1 - t0) * u) * k, { tubular: 18, radial: 14 });
}
/** A curved muscle sheet wrapping the back and sides of the wall, from `-span` to `+span` degrees about the back. */
function constrictor(id: ConstrictorId, span = 118): THREE.BufferGeometry {
  const [y0, y1, k] = CONSTRICTORS[id];
  const rows: V3[][] = [];
  for (let i = 0; i <= 5; i++) {
    const y = y0 + ((y1 - y0) * i) / 5;
    const r: V3[] = [];
    for (let j = 0; j <= 14; j++) r.push(wall(y, -span + (2 * span * j) / 14, k));
    rows.push(r);
  }
  return sheet(rows, 0.0007);
}
/** A cord running down the wall through (height, angle) waypoints, at a fraction of the radius. */
function runDown(pts: readonly [number, number][], k: number, r: number, mirror = true): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const s of mirror ? [1, -1] : [1]) parts.push(cord(pts.map(([y, th]) => wall(y, s * th, k)), r, 14, 4));
  return merge(parts);
}
function ringAround(y: number, k: number, r: number): THREE.BufferGeometry {
  const pts: V3[] = [];
  for (let i = 0; i < 16; i++) pts.push(wall(y, (i / 16) * 360, k));
  return tubeAlong(pts, () => r, { tubular: 32, radial: 5, closed: true });
}
/** An oval ring standing on the front wall (facing forward), `sx` and `sy` stretching it. */
function frontOval(c: V3, major: number, minor: number, sx: number, sy: number): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(major, minor, 4, 14);
  g.scale(sx, sy, 1);
  g.translate(c[0], c[1], c[2]);
  return g;
}
/** An oval ring standing on the side wall (facing sideways). */
function sideOval(c: V3, major: number, minor: number, sy: number): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(major, minor, 4, 12);
  g.scale(1, sy, 1);
  g.rotateY(Math.PI / 2);
  g.translate(c[0], c[1], c[2]);
  return g;
}

/**
 * WHERE THE AUDITORY TUBES MEET THE PHARYNX. The ears shell (shells/ears.ts, written by agent
 * hn2) ends each pharyngotympanic tube at scene (+-0.012, 0.435, -0.006); its header says the
 * tubal opening is drawn here. So the opening's centre is that exact point, not a point
 * worked out from this shell's wall, and the tube meets the nasopharynx with no gap at the
 * opening itself. Both sides are symmetric, so the sign of x does not matter.
 */
const TUBE_END: V3 = [0.012, 0.435, -0.006];
const tubeEnd = (s: number): V3 => [s * TUBE_END[0], TUBE_END[1], TUBE_END[2]];
function tubeOpenings(): THREE.BufferGeometry {
  return merge([1, -1].map((s) => sideOval(tubeEnd(s), 0.002, 0.0006, 1.6)));
}
/** The cushion of tubal cartilage: above and behind the opening, and a hair inside the wall. */
function torus(): THREE.BufferGeometry {
  return merge([1, -1].map((s) => {
    const e = tubeEnd(s);
    return blob([e[0] - s * 0.0006, e[1] + 0.0045, e[2] - 0.0025], [0.001, 0.0022, 0.0016], 8, 6);
  }));
}
function tubalTonsils(): THREE.BufferGeometry {
  return merge([1, -1].map((s) => {
    const e = tubeEnd(s);
    return blob([e[0] - s * 0.0010, e[1] - 0.0005, e[2] - 0.0045], [0.0012, 0.003, 0.0018], 8, 6);
  }));
}
function pharyngealTonsil(): THREE.BufferGeometry {
  const t = tOfY(0.442);
  const c = cs(t);
  const z = c[2] - radiusAt(t) * 0.86;
  return merge([-2, -1, 0, 1, 2].map((k) => blob([c[0] + k * 0.0025, 0.442, z], [0.0011, 0.006, 0.002], 8, 6)));
}
function palatineTonsils(): THREE.BufferGeometry {
  return merge([1, -1].map((s) => blob(wall(0.386, s * 82, 0.76), [0.0026, 0.0048, 0.0033], 10, 7)));
}
function lingualTonsil(): THREE.BufferGeometry {
  const rnd = mulberry32(31);
  const c: V3[] = [];
  for (let i = 0; i < 10; i++) c.push(front(0.378 + rnd() * 0.005, (rnd() * 2 - 1) * 0.0045, 0.9));
  return beads(c, 0.0012, 6, 4);
}

/** The magnified tonsil section: a dome in the middle of the nasopharynx's lumen (illustrative). */
const TS: V3 = (() => {
  const c = cs(tOfY(0.432));
  return [c[0], 0.432, c[2]];
})();
const TS_R: V3 = [0.005, 0.0045, 0.0042];
const tsDome = (x: number, z: number): number => TS[1] + TS_R[1] * Math.sqrt(Math.max(0, 1 - (x / TS_R[0]) ** 2 - (z / TS_R[2]) ** 2));
const FOLLICLES: V3[] = (() => {
  const rnd = mulberry32(47);
  const out: V3[] = [];
  for (let i = 0; i < 40 && out.length < 8; i++) {
    const x = (rnd() * 2 - 1) * 0.0032;
    const z = (rnd() * 2 - 1) * 0.0028;
    const y = tsDome(x, z) - 0.0016;
    if (y > TS[1] - 0.0012) out.push([TS[0] + x, y, TS[2] + z]);
  }
  return out;
})();

/* --------------------------------------------------------------------- build */

export const parts: PartBuilder = () => {
  const out: PartGeometry[] = [];
  const add = (id: string, geometry: THREE.BufferGeometry): void => {
    out.push({ id, geometry });
  };

  add('laryngopharynx', segment(Y_BOTTOM, Y_HYOID, 0.93));
  add('oropharynx', segment(Y_HYOID, Y_PALATE, 0.93));
  add('nasopharynx', segment(Y_PALATE, Y_TOP, 0.93));
  add('choanal_openings', merge([1, -1].map((s) => frontOval(front(0.422, s * 0.0045, 0.95), 0.0026, 0.0007, 0.8, 1.5))));
  add('isthmus_of_fauces', frontOval(front(0.385, 0, 0.95), 0.0045, 0.0008, 1.2, 0.8));
  add('laryngeal_inlet', frontOval(front(0.3735, 0, 0.93), 0.0028, 0.0007, 0.8, 1.3));

  for (const id of ['inferior', 'middle', 'superior'] as const) add(`${id}_constrictor`, constrictor(id));
  add('cricopharyngeus', ringAround(Y_BOTTOM + 0.0012, 0.96, 0.0012));

  const stylo = runDown([[0.436, 112], [0.42, 100], [0.404, 88], [0.392, 80]], 0.94, 0.0007);
  const salpingo = runDown([[0.433, 92], [0.412, 88], [0.395, 80]], 0.94, 0.0006);
  const palato = runDown([[0.396, 75], [0.386, 85], [0.376, 95]], 0.94, 0.0007);
  add('pharyngeal_longitudinal_muscles', merge([stylo.clone(), salpingo.clone(), palato.clone()]));
  add('stylopharyngeus', stylo);
  add('salpingopharyngeus', salpingo);
  add('palatopharyngeus', palato);

  add('pharyngeal_raphe', cord([0.372, 0.385, 0.4, 0.42, 0.44, 0.449].map((y) => wall(y, 0, 0.985)), 0.0004, 30, 4));
  add('auditory_tube_openings', tubeOpenings());
  add('torus_tubarius', torus());
  add('piriform_recesses', merge([1, -1].map((s) => {
    const t = tOfY(0.3745);
    const c = cs(t);
    return blob([c[0] + s * 0.0045, 0.3745, c[2] + 0.004], [0.0018, 0.004, 0.0024], 8, 6);
  })));
  add('epiglottic_valleculae', merge([1, -1].map((s) => blob(front(0.379, s * 0.0028, 0.88), [0.0022, 0.0018, 0.0015], 8, 6))));
  add('palatopharyngeal_arch', runDown([[0.396, 75], [0.386, 85], [0.376, 95]], 0.86, 0.0011));

  {
    const cords: THREE.BufferGeometry[] = [];
    for (const th of [35, 75]) for (const s of [1, -1]) cords.push(cord([0.372, 0.39, 0.41, 0.43, 0.445].map((y) => wall(y, s * th, 0.99)), 0.0003, 20, 4));
    for (const y of [0.378, 0.39, 0.405, 0.42]) cords.push(cord([-100, -50, 0, 50, 100].map((th) => wall(y, th, 0.99)), 0.0003, 20, 4));
    add('pharyngeal_plexus', merge(cords));
  }

  add('pharyngeal_tonsil', pharyngealTonsil());
  add('tubal_tonsils', tubalTonsils());
  add('palatine_tonsils', palatineTonsils());
  add('lingual_tonsil', lingualTonsil());
  add('waldeyers_ring', merge([pharyngealTonsil(), tubalTonsils(), palatineTonsils(), lingualTonsil()]));

  add('palatine_tonsil_section', blob(TS, TS_R, 14, 10));
  add('tonsillar_capsule', blob([TS[0], TS[1] - 0.0043, TS[2]], [0.0052, 0.0006, 0.0044], 12, 4));
  add('tonsillar_crypts', merge([[-0.002, 0.0006], [0.0004, -0.0008], [0.0022, 0.0012]].map(([x, z]) => cord([[TS[0] + x, tsDome(x, z) + 0.0002, TS[2] + z], [TS[0] + x * 0.8, tsDome(x, z) - 0.0014, TS[2] + z * 0.8], [TS[0] + x * 0.6, tsDome(x, z) - 0.0026, TS[2] + z * 0.6]], 0.0004, 8, 4))));
  add('lymphoid_follicles', beads(FOLLICLES, 0.0007, 8, 6));
  add('germinal_centres', beads(FOLLICLES, 0.00036, 6, 4));
  add('tonsil_surface_epithelium', blob(TS, [TS_R[0] * 1.06, TS_R[1] * 1.06, TS_R[2] * 1.06], 14, 10));
  return out;
};
