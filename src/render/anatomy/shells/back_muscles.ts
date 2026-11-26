import * as THREE from 'three';
import { mergeParts, type V3 } from '../sdf';
import { SCAPULA_THICK, scapulaZ } from './upper_limb_bones';
import { bothSides, localFrame, onSide, slab, spindle, strap, trunkPoint } from './muscle_stub';

/**
 * BACK MUSCLES, SHELL (a stub: one honest silhouette per group, in the right place).
 * A LAYER organ of the muscles layer, and an AXIAL one like the vertebral column it moves.
 *
 * FRAME. Origin organs.json [0, 0, 0], group `axial` (offset 0): authored in unexploded body
 * coordinates and bent by the exploded stack's continuous warp, exactly as the spinal cord and
 * the vertebral column are. `Frame.warp` applies that warp to every control point, so the
 * erector spinae is one continuous column from the neck to the sacrum with the stack's gaps
 * stretched into it, and not seven rigid pieces.
 *
 * WHERE THE SPINE'S BACK IS. The muscles lie behind and beside the spinous processes, so the
 * numbers they need are the column's own: `SPINE_BACK` is the most posterior z of the vertebral
 * column shell in each 2 cm band, read off its vertices (a probe of shells/vertebral_column.ts),
 * not typed in. The erector spinae lies in the groove between those processes (x 0.03) and the
 * rib angles, so its back surface is about 1 cm behind them. Sheets over the ribs follow the
 * cage ellipse (`trunkPoint`, muscle_stub.ts) and stand off it by the thickness of what lies
 * deeper: over the scapula the standoff includes the scapular plate (0.0135 plus half its 5.4 mm
 * thickness, shells/upper_limb_bones.ts) so the trapezius clears the shoulder blade.
 *
 * WHAT IS DRAWN, per side. TRAPEZIUS: a broad sheet from the neck to the lower thorax; LATISSIMUS
 * DORSI: the broad sheet of the lower back; RHOMBOIDS: two spindles from the spinous processes to
 * the scapula's medial border, deep to the trapezius; ERECTOR SPINAE: the long column beside the
 * spine from the sacrum to the neck; DEEP BACK: a thin strap in the groove against the spinous
 * processes. The widths, the outlines of the sheets and the radii are drawing choices.
 *
 * NOT DRAWN: the suboccipital muscles, the serrati posteriores, the levator scapulae (the head
 * and neck stub does not have it either), the thoracolumbar fascia.
 */

export const ORIGIN: V3 = [0, 0, 0];
const F = localFrame(ORIGIN, 0);

/** Most posterior z of the vertebral column shell by height (y descending): probed from the shell's vertices in 2 cm bands. A measurement of THIS model's spine, not of a person. */
const SPINE_BACK: readonly (readonly [number, number])[] = [
  [0.38, -0.059], [0.36, -0.075], [0.34, -0.077], [0.32, -0.097], [0.3, -0.078], [0.26, -0.085], [0.2, -0.091], [0.14, -0.091],
  [0.12, -0.08], [0.02, -0.075], [0, -0.092], [-0.06, -0.099], [-0.1, -0.104], [-0.14, -0.088], [-0.18, -0.077],
];
export function spineBack(y: number): number {
  const t = SPINE_BACK;
  if (y >= t[0][0]) return t[0][1];
  for (let i = 0; i < t.length - 1; i++) {
    if (y <= t[i][0] && y >= t[i + 1][0]) return t[i][1] + ((t[i + 1][1] - t[i][1]) * (t[i][0] - y)) / (t[i][0] - t[i + 1][0]);
  }
  return t[t.length - 1][1];
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A sheet on the back, right (+1) or left (-1). `bounds(v)` gives the angle range at fraction v of the height range. */
function backSheet(
  side: number,
  y0: number,
  y1: number,
  bounds: (v: number) => [number, number],
  off: (a: number) => number,
  thick: number,
  nu: number,
  nv: number,
): THREE.BufferGeometry {
  return slab(
    (u, v) => {
      const [a0, a1] = bounds(v);
      const a = a0 + (a1 - a0) * u;
      return F.warp(trunkPoint(side, y0 + (y1 - y0) * v, a, off(a)));
    },
    thick,
    nu,
    nv,
    F.warp([0, (y0 + y1) / 2, 0.02]),
  );
}

/** The geometry of each part, keyed by the part's id in src/data/anatomy/back_muscles.json. */
export function backMuscleGroups(): Record<string, THREE.BufferGeometry[]> {
  // Over the spine the sheet lies close; over the scapula it stands off by the plate's depth plus a little.
  const scapularStandoff = 0.0135 + SCAPULA_THICK / 2 + 0.003;
  const zOf = (x: number, y: number): number => scapulaZ(x, y) - SCAPULA_THICK / 2 - 0.004;
  return {
    // From y 0.355 (the neck) to 0.11: wide over the shoulder at the top, a point at the bottom.
    trapezius: bothSides((s) => [
      backSheet(s, 0.355, 0.11, (v) => [0.05, 0.35 + 0.85 * Math.sin(Math.PI * Math.min(1, 0.25 + 0.6 * v) ** 0.9)], (a) => 0.004 + (scapularStandoff - 0.004) * smooth(0.3, 0.75, a), 0.004, 5, 5),
    ]),
    // The lower back, from the lower scapular angle to the iliac crest, round the flank.
    latissimus_dorsi: bothSides((s) => [backSheet(s, 0.17, -0.09, () => [0.28, 1.45], () => 0.0075, 0.004, 4, 4)]),
    // Spinous processes to the medial border of the scapula, just behind the plate.
    rhomboid_muscles: bothSides((s) =>
      ([[0.3, 0.255], [0.255, 0.185]] as const).map(([yA, yB]) =>
        spindle(F.warp(onSide([0.01, yA, spineBack(yA) - 0.002], s)), F.warp(onSide([0.056, yB, zOf(0.056, yB)], s)), 0.0085, 0.4, [0, 0, 1], 8, 5),
      ),
    ),
    // The groove beside the spinous processes, sacrum to neck.
    erector_spinae: bothSides((s) => {
      const ys = [-0.07, -0.02, 0.04, 0.12, 0.2, 0.28, 0.335];
      return [strap(ys.map((y) => F.warp(onSide([0.032, y, spineBack(y)], s))), 0.011, 10, 4)];
    }),
    // Multifidus and the rotatores against the spinous processes.
    deep_back_muscles: bothSides((s) => {
      const yd = [-0.12, -0.06, 0, 0.1, 0.2, 0.3, 0.36];
      return [strap(yd.map((y) => F.warp(onSide([0.013, y, spineBack(y) + 0.004], s))), 0.0048, 10, 4)];
    }),
  };
}

export function backMuscles(): THREE.BufferGeometry {
  return mergeParts(Object.values(backMuscleGroups()).flat());
}
