import * as THREE from 'three';
import type { SimSnapshot } from '../../../bridge/types';
import type { DetailContext, FlowSpec, OrganDetailSpec } from '../detail/types';
import type { V3 } from '../sdf';
import { FUNDUS_DOME, stomachCurve, stomachShellR } from './stomach.parts';

/**
 * FLOWS AND ANIMATION OF THE STOMACH'S INTERIOR.
 *
 * Four things move here, and each reads a field the snapshot really has (`gi.*`):
 *
 *  - ACID SECRETION: fine particles leave the gastric glands into the lumen. Their density
 *    follows the glands' own activity (which the engine drives from digestion and vagal
 *    outflow) and is raised further when `gi.gastricPh` is low, because a low pH is what
 *    the secretion produces. The pH mapping (7 to 1 onto 0 to 1) is a display scale.
 *  - MIXING WAVES: a ring of contraction drawn as a closed circle of particles at seven
 *    stations along body, antrum and pylorus. Which station lights is chosen by
 *    `gi.peristalsisPhase`, so the wave travels body to pylorus, and only while food is
 *    present. The phase wraps from 1 to 0, so the wave is faded at both ends of its run to
 *    hide the wrap rather than draw a ring sweeping backwards.
 *  - EMPTYING: small squirts of chyme through the pylorus, open for the last part of each
 *    wave, and only while there is digesta in the stomach.
 *  - THE WALL IS GLASS. The four regions that enclose the lumen are drawn translucent every
 *    frame (the framework re-applies defaults each frame), so the rugae, glands and
 *    streams inside are visible. The rugae fade as the stomach fills (`gastricFillFraction`):
 *    that is the flattening of the folds.
 *
 * Reduced motion holds every stream still and shows the wave at rest.
 */

const ACID = 0xcfe36a;
const CHYME = 0xe0b070;
const WAVE = 0xf0c8a0;

const WALL_IDS = ['cardia', 'fundus', 'body', 'antrum'] as const;
const WAVE_STATIONS = 7;
const WAVE_U0 = 0.4;
const WAVE_U1 = 0.96;
const WAVE_IDS: string[] = Array.from({ length: WAVE_STATIONS }, (_, i) => `wave_${i}`);
const ACID_IDS = ['acid_body_lesser', 'acid_body_greater', 'acid_fundus'];

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** True when there is food in the stomach: a parcel in it, or a non-trivial fill. */
function hasFood(s: SimSnapshot): boolean {
  if (s.gi.gastricFillFraction > 0.03) return true;
  const d = s.gi.digesta;
  for (let i = 0; i < d.length; i++) if (d[i].segment === 'stomach' && d[i].volume_mL > 0) return true;
  return false;
}

const pickPhase = (s: SimSnapshot): number => s.gi.peristalsisPhase;

export const detail: OrganDetailSpec = {
  flows: () => {
    const curve = stomachCurve();
    const flows: FlowSpec[] = [];

    // Acid: from the wall towards the lumen centre at two places in the body, and down
    // from the roof of the fundus.
    const inwardFrom = (u: number, side: number): V3[] => {
      const p = curve.getPoint(u);
      // Towards the J's inside (+x on the body, which runs down the patient's left side).
      const r = stomachShellR(u);
      return [
        [p.x + side * 0.72 * r, p.y, p.z + 0.002],
        [p.x + side * 0.15 * r, p.y, p.z + 0.002],
      ];
    };
    flows.push({ id: ACID_IDS[0], path: inwardFrom(0.4, 1), count: 40, size: 0.0012, color: ACID, speed: 0.01, spread: 0.004 });
    flows.push({ id: ACID_IDS[1], path: inwardFrom(0.5, -1), count: 40, size: 0.0012, color: ACID, speed: 0.01, spread: 0.004 });
    const c = FUNDUS_DOME.centre;
    flows.push({
      id: ACID_IDS[2],
      path: [[c[0] + 0.002, c[1] + 0.017, c[2]], [c[0] + 0.002, c[1] - 0.004, c[2] + 0.002]],
      count: 40, size: 0.0012, color: ACID, speed: 0.01, spread: 0.004,
    });

    // Mixing-wave rings.
    const up = new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < WAVE_STATIONS; i++) {
      const u = WAVE_U0 + ((WAVE_U1 - WAVE_U0) * i) / (WAVE_STATIONS - 1);
      const p = curve.getPoint(u);
      const t = curve.getTangent(u).normalize();
      const n = new THREE.Vector3().crossVectors(t, up).normalize();
      const b = new THREE.Vector3().crossVectors(t, n).normalize();
      const r = 0.5 * stomachShellR(u);
      const path: V3[] = [];
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        path.push([
          p.x + (n.x * Math.cos(a) + b.x * Math.sin(a)) * r,
          p.y + (n.y * Math.cos(a) + b.y * Math.sin(a)) * r,
          p.z + (n.z * Math.cos(a) + b.z * Math.sin(a)) * r,
        ]);
      }
      flows.push({ id: WAVE_IDS[i], path, count: 14, size: 0.0014, color: WAVE, speed: 0.01, closed: true });
    }

    // Emptying: from the antrum through the pylorus and a little way into the duodenum.
    const end = curve.getPoint(1);
    const tEnd = curve.getTangent(1).normalize();
    const out = curve.getPoint(0.9);
    const mid = curve.getPoint(0.97);
    flows.push({
      id: 'chyme_out',
      path: [[out.x, out.y, out.z], [mid.x, mid.y, mid.z], [end.x, end.y, end.z], [end.x + tEnd.x * 0.016, end.y + tEnd.y * 0.016, end.z + tEnd.z * 0.016]],
      count: 40, size: 0.0016, color: CHYME, speed: 0.05, spread: 0.002,
    });
    return flows;
  },

  animate: (ctx: DetailContext) => {
    const s = ctx.snapshot;
    const still = ctx.reducedMotion;
    const food = hasFood(s);

    // The wall is glass: the lumen, folds and streams must show through.
    for (let i = 0; i < WALL_IDS.length; i++) ctx.part(WALL_IDS[i])?.setOpacity(0.2 + 0.25 * ctx.activity(WALL_IDS[i]));
    // Rugae flatten as the stomach fills.
    ctx.part('rugae')?.setOpacity(1 - 0.8 * clamp01(s.gi.gastricFillFraction));

    // Acid: density from the glands' activity and the pH (display scale).
    const lowness = clamp01((7 - s.gi.gastricPh) / 6);
    const acid = clamp01((0.1 + 0.9 * ctx.activity('gastric_glands')) * (0.6 + 0.4 * lowness));
    for (let i = 0; i < ACID_IDS.length; i++) {
      const f = ctx.flow(ACID_IDS[i]);
      if (!f) continue;
      f.setRate(still ? 0 : 1);
      f.setDensity(acid);
    }

    // Mixing wave.
    const phase = clamp01(ctx.lerp(pickPhase));
    const env = Math.min(1, 3 * phase, 3 * (1 - phase));
    const uw = phase;
    for (let i = 0; i < WAVE_STATIONS; i++) {
      const f = ctx.flow(WAVE_IDS[i]);
      if (!f) continue;
      const pos = i / (WAVE_STATIONS - 1);
      const w = food ? Math.max(0, 1 - Math.abs(pos - uw) / 0.22) * env : 0;
      f.setRate(0);
      f.setVisible(w > 0.03);
      f.setDensity(w);
    }

    // Emptying squirts and the pylorus opening as the wave arrives.
    const open = food ? smooth(0.72, 0.9, phase) * (1 - smooth(0.92, 0.99, phase)) : 0;
    const squirt = ctx.flow('chyme_out');
    if (squirt) {
      squirt.setVisible(open > 0.05);
      squirt.setDensity(open);
      squirt.setRate(still ? 0 : 0.4 + 1.6 * open);
    }
    const pylorus = ctx.part('pylorus');
    if (pylorus && !still) pylorus.setScale(1 + 0.2 * open);
  },
};
