import type * as THREE from 'three';
import type { ModelParams } from './models';
import { PART_BUILDERS } from './atlas';

/**
 * THE INSIDE OF AN ORGAN.
 *
 * `models.ts` builds the shell of each organ: one surface, the thing you see while the
 * organ is not selected. This is the other half. When an organ IS selected its shell
 * turns to glass and what is inside it is drawn: the four chambers and the valves of
 * the heart, the lobes and nuclei of the brain, the cortex, pyramids and pelvis of a
 * kidney. Each of those is a PART, and a part is three things kept in three places:
 *
 *   - its name, what it does and what drives it        src/data/anatomy/*.json (data)
 *   - its shape                                        ./atlas/*.ts           (here)
 *   - how active it is right now, 0..1                 src/sim/derive/anatomy.ts (engine)
 *
 * joined by the part's id. The shape lives in the render layer and nowhere else, the
 * physiology lives in the engine and nowhere else, and the words live in data, so the
 * renderer never decides what a hypothalamus is doing and the engine never knows what
 * one looks like.
 *
 * Parts are built lazily, per organ, in the geometry worker, the first time that organ
 * is selected. Nothing here runs at load.
 */

export interface PartGeometry {
  /** The part's id within its organ, as in src/data/anatomy/<atlas>.json: `hypothalamus`. */
  id: string;
  geometry: THREE.BufferGeometry;
}

/**
 * What a part builder is told. `organ` is the organ INSTANCE (`kidney_l`), so one atlas
 * can build a mirrored copy for each side; `gestationWeeks` is for the two organs whose
 * interior changes with it.
 */
export interface PartParams extends ModelParams {
  organ: string;
}

export type PartBuilder = (params: PartParams) => PartGeometry[];

/** Build every interior part of one atlas. An atlas with no builder has no interior to show. */
export function buildParts(atlas: string, params: PartParams): PartGeometry[] {
  const builder = PART_BUILDERS[atlas];
  return builder ? builder(params) : [];
}
