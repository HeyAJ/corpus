import type { OrganDetailSpec } from '../detail/types';

/**
 * No streams and no motion: this organ is bone, and bone is not simulated as tissue (the only live
 * part is the red marrow, which glows with erythropoietin through the default activity glow).
 *
 * What this file does is set how see-through each part is, so that what lies inside can be seen:
 * the humerus is drawn as a pane so the marrow in its upper end shows, and the joint's capsule and
 * lining are faint glass sleeves round the ball and socket. These opacities are DISPLAY choices
 * and say nothing about how translucent real bone or capsule is.
 */

/** Opacity of the humerus, so that the marrow inside shows. A display choice. */
const HUMERUS_PANE = 0.6;

export const detail: OrganDetailSpec = {
  animate: (ctx) => {
    ctx.part('humeri')?.setOpacity(HUMERUS_PANE);
    ctx.part('joint_capsule')?.setOpacity(0.22);
    ctx.part('synovial_membrane')?.setOpacity(0.3);
    ctx.part('glenohumeral_articular_cartilage')?.setOpacity(0.85);
    ctx.part('glenohumeral_joints')?.setOpacity(0.7);
  },
};
