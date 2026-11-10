import type * as THREE from 'three';
import type { SimSnapshot } from '../../../bridge/types';
import type { V3 } from '../sdf';

/**
 * THE CONTRACT BETWEEN AN ORGAN'S INTERIOR AND THE THING THAT DRAWS IT.
 *
 * `OrganDetail` (./OrganDetail.ts) owns the meshes, the materials, the particle systems
 * and the frame loop. An atlas module (../atlas/<name>.detail.ts) owns only what is
 * particular to its organ: which streams run through it, and what its parts do each
 * frame. This file is everything the second needs to know about the first.
 *
 * COORDINATES. Everything here is in the ORGAN'S OWN FRAME: the frame its shell is
 * authored in in ../models.ts and its parts in ../atlas/<name>.parts.ts - origin at the
 * organ's position in organs.json, +x the patient's right, +y cranial, +z anterior,
 * metres. Organs whose position is [0, 0, 0] are in body coordinates.
 *
 * NOTHING HERE WRITES TO THE SIMULATION. An interior reads the snapshot and draws.
 */

/** A stream of particles along a path inside an organ: blood, air, urine, bile, an impulse. */
export interface FlowSpec {
  /** Unique within the organ. */
  id: string;
  /** Control points; a smooth curve is passed through them. At least two. */
  path: V3[];
  /** How many particles ride the path. */
  count: number;
  /** Particle diameter, metres. Drawn perspective-correct, with a floor of about 2 px. */
  size: number;
  /** Hex colour, e.g. 0xc8323a. */
  color: number;
  /** Metres per second along the path when the rate is 1. */
  speed: number;
  /** Particles scatter this far (metres) from the centreline, so a stream has width. Default 0. */
  spread?: number;
  /** The path is a closed loop. Default false: a particle that reaches the end restarts at the start. */
  closed?: boolean;
}

export interface PartHandle {
  /** The part's id within its organ, as in src/data/anatomy/<atlas>.json. */
  readonly id: string;
  readonly mesh: THREE.Mesh;
  /** The colour the atlas data gives this part. */
  readonly baseColor: THREE.Color;
  /** Draw the part in this colour for this frame. */
  setColor(color: THREE.ColorRepresentation): void;
  /** 0..1: how brightly the part glows. */
  setGlow(glow: number): void;
  /** 0..1. */
  setOpacity(opacity: number): void;
  setVisible(visible: boolean): void;
  /** Scale about a pivot (default: the part's own centre). A number scales uniformly. */
  setScale(scale: number | V3, pivot?: V3): void;
  /** Move the part from where it was built, metres. */
  setOffset(offset: V3): void;
}

export interface FlowHandle {
  readonly id: string;
  /** Multiplier on the spec's speed. 0 holds the stream still; negative runs it backwards. */
  setRate(rate: number): void;
  /** Fraction of the particles drawn, 0..1. */
  setDensity(fraction: number): void;
  setColor(color: THREE.ColorRepresentation): void;
  setVisible(visible: boolean): void;
  /**
   * Draw only the particles whose position along the path, 0..1, lies in [from, to].
   * A gate: how a closed valve is shown to hold blood back.
   */
  setWindow(from: number, to: number): void;
}

export interface DetailContext {
  /** The organ instance being shown: `kidney_l`, not the atlas name `kidney`. */
  readonly organId: string;
  /** The newest snapshot. */
  readonly snapshot: SimSnapshot;
  /** Seconds since the previous frame, wall clock, capped at 0.1. */
  readonly dt: number;
  /** Seconds since this organ's interior was shown. */
  readonly time: number;
  /** The user asked for reduced motion: hold shapes still, keep colours and numbers live. */
  readonly reducedMotion: boolean;
  /** Activity 0..1 of one of this organ's parts (snapshot.anatomy.parts). 0 if unknown. */
  activity(partId: string): number;
  /**
   * A snapshot value interpolated between the last two snapshots. Snapshots arrive at
   * 20 Hz and frames at 60; anything that MOVES must be read through this or it steps.
   */
  lerp(pick: (s: SimSnapshot) => number): number;
  part(partId: string): PartHandle | undefined;
  flow(flowId: string): FlowHandle | undefined;
}

export interface OrganDetailSpec {
  /** The streams to create when this organ's interior is first shown. */
  flows?: (organId: string) => FlowSpec[];
  /**
   * Called every frame while the organ is selected, AFTER the defaults have been
   * applied. The defaults: every part is drawn in its atlas colour, glowing in
   * proportion to its activity; every flow runs at rate 1, full density, whole window.
   * So a module only has to say what is DIFFERENT about its organ.
   */
  animate?: (ctx: DetailContext) => void;
}
