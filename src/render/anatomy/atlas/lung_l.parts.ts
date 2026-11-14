import type { PartBuilder } from '../parts';
import { buildLungParts } from './lungShared';

/**
 * Interior parts of the left lung: two lobes (the upper one carries the lingula and the
 * cardiac notch), the airway tree, the pulmonary arteries and veins, the alveolar clusters
 * and the pleura. All of it is generated in lungShared.ts, which both lungs use; the left
 * lung differs only in having one fissure and so two lobes.
 */
export const parts: PartBuilder = () => buildLungParts(-1);
