import type { OrganDetailSpec } from '../detail/types';
import { makeLungDetail } from './lungShared';

/**
 * Streams and animation of the left lung. Air runs along the bronchial tree, in from the
 * hilum while the lung fills and out while it empties; deoxygenated blood runs out along
 * the pulmonary arteries and oxygenated blood back along the veins. Everything is shared
 * with the other lung in lungShared.ts.
 */
export const detail: OrganDetailSpec = makeLungDetail(-1);
