import * as THREE from 'three';
import { mergeParts, type V3 } from '../sdf';
import { GREATER, PUBIC_BODY, TUBEROSITY, shaftAxisAt, shaftRadiusAt } from './lower_limb_bones';
import { bothSides, localFrame, onSide, spindle } from './muscle_stub';

/**
 * HIP AND THIGH MUSCLES, SHELL (a stub: one honest silhouette per group, in the right place).
 * A LAYER organ of the muscles layer, in the pelvic group.
 *
 * FRAME. Origin organs.json [0, -0.2, 0], the hip and thigh bones' own origin; the pelvic group
 * is lowered 0.045 by the exploded stack, which `Frame.rigid` adds for every point on a bone (the
 * hip bone and the femur are drawn rigidly with their group). Every point is the bone's own
 * number from shells/lower_limb_bones.ts: the greater trochanter, the lesser trochanter, the
 * ischial tuberosity, the pubic body, the ischial spine, and the femoral shaft's centreline and
 * radius at each height (`shaftAxisAt`, `shaftRadiusAt`). A thigh muscle is a spindle standing off
 * the shaft by the shaft's radius plus its own, in front (quadriceps), behind (hamstrings) or on
 * the inner side (adductors).
 *
 * THE GLASS THIGH. The figure's thigh is slim (at the knee its z runs only -0.03 to 0.06 at
 * x 0.085) so the muscle bellies are drawn as spindles that taper to a tendon above the knee
 * and are not given a real thigh's girth; the hamstrings in particular stop at y -0.27, where
 * the glass behind the shaft runs out. The model's pelvis is also tight inside the glass, so the
 * gluteal spindles are thin. All radii are drawing choices.
 *
 * WHAT IS DRAWN, per side: GLUTEALS (maximus on the back of the sacrum and ilium to the upper
 * shaft; medius and minimus lateral to the ilium to the greater trochanter), SHORT ROTATORS (a
 * piriformis-like spindle from the sacrum to the greater trochanter), QUADRICEPS, ADDUCTORS and
 * HAMSTRINGS.
 *
 * NOT DRAWN: tensor fasciae latae and the iliotibial band, sartorius, gracilis, the lower leg
 * (the skeleton stub ends at the thigh as well).
 */

export const ORIGIN: V3 = [0, -0.2, 0];
/** The pelvic group's offset in the exploded stack. */
export const GROUP_Y = -0.045;
const F = localFrame(ORIGIN, GROUP_Y);
const bone = (p: V3, side: number): V3 => F.rigid(onSide(p, side), GROUP_Y);

/** A point beside the shaft at height y: `forward` metres in front (+) or behind (-), `medial` metres toward the midline (+). */
function besideShaft(y: number, forward: number, medial: number): V3 {
  const c = shaftAxisAt(y);
  const r = shaftRadiusAt(y);
  return [c[0] - Math.sign(medial) * (Math.abs(medial) > 0 ? r + Math.abs(medial) : 0), y, c[2] + Math.sign(forward) * (Math.abs(forward) > 0 ? r + Math.abs(forward) : 0)];
}

/** The geometry of each part, keyed by the part's id in src/data/anatomy/hip_thigh_muscles.json. */
export function hipThighMuscleGroups(): Record<string, THREE.BufferGeometry[]> {
  return {
    // Maximus on the back of the sacrum and ilium to the upper shaft; medius and minimus lateral to the ilium to the greater trochanter.
    gluteal_muscles: bothSides((s) => [
      spindle(bone([0.045, -0.085, -0.09], s), bone([0.1, -0.19, -0.03], s), 0.02, 0.6, [0, 0, 1], 10, 6),
      spindle(bone([0.11, -0.07, -0.05], s), bone([GREATER[0], GREATER[1], GREATER[2]], s), 0.014, 0.5, [1, 0, 0], 8, 5),
    ]),
    // The sacrum (beside the ischial spine's base) to the greater trochanter.
    short_rotators: bothSides((s) => [spindle(bone([0.02, -0.125, -0.07], s), bone([GREATER[0] - 0.004, GREATER[1] - 0.004, GREATER[2] - 0.002], s), 0.0055, 0.8, [0, 0, 1], 8, 5)]),
    // In front of the shaft from the hip to the top of the patella.
    quadriceps_femoris: bothSides((s) => [spindle(bone(besideShaft(-0.19, 0.0155, 0), s), bone(besideShaft(-0.282, 0.0155, 0), s), 0.0155, 1.0, [1, 0, 0], 10, 6)]),
    // From the pubis to the inner side of the shaft.
    adductor_muscles: bothSides((s) => [
      spindle(bone([PUBIC_BODY[0] + 0.005, PUBIC_BODY[1] - 0.005, PUBIC_BODY[2] - 0.004], s), bone(besideShaft(-0.265, 0, 0.011), s), 0.0105, 0.9, [0, 0, 1], 8, 5),
    ]),
    // From the ischial tuberosity down behind the shaft, tapering above the knee.
    hamstring_muscles: bothSides((s) => [spindle(bone([TUBEROSITY[0], TUBEROSITY[1], TUBEROSITY[2]], s), bone(besideShaft(-0.25, -0.009, 0), s), 0.0088, 1.0, [1, 0, 0], 10, 6)]),
  };
}

export function hipThighMuscles(): THREE.BufferGeometry {
  return mergeParts(Object.values(hipThighMuscleGroups()).flat());
}
