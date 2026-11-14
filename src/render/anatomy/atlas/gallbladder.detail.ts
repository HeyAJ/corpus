import type { DetailContext, FlowSpec, OrganDetailSpec } from '../detail/types';
import { GB_NECK, gallbladderPaths } from './gallbladder.parts';

/**
 * THE GALLBLADDER'S INTERIOR IN MOTION.
 *
 * The liver makes bile all the time. Between meals the sphincter at the duodenal end of the
 * common bile duct is closed, so bile backs up the cystic duct into the gallbladder, where it
 * is stored and concentrated. When fat reaches the duodenum the gallbladder's wall contracts
 * and the sphincter relaxes, so the stored bile is squeezed out down the cystic duct and the
 * common bile duct to the gut (GH14 ch. 65, GRAYS42).
 *
 * WHAT IT READS. The snapshot has no bile, gallbladder or fat field, so the one signal used
 * is the wall's own ANATOMY ACTIVITY (`ctx.activity('body')`), which the data file builds
 * from the `fatLoad`, `digestion` and `parasympathetic` drives, plus `gi.gastricFillFraction`
 * so that a full stomach starts the emptying a little before the fat-load drive reaches its
 * peak. The two are combined into `squeeze`, 0 at rest and 1 at full contraction:
 *
 *     squeeze = clamp((activity - 0.2) / 0.5) + 0.5 * gastricFillFraction, limited to 0..1
 *
 * 0.2 is the wall's resting activity (the `rest` in the data file) and 0.5 is a display
 * choice that makes the full range of the drive span the full contraction. These are
 * DRAWING CHOICES; the real contraction is under hormonal control the model does not have.
 *
 *   - SIZE. The stored bile is drawn at its full size when squeeze is 0 and at 45 % when it is
 *     1, shrinking towards the neck; the wall is drawn at 100 % to 80 %. Scaling is about the
 *     neck so everything stays inside the original outline. Under `reducedMotion` both stay
 *     at full size.
 *   - STREAMS. Three: the hepatic stream (liver to bile duct) always runs; the FILL stream
 *     (junction to the bag) runs while squeeze is below 0.15; the EMPTYING stream (bag to the
 *     duodenum) runs above it and speeds up with the squeeze. The stream lengths are fixed by
 *     the geometry; their rates are drawing choices.
 *
 * GLASS. The three wall pieces and the three ducts are drawn as glass because they enclose
 * or carry the streams; the stored bile and the spiral fold are solid, so they are what a tap
 * lands on.
 */

const BILE_COLOUR = 0xb5b83a;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const WALL_PIECES = ['fundus', 'body', 'neck'];
const DUCTS = ['cystic_duct', 'common_hepatic_duct', 'common_bile_duct'];
const SQUEEZE_THRESHOLD = 0.15;

const pivotArr = GB_NECK;

export const detail: OrganDetailSpec = {
  flows: () => {
    const p = gallbladderPaths();
    const make = (id: string, path: FlowSpec['path'], count: number): FlowSpec => ({ id, path, count, size: 0.0012, color: BILE_COLOUR, speed: 0.012, spread: 0.0005 });
    return [make('hepatic', p.hepatic, 26), make('fill', p.fill, 30), make('empty', p.empty, 36)];
  },

  animate: (ctx: DetailContext) => {
    const act = ctx.activity('body');
    const stomach = clamp(ctx.lerp((s) => s.gi.gastricFillFraction), 0, 1);
    const squeeze = clamp(clamp((act - 0.2) / 0.5, 0, 1) + 0.5 * stomach, 0, 1);
    const slow = ctx.reducedMotion ? 0.25 : 1;

    for (const id of WALL_PIECES) ctx.part(id)?.setOpacity(0.2 + 0.25 * ctx.activity(id));
    for (const id of DUCTS) ctx.part(id)?.setOpacity(0.45);

    if (ctx.reducedMotion) {
      ctx.part('bile')?.setScale(1, pivotArr);
    } else {
      ctx.part('bile')?.setScale(1 - 0.55 * squeeze, pivotArr);
      for (const id of WALL_PIECES) ctx.part(id)?.setScale(1 - 0.2 * squeeze, pivotArr);
    }

    const hepatic = ctx.flow('hepatic');
    if (hepatic) {
      hepatic.setRate(slow * (0.5 + 0.8 * ctx.activity('common_hepatic_duct')));
      hepatic.setDensity(1);
    }
    const filling = squeeze < SQUEEZE_THRESHOLD;
    const fill = ctx.flow('fill');
    if (fill) {
      fill.setVisible(filling);
      fill.setRate(slow * 0.7);
      fill.setDensity(1);
    }
    const empty = ctx.flow('empty');
    if (empty) {
      empty.setVisible(!filling);
      empty.setRate(slow * (0.5 + 1.5 * squeeze));
      empty.setDensity(1);
    }
  },
};
