import { SEGMENTS } from '../vascular/centrelines';
import { organDef, organPosition, warpPoint } from '../anatomy/layout';
import { gravidBody } from '../anatomy/models';
import { chain, smoothUnion, type Sdf, type V3 } from '../anatomy/sdf';

/**
 * THE GLASS FIGURE: one closed smooth surface drawn around the organs.
 *
 * WHY IT EXISTS. Thirty-two organs floated in empty space and nothing in the picture
 * said "this is a person": a visitor had to work out from the liver being on the left
 * that the pile of shapes was a torso. A faint figure around them gives the eye the
 * silhouette to hang the organs on, without ever competing with them.
 *
 * WHAT IT IS NOT, STATED FIRST BECAUSE IT IS EASY TO MISTAKE. It is not a measured
 * body and it carries no anthropometric number. Project rule 1 forbids inventing
 * physiological constants, and a body outline is made of exactly such constants (the
 * width of a pair of shoulders, the girth of a thigh), so none of them is typed in
 * here. The surface is DRAWN AROUND THE MODEL'S OWN DATA: at each height it is the
 * smallest ellipse that contains every organ vertex and every vessel at that height,
 * plus a skin margin. A wider organ makes a wider body; a female body is wider at the
 * chest because it has breasts and deeper at the abdomen when its uterus is gravid;
 * a male body is different below because it has a different organ set. The only
 * numbers that are typed are DISPLAY choices (the margins, the minimum limb radius,
 * the taper, the fade length), each commented where it is declared.
 *
 * THE SHAPE, in three parts that are blended into one surface by a smooth union:
 *  - a LOFT along the body's height (head, neck, chest, abdomen, pelvis): an ellipse
 *    per 12 mm slice, fitted to the points in that slice, then widened and smoothed
 *    along the height so the outline is a curve and not a staircase;
 *  - two ARMS, capsule chains along the subclavian and brachial centrelines;
 *  - two LEGS, capsule chains along the femoral and popliteal centrelines, with the
 *    radius at the hip taken from where the pelvis ends, so the thigh is flush with it.
 * The limbs exist only as far as the vessel data does (upper arm, thigh), so the
 * figure is a head-to-mid-thigh torso with upper arms, and `limbEnds` tells the mesh
 * builder where to fade them out instead of capping them.
 *
 * ENCLOSURE IS CHECKED, NOT HOPED FOR. After the field is composed it is evaluated at
 * every point it is meant to enclose; if any point is closer to the surface than
 * `MIN_INSIDE_M`, the whole surface is grown by the shortfall. In practice the slices
 * already contain their points and the correction is zero or a millimetre, but a
 * body-shaped function that quietly let an organ poke through would be the one bug a
 * reader could see at a glance, so it is guarded in the field itself and again in
 * `tests/render/body-outline.test.ts`.
 *
 * PREGNANCY. The abdomen follows the week through the gravid uterus alone: the
 * uterus's own sizing rule, `gravidBody(weeks)` from models.ts (fundal height from the
 * Williams Obstetrics landmarks, semi-axes as fixed fractions of it), supplies a ring
 * of points on its surface, and those points join the slice fitting like any organ's.
 * No growth curve is invented here; the belly is exactly as big as the uterus the
 * viewer is showing, plus the skin margin.
 *
 * Pure: no GL, no DOM, deterministic. The same input gives byte-identical values.
 */

/** Skin margin round the trunk, metres. A DISPLAY choice: the visible gap between an organ and the glass. */
export const SKIN_MARGIN_M = 0.03;
/** Margin round the neck and head, metres. A DISPLAY choice, smaller than the trunk's because the skull and the neck carry thinner cover than the chest wall; it is what lets the head read as wider than the neck. */
export const HEAD_MARGIN_M = 0.014;
/** A limb that carries only a thin vessel is drawn at least this thick, metres. A DISPLAY choice so an arm is not a wire. */
export const LIMB_MIN_RADIUS_M = 0.05;
/** Radius at the far end of an arm as a fraction of the shoulder's. A DISPLAY choice. */
export const ARM_TAPER = 0.8;
/** Radius at the far end of a leg as a fraction of the hip's. A DISPLAY choice. */
export const LEG_TAPER = 0.75;
/** A thigh's radius as a fraction of the distance of its axis from the midline, so the two thighs do not fuse. A DISPLAY choice. */
export const THIGH_GAP_FRACTION = 0.92;
/** Slices added beyond the highest and lowest data point, each smaller than the last, to round the crown and the foot. A DISPLAY choice. */
export const CAP_SLICES = 3;
/** Fillet radius where limbs meet the trunk, metres. A DISPLAY choice. */
export const BLEND_K_M = 0.04;
/** Slice spacing of the loft, metres. A DISPLAY choice (finer follows the organs more closely and costs more triangles). */
export const SLICE_DY_M = 0.012;
/** Every enclosed point sits at least this far inside the surface, metres. Guarded, see header. */
export const MIN_INSIDE_M = 0.006;
/** Length over which a limb end fades to nothing, metres. A DISPLAY choice. */
export const FADE_LENGTH_M = 0.05;

export interface OutlineBody {
  sex: 'male' | 'female';
  /** Gestational age, whole weeks; 0 when the body is not pregnant. */
  weeks: number;
}

export interface OutlineModel {
  /** The whole figure: negative inside. */
  field: Sdf;
  trunk: Sdf;
  arms: Sdf;
  legs: Sdf;
  min: V3;
  max: V3;
  /** Height at which the arms (elbow) and legs (last thigh point) end; the mesh fades towards them. */
  armEndY: number;
  legEndY: number;
  /** Lowest point of the figure (the bottom of the leg's end cap), for the floor shadow. */
  floorY: number;
}

/** Floats per sample in the input buffer: x, y, z, radius. */
export const SAMPLE_STRIDE = 4;

/** Points on a gravid uterus's surface, a latitude/longitude ring pattern, in the body frame. */
function gravidPoints(weeks: number, out: number[]): void {
  const { centre, radii } = gravidBody(weeks);
  const base = organPosition(organDef('uterus'));
  const rings = 9;
  const around = 20;
  for (let i = 0; i <= rings; i++) {
    const phi = (Math.PI * i) / rings;
    for (let j = 0; j < around; j++) {
      const theta = (2 * Math.PI * j) / around;
      out.push(
        base.x + centre[0] + radii[0] * Math.sin(phi) * Math.cos(theta),
        base.y + centre[1] + radii[1] * Math.cos(phi),
        base.z + centre[2] + radii[2] * Math.sin(phi) * Math.sin(theta),
        0,
      );
    }
  }
}

/** Every named vessel's control points (and the midpoints between them), moved by the exploded-stack warp. */
export function vesselPoints(out: number[]): void {
  for (const seg of SEGMENTS) {
    const r = Math.max(seg.radius_m[0], seg.radius_m[1]);
    for (let i = 0; i < seg.points.length; i++) {
      const p = warpPoint(seg.points[i]);
      out.push(p[0], p[1], p[2], r);
      if (i + 1 < seg.points.length) {
        const q = warpPoint(seg.points[i + 1]);
        out.push((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2, r);
      }
    }
  }
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Skip a limb's capsule chains far from the limb. A point outside the limb's padded
 * bounding box returns the distance to that box, which is a lower bound on the true
 * distance and positive, so it never changes which side of the surface the point is on;
 * inside the box (padded by the fillet radius) the real field is used, so the surface
 * and the blend are exact. This is only a speed measure: the chains are the expensive
 * part of the field and most grid points are nowhere near a limb.
 */
function limited(f: Sdf, axis: readonly V3[], radius: number): Sdf {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const p of axis) {
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
    y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
    z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]);
  }
  const pad = radius * 1.6 + BLEND_K_M * 2;
  x0 -= pad; y0 -= pad; z0 -= pad; x1 += pad; y1 += pad; z1 += pad;
  return (x, y, z) => {
    const dx = Math.max(x0 - x, 0, x - x1);
    const dy = Math.max(y0 - y, 0, y - y1);
    const dz = Math.max(z0 - z, 0, z - z1);
    if (dx > 0 || dy > 0 || dz > 0) return Math.hypot(dx, dy, dz) + BLEND_K_M * 2;
    return f(x, y, z);
  };
}

/** Warped control points of the segments whose ids are listed, in the order given. */
function axisPoints(ids: readonly string[]): V3[] {
  const out: V3[] = [];
  for (const id of ids) {
    const seg = SEGMENTS.find((s) => s.id === id);
    if (!seg) throw new Error(`outline: no vessel segment "${id}"`);
    for (let i = 0; i < seg.points.length; i++) {
      // Segments join end to end; keep one copy of the shared joint.
      if (i === 0 && out.length > 0) continue;
      out.push(warpPoint(seg.points[i]));
    }
  }
  return out;
}

function vesselRadius(id: string): number {
  const seg = SEGMENTS.find((s) => s.id === id);
  return seg ? Math.max(seg.radius_m[0], seg.radius_m[1]) : 0;
}

/**
 * Build the figure for one body.
 *
 * `samples` holds the organs' points (x, y, z, radius per point, in the unmirrored body
 * frame); the vessels and the gravid uterus are added here. The caller leaves the
 * uterus out of `samples` while the body is pregnant at six weeks or more (its mesh is
 * rebuilt per week in a worker and may lag), and always leaves the fetus out (it lies
 * inside the uterus by construction).
 */
export function outlineModel(samples: Float32Array, body: OutlineBody): OutlineModel {
  const pts: number[] = Array.from(samples);
  vesselPoints(pts);
  if (body.weeks >= 6) gravidPoints(body.weeks, pts);
  const n = pts.length / SAMPLE_STRIDE;

  // ---- the vertical extent -------------------------------------------------
  let yLo = Infinity;
  let yHi = -Infinity;
  for (let i = 0; i < n; i++) {
    const y = pts[i * 4 + 1];
    const r = pts[i * 4 + 3];
    if (y - r < yLo) yLo = y - r;
    if (y + r > yHi) yHi = y + r;
  }
  const dy = SLICE_DY_M;
  // CAP slices are added above and below the data so the crown of the head and the foot
  // of the figure are domes and not flat discs (see CAP_SLICES).
  yLo -= CAP_SLICES * dy;
  yHi += CAP_SLICES * dy;
  const count = Math.ceil((yHi - yLo) / dy) + 1;
  const y0 = yLo;

  // ---- per-slice extents ---------------------------------------------------
  // A point belongs to every slice within one spacing of it, so neighbouring slices
  // share their points and the fitted ellipses overlap instead of tiling.
  const xMin = new Float64Array(count).fill(Infinity);
  const xMax = new Float64Array(count).fill(-Infinity);
  const zMin = new Float64Array(count).fill(Infinity);
  const zMax = new Float64Array(count).fill(-Infinity);
  const sliceRange = (y: number): [number, number] => [
    Math.max(0, Math.ceil((y - dy - y0) / dy)),
    Math.min(count - 1, Math.floor((y + dy - y0) / dy)),
  ];
  for (let i = 0; i < n; i++) {
    const x = pts[i * 4];
    const y = pts[i * 4 + 1];
    const z = pts[i * 4 + 2];
    const r = pts[i * 4 + 3];
    const [s0, s1] = sliceRange(y);
    for (let s = s0; s <= s1; s++) {
      if (x - r < xMin[s]) xMin[s] = x - r;
      if (x + r > xMax[s]) xMax[s] = x + r;
      if (z - r < zMin[s]) zMin[s] = z - r;
      if (z + r > zMax[s]) zMax[s] = z + r;
    }
  }

  // ---- fit one ellipse per slice ------------------------------------------
  const cx = new Float64Array(count);
  const cz = new Float64Array(count);
  const hx = new Float64Array(count);
  const hz = new Float64Array(count);
  for (let s = 0; s < count; s++) {
    if (xMin[s] === Infinity) {
      hx[s] = -1; // empty: filled from its neighbours below
      continue;
    }
    cx[s] = (xMin[s] + xMax[s]) / 2;
    cz[s] = (zMin[s] + zMax[s]) / 2;
    hx[s] = Math.max((xMax[s] - xMin[s]) / 2, 1e-4);
    hz[s] = Math.max((zMax[s] - zMin[s]) / 2, 1e-4);
  }
  // Scale the half-extents up until every point of the slice is inside the ellipse:
  // the circumscribing ellipse of a box is sqrt(2) larger than the box, and a body of
  // rounded organs needs less than that, so find the smallest scale that works.
  const k = new Float64Array(count).fill(1);
  for (let i = 0; i < n; i++) {
    const x = pts[i * 4];
    const y = pts[i * 4 + 1];
    const z = pts[i * 4 + 2];
    const [s0, s1] = sliceRange(y);
    for (let s = s0; s <= s1; s++) {
      if (hx[s] < 0) continue;
      const u = (x - cx[s]) / hx[s];
      const v = (z - cz[s]) / hz[s];
      const kk = Math.hypot(u, v);
      if (kk > k[s]) k[s] = kk;
    }
  }
  for (let s = 0; s < count; s++) {
    if (hx[s] < 0) continue;
    hx[s] *= k[s];
    hz[s] *= k[s];
  }
  // Fill any empty slice from the nearest filled one on either side. Slices beyond the
  // first and last filled one are the caps: remember how far each is from the data.
  let firstFilled = 0;
  while (firstFilled < count && hx[firstFilled] < 0) firstFilled++;
  let lastFilled = count - 1;
  while (lastFilled > 0 && hx[lastFilled] < 0) lastFilled--;
  const capDistance = new Float64Array(count);
  for (let s = 0; s < count; s++) {
    if (s < firstFilled) capDistance[s] = firstFilled - s;
    else if (s > lastFilled) capDistance[s] = s - lastFilled;
  }
  for (let s = 0; s < count; s++) {
    if (hx[s] >= 0) continue;
    let a = s - 1;
    while (a >= 0 && hx[a] < 0) a--;
    let b = s + 1;
    while (b < count && hx[b] < 0) b++;
    const src = a >= 0 ? a : b;
    cx[s] = cx[src];
    cz[s] = cz[src];
    hx[s] = hx[src];
    hz[s] = hz[src];
  }

  // ---- widen, then smooth along the height --------------------------------
  // A maximum filter of radius two followed by a triangular blur of radius two can
  // only make a slice larger than it was (every neighbour in the blur window is the
  // maximum over a window that includes the slice itself), so the smoothing cannot
  // un-contain a point. The centres are blurred without the filter; the enclosure
  // check below absorbs the small error that leaves.
  const dilate = (src: Float64Array): Float64Array => {
    const out = new Float64Array(count);
    for (let s = 0; s < count; s++) {
      let m = -Infinity;
      for (let t = Math.max(0, s - 2); t <= Math.min(count - 1, s + 2); t++) if (src[t] > m) m = src[t];
      out[s] = m;
    }
    return out;
  };
  const blur = (src: Float64Array): Float64Array => {
    const w = [1, 2, 3, 2, 1];
    const out = new Float64Array(count);
    for (let s = 0; s < count; s++) {
      let sum = 0;
      let wsum = 0;
      for (let o = -2; o <= 2; o++) {
        const t = Math.max(0, Math.min(count - 1, s + o));
        sum += src[t] * w[o + 2];
        wsum += w[o + 2];
      }
      out[s] = sum / wsum;
    }
    return out;
  };
  const sx = blur(dilate(hx));
  const sz = blur(dilate(hz));
  const scx = blur(cx);
  const scz = blur(cz);

  // The skin margin eases from the trunk's to the head's across the neck. The head
  // starts where the brain does, so the margin follows the data, not a typed height.
  const neckY = organPosition(organDef('thyroid')).y;
  const marginAt = (y: number): number => {
    const t = smoothstep(neckY - 0.01, neckY + 0.05, y);
    return SKIN_MARGIN_M + (HEAD_MARGIN_M - SKIN_MARGIN_M) * t;
  };

  const ax = new Float64Array(count);
  const bz = new Float64Array(count);
  for (let s = 0; s < count; s++) {
    const m = marginAt(y0 + s * dy);
    // Cap slices shrink as a quarter-ellipse: the dome that closes the surface.
    const j = capDistance[s];
    const dome = j > 0 ? Math.sqrt(Math.max(0, 1 - (j / (CAP_SLICES + 1)) ** 2)) : 1;
    ax[s] = Math.max((sx[s] + m) * dome, 1e-3);
    bz[s] = Math.max((sz[s] + m) * dome, 1e-3);
  }
  const yTop = y0 + (count - 1) * dy;

  const trunk: Sdf = (x, y, z) => {
    const f = Math.max(0, Math.min(count - 1, (y - y0) / dy));
    const i = Math.min(count - 2, Math.floor(f));
    const t = f - i;
    const a = ax[i] + (ax[i + 1] - ax[i]) * t;
    const b = bz[i] + (bz[i + 1] - bz[i]) * t;
    const px = (x - (scx[i] + (scx[i + 1] - scx[i]) * t)) / a;
    const pz = (z - (scz[i] + (scz[i + 1] - scz[i]) * t)) / b;
    const k0 = Math.hypot(px, pz);
    const k1 = Math.hypot(px / a, pz / b);
    const d2 = k1 < 1e-9 ? -Math.min(a, b) : (k0 * (k0 - 1)) / k1;
    const out = y < y0 ? y0 - y : y > yTop ? y - yTop : 0;
    if (out === 0) return d2;
    // Beyond the first or last slice: the extrusion's rounded end, so the crown of the
    // head and the pelvic floor are closed rather than open tubes.
    return d2 > 0 ? Math.hypot(d2, out) : out;
  };

  // ---- limbs ----------------------------------------------------------------
  const armRadius = (id: string): number => Math.max(LIMB_MIN_RADIUS_M, vesselRadius(id) + SKIN_MARGIN_M);
  const armFor = (side: 'l' | 'r'): Sdf => {
    const pts3 = axisPoints([`subclavian_${side}`, `brachial_${side}`]);
    const r0 = Math.max(armRadius(`subclavian_${side}`), armRadius(`brachial_${side}`));
    const radii = pts3.map((_, i) => r0 * (1 - (1 - ARM_TAPER) * (i / (pts3.length - 1))));
    return chain(pts3, radii);
  };
  const arms = limited(smoothUnion(BLEND_K_M, armFor('l'), armFor('r')), [...axisPoints(['subclavian_l', 'brachial_l']), ...axisPoints(['subclavian_r', 'brachial_r'])], LIMB_MIN_RADIUS_M + SKIN_MARGIN_M);
  const armEndY = Math.min(...axisPoints(['brachial_l']).map((p) => p[1]), ...axisPoints(['brachial_r']).map((p) => p[1]));

  // The hip radius comes from the thigh's own axis: as wide as it can be without the
  // two thighs fusing at the midline (THIGH_GAP_FRACTION of the axis's distance from it).
  let legEndRadius = LIMB_MIN_RADIUS_M;
  const legFor = (side: 'l' | 'r'): Sdf => {
    const pts3 = axisPoints([`femoral_${side}`, `popliteal_${side}`]);
    const top = pts3[0];
    const r0 = Math.max(vesselRadius(`femoral_${side}`) + SKIN_MARGIN_M, Math.abs(top[0]) * THIGH_GAP_FRACTION);
    const radii = pts3.map((_, i) => r0 * (1 - (1 - LEG_TAPER) * (i / (pts3.length - 1))));
    legEndRadius = radii[radii.length - 1];
    return chain(pts3, radii);
  };
  const legs = limited(smoothUnion(BLEND_K_M, legFor('l'), legFor('r')), [...axisPoints(['femoral_l', 'popliteal_l']), ...axisPoints(['femoral_r', 'popliteal_r'])], LIMB_MIN_RADIUS_M);
  const legEndY = Math.min(...axisPoints(['popliteal_l']).map((p) => p[1]), ...axisPoints(['popliteal_r']).map((p) => p[1]));

  let field: Sdf = smoothUnion(BLEND_K_M, trunk, arms, legs);

  // ---- enclosure guard -------------------------------------------------------
  for (let pass = 0; pass < 3; pass++) {
    let worst = -Infinity;
    for (let i = 0; i < n; i++) {
      const d = field(pts[i * 4], pts[i * 4 + 1], pts[i * 4 + 2]) + pts[i * 4 + 3];
      if (d > worst) worst = d;
    }
    const shortfall = worst + MIN_INSIDE_M;
    if (shortfall <= 0) break;
    const base = field;
    const g = shortfall;
    field = (x, y, z) => base(x, y, z) - g;
  }

  // ---- bounds ---------------------------------------------------------------
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let s = 0; s < count; s++) {
    minX = Math.min(minX, scx[s] - ax[s]);
    maxX = Math.max(maxX, scx[s] + ax[s]);
    minZ = Math.min(minZ, scz[s] - bz[s]);
    maxZ = Math.max(maxZ, scz[s] + bz[s]);
  }
  for (const id of ['subclavian_l', 'brachial_l', 'subclavian_r', 'brachial_r', 'femoral_l', 'popliteal_l', 'femoral_r', 'popliteal_r']) {
    for (const p of axisPoints([id])) {
      minX = Math.min(minX, p[0] - 0.12);
      maxX = Math.max(maxX, p[0] + 0.12);
    }
  }
  const lowestY = Math.min(y0, legEndY - legEndRadius);
  const floorY = lowestY - 0.05;
  const slack = 0.05;
  return {
    field,
    trunk,
    arms,
    legs,
    min: [minX - slack, floorY, minZ - slack],
    max: [maxX + slack, yTop + 0.08, maxZ + slack],
    armEndY,
    legEndY,
    floorY: lowestY,
  };
}
