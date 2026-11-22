import type { OrganDetailSpec } from '../detail/types';

/**
 * No streams and no animation yet for the mouth: nothing in the engine is simulated here
 * (chewing, taste, speech and saliva are all absent), so the defaults (each part in its atlas
 * colour, glowing with its activity) are all there is to say. The content agent may add a
 * swallowing cue if it can ground one in the snapshot.
 */
export const detail: OrganDetailSpec = {};
