import type { OrganDetailSpec } from '../detail/types';

/**
 * No streams and no motion: this organ is bone, and bone is not simulated as tissue (the only live
 * part is the red marrow of the ilium, which glows with erythropoietin through the default
 * activity glow).
 *
 * What this file does is set how see-through each part is, so that what lies inside can be seen:
 * the femur and its joint are panes so that the bone tissue drawn inside the right femur and the
 * capsule round the joint show, and the sleeves and cartilage caps are faint glass. These
 * opacities are DISPLAY choices and say nothing about how translucent real bone is.
 */

/** Opacity of the femur and of the hip joint's marker. A display choice. */
const FEMUR_PANE = 0.4;

export const detail: OrganDetailSpec = {
  animate: (ctx) => {
    ctx.part('femora')?.setOpacity(FEMUR_PANE);
    // The compact bone is the cortex of the same shaft, so it sits as a pane too; the sleeves are faint glass.
    ctx.part('compact_bone')?.setOpacity(0.55);
    for (const id of ['periosteum', 'endosteum', 'circumferential_lamellae', 'medullary_cavity']) ctx.part(id)?.setOpacity(0.22);
    for (const id of ['hip_joint_capsule', 'hip_synovial_membrane']) ctx.part(id)?.setOpacity(0.22);
    ctx.part('hip_joints')?.setOpacity(0.35);
    ctx.part('obturator_foramen')?.setOpacity(0.3);
    ctx.part('spongy_bone')?.setOpacity(0.3);
    ctx.part('osteon')?.setOpacity(0.3);
    ctx.part('concentric_lamellae')?.setOpacity(0.35);
    for (const id of ['hip_articular_cartilage', 'femoral_articular_cartilage']) ctx.part(id)?.setOpacity(0.8);
  },
};
