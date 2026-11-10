import type { SimState } from '../core/state';
import type { AnatomySnapshot } from '../../bridge/types';

/**
 * ANATOMY ACTIVITY — CONTRACT STUB.
 *
 * The engine already calls `buildAnatomy` for every snapshot. The implementation
 * replaces this body: it evaluates every signal in src/data/anatomy-types.ts from the
 * state vector, applies the drives in src/data/anatomy/*.json, and returns the result.
 * Nothing it computes is ever written back to the state.
 */
export function buildAnatomy(_s: SimState): AnatomySnapshot {
  return {
    organs: {},
    parts: {},
    nerves: { sympathetic: 0, parasympathetic: 0, motor: 0, sensory: 0, pain: 0 },
    glands: {},
  };
}
