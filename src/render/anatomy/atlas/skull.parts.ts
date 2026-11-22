import type { PartBuilder } from '../parts';
import type { V3 } from '../sdf';
import { blob, rod } from './stub_shared';

/**
 * STUB INTERIOR OF THE SKULL, in the BRAIN's frame (origin organs.json [0, 0.42, 0]), exactly
 * like the shell in shells/skull.ts, with each part a little smaller than its shell piece.
 * Sizes are drawing choices; the content agent replaces this file with the individual bones.
 */
const MANDIBLE: V3[] = [
  [-0.05, -0.075, -0.012],
  [-0.04, -0.105, 0.028],
  [0, -0.116, 0.058],
  [0.04, -0.105, 0.028],
  [0.05, -0.075, -0.012],
];
const HYOID: V3[] = [
  [-0.014, -0.098, 0.004],
  [0, -0.098, 0.016],
  [0.014, -0.098, 0.004],
];

export const parts: PartBuilder = () => [
  { id: 'cranium', geometry: blob([0, 0.004, -0.004], [0.07, 0.061, 0.083], 20, 12) },
  { id: 'facial_skeleton', geometry: blob([0, -0.05, 0.05], [0.034, 0.025, 0.026]) },
  { id: 'mandible', geometry: rod(MANDIBLE, 0.0045, 20, 6) },
  { id: 'hyoid', geometry: rod(HYOID, 0.002, 8, 5) },
];
