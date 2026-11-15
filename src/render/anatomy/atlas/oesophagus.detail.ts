import type { DetailContext, FlowSpec, OrganDetailSpec } from '../detail/types';
import { warpPoints } from '../layout';
import { oesophagusLine, pathFractionOf } from './oesophagus.parts';

/**
 * THE OESOPHAGUS IN MOTION.
 *
 * Reads the part activities (driven in the data file by the `swallowing` and `vomiting`
 * signals), the digesta the engine holds in its `oesophagus` segment, and `mind.vomiting`.
 *
 *   - GLASS. The three wall segments, the mucosa, the muscular coat and the lumen enclose
 *     or carry the bolus, so they are drawn as glass every frame (the brief's rule). The
 *     two sphincters and the vagal plexus are the things a user should be able to tap and
 *     stay solid.
 *   - THE BOLUS. A stream of particles in the lumen is shown only where the engine says
 *     something is: `gi.digesta` entries whose segment is the oesophagus carry a position
 *     `s` from 0 (top) to 1 (stomach), and the stream is gated to a short window around the
 *     first of them, so the bolus is seen travelling down at the engine's own pace. The
 *     particle motion inside the window is a display speed. With nothing in the oesophagus
 *     the stream is hidden.
 *   - VOMITING. While `mind.vomiting` is true the whole lumen is shown and the stream runs
 *     backwards, towards the mouth, faster than a swallow.
 *
 * Under `reducedMotion` the stream keeps its colour and position but runs slowly.
 */

const GLASS: readonly [string, number, number][] = [
  ['cervical_segment', 0.22, 0.2],
  ['thoracic_segment', 0.22, 0.2],
  ['abdominal_segment', 0.22, 0.2],
  ['mucosa', 0.2, 0.2],
  ['muscularis', 0.2, 0.2],
  ['lumen', 0.4, 0.15],
];

const BOLUS_COLOUR = 0xe8c9a0;
/** Half the width of the window round the bolus, as a fraction of the whole path. */
const HALF_WINDOW = 0.07;

export const detail: OrganDetailSpec = {
  flows: () => {
    const specs: FlowSpec[] = [
      { id: 'bolus', path: warpPoints(oesophagusLine(0, 1, 24)), count: 90, size: 0.0022, color: BOLUS_COLOUR, speed: 0.03, spread: 0.0012 },
    ];
    return specs;
  },

  animate: (ctx: DetailContext) => {
    for (const [id, base, extra] of GLASS) ctx.part(id)?.setOpacity(base + extra * ctx.activity(id));
    const flow = ctx.flow('bolus');
    if (!flow) return;
    const still = ctx.reducedMotion;
    const s = ctx.snapshot;

    if (s.mind.vomiting) {
      flow.setVisible(true);
      flow.setWindow(0, 1);
      flow.setRate(still ? -0.4 : -2.5);
      return;
    }

    // The first digesta in the oesophagus, found without allocating.
    let pos = -1;
    const list = s.gi.digesta;
    for (let i = 0; i < list.length; i++) {
      if (list[i].segment === 'oesophagus') {
        pos = list[i].s;
        break;
      }
    }
    if (pos < 0) {
      flow.setVisible(false);
      return;
    }
    const centre = pathFractionOf(ctx.lerp((snap) => {
      const d = snap.gi.digesta;
      for (let i = 0; i < d.length; i++) if (d[i].segment === 'oesophagus') return d[i].s;
      return pos;
    }));
    flow.setVisible(true);
    flow.setWindow(Math.max(0, centre - HALF_WINDOW), Math.min(1, centre + HALF_WINDOW));
    flow.setRate(still ? 0.3 : 1.2);
  },
};
