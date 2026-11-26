import type { OrganDetailSpec } from '../detail/types';

/**
 * ANIMATION OF THE RIB CAGE: the breath, and only the breath.
 *
 * The signal is the one the diaphragm uses (`resp.inflation`, interpolated between snapshots):
 * the ribs, their cartilages and the sternum rise and come forward a little on inspiration
 * (the "pump handle" of the upper ribs, the "bucket handle" of the lower ones, in one display
 * motion) and settle on expiration. The whole bony frame moves together as ONE rigid offset: the
 * parts are rigid meshes, so the cage is not deformed, and the joints at the back stay where the
 * vertebrae are.
 *
 * DISPLAY AMPLITUDES, NOT MEASUREMENTS. `RIB_DISPLAY_RISE_M` and `RIB_DISPLAY_FORWARD_M` are
 * chosen so that the motion can be seen from the working distance of an open organ; they are not
 * a measured excursion of the chest wall. Frozen at zero under reduced motion, as the lungs and
 * the diaphragm are. The shell (the Bones layer view) never moves.
 *
 * BONE IS DRAWN AS A PANE. The sternum, ribs and cartilages are set to a middling opacity so the
 * red marrow inside them, and the finer structures a part holds, can be seen through the bone.
 * That is a display choice and not a statement about bone being translucent.
 */

/** How far the cage rises on a full inspiration, metres of scene height. A display amplitude. */
export const RIB_DISPLAY_RISE_M = 0.0035;
/** How far it comes forward at the same time, metres. A display amplitude. */
export const RIB_DISPLAY_FORWARD_M = 0.003;

const MOVING = [
  'sternum', 'true_ribs', 'false_and_floating_ribs', 'costal_cartilages', 'costal_margin',
  'intercostal_spaces', 'sternocostal_joints', 'red_bone_marrow',
];

/** Opacity of the bony parts, so that what lies inside them shows. A display choice. */
const BONE_PANE = 0.55;

export const detail: OrganDetailSpec = {
  animate: (ctx) => {
    const inflation = ctx.reducedMotion ? 0 : Math.max(0, Math.min(1, ctx.lerp((s) => s.resp.inflation)));
    for (const id of MOVING) ctx.part(id)?.setOffset([0, RIB_DISPLAY_RISE_M * inflation, RIB_DISPLAY_FORWARD_M * inflation]);
    for (const id of ['sternum', 'true_ribs', 'false_and_floating_ribs']) ctx.part(id)?.setOpacity(BONE_PANE);
    ctx.part('intercostal_spaces')?.setOpacity(0.35);
    ctx.part('costal_cartilages')?.setOpacity(0.75);
  },
};
