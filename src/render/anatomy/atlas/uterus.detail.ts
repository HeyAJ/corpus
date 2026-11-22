import * as THREE from 'three';
import type { DetailContext, FlowSpec, OrganDetailSpec } from '../detail/types';
import { DEOXYGENATED, OXYGENATED, bloodColour } from '../detail/blood';
import { PLACENTA_KIDS, SAC_KIDS, arteryTrunk, liningPivot, menstrualPath, placentaPaths, tubeFlowPath } from './uterus.parts';

/**
 * THE UTERUS IN MOTION.
 *
 * Reads `reproductive.cycle` (endometrium, menstruating, phase, active),
 * `reproductive.pregnancy` (pregnant, gestationWeeks) and `transport.arterialSat` /
 * `venousSat` (blood colour, through the shared `bloodColour` ramp).
 *
 *   - LINING. Outside pregnancy the endometrium is scaled away from the posterior wall,
 *     thin when `cycle.endometrium` is low and filling the cavity when it is 1, and its
 *     colour runs from pale to a deep vascular red; while `cycle.menstruating` it is drawn
 *     thinner still and dark (shedding). In pregnancy it is the decidua: full size, a
 *     steady colour.
 *   - WALL. The perimetrium, myometrium, cavity, cervix, canal, tubes, arteries, the three
 *     wall zones and the sac enclose or carry streams, so they are GLASS every frame. The
 *     myometrium gets more opaque with its activity (oxytocin, orgasm, menstruation in
 *     the data file).
 *   - STREAMS. Menstrual flow runs from the cavity out through the canal while
 *     `cycle.menstruating`. A stream runs along each tube from the fimbriae to the cavity
 *     (ciliary transport), faster at `phase === 'ovulation'`, outside pregnancy only.
 *     Uterine artery blood is arterial-coloured. In pregnancy, from week 8, maternal
 *     arterial blood runs into the placental site from the wall and venous blood leaves.
 *
 * WEEK-DEPENDENT STREAMS. `flows(organId)` is not told the gestational week, and a stream
 * is a fixed path, but the uterus grows. So the artery and placenta streams are created
 * once for each of a ladder of weeks (week 0 and every second week from 6 to 42) and
 * `animate` shows only the set nearest the current week and hides the rest. The parts are
 * built at the exact week, so a stream can be up to a week of growth out of place; the
 * streams run in glass tissue and are given enough spread to stay in it.
 *
 * Stream rates and particle counts are drawing choices. Under `reducedMotion` the shapes
 * hold still, but the lining's thickness, which is data, and all the colours stay live.
 */

const BINS: number[] = [0];
for (let w = 6; w <= 42; w += 2) BINS.push(w);
const ARTERY_L = BINS.map((_, i) => `artery_l_${i}`);
const ARTERY_R = BINS.map((_, i) => `artery_r_${i}`);
const PL_IN = BINS.map((_, i) => `placenta_in_${i}`);
const PL_OUT = BINS.map((_, i) => `placenta_out_${i}`);

const GLASS: readonly [string, number][] = [
  ['perimetrium', 0.16],
  ['uterine_cavity', 0.1],
  ['fundus', 0.2],
  ['uterine_body', 0.2],
  ['isthmus', 0.22],
  ['cervix', 0.26],
  ['cervical_canal', 0.4],
  ['tube_isthmus', 0.4],
  ['tube_ampulla', 0.4],
  ['infundibulum_fimbriae', 0.4],
  ['uterine_arteries', 0.45],
  ['amniotic_sac', 0.12],
  // FINER STRUCTURES (T2). Sheets, vessels and membranes that enclose or carry something are
  // glass; the opacities are display choices. The ligaments, the glands, the spiral arteries,
  // the villi and the layers that hold nothing stay solid so they can be tapped.
  ['broad_ligament', 0.18],
  ['mesometrium', 0.5],
  ['mesosalpinx', 0.5],
  ['intramural_tube', 0.4],
  ['uterine_veins', 0.45],
  ['functional_layer', 0.22],
  ['endometrial_stroma', 0.3],
  ['intervillous_space', 0.25],
  ['umbilical_cord', 0.3],
  ['whartons_jelly', 0.35],
  ['amnion', 0.12],
  ['chorion', 0.12],
  ['amniotic_fluid', 0.08],
];

const THIN = new THREE.Color(0xe3b4b0);
const THICK = new THREE.Color(0xb23a4c);
const SHED = new THREE.Color(0x5e1a24);
const DECIDUA = new THREE.Color(0xb86b76);
/** Display colour of the placental disc: deep red so it reads as perfused tissue. */
const PLACENTA_RED = new THREE.Color(0x6e1420);
const tmp = new THREE.Color();
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function binIndex(weeks: number): number {
  if (weeks < 6) return 0;
  return 1 + (clamp(Math.round(weeks / 2) * 2, 6, 42) - 6) / 2;
}

export const detail: OrganDetailSpec = {
  flows: () => {
    const specs: FlowSpec[] = [];
    specs.push({ id: 'menses', path: menstrualPath(), count: 40, size: 0.0013, color: OXYGENATED, speed: 0.004, spread: 0.0018 });
    specs.push({ id: 'tube_l', path: tubeFlowPath(1), count: 26, size: 0.0008, color: 0xe8c9a0, speed: 0.006, spread: 0.0007 });
    specs.push({ id: 'tube_r', path: tubeFlowPath(-1), count: 26, size: 0.0008, color: 0xe8c9a0, speed: 0.006, spread: 0.0007 });
    BINS.forEach((w, i) => {
      specs.push({ id: ARTERY_L[i], path: arteryTrunk(w, 1), count: 24, size: 0.0012, color: OXYGENATED, speed: 0.012, spread: 0.0006 });
      specs.push({ id: ARTERY_R[i], path: arteryTrunk(w, -1), count: 24, size: 0.0012, color: OXYGENATED, speed: 0.012, spread: 0.0006 });
      if (w >= 8) {
        const p = placentaPaths(w);
        const spread = Math.max(0.002, 0.25 * p.thick);
        specs.push({ id: PL_IN[i], path: p.inflow, count: 36, size: 0.0014, color: OXYGENATED, speed: 0.008, spread });
        specs.push({ id: PL_OUT[i], path: p.outflow, count: 36, size: 0.0014, color: DEOXYGENATED, speed: 0.008, spread });
      }
    });
    return specs;
  },

  animate: (ctx: DetailContext) => {
    const s = ctx.snapshot;
    const cyc = s.reproductive.cycle;
    const preg = s.reproductive.pregnancy;
    const pregnant = preg.pregnant;
    const weeks = pregnant ? preg.gestationWeeks : 0;
    const bin = binIndex(weeks);
    const placenta = pregnant && weeks >= 8;
    const menstruating = !pregnant && cyc.menstruating;

    // GLASS walls, every frame.
    for (const [id, o] of GLASS) ctx.part(id)?.setOpacity(o);
    ctx.part('myometrium')?.setOpacity(0.2 + 0.3 * ctx.activity('myometrium'));
    // THE PLACENTA IS TISSUE, NOT GLASS. It carries no GLASS entry, so it was drawn at the
    // default opacity, but in the pale, pink-washed shell and behind the glass sac and wall
    // its rim read as a white ring, like a lens. It is a solid disc in a dark red (a
    // drawing choice: the dark liver-like red of a perfused organ, not a measured colour);
    // opacity 1 keeps it out of the glass pass (OrganDetail GLASS_BELOW) and so it writes
    // depth and hides what is behind it, as tissue does.
    const pl = ctx.part('placenta');
    if (pl) {
      pl.setOpacity(1);
      pl.setColor(PLACENTA_RED);
      pl.setVisible(placenta);
    }
    ctx.part('amniotic_sac')?.setVisible(placenta);
    // Before week 8 (and outside pregnancy) every placental and sac child is a hidden sliver, like
    // its parent; a close camera would otherwise reveal them as stray specks.
    for (const id of PLACENTA_KIDS) ctx.part(id)?.setVisible(placenta);
    for (const id of SAC_KIDS) ctx.part(id)?.setVisible(placenta);

    // LINING: thickness and colour follow the cycle, or the decidua in pregnancy.
    const lining = ctx.part('endometrium');
    if (lining) {
      if (pregnant) {
        lining.setScale(1);
        lining.setColor(DECIDUA);
      } else {
        const e0 = clamp(ctx.lerp((x) => x.reproductive.cycle.endometrium), 0, 1);
        const e = menstruating ? 0.7 * e0 : e0;
        lining.setScale([0.88 + 0.12 * e, 1, 0.25 + 0.75 * e], liningPivot(0));
        tmp.copy(THIN).lerp(THICK, e0);
        if (menstruating) tmp.lerp(SHED, 0.7);
        lining.setColor(tmp);
      }
    }

    // STREAMS.
    const menses = ctx.flow('menses');
    if (menses) {
      menses.setVisible(menstruating);
      menses.setRate(1);
    }
    const ovulation = cyc.phase === 'ovulation';
    for (const id of ['tube_l', 'tube_r']) {
      const f = ctx.flow(id);
      if (!f) continue;
      f.setVisible(!pregnant && cyc.active);
      f.setRate(ovulation ? 1.6 : 1);
    }
    bloodColour(tmp, s.transport.arterialSat);
    // The new vessels take the same shared ramp: spiral arteries arterial, veins venous. The cord
    // follows the atlas convention of the fetus atlas (arteries deoxygenated, vein oxygenated).
    ctx.part('spiral_arteries')?.setColor(tmp);
    ctx.part('cord_vein')?.setColor(OXYGENATED);
    ctx.part('cord_arteries')?.setColor(DEOXYGENATED);
    bloodColour(tmp, s.transport.venousSat);
    ctx.part('uterine_veins')?.setColor(tmp);
    bloodColour(tmp, s.transport.arterialSat);
    for (let i = 0; i < BINS.length; i++) {
      const on = i === bin;
      for (const id of [ARTERY_L[i], ARTERY_R[i], PL_IN[i]]) {
        const f = ctx.flow(id);
        if (!f) continue;
        f.setVisible(on && (id !== PL_IN[i] || placenta));
        if (on) f.setColor(tmp);
      }
      const out = ctx.flow(PL_OUT[i]);
      if (out) {
        out.setVisible(on && placenta);
        if (on) {
          bloodColour(tmp, s.transport.venousSat);
          out.setColor(tmp);
          bloodColour(tmp, s.transport.arterialSat);
        }
      }
    }
  },
};
