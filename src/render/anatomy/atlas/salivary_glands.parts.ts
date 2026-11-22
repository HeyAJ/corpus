import type { PartBuilder } from '../parts';
import { mergeParts } from '../sdf';
import { blob, bothSides } from './stub_shared';

/**
 * STUB INTERIOR OF THE SALIVARY GLANDS: one scaled sphere per gland, both sides merged into
 * one part per pair. Frame and placement are those of shells/salivary_glands.ts (origin
 * organs.json [0, 0.33, 0.02]); each sphere is a little smaller than the shell's ellipsoid so
 * it lies inside. Sizes are drawing choices; the content agent replaces this file with lobules
 * and ducts.
 */
export const parts: PartBuilder = () => [
  { id: 'parotid_glands', geometry: mergeParts(bothSides((s) => [blob([s * 0.058, 0.022, -0.015], [0.0075, 0.017, 0.0115])])) },
  { id: 'submandibular_glands', geometry: mergeParts(bothSides((s) => [blob([s * 0.034, -0.03, 0.01], [0.01, 0.0065, 0.0135])])) },
  { id: 'sublingual_glands', geometry: mergeParts(bothSides((s) => [blob([s * 0.014, -0.012, 0.038], [0.0045, 0.0038, 0.0115])])) },
];
