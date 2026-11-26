import type { PartBuilder, PartGeometry } from '../parts';
import { mergeParts } from '../sdf';
import { headNeckMuscleGroups } from '../shells/head_neck_muscles';

/**
 * THE INSIDE OF THE HEAD AND NECK MUSCLES.
 *
 * Every part, level 1 to 3, comes from the same function the shell comes from
 * (`headNeckMuscleGroups`, shells/head_neck_muscles.ts), so the interior and the shell cannot
 * disagree about where a muscle lies. A group (the muscles of mastication, the hyoid muscles, the
 * scalenes, the prevertebral muscles, the sternocleidomastoid) is drawn as the union of its muscles
 * at full radius and each muscle, head, belly and tendon inside it a little slimmer, so a focused
 * group's own glass shows what it holds. The geometry is procedural and illustrative: the
 * attachments are on the skeleton's own bones, the thickness of a belly is a drawing choice.
 */
export const parts: PartBuilder = () => {
  const out: PartGeometry[] = [];
  for (const [id, geometries] of Object.entries(headNeckMuscleGroups())) out.push({ id, geometry: mergeParts(geometries) });
  return out;
};
