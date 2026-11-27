import type { OrganDetailSpec } from '../detail/types';

/**
 * THE ABDOMINAL WALL: no motion. The engine has no per-muscle state, only whole-body muscle tone,
 * exertion, a seizure, shivering, vomiting and respiratory drive, which the atlas file turns into
 * each part's colour. Nothing here moves the wall, because the model has no trunk movement and
 * the wall's own movement with the breath is not simulated. The sheath, the linea alba, the
 * ligament and the canal are fibrous and are drawn as glass so the muscles read through them
 * (a display choice, not a statement that they are translucent).
 */
const GLASS: readonly [string, number][] = [
  ['rectus_sheath', 0.3], ['rectus_sheath_anterior_layer', 0.3], ['rectus_sheath_posterior_layer', 0.3], ['arcuate_line', 0.5],
  ['linea_alba', 0.45], ['inguinal_canal', 0.3], ['external_oblique_aponeurosis', 0.45],
];

export const detail: OrganDetailSpec = {
  animate: (ctx) => {
    for (const [id, o] of GLASS) ctx.part(id)?.setOpacity(o);
  },
};
