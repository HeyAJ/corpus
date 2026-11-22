import type { PartBuilder } from '../parts';
import { mergeParts, type V3 } from '../sdf';
import { blob, bothSides, rod } from './stub_shared';

/**
 * STUB INTERIOR OF THE SHOULDER AND ARM BONES, in the organ's own frame (origin organs.json
 * [0, 0.2, 0]); the same rods and plates as shells/upper_limb_bones.ts, read off the brachial
 * and subclavian vessels in vasculature.json, at about 80 % of the shell's radii so they lie
 * inside. Sizes are drawing choices; the content agent replaces this file with the real bones.
 */
export const parts: PartBuilder = () => {
  const at = (s: number, x: number, y: number, z: number): V3 => [s * x, y - 0.2, z];
  return [
    { id: 'clavicles', geometry: mergeParts(bothSides((s) => [rod([at(s, 0.006, 0.27, 0.05), at(s, 0.05, 0.276, 0.046), at(s, 0.098, 0.268, 0.02)], 0.0036)])) },
    { id: 'scapulae', geometry: mergeParts(bothSides((s) => [blob(at(s, 0.082, 0.236, -0.05), [0.024, 0.032, 0.0022])])) },
    {
      id: 'humeri',
      geometry: mergeParts(
        bothSides((s) => [rod([at(s, 0.1, 0.248, 0.004), at(s, 0.138, 0.208, 0.008), at(s, 0.162, 0.158, 0.01), at(s, 0.168, 0.118, 0.01)], 0.0056)]),
      ),
    },
  ];
};
