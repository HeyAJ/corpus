import type { PartBuilder } from '../parts';
import { mergeParts, type V3 } from '../sdf';
import { blob, bothSides, rod } from './stub_shared';

/**
 * STUB INTERIOR OF THE HIP AND THIGH BONES, in the organ's own frame (origin organs.json
 * [0, -0.2, 0]); the same shapes as shells/lower_limb_bones.ts, read off the iliac and femoral
 * vessels in vasculature.json, at about 80 % of the shell's size. The hip joint is a ball at
 * the top of each femur and the pubic symphysis a small bridge at the midline in front. Sizes
 * are drawing choices; the content agent replaces this file with the real bones and joints.
 */
export const parts: PartBuilder = () => {
  const at = (s: number, x: number, y: number, z: number): V3 => [s * x, y + 0.2, z];
  return [
    {
      id: 'hip_bones',
      geometry: mergeParts(bothSides((s) => [blob(at(s, 0.07, -0.085, -0.03), [0.032, 0.032, 0.011]), blob(at(s, 0.035, -0.14, 0.03), [0.019, 0.014, 0.008])])),
    },
    {
      id: 'femora',
      geometry: mergeParts(bothSides((s) => [rod([at(s, 0.07, -0.2, -0.012), at(s, 0.06, -0.3, -0.014), at(s, 0.058, -0.336, -0.012)], 0.009)])),
    },
    { id: 'hip_joints', geometry: mergeParts(bothSides((s) => [blob(at(s, 0.08, -0.135, -0.008), [0.012, 0.012, 0.012])])) },
    { id: 'pubic_symphysis', geometry: blob([0, -0.14 + 0.2, 0.034], [0.006, 0.01, 0.004]) },
  ];
};
