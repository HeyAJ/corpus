import type { PartBuilder, PartGeometry } from '../parts';
import { mergeParts } from '../sdf';
import { pelvicFloorMuscleMap } from '../shells/pelvic_floor_muscles';

/**
 * THE INSIDE OF THE PELVIC FLOOR MUSCLES: every muscle of src/data/anatomy/pelvic_floor_muscles.json, from the same map the
 * shell is made from. The levator ani is drawn twice on purpose: as the whole bowl, which the opened organ shows, and as its
 * three parts (puborectalis, pubococcygeus, iliococcygeus), which the reveal rule shows when the levator is selected or the
 * camera comes close; the parent drops to glass while they show. The perineal muscles group works the same way. The shapes are
 * drawn on one surface and are the same for a male and a female body; no fibres are drawn.
 */
export const parts: PartBuilder = () => {
  const out: PartGeometry[] = [];
  for (const [id, geometries] of Object.entries(pelvicFloorMuscleMap())) {
    out.push({ id, geometry: mergeParts(geometries.map((g) => g.clone())) });
  }
  return out;
};
