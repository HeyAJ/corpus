import * as THREE from 'three';
import vasculatureFile from '../../data/vasculature.json';

/**
 * VESSEL CENTRELINES.
 *
 * Reads src/data/vasculature.json and turns each segment's control points into a
 * resampled polyline with cumulative arc length, which is what both the tube
 * geometry and the flow particles need.
 *
 * EVERY SEGMENT IS AUTHORED IN ITS FLOW DIRECTION. The aorta runs heart-to-periphery
 * and the vena cava runs periphery-to-heart, so a particle always advances FORWARD
 * along its polyline and the two trees visibly flow in opposite directions without
 * any special case. That property is easy to lose and worth stating: if a new segment
 * is added backwards, its particles will run the wrong way and nothing else will
 * complain.
 */

export type VesselSide = 'arterial' | 'venous' | 'pulmonary_artery' | 'pulmonary_vein' | 'portal';

export interface VesselSegment {
  id: string;
  label: string;
  side: VesselSide;
  radius_m: [number, number];
  points: [number, number, number][];
  source: string;
  confidence: string;
  note: string;
}

interface VasculatureFile {
  version: number;
  about: string;
  sources: Record<string, { label: string; url: string }>;
  segments: VesselSegment[];
}

const FILE = vasculatureFile as unknown as VasculatureFile;

export const SEGMENTS = FILE.segments;
export const VASCULATURE_SOURCES = FILE.sources;

/** Samples per segment. Enough for a smooth curve, few enough to stay cheap. */
const SAMPLES = 24;

export interface Centreline {
  id: string;
  side: VesselSide;
  /** Resampled positions, SAMPLES of them. */
  positions: THREE.Vector3[];
  /** Tangent at each sample, for orienting the tube. */
  tangents: THREE.Vector3[];
  /** Radius at each sample, linearly interpolated between the declared endpoints. */
  radii: number[];
  /** Cumulative arc length at each sample; the last entry is the total. */
  arc: number[];
  length: number;
}

export function buildCentrelines(): Centreline[] {
  return SEGMENTS.map((seg) =>
    centrelineThrough(
      seg.id,
      seg.side,
      seg.points.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
      seg.radius_m[0],
      seg.radius_m[1],
      SAMPLES,
    ),
  );
}

/**
 * A smooth centreline through control points, resampled evenly, radius tapering
 * linearly from r0 to r1. Catmull-Rom because a vessel is a smooth curve and straight
 * chords between control points look like plumbing.
 */
function centrelineThrough(
  id: string,
  side: VesselSide,
  control: THREE.Vector3[],
  r0: number,
  r1: number,
  samples: number,
): Centreline {
  const curve = new THREE.CatmullRomCurve3(control, false, 'catmullrom', 0.5);
  const positions: THREE.Vector3[] = [];
  const tangents: THREE.Vector3[] = [];
  const radii: number[] = [];
  const arc: number[] = [];
  let total = 0;
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const p = curve.getPoint(t);
    positions.push(p);
    tangents.push(curve.getTangent(t).normalize());
    radii.push(r0 + (r1 - r0) * t);
    if (i > 0) total += p.distanceTo(positions[i - 1]);
    arc.push(total);
  }
  return { id, side, positions, tangents, radii, arc, length: total };
}

/**
 * THE FINE BRANCHES. The 60 named segments are the vessels Gray's Anatomy draws; a
 * real circulation keeps dividing below them into branches too many and too small to
 * name, and a tree that simply stops at the named vessels looks like a diagram rather
 * than a body. So every named vessel buds small side branches, and each of those buds
 * smaller ones again - two generations, down to about a fifth of a millimetre of
 * radius at the tips.
 *
 * WHAT THEY ARE NOT. They are a drawing, exactly as vasculature.json says of the
 * whole tree: their positions are generated, not anatomical, and nothing in the
 * simulation reads them. They carry the same blood colour and the same substance
 * front as the vessel they leave, so what the particles show stays true.
 *
 * DETERMINISTIC. A fixed-seed generator, so the tree is identical on every load and
 * every device, and the render tests that count geometry stay stable.
 */
export function growFineBranches(parents: Centreline[]): Centreline[] {
  const rand = mulberry(0xb10d);
  const out: Centreline[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3();
  const dir = new THREE.Vector3();

  const bud = (parent: Centreline, generation: number) => {
    // Longer and wider vessels carry more branches; the tiny ones still get two.
    const count = Math.max(2, Math.min(generation === 0 ? 7 : 3, Math.round(parent.length * (generation === 0 ? 26 : 60))));
    for (let k = 0; k < count; k++) {
      const u = 0.12 + 0.78 * ((k + rand()) / count);
      const i = Math.min(parent.positions.length - 1, Math.round(u * (parent.positions.length - 1)));
      const origin = parent.positions[i];
      const tangent = parent.tangents[i];
      // A direction off the parent: mostly sideways, partly onward, never back up it.
      side.crossVectors(tangent, Math.abs(tangent.dot(up)) > 0.9 ? new THREE.Vector3(1, 0, 0) : up).normalize();
      side.applyAxisAngle(tangent, rand() * Math.PI * 2);
      dir.copy(side).multiplyScalar(0.85).addScaledVector(tangent, 0.35 + 0.4 * rand()).normalize();

      const length = generation === 0 ? 0.022 + 0.032 * rand() : 0.009 + 0.013 * rand();
      const bend = side.clone().applyAxisAngle(tangent, Math.PI / 2).multiplyScalar(length * 0.25 * (rand() - 0.5));
      const mid = origin.clone().addScaledVector(dir, length * 0.5).add(bend);
      const end = origin.clone().addScaledVector(dir, length);

      const r0 = Math.min(generation === 0 ? 0.0022 : 0.0009, parent.radii[i] * (generation === 0 ? 0.42 : 0.5));
      const r1 = Math.max(0.00018, r0 * 0.38);
      // Particles run from a centreline's first point to its last, and the named veins
      // are listed periphery-to-heart for that reason. A twig of an artery carries blood
      // AWAY from its parent, so it runs junction -> tip; a twig of a vein (systemic,
      // portal or pulmonary) DRAINS into its parent, so it must run tip -> junction, or
      // every venous twig would show blood flowing backwards out of the vein. The taper
      // follows the same order: narrow at the tip, wide where it joins.
      const drains = parent.side === 'venous' || parent.side === 'portal' || parent.side === 'pulmonary_vein';
      const twig = drains
        ? centrelineThrough(`${parent.id}~${generation}.${k}`, parent.side, [end, mid, origin.clone()], r1, r0, 6)
        : centrelineThrough(`${parent.id}~${generation}.${k}`, parent.side, [origin.clone(), mid, end], r0, r1, 6);
      out.push(twig);
      if (generation === 0) bud(twig, 1);
    }
  };

  for (const p of parents) {
    // The great vessels' own walls are what the eye reads; budding from the aortic root
    // or the venae cavae would put a thicket over the heart.
    if (Math.max(...p.radii) > 0.011) continue;
    bud(p, 0);
  }
  return out;
}

/** Small fast deterministic PRNG (mulberry32). */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Position at a given arc length along a centreline, by linear interpolation between
 * samples. Used by the particle advection every frame, so it does no allocation.
 */
export function sampleAt(c: Centreline, s: number, out: THREE.Vector3): THREE.Vector3 {
  const clamped = Math.max(0, Math.min(c.length, s));

  // Linear scan. SAMPLES is 24 and the particle's previous index is usually close,
  // but a scan of 24 is already cheaper than the bookkeeping to avoid it.
  let i = 1;
  while (i < c.arc.length - 1 && c.arc[i] < clamped) i++;

  const a = c.arc[i - 1];
  const b = c.arc[i];
  const f = b > a ? (clamped - a) / (b - a) : 0;

  return out.copy(c.positions[i - 1]).lerp(c.positions[i], f);
}

/** Radius at a given arc length, for sizing a particle to its vessel. */
export function radiusAt(c: Centreline, s: number): number {
  const f = c.length > 0 ? Math.max(0, Math.min(1, s / c.length)) : 0;
  const idx = Math.min(c.radii.length - 1, Math.floor(f * (c.radii.length - 1)));
  return c.radii[idx];
}

/**
 * Which oxygen saturation a side carries.
 *
 * NOT "artery equals oxygenated". The pulmonary artery carries the most deoxygenated
 * blood in the body and the pulmonary veins the most oxygenated, which is the single
 * most counter-intuitive fact in the circulation and the reason this returns a side
 * rather than reading the word "artery".
 */
export function saturationFor(side: VesselSide, arterialSat: number, venousSat: number): number {
  switch (side) {
    case 'arterial':
      return arterialSat;
    case 'pulmonary_vein':
      return arterialSat;
    case 'venous':
    case 'pulmonary_artery':
      return venousSat;
    case 'portal':
      // Portal blood has already passed through the gut, so it is venous — and it is
      // the route by which everything swallowed reaches the liver.
      return venousSat;
  }
}
