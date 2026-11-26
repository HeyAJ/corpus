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
 *  - THE SARCOMERE. Its filaments slide as the sarcomere's own activity rises: the Z discs, the
 *    I band, the thin filaments (with the troponin and tropomyosin that ride on them) and titin
 *    close in towards the middle along the muscle's axis, so the overlap of thin and thick
 *    filaments grows, the I band narrows and the H zone closes; the A band and the thick
 *    filaments stay put, as in the sliding-filament account. Under paralysis the activity falls
 *    below rest and the filaments lie a little further apart than at rest (relaxed). A DISPLAY
 *    SIMPLIFICATION, stated plainly: the drawn thin filaments are scaled along the axis, so they
 *    look a little shorter when the sarcomere shortens, whereas a real thin filament keeps its
 *    length and only slides.
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
/** Fraction of its length the drawn sarcomere closes by at full activity. A display choice. */
const SHORTEN = 0.22;
/** How far the lengthened (relaxed, paralysed) sarcomere is drawn past rest, as a fraction of full closure. */
const RELAX_LIMIT = 0.25;
/** How far a vesicle is drawn travelling towards the cleft at full activity, metres of scene. A display choice. */
const RELEASE_TRAVEL_M = 0.0006;
/** Cycles per second of the drawn vesicle movement at full activity. A display choice. */
const RELEASE_HZ = 0.8;

const SLIDING = ['z_discs', 'i_band', 'thin_filaments', 'titin'];

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
    const along = 1 - SHORTEN * c;
    for (const id of SLIDING) ctx.part(id)?.setScale([1, along, 1]);
    ctx.part('h_zone')?.setScale([1, Math.max(0.1, 1 - 0.9 * c), 1]);

    // The junction: vesicles shuttle to the cleft face at a rate that follows its activity, and stop when it is gone.
    const junction = ctx.activity('neuromuscular_junction');
    if (!still) releasePhase = (releasePhase + ctx.dt * RELEASE_HZ * junction) % 1;
    const amplitude = still ? 0 : Math.min(1, junction * 3);
    const travel = 0.5 * (1 - Math.cos(releasePhase * Math.PI * 2));
    ctx.part('synaptic_vesicles')?.setOffset([0, 0, -RELEASE_TRAVEL_M * amplitude * travel]);
  },
};
