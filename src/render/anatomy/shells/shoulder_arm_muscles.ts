import * as THREE from 'three';
import { mergeParts, type V3 } from '../sdf';
import { SCAPULA_THICK, SHAFT_PTS, scapulaZ } from './upper_limb_bones';
import { bothSides, localFrame, onSide, spindle } from './muscle_stub';

/**
 * SHOULDER AND UPPER ARM MUSCLES, SHELL (a stub: one honest silhouette per group, in the right
 * place). A LAYER organ of the muscles layer, in the thoracic group.
 *
 * FRAME. Origin organs.json [0, 0.2, 0], the shoulder and arm bones' own origin, because every
 * muscle here wraps or joins those bones; the thoracic group has no exploded-stack offset. Every
 * point is the bone's own number (shells/upper_limb_bones.ts): the humerus's shaft centreline
 * `SHAFT_PTS` carries the biceps in front of it and the triceps behind it, standing off by the
 * shaft's radius plus the muscle's own, and the rotator cuff lies on the scapula at `scapulaZ`,
 * behind the plate for the supraspinatus, infraspinatus and teres minor and in front of it for
 * the subscapularis, which has the 7 mm the plate's stand-off from the ribs leaves (0.0135 less
 * the plate's half-thickness 0.0027 less a rib's radius 0.0036), so it is drawn 3.3 mm thick
 * and no thicker.
 *
 * THE GLASS ARM. The figure's arm is narrow (x 0.20 at the shoulder, z -0.04 to 0.05 at x 0.18)
 * and ends at the elbow, so the biceps and triceps are slim, end at the elbow, and the forearm
 * is not drawn. The deltoid is a cap over the humeral head and the tubercles (the head is at x
 * 0.158, the greater tubercle reaches x 0.178).
 *
 * NOT DRAWN: coracobrachialis, brachialis, the forearm, the hand, the pectoralis major's
 * insertion (the chest wall organ draws that muscle) and the latissimus's (the back organ's).
 */

export const ORIGIN: V3 = [0, 0.2, 0];
const F = localFrame(ORIGIN, 0);
const bone = (p: V3, side: number): V3 => F.rigid(onSide(p, side), 0);

/** The geometry of each part, keyed by the part's id in src/data/anatomy/shoulder_arm_muscles.json. */
export function shoulderArmMuscleGroups(): Record<string, THREE.BufferGeometry[]> {
  const behind = (x: number, y: number, standoff: number): V3 => [x, y, scapulaZ(x, y) - SCAPULA_THICK / 2 - standoff];
  const front = (x: number, y: number): V3 => [x, y, scapulaZ(x, y) + SCAPULA_THICK / 2 + 0.0045];
  const head = SHAFT_PTS[0];
  const elbow = SHAFT_PTS[SHAFT_PTS.length - 1];
  return {
    // A cap over the humeral head and the tubercles.
    deltoid: bothSides((s) => [spindle(bone([0.172, 0.192, -0.004], s), bone([0.172, 0.264, -0.004], s), 0.0245, 1.0, [0, 0, 1], 10, 6)]),
    // Supraspinatus above the spine of the scapula, infraspinatus below it, teres minor along the lateral border, subscapularis on the front of the plate.
    rotator_cuff: bothSides((s) => [
      spindle(bone(behind(0.064, 0.257, 0.0045), s), bone(behind(0.14, 0.2565, 0.0045), s), 0.007, 0.55, [0, 0, 1], 8, 5),
      spindle(bone(behind(0.072, 0.205, 0.0045), s), bone(behind(0.132, 0.233, 0.0045), s), 0.0085, 0.55, [0, 0, 1], 8, 5),
      spindle(bone(behind(0.122, 0.2, 0.0045), s), bone(behind(0.138, 0.238, 0.0045), s), 0.0042, 0.8, [0, 0, 1], 8, 5),
      spindle(bone(front(0.076, 0.21), s), bone(front(0.14, 0.228), s), 0.008, 0.4, [0, 0, 1], 8, 5),
    ]),
    // In front of the shaft, from the head's level to the elbow.
    biceps_brachii: bothSides((s) => [
      spindle(bone([head[0] + 0.001, 0.235, head[2] + 0.0076 + 0.0105], s), bone([elbow[0], 0.133, elbow[2] + 0.0105 + 0.0105], s), 0.0105, 1.0, [0, 0, 1], 8, 5),
    ]),
    // Behind the shaft.
    triceps_brachii: bothSides((s) => [
      spindle(bone([head[0] + 0.001, 0.232, head[2] - 0.0076 - 0.0105], s), bone([elbow[0] + 0.001, 0.14, elbow[2] - 0.0105 - 0.0095], s), 0.0105, 1.0, [0, 0, 1], 8, 5),
    ]),
  };
}

export function shoulderArmMuscles(): THREE.BufferGeometry {
  return mergeParts(Object.values(shoulderArmMuscleGroups()).flat());
}
