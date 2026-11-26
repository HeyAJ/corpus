import * as THREE from 'three';
import { mergeParts, type V3 } from '../sdf';
import { bothSides, localFrame, slab, trunkPoint } from './muscle_stub';

/**
 * CHEST WALL MUSCLES, SHELL (a stub: one honest silhouette per group, in the right place).
 * A LAYER organ of the muscles layer, in the thoracic group.
 *
 * FRAME. Origin organs.json [0, 0.2, 0], the rib cage's own origin: these muscles lie on the
 * ribs, so their position is the cage's, and the thoracic group has no exploded-stack offset, so
 * body coordinates are scene coordinates here. Every sheet follows the cage's own cross-section
 * (`trunkPoint` over `cageRing` in shells/thoracic_cage.ts, the ellipse the ribs are drawn on),
 * standing off it by a little more than a rib's radius (0.0036 m) so the sheet clears the ribs
 * it covers instead of cutting them, and by progressively more for the layers that lie
 * outside others.
 *
 * WHAT IS DRAWN, per side. The INTERCOSTAL layer: a thin sheet on the ribs from the spine's
 * side round to the sternum. PECTORALIS MINOR: a small sheet on ribs 3 to 5 deep to the major.
 * PECTORALIS MAJOR: the broad sheet across the front of the upper chest. SERRATUS ANTERIOR: the
 * sheet on the side of the chest over ribs 2 to 8. The stand-offs, the angles that bound each
 * sheet and the thicknesses are DRAWING choices; the cage is the anatomical reference.
 *
 * NOT DRAWN: the subclavius, the transversus thoracis, the levatores costarum and the serrati
 * posteriores; the breast is the breast organ's, which lies over the pectoralis major.
 */

/** The organ's origin, organs.json (the rib cage's). */
export const ORIGIN: V3 = [0, 0.2, 0];
const F = localFrame(ORIGIN, 0);

/** A sheet on the cage, right side (+1) or left (-1): angles a0..a1 (0 back midline, pi front), heights y0 down to y1. */
export function cageSheet(side: number, a0: number, a1: number, y0: number, y1: number, off: number, thick: number, nu: number, nv: number): THREE.BufferGeometry {
  const yMid = (y0 + y1) / 2;
  return slab(
    (u, v) => F.rigid(trunkPoint(side, y0 + (y1 - y0) * v, a0 + (a1 - a0) * u, off), 0),
    thick,
    nu,
    nv,
    F.rigid([0, yMid, 0], 0),
  );
}

/** The geometry of each part, keyed by the part's id in src/data/anatomy/chest_wall_muscles.json. */
export function chestWallMuscleGroups(): Record<string, THREE.BufferGeometry[]> {
  return {
    intercostal_muscles: bothSides((s) => [cageSheet(s, 0.3, 2.85, 0.282, 0.05, 0.0036, 0.002, 8, 5)]),
    pectoralis_minor: bothSides((s) => [cageSheet(s, 2.2, 2.65, 0.236, 0.15, 0.0046, 0.002, 3, 3)]),
    pectoralis_major: bothSides((s) => [cageSheet(s, 2.1, 2.95, 0.268, 0.13, 0.0066, 0.0035, 4, 4)]),
    serratus_anterior: bothSides((s) => [cageSheet(s, 1.1, 2.1, 0.225, 0.085, 0.0056, 0.003, 4, 4)]),
  };
}

export function chestWallMuscles(): THREE.BufferGeometry {
  return mergeParts(Object.values(chestWallMuscleGroups()).flat());
}
