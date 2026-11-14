import type { DetailContext, FlowSpec, OrganDetailSpec } from '../detail/types';
import { DEOXYGENATED, OXYGENATED } from '../detail/blood';
import { fetalPaths } from './fetus.parts';

/**
 * THE FETAL CIRCULATION IN MOTION, DRAWN AS ANATOMY AND NOT SIMULATED.
 *
 * The engine models no fetal heart rate, no fetal blood gas and no fetal movement; the
 * snapshot carries a fetal weight and nothing else about the fetus. So nothing here reads
 * the snapshot. The streams run at a steady DISPLAY rate (a drawing choice for legibility:
 * it is not a flow, a rate or any measurement), the heart glows steadily and does not beat,
 * and the colours are constants, because there is no fetal saturation to colour them by.
 * Under `reducedMotion` the streams hold still.
 *
 * THE STREAMS, in the order the blood goes (the parts and the paths come from the same
 * arrays in fetus.parts.ts, so they line up exactly):
 *   OXYGENATED colour: umbilical vein -> ductus venosus -> inferior vena cava -> right
 *     atrium -> foramen ovale -> left atrium -> left ventricle -> aortic arch -> brain.
 *   DEOXYGENATED colour: superior vena cava -> right atrium -> right ventricle ->
 *     pulmonary trunk -> ductus arteriosus -> descending aorta -> the two umbilical
 *     arteries out to the placenta.
 * The two colours are the atlas convention (blood.ts): the vein is drawn in the oxygenated
 * colour because the umbilical vein carries the blood the placenta has arterialised, and
 * the arteries in the other. In life the inferior vena cava and the aorta below the duct
 * carry mixed blood (GH14); the drawing keeps each stream a single colour for legibility.
 * The lungs get no stream: they are unexpanded and receive little of the right ventricle's
 * output, which goes through the duct instead, and drawing a trickle would imply a
 * quantity this file cannot give.
 *
 * GLASS. Everything that encloses something or carries a stream is glass each frame: the
 * brain, heart, lungs and liver (they hold or are crossed by vessels) and every vessel
 * (or its particles would be invisible). The three shunts are short solid parts, so a tap
 * on the duct or the foramen finds it through the glass.
 */

const STREAM_SPEED = 0.04;
const CONSTANT_GLOW = 0.4;

/** Part id, colour (or null to keep the atlas colour), glass opacity (or null for solid). */
const PART_LOOK: readonly (readonly [string, number | null, number | null])[] = [
  ['brain', null, 0.3],
  ['heart', null, 0.32],
  ['lungs', null, 0.22],
  ['liver', null, 0.25],
  ['aortic_arch', OXYGENATED, 0.45],
  ['descending_aorta', DEOXYGENATED, 0.45],
  ['inferior_vena_cava', OXYGENATED, 0.45],
  ['superior_vena_cava', DEOXYGENATED, 0.45],
  ['pulmonary_trunk', DEOXYGENATED, 0.45],
  ['umbilical_vein', OXYGENATED, 0.45],
  ['umbilical_arteries', DEOXYGENATED, 0.45],
  ['ductus_venosus', OXYGENATED, null],
  ['foramen_ovale', OXYGENATED, null],
  ['ductus_arteriosus', DEOXYGENATED, null],
];

const FLOW_IDS: readonly string[] = [
  'umbilical_vein',
  'ductus_venosus',
  'inferior_vena_cava',
  'foramen_ovale',
  'left_heart_to_brain',
  'superior_vena_cava',
  'right_heart_to_trunk',
  'ductus_arteriosus',
  'descending_aorta',
  'umbilical_artery_a',
  'umbilical_artery_b',
];

export const detail: OrganDetailSpec = {
  flows: () => {
    const p = fetalPaths();
    const make = (id: string, path: FlowSpec['path'], color: number, count: number, size = 0.0013, spread = 0.0004): FlowSpec => ({
      id,
      path,
      count,
      size,
      color,
      speed: STREAM_SPEED,
      spread,
    });
    return [
      make('umbilical_vein', p.veinFull, OXYGENATED, 110),
      make('ductus_venosus', p.ductusVenosus, OXYGENATED, 22, 0.0013, 0.0006),
      make('inferior_vena_cava', p.ivcStream, OXYGENATED, 36, 0.0014, 0.0008),
      make('foramen_ovale', p.foramenStream, OXYGENATED, 26, 0.0014, 0.0008),
      make('left_heart_to_brain', p.leftHeartStream, OXYGENATED, 70, 0.0014, 0.0007),
      make('superior_vena_cava', p.svc, DEOXYGENATED, 40, 0.0014, 0.0007),
      make('right_heart_to_trunk', p.rightHeartStream, DEOXYGENATED, 44, 0.0014, 0.0008),
      make('ductus_arteriosus', p.ductusArteriosus, DEOXYGENATED, 20, 0.0013, 0.0006),
      make('descending_aorta', p.descendingAorta, DEOXYGENATED, 60, 0.0014, 0.0006),
      make('umbilical_artery_a', p.arteries[0], DEOXYGENATED, 100, 0.0012, 0.0003),
      make('umbilical_artery_b', p.arteries[1], DEOXYGENATED, 100, 0.0012, 0.0003),
    ];
  },

  animate: (ctx: DetailContext) => {
    for (const [id, colour, glass] of PART_LOOK) {
      const part = ctx.part(id);
      if (!part) continue;
      if (colour !== null) part.setColor(colour);
      if (glass !== null) part.setOpacity(glass);
      // The engine gives the fetal parts no activity, so the glow is a constant.
      part.setGlow(CONSTANT_GLOW);
    }
    const rate = ctx.reducedMotion ? 0 : 1;
    for (const id of FLOW_IDS) ctx.flow(id)?.setRate(rate);
  },
};
