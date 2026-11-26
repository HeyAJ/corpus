import type { OrganDetailSpec } from '../detail/types';

/**
 * THE HEAD AND NECK MUSCLES IN MOTION: the swallow, and nothing else.
 *
 * WHAT IS SIMULATED. Only the whole-body signals the engine has: muscle tone (rigidity and
 * paralysis), a seizure, ventilation, and the `swallowing` signal (something is in the
 * oesophagus), which the atlas file turns into the hyoid group's activity. Chewing, speech, head
 * movement and the effort of a forced breath are NOT simulated, so nothing here chews or turns the
 * head, and the sternocleidomastoids and scalenes do not move with the ribs they lift (they are
 * recoloured by `ventilation`, nothing more).
 *
 * THE SWALLOW GESTURE. Guyton and Hall describe the pharyngeal stage of a swallow as the larynx
 * moving up and the hyoid being drawn forward and up. The suprahyoid and infrahyoid muscles are the
 * ones that do it, so the hyoid group and every muscle in it are lifted by one rigid display offset
 * while the group's activity is above its resting level by the swallowing drive. The offset is eased
 * (a pulled-up hyoid does not teleport), frozen at zero under reduced motion, and its size
 * (`HYOID_LIFT_M`) is a DISPLAY AMPLITUDE chosen so it can be seen from an open organ's working
 * distance; it is not a measured excursion. The muscles' own ends do not stretch to follow it,
 * because the parts are rigid meshes, so the gesture is a lift of the whole group.
 */

/** How far the hyoid group rises in the swallow, metres of scene height. A display amplitude. */
export const HYOID_LIFT_M = 0.003;
/** How far it comes forward at the same time. A display amplitude. */
export const HYOID_FORWARD_M = 0.0015;
/** Rest activity of the hyoid group (src/data/anatomy/head_neck_muscles.json) and the weight of its swallowing drive. */
const HYOID_REST = 0.2;
const HYOID_SWALLOW_WEIGHT = 0.4;
/** Easing rate of the lift, per second. A display choice. */
const EASE_PER_S = 9;

const MOVING = [
  'hyoid_muscles', 'digastric', 'digastric_posterior_belly', 'digastric_intermediate_tendon', 'digastric_anterior_belly',
  'stylohyoid', 'mylohyoid', 'geniohyoid', 'sternohyoid', 'omohyoid', 'omohyoid_inferior_belly', 'omohyoid_intermediate_tendon',
  'omohyoid_superior_belly', 'sternothyroid', 'thyrohyoid',
];

let lift = 0;
let lastTime = 0;

export const detail: OrganDetailSpec = {
  animate: (ctx) => {
    if (ctx.time < lastTime) lift = 0;
    lastTime = ctx.time;
    // The swallowing signal is 0 or 1; the part's activity is rest plus weight times that (less any paralysis), so the fraction above rest is the drive.
    const drive = ctx.reducedMotion ? 0 : Math.max(0, Math.min(1, (ctx.activity('hyoid_muscles') - HYOID_REST) / HYOID_SWALLOW_WEIGHT));
    lift += (drive - lift) * Math.min(1, EASE_PER_S * ctx.dt);
    for (const id of MOVING) ctx.part(id)?.setOffset([0, HYOID_LIFT_M * lift, HYOID_FORWARD_M * lift]);
  },
};
