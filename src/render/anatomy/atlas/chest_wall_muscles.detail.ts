import type { OrganDetailSpec } from '../detail/types';

/**
 * No streams and no motion: this is a first-pass stub of the muscles layer, and the engine has no
 * per-muscle state (only whole-body muscle tone, exertion, shivering and a seizure, which the atlas
 * file turns into each part's activity glow through the default detail). A content agent who draws
 * the chest wall muscles properly says here what is different about them.
 */
export const detail: OrganDetailSpec = {};
