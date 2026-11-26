import type { SimSnapshot } from '../../../bridge/types';
import type { FlowSpec, OrganDetailSpec } from '../detail/types';
import type { V3 } from '../sdf';
import { NERVE_LIFT, phrenicRoute, sheetPath } from './diaphragm.parts';

/**
 * STREAMS AND ANIMATION OF THE DIAPHRAGM.
 *
 * An impulse runs down each phrenic nerve, trunk to branch, at the START of each inspiration:
 * three streams per nerve (one per branch) that share the trunk, shown only in the first
 * fifth of the breath and hidden in apnoea. The streams are always running; it is their
 * density that is gated, so the impulse appears with the breath rather than drifting about
 * between breaths. The costal muscle glows a little more at the height of each inspiration
 * on top of its respiratory-drive activity.
 *
 * The sheet is not DEFORMED by this file: the shell is a single surface this view does not
 * reshape, and a part that left it would stand outside the organ. The whole organ, shell and
 * parts together, is instead carried down and up with the breath by the viewer
 * (`Viewer.applySnapshotToScene` offsets it by a display amplitude on `resp.inflation`), so
 * nothing here needs to move it.
 */

const OVERLAY: [string, number][] = [['sternal_part', 0.5], ['lumbar_part', 0.5], ['right_dome', 0.16], ['left_dome', 0.16]];
const BRANCHES = ['anterior', 'lateral', 'posterior'];

const pickPhase = (s: SimSnapshot): number => s.resp.cyclePhase;
const pickInflation = (s: SimSnapshot): number => s.resp.inflation;

export const detail: OrganDetailSpec = {
  flows: () => {
    const out: FlowSpec[] = [];
    for (const side of [1, -1]) {
      const r = phrenicRoute(side);
      r.branches.forEach((b, k) => {
        const path: V3[] = sheetPath([...r.trunk, ...b.slice(1)], NERVE_LIFT);
        out.push({
          id: `impulse_${side > 0 ? 'r' : 'l'}_${BRANCHES[k]}`,
          path, count: 5, size: 0.0018, color: 0xf6e08a, speed: 0.22,
        });
      });
    }
    return out;
  },
  animate: (ctx) => {
    const phase = ctx.lerp(pickPhase);
    // Inspiration begins at phase 0; the impulse is the first fifth of it.
    const on = !ctx.snapshot.resp.apnoeic && !ctx.reducedMotion && phase < 0.2 ? 1 : 0;
    for (const side of ['r', 'l']) {
      for (const b of BRANCHES) {
        const f = ctx.flow(`impulse_${side}_${b}`);
        if (!f) continue;
        f.setRate(1);
        f.setDensity(on);
      }
    }
    const lift = 0.3 * Math.max(0, Math.min(1, ctx.lerp(pickInflation)));
    // The overlay parts are panes so the muscle and tendon under them still show (drawing choice).
    for (const [id, o] of OVERLAY) ctx.part(id)?.setOpacity(o);
    for (const id of ['costal_muscle', 'right_crus', 'left_crus', 'sternal_part', 'lumbar_part', 'right_dome', 'left_dome']) {
      ctx.part(id)?.setGlow(Math.min(1, ctx.activity(id) + lift));
    }
  },
};
