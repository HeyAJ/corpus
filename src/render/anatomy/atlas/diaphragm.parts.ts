import * as THREE from 'three';
import type { PartBuilder } from '../parts';
import { DIAPHRAGM_FOOTPRINT, diaphragmHeight } from '../models';
import { mergeParts, tubeAlong, type V3 } from '../sdf';

/**
 * INTERIOR PARTS OF THE DIAPHRAGM: every part lies ON the sheet that models.ts draws.
 *
 * The shell is a single surface, `diaphragmHeight(x, z)` over an elliptical footprint. The
 * parts are thin slabs (about two millimetres thick, centred on that surface) and tubes laid
 * along it: the trefoil central tendon, a ring of forty radial muscle strips running from
 * the tendon out to the rim, the two crura, three rings for the openings the oesophagus,
 * the aorta and the inferior vena cava pass through, and the phrenic nerves that supply it.
 *
 * WHY SLABS ARE BUILT BY HAND. Polygonising a two-millimetre sheet this wide would need a
 * sub-millimetre grid; a slab over a polar patch of the footprint is a few hundred
 * triangles and follows the sheet exactly.
 *
 * Positions are polar fractions of the footprint: x = A f cos(t), z = B f sin(t) with
 * (A, B) the footprint's semi-axes, so t = 90 degrees is the front (+z) and t = 270 the back.
 */

const A = DIAPHRAGM_FOOTPRINT[0];
const B = DIAPHRAGM_FOOTPRINT[1];
const TAU = Math.PI * 2;
/** Half the slab's thickness, metres. The shell's bounding box is matched to within 2 mm. */
const HALF = 0.001;
/** Muscle ends this fraction of the way to the rim, so it does not overhang where the sheet turns steeply down. */
const RIM = 0.97;

/** Bump on the unit circle centred at angle `c`: 1 at c, falling away. */
function leaf(theta: number, c: number): number {
  return Math.exp(3 * (Math.cos(theta - c) - 1));
}

/**
 * Radial extent of the central tendon at angle `theta`, as a fraction of the footprint.
 * A trefoil: a right leaf (the largest), a left leaf and an anterior leaf.
 */
export function tendonFraction(theta: number): number {
  const d = Math.PI / 180;
  return 0.3 + 0.16 * (1.0 * leaf(theta, -20 * d) + 0.85 * leaf(theta, 200 * d) + 0.8 * leaf(theta, 90 * d));
}

/** A point of the footprint (polar fraction) lifted `lift` metres off the sheet. */
function onSheet(f: number, theta: number, lift: number): V3 {
  const x = A * f * Math.cos(theta);
  const z = B * f * Math.sin(theta);
  return [x, diaphragmHeight(x, z) + lift, z];
}

/** A point given by (x, z) on the sheet, lifted. */
function at(x: number, z: number, lift: number): V3 {
  return [x, diaphragmHeight(x, z) + lift, z];
}

/**
 * A closed slab over the polar patch theta in [t0, t1], f in [fIn(theta), fOut(theta)]:
 * a top grid, a bottom grid and four walls, sharing the edge vertices.
 */
function patch(
  t0: number, t1: number, fIn: (t: number) => number, fOut: (t: number) => number, nt: number, nf: number,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const row = nt + 1;
  const grid = (lift: number): number => {
    const base = pos.length / 3;
    for (let j = 0; j <= nf; j++) {
      for (let i = 0; i <= nt; i++) {
        const t = t0 + ((t1 - t0) * i) / nt;
        const f = fIn(t) + ((fOut(t) - fIn(t)) * j) / nf;
        const p = onSheet(f, t, lift);
        pos.push(p[0], p[1], p[2]);
      }
    }
    return base;
  };
  const top = grid(HALF);
  const bot = grid(-HALF);
  const quad = (base: number, flip: boolean): void => {
    for (let j = 0; j < nf; j++) {
      for (let i = 0; i < nt; i++) {
        const a = base + j * row + i, b = a + 1, c = a + row, d = c + 1;
        if (flip) idx.push(a, b, c, b, d, c);
        else idx.push(a, c, b, b, c, d);
      }
    }
  };
  quad(top, false);
  quad(bot, true);
  // Walls: the four edges of the patch, each a strip between the top and bottom vertex.
  const wall = (va: (k: number) => number, n: number, flip: boolean): void => {
    for (let k = 0; k < n; k++) {
      const a = va(k), b = va(k + 1);
      if (flip) idx.push(top + a, bot + a, top + b, top + b, bot + a, bot + b);
      else idx.push(top + a, top + b, bot + a, top + b, bot + b, bot + a);
    }
  };
  wall((k) => k, nt, false); // inner edge
  wall((k) => nf * row + k, nt, true); // outer edge
  wall((k) => k * row, nf, true); // t0 edge
  wall((k) => k * row + nt, nf, false); // t1 edge
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  // Wind the top face so it points up: test the first top triangle and flip everything if not.
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const [i0, i1, i2] = [idx[0], idx[1], idx[2]];
  const ux = p.getX(i1) - p.getX(i0), uz = p.getZ(i1) - p.getZ(i0);
  const vx = p.getX(i2) - p.getX(i0), vz = p.getZ(i2) - p.getZ(i0);
  const ny = uz * vx - ux * vz;
  if (ny < 0) {
    for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
  }
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function centralTendon(): THREE.BufferGeometry {
  return patch(0, TAU, () => 0, tendonFraction, 48, 8);
}

/** Forty thin strips of muscle, tendon to rim, with a sliver of gap between neighbours. */
function costalMuscle(): THREE.BufferGeometry {
  const n = 40;
  const list: THREE.BufferGeometry[] = [];
  for (let k = 0; k < n; k++) {
    const t0 = (k / n) * TAU + 0.012;
    const t1 = ((k + 1) / n) * TAU - 0.012;
    list.push(patch(t0, t1, (t) => tendonFraction(t) + 0.012, () => RIM, 1, 6));
  }
  return mergeParts(list);
}

/** A crus: the tendon-and-muscle band that anchors the sheet to the lumbar spine. Same path as the shell's, a little slimmer. */
function crus(s: number, bottom: number): THREE.BufferGeometry {
  return tubeAlong(
    [
      [s * 0.014, diaphragmHeight(s * 0.014, -0.07), -0.07],
      [s * 0.011, -0.05, -0.064],
      [s * 0.008, bottom, -0.058],
    ],
    (t) => 0.0042 - 0.0022 * t,
    { tubular: 16, radial: 6 },
  );
}

/** A ring of tube laid on the sheet round (cx, cz), radius r: the margin of an opening. */
function opening(cx: number, cz: number, r: number, tube: number): THREE.BufferGeometry {
  const pts: V3[] = [];
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    pts.push(at(cx + r * Math.cos(a), cz + r * Math.sin(a), 0));
  }
  return tubeAlong(pts, () => tube, { tubular: 36, radial: 5, closed: true });
}

/** (x, z) of the phrenic nerve's trunk and its three branches, for each side (s = +1 right). */
export function phrenicRoute(s: number): { trunk: [number, number][]; branches: [number, number][][] } {
  const split: [number, number] = [s * 0.046, 0.012];
  return {
    trunk: [[s * 0.026, 0.038], [s * 0.038, 0.026], split],
    branches: [
      [split, [s * 0.05, 0.03], [s * 0.056, 0.05]], // anterior
      [split, [s * 0.07, 0.006], [s * 0.088, -0.002]], // lateral
      [split, [s * 0.05, -0.024], [s * 0.056, -0.05]], // posterior
    ],
  };
}

/** Densify a polyline of (x, z) points so the tube follows the curve of the sheet between them. */
export function sheetPath(xz: readonly [number, number][], lift: number): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < xz.length - 1; i++) {
    for (let k = 0; k < 4; k++) {
      const t = k / 4;
      out.push(at(xz[i][0] + (xz[i + 1][0] - xz[i][0]) * t, xz[i][1] + (xz[i + 1][1] - xz[i][1]) * t, lift));
    }
  }
  const last = xz[xz.length - 1];
  out.push(at(last[0], last[1], lift));
  return out;
}

export const NERVE_LIFT = 0.001;

function phrenicNerves(): THREE.BufferGeometry {
  const list: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    const r = phrenicRoute(s);
    list.push(tubeAlong(sheetPath(r.trunk, NERVE_LIFT), () => 0.0009, { tubular: 14, radial: 5 }));
    for (const b of r.branches) list.push(tubeAlong(sheetPath(b, NERVE_LIFT), (t) => 0.0007 - 0.0003 * t, { tubular: 12, radial: 5 }));
  }
  return mergeParts(list);
}

export const parts: PartBuilder = () => [
  { id: 'central_tendon', geometry: centralTendon() },
  { id: 'costal_muscle', geometry: costalMuscle() },
  { id: 'right_crus', geometry: crus(1, -0.098) },
  { id: 'left_crus', geometry: crus(-1, -0.084) },
  // The IVC passes through the tendon to the right of the midline.
  { id: 'caval_opening', geometry: opening(0.034, 0.004, 0.009, 0.0014) },
  // The oesophagus passes through muscle, left of the midline and further back.
  { id: 'oesophageal_hiatus', geometry: opening(-0.012, -0.042, 0.0065, 0.0013) },
  // The aorta passes behind the diaphragm, between the crura, in the midline.
  { id: 'aortic_hiatus', geometry: opening(0, -0.066, 0.0085, 0.0013) },
  { id: 'phrenic_nerves', geometry: phrenicNerves() },
];
