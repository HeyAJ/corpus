import * as THREE from 'three';
import type { PartBuilder } from '../parts';
import { capsule, ellipsoid, mergeParts, offset, polygonise, smoothSubtract, smoothUnion, sphere, tubeAlong, type Sdf, type V3 } from '../sdf';
import { add, bead, beads, cord, gradient, perpendicular, sample, unit } from './gland_shared';

/**
 * INTERIOR OF THE ADRENAL (SUPRARENAL) GLAND. One atlas for both glands, as with the
 * kidneys: `params.organ` is `adrenal_l` or `adrenal_r`, and the two are genuinely
 * different shapes (a crescent on the left, a pyramid behind the vena cava on the right),
 * so the envelope below is the same recipe models.ts uses for each side, repeated here
 * because that function is private to models.ts and this file may only import its helpers.
 *
 * THE CORTEX IS ONION-LAYERED, SO IT IS DRAWN AS NESTED SURFACES. Each layer is the
 * shell field pushed inwards by a fixed depth (`offset` with a negative amount shrinks):
 * capsule, then zona glomerulosa, fasciculata and reticularis, then the medulla as a
 * solid core. The depths are drawing choices that keep the layers distinct on a 0.9 mm
 * grid and make the fasciculata the thickest band, as in every histology plate; they are
 * not measurements and are not presented as such.
 *
 * WHY THE ARTERIES AND FIBRES ARE ONLY SHORT STUBS. The part must stay inside the shell.
 * The three groups of suprarenal arteries are therefore drawn from where they pierce the
 * capsule down to the medulla boundary, and the splanchnic fibres from the capsule to the
 * medulla, which is the only place either does anything in the gland. The central vein
 * runs through the medulla and leaves at the hilum on the concave (left) or anterior
 * (right) face.
 *
 * THE FINER STRUCTURES (level-2 and level-3 parts, reveal.ts). Each cortical zone gets a
 * schematic of its CELL CORDS drawn inside its own band: the glomerulosa as short arches
 * (its cells lie in rounded clusters and arching columns), the fasciculata as long straight
 * cords running radially (its cells lie in columns from capsule towards medulla), the
 * reticularis as a meshwork of short oblique cords (anastomosing, GRAYS42). Cords are a few
 * tenths of a millimetre thick, enormously larger than a real cell column, because a true
 * cell would be invisible: they say which way the cells run, not how many there are.
 * The medulla holds ten glass "nests" of chromaffin cells, each with three small solid
 * beads; the beads of alternate nests stand for the adrenaline- and noradrenaline-secreting
 * kinds. WHICH nests hold which kind is NOT anatomy (the two kinds are intermingled in life);
 * alternation is only a way to show both. The three groups of suprarenal arteries are the
 * parent's own centrelines drawn thinner so they lie inside it.
 *
 * Deterministic: the only randomness is a seeded PRNG. No physiological numbers are involved.
 */

const CELL = 0.0009;
const MIN: V3 = [-0.02, -0.014, -0.009];
const MAX: V3 = [0.02, 0.018, 0.009];

/** Depths (m) of each layer's outer surface below the shell: drawing choices, not data. */
const DEPTH = { capsule: 0.0005, glomerulosa: 0.0011, fasciculata: 0.0019, reticularis: 0.0028, medulla: 0.0038 };

function envelope(side: -1 | 1): Sdf {
  return side < 0
    ? smoothSubtract(0.003, ellipsoid([0, 0, 0], [0.017, 0.011, 0.006]), sphere([0.004, -0.016, 0], 0.013))
    : smoothUnion(0.004, ellipsoid([0, -0.002, 0], [0.014, 0.009, 0.006]), capsule([0, 0, 0], [0.002, 0.013, 0], 0.006, 0.002));
}

/** Central vein centreline per side, medulla to hilum (exported for the flows). */
export const CENTRAL_VEIN: Record<'l' | 'r', V3[]> = {
  l: [[-0.009, 0.003, 0], [0, 0, 0.0005], [0.004, -0.001, 0.001], [0.0045, -0.0028, 0.0025]],
  r: [[0.004, 0.001, 0], [0, -0.001, 0.0008], [-0.005, -0.003, 0.003]],
};

/** The three groups of suprarenal arteries (superior, middle, inferior), capsule to medulla. */
export const ARTERIES: Record<'l' | 'r', V3[][]> = {
  l: [
    [[-0.004, 0.0095, 0.001], [-0.002, 0.005, 0.001], [0, 0.002, 0.0012]],
    [[0.0145, -0.001, 0.001], [0.008, 0, 0.001], [0.003, 0.001, 0.0008]],
    [[-0.012, -0.004, 0.001], [-0.007, -0.002, 0.001], [-0.004, 0, 0.0008]],
  ],
  r: [
    [[0.0018, 0.011, 0.0005], [0.001, 0.006, 0.0008], [0, 0.002, 0.001]],
    [[-0.0125, -0.002, 0.001], [-0.007, -0.0015, 0.001], [-0.003, 0, 0.0008]],
    [[0.01, -0.006, 0.001], [0.006, -0.003, 0.001], [0.003, -0.001, 0.0008]],
  ],
};

/** Splanchnic (preganglionic sympathetic) fibres, entering the medulla directly. */
export const FIBRES: Record<'l' | 'r', V3[][]> = {
  l: [
    [[0.0125, -0.0005, 0.003], [0.008, 0, 0.0015], [0.004, 0.001, 0.0004]],
    [[0.0105, 0.003, 0.0035], [0.007, 0.0025, 0.002], [0.003, 0.002, 0.001]],
    [[0.006, 0.008, 0.0025], [0.0035, 0.0055, 0.0015], [0.001, 0.003, 0.0006]],
  ],
  r: [
    [[-0.0105, -0.002, 0.0028], [-0.007, -0.0015, 0.0015], [-0.004, -0.001, 0.0006]],
    [[-0.007, 0.002, 0.0028], [-0.0045, 0.0015, 0.0015], [-0.002, 0, 0.0008]],
    [[0, 0.0065, 0.0015], [0.0004, 0.004, 0.001], [0.0008, 0.002, 0.0008]],
  ],
};

export const parts: PartBuilder = (params) => {
  const side: -1 | 1 = params.organ === 'adrenal_l' ? -1 : 1;
  const k: 'l' | 'r' = side < 0 ? 'l' : 'r';
  const env = envelope(side);
  const layer = (d: number) => polygonise(offset(env, -d), MIN, MAX, { cell: CELL });
  const tubes = (paths: V3[][], r: number) =>
    mergeParts(paths.map((p) => tubeAlong(p, () => r, { tubular: 12, radial: 6 })));

  /* ---- finer structures: everything below is drawn inside its parent's band ---- */
  const depthOf = (x: number, y: number, z: number) => -env(x, y, z);
  const inBand = (lo: number, hi: number) => (x: number, y: number, z: number) => {
    const t = depthOf(x, y, z);
    return t > lo + 0.00012 && t < hi - 0.00012;
  };
  const CORD_R = 0.0002;
  const centreOf = (p: V3, lo: number, hi: number): V3 => {
    // Walk the point along its own normal until it sits mid-band, so cords start centred.
    const n = gradient(env, p);
    const t = depthOf(p[0], p[1], p[2]);
    return add(p, n, t - (lo + hi) / 2);
  };
  const band = (lo: number, hi: number, n: number, seed: number) => sample(inBand(lo, hi), MIN, MAX, n, seed, 0.0016).map((p) => centreOf(p, lo, hi));

  const glomArches = band(DEPTH.glomerulosa, DEPTH.fasciculata, 26, 0x61a1).map((p) => {
    const n = gradient(env, p);
    const u = perpendicular(n);
    return cord([add(add(p, u, -0.0005), n, -0.00012), add(p, n, 0.00014), add(add(p, u, 0.0005), n, -0.00012)], CORD_R, 8, 4);
  });
  const fascCords = band(DEPTH.fasciculata, DEPTH.reticularis, 36, 0xfa5c).map((p) => {
    const n = gradient(env, p);
    return cord([add(p, n, -0.0003), add(p, n, 0.0003)], CORD_R, 2, 4);
  });
  const retCords: THREE.BufferGeometry[] = [];
  const retPts = band(DEPTH.reticularis, DEPTH.medulla, 36, 0x4e71);
  retPts.forEach((p, i) => {
    const n = gradient(env, p);
    const u = perpendicular(n);
    const w = unit(add(u, [n[1] * 0.3, n[2] * 0.3, n[0] * 0.3], i % 2 ? 1 : -1));
    const a = add(p, w, -0.0004);
    const b = add(p, w, 0.0004);
    if (inBand(DEPTH.reticularis, DEPTH.medulla)(...a) && inBand(DEPTH.reticularis, DEPTH.medulla)(...b)) retCords.push(cord([a, b], CORD_R, 2, 4));
  });

  // Chromaffin nests: well inside the medulla (its z half-thickness is only about 2 mm).
  const nestSites = sample((x, y, z) => depthOf(x, y, z) > DEPTH.medulla + 0.0009, MIN, MAX, 10, 0xc4a0, 0.0028, 6000);
  const adrenalineBeads: V3[] = [];
  const noradrenalineBeads: V3[] = [];
  nestSites.forEach((c, i) => {
    for (let j = 0; j < 3; j++) {
      const a = (j / 3) * Math.PI * 2 + i;
      const q: V3 = [c[0] + Math.cos(a) * 0.00028, c[1] + Math.sin(a) * 0.00028, c[2] + (j - 1) * 0.0001];
      (i % 2 ? noradrenalineBeads : adrenalineBeads).push(q);
    }
  });

  const children: { id: string; geometry: THREE.BufferGeometry }[] = [];
  if (glomArches.length) children.push({ id: 'glomerulosa_cell_cords', geometry: mergeParts(glomArches) });
  if (fascCords.length) children.push({ id: 'fasciculata_cell_cords', geometry: mergeParts(fascCords) });
  if (retCords.length) children.push({ id: 'reticularis_cell_cords', geometry: mergeParts(retCords) });
  if (nestSites.length) {
    children.push({ id: 'chromaffin_cells', geometry: mergeParts(nestSites.map((c) => bead(c, 0.0006, 10, 6))) });
    if (adrenalineBeads.length) children.push({ id: 'adrenaline_secreting_cells', geometry: beads(adrenalineBeads, 0.00022, 6, 4) });
    if (noradrenalineBeads.length) children.push({ id: 'noradrenaline_secreting_cells', geometry: beads(noradrenalineBeads, 0.00022, 6, 4) });
  }
  const arteryNames = ['superior_suprarenal_arteries', 'middle_suprarenal_artery', 'inferior_suprarenal_artery'];
  ARTERIES[k].forEach((path, i) => children.push({ id: arteryNames[i], geometry: tubeAlong(path, () => 0.00028, { tubular: 12, radial: 6 }) }));

  return [
    { id: 'capsule', geometry: layer(DEPTH.capsule) },
    { id: 'zona_glomerulosa', geometry: layer(DEPTH.glomerulosa) },
    { id: 'zona_fasciculata', geometry: layer(DEPTH.fasciculata) },
    { id: 'zona_reticularis', geometry: layer(DEPTH.reticularis) },
    { id: 'medulla', geometry: layer(DEPTH.medulla) },
    { id: 'central_vein', geometry: tubeAlong(CENTRAL_VEIN[k], () => 0.0007, { tubular: 20, radial: 7 }) },
    { id: 'suprarenal_arteries', geometry: tubes(ARTERIES[k], 0.0004) },
    { id: 'splanchnic_fibres', geometry: tubes(FIBRES[k], 0.00025) },
    ...children,
  ];
};
