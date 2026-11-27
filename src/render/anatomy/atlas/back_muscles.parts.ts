import type { PartBuilder, PartGeometry } from '../parts';
import { mergeParts } from '../sdf';
import { backMuscleMap } from '../shells/back_muscles';

/**
 * THE INSIDE OF THE BACK MUSCLES: every muscle of src/data/anatomy/back_muscles.json, drawn from the same
 * map the shell is made from (`backMuscleMap`, shells/back_muscles.ts), so the shell and the parts cannot
 * disagree about where a muscle is.
 *
 * LEVEL 1 AND ITS CHILDREN. A muscle with parts (the trapezius with its descending, transverse and
 * ascending fibres; the erector spinae with its three columns; the transversospinales with the
 * semispinalis, multifidus and rotatores; the suboccipital group with its four) is drawn twice, on
 * purpose: the parent as the whole muscle, which is what the opened organ shows, and each child as
 * its own piece, which the reveal rule (src/render/anatomy/detail/reveal.ts) shows when the parent
 * is selected or the camera comes close. The parent drops to glass while its children show, so the
 * two coincident surfaces do not fight. A child costs nothing until it is shown, but it is built
 * here, so this file's triangle count is the sum of all of them.
 *
 * NO MUSCLE FIBRES ARE DRAWN. A muscle is a smooth body with tendon at each end; the sheets
 * (trapezius, latissimus dorsi, the serrati, the fascia) are slabs a few millimetres thick whose
 * edges follow the attachments, and their outlines are drawing choices.
 */
export const parts: PartBuilder = () => {
  const out: PartGeometry[] = [];
  for (const [id, geometries] of Object.entries(backMuscleMap())) {
    out.push({ id, geometry: mergeParts(geometries.map((g) => g.clone())) });
  }
  return out;
};
