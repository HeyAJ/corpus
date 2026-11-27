import * as THREE from 'three';
import { mergeParts, tubeAlong, type Sdf, type V3 } from '../sdf';
import { warpOffsetY } from '../layout';
import { ribPointsBody, manubriumField } from './thoracic_cage';
import { COLUMN_LEVELS, bodyFrontAt, placement, vertebraParts } from './vertebral_column';
import { CLAVICLE_PTS, scapulaZ } from './upper_limb_bones';
import { outerEnvelope, mandibleField, hyoidField } from './skull';

/**
 * HEAD AND NECK MUSCLES, SHELL AND PART GEOMETRY. A LAYER organ of the muscles layer, in the
 * cranial group.
 *
 * FRAME. Origin organs.json [0, 0.42, 0], the same origin as the skull and the brain, and the
 * cranial group's +0.06 lift (`GROUP_Y`), which the renderer adds back. Every muscle of
 * mastication attaches to the skull, so this organ's position is the skull's. A point on the
 * skull is written in the SKULL's own local numbers and needs no conversion; a point on the neck
 * or the chest is a body coordinate and is brought here by `Frame.warp` (the exploded stack's
 * continuous warp, the same function the cervical column, the pharynx and the spinal cord use).
 *
 * WHERE EVERY END IS. A muscle end is not placed by eye. Each end is SEATED on the bone it
 * attaches to: `seat` moves a starting guess along the gradient of that bone's own field (the
 * skull's envelope, the mandible, the hyoid, the manubrium, a vertebra's transverse process, the
 * clavicle, a rib) until it stands exactly one end-radius plus 0.2 mm off the surface. So an
 * attachment is on the bone it names by construction, and cannot sink into it. The probe
 * `mu1/probe.ts` (agent mu1) prints the worst distance of an end from its bone (must be 3 mm or
 * less) and the worst penetration of any belly into a bone.
 *
 * TREE. Existing ids are kept (share links and tests use them), so the five groups the first
 * pass drew stay level-1 parts: `mastication_muscles`, `hyoid_muscles`, `scalene_muscles`,
 * `prevertebral_muscles` and `sternocleidomastoid`, plus a new `platysma`. Gray's groups the
 * muscles that way too. Each named muscle is a CHILD of its group and the finer structures
 * (heads, bellies, intermediate tendons) are grandchildren, which is the deepest level allowed
 * (`MAX_PART_DEPTH` 3). A parent is drawn as the union of its children at full radius and each
 * child at `CHILD_SLIM` of its parent's radius, so when a group is focused and its own glass
 * drops, the muscles stand inside its silhouette instead of fighting it for the same surface.
 *
 * WHAT IS NOT DRAWN: the muscles of facial expression, the tongue and soft palate (the mouth
 * atlas), the pharyngeal constrictors (the pharynx atlas), the muscles of the larynx, the
 * rectus capitis muscles and the small suboccipital group (the back muscles' organ). Widths and
 * thicknesses are DRAWING choices; the attachments are the bones'. Chewing, speech and head
 * movement are not simulated.
 */

/** The organ's origin, organs.json (the skull's). */
export const ORIGIN: V3 = [0, 0.42, 0];
/** The cranial group's offset in the exploded stack, organs.json groupLayout. */
export const GROUP_Y = 0.06;

/* ====================================================================== shared helpers
 * These are exported and imported by the chest wall and abdominal wall muscle shells, which are
 * written by the same agent. They replace the first-pass `muscle_stub.ts` helpers, so no
 * file of mine imports the stub. */

export type BG = THREE.BufferGeometry;

export interface Frame {
  /** Unexploded body point to this organ's frame, through the continuous warp (soft tissue, long structures). */
  warp: (p: V3) => V3;
  /** A point on a bone drawn rigidly with a group (`boneGroupY` is that group's offset). */
  rigid: (p: V3, boneGroupY: number) => V3;
  /** A point already in the exploded scene (a vertebra's placement). */
  scene: (p: V3) => V3;
}

/** The frame of an organ with the given origin and group offset (both taken away here, the renderer adds them back). */
export function localFrame(origin: V3, groupY: number): Frame {
  return {
    warp: (p) => [p[0] - origin[0], p[1] + warpOffsetY(p[1]) - origin[1] - groupY, p[2] - origin[2]],
    rigid: (p, g) => [p[0] - origin[0], p[1] + g - origin[1] - groupY, p[2] - origin[2]],
    scene: (p) => [p[0] - origin[0], p[1] - origin[1] - groupY, p[2] - origin[2]],
  };
}
const F = localFrame(ORIGIN, GROUP_Y);

/** Mirror a right-hand point to the given side (+1 the patient's right, -1 the left). */
export const onSide = (p: readonly number[], side: number): V3 => [side * p[0], p[1], p[2]];

/** Both sides of a pair. */
export function bothSides(make: (side: number) => BG[]): BG[] {
  return [...make(1), ...make(-1)];
}

/**
 * How much slimmer a child is drawn than its parent. A parent is the union of its children at
 * scale 1 and a child is drawn at this fraction of the scale its parent is drawn at, so a child
 * stands INSIDE its parent's silhouette. A display choice.
 */
export const CHILD_SLIM = 0.82;

/** A point moved along the gradient of a field until it is `clear` from the surface (negative = inside). */
export function seat(f: Sdf, p: V3, clear: number): V3 {
  const q: [number, number, number] = [p[0], p[1], p[2]];
  const e = 0.0004;
  for (let i = 0; i < 8; i++) {
    const d = f(q[0], q[1], q[2]);
    const gx = f(q[0] + e, q[1], q[2]) - f(q[0] - e, q[1], q[2]);
    const gy = f(q[0], q[1] + e, q[2]) - f(q[0], q[1] - e, q[2]);
    const gz = f(q[0], q[1], q[2] + e) - f(q[0], q[1], q[2] - e);
    const n = Math.hypot(gx, gy, gz) || 1;
    const step = d - clear;
    q[0] -= (gx / n) * step;
    q[1] -= (gy / n) * step;
    q[2] -= (gz / n) * step;
    if (Math.abs(step) < 1e-5) break;
  }
  return q;
}

/** The distance field of a thin tube along a polyline (a rib, the clavicle). */
export function polySdf(pts: readonly V3[], r: number | ((t: number) => number)): Sdf {
  return (x, y, z) => {
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const bx = b[0] - a[0];
      const by = b[1] - a[1];
      const bz = b[2] - a[2];
      const l2 = bx * bx + by * by + bz * bz || 1e-12;
      let t = ((x - a[0]) * bx + (y - a[1]) * by + (z - a[2]) * bz) / l2;
      t = Math.max(0, Math.min(1, t));
      const rad = typeof r === 'number' ? r : r((i + t) / (pts.length - 1));
      best = Math.min(best, Math.hypot(x - a[0] - bx * t, y - a[1] - by * t, z - a[2] - bz * t) - rad);
    }
    return best;
  };
}

/**
 * A MUSCLE BELLY: a tube along a smooth path whose radius swells from `ends` of its maximum at
 * both ends to the maximum in the middle (`shape` below 1 flattens the swell into a plumper
 * belly). `k` scales the radius (a child is drawn slimmer than its parent). Ends are tapered,
 * not closed: the material draws both faces, so a small open end is not seen.
 */
export function belly(points: readonly V3[], rMax: number, k = 1, o: { ends?: number; shape?: number; tubular?: number; radial?: number; skew?: number } = {}): BG {
  const ends = o.ends ?? 0.3;
  const shape = o.shape ?? 0.6;
  const skew = o.skew ?? 0.5;
  return tubeAlong(
    points,
    (t) => {
      // `skew` moves the thickest point towards the origin (<0.5) or the insertion (>0.5).
      const u = skew === 0.5 ? t : t < skew ? (0.5 * t) / skew : 0.5 + (0.5 * (t - skew)) / (1 - skew);
      return rMax * k * (ends + (1 - ends) * Math.pow(Math.max(0, Math.sin(Math.PI * u)), shape));
    },
    { tubular: o.tubular ?? 12, radial: o.radial ?? 6 },
  );
}

/** A TENDON: a thin tube of even radius. */
export function tendon(points: readonly V3[], r: number, k = 1, tubular = 8): BG {
  return tubeAlong(points, () => r * k, { tubular, radial: 4 });
}

/** A closed SLAB along a parametric surface, standing `thick` off it away from `away`. Four edge strips close it. */
export function slab(point: (u: number, v: number) => V3, thick: number, nu: number, nv: number, away: V3): BG {
  const P = (u: number, v: number): THREE.Vector3 => {
    const p = point(Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v)));
    return new THREE.Vector3(p[0], p[1], p[2]);
  };
  const e = 0.01;
  const centre = P(0.5, 0.5);
  const nc = new THREE.Vector3().crossVectors(P(0.5 + e, 0.5).sub(P(0.5 - e, 0.5)), P(0.5, 0.5 + e).sub(P(0.5, 0.5 - e)));
  const sign = nc.dot(centre.clone().sub(new THREE.Vector3(away[0], away[1], away[2]))) >= 0 ? 1 : -1;
  const pos: number[] = [];
  const idx: number[] = [];
  const vertex = (i: number, j: number, layer: number): number => {
    const u = i / nu;
    const v = j / nv;
    const p = P(u, v);
    const n = new THREE.Vector3().crossVectors(P(u + e, v).sub(P(u - e, v)), P(u, v + e).sub(P(u, v - e))).normalize().multiplyScalar(sign * thick * layer);
    p.add(n);
    pos.push(p.x, p.y, p.z);
    return pos.length / 3 - 1;
  };
  const inner: number[][] = [];
  const outer: number[][] = [];
  for (let j = 0; j <= nv; j++) {
    inner.push([]);
    outer.push([]);
    for (let i = 0; i <= nu; i++) {
      inner[j].push(vertex(i, j, 0));
      outer[j].push(vertex(i, j, 1));
    }
  }
  const quad = (a: number, b: number, c: number, d: number): void => {
    idx.push(a, b, c, a, c, d);
  };
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      quad(outer[j][i], outer[j][i + 1], outer[j + 1][i + 1], outer[j + 1][i]);
      quad(inner[j][i], inner[j + 1][i], inner[j + 1][i + 1], inner[j][i + 1]);
    }
  }
  for (let i = 0; i < nu; i++) {
    quad(inner[0][i], inner[0][i + 1], outer[0][i + 1], outer[0][i]);
    quad(outer[nv][i], outer[nv][i + 1], inner[nv][i + 1], inner[nv][i]);
  }
  for (let j = 0; j < nv; j++) {
    quad(outer[j][0], outer[j + 1][0], inner[j + 1][0], inner[j][0]);
    quad(inner[j][nu], inner[j + 1][nu], outer[j + 1][nu], outer[j][nu]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  // A negative signed volume means the triangles are wound inside-out; flip them all.
  let volume = 0;
  const q = new THREE.Vector3();
  const r = new THREE.Vector3();
  const s = new THREE.Vector3();
  for (let t = 0; t < idx.length; t += 3) {
    q.set(pos[idx[t] * 3], pos[idx[t] * 3 + 1], pos[idx[t] * 3 + 2]);
    r.set(pos[idx[t + 1] * 3], pos[idx[t + 1] * 3 + 1], pos[idx[t + 1] * 3 + 2]);
    s.set(pos[idx[t + 2] * 3], pos[idx[t + 2] * 3 + 1], pos[idx[t + 2] * 3 + 2]);
    volume += q.dot(r.cross(s));
  }
  if (volume < 0) {
    for (let t = 0; t < idx.length; t += 3) {
      const tmp = idx[t + 1];
      idx[t + 1] = idx[t + 2];
      idx[t + 2] = tmp;
    }
    g.setIndex(idx);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * A SHEET OR FAN between lines. `rows` are two or more polylines (the origin line, optionally a
 * line in between that lifts the sheet over a bulge, the insertion line); the sheet passes a
 * smooth curve through the three points at each `u`. This is how every broad muscle is drawn:
 * a temporalis fanning from the fossa to the coronoid, a mylohyoid from the jaw to the raphe, a
 * platysma, an intercostal between two ribs. `k` scales the thickness.
 */
export function ruled(rows: readonly (readonly V3[])[], thick: number, nu: number, nv: number, away: V3, k = 1): BG {
  const curves = rows.map((r) => new THREE.CatmullRomCurve3(r.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', 0.5));
  const point = (u: number, v: number): V3 => {
    const pts = curves.map((c) => c.getPointAt(u));
    if (pts.length === 2) return [pts[0].x + (pts[1].x - pts[0].x) * v, pts[0].y + (pts[1].y - pts[0].y) * v, pts[0].z + (pts[1].z - pts[0].z) * v];
    const c = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5).getPoint(v);
    return [c.x, c.y, c.z];
  };
  return slab(point, thick * k, nu, nv, away);
}

/** One leaf of a part tree: how to draw it at scale `k`, for the patient's right (+1) or left (-1). */
export interface MuscleSpec {
  parent?: string;
  /** Children are drawn by their own spec; a parent with `kids` is the union of them. */
  kids?: string[];
  make?: (k: number, side: number) => BG[];
}

/** Draw a spec (and, for a parent, all its descendants) at scale `k` for both sides. */
export function drawSpec(all: Record<string, MuscleSpec>, id: string, k: number): BG[] {
  const s = all[id];
  if (s.kids) return s.kids.flatMap((c) => drawSpec(all, c, k));
  const make = s.make as (k: number, side: number) => BG[];
  return bothSides((side) => make(k, side));
}

/** Depth of a part in its tree: 1 for a level-1 part. */
export function depthOf(all: Record<string, MuscleSpec>, id: string): number {
  let d = 1;
  let p = all[id].parent;
  while (p) {
    d++;
    p = all[p].parent;
  }
  return d;
}

/** The geometry of every part, keyed by id: a part is drawn at CHILD_SLIM to the power of its depth minus one. */
export function groupsOf(all: Record<string, MuscleSpec>): Record<string, BG[]> {
  const out: Record<string, BG[]> = {};
  for (const id of Object.keys(all)) out[id] = drawSpec(all, id, Math.pow(CHILD_SLIM, depthOf(all, id) - 1));
  return out;
}

/** Ids of the level-1 parts of a spec table, in order. */
export const levelOne = (all: Record<string, MuscleSpec>): string[] => Object.keys(all).filter((id) => !all[id].parent);

/* ============================================================================ the bones */

let skullFieldCache: Sdf | null = null;
/** The skull's solid envelope, the mandible and the hyoid as one field, in the skull's own frame (= this organ's frame). */
const skullField = (): Sdf => {
  if (!skullFieldCache) {
    const env = outerEnvelope();
    const jaw = mandibleField();
    const hy = hyoidField();
    skullFieldCache = (x, y, z) => Math.min(env(x, y, z), jaw(x, y, z), hy(x, y, z));
  }
  return skullFieldCache;
};
const jawField = (): Sdf => {
  const jaw = mandibleField();
  const hy = hyoidField();
  return (x, y, z) => Math.min(jaw(x, y, z), hy(x, y, z));
};

/** A skull-frame point seated on the skull, mandible or hyoid. */
const onSkull = (p: V3, clear: number): V3 => seat(skullField(), p, clear);
const onJaw = (p: V3, clear: number): V3 => seat(jawField(), p, clear);
/** A skull-frame point seated on the hyoid alone (the mandible lies within 6 mm of it in this model, so the jaw's field would pull an end onto the jaw). */
const onHyoid = (p: V3, clear: number): V3 => seat(hyoidField(), p, clear);
/** A body point seated on a body-frame field, then brought to this frame by the warp. */
const onBody = (f: Sdf, p: V3, clear: number): V3 => F.warp(seat(f, p, clear));

const level = (id: string) => COLUMN_LEVELS.find((l) => l.id === id) ?? COLUMN_LEVELS[0];

/** A vertebra's whole field in SCENE coordinates (its placement undone). */
function vertebraScene(id: string): Sdf {
  const l = level(id);
  const inv = placement(l).clone().invert();
  const whole = vertebraParts(l).whole;
  const v = new THREE.Vector3();
  return (x, y, z) => {
    v.set(x, y, z).applyMatrix4(inv);
    return whole(v.x, v.y, v.z);
  };
}

/** A point on a cervical transverse process (tubercle `front` true for anterior, false for posterior), seated on that vertebra, in this frame. */
function transverseTip(id: string, side: number, front: boolean, clear: number): V3 {
  const l = level(id);
  // The transverse process's tip in the vertebra's own frame: x = canal + arch + length, z a little forward.
  const m = placement(l);
  const v = new THREE.Vector3(side * 0.0232, 0, 0.002 + (front ? 0.0035 : -0.0035)).applyMatrix4(m);
  const f = vertebraScene(id);
  return F.scene(seat(f, [v.x, v.y, v.z], clear));
}

const manubrium = manubriumField();

/** A point on the manubrium or the body of the sternum, in this frame, one `clear` off its surface. */
const onManubrium = (p: V3, clear: number): V3 => onBody(manubrium, p, clear);

const clavicleField = (side: number): Sdf => polySdf(CLAVICLE_PTS.map((p): V3 => [side * p[0], p[1], p[2]]), 0.0045);
const ribField = (n: number, side: number): Sdf => polySdf(ribPointsBody(n).map((p): V3 => [side * p[0], p[1], p[2]]), 0.0036);

/**
 * THE LUNG APEX, as an obstacle. The lung shell rises into the neck (its top is at scene y 0.326,
 * beside C7, well above the first rib), so a muscle that runs from the cervical column to the first
 * ribs has to pass over or round it, not through it. Tabulated from the right lung's own shell (the
 * x and z extent of its vertices in 2 cm slices, probed by agent mu1; the left lung is its mirror) so
 * this file need not import the model builders, which import this file. Only the apex is needed:
 * below y 0.23 the ribs themselves stand clear of the lung. A coarse ELLIPTICAL SLICE per level,
 * not the lung: it is for routing a belly, and is never drawn.
 */
const LUNG_APEX: readonly (readonly [number, number, number, number, number])[] = [
  // y, xmin, xmax, zmin, zmax
  [0.33, 0.046, 0.072, -0.024, 0.012],
  [0.31, 0.035, 0.088, -0.04, 0.028],
  [0.29, 0.032, 0.094, -0.047, 0.035],
  [0.27, 0.031, 0.1, -0.05, 0.039],
  [0.25, 0.031, 0.108, -0.052, 0.044],
  [0.23, 0.031, 0.12, -0.056, 0.052],
];
const LUNG_TOP = 0.3265;
const lungApex: Sdf = (x, y, z) => {
  const ax = Math.abs(x);
  if (y < 0.23) return 1;
  let r = LUNG_APEX[0];
  if (y < LUNG_APEX[0][0]) {
    let i = 0;
    while (i < LUNG_APEX.length - 2 && y < LUNG_APEX[i + 1][0]) i++;
    const a = LUNG_APEX[i];
    const b = LUNG_APEX[i + 1];
    const t = (a[0] - y) / (a[0] - b[0]);
    r = [y, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t, a[4] + (b[4] - a[4]) * t];
  }
  const rx = (r[2] - r[1]) / 2;
  const rz = (r[4] - r[3]) / 2;
  const q = Math.hypot((ax - (r[1] + r[2]) / 2) / rx, (z - (r[3] + r[4]) / 2) / rz);
  const lateral = (q - 1) * Math.min(rx, rz);
  return y > LUNG_TOP ? Math.hypot(Math.max(lateral, 0), y - LUNG_TOP) : lateral;
};

let neckBonesCache: Sdf | null = null;
/**
 * Every bone a neck muscle can meet, as one field in THIS frame: the skull, the mandible and the
 * hyoid, the cervical column and the first three thoracic vertebrae, the manubrium, both
 * clavicles and the first three ribs. A routed belly is kept clear of it (see `routed`).
 */
function neckBones(): Sdf {
  if (neckBonesCache) return neckBonesCache;
  const sk = skullField();
  const verts = COLUMN_LEVELS.slice(0, 10).map((l) => ({ y: l.y + warpOffsetY(l.y), f: vertebraScene(l.id) }));
  const flat: Sdf[] = [manubrium, clavicleField(1), clavicleField(-1)];
  for (const side of [1, -1]) for (let n = 1; n <= 3; n++) flat.push(ribField(n, side));
  neckBonesCache = (x, y, z) => {
    let d = sk(x, y, z);
    const sy = y + ORIGIN[1] + GROUP_Y;
    for (const v of verts) if (Math.abs(sy - v.y) < 0.03) d = Math.min(d, v.f(x, sy, z));
    if (sy < 0.34) for (const f of flat) d = Math.min(d, f(x, sy, z));
    d = Math.min(d, lungApex(x, sy, z));
    return d;
  };
  return neckBonesCache;
}

/**
 * A ROUTED BELLY: the path's own waypoints are subdivided, and every INTERIOR point that would
 * leave the belly inside a bone is pushed out until the belly's own radius clears it. The two end
 * points are the attachments and are left where `seat` put them. This is how a muscle wraps round
 * the angle of the jaw or the front of a rib instead of cutting through it.
 */
export function routed(f: Sdf, pts: readonly V3[], r: number, sub = 3): V3[] {
  const out: V3[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    for (let j = 1; j <= sub; j++) {
      const t = j / sub;
      const q: V3 = [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t, pts[i][2] + (pts[i + 1][2] - pts[i][2]) * t];
      const last = i === pts.length - 2 && j === sub;
      out.push(last || f(q[0], q[1], q[2]) >= r ? q : seat(f, q, r));
    }
  }
  return out;
}

/** A belly of the neck or head, routed round the bones. `side` mirrors the right-hand waypoints. */
function neckBelly(pts: readonly V3[], rMax: number, k: number, o: Parameters<typeof belly>[3] = {}): BG {
  return belly(routed(neckBones(), pts, rMax * k + 0.0003, 4), rMax, k, o);
}

/* ============================================================================ the muscles */

/** Thickness scale of the sheets, a drawing choice. */
const SHEET = 1;

const spec: Record<string, MuscleSpec> = {};

/* ---- the muscles of mastication ---- */

// TEMPORALIS: a fan from the temporal fossa (between the temporal lines and the zygomatic arch)
// to the coronoid process. The origin line stands 3 mm off the wall of the vault; the fan lifts
// 6 mm outward at its middle so its straight chord does not cut the skull's bulge or the arch.
spec.temporalis = {
  parent: 'mastication_muscles',
  make: (k, s) => {
    // The origin line follows the temporal fossa, 3.5 mm off the vault's wall, from the front (behind the orbit) over the top and down the back.
    const A: V3[] = ([
      [0.074, -0.004, 0.04],
      [0.076, 0.014, 0.022],
      [0.078, 0.02, -0.004],
      [0.076, 0.012, -0.026],
      [0.07, -0.008, -0.034],
    ] as V3[]).map((p) => onSkull(p, 0.0035));
    // The middle line hugs the wall just above the zygomatic arch: the skull's envelope is solid out to the arch, so the muscle passes down OUTSIDE it and turns in under the arch's lower edge.
    const M: V3[] = ([
      [0.078, -0.046, 0.04],
      [0.084, -0.046, 0.026],
      [0.086, -0.046, 0.008],
      [0.084, -0.046, -0.01],
      [0.08, -0.046, -0.022],
    ] as V3[]).map((p) => onSkull(p, 0.0045));
    // Below the arch the tendon comes in on the coronoid's lateral face, where there is room.
    const M2: V3[] = ([
      [0.074, -0.0585, 0.0245],
      [0.074, -0.0585, 0.0185],
      [0.074, -0.0585, 0.0135],
      [0.074, -0.0585, 0.0085],
      [0.074, -0.0585, 0.0035],
    ] as V3[]).map((p) => onSkull(p, 0.0045));
    const B: V3[] = ([
      [0.0615, -0.0625, 0.024],
      [0.0615, -0.0615, 0.0185],
      [0.0615, -0.0605, 0.0135],
      [0.0615, -0.0605, 0.0085],
      [0.0615, -0.0615, 0.0035],
    ] as V3[]).map((p) => onJaw(p, 0.0046));
    return [ruled([A, M, M2, B].map((r) => r.map((p) => onSide(p, s))), 0.0045, 8, 6, onSide([0.03, -0.01, 0], s), k * SHEET)];
  },
};

// MASSETER: two layers. The SUPERFICIAL part runs from the lower border of the front of the
// zygomatic arch down and back to the angle; the DEEP part from the back of the arch and its inner
// surface to the upper ramus. Both lie on the lateral face of the ramus plate (x 0.0545 plus its
// 3.6 mm half-thickness).
spec.masseter_superficial_part = {
  parent: 'masseter',
  make: (k, s) => {
    // Gray's: the superficial part of the parotid gland lies over the posterior masseter, so the masseter is drawn forward of the parotid (its angle end is brought forward along the lower border).
    const a = onSkull([0.0615, -0.0495, 0.038], 0.0034);
    const b = onJaw([0.0575, -0.1085, -0.0125], 0.0028);
    const m: V3 = [0.0655, -0.078, 0.0125];
    return [neckBelly([a, m, b].map((p) => onSide(p, s)), 0.0058, k, { shape: 0.45 })];
  },
};
spec.masseter_deep_part = {
  parent: 'masseter',
  make: (k, s) => {
    const a = onSkull([0.0625, -0.0495, 0.006], 0.0032);
    const b = onJaw([0.0585, -0.082, 0.004], 0.0028);
    const m: V3 = [0.064, -0.066, 0.0045];
    return [neckBelly([a, m, b].map((p) => onSide(p, s)), 0.0048, k, { shape: 0.5 })];
  },
};
spec.masseter = { parent: 'mastication_muscles', kids: ['masseter_superficial_part', 'masseter_deep_part'] };

// LATERAL PTERYGOID: an upper head from the infratemporal surface of the greater wing of the
// sphenoid and a lower head from the lateral surface of the lateral pterygoid plate, running back
// and out to the pterygoid fovea on the front of the neck of the mandible, medial to the ramus.
spec.lateral_pterygoid_upper_head = {
  parent: 'lateral_pterygoid',
  make: (k, s) => {
    const a = onSkull([0.034, -0.056, 0.016], 0.0028);
    const b = onJaw([0.0545, -0.0635, 0.0075], 0.0022);
    return [neckBelly([a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], b].map((p) => onSide(p, s)), 0.0034, k)];
  },
};
spec.lateral_pterygoid_lower_head = {
  parent: 'lateral_pterygoid',
  make: (k, s) => {
    const a = onSkull([0.0245, -0.071, 0.0255], 0.0028);
    const b = onJaw([0.0525, -0.0665, 0.0058], 0.0022);
    return [neckBelly([a, [0.0435, -0.0705, 0.0145], [0.0455, -0.0675, 0.0055], b].map((p) => onSide(p, s)), 0.0038, k)];
  },
};
spec.lateral_pterygoid = { parent: 'mastication_muscles', kids: ['lateral_pterygoid_upper_head', 'lateral_pterygoid_lower_head'] };

// MEDIAL PTERYGOID: from the medial surface of the lateral pterygoid plate (the pterygoid fossa)
// and the maxillary tuberosity down, back and out to the medial surface of the ramus near the angle.
spec.medial_pterygoid = {
  parent: 'mastication_muscles',
  make: (k, s) => {
    const a = onSkull([0.0165, -0.0825, 0.0285], 0.0034);
    const b = onJaw([0.0445, -0.1085, -0.0165], 0.0024);
    const m: V3 = [0.032, -0.0965, 0.007];
    return [neckBelly([a, m, b].map((p) => onSide(p, s)), 0.0052, k, { shape: 0.5 })];
  },
};

spec.mastication_muscles = { kids: ['temporalis', 'masseter', 'lateral_pterygoid', 'medial_pterygoid'] };

/* ---- the hyoid muscles (suprahyoid and infrahyoid) ---- */

/** Where the hyoid's body meets the greater horn: the sling that holds the digastric's tendon. */
const HYOID_SLING: V3 = onHyoid([0.0125, -0.1195, 0.0205], 0.0017);

// DIGASTRIC: a posterior belly from the mastoid notch, an intermediate tendon held to the hyoid by
// a fibrous sling, and an anterior belly to the digastric fossa of the mandible beside the midline.
const mastoidNotch = (): V3 => onSkull([0.05, -0.071, -0.03], 0.0028);
const digastricFossa = (): V3 => onJaw([0.0055, -0.1245, 0.0585], 0.0022);
spec.digastric_posterior_belly = {
  parent: 'digastric',
  make: (k, s) => [neckBelly([mastoidNotch(), [0.0545, -0.105, -0.0335], [0.043, -0.1285, -0.0245], [0.0265, -0.1295, -0.004], [0.0185, -0.1262, 0.0125], HYOID_SLING].map((p) => onSide(p, s)), 0.0034, k, { skew: 0.4 })],
};
spec.digastric_intermediate_tendon = {
  parent: 'digastric',
  make: (k, s) => [tendon([HYOID_SLING, [0.0125, -0.1205, 0.0215]].map((p) => onSide(p, s)), 0.0014, k, 4)],
};
spec.digastric_anterior_belly = {
  parent: 'digastric',
  make: (k, s) => [neckBelly([[0.0125, -0.1205, 0.0215], [0.0095, -0.1235, 0.039], digastricFossa()].map((p) => onSide(p, s)), 0.0034, k, { skew: 0.55 })],
};
spec.digastric = { parent: 'hyoid_muscles', kids: ['digastric_posterior_belly', 'digastric_intermediate_tendon', 'digastric_anterior_belly'] };

// STYLOHYOID: from the back of the styloid process near its base to the junction of the hyoid's
// body and greater horn, in front of the posterior belly of the digastric and splitting round its tendon.
spec.stylohyoid = {
  parent: 'hyoid_muscles',
  make: (k, s) => {
    const a = onSkull([0.0475, -0.0725, -0.0035], 0.0016);
    return [neckBelly([a, [0.031, -0.0955, 0.0095], onHyoid([0.0145, -0.1165, 0.0195], 0.0013)].map((p) => onSide(p, s)), 0.0022, k)];
  },
};

// MYLOHYOID: the muscular floor of the mouth, a sheet from the mylohyoid line on the inside of the
// mandible to a midline raphe and the hyoid body. Drawn as one sheet per side, joined at the raphe.
spec.mylohyoid = {
  parent: 'hyoid_muscles',
  make: (k, s) => {
    const line: V3[] = ([
      [0.0235, -0.111, 0.004],
      [0.0165, -0.111, 0.019],
      [0.0145, -0.111, 0.0335],
      [0.0135, -0.111, 0.0445],
      [0.0095, -0.111, 0.0555],
    ] as V3[]).map((p) => onJaw(p, 0.0036));
    const raphe: V3[] = [
      [0.0015, -0.1185, 0.0215],
      [0.0015, -0.1195, 0.0285],
      [0.0015, -0.1195, 0.0375],
      [0.0015, -0.1205, 0.0465],
      [0.0015, -0.1205, 0.0555],
    ];
    const mid = line.map((p, i): V3 => [(p[0] + raphe[i][0]) / 2, Math.min(p[1], raphe[i][1]) - 0.0034, (p[2] + raphe[i][2]) / 2]);
    return [ruled([line, mid, raphe].map((r) => r.map((p) => onSide(p, s))), 0.0022, 5, 3, onSide([0.015, -0.098, 0.03], s), k * SHEET)];
  },
};

// GENIOHYOID: a short strap from the inferior mental spine, inside the chin, back to the front of
// the hyoid body, lying above the mylohyoid beside the midline.
spec.geniohyoid = {
  parent: 'hyoid_muscles',
  make: (k, s) => [neckBelly([[0.0042, -0.1175, 0.0555], [0.0042, -0.1182, 0.0395], onHyoid([0.0045, -0.1182, 0.0268], 0.0017)].map((p) => onSide(p, s)), 0.0028, k, { ends: 0.45 })],
};

// STERNOHYOID and STERNOTHYROID: straps from the back of the manubrium (and the medial end of the
// clavicle) up the front of the neck, over the thyroid gland and trachea. The sternohyoid goes to the
// hyoid; the deeper sternothyroid stops at the oblique line of the thyroid cartilage.
spec.sternohyoid = {
  parent: 'hyoid_muscles',
  make: (k, s) => {
    const a = onManubrium([0.009, 0.269, 0.049], 0.0022);
    return [neckBelly([a, F.warp([0.0105, 0.318, 0.0255]), onHyoid([0.0085, -0.1195, 0.0236], 0.0016)].map((p) => onSide(p, s)), 0.0032, k, { ends: 0.4, shape: 0.4 })];
  },
};
spec.sternothyroid = {
  parent: 'hyoid_muscles',
  make: (k, s) => {
    const a = onManubrium([0.0075, 0.2655, 0.0475], 0.0022);
    return [neckBelly([a, F.warp([0.0115, 0.3155, 0.0185]), F.warp([0.0128, 0.3555, 0.0105])].map((p) => onSide(p, s)), 0.003, k, { ends: 0.4, shape: 0.4 })];
  },
};
// THYROHYOID: the short continuation of the sternothyroid from the oblique line of the thyroid
// cartilage up to the lower border of the greater horn and body of the hyoid.
spec.thyrohyoid = {
  parent: 'hyoid_muscles',
  make: (k, s) => [neckBelly([F.warp([0.0128, 0.3555, 0.0105]), onHyoid([0.0132, -0.1195, 0.0185], 0.0016), onHyoid([0.0125, -0.1195, 0.0198], 0.0017)].map((p) => onSide(p, s)), 0.0027, k, { ends: 0.5, shape: 0.5, tubular: 6 })],
};

// OMOHYOID: two bellies and an intermediate tendon that is tied down to the clavicle by fascia. The
// inferior belly starts at the upper border of the scapula near the suprascapular notch and crosses
// the lower neck; the superior belly climbs beside the sternohyoid to the lower border of the hyoid.
const omoNotch = (side: number): V3 => {
  const p: V3 = [0.126, 0.2655, scapulaZ(0.126, 0.2655) + 0.0012];
  return F.warp(onSide(p, side));
};
const OMO_TENDON: V3 = [0.0445, 0.341, 0.0115];
spec.omohyoid_inferior_belly = {
  parent: 'omohyoid',
  make: (k, s) => [neckBelly([omoNotch(s), F.warp(onSide([0.1, 0.318, -0.022], s)), F.warp(onSide([0.073, 0.343, -0.004], s)), F.warp(onSide(OMO_TENDON, s))], 0.0028, k, { ends: 0.45, tubular: 14 })],
};
spec.omohyoid_intermediate_tendon = {
  parent: 'omohyoid',
  make: (k, s) => [tendon([F.warp(onSide(OMO_TENDON, s)), F.warp(onSide([0.0425, 0.3475, 0.0165], s))], 0.0013, k, 3)],
};
spec.omohyoid_superior_belly = {
  parent: 'omohyoid',
  make: (k, s) => [neckBelly([F.warp(onSide([0.0425, 0.3475, 0.0165], s)), F.warp(onSide([0.026, 0.355, 0.0265], s)), onSide(onHyoid([0.0152, -0.1195, 0.0209], 0.0018), s)], 0.0028, k, { ends: 0.45 })],
};
spec.omohyoid = { parent: 'hyoid_muscles', kids: ['omohyoid_inferior_belly', 'omohyoid_intermediate_tendon', 'omohyoid_superior_belly'] };

spec.hyoid_muscles = { kids: ['digastric', 'stylohyoid', 'mylohyoid', 'geniohyoid', 'sternohyoid', 'omohyoid', 'sternothyroid', 'thyrohyoid'] };

/* ---- the sternocleidomastoid ---- */

// The SCM has a sternal head (from the front of the manubrium, a rounded tendon) and a clavicular
// head (from the upper surface of the medial third of the clavicle, fleshy and broader). They fuse
// and insert on the lateral surface of the mastoid process. The tube runs from the chest across the
// side of the neck, in front of the scalenes.
const mastoidTip = (): V3 => onSkull([0.067, -0.068, -0.036], 0.0026);
spec.scm_sternal_head = {
  parent: 'sternocleidomastoid',
  make: (k, s) => {
    const a = onManubrium([0.0105, 0.2695, 0.0605], 0.0036);
    return [neckBelly([a, F.warp([0.021, 0.3, 0.0325]), F.warp([0.0425, 0.343, 0.0015]), F.warp([0.0585, 0.372, -0.0345]), mastoidTip()].map((p) => onSide(p, s)), 0.0055, k, { skew: 0.55, shape: 0.5 })];
  },
};
spec.scm_clavicular_head = {
  parent: 'sternocleidomastoid',
  make: (k, s) => {
    const c = CLAVICLE_PTS[0];
    const a = onBody(clavicleField(1), [c[0] + 0.007, c[1] + 0.006, c[2] + 0.002], 0.0044);
    return [neckBelly([a, F.warp([0.0375, 0.322, 0.0225]), F.warp([0.049, 0.347, -0.0045]), F.warp([0.0615, 0.374, -0.0365]), mastoidTip()].map((p) => onSide(p, s)), 0.0055, k, { skew: 0.55, shape: 0.5 })];
  },
};
spec.sternocleidomastoid = { kids: ['scm_sternal_head', 'scm_clavicular_head'] };

/* ---- the scalenes ---- */

// Anterior scalene: anterior tubercles of the transverse processes of C3 to C6, to the scalene
// tubercle on the inner border of the first rib (between the subclavian vein in front and the
// artery behind). Drawn from C5's anterior tubercle, the middle of its origin.
const rib1Point = (side: number, t: number, clear: number): V3 => {
  const pts = ribPointsBody(1).map((p): V3 => [side * p[0], p[1], p[2]]);
  const c = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  const p = c.getPointAt(t);
  return onBody(ribField(1, side), [p.x, p.y, p.z], clear);
};
spec.scalenus_anterior = {
  parent: 'scalene_muscles',
  make: (k, s) => [neckBelly([transverseTip('c5', s, true, 0.0034), F.warp(onSide([0.035, 0.34, -0.01], s)), F.warp(onSide([0.034, 0.305, 0.0415], s)), rib1Point(s, 0.97, 0.0036)], 0.0042, k, { skew: 0.4 })],
};
// Middle scalene: posterior tubercles of the transverse processes of C2 to C7, to the upper surface of the first rib behind the groove for the subclavian artery.
spec.scalenus_medius = {
  parent: 'scalene_muscles',
  make: (k, s) => [neckBelly([transverseTip('c4', s, false, 0.0034), rib1Point(s, 0.22, 0.0036)], 0.0048, k, { skew: 0.4 })],
};
// Posterior scalene: posterior tubercles of C4 to C6 to the outer surface of the second rib.
spec.scalenus_posterior = {
  parent: 'scalene_muscles',
  make: (k, s) => {
    const rib = ribPointsBody(2).map((p): V3 => [s * p[0], p[1], p[2]]);
    const c = new THREE.CatmullRomCurve3(rib.map((p) => new THREE.Vector3(...p)));
    const p = c.getPointAt(0.35);
    const b = onBody(ribField(2, s), [p.x + s * 0.002, p.y + 0.001, p.z], 0.0042);
    return [neckBelly([transverseTip('c6', s, false, 0.0030), b], 0.0036, k, { skew: 0.4 })];
  },
};
spec.scalene_muscles = { kids: ['scalenus_anterior', 'scalenus_medius', 'scalenus_posterior'] };

/* ---- the prevertebral muscles ---- */

// LONGUS COLLI: on the front of the cervical column and the first three thoracic bodies, between
// the atlas's anterior tubercle and the third thoracic body; one strap here (its three parts
// are not drawn apart). Only as thick as the 4 mm gap the pharynx leaves (RETRO_GAP).
spec.longus_colli = {
  parent: 'prevertebral_muscles',
  make: (k, s) => {
    const ys = [0.381, 0.352, 0.323, 0.294, 0.265];
    return [neckBelly(ys.map((y) => F.warp(onSide([0.0075, y, bodyFrontAt(y) + 0.0018], s))), 0.0019, k, { ends: 0.7, shape: 0.3, tubular: 14, radial: 5 })];
  },
};
// LONGUS CAPITIS: from the anterior tubercles of the transverse processes of C3 to C6, up in front
// of longus colli to the inferior surface of the basilar part of the occipital bone.
spec.longus_capitis = {
  parent: 'prevertebral_muscles',
  make: (k, s) => {
    const top = onSkull([0.0105, -0.0775, -0.0135], 0.0016);
    const low = transverseTip('c5', s, true, 0.0034);
    return [neckBelly([low, F.warp(onSide([0.0155, 0.364, bodyFrontAt(0.364) + 0.0035], s)), onSide(top, s)], 0.0034, k, { skew: 0.35, ends: 0.35 })];
  },
};
spec.prevertebral_muscles = { kids: ['longus_colli', 'longus_capitis'] };

/* ---- the platysma ---- */

// PLATYSMA: a thin sheet in the superficial fascia, from the fascia over the upper chest and the
// clavicle up the front and side of the neck to the lower border of the mandible. It lies outside
// the sternocleidomastoid, so its middle line is lifted outward.
spec.platysma = {
  make: (k, s) => {
    const lo: V3[] = [0.02, 0.05, 0.08, 0.108].map((x, i): V3 => {
      const c = CLAVICLE_PTS[Math.min(CLAVICLE_PTS.length - 1, 1 + i)];
      return F.warp(onSide([c[0] * 0.5 + x * 0.5, c[1] + 0.0105, c[2] + 0.0035], s));
    });
    const hi: V3[] = ([
      [0.0105, -0.1295, 0.0585],
      [0.0225, -0.1295, 0.049],
      [0.0355, -0.126, 0.0285],
      [0.0485, -0.1225, -0.0075],
    ] as V3[]).map((p) => onSide(p, s));
    const mid: V3[] = lo.map((a, i): V3 => [(a[0] + hi[i][0]) / 2 + s * 0.0105, (a[1] + hi[i][1]) / 2, (a[2] + hi[i][2]) / 2 + 0.0085]);
    return [ruled([lo, mid, hi], 0.0016, 5, 5, onSide([0.01, -0.02, -0.02], s), k * SHEET)];
  },
};

/** The geometry of each part, keyed by the part's id in src/data/anatomy/head_neck_muscles.json. */
export function headNeckMuscleGroups(): Record<string, BG[]> {
  return groupsOf(spec);
}

/** The parent of each part (an id's entry is absent for a level-1 part): the atlas data must say the same. */
export const HEAD_NECK_PARENTS: Record<string, string | undefined> = Object.fromEntries(Object.entries(spec).map(([id, s]) => [id, s.parent]));

/** The shell is the level-1 parts only: a child is the same muscle drawn finer. */
export function headNeckMuscles(): THREE.BufferGeometry {
  const all = headNeckMuscleGroups();
  return mergeParts(levelOne(spec).flatMap((id) => all[id]));
}
