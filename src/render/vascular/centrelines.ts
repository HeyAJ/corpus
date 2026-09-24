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
  return SEGMENTS.map((seg) => {
    const control = seg.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));

    // Catmull-Rom through the control points. A vessel is a smooth curve and three
    // straight chords look like plumbing.
    const curve = new THREE.CatmullRomCurve3(control, false, 'catmullrom', 0.5);

    const positions: THREE.Vector3[] = [];
    const tangents: THREE.Vector3[] = [];
    const radii: number[] = [];
    const arc: number[] = [];

    let total = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const t = i / (SAMPLES - 1);
      const p = curve.getPoint(t);
      positions.push(p);
      tangents.push(curve.getTangent(t).normalize());
      radii.push(seg.radius_m[0] + (seg.radius_m[1] - seg.radius_m[0]) * t);
      if (i > 0) total += p.distanceTo(positions[i - 1]);
      arc.push(total);
    }

    return { id: seg.id, side: seg.side, positions, tangents, radii, arc, length: total };
  });
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
