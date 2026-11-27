import type { OrganDetailSpec } from '../detail/types';

/**
 * ANIMATION OF THE SHOULDER AND UPPER ARM MUSCLES.
 *
 * The engine has no per-muscle state: only whole-body muscle tone (raised in rigidity, lost in
 * paralysis, which is how a neuromuscular blocker reaches a muscle), exertion, shivering and a
 * seizure, which the atlas file turns into each part's activity and the default detail turns into
 * a glow. A macroscopic muscle here therefore changes colour and glow and does NOT move: nothing
 * in the model says how far an arm has been raised, and a muscle that bulged with an invented
 * force would be a number nobody measured.
 *
 * WHAT MOVES, from those signals only:
 *
 *  - THE SARCOMERE (sliding-filament account, Guyton and Hall: filaments keep their length and
 *    slide). With activity each Z disc moves towards the M line and carries its thin filaments
 *    (actin, with troponin and tropomyosin) with it as a RIGID TRANSLATION, so their length is
 *    unchanged; the thick filaments and the A band do not move or change length; the I band and
 *    titin (Z disc to thick filament) are compressed and the H zone narrows because the thin
 *    filament tips advance. Under paralysis activity falls below rest and the discs move a little
 *    outward (relaxed). Done by moving the vertices of those parts' own meshes, because one
 *    part has one transform and the two halves must move in opposite directions.
 *  - THE NEUROMUSCULAR JUNCTION. The synaptic vesicles in the nerve terminal move towards the
 *    cleft and back at a rate that follows the junction's activity, and they stop when it falls
 *    to nothing, as it does under paralysis. A block of the receptor does not stop the vesicles
 *    in the body (the nerve still releases acetylcholine); the drawing follows the model's single
 *    "muscle activity" signal, which falls under a blocker, and says nothing finer.
 *
 * DISPLAY CONSTANTS. Every number below is a display choice, not a measurement: how far the
 * sarcomere is drawn to close, how far a vesicle travels, how fast it cycles. All motion is
 * frozen at the resting pose under reduced motion.
 *
 * GLASS. A cell, a junction and a sarcomere are drawn inside the biceps, so the biceps and the
 * envelopes of the schematics are drawn as panes; the opacities are display choices.
 */

/** The activity the atlas gives a resting muscle (its `rest`): the sarcomere is at its resting length here. A display anchor that matches the data file. */
const REST_ACTIVITY = 0.2;
/** DISPLAY CONSTANT: how far each Z disc travels towards the M line at full activity, as a fraction of the half sarcomere. A display choice, not a measured shortening. */
const SHORTEN = 0.18;
/** Half the A band, half the sarcomere and half the H zone as the parts file draws them (SARC_A, SARC_L, SARC_TIP there; keep in step). */
const SARC_A = 0.003;
const SARC_L = 0.0052;
const SARC_TIP = 0.0012;
/** How far the lengthened (relaxed, paralysed) sarcomere is drawn past rest, as a fraction of full closure. */
const RELAX_LIMIT = 0.25;
/** How far a vesicle is drawn travelling towards the cleft at full activity, metres of scene. A display choice. */
const RELEASE_TRAVEL_M = 0.0006;
/** Cycles per second of the drawn vesicle movement at full activity. A display choice. */
const RELEASE_HZ = 0.8;

type Kind = 'rigid' | 'stretch' | 'h';
const SLIDING: Record<string, Kind> = { z_discs: 'rigid', thin_filaments: 'rigid', troponin: 'rigid', tropomyosin: 'rigid', i_band: 'stretch', titin: 'stretch', h_zone: 'h' };

/** New height (relative to the sarcomere centre) of a vertex at height y when each Z disc has moved in by d. Pure; the probe uses it. */
export function slideY(kind: Kind, y: number, d: number): number {
  const a = Math.abs(y);
  const sgn = y < 0 ? -1 : 1;
  if (kind === 'rigid') return y - sgn * d;
  if (kind === 'h') return (y * (SARC_TIP - d)) / SARC_TIP;
  return a <= SARC_A ? y : sgn * (SARC_A + ((a - SARC_A) * (SARC_L - d - SARC_A)) / (SARC_L - SARC_A));
}
const originals = new WeakMap<object, { y: Float32Array; yc: number; d: number }>();

/** Opacities of the panes, so that what lies inside them can be seen. Display choices. */
const PANES: Record<string, number> = {
  biceps_brachii: 0.3,
  muscle_fascicle: 0.85,
  epimysium: 0.22,
  perimysium: 0.3,
  endomysium: 0.4,
  muscle_fibre: 0.3,
  sarcolemma: 0.22,
  sarcomere: 0.2,
  i_band: 0.45,
  a_band: 0.4,
  h_zone: 0.55,
  neuromuscular_junction: 0.2,
  motor_axon_terminal: 0.6,
  synaptic_cleft: 0.45,
  motor_end_plate: 0.6,
  terminal_schwann_cell: 0.4,
  muscle_spindle: 0.5,
  golgi_tendon_organ: 0.5,
  rotator_cuff: 0.45,
};

let releasePhase = 0;

export const detail: OrganDetailSpec = {
  animate: (ctx) => {
    for (const [id, opacity] of Object.entries(PANES)) ctx.part(id)?.setOpacity(opacity);

    const still = ctx.reducedMotion;

    // The sarcomere: filaments slide with its own activity.
    const act = ctx.activity('sarcomere');
    const c = still ? 0 : Math.max(-RELAX_LIMIT, Math.min(1, (act - REST_ACTIVITY) / (1 - REST_ACTIVITY)));
    const d = SHORTEN * SARC_L * c;
    for (const [id, kind] of Object.entries(SLIDING)) {
      const pos = ctx.part(id)?.mesh.geometry.getAttribute('position');
      if (!pos) continue;
      let o = originals.get(pos);
      if (!o) {
        const ys = new Float32Array(pos.count);
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < pos.count; i++) {
          ys[i] = pos.getY(i);
          lo = Math.min(lo, ys[i]);
          hi = Math.max(hi, ys[i]);
        }
        o = { y: ys, yc: (lo + hi) / 2, d: NaN };
        originals.set(pos, o);
      }
      if (o.d === d) continue;
      o.d = d;
      for (let i = 0; i < pos.count; i++) pos.setY(i, o.yc + slideY(kind, o.y[i] - o.yc, d));
      pos.needsUpdate = true;
    }

    // The junction: vesicles shuttle to the cleft face at a rate that follows its activity, and stop when it is gone.
    const junction = ctx.activity('neuromuscular_junction');
    if (!still) releasePhase = (releasePhase + ctx.dt * RELEASE_HZ * junction) % 1;
    const amplitude = still ? 0 : Math.min(1, junction * 3);
    const travel = 0.5 * (1 - Math.cos(releasePhase * Math.PI * 2));
    ctx.part('synaptic_vesicles')?.setOffset([0, 0, -RELEASE_TRAVEL_M * amplitude * travel]);
  },
};
