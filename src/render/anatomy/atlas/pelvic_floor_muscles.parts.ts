import * as THREE from 'three';
import type { PartBuilder, PartGeometry } from '../parts';
import { mergeParts } from '../sdf';
import { pelvicFloorMuscleGroups } from '../shells/pelvic_floor_muscles';

/**
 * THE INSIDE OF THE PELVIC FLOOR MUSCLES: a FIRST-PASS STUB (the scaffold of the muscles layer).
 *
 * This organ's shell is the union of one schematic silhouette per part (the levator ani, the coccygeus and the perineal muscles), so
 * the interior is simply each of those silhouettes drawn separately, in the organ's own frame,
 * under the part id the atlas file (src/data/anatomy/pelvic_floor_muscles.json) gives it. The shell and the
 * parts therefore share one function (`pelvicFloorMuscleGroups`) and cannot disagree about where a
 * muscle is. A content agent who draws these muscles properly replaces this file and adds the
 * finer structures with the atlas's `parent` field; until then nothing here is anatomy beyond
 * the placement the shell's own header describes.
 */
export const parts: PartBuilder = () => {
  const out: PartGeometry[] = [];
  for (const [id, geometries] of Object.entries(pelvicFloorMuscleGroups() as Record<string, THREE.BufferGeometry[]>)) {
    out.push({ id, geometry: mergeParts(geometries) });
  }
  return out;
};
