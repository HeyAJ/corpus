import * as THREE from 'three';
import {
  capsule,
  ellipsoid,
  mergeParts,
  polygonise,
  roundBox,
  smoothUnion,
  subtract,
  union,
  type Sdf,
  type V3,
} from '../sdf';
import { SPINAL_CORD_PATH } from '../paths';
import { warpOffsetY } from '../layout';
import { thoracicLevel } from './thoracic_cage';

/**
 * VERTEBRAL COLUMN, SHELL (and the vertebra fields its atlas is cut from). A LAYER organ and an
 * AXIAL one: authored in unexploded body coordinates (origin [0, 0, 0]) like the spinal cord it
 * encloses, +x the patient's right, +y cranial, +z anterior.
 *
 * WHY THE VERTEBRAE ARE RIGID AND THE DISCS ARE NOT. The cord is bent point by point by
 * `warpGeometry`. A vertebra bent the same way would be stretched 2.5 times where the abdominal
 * band of the exploded stack passes through it. Instead every vertebra is built upright, tilted
 * to the cord's own tangent and moved RIGIDLY by the warp offset at its centre, and the
 * intervertebral discs are the elastic part: each disc is drawn from the bottom face of the
 * vertebra above to the top face of the one below, so the exploded gaps open in the discs. The
 * canal axis is the cord's centreline at every level, and the probe in the atlas notes prints the
 * worst distance from any cord vertex to the canal axis against the canal radius.
 *
 * LEVELS. Seven cervical, twelve thoracic, five lumbar, the sacrum and the coccyx, as Gray's
 * counts. The heights are drawing choices in Gray's proportions (the cervical bodies the
 * smallest, the lumbar the largest, the lumbar discs the thickest), and the thoracic pitch is
 * solved so that the disc between L1 and L2 lies at the height where the cord shell ends
 * (the conus medullaris at body y 0.045, the cord's own `spinalCordRadius`): the cord model puts
 * its tip at L1-L2 and so must the column. The cord's cervical and lumbar enlargements then fall
 * in the cervical and lower thoracic vertebrae as in a textbook.
 *
 * THE NECK NOW FITS. It used not to: the oesophagus's back wall (z -0.029 from body y 0.34 to
 * 0.36) and the cord's front surface were the same place, so the bodies were clamped to 4 mm deep
 * and still overlapped the oesophagus and pharynx by 5 to 14.7 mm. The fix was to move the cervical
 * cord path back (paths.ts), which every consumer follows, and to remove the clamp: the cervical
 * bodies have their full Gray's depth again and clear the oesophagus and pharynx (measured by
 * the probe in the agent notes, signed distance from the body field to the shell vertices).
 *
 * IMPORT ORDER, FOR THE RECORD. The stub of this file read `SPINAL_CORD_PATH` inside its function
 * and said that was to dodge an import cycle with models.ts. That cycle no longer exists: the
 * path lives in paths.ts, which imports nothing, so it is imported at module level here and
 * models.ts and this file both depend on it and not on each other. (This file does import
 * shells/thoracic_cage.ts for the rib levels; that file imports neither models.ts nor this one.)
 *
 * Exported for the atlas; sizes are drawing choices, not measurements.
 */

/** Cord centreline plus the column's own continuation to the tip of the coccyx. */
export const COLUMN_PATH: V3[] = [...SPINAL_CORD_PATH, [0, -0.15, -0.066], [0, -0.2, -0.05]];

/** Height (body y) -> axis z (linear along the path, which falls with y). */
export function axisZ(y: number): number {
  const p = COLUMN_PATH;
  for (let i = 0; i < p.length - 1; i++) {
    if (y <= p[i][1] && y >= p[i + 1][1]) {
      const t = p[i][1] === p[i + 1][1] ? 0 : (p[i][1] - y) / (p[i][1] - p[i + 1][1]);
      return p[i][2] + (p[i + 1][2] - p[i][2]) * t;
    }
  }
  return y > p[0][1] ? p[0][2] : p[p.length - 1][2];
}

/** dz/dy of the axis at a height, central difference. */
function axisSlope(y: number): number {
  return (axisZ(y + 0.004) - axisZ(y - 0.004)) / 0.008;
}

/**
 * The tilt a vertebra is given, as a slope, which is the axis slope CAPPED. The cervical cord
 * path has to fall back steeply (about 1 in 1) between the brainstem and C3, because the head
 * sits further forward than the neck behind the pharynx and oesophagus (paths.ts). A vertebra
 * rotated by that whole slope (45 degrees) swings its front face forward at the top and puts
 * the atlas, axis and C3 back inside the pharynx, the very overlap the path move was meant to
 * remove, and a 45 degree cervical vertebra looks wrong besides: real cervical bodies are
 * close to horizontal. The tilt is therefore capped at 0.5 (about 27 degrees); the canal
 * then deviates from the cord's own line by a few millimetres across one body's height, which
 * the probe checks against the canal radius (the cord still has at least 1 mm of room). The
 * thoracic and lumbar slopes are all below the cap and are unchanged.
 */
const MAX_TILT_SLOPE = 0.5;
function tiltSlope(y: number): number {
  return Math.max(-MAX_TILT_SLOPE, Math.min(MAX_TILT_SLOPE, axisSlope(y)));
}

export type Kind = 'atlas' | 'axis' | 'cervical' | 'thoracic' | 'lumbar';

export interface Level {
  id: string; // c1 .. l5
  name: string; // C1 ..
  kind: Kind;
  /** Body-frame (unexploded) height of the vertebral body's centre. */
  y: number;
  /** Height of the body. */
  h: number;
  /** Index 0..23 from the top. */
  index: number;
}

const BODY_H = { atlas: 0.012, axis: 0.0145, cervical: 0.0105 };
const Y_TOP = 0.386;
const DISC = { cervical: 0.0034, lumbar: 0.0058 };

/**
 * Levels, top to bottom. The THORACIC levels are not mine to choose: the rib cage's own shell
 * (shells/thoracic_cage.ts, `thoracicLevel`) puts the head of rib n at the height of thoracic
 * vertebra n and the body BODY_BEHIND_CORD in front of the cord, so each thoracic vertebra is
 * centred at its height and the ribs meet their facets by construction. The cervical column is
 * scaled (`sC`, solved below) so that C7 ends one disc above T1, and the lumbar column hangs from
 * T12 with Gray's thicker discs. (An earlier draft solved the thoracic pitch so that the L1/L2
 * disc fell at the cord's conus, 0.045; that is dropped, because with the ribs' own pitch the conus
 * falls at T12-L1, a one-vertebra disagreement between two existing drawings that is not mine to
 * move. It is reported.)
 */
function layout(sC: number): { levels: Level[]; discAfter: number[]; end: number } {
  const levels: Level[] = [];
  const discAfter: number[] = [];
  let y = Y_TOP;
  const push = (name: string, kind: Kind, h: number, disc: number, yc?: number) => {
    const c = yc ?? y - h / 2;
    levels.push({ id: name.toLowerCase(), name, kind, y: c, h, index: levels.length });
    y = c - h / 2;
    discAfter.push(disc);
    y -= disc;
  };
  push('C1', 'atlas', BODY_H.atlas * sC, 0.002 * sC);
  push('C2', 'axis', BODY_H.axis * sC, DISC.cervical * sC);
  for (let i = 3; i <= 7; i++) push(`C${i}`, 'cervical', BODY_H.cervical * sC, DISC.cervical * sC);
  for (let i = 1; i <= 12; i++) push(`T${i}`, 'thoracic', 0.0165 + 0.0003 * (i - 1), 0.006, thoracicLevel(i));
  for (let i = 1; i <= 5; i++) push(`L${i}`, 'lumbar', 0.0185 + 0.0004 * (i - 1), i === 5 ? 0.0055 : DISC.lumbar);
  return { levels, discAfter, end: y + discAfter[discAfter.length - 1] };
}

function solveLayout() {
  // C7's lower face plus a disc must meet T1's upper face: bisection on the cervical scale.
  const gap = (sC: number) => {
    const { levels, discAfter } = layout(sC);
    const c7 = levels[6];
    return c7.y - c7.h / 2 - discAfter[6] - (levels[7].y + levels[7].h / 2);
  };
  let lo = 0.4;
  let hi = 1.3;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (gap(mid) > 0) lo = mid;
    else hi = mid;
  }
  return layout((lo + hi) / 2);
}

const LAYOUT = solveLayout();
export const COLUMN_LEVELS: readonly Level[] = LAYOUT.levels;
/** Disc thickness after each level (nominal, before the exploded stack opens it). */
export const DISC_AFTER: readonly number[] = LAYOUT.discAfter;
/** Top of the sacrum: the lower end of the last lumbar disc. */
export const SACRUM_TOP: number = LAYOUT.end;
export const SACRUM_BOTTOM = SACRUM_TOP - 0.09;
export const COCCYX_BOTTOM = -0.197;

/** Size parameters of one vertebra, all in the vertebra's own frame (origin on the canal axis, y up, z forward). */
export interface VertebraShape {
  hw: number;
  hh: number;
  hd: number;
  canalR: number;
  archR: number;
  spineLen: number;
  spineDrop: number;
  transLen: number;
  bifid: boolean;
  foramen: boolean;
  /** Where the body centre is, forward of the canal axis. */
  bodyZ: number;
}

export function shapeOf(level: Level): VertebraShape {
  const k = level.kind;
  const hh = level.h / 2;
  let base: Omit<VertebraShape, 'bodyZ' | 'hh'>;
  if (k === 'cervical' || k === 'axis') base = { hw: 0.0095, hd: 0.0072, canalR: 0.0095, archR: 0.0021, spineLen: 0.014, spineDrop: 0.002, transLen: 0.011, bifid: level.name !== 'C7', foramen: level.name !== 'C7', };
  else if (k === 'atlas') base = { hw: 0.0105, hd: 0.003, canalR: 0.0125, archR: 0.0022, spineLen: 0.003, spineDrop: 0, transLen: 0.013, bifid: false, foramen: true };
  else if (k === 'thoracic') base = { hw: 0.0125, hd: 0.0105, canalR: 0.0085, archR: 0.0025, spineLen: 0.02, spineDrop: 0.011, transLen: 0.015, bifid: false, foramen: false };
  else base = { hw: 0.0175, hd: 0.0125, canalR: 0.0095, archR: 0.003, spineLen: 0.016, spineDrop: 0.0, transLen: 0.015, bifid: false, foramen: false };
  if (level.name === 'C7') base = { ...base, spineLen: 0.021, spineDrop: 0.003 };
  const post = base.canalR + 0.0015;
  const hd = base.hd;
  return { ...base, hd, hh, bodyZ: post + hd };
}

/** The pieces of one vertebra, as separate fields in the vertebra's own frame. */
export interface VertebraParts {
  body: Sdf;
  pedicles: Sdf;
  laminae: Sdf;
  spinous: Sdf;
  transverse: Sdf;
  superior: Sdf;
  inferior: Sdf;
  /** The vertebral foramen: the lumen of the canal, to subtract. */
  lumen: Sdf;
  whole: Sdf;
}

export function vertebraParts(level: Level): VertebraParts {
  const s = shapeOf(level);
  const { hw, hh, hd, canalR, archR } = s;
  const bz = s.bodyZ;
  const a = canalR + archR + 0.0006; // arch ring radius
  const arc = (from: number, to: number): Sdf => {
    // an arc of the neural arch ring: capsules between points at angles measured from +z towards +x and -x
    const segs: Sdf[] = [];
    const n = 6;
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < n; i++) {
        const f0 = (from + ((to - from) * i) / n) * (Math.PI / 180);
        const f1 = (from + ((to - from) * (i + 1)) / n) * (Math.PI / 180);
        const p0: V3 = [side * a * Math.sin(f0), 0, a * Math.cos(f0)];
        const p1: V3 = [side * a * Math.sin(f1), 0, a * Math.cos(f1)];
        segs.push(capsule(p0, p1, archR));
      }
    }
    return union(...segs);
  };
  const flat = (f: Sdf, k: number): Sdf => (x, y, z) => f(x, y / k, z);
  const archHeight = Math.max(1, 1.5 * (hh / archR) * 0.5);
  const lumen: Sdf = (x, _y, z) => Math.hypot(x, z) - canalR;
  const body = subtract(roundBox([0, 0, bz], [hw, hh * 0.98, hd], Math.min(hh, hd) * 0.6), lumen);
  const pedicles = flat(arc(40, 85), archHeight);
  const laminae = flat(arc(95, 180), archHeight * 0.9);
  const tipZ = -(a + archR + s.spineLen);
  const spineBase: V3 = [0, 0, -(a + archR * 0.5)];
  const mk = (x: number): Sdf => capsule([x, 0, spineBase[2]], [x, -s.spineDrop, tipZ], archR * 0.85);
  const spinous = s.bifid ? union(mk(0.0022), mk(-0.0022)) : mk(0);
  const tr = (side: number): Sdf => capsule([side * a, 0, 0.002], [side * (a + s.transLen), 0, level.kind === 'thoracic' ? -0.004 : 0.002], archR * 1.15);
  const transverse = union(tr(1), tr(-1));
  const art = (y: number, dz: number): Sdf => union(
    ellipsoid([a, y, dz], [0.0032, 0.0034, 0.0034]),
    ellipsoid([-a, y, dz], [0.0032, 0.0034, 0.0034]),
  );
  const superior = art(hh * 1.05, -0.0015);
  const inferior = art(-hh * 1.05, -0.004);
  const holes: Sdf = s.foramen
    ? union(
        ...[1, -1].map((side) => (x: number, _y: number, z: number) => Math.hypot(x - side * (a + 0.006), z - 0.0) - 0.0024),
      )
    : () => 1;
  const solid = smoothUnion(0.0015, body, pedicles, laminae, spinous, transverse, superior, inferior);
  const whole: Sdf = (x, y, z) => Math.max(solid(x, y, z), -lumen(x, y, z), -holes(x, y, z));
  return {
    body,
    pedicles: (x, y, z) => Math.max(pedicles(x, y, z), -lumen(x, y, z)),
    laminae: (x, y, z) => Math.max(laminae(x, y, z), -lumen(x, y, z)),
    spinous,
    transverse: (x, y, z) => Math.max(transverse(x, y, z), -holes(x, y, z)),
    superior,
    inferior,
    lumen,
    whole,
  };
}

/** Local box that holds a vertebra. */
export function vertebraBox(level: Level): { min: V3; max: V3 } {
  const s = shapeOf(level);
  const a = s.canalR + s.archR + 0.0006;
  const w = Math.max(s.hw, a + s.transLen + 0.004);
  return { min: [-w, -s.hh * 1.3 - s.spineDrop, -(a + s.archR + s.spineLen + 0.003)], max: [w, s.hh * 1.3, s.bodyZ + s.hd + 0.003] };
}

/** The matrix that puts a vertebra built in its own frame where it is in the exploded body. */
export function placement(level: Level): THREE.Matrix4 {
  const y = level.y;
  const slope = tiltSlope(y);
  const m = new THREE.Matrix4().makeTranslation(0, y + warpOffsetY(y), axisZ(y));
  m.multiply(new THREE.Matrix4().makeRotationX(Math.atan(slope)));
  return m;
}

/** A vertebra as a mesh in the exploded body. */
export function vertebraMesh(level: Level, cell: number): THREE.BufferGeometry {
  const box = vertebraBox(level);
  const g = polygonise(vertebraParts(level).whole, box.min, box.max, { cell });
  g.applyMatrix4(placement(level));
  return g;
}

/**
 * The front face of the vertebral bodies as a function of body height (unexploded y), metres z,
 * for the pharynx to put its back wall against (shells/pharynx.ts). Each body's front face is a
 * flat plane tilted with the vertebra, so its z at height y is
 * zc + F sqrt(1 + m^2) + (y - yc) m with F the face's distance in front of the axis and m the
 * axis slope (the rotation in `placement`); the polyline through every face's top and bottom
 * end is interpolated linearly across the discs. The rounded edges of the box recede a little
 * from this plane, so it errs on the side of the wall being too far back, never inside the bone.
 * Only the cervical levels and the first three thoracic ones are listed because those are the
 * ones beside the pharynx and the oesophagus. Above the atlas it returns the atlas's own face.
 */
export function bodyFrontAt(y: number): number {
  const pts: [number, number][] = [];
  for (const l of COLUMN_LEVELS.slice(0, 10)) {
    const s = shapeOf(l);
    const F = s.bodyZ + s.hd;
    const m = tiltSlope(l.y);
    const c = Math.cos(Math.atan(m));
    const sn = Math.sin(Math.atan(m));
    const zc = axisZ(l.y);
    for (const ly of [l.h / 2, -l.h / 2]) pts.push([l.y - F * sn + ly * c, zc + ly * sn + F * c]);
  }
  pts.sort((a, b) => b[0] - a[0]);
  if (y >= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    if (y <= pts[i][0] && y >= pts[i + 1][0]) {
      const f = (pts[i][0] - y) / (pts[i][0] - pts[i + 1][0] || 1);
      return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f;
    }
  }
  return pts[pts.length - 1][1];
}

/** Faces of a vertebra's body, world: top and bottom y after the exploded stack's rigid shift. */
export function bodyFaces(level: Level): { top: number; bottom: number } {
  const shift = warpOffsetY(level.y);
  const c = Math.cos(Math.atan(tiltSlope(level.y)));
  return { top: level.y + shift + (level.h / 2) * c, bottom: level.y + shift - (level.h / 2) * c };
}

export interface DiscSpec {
  yTop: number;
  yBot: number;
  hw: number;
  hd: number;
  zc: number;
}

/** Where a disc is, in the exploded body: from the lower face of `upper` to the upper face of `lower`. */
export function discSpec(upper: Level, lower: Level): DiscSpec {
  const yTop = bodyFaces(upper).bottom;
  const yBot = bodyFaces(lower).top;
  const su = shapeOf(upper);
  const sl = shapeOf(lower);
  const yMid = (upper.y + lower.y) / 2;
  return {
    yTop,
    yBot,
    hw: (su.hw + sl.hw) / 2,
    hd: (su.hd + sl.hd) / 2,
    zc: axisZ(yMid) + (su.bodyZ + sl.bodyZ) / 2,
  };
}

/** An elliptical disc as a cylinder; the exploded stack's gap is simply a taller disc. */
export function discGeometry(upper: Level, lower: Level, segments = 20): THREE.BufferGeometry {
  const d = discSpec(upper, lower);
  const g = new THREE.CylinderGeometry(1, 1, Math.max(0.0008, d.yTop - d.yBot), segments, 1, false);
  g.deleteAttribute('uv');
  g.scale(d.hw, 1, d.hd);
  g.translate(0, (d.yTop + d.yBot) / 2, d.zc);
  return g;
}

/** The sacrum and the coccyx as one pair of fields in body coordinates (rigid below the pelvic band: the warp is applied by the caller). */
export function sacrumField(): Sdf {
  const top = SACRUM_TOP;
  const bottom = SACRUM_BOTTOM;
  const n = 5;
  const pieces: Sdf[] = [];
  for (let i = 0; i < n; i++) {
    const y = top - ((i + 0.5) / n) * (top - bottom);
    const f = i / (n - 1);
    const z = axisZ(y);
    const hw = 0.0185 - 0.0105 * f;
    pieces.push(ellipsoid([0, y, z + 0.0135 - 0.003 * f], [hw, (top - bottom) / n / 2 + 0.0014, 0.0115 - 0.003 * f])); // the fused body
    pieces.push(ellipsoid([0, y, z - 0.0085 + 0.002 * f], [0.0095 - 0.003 * f, (top - bottom) / n / 2 + 0.0012, 0.0045])); // the posterior wall with its crest
  }
  // The alae: wings out from the top two segments, carrying the auricular surfaces on their outer faces.
  const zA = axisZ(top - 0.015);
  for (const s of [1, -1]) pieces.push(ellipsoid([s * 0.027, top - 0.014, zA + 0.004], [0.0125, 0.0155, 0.0125]));
  // The promontory: the forward lip of the first segment.
  pieces.push(ellipsoid([0, top - 0.0025, axisZ(top) + 0.0255], [0.011, 0.0035, 0.0045]));
  const solid = smoothUnion(0.003, ...pieces);
  // The sacral canal: the axis, open at the back at the hiatus (the lowest 15 mm of the posterior wall).
  const canal: Sdf = (x, y, z) => {
    const r = 0.0058 - 0.003 * Math.max(0, (top - y) / (top - bottom));
    const d = Math.hypot(x, z - axisZ(y)) - r;
    const hiatus = y < bottom + 0.02 ? Math.max(Math.abs(x) - 0.0042, axisZ(y) - 0.012 - z + 0.0) : 1;
    return Math.min(d, hiatus < 0 ? hiatus : 1);
  };
  // Four pairs of foramina through the front, centred 12 mm out and level with the segments.
  const foramina = union(
    ...[1, 2, 3, 4].flatMap((k) => {
      const y = top - (k / n) * (top - bottom);
      return [1, -1].map((s) => capsule([s * 0.0125, y, axisZ(y) - 0.001], [s * 0.0125, y, axisZ(y) + 0.022], 0.0022));
    }),
  );
  return (x, y, z) => Math.max(solid(x, y, z), -canal(x, y, z), -foramina(x, y, z));
}

export function coccyxField(): Sdf {
  const n = 4;
  const pieces: Sdf[] = [];
  for (let i = 0; i < n; i++) {
    const y = SACRUM_BOTTOM - 0.004 - (i / (n - 1)) * (SACRUM_BOTTOM - COCCYX_BOTTOM - 0.008);
    const f = i / (n - 1);
    pieces.push(ellipsoid([0, y, axisZ(y) + 0.011 + 0.004 * f], [0.0075 - 0.0035 * f, 0.0048, 0.0065 - 0.002 * f]));
  }
  return smoothUnion(0.002, ...pieces);
}

/** Sacrum and coccyx as geometry, moved rigidly by the warp at their middle. */
export function sacrumGeometry(cell: number): THREE.BufferGeometry {
  const f = sacrumField();
  const g = polygonise(f, [-0.045, SACRUM_BOTTOM - 0.004, -0.08], [0.045, SACRUM_TOP + 0.004, 0.03], { cell });
  g.translate(0, warpOffsetY((SACRUM_TOP + SACRUM_BOTTOM) / 2), 0);
  return g;
}

export function coccyxGeometry(cell: number): THREE.BufferGeometry {
  const g = polygonise(coccyxField(), [-0.015, COCCYX_BOTTOM - 0.004, -0.07], [0.015, SACRUM_BOTTOM + 0.002, 0.0], { cell });
  g.translate(0, warpOffsetY(SACRUM_BOTTOM - 0.01), 0);
  return g;
}

/** The merged shell: every vertebra, the sacrum, the coccyx and the discs. */
export function vertebralColumn(): THREE.BufferGeometry {
  const cell = 0.0068;
  const parts: THREE.BufferGeometry[] = [];
  const L = COLUMN_LEVELS;
  for (const level of L) parts.push(vertebraMesh(level, cell));
  for (let i = 1; i < L.length - 1; i++) parts.push(discGeometry(L[i], L[i + 1], 14)); // C2/C3 .. L4/L5
  parts.push(discGeometry(L[L.length - 1], { ...L[L.length - 1], y: SACRUM_TOP - 0.004, h: 0.008 }, 14));
  parts.push(sacrumGeometry(0.0075));
  parts.push(coccyxGeometry(0.0075));
  return mergeParts(parts);
}
