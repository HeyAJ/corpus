import type { PartBuilder } from '../parts';
import { mergeParts } from '../sdf';
import { blob, bothSides } from './stub_shared';

/**
 * STUB INTERIOR OF THE NASAL CAVITY AND SINUSES, in the organ's own frame (origin organs.json
 * [0, 0.352, 0.05]; the shell is two chambers 0.0085 wide either side of the midline plus a
 * maxillary sinus a side, shells/nasal_cavity.ts). Sizes are drawing choices; the content
 * agent replaces this file with the real septum, turbinates, olfactory roof and sinuses.
 */
export const parts: PartBuilder = () => [
  { id: 'nasal_septum', geometry: blob([0, 0, 0], [0.0012, 0.019, 0.028]) },
  { id: 'turbinates', geometry: mergeParts(bothSides((s) => [blob([s * 0.0125, -0.001, 0.002], [0.003, 0.011, 0.02])])) },
  { id: 'olfactory_region', geometry: blob([0, 0.018, 0.004], [0.0065, 0.0018, 0.012]) },
  { id: 'maxillary_sinuses', geometry: mergeParts(bothSides((s) => [blob([s * 0.026, -0.012, -0.002], [0.0085, 0.0085, 0.011])])) },
  { id: 'frontal_sinuses', geometry: mergeParts(bothSides((s) => [blob([s * 0.012, 0.016, 0.012], [0.0045, 0.0028, 0.006])])) },
];
