import type { PartBuilder } from '../parts';
import { mergeParts } from '../sdf';
import { blob, bothSides, rod } from './stub_shared';

/**
 * STUB INTERIOR OF THE EARS, both sides, in the organ's own frame (origin organs.json
 * [0, 0.386, -0.012]; shells/ears.ts has the canal from |x| 0.074 to 0.046, the middle ear at
 * 0.044 and the inner ear at 0.036). Each part is a little smaller than the shell's matching
 * shape. Sizes are drawing choices; the content agent replaces this file with the eardrum, the
 * ossicles, the cochlea's coil and the semicircular canals.
 */
export const parts: PartBuilder = () => [
  { id: 'external_canal', geometry: mergeParts(bothSides((s) => [rod([[s * 0.073, 0, 0], [s * 0.047, -0.002, 0.002]], 0.0022, 6, 6)])) },
  { id: 'middle_ear', geometry: mergeParts(bothSides((s) => [blob([s * 0.044, -0.002, 0.002], [0.0045, 0.0045, 0.0045])])) },
  { id: 'cochlea', geometry: mergeParts(bothSides((s) => [blob([s * 0.0345, -0.0055, -0.0015], [0.0038, 0.0038, 0.0038])])) },
  { id: 'vestibular_apparatus', geometry: mergeParts(bothSides((s) => [blob([s * 0.0375, 0.0035, -0.0045], [0.0035, 0.0035, 0.0035])])) },
];
