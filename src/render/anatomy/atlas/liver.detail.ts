import * as THREE from 'three';
import type { DetailContext, FlowSpec, OrganDetailSpec } from '../detail/types';
import type { V3 } from '../sdf';
import { DEOXYGENATED, OXYGENATED, bloodColour } from '../detail/blood';
import { liverPaths, lobuleCorner, lobuleFrame, lobulePoint } from './liver.parts';

/**
 * THE LIVER'S INTERIOR IN MOTION.
 *
 * FIVE STREAMS. Portal blood runs in from the porta hepatis along the portal tree; hepatic
 * arterial blood runs in along the arterial tree beside it; bile runs OUT along the duct
 * tree towards the porta hepatis; hepatic venous blood runs out along the three hepatic
 * veins to the vena cava (GRAYS42, GH14). Inside the one enlarged lobule the sinusoid
 * streams run from each corner to the central vein, and the bile canaliculi run the other
 * way, from the centre out to the corner's ductule, which is what the real arrangement is:
 * blood towards the middle, bile towards the edge.
 *
 * COLOUR. Arterial blood is coloured from `transport.arterialSat`; portal, sinusoid and
 * hepatic venous blood from `transport.venousSat`, all through `bloodColour` (the one
 * saturation ramp the app uses). The snapshot has no separate portal saturation, so the
 * mixed venous value is the honest stand-in; the sinusoid in life carries a mixture of
 * portal and arterial blood and is drawn venous for the same reason. Bile is a green-gold.
 *
 * RATES ARE DRAWING CHOICES, NOT MEASURED FLOWS. The snapshot carries no hepatic blood
 * flow, so the blood streams follow `cardio.cardiacOutput_L_per_min` as a fraction of the
 * model's resting output (4.8 L/min, from the resting baseline), clamped to 0.3..2 so a
 * collapsed or exercising body still shows a legible stream. The portal stream also
 * speeds with the portal vein's anatomy activity (which carries the absorption and
 * digestion drives), and the bile streams with the bile ducts' (the fat-load drive). The
 * snapshot has no drug-metabolism or bile-flow field, so neither is shown.
 *
 * GLASS. The four lobes enclose the trees, so they are drawn as glass; every vessel and
 * duct carries a stream and is glass too, as is the lobule's frame, which holds its own
 * streams. The falciform ligament is the one solid part, and so is the thing a tap lands on.
 *
 * REDUCED MOTION. Streams crawl at a quarter of their rate; colours stay live.
 */

const REST_CO_L_PER_MIN = 4.8;
const BILE_COLOUR = 0xb5b83a;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** How many of a tree's leaf routes become streams: enough to read as a tree, few enough to be cheap. */
const MAX_ROUTES = 4;

function pick<T>(all: T[], n: number): T[] {
  if (all.length <= n) return all;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(all[Math.floor((i * all.length) / n)]);
  return out;
}

const lobuleSinusoid = (k: number): V3[] => {
  const mid = lobuleFrame().depth * 0.5;
  const th = (Math.PI / 3) * k + Math.PI / 6;
  const R = lobuleFrame().R;
  return [
    lobuleCorner(k, 0.82, mid),
    lobulePoint(Math.cos(th + 0.18) * R * 0.45, Math.sin(th + 0.18) * R * 0.45, mid),
    lobulePoint(Math.cos(th) * 0.0026, Math.sin(th) * 0.0026, mid),
  ];
};

const lobuleCanaliculus = (k: number): V3[] => {
  const mid = lobuleFrame().depth * 0.5 + 0.0012;
  const th = (Math.PI / 3) * k + Math.PI / 6;
  const R = lobuleFrame().R;
  const c = lobuleCorner(k, 0.9, mid);
  const t = lobuleCorner((k + 1) % 6, 0.9, mid);
  return [
    lobulePoint(Math.cos(th) * 0.004, Math.sin(th) * 0.004, mid),
    lobulePoint(Math.cos(th - 0.18) * R * 0.5, Math.sin(th - 0.18) * R * 0.5, mid),
    [c[0] + (t[0] - c[0]) * 0.18, c[1] + (t[1] - c[1]) * 0.18, c[2] + (t[2] - c[2]) * 0.18],
  ];
};

const tmp = new THREE.Color();
const LOBES = ['right_lobe', 'left_lobe', 'caudate_lobe', 'quadrate_lobe'];
const CONDUITS = ['portal_vein', 'hepatic_artery', 'hepatic_veins', 'bile_ducts', 'lobules'];

/** Flow ids built once in `flows`, so `animate` allocates nothing per frame. */
const ids = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${prefix}_${i}`);
let names = { portal: [] as string[], artery: [] as string[], bile: [] as string[], vein: [] as string[], sinusoid: ids('sinusoid', 6), canaliculus: ids('canaliculus', 6) };

export const detail: OrganDetailSpec = {
  flows: () => {
    const p = liverPaths();
    const out: FlowSpec[] = [];
    const portal = pick(p.portal, MAX_ROUTES);
    const artery = pick(p.artery, MAX_ROUTES);
    const bile = pick(p.bile, MAX_ROUTES);
    const vein = pick(p.veins, MAX_ROUTES);
    names = { ...names, portal: ids('portal', portal.length), artery: ids('artery', artery.length), bile: ids('bile', bile.length), vein: ids('vein', vein.length) };
    portal.forEach((path, i) => out.push({ id: `portal_${i}`, path, count: 40, size: 0.0016, color: DEOXYGENATED, speed: 0.02, spread: 0.0008 }));
    artery.forEach((path, i) => out.push({ id: `artery_${i}`, path, count: 28, size: 0.0012, color: OXYGENATED, speed: 0.025, spread: 0.0004 }));
    bile.forEach((path, i) => out.push({ id: `bile_${i}`, path, count: 28, size: 0.0012, color: BILE_COLOUR, speed: 0.008, spread: 0.0004 }));
    vein.forEach((path, i) => out.push({ id: `vein_${i}`, path, count: 40, size: 0.0018, color: DEOXYGENATED, speed: 0.022, spread: 0.0009 }));
    for (let k = 0; k < 6; k++) {
      out.push({ id: `sinusoid_${k}`, path: lobuleSinusoid(k), count: 18, size: 0.0009, color: DEOXYGENATED, speed: 0.01, spread: 0.0002 });
      out.push({ id: `canaliculus_${k}`, path: lobuleCanaliculus(k), count: 10, size: 0.0006, color: BILE_COLOUR, speed: 0.005, spread: 0.0001 });
    }
    return out;
  },

  animate: (ctx: DetailContext) => {
    const co = ctx.lerp((s) => s.cardio.cardiacOutput_L_per_min);
    const hf = clamp(co / REST_CO_L_PER_MIN, 0.3, 2) * (ctx.reducedMotion ? 0.25 : 1);
    const portalRate = hf * (0.7 + 0.6 * ctx.activity('portal_vein'));
    const bileRate = (ctx.reducedMotion ? 0.25 : 1) * (0.4 + 1.2 * ctx.activity('bile_ducts'));

    // Glass: lobes by their own activity; vessels and the lobule frame a steady 0.45.
    for (const id of LOBES) ctx.part(id)?.setOpacity(0.2 + 0.25 * ctx.activity(id));
    for (const id of CONDUITS) ctx.part(id)?.setOpacity(0.45);

    const venousSat = ctx.lerp((s) => s.transport.venousSat);
    const arterialSat = ctx.lerp((s) => s.transport.arterialSat);
    const venous = bloodColour(tmp, venousSat).getHex();
    const arterial = bloodColour(tmp, arterialSat).getHex();

    const run = (ids: string[], rate: number, colour: number | null): void => {
      for (const id of ids) {
        const f = ctx.flow(id);
        if (!f) continue;
        f.setRate(rate);
        f.setDensity(1);
        if (colour !== null) f.setColor(colour);
      }
    };
    run(names.portal, portalRate, venous);
    run(names.artery, hf, arterial);
    run(names.vein, hf * 0.9, venous);
    run(names.bile, bileRate, null);
    run(names.sinusoid, hf, venous);
    run(names.canaliculus, bileRate * 0.6, null);
  },
};
