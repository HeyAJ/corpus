import type { FlowSpec, OrganDetailSpec } from '../detail/types';
import { thyroidPaths } from './thyroid.parts';

/**
 * STREAMS AND GLASS FOR THE THYROID. Arterial blood runs in along the superior and
 * inferior arteries; along the three veins on each side runs venous blood and, in amber,
 * thyroid hormone, whose rate follows the snapshot's `anatomy.glands.thyroid` output
 * (1 = basal). Both rates are display scales. Capsule, lobes, isthmus and vessels are
 * glass; follicles, C cells and parathyroids stay solid.
 */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const GLASS = ['right_lobe', 'left_lobe', 'isthmus', 'capsule', 'thyroid_arteries', 'thyroid_veins', 'pyramidal_lobe'];
/**
 * THE FINER STRUCTURES. The basement membrane and the capillary loops enclose or carry
 * something, and the child parathyroid glands must let the cell beads inside them show, so
 * all four are glass; colloid, follicular cells, chief cells and oxyphil cells are content
 * and stay solid. The opacities are drawing choices.
 */
const CHILD_GLASS: readonly [string, number][] = [
  ['follicle_basement_membrane', 0.14],
  ['follicle_capillaries', 0.55],
  ['superior_parathyroid_glands', 0.22],
  ['inferior_parathyroid_glands', 0.22],
];
const SIDES = [
  ['r', 1],
  ['l', -1],
] as const;

export const detail: OrganDetailSpec = {
  flows: () => {
    const out: FlowSpec[] = [];
    for (const [k, s] of SIDES) {
      const p = thyroidPaths(s);
      const art = (id: string, path: typeof p.superior): FlowSpec => ({ id, path, count: 24, size: 0.0008, color: 0xc8323a, speed: 0.012, spread: 0.0002 });
      out.push(art(`sup_${k}`, p.superior), art(`inf_${k}`, p.inferior));
      const veins = { vsup: p.vSuperior, vmid: p.vMiddle, vinf: p.vInferior };
      for (const [name, path] of Object.entries(veins)) {
        out.push({ id: `${name}_blood_${k}`, path, count: 20, size: 0.0008, color: 0x6a4a7a, speed: 0.012, spread: 0.0002 });
        out.push({ id: `${name}_hormone_${k}`, path, count: 20, size: 0.0007, color: 0xf0b040, speed: 0.012, spread: 0.0003 });
      }
    }
    return out;
  },
  animate: (ctx) => {
    for (const id of GLASS) ctx.part(id)?.setOpacity(0.2 + 0.25 * ctx.activity(id));
    for (const [id, o] of CHILD_GLASS) ctx.part(id)?.setOpacity(o);
    const g = ctx.lerp((s) => s.anatomy?.glands?.thyroid ?? 1);
    const inflow = 0.4 + 2 * ctx.activity('thyroid_arteries');
    for (const [k] of SIDES) {
      ctx.flow(`sup_${k}`)?.setRate(inflow);
      ctx.flow(`inf_${k}`)?.setRate(inflow);
      for (const name of ['vsup', 'vmid', 'vinf']) {
        ctx.flow(`${name}_blood_${k}`)?.setRate(inflow);
        const h = ctx.flow(`${name}_hormone_${k}`);
        h?.setRate(clamp(g, 0.25, 3));
        h?.setDensity(clamp(0.3 + 0.35 * g, 0.3, 1));
      }
    }
  },
};
