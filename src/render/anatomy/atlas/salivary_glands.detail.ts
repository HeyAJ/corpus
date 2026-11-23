import type { DetailContext, FlowSpec, OrganDetailSpec } from '../detail/types';
import { ACINUS_DUCT, PAROTID_DUCT, SUBMANDIBULAR_DUCT } from './salivary_glands.parts';

/**
 * SALIVA ALONG THE DUCTS.
 *
 * Saliva VOLUME is not simulated; what the engine has is parasympathetic and sympathetic
 * outflow, which the data file turns into each gland's activity (parasympathetic 0.3, the
 * sympathetic 0.08 that Guyton and Hall call a small, thick secretion). This module reads
 * that activity and shows droplets travelling along the parotid and submandibular ducts and
 * along the duct of the magnified acinus. The droplets' speed and number follow how far the
 * activity is above its resting anchor; BASE_RATE, RATE_GAIN and the density law are DISPLAY
 * CHOICES and the speed in metres per second is not a flow velocity. A resting trickle is
 * kept (the mouth is kept moist between meals), and under reduced motion the stream runs at a
 * slow fixed rate and does not speed up.
 *
 * GLASS. Ducts have a lumen and the acinus's envelope encloses its cells, so they are drawn
 * see-through; the glands themselves are glass too so the facial plexus and ducts inside the
 * parotid can be seen. Nerves, ganglia and the cells stay solid so they can be tapped.
 */

const GLASS: readonly [string, number][] = [
  ['parotid_glands', 0.3],
  ['parotid_superficial_part', 0.3],
  ['parotid_deep_part', 0.3],
  ['submandibular_glands', 0.35],
  ['sublingual_glands', 0.35],
  ['parotid_duct', 0.4],
  ['submandibular_duct', 0.4],
  ['intercalated_duct', 0.4],
  ['striated_duct', 0.4],
  ['excretory_duct', 0.4],
  ['salivary_acinus', 0.18],
];

const DROPLET = 0x9fd3e6;
/** Resting droplet speed, as a multiple of the spec speed. A display choice. */
const BASE_RATE = 0.3;
/** Extra speed at full parasympathetic drive. A display choice. */
const RATE_GAIN = 2.6;
/** The part activity at rest and the span of the drive's weight, from the data file. */
const REST = 0.3;
const SPAN = 0.3;

const mirror = (p: readonly [number, number, number][], s: number): [number, number, number][] => p.map((q) => [s * q[0], q[1], q[2]]);

export const detail: OrganDetailSpec = {
  flows: () => {
    const specs: FlowSpec[] = [];
    for (const [side, s] of [['r', 1], ['l', -1]] as const) {
      specs.push({ id: `parotid_${side}`, path: mirror(PAROTID_DUCT as [number, number, number][], s), count: 22, size: 0.0009, color: DROPLET, speed: 0.02, spread: 0.0002 });
      specs.push({ id: `submandibular_${side}`, path: mirror(SUBMANDIBULAR_DUCT as [number, number, number][], s), count: 22, size: 0.0009, color: DROPLET, speed: 0.02, spread: 0.0002 });
    }
    specs.push({ id: 'acinus', path: ACINUS_DUCT as [number, number, number][], count: 14, size: 0.0006, color: DROPLET, speed: 0.008, spread: 0.0001 });
    return specs;
  },

  animate: (ctx: DetailContext) => {
    for (const [id, o] of GLASS) ctx.part(id)?.setOpacity(o);
    const excess = Math.max(0, Math.min(1, (ctx.activity('parotid_glands') - REST) / SPAN));
    const rate = ctx.reducedMotion ? 0.15 : BASE_RATE + RATE_GAIN * excess;
    const density = 0.4 + 0.6 * excess;
    for (const id of ['parotid_r', 'parotid_l', 'submandibular_r', 'submandibular_l', 'acinus']) {
      const f = ctx.flow(id);
      f?.setRate(rate);
      f?.setDensity(density);
    }
  },
};
