import type { DetailContext, FlowSpec, OrganDetailSpec } from '../detail/types';
import { orificeJets } from './bladder.parts';

/**
 * THE BLADDER'S INTERIOR IN MOTION.
 *
 * Reads `renal.bladderFillFraction`, `renal.bladderVolume_mL` (not used directly: the
 * fraction is the same quantity on the capacity scale) and `renal.urineOutput_mL_per_min`.
 *
 *   - STRETCH. The detrusor is drawn at 90 % of its authored size when the bladder is empty
 *     and at full size when it is full, the wall drawn thinner and wider as it stretches.
 *     It is never scaled above 1, so it cannot leave the shell. Under `reducedMotion` it
 *     stays at full size.
 *   - RUGAE. The folded lining fades as the bladder fills (stretching flattens the folds).
 *   - JETS. A small jet of urine leaves each ureteric orifice at intervals, a stream of a
 *     few particles shown only for the first second or so of each cycle. The cycle shortens
 *     as urine output rises, from 16 s with no urine to 7 s at 2 mL/min or more. Those
 *     numbers and the jet duration are DRAWING CHOICES for legibility, not physiology, and
 *     the right orifice runs half a cycle after the left. The urine itself is not drawn:
 *     the renderer already shows the fluid level.
 *   - VOIDING. The engine has no separate voiding flag in the snapshot, so the detrusor's
 *     glow comes from its anatomy-activity drive (parasympathetic outflow), the default
 *     glow already applied before this runs.
 *
 * GLASS. The wall and the lining enclose the lumen, so they are drawn as glass each frame;
 * the trigone, orifices, sphincter and urethra stay solid, as the things a viewer taps.
 */

const JET_SECONDS = 1.1;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export const detail: OrganDetailSpec = {
  flows: () => {
    const jets = orificeJets();
    const make = (id: string, path: FlowSpec['path']): FlowSpec => ({ id, path, count: 24, size: 0.0014, color: 0xe3c04a, speed: 0.012, spread: 0.0004 });
    return [make('jet_left', jets.left), make('jet_right', jets.right)];
  },

  animate: (ctx: DetailContext) => {
    const fill = clamp(ctx.lerp((s) => s.renal.bladderFillFraction), 0, 1);
    ctx.part('detrusor')?.setOpacity(0.2 + 0.2 * fill + 0.2 * ctx.activity('detrusor'));
    ctx.part('detrusor')?.setScale(ctx.reducedMotion ? 1 : 0.9 + 0.1 * fill);
    ctx.part('mucosa')?.setOpacity(0.12 + 0.4 * (1 - fill));
    // Finer structures: the urothelium is the skin of the same folds, so it fades with them;
    // the regions of the wall are faint glass; the cells and the muscle strands stay solid.
    ctx.part('urothelium')?.setOpacity(0.1 + 0.3 * (1 - fill));
    ctx.part('bladder_apex')?.setOpacity(0.3);
    ctx.part('bladder_fundus')?.setOpacity(0.18);
    ctx.part('bladder_neck')?.setOpacity(0.28);

    const urine = clamp(ctx.lerp((s) => s.renal.urineOutput_mL_per_min), 0, 2);
    const period = 16 - 4.5 * urine;
    for (let i = 0; i < 2; i++) {
      const f = ctx.flow(i === 0 ? 'jet_left' : 'jet_right');
      if (!f) continue;
      const tt = (ctx.time + i * period * 0.5) % period;
      f.setVisible(urine > 0.02 && tt < JET_SECONDS);
      f.setRate(1);
      f.setDensity(1);
    }
  },
};
