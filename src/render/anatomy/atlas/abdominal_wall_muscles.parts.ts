import type { PartBuilder, PartGeometry } from '../parts';
import { mergeParts } from '../sdf';
import { abdominalWallMuscleGroups } from '../shells/abdominal_wall_muscles';

/**
 * THE INSIDE OF THE ABDOMINAL WALL MUSCLES. Every part comes from the function the shell comes
 * from (`abdominalWallMuscleGroups`), so interior and shell agree. A parent is the union of its
 * children at full radius and each child is drawn slimmer inside it (the linea alba and the
 * midline parts are single pieces). Procedural and illustrative: layer depths are drawing choices,
 * the attachments are on the model's hip bones, ribs, cartilages and lumbar vertebrae.
 */
export const parts: PartBuilder = () => {
  const out: PartGeometry[] = [];
  for (const [id, geometries] of Object.entries(abdominalWallMuscleGroups())) {
    if (geometries.length > 0) out.push({ id, geometry: mergeParts(geometries) });
  }
  return out;
};
