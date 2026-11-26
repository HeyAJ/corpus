import * as THREE from 'three';
import type { SimSnapshot } from '../../../bridge/types';
import { OXYGENATED, bloodColour } from '../detail/blood';
import type { DetailContext, FlowSpec, OrganDetailSpec } from '../detail/types';
import { bulbPath, crusPath, transudatePath } from './vagina.parts';

/**
 * THE VAGINA'S INTERIOR IN MOTION.
 *
 * Reads `reproductive.sexual.vasocongestion` and `.orgasm`, and `transport.arterialSat`.
 *
 *   - ENGORGEMENT. The erectile tissue (the clitoral glans, body and crura, and the two
 *     vestibular bulbs) fills with blood as `vasocongestion` rises: each part is drawn in a
 *     deeper, darker red and glows with it, and the arterial streams into the bulbs and along
 *     the crura run from their resting speed to about twice that. The wall's glass deepens a
 *     little with it, since the wall itself is congested (GH14, GRAYS42).
 *   - LUBRICATION. The wall lets a transudate of plasma through into the lumen; it is drawn as
 *     fine pale particles crossing the wall, appearing as `vasocongestion` passes 0.05 and
 *     thickening with it. Where the fluid comes from is textbook physiology; how much of it
 *     is drawn is a drawing choice.
 *   - ORGASM. While `orgasm` is above zero the muscle cuff round the lower third glows
 *     rhythmically at about 0.8 Hz, scaled by the envelope. That rate is a DRAWING CHOICE
 *     for legibility, not a measured one. Under `reducedMotion` it glows steadily instead.
 *
 * GLASS. The wall and the vestibule enclose the lumen and are drawn as glass each frame;
 * the folds, the cervix, the muscle cuff, the erectile tissue and the glands stay solid.
 */

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const congestion = (s: SimSnapshot): number => s.reproductive.sexual.vasocongestion;
const orgasm = (s: SimSnapshot): number => s.reproductive.sexual.orgasm;
const arterial = (s: SimSnapshot): number => s.transport.arterialSat;

const ERECTILE = ['clitoral_glans', 'clitoral_body', 'clitoral_crura', 'vestibular_bulbs'] as const;
const INFLOWS = ['bulb_right', 'bulb_left', 'crus_right', 'crus_left'] as const;
const DEEP = new THREE.Color(0x7a1030);
const scratch = new THREE.Color();
const blood = new THREE.Color();
const BEAT_HZ = 0.8;

const NEW_GLASS: readonly (readonly [string, number])[] = [
  ['vaginal_adventitia', 0.14],
  ['vaginal_muscularis', 0.16],
  ['vaginal_lamina_propria', 0.16],
  ['vaginal_epithelium', 0.18],
  ['labia_majora', 0.22],
  ['mons_pubis', 0.2],
  ['vaginal_artery', 0.5],
];

export const detail: OrganDetailSpec = {
  flows: () => {
    const artery = (id: string, path: FlowSpec['path'], size: number): FlowSpec => ({ id, path, count: 30, size, color: OXYGENATED, speed: 0.008, spread: 0.0006 });
    const plasma = (id: string, side: 1 | -1): FlowSpec => ({ id, path: transudatePath(side), count: 40, size: 0.0007, color: 0xe9dcae, speed: 0.0022, spread: 0.0035 });
    return [
      artery('bulb_right', bulbPath(1), 0.0009),
      artery('bulb_left', bulbPath(-1), 0.0009),
      artery('crus_right', crusPath(1), 0.0008),
      artery('crus_left', crusPath(-1), 0.0008),
      plasma('transudate_right', 1),
      plasma('transudate_left', -1),
    ];
  },

  animate: (ctx: DetailContext) => {
    const vc = clamp01(ctx.lerp(congestion));
    const org = clamp01(ctx.lerp(orgasm));

    // Glass: the wall deepens with congestion.
    ctx.part('vaginal_wall')?.setOpacity(0.2 + 0.15 * vc + 0.1 * ctx.activity('vaginal_wall'));
    ctx.part('vestibule')?.setOpacity(0.18 + 0.1 * vc);
    // FINER STRUCTURES (T2): the wall's layers, the folds and pads and the artery are glass (display
    // opacities); the labia minora and the artery fill with blood with the erectile tissue.
    for (const [id, o] of NEW_GLASS) ctx.part(id)?.setOpacity(o);
    ctx.part('labia_minora')?.setOpacity(0.28 + 0.12 * vc);
    bloodColour(blood, ctx.lerp(arterial));
    ctx.part('vaginal_artery')?.setColor(blood);

    // Erectile tissue: deeper colour and glow as it fills.
    for (const id of ERECTILE) {
      const p = ctx.part(id);
      if (!p) continue;
      scratch.copy(p.baseColor).lerp(DEEP, vc);
      p.setColor(scratch);
      p.setGlow(Math.max(ctx.activity(id), 0.9 * vc));
    }

    // Arterial inflow: coloured from the live saturation, faster as the tissue fills.
    bloodColour(blood, ctx.lerp(arterial));
    const rate = ctx.reducedMotion ? 1 : 1 + vc;
    for (const id of INFLOWS) {
      const h = ctx.flow(id);
      if (!h) continue;
      h.setColor(blood);
      h.setRate(rate);
      h.setDensity(1);
    }

    // Transudate across the wall.
    for (const id of ['transudate_right', 'transudate_left']) {
      const h = ctx.flow(id);
      if (!h) continue;
      h.setVisible(vc > 0.05);
      h.setDensity(vc);
      h.setRate(1);
    }

    // Rhythmic contraction of the lower-third muscle in orgasm.
    const m = ctx.part('lower_third_muscle');
    if (m && org > 0) {
      const beat = ctx.reducedMotion ? 0.8 : 0.5 + 0.5 * Math.sin(ctx.time * Math.PI * 2 * BEAT_HZ);
      m.setGlow(Math.max(ctx.activity('lower_third_muscle'), org * (0.35 + 0.65 * beat)));
    }
  },
};
