import type { PartBuilder, PartGeometry } from '../parts';
import { mergeParts } from '../sdf';
import { chestWallMuscleGroups } from '../shells/chest_wall_muscles';

/**
 * THE INSIDE OF THE CHEST WALL MUSCLES. Every part, level 1 to 3, comes from the function the
 * shell comes from (`chestWallMuscleGroups`), so interior and shell cannot disagree about where a
 * muscle lies. A parent is the union of its children at full radius and each child is drawn slimmer
 * inside it. Procedural and illustrative: the attachments are on the model's ribs, cartilages,
 * sternum, clavicle, scapula and humerus; the thickness of a layer is a drawing choice and each
 * intercostal space is one schematic strip.
 */
export const parts: PartBuilder = () => {
  const out: PartGeometry[] = [];
  for (const [id, geometries] of Object.entries(chestWallMuscleGroups())) out.push({ id, geometry: mergeParts(geometries) });
  return out;
};
