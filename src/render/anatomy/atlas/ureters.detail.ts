import type { DetailContext, FlowSpec, OrganDetailSpec } from '../detail/types';
import { ureterRoute } from './ureters.parts';

/**
 * URINE MOVING DOWN THE URETERS IN SPURTS.
 *
 * A ureter does not carry a steady trickle: a wave of contraction pushes one bolus after
 * another toward the bladder (GH14). Each ureter has one stream of particles along its
 * centreline, and a sliding WINDOW (`setWindow`) lets only the particles inside a short
 * moving stretch show, so a bolus appears at the kidney end, travels down at the speed of
 * the stream, and is gone at the bladder end. Between boluses the stream is hidden.
 *
 * SPACING. The gap between boluses shortens as `renal.urineOutput_mL_per_min` rises. The
 * period runs from 16 s with no urine to 7 s at two mL/min and above. Those figures, the
 * 0.12 bolus length and the 0.04 m/s travel speed are DRAWING CHOICES (assumed, for pacing
 * legible on screen), not physiological constants; the period cannot fall below the time a
 * bolus takes to travel, because one window shows one bolus at a time. The right ureter's
 * cycle starts half a period after the left, since the two waves are independent.
 *
 * VALVE. The vesicoureteric junction is drawn a little narrower (scale 0.75) while it is
 * closed and opens to full size as a bolus reaches it. Under `reducedMotion` it stays full
 * size and the boluses still run, since they are the content, not decoration.
 *
 * GLASS. The lumens and the muscular coat enclose the stream, so they are drawn as glass
 * every frame; the narrow-point collars and the junction stay solid.
 */

const SPEED = 0.04;
const BOLUS = 0.12;
const SIDES = ['left', 'right'] as const;

let length = 0.2;

export const detail: OrganDetailSpec = {
  flows: () => {
    const out: FlowSpec[] = [];
    for (const side of SIDES) {
      const path = ureterRoute(side);
      let len = 0;
      for (let i = 1; i < path.length; i++) len += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2]);
      length = len;
      out.push({ id: `bolus_${side}`, path, count: 160, size: 0.0015, color: 0xe3c04a, speed: SPEED, spread: 0.0004 });
    }
    return out;
  },

  animate: (ctx: DetailContext) => {
    ctx.part('left_ureter')?.setOpacity(0.4 + 0.2 * ctx.activity('left_ureter'));
    ctx.part('right_ureter')?.setOpacity(0.4 + 0.2 * ctx.activity('right_ureter'));
    ctx.part('peristaltic_wall')?.setOpacity(0.3 + 0.2 * ctx.activity('peristaltic_wall'));

    const urine = Math.min(2, Math.max(0, ctx.lerp((s) => s.renal.urineOutput_mL_per_min)));
    const travel = length / SPEED;
    const period = Math.max(travel * (1 + BOLUS) + 0.5, 16 - 4.5 * urine);
    let open = 0;
    for (let i = 0; i < 2; i++) {
      const f = ctx.flow(`bolus_${SIDES[i]}`);
      if (!f) continue;
      const tt = (ctx.time + i * period * 0.5) % period;
      const front = tt / travel;
      const on = urine > 0.02 && front < 1 + BOLUS;
      f.setVisible(on);
      f.setRate(1);
      f.setDensity(Math.min(1, urine));
      if (on) f.setWindow(Math.max(0, front - BOLUS), Math.min(1, front));
      if (on && front > 0.9) open = Math.max(open, 1);
    }
    ctx.part('vesicoureteric_junctions')?.setScale(ctx.reducedMotion ? 1 : 0.75 + 0.25 * open);
  },
};
