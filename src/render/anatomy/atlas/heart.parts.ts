import * as THREE from 'three';
import type { PartBuilder } from '../parts';
import {
  boundsOf,
  capsule,
  ellipsoid,
  halfSpace,
  intersect,
  mergeParts,
  offset,
  polygonise,
  smoothSubtract,
  smoothUnion,
  sphere,
  subtract,
  tubeAlong,
  union,
  type Sdf,
  type V3,
} from '../sdf';

/**
 * THE INSIDE OF THE HEART.
 *
 * The shell in models.ts (`heart()`) is the glass: the outer surface of the myocardium
 * with the great vessels grafted on. This file draws what that glass is full of - four
 * blood-filled chambers, the muscular septum between the ventricles, the four valves,
 * the lumens of the great vessels, the coronary arteries and the conduction system - all
 * in the shell's own frame (origin at the heart's centre, +x the patient's RIGHT, +y
 * towards the head, +z anterior, metres).
 *
 * HOW THE CHAMBERS ARE MADE. Each cavity is a signed-distance recipe at roughly 70 % of
 * the linear size of the matching lobe of the shell, so the gap between the cavity and the
 * glass reads as the myocardium (thick on the left ventricle, thin on the atria, as it
 * should be). The authored sizes are drawing proportions taken from the shell, not
 * measurements of anybody's heart; docs/MODEL_LIMITATIONS.md already says the whole organ
 * model is an adult-mean drawing.
 *
 * THE VALVES ARE PLANES. The first draft let the atrial and ventricular cavities overlap
 * and tried to find the valve in the overlap; the cavities then fused into one lump with
 * no visible orifice, which is exactly what a student must not be taught. So each valve
 * now owns a PLANE (a point and a unit normal, below). The cavity on one side is cut flat
 * at that plane (less a gap of 1.2 mm each way, which is where the valve disc sits) and the
 * cavity on the other side is cut flat on the other. The valve disc fills the gap, so a
 * CLOSED valve visibly separates two chambers and an OPEN one (the detail fades it) shows
 * blood passing through a real hole. The aortic and pulmonary valves use the same trick
 * between a ventricular outflow tract and the lumen of the great vessel above it.
 *
 * WHAT THIS IS NOT. The first version of this file left out the papillary muscles, chordae,
 * coronary sinus, fossa ovalis and trabeculae, on the reasoning that each would cost
 * triangles and fill the glass with clutter that hides the thing the viewer came to see,
 * which is the blood moving. Both halves of that were right and the conclusion was wrong:
 * a student opening a ventricle should be able to find its papillary muscles. They are now
 * LEVEL-2 PARTS (see "FINER STRUCTURES" below): they are built with the organ but shown only
 * when their parent is selected or the camera is close to it (reveal.ts), so they cost the
 * default view nothing. The leaflets of each valve are still flat wedges, and each cusp child
 * is a flat wedge laid on its parent's disc, not a curved cusp. The coronary arteries and the
 * Purkinje strands are centrelines hand-placed on the shell (snapped to its surface by a
 * probe, .cache/probes/heart_snap.ts, and then pasted here as numbers, because snapping at
 * run time would mean building the shell a second time inside the worker, which costs a
 * quarter of a second). Everything is deterministic: no Math.random anywhere.
 *
 * The centrelines and planes are exported because heart.detail.ts runs its blood streams
 * through exactly the same openings; keeping one copy is what stops a stream passing
 * through a wall the part geometry has drawn.
 */

/* ------------------------------------------------------------ small vector helpers */

function add(a: V3, b: V3, k = 1): V3 {
  return [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
}

function unit(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function lerp3(a: V3, b: V3, t: number): V3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/* --------------------------------------------------------------- valve planes */

export interface ValvePlane {
  /** Centre of the valve orifice. */
  readonly p: V3;
  /** Unit normal pointing in the direction blood travels through the valve. */
  readonly n: V3;
  /** Radius of the annulus the disc is drawn to, metres. */
  readonly r: number;
}

/** Right atrium -> right ventricle. Faces down, to the left and forward. */
export const TRICUSPID: ValvePlane = { p: [0.0215, 0.0072, 0.0088], n: unit([-0.5, -0.72, 0.48]), r: 0.0105 };
/** Left atrium -> left ventricle. Faces down and forward. */
export const MITRAL: ValvePlane = { p: [-0.0113, 0.0252, -0.0185], n: unit([0.05, -0.76, 0.65]), r: 0.0095 };
/** Right ventricular outflow tract -> pulmonary trunk, along the start of the trunk's centreline. */
export const PULMONIC: ValvePlane = { p: [-0.0122, 0.0315, 0.0196], n: unit([-0.08, 0.95, -0.32]), r: 0.0092 };
/** Left ventricular outflow tract -> ascending aorta, along the start of the aorta's centreline. */
export const AORTIC: ValvePlane = { p: [-0.0015, 0.0325, 0.0022], n: unit([0.27, 0.96, -0.07]), r: 0.0092 };

/** The thickness of the gap each valve disc sits in, metres (the disc is thinner than this). */
const GAP = 0.0012;

/** The part of space on the upstream side of a valve, stopping `GAP` short of its plane. */
function upstream(v: ValvePlane): Sdf {
  return halfSpace(add(v.p, v.n, -GAP), [-v.n[0], -v.n[1], -v.n[2]]);
}

/** The part of space on the downstream side of a valve, starting `GAP` beyond its plane. */
function downstream(v: ValvePlane): Sdf {
  return halfSpace(add(v.p, v.n, GAP), v.n);
}

/* ----------------------------------------------------------- ventricular axes */

/** Left ventricular cavity axis: base (just under the mitral plane) to apex, and its radii. */
const LV_A: V3 = [-0.0104, 0.0111, -0.0065];
const LV_B: V3 = [-0.043, -0.05, 0.011];
const LV_RA = 0.0215;
const LV_RB = 0.0085;

/** Right ventricular cavity axis, base (just beyond the tricuspid plane) to apex. */
const RV_A: V3 = [0.0143, -0.0033, 0.0158];
const RV_B: V3 = [-0.026, -0.044, 0.026];
const RV_RA = 0.019;
const RV_RB = 0.0075;

/** Thickness of the interventricular septum, metres, as drawn. */
const SEPTUM = 0.0065;

function lvCentre(t: number): V3 {
  return lerp3(LV_A, LV_B, t);
}
function lvRadius(t: number): number {
  return LV_RA + (LV_RB - LV_RA) * t;
}
function rvCentre(t: number): V3 {
  return lerp3(RV_A, RV_B, t);
}
function rvRadius(t: number): number {
  return RV_RA + (RV_RB - RV_RA) * t;
}

/** Unit vector, perpendicular to the left ventricular axis, from it towards the right ventricle. */
function septalNormal(t: number): V3 {
  const d = unit([LV_B[0] - LV_A[0], LV_B[1] - LV_A[1], LV_B[2] - LV_A[2]]);
  const c = lvCentre(t);
  const r = rvCentre(t);
  const toRv: V3 = [r[0] - c[0], r[1] - c[1], r[2] - c[2]];
  const along = dot(toRv, d);
  return unit([toRv[0] - d[0] * along, toRv[1] - d[1] * along, toRv[2] - d[2] * along]);
}

/** A point on the left ventricular wall at axis fraction `t`, angle `phi` round the axis from the septum. */
function lvWallPoint(t: number, phi: number, inset: number): V3 {
  const d = unit([LV_B[0] - LV_A[0], LV_B[1] - LV_A[1], LV_B[2] - LV_A[2]]);
  const n = septalNormal(t);
  const m = cross(d, n);
  const c = lvCentre(t);
  const r = lvRadius(t) + inset;
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  return [c[0] + r * (cp * n[0] + sp * m[0]), c[1] + r * (cp * n[1] + sp * m[1]), c[2] + r * (cp * n[2] + sp * m[2])];
}

/** A point on the right ventricular free wall (the side away from the septum) at fraction `t`. */
function rvFreeWallPoint(t: number, phi: number, inset: number): V3 {
  const d = unit([RV_B[0] - RV_A[0], RV_B[1] - RV_A[1], RV_B[2] - RV_A[2]]);
  const n = septalNormal(t);
  const m = cross(d, n);
  const c = rvCentre(t);
  const r = rvRadius(t) - inset;
  // Away from the septum is -n; phi swings the point round the axis from there.
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  return [c[0] + r * (-cp * n[0] + sp * m[0]), c[1] + r * (-cp * n[1] + sp * m[1]), c[2] + r * (-cp * n[2] + sp * m[2])];
}

/* ------------------------------------------------------------------- cavities */

export interface HeartCavities {
  ra: Sdf;
  rv: Sdf;
  la: Sdf;
  lv: Sdf;
  /** The two ventricular cavities before the septum was carved: for the septum itself. */
  lvFull: Sdf;
  rvFull: Sdf;
}

/** The four blood-filled cavities, as fields. Exported so the probe can test paths against them. */
export function heartCavities(): HeartCavities {
  // Left ventricle: the elongated cone to the apex plus its outflow tract up to the aortic valve.
  const lvFull = capsule(LV_A, LV_B, LV_RA, LV_RB);
  const lvOutflow = intersect(
    capsule([-0.008, 0.015, -0.005], [-0.0025, 0.0305, 0.0016], 0.011, 0.0095),
    upstream(AORTIC),
  );
  const lvBody = intersect(lvFull, downstream(MITRAL));
  const lv = smoothUnion(0.004, lvBody, lvOutflow);

  // Right ventricle: carved away from the left so a septum fits between, plus the
  // infundibulum (outflow tract) that carries it up and to the left to the pulmonary valve.
  const rvFull = capsule(RV_A, RV_B, RV_RA, RV_RB);
  const rvBody = intersect(subtract(rvFull, offset(lvFull, SEPTUM)), downstream(TRICUSPID));
  const rvOutflow = intersect(
    capsule([0.01, 0.004, 0.018], [-0.0118, 0.0295, 0.0202], 0.011, 0.0095),
    intersect(upstream(PULMONIC), downstream(TRICUSPID)),
  );
  const rv = smoothUnion(0.004, rvBody, rvOutflow);

  // Atria: about 70 % of the shell's lobes, each with a funnel to its atrioventricular valve.
  const raBody = ellipsoid([0.03, 0.022, 0.0], [0.014, 0.019, 0.0154]);
  const raFunnel = capsule([0.03, 0.022, 0.0], add(TRICUSPID.p, TRICUSPID.n, -0.002), 0.0095, 0.0095);
  const ra = intersect(smoothUnion(0.004, raBody, raFunnel), upstream(TRICUSPID));

  const laBody = ellipsoid([-0.012, 0.036, -0.028], [0.0182, 0.014, 0.0119]);
  const laFunnel = capsule([-0.012, 0.034, -0.027], add(MITRAL.p, MITRAL.n, -0.002), 0.0085, 0.0085);
  const la = intersect(smoothUnion(0.004, laBody, laFunnel), upstream(MITRAL));

  return { ra, rv, la, lv, lvFull, rvFull };
}

/* -------------------------------------------------------------- centrelines */

/** The lumens of the great vessels, and the paths the blood streams follow. */
export const HEART_PATHS = {
  aorta: [[-0.0005, 0.034, 0.0018], [0.006, 0.058, 0.0], [0.014, 0.082, -0.008]] as V3[],
  pulmonaryTrunk: [[-0.0125, 0.0332, 0.0189], [-0.014, 0.054, 0.012], [-0.01, 0.07, -0.006]] as V3[],
  svc: [[0.036, 0.088, -0.013], [0.035, 0.062, -0.008], [0.034, 0.04, -0.004], [0.032, 0.028, -0.001]] as V3[],
  ivc: [[0.03, -0.022, -0.019], [0.03, -0.006, -0.015], [0.03, 0.008, -0.01], [0.03, 0.016, -0.004]] as V3[],
  /** Left upper, left lower, right upper, right lower. Outer end first, then into the left atrium. */
  pulmonaryVeins: [
    [[-0.054, 0.046, -0.0355], [-0.038, 0.042, -0.034], [-0.024, 0.039, -0.031]],
    [[-0.054, 0.03, -0.0395], [-0.038, 0.032, -0.036], [-0.024, 0.033, -0.031]],
    [[0.044, 0.046, -0.0395], [0.026, 0.042, -0.036], [0.006, 0.039, -0.031]],
    [[0.044, 0.03, -0.0415], [0.026, 0.032, -0.037], [0.006, 0.033, -0.031]],
  ] as V3[][],
  /** Left main, then the two branches that continue from its end. Snapped to the shell, 1.8 mm under it. */
  leftMain: [[-0.006, 0.032, 0.01], [-0.016, 0.034, 0.017], [-0.0232, 0.031, 0.0197]] as V3[],
  lad: [
    [-0.0232, 0.031, 0.0197],
    [-0.0106, 0.0226, 0.0293],
    [-0.0123, 0.0068, 0.0281],
    [-0.0214, -0.0082, 0.0267],
    [-0.0277, -0.023, 0.026],
    [-0.0333, -0.0412, 0.0255],
    [-0.0397, -0.0505, 0.0254],
  ] as V3[],
  circumflex: [
    [-0.0232, 0.031, 0.0197],
    [-0.0343, 0.0316, 0.0079],
    [-0.0422, 0.0287, 0.0009],
    [-0.0358, 0.0216, -0.0108],
    [-0.0309, 0.0161, -0.025],
    [-0.0211, 0.0104, -0.0327],
  ] as V3[],
  rca: [
    [0.002, 0.034, 0.01],
    [0.0065, 0.0345, 0.0225],
    [0.0112, 0.0329, 0.031],
    [0.0315, 0.0159, 0.0299],
    [0.0391, 0.0049, 0.0122],
    [0.038, -0.0005, 0.0009],
    [0.0386, -0.0079, -0.0143],
    [0.0292, -0.0085, -0.0248],
  ] as V3[],
};

/**
 * The blood streams, as centrelines through the cavities and valve centres. Each passes
 * through the real orifice it claims to: `ra_to_rv` through the tricuspid plane and so on.
 */
export const HEART_STREAMS = {
  svcIn: HEART_PATHS.svc,
  ivcIn: HEART_PATHS.ivc,
  raToRv: [
    [0.03, 0.024, 0.0],
    [0.0265, 0.015, 0.004],
    TRICUSPID.p,
    [0.0125, -0.0085, 0.0145],
    [-0.004, -0.026, 0.021],
  ] as V3[],
  rvToPulm: [
    [-0.012, -0.024, 0.024],
    [0.0, -0.004, 0.02],
    [-0.0062, 0.016, 0.0195],
    PULMONIC.p,
    [-0.014, 0.054, 0.012],
    [-0.0105, 0.069, -0.005],
  ] as V3[],
  laToLv: [
    [-0.012, 0.034, -0.027],
    [-0.0116, 0.0295, -0.0225],
    MITRAL.p,
    [-0.0155, 0.01, -0.007],
    [-0.028, -0.014, 0.003],
  ] as V3[],
  lvToAorta: [
    [-0.024, -0.008, 0.002],
    [-0.0135, 0.008, -0.0035],
    [-0.0062, 0.0225, -0.0005],
    AORTIC.p,
    [0.006, 0.058, 0.0],
    [0.0135, 0.081, -0.008],
  ] as V3[],
};

/* ------------------------------------------------------------ valve geometry */

/**
 * A valve: the annulus ring plus its leaflets, drawn as thin wedges of a disc with narrow
 * gaps between them (the commissures). Three cusps for the tricuspid and the two semilunar
 * valves, two for the mitral. Oriented so the disc's face is perpendicular to the flow.
 */
function valveGeometry(v: ValvePlane, cusps: number): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = [];
  const ring = new THREE.TorusGeometry(v.r, 0.0009, 6, 28);
  // TorusGeometry lies in the XY plane (axis +Z); the leaflets (cylinders) have axis +Y.
  // Rotate the ring so its axis is also +Y before the common orientation below.
  ring.rotateX(Math.PI / 2);
  pieces.push(ring);
  const gapAngle = 0.28;
  const span = (Math.PI * 2) / cusps - gapAngle;
  for (let i = 0; i < cusps; i++) {
    const start = (i * Math.PI * 2) / cusps + gapAngle / 2;
    pieces.push(new THREE.CylinderGeometry(v.r * 0.96, v.r * 0.96, 0.0008, 12, 1, false, start, span));
  }
  const g = mergeParts(pieces);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(v.n[0], v.n[1], v.n[2]));
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(v.p[0], v.p[1], v.p[2]), q, new THREE.Vector3(1, 1, 1)));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/* --------------------------------------------------------------- the builder */

const tube = (pts: readonly V3[], radius: number, tubular: number, radial = 6): THREE.BufferGeometry =>
  tubeAlong(pts, () => radius, { tubular, radial });

export const parts: PartBuilder = () => {
  const c = heartCavities();
  const out: { id: string; geometry: THREE.BufferGeometry }[] = [];
  // Children are built here, with their organ, and revealed by the renderer: see below.
  const finer = (): void => {
    for (const x of finerStructures(c)) out.push(x);
  };

  // Chambers. Cell sizes are about 1/35 of the part: the ventricles are ~70 mm long.
  out.push({
    id: 'right_atrium',
    geometry: polygonise(c.ra, [0.006, -0.004, -0.024], [0.054, 0.052, 0.026], { cell: 0.0026 }),
  });
  out.push({
    id: 'right_ventricle',
    geometry: polygonise(c.rv, [-0.044, -0.06, -0.002], [0.032, 0.042, 0.042], { cell: 0.0027 }),
  });
  out.push({
    id: 'left_atrium',
    geometry: polygonise(c.la, [-0.036, 0.012, -0.046], [0.014, 0.056, -0.004], { cell: 0.0026 }),
  });
  out.push({
    id: 'left_ventricle',
    geometry: polygonise(c.lv, [-0.06, -0.066, -0.026], [0.014, 0.038, 0.032], { cell: 0.0027 }),
  });

  // Septum: the layer of left ventricular wall that faces the right ventricle - the
  // 6.5 mm shell round the left cavity, kept only within reach of the right cavity.
  const wall = subtract(offset(c.lvFull, SEPTUM), c.lvFull);
  const nearRv = offset(c.rvFull, 0.0075);
  const septum = intersect(intersect(wall, nearRv), downstream(TRICUSPID));
  out.push({
    id: 'interventricular_septum',
    geometry: polygonise(septum, [-0.05, -0.062, -0.016], [0.022, 0.032, 0.032], { cell: 0.0026 }),
  });

  // Valves.
  out.push({ id: 'tricuspid_valve', geometry: valveGeometry(TRICUSPID, 3) });
  out.push({ id: 'mitral_valve', geometry: valveGeometry(MITRAL, 2) });
  out.push({ id: 'pulmonary_valve', geometry: valveGeometry(PULMONIC, 3) });
  out.push({ id: 'aortic_valve', geometry: valveGeometry(AORTIC, 3) });

  // Great vessels: lumens inside the shell's stubs (the shell is 13.8, 12.8, 9.2, 10.5 and
  // 5.5 mm in radius; the lumens are about 70 % of those, matching the chambers).
  out.push({ id: 'aorta', geometry: tube(HEART_PATHS.aorta, 0.0095, 28, 14) });
  out.push({ id: 'pulmonary_trunk', geometry: tube(HEART_PATHS.pulmonaryTrunk, 0.009, 28, 14) });
  out.push({
    id: 'venae_cavae',
    geometry: mergeParts([tube(HEART_PATHS.svc, 0.0068, 24, 12), tube(HEART_PATHS.ivc, 0.0078, 20, 12)]),
  });
  out.push({
    id: 'pulmonary_veins',
    geometry: mergeParts(HEART_PATHS.pulmonaryVeins.map((p) => tube(p, 0.0038, 14, 8))),
  });

  // Coronary arteries: fine tubes just under the shell, tapering a little towards their ends.
  const taper = (r0: number, r1: number) => (t: number) => r0 + (r1 - r0) * t;
  const fine = (pts: readonly V3[], r0: number, r1: number, tubular: number) => {
    const f = taper(r0, r1);
    return tubeAlong(pts, (t) => f(t), { tubular, radial: 6 });
  };
  out.push({
    id: 'coronary_arteries',
    geometry: mergeParts([
      fine(HEART_PATHS.leftMain, 0.0018, 0.0016, 12),
      fine(HEART_PATHS.lad, 0.0015, 0.0007, 40),
      fine(HEART_PATHS.circumflex, 0.0014, 0.0007, 32),
      fine(HEART_PATHS.rca, 0.0015, 0.0007, 40),
      fine(HEART_CHILD_PATHS.pda, 0.0012, 0.0006, 30),
    ]),
  });

  // Conduction system. Nodes are small ellipsoids; the bundle and its branches are
  // strands lying in the septum and on the endocardial surface of the ventricular walls.
  out.push({
    id: 'sa_node',
    geometry: polygonise(ellipsoid([0.0395, 0.0425, 0.003], [0.0021, 0.0052, 0.0021]), [0.034, 0.034, -0.003], [0.046, 0.052, 0.009], { cell: 0.0006 }),
  });
  out.push({
    id: 'av_node',
    geometry: polygonise(ellipsoid(HIS_PATHS_AV, [0.0034, 0.0025, 0.0028]), [0.005, 0.002, -0.01], [0.019, 0.018, 0.002], { cell: 0.0006 }),
  });
  out.push({
    id: 'his_purkinje',
    geometry: mergeParts(HIS_STRANDS.map((p, i) => tubeAlong(p, () => (i === 0 ? 0.0011 : 0.0007), { tubular: Math.max(10, p.length * 6), radial: 5 }))),
  });

  // The interatrial septum, and the pericardium: two level-1 parts that did not exist before
  // their finer structures were added (a fossa ovalis needs a septum to be a depression in).
  out.push({ id: 'interatrial_septum', geometry: interatrialSeptum() });
  out.push({ id: 'pericardium', geometry: pericardialSurface(PERICARDIUM_SAC) });

  finer();
  return out;
};

/* ----------------------------------------------- conduction centrelines (shared) */

/** Centre of the AV node: low in the interatrial septum, near the tricuspid annulus. */
const HIS_PATHS_AV: V3 = [0.0125, 0.0095, -0.0045];

function strand(points: V3[]): V3[] {
  return points;
}

/**
 * The bundle of His and its branches, as strands. Index 0 is the His bundle itself
 * (thicker); then the left bundle branch trunk, its anterior and posterior fascicle
 * strands and a mid-septal strand; then the right bundle branch and the strands that fan
 * over the right ventricular free wall. The left bundle runs on the left side of the
 * septal slab and the right on the right side, because that is what the names mean.
 */
export const HIS_STRANDS: V3[][] = (() => {
  const septumLeft = (t: number): V3 => lvWallPoint(t, 0, 0.0008);
  const septumRight = (t: number): V3 => lvWallPoint(t, 0, SEPTUM - 0.0008);
  const his = strand([HIS_PATHS_AV, [0.0105, 0.0105, 0.0], septumRight(0.04), septumRight(0.09)]);
  const lbbTrunk = strand([septumRight(0.09), septumLeft(0.13), septumLeft(0.25), septumLeft(0.4)]);
  const lbbAnterior = strand([septumLeft(0.4), lvWallPoint(0.5, 0.45, 0.0008), lvWallPoint(0.65, 0.95, 0.0008), lvWallPoint(0.82, 1.2, 0.0008), lvWallPoint(0.95, 1.2, 0.0008)]);
  const lbbPosterior = strand([septumLeft(0.4), lvWallPoint(0.5, -0.45, 0.0008), lvWallPoint(0.65, -0.95, 0.0008), lvWallPoint(0.82, -1.2, 0.0008), lvWallPoint(0.95, -1.2, 0.0008)]);
  const lbbSeptal = strand([septumLeft(0.4), septumLeft(0.6), septumLeft(0.8), septumLeft(0.94)]);
  const rbbTrunk = strand([septumRight(0.09), septumRight(0.25), septumRight(0.45), septumRight(0.62)]);
  const rbbFreeWall = strand([septumRight(0.62), rvFreeWallPoint(0.66, 0.0, 0.0008), rvFreeWallPoint(0.8, 0.0, 0.0008), rvFreeWallPoint(0.93, 0.0, 0.0008)]);
  const rbbUp = strand([rvFreeWallPoint(0.66, 0.0, 0.0008), rvFreeWallPoint(0.55, 0.7, 0.0008), rvFreeWallPoint(0.4, 0.9, 0.0008), rvFreeWallPoint(0.25, 0.9, 0.0008)]);
  const rbbDown = strand([rvFreeWallPoint(0.66, 0.0, 0.0008), rvFreeWallPoint(0.6, -0.7, 0.0008), rvFreeWallPoint(0.45, -0.9, 0.0008), rvFreeWallPoint(0.3, -0.9, 0.0008)]);
  return [his, lbbTrunk, lbbAnterior, lbbPosterior, lbbSeptal, rbbTrunk, rbbFreeWall, rbbUp, rbbDown];
})();

/** `union` is imported for the probe's convenience of combining cavities; keep the import used. */
export const heartCavityUnion = (): Sdf => {
  const c = heartCavities();
  return union(c.ra, c.rv, c.la, c.lv);
};


/* ===================================================================================== */
/* FINER STRUCTURES: the level-2 parts (src/data/anatomy/heart.json, `parent`)             */
/* ===================================================================================== */

/**
 * Two paths that are not in the shell's own vasculature because they are not vessels of the
 * great-vessel overlay: the posterior descending artery and the coronary sinus. Both were
 * placed by the same procedure as the other coronary centrelines (a hand-placed rough path,
 * snapped to the shell by .cache/probes/heart_snap.ts and pulled inside it, 1.8 mm for the
 * artery and 4.2 mm for the wider vein) and pasted here as numbers. The posterior descending
 * artery starts at the end of the right coronary artery, where the groove it follows begins.
 * Illustrative course; no vessel here is traced from an atlas.
 */
export const HEART_CHILD_PATHS = {
  pda: [
    [0.0292, -0.0085, -0.0248],
    [0.0217, -0.0229, -0.0225],
    [-0.013, -0.0278, -0.0101],
    [-0.026, -0.0444, -0.0011],
    [-0.0341, -0.0578, 0.0105],
  ] as V3[],
  coronarySinus: [
    [-0.02, 0.011, -0.0307],
    [-0.007, 0.0085, -0.0337],
    [0.0032, 0.0056, -0.03],
    [0.0264, -0.0029, -0.0196],
    [0.0294, -0.0031, -0.0209],
  ] as V3[],
};

/** A fixed pseudo-random sequence in 0..1: the golden-ratio walk, so no Math.random is needed. */
function frac(x: number): number {
  return x - Math.floor(x);
}

/** Two unit vectors perpendicular to `n` and to each other: a frame in the plane of a valve. */
function planeBasis(n: V3): [V3, V3] {
  const helper: V3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = unit(cross(n, helper));
  const w = unit(cross(n, u));
  return [u, w];
}

/** A point on a circle in the plane of a valve, `radius` from its centre, at angle `theta`. */
function ringPoint(v: ValvePlane, theta: number, radius: number, lift = 0): V3 {
  const [u, w] = planeBasis(v.n);
  const c = Math.cos(theta) * radius;
  const s = Math.sin(theta) * radius;
  return [
    v.p[0] + u[0] * c + w[0] * s + v.n[0] * lift,
    v.p[1] + u[1] * c + w[1] * s + v.n[1] * lift,
    v.p[2] + u[2] * c + w[2] * s + v.n[2] * lift,
  ];
}

/** A muscle column: a tapered capsule from a base on the wall to a rounded tip. */
function column(base: V3, tip: V3, r0: number, r1: number): THREE.BufferGeometry {
  const { min, max } = boundsOf([base, tip], r0 + 0.002);
  return polygonise(capsule(base, tip, r0, r1), min, max, { cell: 0.0014 });
}

/** A thin cord from a papillary tip to a point on the valve ring, with a slight sag. */
function cord(tip: V3, end: V3): THREE.BufferGeometry {
  const mid = lerp3(tip, end, 0.5);
  const sag: V3 = [mid[0], mid[1] - 0.0006, mid[2]];
  return tubeAlong([tip, sag, end], () => 0.00032, { tubular: 6, radial: 4 });
}

/**
 * The cords of one papillary muscle: a fan to the part of the valve ring nearest it. The
 * angle of the muscle round the valve axis picks the middle of the fan, so a muscle on the
 * lateral wall sends its cords to the lateral edge of the ring and not across the orifice.
 */
function cordFan(tip: V3, v: ValvePlane, spread: readonly number[]): THREE.BufferGeometry[] {
  const [u, w] = planeBasis(v.n);
  const rel: V3 = [tip[0] - v.p[0], tip[1] - v.p[1], tip[2] - v.p[2]];
  const centre = Math.atan2(dot(rel, w), dot(rel, u));
  return spread.map((a) => cord(tip, ringPoint(v, centre + a, v.r * 0.82, 0.0006)));
}

/** +1 or -1: which way round the left ventricular axis the anterior side lies (larger z). */
function lvAnteriorSign(): number {
  const d = unit([LV_B[0] - LV_A[0], LV_B[1] - LV_A[1], LV_B[2] - LV_A[2]]);
  return Math.sign(cross(d, septalNormal(0.5))[2]) || 1;
}

/** The same for the right ventricular axis. */
function rvAnteriorSign(): number {
  const d = unit([RV_B[0] - RV_A[0], RV_B[1] - RV_A[1], RV_B[2] - RV_A[2]]);
  return Math.sign(cross(d, septalNormal(0.5))[2]) || 1;
}

/** Where a papillary muscle's tip is: from its base on the wall, part of the way to the valve. */
function papillaryTip(base: V3, v: ValvePlane, fraction: number): V3 {
  return lerp3(base, v.p, fraction);
}

/** The two papillary muscles of the left ventricle: the anterolateral and the posteromedial. */
export const LV_PAP_BASES: V3[] = (() => {
  const s = lvAnteriorSign();
  return [lvWallPoint(0.52, Math.PI - s * 0.8, 0.0006), lvWallPoint(0.46, Math.PI + s * 0.75, 0.0006)];
})();

/** The three papillary muscles of the right ventricle: anterior, posterior and septal. */
export const RV_PAP_BASES: V3[] = (() => {
  const s = rvAnteriorSign();
  return [
    rvFreeWallPoint(0.55, s * 0.9, 0.0006),
    rvFreeWallPoint(0.45, -s * 0.9, 0.0006),
    lvWallPoint(0.45, 0, SEPTUM - 0.0006),
  ];
})();

/** Ridges on an inner wall: short, rounded bars lying along the wall's long axis. */
function ridges(
  count: number,
  point: (t: number, phi: number) => V3,
  tRange: readonly [number, number],
  phiRange: readonly [number, number],
): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const t0 = tRange[0] + (tRange[1] - tRange[0]) * frac(i * 0.618 + 0.13);
    const phi = phiRange[0] + (phiRange[1] - phiRange[0]) * frac(i * 0.382 + 0.1);
    const span = 0.07 + 0.05 * frac(i * 0.7 + 0.3);
    const r = 0.001 + 0.0006 * frac(i * 0.45 + 0.2);
    const pts: V3[] = [point(t0, phi), point(t0 + span / 2, phi + 0.05), point(Math.min(0.97, t0 + span), phi)];
    // radial 5 -> 4: lowered to keep the heart within twice its pre-children triangle count (`tests/render/reveal.test.ts`).
    pieces.push(tubeAlong(pts, (t) => r * Math.sqrt(Math.max(0.05, Math.sin(Math.PI * t))), { tubular: 8, radial: 4 }));
  }
  return mergeParts(pieces);
}

/**
 * One cusp of a valve: a flat wedge of the valve's own disc, laid just downstream of the
 * parent's disc (the parent's disc is 0.8 mm thick, a cusp is 0.6 mm and sits 0.7 mm clear
 * of its centre line, so the two never share a surface and never flicker). The wedge angles
 * are the same as valveGeometry's, so cusp `i` lies exactly over leaflet `i`. Returns the
 * geometry and the centre of its bounding box, which the caller uses to name it.
 */
function cuspGeometry(v: ValvePlane, cusps: number, index: number): { geometry: THREE.BufferGeometry; centre: V3 } {
  const gapAngle = 0.28;
  const span = (Math.PI * 2) / cusps - gapAngle;
  const start = (index * Math.PI * 2) / cusps + gapAngle / 2;
  const g = new THREE.CylinderGeometry(v.r * 0.9, v.r * 0.9, 0.0006, 12, 1, false, start, span);
  g.translate(0, 0.0007, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(v.n[0], v.n[1], v.n[2]));
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(v.p[0], v.p[1], v.p[2]), q, new THREE.Vector3(1, 1, 1)));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  const c = new THREE.Vector3();
  g.boundingBox?.getCenter(c);
  return { geometry: g, centre: [c.x, c.y, c.z] };
}

/** Name the cusps of a valve from where each one lies, with `names` chosen by `assign`. */
function namedCusps(
  v: ValvePlane,
  count: number,
  assign: (centres: V3[]) => number[],
  names: readonly string[],
): { id: string; geometry: THREE.BufferGeometry }[] {
  const made = Array.from({ length: count }, (_, i) => cuspGeometry(v, count, i));
  const order = assign(made.map((m) => m.centre));
  return made.map((m, i) => ({ id: names[order[i]], geometry: m.geometry }));
}

/** Index of the largest (or smallest) value of `pick` among the candidates still free. */
function extreme(centres: V3[], free: number[], pick: (c: V3) => number, largest: boolean): number {
  let best = free[0];
  for (const i of free) {
    if (largest ? pick(centres[i]) > pick(centres[best]) : pick(centres[i]) < pick(centres[best])) best = i;
  }
  return best;
}

/** A flat lens (a squashed sphere) of half-axes rx, ry and half-thickness `half`, facing `normal`. */
function lens(centre: V3, normal: V3, rx: number, ry: number, half: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 20, 12);
  g.scale(rx, ry, half);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(normal[0], normal[1], normal[2]));
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(centre[0], centre[1], centre[2]), q, new THREE.Vector3(1, 1, 1)));
  g.deleteAttribute('uv');
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/**
 * The right atrium and left atrium lie about 22 mm apart in this drawing, edge to edge, so the
 * wall between them is drawn as a thick lens spanning the gap, along the line from one centre
 * to the other. `SEPTUM_AXIS` runs from the right atrium to the left, and `ATRIAL_SEPTUM` is the
 * middle of the gap. The geometry is a drawing proportion, not a measurement of a septum.
 */
const ATRIAL_AXIS: V3 = unit([-0.042, 0.014, -0.028]);
const ATRIAL_SEPTUM: V3 = [0.0092, 0.0289, -0.0139];

function interatrialSeptum(): THREE.BufferGeometry {
  return lens(ATRIAL_SEPTUM, ATRIAL_AXIS, 0.0115, 0.0085, 0.0105);
}

/** The oval depression on the right-atrial face of the septum: a pale lens laid on that face. */
function fossaOvalis(): THREE.BufferGeometry {
  const onRightFace = add(ATRIAL_SEPTUM, ATRIAL_AXIS, -0.0092);
  return lens(onRightFace, ATRIAL_AXIS, 0.0046, 0.0034, 0.0016);
}

/* ------------------------------------------------------------------ pericardium */

/**
 * The outline the pericardium follows: the ventricles, both atria and both auricles, the same
 * recipe as the shell in models.ts (heart()) without the interventricular groove and the
 * vessel stubs. Each layer is this field pushed outward by its own distance, so the four
 * surfaces are nested and never meet. The great vessels are not wrapped: the sac is drawn
 * round the heart body only, an illustrative simplification.
 */
function heartBodyField(): Sdf {
  const rv = capsule([0.012, 0.014, 0.014], [-0.03, -0.046, 0.022], 0.027, 0.011);
  const lv = capsule([-0.008, 0.016, -0.008], [-0.044, -0.052, 0.012], 0.031, 0.013);
  return smoothUnion(
    0.007,
    smoothUnion(0.01, rv, lv),
    ellipsoid([0.03, 0.022, 0.0], [0.02, 0.027, 0.022]),
    ellipsoid([-0.012, 0.036, -0.028], [0.026, 0.02, 0.017]),
    ellipsoid([0.016, 0.042, 0.022], [0.012, 0.009, 0.009]),
    ellipsoid([-0.038, 0.034, 0.0], [0.01, 0.008, 0.011]),
  );
}

/** How far outside the heart's surface each layer of the pericardium is drawn, metres (display choice). */
const PERICARDIUM_SAC = 0.0075;
const PERICARDIUM_FIBROUS = 0.0058;
const PERICARDIUM_PARIETAL = 0.004;
const PERICARDIUM_EPICARDIUM = 0.0016;

/** One layer of the pericardium: the body outline pushed out by `distance`. Coarse cells on purpose: the field is smooth. */
function pericardialSurface(distance: number, cell = 0.0075): THREE.BufferGeometry {
  return polygonise(offset(heartBodyField(), distance), [-0.074, -0.078, -0.058], [0.068, 0.066, 0.062], { cell });
}

/**
 * The child layers use a coarser cell (8.5 mm, was 7.5 mm): they are the outermost, least visible
 * surfaces of the heart and the outline is smooth. Lowered to keep the heart within twice its
 * pre-children triangle count (`tests/render/reveal.test.ts`).
 */
const PERICARDIUM_CHILD_CELL = 0.0085;

/* ----------------------------------------------------------------- the children */

/** Every level-2 part of the heart, as `{ id, geometry }` like the level-1 ones. */
function finerStructures(c: HeartCavities): { id: string; geometry: THREE.BufferGeometry }[] {
  const out: { id: string; geometry: THREE.BufferGeometry }[] = [];

  /* Left ventricle. */
  const lvTips = LV_PAP_BASES.map((b) => papillaryTip(b, MITRAL, 0.42));
  out.push({
    id: 'papillary_muscles_lv',
    geometry: mergeParts(LV_PAP_BASES.map((b, i) => column(b, lvTips[i], 0.0042, 0.0022))),
  });
  out.push({
    id: 'chordae_tendineae_lv',
    geometry: mergeParts(lvTips.flatMap((tip) => cordFan(tip, MITRAL, [-0.75, -0.25, 0.25, 0.75]))),
  });
  out.push({
    id: 'trabeculae_carneae_lv',
    geometry: ridges(22, (t, phi) => lvWallPoint(t, phi, -0.0006), [0.4, 0.9], [0.8, Math.PI * 2 - 0.8]),
  });

  /* Right ventricle. */
  const rvTips = RV_PAP_BASES.map((b, i) => papillaryTip(b, TRICUSPID, i === 2 ? 0.4 : 0.45));
  out.push({
    id: 'papillary_muscles_rv',
    geometry: mergeParts(RV_PAP_BASES.map((b, i) => column(b, rvTips[i], i === 2 ? 0.0028 : 0.0038, 0.002))),
  });
  out.push({
    id: 'chordae_tendineae_rv',
    geometry: mergeParts(rvTips.flatMap((tip) => cordFan(tip, TRICUSPID, [-0.9, -0.3, 0.3, 0.9]))),
  });
  // The septomarginal trabecula crosses the cavity from the septum to the anterior papillary muscle.
  const moderator = tubeAlong(
    [lvWallPoint(0.58, 0, SEPTUM - 0.0006), lerp3(lvWallPoint(0.58, 0, SEPTUM - 0.0006), RV_PAP_BASES[0], 0.5), RV_PAP_BASES[0]],
    () => 0.0016,
    { tubular: 10, radial: 6 },
  );
  out.push({
    id: 'trabeculae_carneae_rv',
    geometry: mergeParts([ridges(14, (t, phi) => rvFreeWallPoint(t, phi, 0.0006), [0.3, 0.9], [-1.3, 1.3]), moderator]),
  });

  /* Valve cusps, named from where each wedge lies. */
  out.push(
    ...namedCusps(
      MITRAL,
      2,
      (cs) => {
        const anterior = extreme(cs, [0, 1], (p) => p[2], true);
        return cs.map((_, i) => (i === anterior ? 0 : 1));
      },
      ['anterior_mitral_cusp', 'posterior_mitral_cusp'],
    ),
  );
  out.push(
    ...namedCusps(
      TRICUSPID,
      3,
      (cs) => {
        const free = [0, 1, 2];
        const septal = extreme(cs, free, (p) => p[0], false);
        const rest = free.filter((i) => i !== septal);
        const anterior = extreme(cs, rest, (p) => p[2], true);
        return cs.map((_, i) => (i === septal ? 2 : i === anterior ? 0 : 1));
      },
      ['anterior_tricuspid_cusp', 'posterior_tricuspid_cusp', 'septal_tricuspid_cusp'],
    ),
  );
  out.push(
    ...namedCusps(
      AORTIC,
      3,
      (cs) => {
        const free = [0, 1, 2];
        const nonCoronary = extreme(cs, free, (p) => p[2], false);
        const rest = free.filter((i) => i !== nonCoronary);
        const left = extreme(cs, rest, (p) => p[0], false);
        return cs.map((_, i) => (i === nonCoronary ? 2 : i === left ? 1 : 0));
      },
      ['right_aortic_cusp', 'left_aortic_cusp', 'non_coronary_cusp'],
    ),
  );
  out.push(
    ...namedCusps(
      PULMONIC,
      3,
      (cs) => {
        const free = [0, 1, 2];
        const anterior = extreme(cs, free, (p) => p[2], true);
        const rest = free.filter((i) => i !== anterior);
        const left = extreme(cs, rest, (p) => p[0], false);
        return cs.map((_, i) => (i === anterior ? 0 : i === left ? 1 : 2));
      },
      ['anterior_pulmonary_cusp', 'left_pulmonary_cusp', 'right_pulmonary_cusp'],
    ),
  );

  /* Septa. The children are drawn 0.4 mm inside their parent's surface so the two never share one. */
  const wall = subtract(offset(c.lvFull, SEPTUM), c.lvFull);
  const septum = offset(intersect(intersect(wall, offset(c.rvFull, 0.0075)), downstream(TRICUSPID)), -0.0004);
  const membranousCentre = lvWallPoint(0.06, 0, SEPTUM * 0.5);
  const membranousZone = sphere(membranousCentre, 0.0062);
  out.push({
    id: 'muscular_septum',
    geometry: polygonise(smoothSubtract(0.002, septum, membranousZone), [-0.05, -0.062, -0.016], [0.022, 0.032, 0.032], { cell: 0.0028 }),
  });
  out.push({
    id: 'membranous_septum',
    geometry: polygonise(intersect(septum, membranousZone), [membranousCentre[0] - 0.01, membranousCentre[1] - 0.01, membranousCentre[2] - 0.01], [membranousCentre[0] + 0.01, membranousCentre[1] + 0.01, membranousCentre[2] + 0.01], { cell: 0.0012 }),
  });
  out.push({ id: 'fossa_ovalis', geometry: fossaOvalis() });

  /* Coronary vessels: the same centrelines as the parent, drawn thinner so they lie inside it. */
  const taper = (r0: number, r1: number) => (t: number) => r0 + (r1 - r0) * t;
  const artery = (pts: readonly V3[], r0: number, r1: number, tubular: number): THREE.BufferGeometry =>
    tubeAlong(pts, taper(r0, r1), { tubular, radial: 6 });
  out.push({ id: 'left_main_coronary', geometry: artery(HEART_PATHS.leftMain, 0.0013, 0.0012, 12) });
  out.push({ id: 'left_anterior_descending', geometry: artery(HEART_PATHS.lad, 0.0011, 0.0005, 40) });
  out.push({ id: 'circumflex_artery', geometry: artery(HEART_PATHS.circumflex, 0.001, 0.0005, 32) });
  out.push({ id: 'right_coronary_artery', geometry: artery(HEART_PATHS.rca, 0.0011, 0.0005, 40) });
  out.push({ id: 'posterior_descending_artery', geometry: artery(HEART_CHILD_PATHS.pda, 0.0009, 0.0004, 30) });
  out.push({ id: 'coronary_sinus', geometry: artery(HEART_CHILD_PATHS.coronarySinus, 0.0034, 0.0042, 30) });

  /* Conduction: the strands of the parent, drawn a little thicker in their own colours. */
  const strands = (idx: readonly number[], r: number): THREE.BufferGeometry =>
    mergeParts(idx.map((i) => tubeAlong(HIS_STRANDS[i], () => r, { tubular: Math.max(10, HIS_STRANDS[i].length * 6), radial: 5 })));
  out.push({ id: 'bundle_of_his', geometry: strands([0], 0.0015) });
  out.push({ id: 'left_bundle_branch', geometry: strands([1, 2, 3, 4], 0.001) });
  out.push({ id: 'right_bundle_branch', geometry: strands([5, 6], 0.001) });
  out.push({ id: 'purkinje_fibres', geometry: strands([7, 8], 0.0009) });

  /* Pericardium: its three layers. */
  out.push({ id: 'fibrous_pericardium', geometry: pericardialSurface(PERICARDIUM_FIBROUS, PERICARDIUM_CHILD_CELL) });
  out.push({ id: 'parietal_pericardium', geometry: pericardialSurface(PERICARDIUM_PARIETAL, PERICARDIUM_CHILD_CELL) });
  out.push({ id: 'epicardium', geometry: pericardialSurface(PERICARDIUM_EPICARDIUM, PERICARDIUM_CHILD_CELL) });
  return out;
}
