import type { OrganDetailSpec, FlowSpec } from '../detail/types';
import type { V3 } from '../sdf';
import { breathTracker } from './lungShared';

/**
 * STREAMS AND ANIMATION OF THE NASAL CAVITY.
 *
 * AIRFLOW. One stream a side runs from the nostril through the vestibule and the common
 * meatus between the conchae to the choana. Its direction and speed come from the change in
 * lung inflation, exactly as the trachea's air does (breathTracker in lungShared.ts): in on
 * inspiration, back out on expiration, still in apnoea and under reduced motion. The model
 * has no nasal resistance, so congestion does NOT slow the stream; the histamine and
 * inflammation drives only brighten the lining. Drawing a slower stream for a blocked nose
 * would show a mechanism the engine does not have.
 *
 * MUCOCILIARY CLEARANCE. A slow stream of mucus runs back along the floor of each side to
 * the choana and the nasopharynx, and the cilia of the cluster sweep to and fro in time.
 * Both are DISPLAY rhythms at constant rate: clearance is not simulated, no signal changes
 * it, and nothing here says it should. They are held still under reduced motion, as the
 * tracheal escalator is. The sweep amplitude and frequency are display constants, not a
 * measured beat.
 *
 * GLASS. Parts that wrap or contain something are drawn as glass so the contents read:
 * the lining, the septum plate, the meatuses and the sinuses. The values are display choices.
 */

const GLASS: Readonly<Record<string, number>> = {
  respiratory_mucosa: 0.07,
  nasal_septum: 0.2,
  turbinates: 0.08,
  nasal_vestibule: 0.18,
  superior_meatus: 0.25,
  middle_meatus: 0.25,
  inferior_meatus: 0.25,
  sphenoethmoidal_recess: 0.3,
  frontal_sinuses: 0.22,
  ethmoidal_cells: 0.3,
  maxillary_sinuses: 0.2,
  sphenoidal_sinus: 0.25,
  olfactory_region: 0.15,
  olfactory_epithelium: 0.3,
  ciliated_epithelium: 0.6,
  swell_bodies: 0.55,
  nasolacrimal_opening: 0.6,
};

const tracker = breathTracker();
const SWEEP: [number, number, number] = [0, 0, 0];
/** Display constants for the cilia sweep: a picture of a beating tuft, not a measured beat. */
const CILIA_SWEEP_M = 0.0003;
const CILIA_RAD_PER_S = 9;

const side = (s: number, pts: readonly V3[]): V3[] => pts.map((p) => [s * p[0], p[1], p[2]]);
const AIR_PATH: readonly V3[] = [[0.0085, -0.011, 0.0345], [0.0095, -0.007, 0.022], [0.0105, -0.003, 0.008], [0.0095, -0.002, -0.012], [0.0085, -0.002, -0.029]];
const MUCUS_PATH: readonly V3[] = [[0.0085, -0.0125, 0.024], [0.0085, -0.0172, 0.0], [0.0085, -0.0145, -0.024]];

export const detail: OrganDetailSpec = {
  flows: (): FlowSpec[] => [
    { id: 'air_r', path: side(1, AIR_PATH), count: 22, size: 0.0007, color: 0xbfe3f0, speed: 0.08, spread: 0.0018 },
    { id: 'air_l', path: side(-1, AIR_PATH), count: 22, size: 0.0007, color: 0xbfe3f0, speed: 0.08, spread: 0.0018 },
    { id: 'mucus_r', path: side(1, MUCUS_PATH), count: 14, size: 0.0006, color: 0xe8dca0, speed: 0.012, spread: 0.0015 },
    { id: 'mucus_l', path: side(-1, MUCUS_PATH), count: 14, size: 0.0006, color: 0xe8dca0, speed: 0.012, spread: 0.0015 },
  ],
  animate: (ctx) => {
    const rate = tracker.update(ctx);
    ctx.flow('air_r')?.setRate(rate);
    ctx.flow('air_l')?.setRate(rate);
    const clear = ctx.reducedMotion ? 0 : 1;
    ctx.flow('mucus_r')?.setRate(clear);
    ctx.flow('mucus_l')?.setRate(clear);
    for (const id of Object.keys(GLASS)) ctx.part(id)?.setOpacity(GLASS[id]);
    if (!ctx.reducedMotion) {
      // Toward the choana is -z, the power stroke.
      SWEEP[2] = -CILIA_SWEEP_M * (0.5 + 0.5 * Math.sin(ctx.time * CILIA_RAD_PER_S));
      ctx.part('cilia')?.setOffset(SWEEP);
    }
  },
};
