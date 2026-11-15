import type { FlowSpec, OrganDetailSpec } from '../detail/types';
import { breastPaths } from './breasts.parts';

/**
 * STREAMS AND GLASS FOR THE BREAST.
 *
 * Lymph runs along three collecting vessels on each side towards the axillary nodes.
 * Its rate follows the activity of the lymphatics (exertion and inflammation signals);
 * there is no lymph-flow output in the snapshot, so this is a display scale.
 *
 * Milk movement in the ducts: the snapshot has no lactation or milk-flow output, but it has
 * the oxytocin signal that drives the ducts' activity. The duct stream is therefore drawn
 * only when that activity rises above its resting level (zero particles at rest), as a
 * statement of the let-down reflex's direction, not of any volume. Adipose tissue, ducts,
 * lymph vessels and the fascia are glass; lobes, nipple, areola, ligaments and nodes solid.
 */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const GLASS = ['adipose_tissue', 'lactiferous_ducts', 'lymphatics', 'pectoral_fascia'];
const OPACITY: Record<string, number> = { adipose_tissue: 0.2, pectoral_fascia: 0.25 };
const SIDES = [
  ['r', 1],
  ['l', -1],
] as const;

export const detail: OrganDetailSpec = {
  flows: () => {
    const out: FlowSpec[] = [];
    for (const [k, s] of SIDES) {
      const p = breastPaths(s);
      p.lymph.forEach((path, i) => out.push({ id: `lymph_${k}${i}`, path, count: 30, size: 0.0009, color: 0xe8e0a0, speed: 0.008, spread: 0.0002 }));
      // Duct streams run towards the nipple; every second duct carries one to keep the count low.
      p.ducts.forEach((path, i) => {
        if (i % 2 === 0) out.push({ id: `milk_${k}${i}`, path, count: 14, size: 0.0007, color: 0xf6f0e0, speed: 0.01, spread: 0.0002 });
      });
    }
    return out;
  },
  animate: (ctx) => {
    for (const id of GLASS) ctx.part(id)?.setOpacity(OPACITY[id] ?? 0.2 + 0.25 * ctx.activity(id));
    const lymph = 0.6 + 2 * ctx.activity('lymphatics');
    // Resting duct activity is 0.15; only the excess above it is drawn as moving milk.
    const letDown = clamp((ctx.activity('lactiferous_ducts') - 0.15) / 0.6, 0, 1);
    for (const [k] of SIDES) {
      for (let i = 0; i < 3; i++) ctx.flow(`lymph_${k}${i}`)?.setRate(lymph);
      for (let i = 0; i < 12; i += 2) {
        const f = ctx.flow(`milk_${k}${i}`);
        f?.setDensity(letDown);
        f?.setRate(0.5 + letDown);
      }
    }
  },
};
