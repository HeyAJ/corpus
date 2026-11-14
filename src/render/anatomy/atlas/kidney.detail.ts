import type { DetailContext, FlowSpec, OrganDetailSpec } from '../detail/types';
import { kidneyRoutes } from './kidney.parts';

/**
 * THE KIDNEY'S INTERIOR IN MOTION.
 *
 * Three streams, each tied to the snapshot field that really measures it:
 *
 *   - BLOOD runs in along the renal artery and its branches and out along the vein, at a
 *     rate proportional to `renal.renalBloodFlow_mL_per_min`, scaled by 1100 mL/min, the
 *     round figure for the two kidneys' flow at rest that the brief names as the drawing's
 *     reference (the stream runs at speed 1 when the engine reports that). The artery's
 *     particles are oxygenated red, the vein's are a little darker: kidney venous blood is
 *     still well oxygenated, so it is not drawn the full deoxygenated purple.
 *   - FILTRATE, a pale straw colour, runs from Bowman's capsule along the enlarged nephron
 *     to the papilla, at a rate proportional to `renal.gfr_mL_per_min / 125` (the same
 *     drawing reference). When the filtration rate collapses, for instance when blood
 *     pressure falls below the range the kidney can autoregulate, the rate AND the number
 *     of particles fall with it and the stream thins to nothing: the picture of anuria.
 *   - URINE leaves the tip of every pyramid, passes through the calyx cup, the major calyx
 *     and the pelvis and heads for the ureter, at a rate and density proportional to
 *     `renal.urineOutput_mL_per_min` (about 1 mL/min at rest, capped).
 *
 * The routes come from kidney.parts.ts, from the very control points the tubes are built
 * on, so particles stay inside the vessel or tubule they belong to on both sides.
 *
 * GLASS. Every part that encloses another (capsule, cortex, pyramids, columns) or carries a
 * stream (pelvis and calyces, artery, vein, nephron) is drawn as glass each frame; the
 * glomeruli stay solid, as the things a viewer should be able to tap.
 *
 * The pelvis swells slightly with urine flow, a gentle stand-in for the peristaltic
 * contraction that moves urine on; it holds still under `reducedMotion`.
 *
 * None of the reference scalings (1100, 125, 1 mL/min) is a physiological constant of the
 * engine; they only decide how fast the drawing runs when the engine is at its resting
 * values, and the picture is clamped so an extreme value cannot make the particles blur.
 */

const BLOOD_REF = 1100;
const GFR_REF = 125;
const OXY = 0xc8323a;
const VENOUS = 0x8e3f5e;
const FILTRATE = 0xe8d9a0;
const URINE = 0xe3c04a;

const GLASS: Record<string, number> = {
  renal_capsule: 0.22,
  renal_cortex: 0.26,
  renal_medulla: 0.34,
  renal_columns: 0.3,
  renal_pelvis: 0.42,
  renal_artery: 0.5,
  renal_vein: 0.5,
  nephron: 0.55,
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export const detail: OrganDetailSpec = {
  flows: (organId) => {
    const r = kidneyRoutes(organId);
    const out: FlowSpec[] = [];
    r.bloodIn.forEach((path, i) => out.push({ id: `blood_in_${i}`, path, count: 40, size: 0.0014, color: OXY, speed: 0.03, spread: 0.0006 }));
    r.bloodOut.forEach((path, i) => out.push({ id: `blood_out_${i}`, path, count: 40, size: 0.0014, color: VENOUS, speed: 0.03, spread: 0.0006 }));
    out.push({ id: 'filtrate', path: r.filtrate, count: 110, size: 0.0011, color: FILTRATE, speed: 0.02, spread: 0.0001 });
    r.urine.forEach((path, i) => out.push({ id: `urine_${i}`, path, count: 18, size: 0.0014, color: URINE, speed: 0.014, spread: 0.0005 }));
    return out;
  },

  animate: (ctx: DetailContext) => {
    for (const id of Object.keys(GLASS)) ctx.part(id)?.setOpacity(GLASS[id] + 0.25 * ctx.activity(id));

    const blood = clamp(ctx.lerp((s) => s.renal.renalBloodFlow_mL_per_min) / BLOOD_REF, 0, 2.5);
    for (let i = 0; i < 3; i++) {
      for (const dir of ['in', 'out']) {
        const f = ctx.flow(`blood_${dir}_${i}`);
        f?.setRate(blood);
        f?.setDensity(Math.min(1, blood));
        f?.setVisible(blood > 0.02);
      }
    }

    const gfr = clamp(ctx.lerp((s) => s.renal.gfr_mL_per_min) / GFR_REF, 0, 2);
    const filtrate = ctx.flow('filtrate');
    filtrate?.setRate(gfr);
    filtrate?.setDensity(Math.min(1, gfr));
    filtrate?.setVisible(gfr > 0.03);

    const urine = clamp(ctx.lerp((s) => s.renal.urineOutput_mL_per_min), 0, 2);
    for (let i = 0; i < 9; i++) {
      const f = ctx.flow(`urine_${i}`);
      f?.setRate(urine);
      f?.setDensity(Math.min(1, urine));
      f?.setVisible(urine > 0.02);
    }

    if (!ctx.reducedMotion) {
      ctx.part('renal_pelvis')?.setScale(1 + 0.03 * Math.min(1, urine) * Math.sin(ctx.time * 2.2));
    } else {
      ctx.part('renal_pelvis')?.setScale(1);
    }
  },
};
