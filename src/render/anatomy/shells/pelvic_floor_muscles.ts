import * as THREE from 'three';
import { mergeParts, type V3 } from '../sdf';
import { INFERIOR_RAMUS, PUBIC_BODY, SPINE_TIP, TUBEROSITY } from './lower_limb_bones';
import { COCCYX_BOTTOM } from './vertebral_column';
import { bothSides, localFrame, onSide, slab, spindle, strap } from './muscle_stub';

/**
 * PELVIC FLOOR MUSCLES, SHELL (a stub: one honest silhouette per group, in the right place).
 * A LAYER organ of the muscles layer, in the pelvic group.
 *
 * FRAME. Origin organs.json [0, -0.2, 0]: the level of the lowest points of the pelvic bones,
 * the ischial tuberosity (body y -0.2035) and the tip of the coccyx (-0.197, `COCCYX_BOTTOM`),
 * which the pelvic outlet is bounded by; the same origin as the hip and thigh organ. The pelvic
 * group is lowered 0.045 by the exploded stack, added back by `Frame.rigid` for every point on a
 * bone.
 *
 * WHAT IS DRAWN, per side. LEVATOR ANI: a bowl hung from the pubic body in front to the
 * ischial spine at the side to the coccyx behind, with a central hole for the urethra, vagina
 * and anorectum, drawn as a thin sheet whose rim is the bone's own landmarks and whose centre
 * hangs below them. COCCYGEUS: a spindle from the ischial spine to the side of the coccyx. The
 * PERINEAL muscles that no other atlas draws: ischiocavernosus along the inferior pubic ramus
 * and ischial ramus, and a transverse perineal strap across between the two ischial tuberosities.
 *
 * WHAT WENT WRONG, STATED PLAINLY. The model's pelvic organs hang LOWER than its pelvic bones:
 * the prostate's lowest point is scene y -0.286 and the bladder's -0.278, while the ischial
 * tuberosity is at scene -0.2485 (body -0.2035 less the 0.045 stack offset) and the levator's bony
 * rim is at about -0.205. A bowl that hung only a few centimetres from its rim would be cut by
 * the organs it supports. The centre of the bowl therefore hangs `BOWL_DROP` below the rim, to
 * scene about -0.30, under both. That is the organs' placement, not a claim about the floor's
 * depth, and it should be revisited if the organs are moved up.
 *
 * NOT DRAWN: the external anal sphincter, bulbospongiosus and the deep transverse perineal
 * muscle and sphincter urethrae (the content agent decides how far to go), the perineal body, and
 * the fasciae.
 */

export const ORIGIN: V3 = [0, -0.2, 0];
export const GROUP_Y = -0.045;
const F = localFrame(ORIGIN, GROUP_Y);
const bone = (p: V3, side: number): V3 => F.rigid(onSide(p, side), GROUP_Y);

/** Rim of the levator's bowl (body y, the level of the pubic body's lower half), its half-width (ischial spines at x 0.0745), its front z (pubis) and back z (coccyx tip). */
const RIM_Y = -0.158;
const RIM_HALF_WIDTH = 0.0675;
const RIM_FRONT_Z = 0.052;
const RIM_BACK_Z = -0.05;
/** How far the centre of the bowl hangs below the rim: chosen to clear the prostate and bladder (see above). A drawing choice. */
const BOWL_DROP = 0.093;
/** Fraction of the bowl's radius left open at the centre for the passages. A drawing choice. */
const HOLE = 0.2;

/** The geometry of each part, keyed by the part's id in src/data/anatomy/pelvic_floor_muscles.json. */
export function pelvicFloorMuscleGroups(): Record<string, THREE.BufferGeometry[]> {
  const cz = (RIM_FRONT_Z + RIM_BACK_Z) / 2;
  const hz = (RIM_FRONT_Z - RIM_BACK_Z) / 2;
  return {
    // The bowl: half of it per side (phi from the front midline round to the back midline), r from the hole to the rim.
    levator_ani: bothSides((s) => [
      slab(
        (u, v) => {
          const phi = u * Math.PI; // 0 front midline, pi back midline, through the side
          const r = HOLE + (1 - HOLE) * (1 - v);
          const x = s * RIM_HALF_WIDTH * r * Math.sin(phi);
          const z = cz + hz * r * Math.cos(phi);
          const y = RIM_Y - (BOWL_DROP * (1 - r * r)) / (1 - HOLE * HOLE);
          return F.rigid([x, y, z], GROUP_Y);
        },
        0.004,
        6,
        3,
        F.rigid([0, RIM_Y + 0.04, cz], GROUP_Y),
      ),
    ]),
    coccygeus: bothSides((s) => [spindle(bone(SPINE_TIP, s), bone([0.014, COCCYX_BOTTOM + 0.02, -0.052], s), 0.0045, 0.5, [0, 1, 0], 8, 5)]),
    perineal_muscles: [
      ...bothSides((s) => [strap(INFERIOR_RAMUS.map((p) => bone([p[0], p[1] - 0.002, p[2]], s)), 0.004, 8, 4)]),
      // Transverse perineal: a strap across between the ischial tuberosities, below the outlet.
      strap(
        [bone([-TUBEROSITY[0] + 0.006, TUBEROSITY[1] + 0.004, TUBEROSITY[2] + 0.004], 1), bone([0, TUBEROSITY[1] + 0.006, PUBIC_BODY[2] - 0.03], 1), bone([TUBEROSITY[0] - 0.006, TUBEROSITY[1] + 0.004, TUBEROSITY[2] + 0.004], 1)],
        0.0035,
        8,
        4,
      ),
    ],
  };
}

export function pelvicFloorMuscles(): THREE.BufferGeometry {
  return mergeParts(Object.values(pelvicFloorMuscleGroups()).flat());
}
