import type { OrganDetailSpec } from '../detail/types';

/**
 * No streams and no animation. Bone is not simulated as tissue and no part of this organ has a
 * drive, so there is nothing to move; a skull that nodded with the breath would be a lie.
 *
 * WHICH PARTS ARE GLASS. A part drawn below 0.98 opacity stops writing depth and lets what is
 * behind it show (OrganDetail explains). The large bones are WALLS round the brain, the eyes and
 * the nose, so they are glass or the brain, the thing a viewer opens the skull to see, is hidden
 * behind the frontal bone; the thin or small pieces (sutures, markers, the processes, the sella,
 * the disc) stay solid so they can be seen against the glass. The opacities are display choices,
 * picked so that the vault, the face and the jaw can each be told from the next, not measured
 * transparency.
 */
const GLASS: Readonly<Record<string, number>> = {
  frontal_bone: 0.3,
  parietal_bone_right: 0.3,
  parietal_bone_left: 0.3,
  temporal_bone_right: 0.34,
  temporal_bone_left: 0.34,
  occipital_bone: 0.32,
  sphenoid_bone: 0.38,
  ethmoid_bone: 0.4,
  nasal_bones: 0.5,
  maxillae: 0.42,
  zygomatic_bones: 0.45,
  mandible: 0.5,
  orbits: 0.18,
  anterior_cranial_fossa: 0.45,
  middle_cranial_fossa: 0.45,
  posterior_cranial_fossa: 0.45,
  temporomandibular_joint: 0.22,
  joint_capsule: 0.2,
  maxillary_sinus_walls: 0.3,
};

export const detail: OrganDetailSpec = {
  animate: (ctx) => {
    for (const id of Object.keys(GLASS)) ctx.part(id)?.setOpacity(GLASS[id]);
  },
};
