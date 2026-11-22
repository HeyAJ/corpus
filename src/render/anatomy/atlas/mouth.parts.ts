import type { PartBuilder } from '../parts';
import { blob, rod } from './stub_shared';

/**
 * STUB INTERIOR OF THE MOUTH: one simple primitive per named part, in the organ's own frame
 * (origin organs.json [0, 0.32, 0.042]; the shell is an oral cavity of radii 0.027 / 0.012 /
 * 0.027 and a flatter cap for the lips, see shells/mouth.ts). Everything is a little smaller
 * than the shell so it sits inside. Sizes are drawing choices; the content agent replaces this
 * file with lips, palate, tongue and teeth drawn properly.
 */
export const parts: PartBuilder = () => [
  { id: 'lips', geometry: blob([0, -0.001, 0.024], [0.015, 0.0045, 0.0045]) },
  { id: 'palate', geometry: blob([0, 0.0085, 0], [0.019, 0.002, 0.019]) },
  { id: 'tongue', geometry: blob([0, -0.004, 0.004], [0.013, 0.005, 0.018]) },
  {
    id: 'teeth',
    geometry: rod([[-0.019, -0.001, 0.003], [-0.015, -0.001, 0.017], [0, -0.001, 0.021], [0.015, -0.001, 0.017], [0.019, -0.001, 0.003]], 0.0016, 20, 5),
  },
];
