import * as THREE from 'three';
import { mergeParts, type V3 } from '../sdf';
import { COLUMN_LEVELS, axisZ } from './vertebral_column';
import { bothSides, localFrame, onSide, slab, spindle, strap, trunkPoint } from './muscle_stub';

/**
 * ABDOMINAL WALL MUSCLES, SHELL (a stub: one honest silhouette per group, in the right place).
 * A LAYER organ of the muscles layer, in the abdominal group.
 *
 * FRAME. Origin organs.json [0, -0.017, 0], DERIVED from the two bones the wall hangs between and
 * not guessed: the top of the rectus is the costal margin at the xiphoid process (scene y 0.1165,
 * the thoracic cage's xiphoid origin 0.127 less its half-length 0.0105, thoracic group offset 0)
 * and the bottom is the pubic tubercle (body y -0.155, which the pelvic group's -0.045 puts at
 * scene -0.200). Their midpoint is scene y -0.042; the abdominal group is lowered 0.025, so the
 * origin is -0.042 + 0.025 = -0.017. (Neither bone is in the abdominal group: the muscle is the
 * thing that joins the thoracic and the pelvic parts of the exploded stack, so its points are
 * brought through the stack's continuous warp, `Frame.warp`, and meet both ends.)
 *
 * WHAT IS DRAWN, per side. On the trunk's own cross-section (`trunkPoint`, muscle_stub.ts: the
 * rib cage's ellipse, tapering below the ribs to the pubis): the RECTUS ABDOMINIS, a straight
 * sheet beside the midline from the xiphoid level to the pubic crest; the three flat muscles of
 * the flank in layers from outside in, EXTERNAL OBLIQUE, INTERNAL OBLIQUE and TRANSVERSUS
 * ABDOMINIS (each about 3 to 4 mm thick, a drawing choice); and the POSTERIOR WALL, a psoas
 * strap from the side of the lumbar column over the pelvic brim to the lesser trochanter, a
 * quadratus lumborum spindle between the 12th rib and the iliac crest behind the kidney, and an
 * iliacus spindle in front of the iliac plate. The layers sit inside the trunk ellipse so the
 * bowel, which reaches x 0.107 and z 0.051 in the model, is not cut.
 *
 * NOT DRAWN: the linea alba, the rectus sheath and the inguinal canal; the cremaster; the
 * pyramidalis. The 4.5 cm gap the exploded stack opens at the pelvic brim stretches the lowest
 * rectus fibres, as it stretches every organ that crosses it.
 */

/** The organ's origin, organs.json. */
export const ORIGIN: V3 = [0, -0.017, 0];
/** The abdominal group's offset in the exploded stack. */
export const GROUP_Y = -0.025;
const F = localFrame(ORIGIN, GROUP_Y);

/** A sheet on the trunk, angles a0..a1 (0 back midline, pi front), heights y0 down to y1, inner face `off` from the ellipse. */
function trunkSheet(side: number, a0: number, a1: number, y0: number, y1: number, off: number, thick: number, nu: number, nv: number): THREE.BufferGeometry {
  return slab((u, v) => F.warp(trunkPoint(side, y0 + (y1 - y0) * v, a0 + (a1 - a0) * u, off)), thick, nu, nv, F.warp([0, (y0 + y1) / 2, 0]));
}

const level = (id: string): number => (COLUMN_LEVELS.find((l) => l.id === id) ?? COLUMN_LEVELS[0]).y;

/** The geometry of each part, keyed by the part's id in src/data/anatomy/abdominal_wall_muscles.json. */
export function abdominalWallMuscleGroups(): Record<string, THREE.BufferGeometry[]> {
  const lesser: V3 = [0.093, -0.195, -0.0145];
  const t12 = level('t12');
  const l4 = level('l4');
  return {
    // Rectus: from the xiphoid level (0.1165) to the pubic crest (-0.152), from 5 mm to 6.5 cm off the midline.
    rectus_abdominis: bothSides((s) => [trunkSheet(s, Math.PI - 0.56, Math.PI - 0.04, 0.1165, -0.152, 0.002, 0.004, 2, 6)]),
    external_oblique: bothSides((s) => [trunkSheet(s, 1.0, 2.55, 0.105, -0.1, 0.003, 0.004, 4, 3)]),
    internal_oblique: bothSides((s) => [trunkSheet(s, 0.95, 2.55, 0.06, -0.135, 0.0, 0.003, 3, 3)]),
    transversus_abdominis: bothSides((s) => [trunkSheet(s, 0.9, 2.55, 0.05, -0.135, -0.0035, 0.0035, 3, 3)]),
    posterior_abdominal_wall: bothSides((s) => [
      // Psoas: the side of T12 to L5, over the pelvic brim, to the lesser trochanter (pelvic group, rigid).
      strap([F.warp(onSide([0.03, t12, axisZ(t12) + 0.03], s)), F.warp(onSide([0.04, l4, axisZ(l4) + 0.034], s)), F.warp(onSide([0.058, -0.105, 0.0], s)), F.rigid(onSide(lesser, s), -0.045)], 0.0085, 8, 4),
      // Quadratus lumborum: between the 12th rib and the iliac crest, behind the kidney (back wall z -0.071).
      spindle(F.warp(onSide([0.052, 0.03, -0.086], s)), F.warp(onSide([0.07, -0.06, -0.086], s)), 0.008, 0.55, [0, 0, 1], 8, 5),
      // Iliacus: in front of the iliac plate, joining the psoas at the lesser trochanter.
      spindle(F.warp(onSide([0.105, -0.07, -0.04], s)), F.rigid(onSide([0.09, -0.185, -0.012], s), -0.045), 0.0105, 0.6, [1, 0, 0], 8, 5),
    ]),
  };
}

export function abdominalWallMuscles(): THREE.BufferGeometry {
  return mergeParts(Object.values(abdominalWallMuscleGroups()).flat());
}
