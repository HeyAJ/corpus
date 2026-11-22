import * as THREE from 'three';
import { mergeParts, tubeAlong, type V3 } from '../sdf';

/**
 * RIB CAGE, STUB SHELL. A LAYER organ in the thoracic group.
 *
 * Frame: origin at organs.json [0, 0.2, 0], which is the lungs' own height (lung_r at y 0.21,
 * lung_l at 0.205, spans y -0.105..0.116 about each, so 0.105 to 0.326 in body coordinates)
 * and the heart's (0.168). The cage must enclose them: the lungs reach x 0.134 either side
 * (0.072 + 0.062) and z +-0.066, the thymus and the breasts' base reach z 0.082 forward, so
 * the ribs are loops 0.10 to 0.14 m out and 0.07 to 0.09 m front to back.
 *
 * A stub: six closed rib loops stacked down the chest (each a thin tube following an
 * ellipse, wider and deeper as it goes down, as the real cage is) and a sternum along the
 * front. The content agent replaces it with twelve ribs a side, costal cartilages and the
 * thoracic vertebrae's articulations. Loop sizes and spacing are drawing choices.
 */
function loop(y: number, halfX: number, halfZ: number): THREE.BufferGeometry {
  const pts: V3[] = [];
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([halfX * Math.cos(a), y, halfZ * Math.sin(a)]);
  }
  return tubeAlong(pts, () => 0.0035, { tubular: 28, radial: 4, closed: true });
}

export function thoracicCage(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const levels = [0.115, 0.075, 0.035, -0.005, -0.045, -0.085];
  levels.forEach((y, i) => {
    const t = i / (levels.length - 1);
    parts.push(loop(y, 0.1 + 0.04 * Math.sin(Math.min(1, t * 1.4) * Math.PI * 0.5), 0.07 + 0.02 * t));
  });
  parts.push(
    tubeAlong(
      [
        [0, 0.125, 0.074],
        [0, 0.03, 0.09],
        [0, -0.05, 0.092],
      ],
      () => 0.007,
      { tubular: 10, radial: 6 },
    ),
  );
  return mergeParts(parts);
}
