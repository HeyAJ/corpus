import type { PartBuilder } from '../parts';
import { buildLungParts } from './lungShared';

/**
 * Interior parts of the right lung: three lobes (the horizontal fissure is what makes the
 * middle one), the airway tree, the pulmonary arteries and veins, the alveolar clusters and
 * the pleura. All of it is generated in lungShared.ts, which both lungs use.
 */
export const parts: PartBuilder = () => buildLungParts(1);
