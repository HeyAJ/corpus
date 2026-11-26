import * as THREE from 'three';
import { mergeParts, type V3 } from '../sdf';
import { ribPointsBody } from './thoracic_cage';
import { COLUMN_LEVELS, bodyFrontAt } from './vertebral_column';
import { CLAVICLE_PTS } from './upper_limb_bones';
import { bothSides, localFrame, onSide, spindle, strap } from './muscle_stub';

/**
 * HEAD AND NECK MUSCLES, SHELL (a stub: one honest silhouette per group, in the right place).
 * A LAYER organ of the muscles layer, in the cranial group.
 *
 * FRAME. Origin organs.json [0, 0.42, 0], the same origin as the skull and the brain: every
 * muscle of mastication attaches to the skull, so this organ's position is the skull's, not a
 * guess of its own. Points on the skull are written in the SKULL's own local numbers (the
 * landmarks of shells/skull.ts: the mastoid beside the ears' canal, the condyle, the angle of the
 * mandible, the chin, the hyoid body), which are already in this frame. Points on the neck and
 * the chest (the cervical column, rib 1, the manubrium, the clavicle) are body coordinates and
 * are brought here by `Frame.rigid` with the thoracic group's offset (0): the neck sits in the
 * exploded stack's gap, so the sternocleidomastoid is the one muscle here that spans the 6 cm
 * the cranial group is lifted, and it is long on purpose.
 *
 * WHAT IS DRAWN. Per side: the temporalis fanning over the temporal fossa and the masseter over
 * the ramus (MASTICATION); a suprahyoid belly from the chin to the hyoid and a thin infrahyoid
 * strap from the hyoid to the top of the sternum (HYOID); the sternocleidomastoid from the mastoid
 * to the manubrium and the medial clavicle; the scalenes from the cervical transverse processes
 * to the first rib; and the longus colli lying on the front of the cervical column (PREVERTEBRAL),
 * which is only as thick as the 4 mm gap the pharynx leaves in front of the column (RETRO_GAP in
 * shells/pharynx.ts). Widths and thicknesses are drawing choices; the endpoints are the bones'.
 *
 * NOT DRAWN: the muscles of the face (expression), the tongue and the soft palate (the mouth
 * atlas has them), and the pharyngeal constrictors (the pharynx atlas has them). The content
 * agent for this organ decides how much of the face to add.
 */

/** The organ's origin, organs.json (the skull's). */
export const ORIGIN: V3 = [0, 0.42, 0];
/** The cranial group's offset in the exploded stack, organs.json groupLayout. */
export const GROUP_Y = 0.06;
const F = localFrame(ORIGIN, GROUP_Y);
/** A point on the neck or chest bones (thoracic group, offset 0), body coordinates, to this frame. */
export const thoracic = (p: V3): V3 => F.rigid(p, 0);

const cervical = (id: string): number => (COLUMN_LEVELS.find((l) => l.id === id) ?? COLUMN_LEVELS[0]).y;

/**
 * The geometry of each part, keyed by the part's id in src/data/anatomy/head_neck_muscles.json.
 * The shell is these merged; the stub atlas (atlas/head_neck_muscles.parts.ts) draws each one as
 * its part, so the two can never disagree about where a muscle is.
 */
export function headNeckMuscleGroups(): Record<string, THREE.BufferGeometry[]> {
  const east: V3 = [1, 0, 0];
  const clav = CLAVICLE_PTS[0];
  const c5 = cervical('c5');
  const rib1 = ribPointsBody(1);
  const r1 = rib1[Math.min(rib1.length - 1, 7)];
  const g: Record<string, THREE.BufferGeometry[]> = {
    mastication_muscles: bothSides((s) => [
      // The temporalis stands 6 mm off the skull wall (x 0.0745 at the temple, probed from the skull's own envelope) and gathers onto the coronoid.
      spindle(onSide([0.082, -0.002, 0.012], s), onSide([0.058, -0.066, 0.012], s), 0.013, 0.45, east),
      // The masseter lies lateral to the ramus plate (x 0.0545 plus its 3.6 mm half-thickness) from the zygomatic arch to the angle.
      spindle(onSide([0.067, -0.058, 0.0], s), onSide([0.0605, -0.1095, -0.0185], s), 0.011, 0.4, east),
    ]),
    hyoid_muscles: bothSides((s) => [
      // Suprahyoid: chin to hyoid body. Infrahyoid: hyoid body to the top of the sternum.
      spindle(onSide([0.008, -0.1165, 0.058], s), onSide([0.009, -0.1155, 0.0235], s), 0.0055, 0.7, [0, 1, 0], 8, 5),
      strap([onSide([0.007, -0.1155, 0.0225], s), thoracic(onSide([0.008, 0.31, 0.036], s)), thoracic(onSide([0.008, 0.268, 0.052], s))], 0.0028, 10, 4),
    ]),
    // The mastoid, below and behind the ear's canal, to the sternum and the medial end of the clavicle.
    sternocleidomastoid: bothSides((s) => [
      spindle(onSide([0.066, -0.07, -0.024], s), thoracic(onSide([(clav[0] + 0.008) / 2 + 0.003, 0.272, (clav[2] + 0.052) / 2], s)), 0.0062, 0.6, east, 8, 5),
    ]),
    // From the transverse processes of C5, beside the vertebral body, to the first rib.
    scalene_muscles: bothSides((s) => [spindle(thoracic(onSide([0.024, c5, bodyFrontAt(c5) - 0.004], s)), thoracic(onSide(r1, s)), 0.0055, 0.7, east, 8, 5)]),
    // Longus colli, on the front of the cervical column in the gap the pharynx leaves.
    prevertebral_muscles: bothSides((s) => {
      const ys = [0.378, 0.346, 0.314, 0.275];
      return [strap(ys.map((y) => thoracic(onSide([0.007, y, bodyFrontAt(y) + 0.002], s))), 0.0018, 10, 4)];
    }),
  };
  return g;
}

export function headNeckMuscles(): THREE.BufferGeometry {
  return mergeParts(Object.values(headNeckMuscleGroups()).flat());
}
