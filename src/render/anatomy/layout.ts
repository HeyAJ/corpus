import * as THREE from 'three';
import organsFile from '../../data/organs.json';
import type { OrganDef, OrganGroup, OrgansFile } from '../../data/types';
import type { V3 } from './sdf';

/**
 * WHERE THINGS ARE: the body's coordinate frame, in one place.
 *
 * Three facts about that frame were, before this file, each known to one module and
 * assumed by the others, and two of them were wrong.
 *
 * 1. +X IS THE PATIENT'S RIGHT. Every data file agrees on that - the liver at +x, the
 *    spleen at -x, the vena cava "on the right" in vasculature.json. But a camera
 *    standing in front of a patient sees the patient's right on its own LEFT, and the
 *    renderer drew the data unmirrored, so the liver appeared on the viewer's right
 *    and the stomach on the left: a situs inversus, in every frame, since the first
 *    commit. The defibrillator pads, which were laid out by someone thinking about a
 *    real chest, were on the correct sides of a body whose heart was on the other one.
 *    The fix is one negative scale at the root of the anatomy (`BODY_MIRROR_X`, applied
 *    in Viewer.ts), not a rewrite of the data, because the data's convention is the
 *    anatomist's and is right. `tests/render/laterality.test.ts` holds it there.
 *
 * 2. THE EXPLODED STACK IS A WARP, NOT FOUR SLABS. organs.json moves each body region
 *    by a rigid offset (spec 6.1). Vessels were authored in unexploded coordinates and
 *    drawn without it, so a renal artery ended 2.5 cm above the kidney it supplies and
 *    the carotids stopped short of a brain that had been lifted 6 cm. `warpY` is the
 *    same set of offsets as a continuous function of height: identical to the rigid
 *    offset in the middle of a region, and a smooth ramp between regions, so anything
 *    long and continuous - a vessel, a nerve, the cord, the gut - is stretched across
 *    the gap instead of being cut by it.
 *
 * 3. AN ORGAN'S POSITION IS ITS DATA POSITION PLUS ITS REGION'S OFFSET. `organPosition`
 *    is the one function that computes it; OrganSet, the tests and the budget tool all
 *    used to add the three terms themselves.
 */

const FILE = organsFile as unknown as OrgansFile;

/** Multiply body-frame x by this to get scene x. See point 1 above. */
export const BODY_MIRROR_X = -1;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * The exploded-stack offset at an unexploded body height, metres.
 *
 * Monotone in each band and continuous everywhere, so a curve passed through it stays
 * a curve. The bands and the offsets both come from organs.json; nothing is fitted here.
 */
export function warpOffsetY(y: number): number {
  const w = FILE.axialWarp;
  const cranial = FILE.groupLayout.cranial.offset[1];
  const abdominal = FILE.groupLayout.abdominal.offset[1];
  const pelvic = FILE.groupLayout.pelvic.offset[1];

  // Above the thorax: fade the cranial offset in across the neck band.
  const up = cranial * smoothstep(w.cranial[0], w.cranial[1], y);
  // Below the diaphragm: the abdominal offset, then the further pelvic one. The bands
  // are given top-first, so the fade runs from 0 at band[0] to 1 at band[1] going DOWN.
  const below = abdominal * smoothstep(w.abdominal[0], w.abdominal[1], y);
  const further = (pelvic - abdominal) * smoothstep(w.pelvic[0], w.pelvic[1], y);
  return up + below + further;
}

/** A body-frame point, moved to where the exploded stack puts it. */
export function warpPoint(p: V3): [number, number, number] {
  return [p[0], p[1] + warpOffsetY(p[1]), p[2]];
}

export function warpPoints(points: readonly V3[]): [number, number, number][] {
  return points.map(warpPoint);
}

/** Apply the warp to every vertex of a geometry authored in unexploded body coordinates. */
export function warpGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    pos.setY(i, y + warpOffsetY(y));
  }
  pos.needsUpdate = true;
  // The warp is a shear along y that varies with y, so it tilts normals only where the
  // offset is changing - in the three narrow transition bands. Recomputing them there
  // and everywhere is cheaper than deciding which vertices need it.
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

export function groupOffset(group: OrganGroup): [number, number, number] {
  return FILE.groupLayout[group].offset;
}

/** Where an organ's own origin sits in the (unmirrored) body frame after the exploded stack. */
export function organPosition(def: OrganDef, out = new THREE.Vector3()): THREE.Vector3 {
  const g = FILE.groupLayout[def.group].offset;
  return out.set(
    def.position[0] + def.layoutOffset[0] + g[0],
    def.position[1] + def.layoutOffset[1] + g[1],
    def.position[2] + def.layoutOffset[2] + g[2],
  );
}

export function organDef(id: string): OrganDef {
  const def = FILE.organs.find((o) => o.id === id);
  if (!def) throw new Error(`organs.json: no organ "${id}"`);
  return def;
}

/** The authored centreline of one gut segment, in unexploded body coordinates. */
export function giSegment(segment: string): [number, number, number][] {
  const line = FILE.giCentrelines.find((l) => l.segment === segment);
  if (!line) throw new Error(`organs.json: no GI centreline "${segment}"`);
  return line.points;
}

/** Several gut segments joined end to end, shared junction points written once. */
export function giPath(segments: readonly string[]): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const s of segments) {
    const pts = giSegment(s);
    for (let i = 0; i < pts.length; i++) {
      // Each segment starts where the previous one ended; keep one copy of the joint.
      if (i === 0 && out.length > 0) continue;
      out.push(pts[i]);
    }
  }
  return out;
}

export const ORGAN_DEFS: OrganDef[] = FILE.organs;
export const GI_CENTRELINES = FILE.giCentrelines;
