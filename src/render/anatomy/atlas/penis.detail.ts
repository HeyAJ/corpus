import * as THREE from 'three';
import type { DetailContext, FlowSpec, OrganDetailSpec, PartHandle } from '../detail/types';
import type { SimSnapshot } from '../../../bridge/types';
import { DEOXYGENATED, OXYGENATED, bloodColour } from '../detail/blood';
import { cavernosalArteryPath, dorsalArteryPath, dorsalVeinPath } from './penis.parts';

/**
 * THE PENIS'S INTERIOR IN MOTION.
 *
 * Everything follows `reproductive.sexual.vasocongestion`, 0 to 1, read through `ctx.lerp` so
 * it moves smoothly between snapshots. Nothing changes the shaft's size or pose: that is done
 * elsewhere on the shell. Here the filling shows only in colour, glow, opacity and streams.
 *
 *   - INFLOW. The two deep (cavernosal) arteries and the two dorsal arteries carry streams
 *     of arterial blood, coloured from `transport.arterialSat`. As vasocongestion rises the
 *     streams run faster (from half speed to two and a half times) and thicker (from 30 % of
 *     the particles to all of them).
 *   - OUTFLOW. The deep dorsal vein carries venous blood, coloured from `transport.venousSat`,
 *     from the glans back toward the root. Its stream slows and thins as vasocongestion
 *     rises, because the filled corpora press the draining veins against the tunica.
 *   - FILLING. The two corpora cavernosa move from their own pale colour toward the colour of
 *     arterial blood, glow more and become more opaque as they fill; the corpus spongiosum and
 *     the glans do the same, less strongly.
 *
 * All the speeds, densities and ranges above are DRAWING CHOICES for legibility, not
 * physiology: the model gives a single filling index and the picture follows it.
 *
 * GLASS. The tunica, the three bodies of erectile tissue, the glans, the urethra and the
 * vessels all enclose something or carry a stream, so each is drawn as glass every frame.
 * Reduced motion does not change anything here, because no shape moves.
 */

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const vasoOf = (s: SimSnapshot): number => s.reproductive.sexual.vasocongestion;
const arterialSat = (s: SimSnapshot): number => s.transport.arterialSat;
const venousSat = (s: SimSnapshot): number => s.transport.venousSat;

const fillColour = new THREE.Color();
const target = new THREE.Color();
const blood = new THREE.Color();

const ARTERIAL_FLOWS = ['cavernosal_r', 'cavernosal_l', 'dorsal_r', 'dorsal_l'];

/** Move a part from its own colour toward blood by `amount`, glow and thicken it with `v`. */
function fill(part: PartHandle | undefined, toward: THREE.Color, amount: number, glow: number, opacity: number): void {
  if (!part) return;
  fillColour.copy(part.baseColor).lerp(toward, amount);
  part.setColor(fillColour);
  part.setGlow(glow);
  part.setOpacity(opacity);
}

export const detail: OrganDetailSpec = {
  flows: () => {
    const out: FlowSpec[] = [];
    out.push({ id: 'cavernosal_r', path: cavernosalArteryPath(1), count: 40, size: 0.0009, color: OXYGENATED, speed: 0.03, spread: 0.0002 });
    out.push({ id: 'cavernosal_l', path: cavernosalArteryPath(-1), count: 40, size: 0.0009, color: OXYGENATED, speed: 0.03, spread: 0.0002 });
    out.push({ id: 'dorsal_r', path: dorsalArteryPath(1), count: 32, size: 0.0009, color: OXYGENATED, speed: 0.03, spread: 0.0002 });
    out.push({ id: 'dorsal_l', path: dorsalArteryPath(-1), count: 32, size: 0.0009, color: OXYGENATED, speed: 0.03, spread: 0.0002 });
    out.push({ id: 'dorsal_vein', path: dorsalVeinPath(), count: 40, size: 0.0012, color: DEOXYGENATED, speed: 0.03, spread: 0.0003 });
    return out;
  },

  animate: (ctx: DetailContext) => {
    const v = clamp01(ctx.lerp(vasoOf));
    const art = ctx.lerp(arterialSat);
    const ven = ctx.lerp(venousSat);

    // Inflow: faster and thicker as the tissue fills.
    bloodColour(blood, art);
    for (let i = 0; i < ARTERIAL_FLOWS.length; i++) {
      const f = ctx.flow(ARTERIAL_FLOWS[i]);
      if (!f) continue;
      f.setColor(blood);
      f.setRate(0.5 + 2 * v);
      f.setDensity(0.3 + 0.7 * v);
    }
    ctx.part('cavernosal_arteries')?.setColor(blood);
    ctx.part('dorsal_arteries')?.setColor(blood);
    ctx.part('cavernosal_arteries')?.setOpacity(0.5);
    ctx.part('dorsal_arteries')?.setOpacity(0.5);

    // Outflow: slower and thinner, the veins compressed against the tunica.
    const vein = ctx.flow('dorsal_vein');
    if (vein) {
      vein.setColor(bloodColour(target, ven));
      vein.setRate(0.25 + 0.75 * (1 - v));
      vein.setDensity(0.1 + 0.9 * (1 - v));
    }
    ctx.part('deep_dorsal_vein')?.setColor(target);
    ctx.part('deep_dorsal_vein')?.setOpacity(0.5);

    // The erectile bodies deepen and glow as they fill.
    fill(ctx.part('corpus_cavernosum_right'), blood, 0.7 * v, 0.15 + 0.85 * v, 0.22 + 0.3 * v);
    fill(ctx.part('corpus_cavernosum_left'), blood, 0.7 * v, 0.15 + 0.85 * v, 0.22 + 0.3 * v);
    fill(ctx.part('corpus_spongiosum'), blood, 0.45 * v, 0.1 + 0.6 * v, 0.25 + 0.2 * v);
    fill(ctx.part('glans_penis'), blood, 0.4 * v, 0.1 + 0.6 * v, 0.25 + 0.15 * v);

    ctx.part('tunica_albuginea')?.setOpacity(0.2 + 0.15 * v);
    // Finer structures: wraps are faint glass; the contents of the corpora stay solid and take
    // the erection's colour through their own vasocongestion drive.
    const WRAPS: Record<string, number> = { deep_fascia: 0.1, bulbospongiosus: 0.2, ischiocavernosus: 0.22, prepuce: 0.14 };
    for (const id of Object.keys(WRAPS)) ctx.part(id)?.setOpacity(WRAPS[id]);
    for (const id of ['cavernous_spaces', 'cavernous_spaces_left']) ctx.part(id)?.setGlow(0.1 + 0.7 * v);
    ctx.part('urethra')?.setOpacity(0.45);
  },
};
