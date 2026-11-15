import * as THREE from 'three';
import type { PartBuilder } from '../parts';
import {
  capsule,
  chain,
  ellipsoid,
  halfSpace,
  intersect,
  mergeParts,
  polygonise,
  smoothUnion,
  subtract,
  torus,
  tubeAlong,
  type Sdf,
  type V3,
} from '../sdf';
import { gravidBody, uterineTubePath } from '../models';

/**
 * THE INSIDE OF THE UTERUS, THE UTERINE TUBES, AND IN PREGNANCY THE PLACENTA AND SAC.
 *
 * The uterus is a thick-walled muscular organ. From outside in the wall is the perimetrium
 * (the peritoneal covering), the myometrium (smooth muscle) and the endometrium, the
 * mucous lining of the cavity; in pregnancy the lining is called the decidua. The body
 * and fundus lie above the isthmus, the narrowed zone at the internal os, and below that
 * is the cervix, whose canal runs from the internal os to the external os. A uterine tube
 * leaves each upper corner: the isthmus is the narrow part nearest the uterus, the
 * ampulla the long wider middle part where fertilisation usually happens, and the
 * infundibulum the funnel with the fimbriae that sweep over the ovary. The uterine
 * arteries run up the sides of the uterus and send arcuate branches round the wall
 * (GRAYS42; GH14 chs. 82-83).
 *
 * FRAME AND THE SHELL. Authored in the frame of the shell in models.ts, origin at the
 * external os. THE SHELL IS REBUILT FOR EVERY GESTATIONAL WEEK, so this file rebuilds with
 * it, from the same exported growth functions (`gravidBody`, `uterineTubePath`). Before
 * week 6 the shell is the small pear (body ellipsoid plus cervix capsule); from week 6 it
 * is the body ellipsoid `gravidBody(weeks)` blended with the same cervix capsule. The
 * outer surfaces of the perimetrium and myometrium are the shell's own implicit field,
 * pulled inwards by a millimetre or two, so they follow the shell exactly in every week,
 * including the smooth neck where the two shapes meet. The cavity is the body ellipsoid
 * shrunk by the wall thickness.
 *
 * WHAT IS A DRAWING CHOICE. The wall thickness, the lining thickness, the size and place of
 * the placenta and the radii of the tubes and arteries are chosen to read clearly and to
 * fit inside the shell at every week; none is a measurement and none is quoted anywhere.
 * The wall is drawn thicker in absolute terms late in pregnancy only because a thin shell
 * cannot be resolved on the coarser grid that a large uterus needs; relative to the size
 * of the organ it is thinner, which is the point. The grid cell grows with the organ
 * so that the build stays fast and under the triangle budget at term.
 *
 * THE LINING IS DRAWN AS A SECTION. Like every atlas plate of the cavity, only the
 * posterior half of the lining is drawn: a lining drawn all round would be an opaque
 * shell hiding the cavity, the menstrual stream and the amniotic sac. The detail module
 * thickens and darkens it with the cycle by scaling it away from the posterior wall.
 *
 * PARTS THAT DO NOT EXIST YET. The set of part ids is the same in every week so that the
 * data file can list each once. The placenta and the amniotic sac do not exist before
 * week 8 and outside pregnancy, so then they are a sliver a third of a millimetre across,
 * which the detail module hides.
 *
 * NOT DRAWN. The fetus and the umbilical cord (a separate organ), the chorion as a
 * separate layer, the layers of the placenta, the broad ligaments, the vaginal part of the
 * cervix beyond the external os, and the glands and spiral arteries of the lining.
 */

const NONPREG_CENTRE: V3 = [0, 0.052, 0.02];
const NONPREG_RADII: V3 = [0.0235, 0.03, 0.0165];
const CERVIX_A: V3 = [0, 0, 0];
const CERVIX_B: V3 = [0, 0.024, 0.006];
const CERVIX_RA = 0.0115;
const CERVIX_RB = 0.0125;
/** Height of the internal os above the external os, metres. */
const OS_Y = 0.0285;

export interface UterusGeo {
  weeks: number;
  gravid: boolean;
  /** Centre and semi-axes of the body ellipsoid that the shell uses. */
  centre: V3;
  radii: V3;
  /** Drawn thickness of the myometrium, and the grid cell the large surfaces are built on. */
  wall: number;
  cell: number;
  /** Cavity ellipsoid: the body ellipsoid shrunk by the wall. */
  cavR: V3;
}

export function uterusGeo(weeks: number): UterusGeo {
  const gravid = weeks >= 6;
  if (!gravid) {
    const wall = 0.0085;
    return {
      weeks,
      gravid,
      centre: NONPREG_CENTRE,
      radii: NONPREG_RADII,
      wall,
      cell: 0.0026,
      cavR: [NONPREG_RADII[0] - wall, NONPREG_RADII[1] - wall, NONPREG_RADII[2] - wall],
    };
  }
  const { centre, radii } = gravidBody(weeks);
  // The grid was radii[1]/18 (non-pregnant 2 mm, cervix and isthmus 1.3 mm), which put the
  // interior at 38k triangles at week 0 and 66k from week 24 (the isthmus alone 12k, being a
  // thin zone cut across the whole width of the cavity). Coarsened to /12, 2.6 mm and 1.7 mm
  // so every week is under 30k; the layers' thicknesses are tied to the cell, so the wall
  // and lining read a little thicker, no more.
  const cell = Math.max(0.0024, radii[1] / 12);
  const wall = Math.max(1.6 * cell, 0.0085 * (1 - (0.5 * (Math.min(weeks, 40) - 6)) / 34));
  return { weeks, gravid, centre, radii, wall, cell, cavR: [radii[0] - wall, radii[1] - wall, radii[2] - wall] };
}

/** Thickness of the drawn lining, metres: the same for the lining layer and the sac that sits inside it. */
function liningThickness(g: UterusGeo): number {
  return Math.max(0.0035, 1.3 * g.cell);
}

/**
 * Semi-axes of the amniotic sac this atlas draws (centred on `uterusGeo(weeks).centre`):
 * the cavity ellipsoid pulled in by the lining and a millimetre. The fetus is fitted
 * inside exactly this ellipsoid (`fetalFit` in models.ts), so it is written once.
 */
export function amnioticSacRadii(weeks: number): V3 {
  const g = uterusGeo(weeks);
  const d = liningThickness(g) + 0.001;
  return [g.cavR[0] - d, g.cavR[1] - d, g.cavR[2] - d];
}

/** The shell's own field (negative inside), the same expression models.ts polygonises. */
export function shellField(g: UterusGeo): Sdf {
  const cervix = capsule(CERVIX_A, CERVIX_B, CERVIX_RA, CERVIX_RB);
  return smoothUnion(g.gravid ? 0.014 : 0.012, cervix, ellipsoid(g.centre, g.radii));
}

/** The shell's field pulled `d` metres inwards. */
function inward(f: Sdf, d: number): Sdf {
  return (x, y, z) => f(x, y, z) + d;
}

/** The cervical canal's centreline, external os to internal os; its axis leans forward with height. */
const CANAL: V3[] = [
  [0, -0.0098, -0.0025],
  [0, 0.004, 0.001],
  [0, 0.0165, 0.0041],
  [0, OS_Y, 0.0072],
];

function cavityField(g: UterusGeo): Sdf {
  const body = ellipsoid(g.centre, g.cavR);
  if (!g.gravid) {
    // The cavity narrows to the internal os through a short neck.
    return smoothUnion(0.004, body, capsule([0, OS_Y - 0.002, 0.0068], [0, OS_Y + 0.007, 0.0115], 0.0022, 0.0055));
  }
  return body;
}

function boxOf(g: UterusGeo, yMin = -0.014): { min: V3; max: V3 } {
  const [cx, cy, cz] = g.centre;
  const [rx, ry, rz] = g.radii;
  return { min: [cx - rx - 0.004, yMin, Math.min(-0.014, cz - rz - 0.004)], max: [cx + rx + 0.004, cy + ry + 0.004, cz + rz + 0.004] };
}

/** Where the posterior cavity wall is, at a given x and y. */
export function posteriorWallZ(g: UterusGeo, x: number, y: number): number {
  const q = 1 - (x / g.cavR[0]) ** 2 - ((y - g.centre[1]) / g.cavR[1]) ** 2;
  return g.centre[2] - g.cavR[2] * Math.sqrt(Math.max(0, q));
}

/** Pivot for the lining's thickness: the posterior cavity wall at the cavity's middle height. */
export function liningPivot(weeks: number): V3 {
  const g = uterusGeo(weeks);
  return [0, g.centre[1], g.centre[2] - g.cavR[2]];
}

/** The placenta: a lens on the fundal-posterior wall, clipped to the cavity so it follows the wall. */
function placentaLens(g: UterusGeo, grow: number): Sdf {
  const [, cy] = g.centre;
  const y = cy + 0.3 * g.cavR[1];
  const zw = posteriorWallZ(g, 0, y);
  const h = g.radii[1] * 2 + 0.02;
  const thick = 0.006 + 0.014 * (h / 0.36);
  const lens = ellipsoid([0, y, zw], [0.5 * g.cavR[0] + grow, 0.38 * g.cavR[1] + grow, thick + grow]);
  return intersect(lens, ellipsoid(g.centre, [g.cavR[0] + grow, g.cavR[1] + grow, g.cavR[2] + grow]));
}

/** Streams of maternal blood through the placental site: in from the wall, out to the wall. */
export function placentaPaths(weeks: number): { inflow: V3[]; outflow: V3[]; thick: number; width: number } {
  const g = uterusGeo(weeks);
  const y = g.centre[1] + 0.3 * g.cavR[1];
  const h = g.radii[1] * 2 + 0.02;
  const thick = 0.006 + 0.014 * (h / 0.36);
  const a = 0.5 * g.cavR[0];
  const wz = (x: number, yy: number): number => posteriorWallZ(g, x, yy);
  const xi = -0.25 * a;
  const xo1 = 0.05 * a;
  const xo2 = 0.35 * a;
  const inflow: V3[] = [
    [xi, y - 0.004, wz(xi, y - 0.004) - 0.0015],
    [xi, y, wz(xi, y) + 0.45 * thick],
    [xi + 0.1 * a, y + 0.006, wz(xi, y + 0.006) + 0.8 * thick],
  ];
  const outflow: V3[] = [
    [xo1, y + 0.006, wz(xo1, y + 0.006) + 0.75 * thick],
    [xo2, y + 0.003, wz(xo2, y + 0.003) + 0.35 * thick],
    [xo2 + 0.05 * a, y, wz(xo2, y) - 0.0015],
  ];
  return { inflow, outflow, thick, width: a };
}

/** The uterine artery's trunk up the side wall, at mid-wall depth. */
export function arteryTrunk(weeks: number, side: number): V3[] {
  const g = uterusGeo(weeks);
  const out: V3[] = [];
  for (const v of [-0.75, -0.45, -0.1, 0.25, 0.6, 0.85]) {
    out.push(wallPoint(g, side, v, 0));
  }
  return out;
}

/** A point at mid-wall depth: height fraction v of the body ellipsoid, angle phi round its axis. */
function wallPoint(g: UterusGeo, side: number, v: number, phi: number): V3 {
  const rxm = g.radii[0] - 0.5 * g.wall;
  const rym = g.radii[1] - 0.5 * g.wall;
  const rzm = g.radii[2] - 0.5 * g.wall;
  const q = Math.sqrt(1 - v * v);
  return [side * rxm * q * Math.cos(phi), g.centre[1] + v * rym, g.centre[2] + rzm * q * Math.sin(phi) - 0.1 * rzm * q];
}

/** The tube's control points, the same ones the shell uses at this week. */
export function tubeControl(weeks: number, side: number): V3[] {
  const g = uterusGeo(weeks);
  if (!g.gravid) return uterineTubePath(side);
  const lift = g.centre[1] + 0.55 * g.radii[1] - 0.074;
  const spread = Math.max(0, g.radii[0] * 0.72 - 0.019);
  return uterineTubePath(side).map((p) => [p[0] + side * spread, p[1] + lift, p[2] + g.centre[2] - 0.02] as V3);
}

/** The route of ciliary transport: fimbriae, along the tube, into the cavity at the uterine corner. */
export function tubeFlowPath(side: number): V3[] {
  const c = uterineTubePath(side);
  const rev = c.slice().reverse();
  rev.push([side * 0.009, 0.066, 0.02]);
  return rev;
}

/** Menstrual flow: from the cavity down through the canal and out at the external os. */
export function menstrualPath(): V3[] {
  return [
    [0, 0.06, 0.02],
    [0, 0.04, 0.0125],
    [0, 0.0285, 0.0072],
    [0, 0.0165, 0.0041],
    [0, 0.004, 0.001],
    [0, -0.0098, -0.0025],
  ];
}

const sliver = (): THREE.BufferGeometry =>
  tubeAlong(
    [
      [0, 0.03, 0.01],
      [0, 0.0304, 0.01],
    ],
    () => 0.00015,
    { tubular: 2, radial: 3 },
  );

/** Tube pieces cut from the control curve at fractions of its length. */
function tubePieces(weeks: number, side: number): { isthmus: THREE.BufferGeometry; ampulla: THREE.BufferGeometry; infundibulum: THREE.BufferGeometry } {
  const ctrl = tubeControl(weeks, side);
  const curve = new THREE.CatmullRomCurve3(ctrl.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', 0.5);
  // Inside the shell tube (0.0019 + 0.0034 t^2): about 60 % of it, so it never pokes out.
  const radius = (t: number): number => 0.0011 + 0.0027 * t * t + (t > 0.82 ? 0.0008 * ((t - 0.82) / 0.18) ** 2 : 0);
  const cut = (t0: number, t1: number): THREE.BufferGeometry => {
    const pts: V3[] = [];
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const p = curve.getPointAt(t0 + ((t1 - t0) * i) / n);
      pts.push([p.x, p.y, p.z]);
    }
    return tubeAlong(pts, (t) => radius(t0 + (t1 - t0) * t), { tubular: 20, radial: 8 });
  };
  const infundibulum = cut(0.82, 1);

  // The fimbriae: slender fingers fanning from the funnel's mouth.
  const end = curve.getPointAt(1);
  const tangent = curve.getTangentAt(1).normalize();
  const base = curve.getPointAt(0.96);
  const ref = Math.abs(tangent.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const e1 = new THREE.Vector3().crossVectors(tangent, ref).normalize();
  const e2 = new THREE.Vector3().crossVectors(tangent, e1).normalize();
  const fingers: THREE.BufferGeometry[] = [infundibulum];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const dir = new THREE.Vector3().addScaledVector(e1, Math.cos(a)).addScaledVector(e2, Math.sin(a));
    const p0 = base.clone().addScaledVector(dir, 0.0026);
    const p1 = end.clone().addScaledVector(dir, 0.0034).addScaledVector(tangent, 0.0012);
    const p2 = end.clone().addScaledVector(dir, 0.0042).addScaledVector(tangent, 0.0026);
    fingers.push(tubeAlong([[p0.x, p0.y, p0.z], [p1.x, p1.y, p1.z], [p2.x, p2.y, p2.z]], () => 0.00042, { tubular: 6, radial: 4 }));
  }
  return { isthmus: cut(0, 0.3), ampulla: cut(0.3, 0.82), infundibulum: mergeParts(fingers) };
}

export const parts: PartBuilder = (params) => {
  const weeks = params.gestationWeeks ?? 0;
  const g = uterusGeo(weeks);
  const f = shellField(g);
  const out: { id: string; geometry: THREE.BufferGeometry }[] = [];
  const box = boxOf(g);
  const [cx, cy, cz] = g.centre;
  const cavity = cavityField(g);
  const canalRadius = g.gravid ? 0.0013 : 0.0021;
  const canal = chain(CANAL, canalRadius);
  const hasPlacenta = g.gravid && weeks >= 8;
  const lining = liningThickness(g);

  // PERIMETRIUM: a closed membrane just inside the shell, glass in the detail module.
  out.push({ id: 'perimetrium', geometry: polygonise(inward(f, 0.0008), box.min, box.max, { cell: g.cell }) });

  // MYOMETRIUM: the muscle wall of the body and fundus, bored by the cavity and the canal.
  // It stops a little below the internal os, where the cervix takes over.
  const wallField = subtract(subtract(inward(f, 0.0016), cavity), canal);
  out.push({
    id: 'myometrium',
    geometry: polygonise(intersect(wallField, halfSpace([0, 0.02, 0], [0, 1, 0])), [box.min[0], 0.02, box.min[2]], box.max, { cell: g.cell }),
  });

  // ENDOMETRIUM / DECIDUA: posterior half only, as a section.
  const cavE = ellipsoid(g.centre, g.cavR);
  const posterior = halfSpace([0, 0, g.gravid ? cz : cz - 0.0007], [0, 0, -1]);
  let liningField: Sdf;
  if (!g.gravid) {
    liningField = intersect(cavE, posterior);
  } else {
    const inner = ellipsoid(g.centre, [g.cavR[0] - lining, g.cavR[1] - lining, g.cavR[2] - lining]);
    liningField = intersect(subtract(cavE, inner), posterior);
    if (hasPlacenta) liningField = subtract(liningField, placentaLens(g, 0.001));
  }
  out.push({
    id: 'endometrium',
    geometry: polygonise(
      liningField,
      [cx - g.cavR[0] - 0.002, cy - g.cavR[1] - 0.002, cz - g.cavR[2] - 0.002],
      [cx + g.cavR[0] + 0.002, cy + g.cavR[1] + 0.002, cz + 0.002],
      { cell: g.gravid ? g.cell : 0.0015 },
    ),
  });

  // UTERINE CAVITY: a faint closed surface at the boundary of the lumen.
  out.push({
    id: 'uterine_cavity',
    geometry: polygonise(cavity, [cx - g.cavR[0] - 0.003, OS_Y - 0.006, cz - g.cavR[2] - 0.003], [cx + g.cavR[0] + 0.003, cy + g.cavR[1] + 0.003, cz + g.cavR[2] + 0.003], { cell: g.cell }),
  });

  // FUNDUS, BODY, ISTHMUS: three zones on the inner layer of the wall, split by height.
  const layerT = Math.min(g.wall * 0.8, Math.max(0.0015, 1.2 * g.cell));
  const layer: Sdf = (x, y, z) => {
    const c = cavity(x, y, z);
    return Math.max(-c, c - layerT);
  };
  const fundusY = cy + 0.4 * g.cavR[1];
  const isthmusTop = OS_Y + 0.008;
  const zoneBox = (y0: number, y1: number): { min: V3; max: V3 } => ({
    min: [cx - g.cavR[0] - layerT - 0.002, y0, cz - g.cavR[2] - layerT - 0.002],
    max: [cx + g.cavR[0] + layerT + 0.002, y1, cz + g.cavR[2] + layerT + 0.002],
  });
  const yTop = cy + g.cavR[1] + layerT + 0.002;
  const fz = zoneBox(fundusY - 0.002, yTop);
  out.push({ id: 'fundus', geometry: polygonise(intersect(layer, halfSpace([0, fundusY, 0], [0, 1, 0])), fz.min, fz.max, { cell: Math.min(g.cell, layerT * 0.8) }) });
  const bz = zoneBox(isthmusTop - 0.002, fundusY + 0.002);
  out.push({
    id: 'uterine_body',
    geometry: polygonise(intersect(intersect(layer, halfSpace([0, isthmusTop, 0], [0, 1, 0])), subtract(layer, halfSpace([0, fundusY, 0], [0, 1, 0]))), bz.min, bz.max, { cell: Math.min(g.cell, layerT * 0.8) }),
  });
  const iz = zoneBox(OS_Y - 0.008, isthmusTop + 0.002);
  out.push({
    id: 'isthmus',
    geometry: polygonise(intersect(intersect(layer, halfSpace([0, OS_Y - 0.007, 0], [0, 1, 0])), subtract(layer, halfSpace([0, isthmusTop, 0], [0, 1, 0]))), iz.min, iz.max, { cell: g.gravid ? Math.min(g.cell, layerT * 0.8) : 0.0017 }),
  });

  // CERVIX: the fibrous neck below the internal os, bored by the canal. Glass.
  const cervixCap = capsule(CERVIX_A, CERVIX_B, CERVIX_RA, CERVIX_RB);
  out.push({
    id: 'cervix',
    geometry: polygonise(
      intersect(subtract(inward(cervixCap, 0.0016), canal), halfSpace([0, OS_Y - 0.0015, 0], [0, -1, 0])),
      [-0.014, -0.014, -0.012],
      [0.014, OS_Y, 0.02],
      { cell: 0.0017 },
    ),
  });
  out.push({ id: 'cervical_canal', geometry: tubeAlong(CANAL, () => canalRadius, { tubular: 24, radial: 10 }) });
  const ringAt = (p: V3, r: number): THREE.BufferGeometry => polygonise(torus(p, r, 0.0008, 1), [p[0] - r - 0.0015, p[1] - 0.0015, p[2] - r - 0.0015], [p[0] + r + 0.0015, p[1] + 0.0015, p[2] + r + 0.0015], { cell: 0.0005 });
  out.push({ id: 'internal_os', geometry: ringAt(CANAL[3], canalRadius + 0.0009) });
  out.push({ id: 'external_os', geometry: ringAt(CANAL[0], canalRadius + 0.0009) });

  // TUBES: isthmus, ampulla, infundibulum with fimbriae, on each side.
  const pieces = [1, -1].map((s) => tubePieces(weeks, s));
  out.push({ id: 'tube_isthmus', geometry: mergeParts(pieces.map((p) => p.isthmus)) });
  out.push({ id: 'tube_ampulla', geometry: mergeParts(pieces.map((p) => p.ampulla)) });
  out.push({ id: 'infundibulum_fimbriae', geometry: mergeParts(pieces.map((p) => p.infundibulum)) });

  // UTERINE ARTERIES: a trunk up each side, and arcuate branches round the wall.
  const arteries: THREE.BufferGeometry[] = [];
  const aR = g.gravid ? 0.0021 : 0.0017;
  for (const s of [1, -1]) {
    arteries.push(tubeAlong(arteryTrunk(weeks, s), () => aR, { tubular: 30, radial: 8 }));
    for (const v of [-0.3, 0.2, 0.65]) {
      for (const dir of [1, -1]) {
        const pts: V3[] = [0, 0.4, 0.8, 1.2].map((a) => wallPoint(g, s, v, dir * a));
        arteries.push(tubeAlong(pts, () => 0.0008, { tubular: 10, radial: 5 }));
      }
    }
  }
  out.push({ id: 'uterine_arteries', geometry: mergeParts(arteries) });

  // PLACENTA and AMNIOTIC SAC: from week 8; otherwise a hidden sliver.
  if (hasPlacenta) {
    const ly = cy + 0.3 * g.cavR[1];
    const zw = posteriorWallZ(g, 0, ly);
    const pj = placentaPaths(weeks);
    out.push({
      id: 'placenta',
      geometry: polygonise(
        placentaLens(g, 0),
        [-0.5 * g.cavR[0] - 0.002, ly - 0.38 * g.cavR[1] - 0.002, zw - 0.002],
        [0.5 * g.cavR[0] + 0.002, ly + 0.38 * g.cavR[1] + 0.002, zw + pj.thick + 0.002],
        { cell: Math.max(0.0015, pj.thick / 5) },
      ),
    });
    const sac = subtract(ellipsoid(g.centre, amnioticSacRadii(weeks)), placentaLens(g, 0.001));
    out.push({
      id: 'amniotic_sac',
      geometry: polygonise(sac, [cx - g.cavR[0], cy - g.cavR[1], cz - g.cavR[2]], [cx + g.cavR[0], cy + g.cavR[1], cz + g.cavR[2]], { cell: g.cell }),
    });
  } else {
    out.push({ id: 'placenta', geometry: sliver() });
    out.push({ id: 'amniotic_sac', geometry: sliver() });
  }
  return out;
};
