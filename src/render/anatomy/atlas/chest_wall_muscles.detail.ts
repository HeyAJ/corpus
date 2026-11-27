import type { OrganDetailSpec } from '../detail/types';
import { RIB_DISPLAY_FORWARD_M, RIB_DISPLAY_RISE_M } from './thoracic_cage.detail';

/**
 * THE CHEST WALL MUSCLES IN THE BREATH: the intercostal layers, the subcostales and transversus
 * thoracis are carried with the ribs, cartilages and sternum they lie on, by the same rigid display
 * offset the rib cage uses (`resp.inflation`, interpolated between snapshots; the amplitudes are
 * the rib cage's own display constants, not measurements). The muscles do not stretch to follow
 * (parts are rigid meshes). The pectorals, serratus and levatores do not move: levatores are
 * anchored to the vertebrae, and the pectorals and serratus are moved by the arm, which is not
 * simulated. Frozen at zero under reduced motion. Their colours follow `ventilation`,
 * `respDrive` and the whole-body drives through the atlas file.
 */
const MOVING = [
  'intercostal_muscles', 'external_intercostals', 'internal_intercostals', 'innermost_intercostals', 'subcostales', 'transversus_thoracis',
  ...Array.from({ length: 11 }, (_, i) => `external_intercostal_space_${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 11 }, (_, i) => `internal_intercostal_space_${String(i + 1).padStart(2, '0')}`),
];

export const detail: OrganDetailSpec = {
  animate: (ctx) => {
    const inflation = ctx.reducedMotion ? 0 : Math.max(0, Math.min(1, ctx.lerp((s) => s.resp.inflation)));
    for (const id of MOVING) ctx.part(id)?.setOffset([0, RIB_DISPLAY_RISE_M * inflation, RIB_DISPLAY_FORWARD_M * inflation]);
  },
};
