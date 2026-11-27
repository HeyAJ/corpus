import * as THREE from 'three';
import { warpGeometry } from '../layout';
import { bodyFrontAt } from './vertebral_column';

/**
 * PHARYNX, SHELL. An AXIAL organ.
 *
 * Authored in unexploded body coordinates and bent by `warpGeometry`, exactly like the
 * oesophagus it continues into, so the join stays seamless after the exploded stack has
 * moved the head 6 cm away from the neck. The warp matters most here: between body y 0.385
 * and 0.405 it stretches 2 cm of the neck into 8 cm of scene (layout.ts, axialWarp.cranial),
 * and the pharynx is the structure that lives in that stretch.
 *
 * THE FIRST SHAPE, AND WHY IT CHANGED. It was a circular tube on a centreline at z -0.014 to
 * -0.008, which was fitted to the oesophagus below and to nothing in front of it. That left
 * about 2 cm of empty space between the oropharynx's front wall (z -0.004) and the end of the
 * mouth (z 0.015), so the mouth did not open into the throat, and it put the back wall about
 * 1.3 cm INSIDE the vertebral column's front face. The cross-section is now an ellipse, wide
 * from side to side and shallow from front to back as a real pharynx is, and is described by
 * a BACK wall and a FRONT wall rather than a centre and one radius:
 *
 *   - the back wall follows the front face of the cervical vertebral bodies (the vertebral
 *     column's own tube: the cord's path moved forward by the canal and the body radius,
 *     see shells/vertebral_column.ts) plus a 1 mm retropharyngeal space;
 *   - the front wall rises to FRONT_Z, which is where the mouth's isthmus ends
 *     (shells/mouth.ts);
 *   - below body y BLEND_FROM the tube is exactly the old circle, so the join with the
 *     oesophagus (whose shell starts at [0.002, 0.37, -0.014]) is still seamless, and the
 *     change is blended in smoothly up to BLEND_TO. The blend is steep (about 20 mm forward
 *     in 18 mm of height) because the oesophagus and the cervical column were drawn too far
 *     back relative to the head; that is a limit of the existing stack, not of anatomy.
 *
 * It is still a plain tube: the openings, levels, muscles and tonsils are drawn by the
 * interior (atlas/pharynx.parts.ts), which takes its rings from `ringAt` below so the two
 * cannot drift apart.
 */

/**
 * Body-frame heights of the shell's two ends.
 *
 * THE TOP WAS 0.4 AND IS NOW LOWER (gx2). Body y 0.4 is scene y 0.4506 after the cranial warp,
 * and the ring there is inside the brain shell: the roof of the tube lay 6.3 mm up in the brain's
 * underside (auditor aur, scene y 0.433, x 0, z -0.001; the brain's lowest surface above the
 * pharynx is scene y about 0.4235 at z 0 and the pituitary fossa is at y 0.454, z 0.0095). Gray's
 * 42nd: the roof of the nasopharynx is the under-surface of the body of the sphenoid and the
 * basilar part of the occipital bone, a bony floor of the cranial cavity that lies BELOW the brain
 * and its stalk, so the tube must end under it. The top is the highest body height whose ring,
 * once warped, has no vertex in the brain shell (measured, see `PROFILE_TOP`'s note). The tube
 * keeps its radius profile (`PROFILE_TOP`) so that everything that reads a ring below this
 * height (the mouth's doorway at 0.385, the atlas) is unchanged.
 */
export const BODY_Y0 = 0.35;
export const BODY_Y1 = 0.394;
/** The height the radius profile was authored over (0.37 to here). Not the tube's top: see BODY_Y1. */
const PROFILE_TOP = 0.4;
/** The old centreline, kept for the part of the tube that must still meet the oesophagus. */
const OLD: readonly (readonly [number, number, number])[] = [
  [0.002, 0.35, -0.02],
  [0.002, 0.37, -0.0185],
  [0.002, 0.381, -0.012],
  [0.001, 0.392, -0.01],
  [0, 0.4, -0.008],
];
/** The blend from the old circle to the new ellipse, body y. */
const BLEND_FROM = 0.37;
const BLEND_TO = 0.388;
/** Front wall of the upper pharynx, scene z: where the mouth's isthmus ends. */
export const FRONT_Z = 0.0135;
/**
 * Retropharyngeal space between the vertebral bodies and the back wall, metres. A DRAWING
 * choice: 4 mm keeps a 2 mm clearance to the bone after the shell's 18 sides are
 * faceted, and is of the order of the thin prevertebral layer in the textbook picture.
 */
const RETRO_GAP = 0.004;
/**
 * Where the back wall lies from the skull base up, scene z: -0.001, the value it always had
 * above the atlas (the old rule put it 1 mm in front of the C1 face, which was at z -0.002).
 * Above the atlas there is no vertebral body to follow, only the base of the skull, and the
 * ears' auditory tubes were aligned (hn2) to openings on a wall through z 0.0009 at x 0.0082,
 * so this part of the wall must not ride back with the spine when the cervical column moves
 * back. It is a drawing choice anchored to the mouth, not a measurement.
 */
const SKULL_BASE_BACK_Z = -0.001;
/** The back wall hands over from following the vertebral bodies to the skull-base anchor between these body heights. */
const CLIVUS_FROM = 0.384;
const CLIVUS_TO = 0.397;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function alongOld(y: number, axis: 0 | 2): number {
  for (let i = 1; i < OLD.length; i++) {
    if (y <= OLD[i][1] || i === OLD.length - 1) {
      const f = Math.max(0, Math.min(1, (y - OLD[i - 1][1]) / (OLD[i][1] - OLD[i - 1][1])));
      return lerp(OLD[i - 1][axis], OLD[i][axis], f);
    }
  }
  return OLD[0][axis];
}
/** The front face of the vertebral bodies at body height y (shells/vertebral_column.ts), kept under its old name for probes. */
export function bodyFrontZ(y: number): number {
  return bodyFrontAt(y);
}

export interface Ring {
  /** Body-frame height of the ring. */
  y: number;
  cx: number;
  cz: number;
  /** Half-width, side to side. */
  rx: number;
  /** Half-depth, front to back. */
  dz: number;
}

/** The pharynx's cross-section at body height y (BODY_Y0 to BODY_Y1). */
export function ringAt(y: number): Ring {
  // The radius profile keeps its original reference (0.37 to 0.4): the tube now starts 12 mm lower,
  // and re-basing u would have narrowed the doorway the mouth reads at y 0.385.
  const u = Math.max(0, Math.min(1, (y - 0.37) / (PROFILE_TOP - 0.37)));
  // The old circle: its radius profile is the shell's original one.
  const r0 = 0.0075 + 0.0045 * Math.sin(Math.min(1, u * 1.6) * Math.PI * 0.5);
  const cx = lerp(0.002, 0, u);
  const z0 = alongOld(y, 2);
  const s = smooth(BLEND_FROM, BLEND_TO, y);
  const vback = bodyFrontAt(y) + RETRO_GAP;
  const anchored = lerp(vback, Math.max(SKULL_BASE_BACK_Z, vback), smooth(CLIVUS_FROM, CLIVUS_TO, y));
  // Never behind the bone's face plus the gap, whatever the blend says: that is the clearance.
  const back = Math.max(lerp(z0 - r0, anchored, s), vback);
  const front = lerp(z0 + r0, FRONT_Z, s);
  return { y, cx, cz: (front + back) / 2, rx: r0, dz: Math.max(0.002, (front - back) / 2) };
}

/**
 * An elliptical tube between two body heights, `k` of the full size, in BODY coordinates (the
 * caller warps it). Rings are horizontal, which is right because the centreline is steep.
 */
export function ellipticalTube(y0: number, y1: number, k: number, rings = 40, sides = 16): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const r = ringAt(y0 + ((y1 - y0) * i) / rings);
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      pos.push(r.cx + r.rx * k * Math.cos(a), r.y, r.cz + r.dz * k * Math.sin(a));
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * sides + j;
      const b = i * sides + ((j + 1) % sides);
      const c = (i + 1) * sides + j;
      const d = (i + 1) * sides + ((j + 1) % sides);
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function pharynx(): THREE.BufferGeometry {
  return warpGeometry(ellipticalTube(BODY_Y0, BODY_Y1, 1, 56, 18));
}
