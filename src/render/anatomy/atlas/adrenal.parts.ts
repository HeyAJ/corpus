import type { PartBuilder } from '../parts';
import { capsule, ellipsoid, mergeParts, offset, polygonise, smoothSubtract, smoothUnion, sphere, tubeAlong, type Sdf, type V3 } from '../sdf';

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
 * Deterministic, no randomness at all. No physiological numbers are involved.
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

  return [
    { id: 'capsule', geometry: layer(DEPTH.capsule) },
    { id: 'zona_glomerulosa', geometry: layer(DEPTH.glomerulosa) },
    { id: 'zona_fasciculata', geometry: layer(DEPTH.fasciculata) },
    { id: 'zona_reticularis', geometry: layer(DEPTH.reticularis) },
    { id: 'medulla', geometry: layer(DEPTH.medulla) },
    { id: 'central_vein', geometry: tubeAlong(CENTRAL_VEIN[k], () => 0.0007, { tubular: 20, radial: 7 }) },
    { id: 'suprarenal_arteries', geometry: tubes(ARTERIES[k], 0.0004) },
    { id: 'splanchnic_fibres', geometry: tubes(FIBRES[k], 0.00025) },
  ];
};
