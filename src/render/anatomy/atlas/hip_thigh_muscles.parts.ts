import type { PartBuilder, PartGeometry } from '../parts';
import { mergeParts } from '../sdf';
import { hipThighMuscleMap } from '../shells/hip_thigh_muscles';

/**
 * THE INSIDE OF THE HIP AND THIGH MUSCLES: every muscle of src/data/anatomy/hip_thigh_muscles.json, from the same map the shell
 * is made from (`hipThighMuscleMap`), so shell and parts cannot disagree about where a muscle is. Both sides are built (the
 * right once, then mirrored). A group (the quadriceps, the hamstrings, the gluteal muscles, the adductors, the short
 * rotators, the biceps) is drawn as the union of its children, which the reveal rule shows separately when the group is
 * selected or the camera comes close; the group drops to glass while its children show, so the coincident surfaces do not fight.
 * Muscles are placed deepest first and each is pushed clear of the bones and the muscles under it (shells/hip_thigh_muscles.ts).
 * No muscle fibres are drawn, and every width and thickness is a drawing choice.
 */
export const parts: PartBuilder = () => {
  const out: PartGeometry[] = [];
  for (const [id, geometries] of Object.entries(hipThighMuscleMap())) {
    out.push({ id, geometry: mergeParts(geometries.map((g) => g.clone())) });
  }
  return out;
};
