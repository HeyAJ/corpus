import type { DetailContext, FlowSpec, OrganDetailSpec } from '../detail/types';
import { breathTracker } from './lungShared';
import { CONSTRICTORS, centreAt, constrictorPivot, type ConstrictorId } from './pharynx.parts';
import type { V3 } from '../sdf';

/**
 * THE PHARYNX IN MOTION: a descending squeeze on swallowing, and the breath in the airway.
 *
 * THE SWALLOW. Guyton and Hall describe the pharyngeal stage as a wave of constriction that
 * passes down the pharynx and drives the bolus on. The engine's `swallowing` signal only says
 * that something is in the oesophagus, so (as in the mouth) one wave is played from its
 * RISING EDGE and is not held. The wave takes WAVE_S seconds, runs from the superior to the
 * inferior constrictor, and each sheet narrows by up to SQUEEZE about the lumen's axis while
 * the wave is near it. WAVE_S and SQUEEZE are DISPLAY CHOICES, not measured durations or
 * shortenings. Under reduced motion the sheets do not move; they still glow with their
 * activity.
 *
 * THE BREATH. A column of pale droplets runs down the airway while the lungs fill and up
 * while they empty, using the same tracker as the lungs (the sign and size of the change in
 * `resp.inflation`), and stops in apnoea. It is drawn only because that signal exists; the
 * droplet speed is a display rate, not an airflow.
 *
 * GLASS. The three levels are walls round the lumen, so they are drawn see-through; so are
 * the tonsil section's covering layers.
 */

const WAVE_S = 0.9;
const SQUEEZE = 0.12;
/** Pharyngeal activity above which the swallowing drive counts as on (rest 0.3, drive 0.2 at full signal, ventilation up to 0.15 above rest). */
const ON = 0.42;
const WAVE_CENTRE: Record<ConstrictorId, number> = { superior: 0.15, middle: 0.5, inferior: 0.85 };
const WAVE_HALF_WIDTH = 0.3;

const GLASS: readonly [string, number][] = [
  ['nasopharynx', 0.14],
  ['oropharynx', 0.14],
  ['laryngopharynx', 0.14],
  ['superior_constrictor', 0.6],
  ['middle_constrictor', 0.6],
  ['inferior_constrictor', 0.6],
  ['palatine_tonsil_section', 0.1],
  ['tonsil_surface_epithelium', 0.2],
  ['tonsillar_capsule', 0.5],
  ['lymphoid_follicles', 0.5],
  ['piriform_recesses', 0.4],
  ['epiglottic_valleculae', 0.4],
  ['palatopharyngeal_arch', 0.5],
];

const AIR_COLOUR = 0xbfe3f0;
const tracker = breathTracker();
let start = -1;
let wasOn = false;
let lastTime = 0;

export const detail: OrganDetailSpec = {
  flows: () => {
    // From the top of the nasopharynx to the cricoid: positive rate is inspiration.
    const path: V3[] = [0.448, 0.42, 0.398, 0.382, 0.372].map((y) => centreAt(y));
    const specs: FlowSpec[] = [{ id: 'air', path, count: 40, size: 0.0011, color: AIR_COLOUR, speed: 0.05, spread: 0.0035 }];
    return specs;
  },

  animate: (ctx: DetailContext) => {
    for (const [id, o] of GLASS) ctx.part(id)?.setOpacity(o);
    const air = ctx.flow('air');
    air?.setRate(tracker.update(ctx));

    if (ctx.time < lastTime) {
      start = -1;
      wasOn = false;
    }
    lastTime = ctx.time;
    if (ctx.reducedMotion) return;
    const on = ctx.activity('oropharynx') > ON;
    if (on && !wasOn) start = ctx.time;
    wasOn = on;
    let f = -1;
    if (start >= 0) {
      f = (ctx.time - start) / WAVE_S;
      if (f >= 1) {
        start = -1;
        f = -1;
      }
    }
    for (const id of Object.keys(CONSTRICTORS) as ConstrictorId[]) {
      const a = f < 0 ? 0 : Math.max(0, 1 - Math.abs(f - WAVE_CENTRE[id]) / WAVE_HALF_WIDTH);
      const k = 1 - SQUEEZE * a;
      ctx.part(`${id}_constrictor`)?.setScale([k, 1, k], constrictorPivot(id));
    }
  },
};

