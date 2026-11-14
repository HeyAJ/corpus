import * as THREE from 'three';
import type { PartBuilder } from '../parts';
import { BRONCHUS_LEFT_END, BRONCHUS_RIGHT_END, CARINA } from '../models';
import {
  ellipsoid, halfSpace, intersect, mergeParts, polygonise, shell, tubeAlong, union, torus, type Sdf, type V3,
} from '../sdf';

/**
 * INTERIOR PARTS OF THE TRACHEA, in body coordinates (the trachea's own frame is the body's,
 * and models.ts does not warp it).
 *
 * The shell is a chain through four control points with a larynx, a cricoid ring and two
 * bronchi fused to it. The parts follow the same centreline, drawn a millimetre or two
 * inside the wall so each stays within the shell: a thyroid cartilage shield, two vocal
 * folds, the signet-shaped cricoid, sixteen C-shaped cartilage rings open at the back, the
 * muscular posterior wall that closes each C, the column of air, the carina and the two
 * main bronchi.
 *
 * WHY THE RINGS AND THE TRACHEALIS ARE BUILT BY HAND. A thin curved sheet is exactly what a
 * marching-cubes grid is worst at: to hold a 2 mm wall it needs a cell of about a
 * millimetre and then spends thousands of triangles on a membrane. The rings are swept
 * tubes and the trachealis is a ribbon laid out directly, a few hundred triangles each.
 */

/** The shell's centreline (body coordinates), top to bottom. */
const SPINE: V3[] = [
  [0, 0.352, 0],
  [0, 0.32, 0.002],
  [0, 0.285, 0.004],
  [CARINA[0], CARINA[1], CARINA[2]],
];

/** Depth (z) of the centreline at height y, by straight interpolation between the control points. */
export function tracheaCentreZ(y: number): number {
  for (let i = 0; i < SPINE.length - 1; i++) {
    const a = SPINE[i], b = SPINE[i + 1];
    if (y <= a[1] && y >= b[1]) return a[2] + ((b[2] - a[2]) * (a[1] - y)) / (a[1] - b[1]);
  }
  return y > SPINE[0][1] ? SPINE[0][2] : SPINE[SPINE.length - 1][2];
}

/** Open angle of each C: the arc is drawn this far either side of the front, radians. */
const ARC = 2.1;
/** Radius of the cartilage and muscle band, metres: inside the shell's 9.8 mm wall. */
const RING_R = 0.0086;
export const RING_Y0 = 0.262;
export const RING_COUNT = 16;
export const RING_PITCH = 0.0052;

function larynx(): THREE.BufferGeometry {
  // Two laminae meeting at the front, open behind: a shield, not a bowl.
  const body = shell(ellipsoid([0, 0.364, 0.004], [0.0135, 0.0125, 0.0125]), 0.0016);
  const open = halfSpace([0, 0, 0.0025], [0, 0, 1]);
  return polygonise(intersect(body, open), [-0.016, 0.349, -0.001], [0.016, 0.379, 0.019], { cell: 0.0011 });
}

function vocalFolds(): THREE.BufferGeometry {
  const fold = (s: number): THREE.BufferGeometry =>
    tubeAlong(
      [
        [s * 0.0012, 0.362, 0.0105],
        [s * 0.0026, 0.362, 0.0035],
        [s * 0.0040, 0.362, -0.0035],
      ],
      (t) => 0.0016 - 0.0006 * t,
      { tubular: 8, radial: 6 },
    );
  return mergeParts([fold(1), fold(-1)]);
}

function cricoid(): THREE.BufferGeometry {
  // A signet ring: a thin arch in front, a tall plate behind.
  const f: Sdf = union(torus([0, 0.3505, 0.002], 0.0098, 0.0022, 1), ellipsoid([0, 0.3525, -0.0062], [0.0055, 0.0068, 0.0018]));
  return polygonise(f, [-0.014, 0.342, -0.01], [0.014, 0.362, 0.014], { cell: 0.0009 });
}

function rings(): THREE.BufferGeometry {
  const list: THREE.BufferGeometry[] = [];
  for (let k = 0; k < RING_COUNT; k++) {
    const y = RING_Y0 + k * RING_PITCH;
    const zc = tracheaCentreZ(y);
    const pts: V3[] = [];
    for (let j = 0; j <= 8; j++) {
      const phi = -ARC + (2 * ARC * j) / 8;
      pts.push([RING_R * Math.sin(phi), y, zc + RING_R * Math.cos(phi)]);
    }
    list.push(tubeAlong(pts, () => 0.0009, { tubular: 14, radial: 5 }));
  }
  return mergeParts(list);
}

/** The posterior membranous wall: a ribbon bridging the open back of every C, outer and inner face. */
function trachealis(): THREE.BufferGeometry {
  const N = 16, M = 6;
  const y0 = RING_Y0, y1 = RING_Y0 + (RING_COUNT - 1) * RING_PITCH;
  const pos: number[] = [];
  const idx: number[] = [];
  for (const r of [RING_R + 0.0008, RING_R - 0.0008]) {
    const base = pos.length / 3;
    for (let i = 0; i <= N; i++) {
      const y = y0 + ((y1 - y0) * i) / N;
      const zc = tracheaCentreZ(y);
      for (let j = 0; j <= M; j++) {
        const phi = ARC + ((2 * Math.PI - 2 * ARC) * j) / M;
        pos.push(r * Math.sin(phi), y, zc + r * Math.cos(phi));
      }
    }
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < M; j++) {
        const a = base + i * (M + 1) + j;
        const b = a + 1, c = a + M + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function lumen(): THREE.BufferGeometry {
  return tubeAlong(
    [[0, 0.355, 0.0], ...SPINE.slice(1, 3), [CARINA[0], CARINA[1] + 0.003, CARINA[2]]],
    () => 0.0074,
    { tubular: 30, radial: 10 },
  );
}

function carina(): THREE.BufferGeometry {
  // A sagittal keel at the fork, the ridge the first breath of a bronchoscope meets.
  const f = ellipsoid([CARINA[0], CARINA[1] + 0.0045, CARINA[2]], [0.0012, 0.0035, 0.007]);
  return polygonise(f, [-0.005, CARINA[1] - 0.002, -0.006], [0.005, CARINA[1] + 0.012, 0.016], { cell: 0.0007 });
}

function bronchus(end: V3, r0: number, r1: number): THREE.BufferGeometry {
  const mid: V3 = [(CARINA[0] + end[0]) / 2, (CARINA[1] + end[1]) / 2, (CARINA[2] + end[2]) / 2];
  return tubeAlong([CARINA, mid, end], (t) => r0 + (r1 - r0) * t, { tubular: 14, radial: 8 });
}

export const parts: PartBuilder = () => [
  { id: 'larynx', geometry: larynx() },
  { id: 'vocal_folds', geometry: vocalFolds() },
  { id: 'cricoid_cartilage', geometry: cricoid() },
  { id: 'tracheal_rings', geometry: rings() },
  { id: 'trachealis', geometry: trachealis() },
  { id: 'airway_lumen', geometry: lumen() },
  { id: 'carina', geometry: carina() },
  // The right bronchus is the wider, shorter and steeper of the two.
  { id: 'right_main_bronchus', geometry: bronchus(BRONCHUS_RIGHT_END, 0.0068, 0.0058) },
  { id: 'left_main_bronchus', geometry: bronchus(BRONCHUS_LEFT_END, 0.0058, 0.005) },
];
