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
import {
  CERVIX_A as PU_CERVIX_A,
  CERVIX_B as PU_CERVIX_B,
  CERVIX_RA as PU_CERVIX_RA,
  CERVIX_RB as PU_CERVIX_RB,
  NONPREG_CENTRE,
  NONPREG_RADII,
  gravidShape,
  lowerSegment,
  nonpregIsthmus,
} from '../models';

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
 * FINER STRUCTURES (T2, level-2 and level-3 parts; src/data/anatomy/uterus.json `parent`). The
 * lining holds its functional and basal layers, glands, spiral arteries and stroma; the placenta
 * its villi, intervillous space, decidual and chorionic plates and the first stretch of the
 * umbilical cord (whose own parts are level 3: the two arteries, the vein and Wharton's jelly);
 * the sac its amnion, chorion and fluid; the broad ligament its mesometrium and mesosalpinx.
 * Ligaments, the intramural tube and the uterine veins are new level-1 parts. The lining's
 * children are built INSIDE the same field as the lining itself (so they follow it at every
 * week and ride its cycle-driven scaling, which the contract says children do), and the placental
 * ones are cut from the same lens as the placenta; before week 8 each placental and sac child
 * is, like its parent, a hidden sliver. Depth stays within three: the cord is the only level-3
 * group. Counts of glands, spiral arteries and villi are schematic.
 *
 * NOT DRAWN. The fetus (a separate organ) and the rest of the umbilical cord beyond its first
 * stretch, the layers of the placenta beyond those named, the vaginal part of the cervix beyond
 * the external os, the ovary and the nerves. The ligaments' courses are hand-placed diagrams;
 * the broad ligament is a flat sheet and does not drape. Everything is deterministic (a seeded
 * generator and golden-ratio sequences, no Math.random).
 */

// The non-pregnant body, the cervix and its lean are defined once in ../pelvicUterus.ts and shared
// with the shell (models.ts): the cervix leans back behind the bladder and the body rests on it.
const CERVIX_A: V3 = PU_CERVIX_A;
const CERVIX_B: V3 = PU_CERVIX_B;
const CERVIX_RA = PU_CERVIX_RA;
const CERVIX_RB = PU_CERVIX_RB;
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
  // The lower segment (gravid) or isthmus (non-pregnant) joins the leaning cervix to a body that
  // now sits above the bladder or the pubis; the same pieces models.ts polygonises.
  const link = g.gravid ? lowerSegment(gravidShape(g.weeks)) : nonpregIsthmus();
  return smoothUnion(g.gravid ? 0.014 : 0.012, cervix, ...link.map((f) => capsule(f.a, f.b, f.ra, f.rb)), ellipsoid(g.centre, g.radii));
}

/** The shell's field pulled `d` metres inwards. */
function inward(f: Sdf, d: number): Sdf {
  return (x, y, z) => f(x, y, z) + d;
}

/** The cervical canal's centreline, external os to internal os; its axis leans forward with height. */
/** z of the canal's axis at height y: it follows the cervix capsule's own axis (leaning BACK as it rises). */
const canalZ = (y: number): number => CERVIX_A[2] + ((CERVIX_B[2] - CERVIX_A[2]) * y) / CERVIX_B[1];
const CANAL: V3[] = [-0.0098, 0.004, 0.0165, OS_Y].map((y) => [0, y, canalZ(y)] as V3);

function cavityField(g: UterusGeo): Sdf {
  const body = ellipsoid(g.centre, g.cavR);
  if (!g.gravid) {
    // The cavity narrows to the internal os through a short neck.
    // The neck now runs up behind the bladder to the body that rests on it.
    const ist = nonpregIsthmus()[1];
    return smoothUnion(0.004, body, capsule([0, OS_Y - 0.002, canalZ(OS_Y - 0.002)], [0, ist.b[1], ist.b[2]], 0.0022, 0.0055));
  }
  return body;
}

function boxOf(g: UterusGeo, yMin = -0.014): { min: V3; max: V3 } {
  const [cx, cy, cz] = g.centre;
  const [rx, ry, rz] = g.radii;
  return { min: [cx - rx - 0.004, yMin, Math.min(CERVIX_B[2] - CERVIX_RB - 0.004, cz - rz - 0.004)], max: [cx + rx + 0.004, cy + ry + 0.004, cz + rz + 0.004] };
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

/* ===================================================================================== */
/* FINER STRUCTURES AND THE NEW LEVEL-1 PARTS                                            */
/* ===================================================================================== */

const bead = (c: V3, r: V3, w = 12, h = 8): THREE.BufferGeometry => {
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(r[0], r[1], r[2]);
  g.translate(c[0], c[1], c[2]);
  return g;
};

const addV = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const frac = (x: number): number => x - Math.floor(x);
const unitV = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const crossV = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * The broad ligament's drawing frame at this week: a flat sheet hung from the level of the tube
 * (so it grows with the organ the same way the tube does), reaching out from the side of the
 * body. A display shape: the real fold drapes over the tube and the ovary and has an anterior and
 * a posterior leaf, which a single flat sheet cannot show.
 */
function broadFrame(g: UterusGeo, weeks: number): { top: number; ly: number; lx: number; cx: number; cz: number } {
  const top = tubeControl(weeks, 1)[0][1] - 0.002;
  const ly = Math.min(0.06, Math.max(0.022, 0.5 * g.radii[1]));
  const lx = 0.022 + 0.15 * g.radii[0];
  return { top, ly, lx, cx: 0.75 * g.radii[0] + 0.85 * lx, cz: g.centre[2] - 0.004 };
}

/** The ligaments and the veins: level-1 parts, drawn as centrelines on the same frame as the shell. */
function ligamentParts(g: UterusGeo, weeks: number): { id: string; geometry: THREE.BufferGeometry }[] {
  const out: { id: string; geometry: THREE.BufferGeometry }[] = [];
  const b = broadFrame(g, weeks);
  const sheets: THREE.BufferGeometry[] = [];
  const meso: THREE.BufferGeometry[] = [];
  const salp: THREE.BufferGeometry[] = [];
  const round: THREE.BufferGeometry[] = [];
  const sacral: THREE.BufferGeometry[] = [];
  const cardinal: THREE.BufferGeometry[] = [];
  const intra: THREE.BufferGeometry[] = [];
  const veins: THREE.BufferGeometry[] = [];
  const sc = Math.min(2.2, 1 + 0.35 * (g.radii[0] / 0.0235 - 1));
  for (const s of [1, -1]) {
    // BROAD LIGAMENT: the parent sheet is thicker than its two children so they sit inside it.
    sheets.push(bead([s * b.cx, b.top - b.ly, b.cz], [b.lx, b.ly, 0.0015], 20, 10));
    meso.push(bead([s * (b.cx - 0.1 * b.lx), b.top - 1.35 * b.ly, b.cz], [0.8 * b.lx, 0.5 * b.ly, 0.0009], 16, 8));
    salp.push(bead([s * b.cx, b.top - 0.2 * b.ly, b.cz], [0.5 * b.lx, 0.2 * b.ly, 0.0009], 16, 8));

    // ROUND LIGAMENT: from just below and in front of the tube, out and forward.
    const p0 = wallPoint(g, s, 0.5, 0.9);
    round.push(
      tubeAlong(
        [p0, addV(p0, [s * 0.012 * sc, -0.004 * sc, 0.006]), addV(p0, [s * 0.03 * sc, -0.013 * sc, 0.009]), addV(p0, [s * 0.05 * sc, -0.025 * sc, 0.01])],
        (t) => (g.gravid ? 0.0016 : 0.0011) - 0.0003 * t,
        { tubular: 24, radial: 6 },
      ),
    );

    // UTEROSACRAL and CARDINAL ligaments: fixed to the cervix, which does not move with the week.
    sacral.push(tubeAlong([[s * 0.008, 0.016, -0.007], [s * 0.012, 0.01, -0.02], [s * 0.012, 0.004, -0.036]], (t) => 0.0014 - 0.0004 * t, { tubular: 18, radial: 6 }));
    cardinal.push(tubeAlong([[s * 0.01, 0.012, 0.0], [s * 0.026, 0.01, 0.002], [s * 0.045, 0.007, 0.003]], (t) => 0.0018 - 0.0006 * t, { tubular: 18, radial: 6 }));

    // INTRAMURAL TUBE: from the outer end of the tube's own centreline inwards to the cavity corner.
    const c0 = tubeControl(weeks, s)[0];
    const corner: V3 = g.gravid ? [s * 0.3 * g.cavR[0], g.centre[1] + 0.75 * g.cavR[1], g.centre[2]] : [s * 0.009, 0.066, 0.02];
    intra.push(tubeAlong([c0, lerpV(c0, corner, 0.25), lerpV(c0, corner, 0.6), corner], () => 0.0008, { tubular: 16, radial: 6 }));

    // UTERINE VEINS: a trunk beside the artery, on the posterior side, and two branches.
    const trunk: V3[] = [-0.75, -0.45, -0.1, 0.25, 0.6, 0.85].map((v) => wallPoint(g, s, v, -0.45));
    veins.push(tubeAlong(trunk, () => (g.gravid ? 0.0019 : 0.0015), { tubular: 24, radial: 6 }));
    for (const v of [-0.2, 0.45]) {
      const pts: V3[] = [-0.45, -0.8, -1.15, -1.5].map((a) => wallPoint(g, s, v, a));
      veins.push(tubeAlong(pts, () => 0.0007, { tubular: 10, radial: 5 }));
    }
  }
  out.push({ id: 'broad_ligament', geometry: mergeParts(sheets) });
  out.push({ id: 'mesometrium', geometry: mergeParts(meso) });
  out.push({ id: 'mesosalpinx', geometry: mergeParts(salp) });
  out.push({ id: 'round_ligament', geometry: mergeParts(round) });
  out.push({ id: 'uterosacral_ligaments', geometry: mergeParts(sacral) });
  out.push({ id: 'cardinal_ligaments', geometry: mergeParts(cardinal) });
  out.push({ id: 'intramural_tube', geometry: mergeParts(intra) });
  out.push({ id: 'uterine_veins', geometry: mergeParts(veins) });
  return out;
}

function lerpV(a: V3, b: V3, t: number): V3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * The five children of the endometrium. All of them are cut from `liningField`, the same field the
 * lining itself is polygonised from, so they follow it in every week (the placental site is
 * already subtracted from it in pregnancy) and, because they ride their parent's pose, they
 * thicken, thin and darken with it. Layers are measured by depth below the cavity wall using the
 * cavity ellipsoid's own field, which is only approximately a distance: the depths are drawing
 * proportions (the basal layer is the outer part, the functional layer the rest) and no thickness
 * is a measurement. The glands and spiral arteries start in the basal layer and are walked
 * inward until the lining field ends, so they can never leave the lining.
 */
function endometriumKids(g: UterusGeo, liningField: Sdf, cavE: Sdf, lining: number): { id: string; geometry: THREE.BufferGeometry }[] {
  const [cx, cy, cz] = g.centre;
  const bt = g.gravid ? 0.4 * lining : Math.min(0.0016, 0.3 * g.cavR[2]);
  const F = g.gravid ? lining - bt : g.cavR[2] * 0.85 - bt;
  const cell = g.gravid ? g.cell : 0.0015;
  const lo: V3 = [cx - g.cavR[0] - 0.002, cy - g.cavR[1] - 0.002, cz - g.cavR[2] - 0.002];
  const hi: V3 = [cx + g.cavR[0] + 0.002, cy + g.cavR[1] + 0.002, cz + 0.002];
  const poly = (f: Sdf): THREE.BufferGeometry => polygonise(f, lo, hi, { cell });
  const both = (a: Sdf, b: Sdf): Sdf => (x, y, z) => Math.max(a(x, y, z), b(x, y, z));
  const basal = both(liningField, (x, y, z) => -(cavE(x, y, z) + bt));
  const functional = both(liningField, (x, y, z) => cavE(x, y, z) + bt);
  const stroma = both(both(liningField, (x, y, z) => cavE(x, y, z) + bt + 0.2 * F), (x, y, z) => -(cavE(x, y, z) + bt + 0.8 * F));

  const glands: THREE.BufferGeometry[] = [];
  const spirals: THREE.BufferGeometry[] = [];
  const inside = (p: V3): boolean => liningField(p[0], p[1], p[2]) < 0;
  const seeds = g.gravid ? 12 : 16;
  for (let i = 0; i < seeds * 2; i++) {
    const h1 = frac(0.618034 * (i + 1));
    const h2 = frac(0.7548776 * (i + 1) + 0.3);
    const v = -0.6 + 1.1 * h1;
    const phi = -Math.PI * (0.15 + 0.7 * h2);
    const q = Math.sqrt(1 - v * v);
    const p: V3 = [cx + g.cavR[0] * q * Math.cos(phi), cy + v * g.cavR[1], cz + g.cavR[2] * q * Math.sin(phi)];
    const n = unitV([-(p[0] - cx) / g.cavR[0] ** 2, -(p[1] - cy) / g.cavR[1] ** 2, -(p[2] - cz) / g.cavR[2] ** 2]);
    const s0 = 0.6 * bt;
    let d = s0;
    const step = Math.max(0.0001, F / 30);
    if (!inside(addV(p, n, d))) continue;
    while (d < 0.05 && inside(addV(p, n, d + step))) d += step;
    const len = 0.9 * d;
    if (len < s0 + 0.0012) continue;
    const e1 = unitV(crossV(n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const e2 = crossV(n, e1) as V3;
    if (i % 2 === 0 && glands.length < seeds) {
      const pts: V3[] = [];
      for (let k = 0; k <= 6; k++) {
        const t = k / 6;
        const wob = 0.0005 * Math.sin(t * 9.4 + i);
        pts.push(addV(addV(p, n, s0 + (len - s0) * t), e1, wob));
      }
      glands.push(tubeAlong(pts, () => 0.00035, { tubular: 10, radial: 4 }));
    } else if (spirals.length < Math.floor(seeds / 2)) {
      const pts: V3[] = [];
      for (let k = 0; k <= 14; k++) {
        const t = k / 14;
        const a = t * Math.PI * 5 + i;
        const r = 0.0005 * Math.sin(Math.PI * Math.min(1, t * 1.15));
        pts.push(addV(addV(addV(p, n, 0.5 * s0 + (len - 0.5 * s0) * t), e1, r * Math.cos(a)), e2, r * Math.sin(a)));
      }
      spirals.push(tubeAlong(pts, () => 0.0003, { tubular: 20, radial: 4 }));
    }
  }
  return [
    { id: 'basal_layer', geometry: poly(basal) },
    { id: 'functional_layer', geometry: poly(functional) },
    { id: 'endometrial_stroma', geometry: poly(stroma) },
    { id: 'uterine_glands', geometry: glands.length ? mergeParts(glands) : sliver() },
    { id: 'spiral_arteries', geometry: spirals.length ? mergeParts(spirals) : sliver() },
  ];
}

/** Placental layers across its thickness, the villi, and the first stretch of the cord. */
function placentaKids(g: UterusGeo, weeks: number): { id: string; geometry: THREE.BufferGeometry }[] {
  const [, cy] = g.centre;
  const y0 = cy + 0.3 * g.cavR[1];
  const h = g.radii[1] * 2 + 0.02;
  const thick = 0.006 + 0.014 * (h / 0.36);
  const lens = placentaLens(g, -0.0002);
  const wall = (x: number, y: number): number => posteriorWallZ(g, x, y);
  const a = 0.5 * g.cavR[0];
  const b = 0.38 * g.cavR[1];
  const zw = wall(0, y0);
  const lo: V3 = [-a - 0.002, y0 - b - 0.002, zw - 0.002];
  const hi: V3 = [a + 0.002, y0 + b + 0.002, zw + thick + 0.002];
  const cell = Math.max(0.0012, thick / 6);
  const slab = (z0: number, z1: number): Sdf => (x, y, z) => {
    const r = (z - wall(x, y)) / thick;
    return Math.max(lens(x, y, z), (r - z1) * thick, (z0 - r) * thick);
  };
  const out: { id: string; geometry: THREE.BufferGeometry }[] = [];
  out.push({ id: 'decidua_basalis', geometry: polygonise(slab(-0.05, 0.2), lo, hi, { cell }) });
  out.push({ id: 'intervillous_space', geometry: polygonise(slab(0.2, 0.86), lo, hi, { cell }) });
  out.push({ id: 'chorionic_plate', geometry: polygonise(slab(0.86, 1.05), lo, hi, { cell }) });

  // VILLI: fronds hung from the chorionic plate into the intervillous space; a stem and three twigs.
  const villi: THREE.BufferGeometry[] = [];
  const stemR = Math.min(0.0012, Math.max(0.0005, 0.07 * thick));
  const N = 22;
  for (let i = 0; i < N; i++) {
    const rr = Math.sqrt((i + 0.5) / N) * 0.8;
    const th = i * 2.399963;
    const x = a * rr * Math.cos(th);
    const y = y0 + b * rr * Math.sin(th);
    const w = wall(x, y);
    const top: V3 = [x, y, w + 0.86 * thick];
    const fork: V3 = [x, y, w + 0.52 * thick];
    villi.push(tubeAlong([top, lerpV(top, fork, 0.5), fork], () => stemR, { tubular: 6, radial: 4 }));
    for (let k = 0; k < 3; k++) {
      const ang = th + (k * 2 * Math.PI) / 3;
      const reach = 0.12 * Math.min(a, b) * 0.5;
      const mid: V3 = [x + reach * 0.6 * Math.cos(ang), y + reach * 0.6 * Math.sin(ang), w + 0.4 * thick];
      const tip: V3 = [x + reach * Math.cos(ang), y + reach * Math.sin(ang), w + 0.26 * thick];
      villi.push(tubeAlong([fork, mid, tip], (t) => stemR * (0.8 - 0.4 * t), { tubular: 6, radial: 4 }));
    }
  }
  out.push({ id: 'chorionic_villi', geometry: mergeParts(villi) });

  // CORD: the first stretch, from the middle of the chorionic plate towards the middle of the cavity.
  const P0: V3 = [0, y0, zw + 0.93 * thick];
  const dir = unitV([g.centre[0] - P0[0], g.centre[1] - P0[1], g.centre[2] - P0[2]]);
  const dist = Math.hypot(g.centre[0] - P0[0], g.centre[1] - P0[1], g.centre[2] - P0[2]);
  const L = 0.6 * dist;
  const lat = unitV(crossV(dir, [1, 0, 0]));
  const path: V3[] = [P0, addV(addV(P0, dir, 0.35 * L), lat, 0.1 * L), addV(addV(P0, dir, 0.7 * L), lat, -0.1 * L), addV(P0, dir, L)];
  const R = Math.min(0.006, 0.0015 + 0.0035 * Math.min(1, weeks / 40)) * Math.min(1, dist / 0.03);
  out.push({ id: 'umbilical_cord', geometry: tubeAlong(path, () => R, { tubular: 24, radial: 12 }) });
  out.push({ id: 'whartons_jelly', geometry: tubeAlong(path, () => 0.82 * R, { tubular: 24, radial: 10 }) });
  const curve = new THREE.CatmullRomCurve3(path.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', 0.5);
  const samples = 30;
  const frames = curve.computeFrenetFrames(samples, false);
  const strand = (phase: number, rad: number): V3[] => {
    const pts: V3[] = [];
    const p = new THREE.Vector3();
    for (let i = 0; i <= samples; i++) {
      const u = i / samples;
      curve.getPointAt(u, p);
      const n = frames.normals[i];
      const bn = frames.binormals[i];
      const ang = phase + 2 * 2 * Math.PI * u;
      const c = Math.cos(ang) * rad;
      const s = Math.sin(ang) * rad;
      pts.push([p.x + n.x * c + bn.x * s, p.y + n.y * c + bn.y * s, p.z + n.z * c + bn.z * s]);
    }
    return pts;
  };
  out.push({
    id: 'cord_arteries',
    geometry: mergeParts([0, (2 * Math.PI) / 3].map((ph) => tubeAlong(strand(ph, 0.42 * R), () => 0.2 * R, { tubular: 40, radial: 6 }))),
  });
  out.push({ id: 'cord_vein', geometry: tubeAlong(strand((4 * Math.PI) / 3, 0.36 * R), () => 0.27 * R, { tubular: 40, radial: 8 }) });
  return out;
}

/** The sac's two membranes and the fluid: three closed surfaces, coarse because they are smooth. */
function sacKids(g: UterusGeo, weeks: number): { id: string; geometry: THREE.BufferGeometry }[] {
  const [cx, cy, cz] = g.centre;
  const sac = amnioticSacRadii(weeks);
  const cut = (grow: number): Sdf => placentaLens(g, grow);
  const surf = (d: number, lensGrow: number): THREE.BufferGeometry => {
    const r: V3 = [Math.max(0.4 * sac[0], sac[0] + d), Math.max(0.4 * sac[1], sac[1] + d), Math.max(0.4 * sac[2], sac[2] + d)];
    return polygonise(subtract(ellipsoid(g.centre, r), cut(lensGrow)), [cx - r[0] - 0.002, cy - r[1] - 0.002, cz - r[2] - 0.002], [cx + r[0] + 0.002, cy + r[1] + 0.002, cz + r[2] + 0.002], { cell: 2 * g.cell });
  };
  return [
    { id: 'amnion', geometry: surf(-0.0005, 0.001) },
    { id: 'chorion', geometry: surf(0.0006, 0.001) },
    { id: 'amniotic_fluid', geometry: surf(-0.0022, 0.0025) },
  ];
}

export const PLACENTA_KIDS = ['chorionic_villi', 'intervillous_space', 'decidua_basalis', 'chorionic_plate', 'umbilical_cord', 'cord_arteries', 'cord_vein', 'whartons_jelly'] as const;
export const SAC_KIDS = ['amnion', 'chorion', 'amniotic_fluid'] as const;

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
    geometry: polygonise(cavity, [cx - g.cavR[0] - 0.003, OS_Y - 0.006, Math.min(cz - g.cavR[2] - 0.003, CERVIX_B[2] - 0.012)], [cx + g.cavR[0] + 0.003, cy + g.cavR[1] + 0.003, cz + g.cavR[2] + 0.003], { cell: g.cell }),
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
    min: [cx - g.cavR[0] - layerT - 0.002, y0, Math.min(cz - g.cavR[2] - layerT - 0.002, CERVIX_B[2] - 0.012)],
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
      [-0.014, -0.014, CERVIX_B[2] - CERVIX_RB - 0.002],
      [0.014, OS_Y, CERVIX_A[2] + CERVIX_RA + 0.004],
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

  // FINER STRUCTURES and the new level-1 parts (see "FINER STRUCTURES" in the header).
  out.push(...ligamentParts(g, weeks));
  out.push(...endometriumKids(g, liningField, cavE, lining));
  if (hasPlacenta) {
    out.push(...placentaKids(g, weeks), ...sacKids(g, weeks));
  } else {
    for (const id of [...PLACENTA_KIDS, ...SAC_KIDS]) out.push({ id, geometry: sliver() });
  }
  return out;
};
