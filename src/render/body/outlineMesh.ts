import * as THREE from 'three';
import { polygonise } from '../anatomy/sdf';
import { FADE_LENGTH_M, outlineModel, type OutlineBody } from './outlineModel';

/**
 * THE GLASS FIGURE AS A MESH: polygonise the field of outlineModel.ts and attach, to
 * every vertex, how much of the figure is still there (`fade`).
 *
 * TRIANGLE BUDGET. The brief was at most 15,000 triangles. The grid starts at 13.5 mm
 * and the cell is raised 8 % at a time until the surface fits, so the budget is a
 * guarantee and not a hope; a body with a very large abdomen simply gets a slightly
 * coarser grid. The normals come from the field (sdf.ts), which is what keeps the
 * Fresnel edge smooth on a coarse grid: the material reads N.V at the silhouette and a
 * faceted normal would band exactly there.
 *
 * THE LIMB ENDS. The data has upper arms and thighs only (vessels stop at the elbow and
 * at the popliteal), and a cut limb with a cap is the one thing that would make the
 * figure look like a mannequin torso. So each vertex records `fade`: 1 on the trunk and
 * on the limbs' upper parts, falling to 0 over FADE_LENGTH_M towards the limb's last
 * data point. A vertex counts as a limb vertex in proportion to how much deeper inside
 * the limb's own field than the trunk's it is, so the fade does not leave a seam where
 * the limb meets the body.
 */

export const OUTLINE_MAX_TRIANGLES = 15000;
/** The thighs fade over a shorter length than the arms, metres, so the notch between them stays visible nearer the end. A DISPLAY choice. */
const LEG_FADE_LENGTH_M = 0.035;
const START_CELL_M = 0.0135;

export interface OutlineBuild {
  geometry: THREE.BufferGeometry;
  triangles: number;
  cell: number;
  /** Lowest point of the figure's surface, for the floor shadow. */
  floorY: number;
  /** Half-extents of the figure in x and z, for the shadow's size. */
  halfX: number;
  halfZ: number;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function buildOutline(samples: Float32Array, body: OutlineBody, maxTriangles = OUTLINE_MAX_TRIANGLES): OutlineBuild {
  const model = outlineModel(samples, body);
  let cell = START_CELL_M;
  let geometry: THREE.BufferGeometry | null = null;
  let triangles = Infinity;
  for (let guard = 0; guard < 24; guard++) {
    geometry = polygonise(model.field, model.min, model.max, { cell, pad: 2 });
    triangles = (geometry.getIndex()?.count ?? 0) / 3;
    if (triangles <= maxTriangles) break;
    geometry.dispose();
    cell *= 1.08;
  }
  if (!geometry) throw new Error('outline: no geometry');

  const pos = geometry.getAttribute('position');
  const fade = new Float32Array(pos.count);
  let lowest = Infinity;
  let halfX = 0;
  let halfZ = 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (y < lowest) lowest = y;
    if (Math.abs(x) > halfX) halfX = Math.abs(x);
    if (Math.abs(z) > halfZ) halfZ = Math.abs(z);
    const t = model.trunk(x, y, z);
    const arm = smoothstep(0, 0.02, t - model.arms(x, y, z));
    // The arm's fade applies in proportion to how much the vertex belongs to the arm. The
    // lower fade applies to every vertex: the lowest data point is the figure's end
    // whichever component forms the surface there (the thigh, or the pelvic floor's cap
    // under a male body's genitals), and a cut edge anywhere would read as a mannequin.
    const armFade = smoothstep(model.armEndY, model.armEndY + FADE_LENGTH_M, y);
    const legFade = smoothstep(model.legEndY, model.legEndY + LEG_FADE_LENGTH_M, y);
    fade[i] = (1 - arm * (1 - armFade)) * legFade;
  }
  geometry.setAttribute('fade', new THREE.BufferAttribute(fade, 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return { geometry, triangles, cell, floorY: lowest, halfX, halfZ };
}
