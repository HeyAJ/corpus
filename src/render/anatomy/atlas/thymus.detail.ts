import type { FlowSpec, OrganDetailSpec } from '../detail/types';
import { thymusPaths } from './thymus.parts';

/**
 * STREAMS AND GLASS FOR THE THYMUS. Arterial blood enters at the lower outer edge of each
 * lobe and venous blood leaves at the top; both run at a rate read from the activity of the
 * vessels (cardiac-output signals). Glow on the lobes, cortex and medulla follows the
 * engine's immune signal through the atlas drives. The capsule, lobes, cortex and vessels
 * are glass; medulla, corpuscles and septa solid. The adult gland is largely involuted;
 * nothing here models that.
 */

const SIDES = [
  ['r', 1],
  ['l', -1],
] as const;
const GLASS = ['right_lobe', 'left_lobe', 'capsule', 'cortex', 'vessels'];

export const detail: OrganDetailSpec = {
  flows: () => {
    const out: FlowSpec[] = [];
    for (const [k, s] of SIDES) {
      const p = thymusPaths(s);
      out.push({ id: `artery_${k}`, path: p.artery, count: 24, size: 0.0008, color: 0xc8323a, speed: 0.01, spread: 0.0002 });
      out.push({ id: `vein_${k}`, path: p.vein, count: 20, size: 0.0008, color: 0x6a4a7a, speed: 0.01, spread: 0.0002 });
    }
    return out;
  },
  animate: (ctx) => {
    for (const id of GLASS) ctx.part(id)?.setOpacity(0.2 + 0.25 * ctx.activity(id));
    const rate = 0.4 + 2 * ctx.activity('vessels');
    for (const [k] of SIDES) {
      ctx.flow(`artery_${k}`)?.setRate(rate);
      ctx.flow(`vein_${k}`)?.setRate(rate);
    }
  },
};
