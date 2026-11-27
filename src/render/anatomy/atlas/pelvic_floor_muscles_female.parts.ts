import type { PartBuilder, PartGeometry } from '../parts';
import { mergeParts } from '../sdf';
import { pelvicFloorFemaleMap } from '../shells/pelvic_floor_muscles_female';

/**
 * THE INSIDE OF THE FEMALE PELVIC FLOOR MUSCLES: every muscle of src/data/anatomy/pelvic_floor_muscles_female.json, from the same map the
 * shell is made from (shells/pelvic_floor_muscles_female.ts says where each is placed and why). As in the male atlas the levator ani and the
 * perineal muscles are drawn twice on purpose: whole, for the opened organ, and as their parts, which the reveal rule shows when the
 * group is selected or the camera comes close. The shapes are drawn on one surface, no fibres are drawn, and the placement on the urethra,
 * vagina and anal canal is exact only to the extent the report of the round that wrote it says.
 */
export const parts: PartBuilder = () => {
  const out: PartGeometry[] = [];
  for (const [id, geometries] of Object.entries(pelvicFloorFemaleMap())) {
    out.push({ id, geometry: mergeParts(geometries.map((g) => g.clone())) });
  }
  return out;
};
