import type { FlowSpec, OrganDetailSpec } from '../detail/types';
import type { V3 } from '../sdf';
import { ARTERIES, CENTRAL_VEIN, FIBRES } from './adrenal.parts';

/**
 * STREAMS AND GLASS FOR THE ADRENAL.
 *
 * Three hormone streams leave along the central vein in three colours, each at its own
 * rate. The cortex and the medulla are SEPARATE gland-output signals in the snapshot
 * (`anatomy.glands.adrenal_cortex` and `adrenal_medulla`, 1 = basal), so a fright floods
 * the catecholamine stream at once while the cortisol stream follows the stress axis.
 * The snapshot carries no separate aldosterone output, so the aldosterone stream is paced
 * by the activity of the glomerulosa, which is driven by the engine's aldosterone and
 * renin signals. Rates are display scales, not secretion rates.
 *
 * Streams start inside the layer that makes the hormone (aldosterone shallow, cortisol
 * deeper, catecholamines in the medulla) and converge on the vein. The nerve-impulse
 * stream reads `anatomy.nerves.sympathetic`. Everything that encloses something is glass.
 */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Vein path with its start pulled to depth `z` and slightly sideways, so streams read apart. */
function feeder(vein: V3[], z: number, dy: number): V3[] {
  const [a, ...rest] = vein;
  return [[a[0], a[1] + dy, z], ...rest.map((p): V3 => [p[0], p[1] + dy * 0.5, p[2]])];
}

const GLASS = ['capsule', 'zona_glomerulosa', 'zona_fasciculata', 'zona_reticularis', 'central_vein', 'suprarenal_arteries'];

/**
 * THE FINER STRUCTURES. The nests that hold the chromaffin cells and the three artery groups
 * (children of the medulla and of the suprarenal arteries) enclose or carry something, so
 * they are glass; the cell cords and the small cell beads are content and stay solid. The
 * opacities are drawing choices, kept low enough that a bead inside a nest shows through.
 */
const CHILD_GLASS: readonly [string, number][] = [
  ['chromaffin_cells', 0.22],
  ['superior_suprarenal_arteries', 0.5],
  ['middle_suprarenal_artery', 0.5],
  ['inferior_suprarenal_artery', 0.5],
];

export const detail: OrganDetailSpec = {
  flows: (organId) => {
    const k: 'l' | 'r' = organId === 'adrenal_l' ? 'l' : 'r';
    const vein = CENTRAL_VEIN[k];
    const out: FlowSpec[] = [
      { id: 'aldosterone', path: feeder(vein, 0.0045, 0.0003), count: 40, size: 0.0009, color: 0x5fc8e8, speed: 0.01, spread: 0.0002 },
      { id: 'cortisol', path: feeder(vein, -0.0036, -0.0003), count: 40, size: 0.0009, color: 0xe8d44a, speed: 0.01, spread: 0.0002 },
      { id: 'catecholamines', path: feeder(vein, 0, 0), count: 40, size: 0.0009, color: 0xe85aa0, speed: 0.01, spread: 0.0002 },
    ];
    ARTERIES[k].forEach((p, i) => out.push({ id: `inflow_${i}`, path: p, count: 24, size: 0.0008, color: 0xc8323a, speed: 0.008, spread: 0.0001 }));
    FIBRES[k].forEach((p, i) => out.push({ id: `impulse_${i}`, path: p, count: 16, size: 0.0007, color: 0xf4e9a0, speed: 0.012 }));
    return out;
  },
  animate: (ctx) => {
    for (const id of GLASS) ctx.part(id)?.setOpacity(0.2 + 0.25 * ctx.activity(id));
    for (const [id, o] of CHILD_GLASS) ctx.part(id)?.setOpacity(o);

    const cortex = ctx.lerp((s) => s.anatomy?.glands?.adrenal_cortex ?? 1);
    const medulla = ctx.lerp((s) => s.anatomy?.glands?.adrenal_medulla ?? 1);
    const sym = ctx.lerp((s) => s.anatomy?.nerves?.sympathetic ?? 0);
    const glom = ctx.activity('zona_glomerulosa');

    const cort = ctx.flow('cortisol');
    cort?.setRate(clamp(cortex, 0.25, 3));
    cort?.setDensity(clamp(0.3 + 0.35 * cortex, 0.3, 1));
    const cat = ctx.flow('catecholamines');
    cat?.setRate(clamp(medulla, 0.25, 3));
    cat?.setDensity(clamp(0.3 + 0.35 * medulla, 0.3, 1));
    const ald = ctx.flow('aldosterone');
    ald?.setRate(clamp(0.4 + 2.4 * glom, 0.3, 3));
    ald?.setDensity(clamp(0.3 + 2 * glom, 0.3, 1));

    const inflow = 0.4 + 2 * ctx.activity('suprarenal_arteries');
    for (let i = 0; i < 3; i++) {
      ctx.flow(`inflow_${i}`)?.setRate(inflow);
      ctx.flow(`impulse_${i}`)?.setRate(1 + 3 * sym);
    }
  },
};
