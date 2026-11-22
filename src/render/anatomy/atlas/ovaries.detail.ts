import * as THREE from 'three';
import type { SimSnapshot } from '../../../bridge/types';
import { DEOXYGENATED, OXYGENATED, bloodColour } from '../detail/blood';
import type { DetailContext, FlowSpec, OrganDetailSpec } from '../detail/types';
import { FOLLICLE_CENTRE, OOCYTE_ROUTE, vesselPaths } from './ovaries.parts';

/**
 * THE OVARIES' INTERIOR IN MOTION.
 *
 * Reads `reproductive.cycle` (`active`, `phase`, `follicle`, `corpusLuteum`), the plasma
 * estradiol activity from `endocrine.hormones`, and the arterial and venous saturations from
 * `transport`.
 *
 *   - THE DOMINANT FOLLICLE grows with `cycle.follicle` (drawn at 18 % of its largest size
 *     when the value is zero, so the early follicle is still visible) and glows with
 *     estradiol, the hormone the granulosa cells of a growing follicle make (GH14). It is
 *     hidden when the body is not in a cycle (pregnancy, or no cycle) and in the luteal
 *     phase, when it has become the corpus luteum.
 *   - OVULATION. In the phase `ovulation` the follicle is drawn rupturing: it shrinks to
 *     nothing over 1.6 s and stays hidden, the oocyte leaves with it, and a short stream
 *     of particles crosses the ovarian surface towards the fimbriae of the uterine tube,
 *     for the first few seconds of the phase. The 1.6 s and the stream's length are
 *     DRAWING CHOICES for legibility, not physiology: at the simulator's cycle speed the
 *     phase may last far less or far more wall-clock time than that. The timer starts the
 *     first frame this module sees the phase, so selecting the ovaries in the middle of
 *     ovulation plays the rupture from its start. Under `reducedMotion` the follicle is
 *     simply hidden at once.
 *   - THE CORPUS LUTEUM sits where the follicle was and follows `cycle.corpusLuteum`, hidden
 *     below a small value, glowing with its size. When `cycle.active` is false (pregnancy)
 *     its size follows its own anatomy activity instead, which the data file drives from the
 *     corpus luteum signal and from hCG, the hormone that maintains it in early pregnancy.
 *   - BLOOD. Arterial blood runs in and venous blood out at each hilum, coloured from the
 *     live saturations; the streams run faster when the corpus luteum is large, which is
 *     the richly vascular body of the luteal phase.
 *
 * GLASS. The tunica, the cortex, the medulla, the vessels and the follicle's wall enclose
 * other parts or carry a stream, so all are drawn as glass each frame. The small follicles,
 * the oocyte, the corpus luteum and the scar stay solid.
 */

const RUPTURE_S = 1.6;
const STREAM_S = 5;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

const follicle = (s: SimSnapshot): number => s.reproductive.cycle.follicle;
const luteum = (s: SimSnapshot): number => s.reproductive.cycle.corpusLuteum;
const arterial = (s: SimSnapshot): number => s.transport.arterialSat;
const venous = (s: SimSnapshot): number => s.transport.venousSat;
const estradiol = (s: SimSnapshot): number => {
  const hs = s.endocrine.hormones;
  for (let i = 0; i < hs.length; i++) if (hs[i].id === 'estradiol') return hs[i].activity;
  return 0;
};

/** Module state: when this view first saw the current ovulation phase, seconds of ctx.time. */
let ovulationStart = -1;
let lastTime = 0;
const scratch = new THREE.Color();

/** Children that follow their parent's visibility, and the glass opacities of the new parts. */
const FOLLICLE_KIDS = ['antrum', 'granulosa_cells', 'theca_interna', 'theca_externa', 'cumulus_oophorus'] as const;
const OOCYTE_KIDS = ['zona_pellucida', 'corona_radiata'] as const;
const LUTEUM_KIDS = ['granulosa_lutein_cells', 'theca_lutein_cells'] as const;
const CHILD_GLASS: readonly (readonly [string, number])[] = [
  ['theca_externa', 0.16],
  ['theca_interna', 0.2],
  ['granulosa_cells', 0.22],
  ['antrum', 0.18],
  ['cumulus_oophorus', 0.35],
  ['zona_pellucida', 0.35],
  ['granulosa_lutein_cells', 0.3],
  ['surface_epithelium', 0.14],
  ['mesovarium', 0.3],
];

export const detail: OrganDetailSpec = {
  flows: () => {
    const blood = (id: string, path: FlowSpec['path'], color: number): FlowSpec => ({ id, path, count: 26, size: 0.0007, color, speed: 0.006, spread: 0.0002 });
    const r = vesselPaths(1);
    const l = vesselPaths(-1);
    return [
      blood('artery_right', r.artery, OXYGENATED),
      blood('vein_right', r.vein, DEOXYGENATED),
      blood('artery_left', l.artery, OXYGENATED),
      blood('vein_left', l.vein, DEOXYGENATED),
      { id: 'oocyte_release', path: OOCYTE_ROUTE, count: 14, size: 0.0011, color: 0xf2e6c4, speed: 0.0025, spread: 0.0005 },
    ];
  },

  animate: (ctx: DetailContext) => {
    // A new viewing (time went backwards) forgets the old ovulation timer.
    if (ctx.time < lastTime) ovulationStart = -1;
    lastTime = ctx.time;

    const snap = ctx.snapshot;
    const cyc = snap.reproductive.cycle;
    const e2 = clamp01(ctx.lerp(estradiol));

    ctx.part('tunica_albuginea')?.setOpacity(0.2 + 0.08 * ctx.activity('tunica_albuginea'));
    ctx.part('cortex')?.setOpacity(0.18 + 0.2 * ctx.activity('cortex'));
    ctx.part('medulla')?.setOpacity(0.3);
    ctx.part('ovarian_artery')?.setOpacity(0.5);
    ctx.part('ovarian_vein')?.setOpacity(0.5);
    // FINER STRUCTURES (T2): the follicle's nested wall layers, the zona, the lutein core and the
    // surface skin are glass so what lies inside them can be seen; the opacities are display
    // choices. The follicle, oocyte and corpus luteum children are shown and hidden with their
    // parent below (a child does not inherit visibility, only pose).
    for (const [id, o] of CHILD_GLASS) ctx.part(id)?.setOpacity(o);

    // Ovulation timer.
    const ovulating = cyc.active && cyc.phase === 'ovulation';
    if (ovulating && ovulationStart < 0) ovulationStart = ctx.time;
    if (!ovulating) ovulationStart = -1;
    const since = ovulating ? ctx.time - ovulationStart : 0;
    const rupture = ovulating ? (ctx.reducedMotion ? 1 : clamp01(since / RUPTURE_S)) : 0;

    // The dominant follicle and its oocyte.
    const f = clamp01(ctx.lerp(follicle));
    const showFollicle = cyc.active && cyc.phase !== 'luteal' && rupture < 1;
    const fPart = ctx.part('dominant_follicle');
    const oPart = ctx.part('oocyte');
    if (fPart) {
      fPart.setVisible(showFollicle);
      if (showFollicle) {
        const size = (0.18 + 0.82 * f) * (1 - rupture);
        fPart.setScale(Math.max(0.01, size), FOLLICLE_CENTRE);
        fPart.setOpacity(0.28 + 0.17 * e2);
        fPart.setGlow(clamp01(0.15 + 0.85 * e2));
      }
    }
    for (const id of FOLLICLE_KIDS) ctx.part(id)?.setVisible(showFollicle);
    if (oPart) {
      // The oocyte leaves with the stream, so it is hidden once the follicle is half collapsed.
      const showOocyte = showFollicle && rupture < 0.5;
      oPart.setVisible(showOocyte);
      for (const id of OOCYTE_KIDS) ctx.part(id)?.setVisible(showOocyte);
      if (showOocyte) oPart.setScale(Math.max(0.01, 0.18 + 0.82 * f), FOLLICLE_CENTRE);
    }
    const stream = ctx.flow('oocyte_release');
    if (stream) {
      stream.setVisible(ovulating && since > RUPTURE_S * 0.3 && since < RUPTURE_S + STREAM_S);
      stream.setRate(1);
      stream.setDensity(1);
    }

    // The corpus luteum.
    const cl = cyc.active ? clamp01(ctx.lerp(luteum)) : clamp01(ctx.activity('corpus_luteum'));
    const clPart = ctx.part('corpus_luteum');
    if (clPart) {
      clPart.setVisible(cl > 0.03);
      for (const id of LUTEUM_KIDS) ctx.part(id)?.setVisible(cl > 0.03);
      clPart.setScale(0.3 + 0.7 * cl, FOLLICLE_CENTRE);
      clPart.setGlow(cl);
    }
    ctx.part('corpus_albicans')?.setGlow(0.05);

    // Blood: coloured from the live saturations, quicker through a large corpus luteum.
    const rate = ctx.reducedMotion ? 0.5 : 0.75 + 0.6 * cl;
    const sat = ['artery_right', 'artery_left'];
    const sv = ['vein_right', 'vein_left'];
    bloodColour(scratch, ctx.lerp(arterial));
    for (const id of sat) {
      const h = ctx.flow(id);
      if (!h) continue;
      h.setColor(scratch);
      h.setRate(rate);
      h.setDensity(1);
    }
    bloodColour(scratch, ctx.lerp(venous));
    for (const id of sv) {
      const h = ctx.flow(id);
      if (!h) continue;
      h.setColor(scratch);
      h.setRate(rate);
      h.setDensity(1);
    }
  },
};

