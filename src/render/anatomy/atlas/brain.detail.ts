import type { DetailContext, FlowSpec, OrganDetailSpec } from '../detail/types';
import type { V3 } from '../sdf';

/**
 * THE NEURONS FLOWING.
 *
 * Each stream is a train of small bright particles running along one of the major tracts
 * of the brain. The streams carry no signal of their own: how many particles are drawn
 * and how fast they run is set every frame from the activity index of the parts the tract
 * joins (the same index that makes a part glow), and the cortical streams are gated
 * further by the engine's consciousness so that they thin out and stop as it is lost.
 * A particle is a picture of "traffic on this tract", not of a single impulse, and the
 * speed is a display speed, not a conduction velocity.
 *
 * Tracts that cross the midline (thalamocortical relays, callosal fibres, the
 * pontocerebellar fibres) are single paths that run out from one hemisphere, across, and
 * into the other, because a flow is one polyline and cannot branch. Paths are authored
 * by eye in the brain's frame (+x the patient's right, +y up, +z forward) to run through
 * the parts drawn in brain.parts.ts; they are illustrative, not a traced connectome.
 *
 * Nothing here writes to the simulation.
 */

const CYAN = 0x6fe3ff;
const PALE = 0xd4f7ff;
const WARM_WHITE = 0xfff3b0;
const GOLD = 0xffbf3a;

const mirror = (pts: readonly V3[], s: number): V3[] => pts.map((p): V3 => [s * p[0], p[1], p[2]]);

/** Out along the right half-path, across the midline, and back out along the left. */
const crossing = (half: readonly V3[]): V3[] => [...half, ...mirror(half, -1).reverse()];

/** Half-paths on the right side, cortex first, ending at the midline structure they relay through. */
const CORTICOSPINAL: V3[] = [
  [0.032, 0.048, 0.01],
  [0.027, 0.032, 0.006],
  [0.021, 0.012, 0.003],
  [0.018, -0.004, -0.002],
  [0.0095, -0.024, -0.0075],
  [0.0065, -0.044, -0.0005],
  [0.0045, -0.06, -0.0165],
  [0.003, -0.084, -0.0225],
];
const SPINOTHALAMIC: V3[] = [
  [0.004, -0.075, -0.02],
  [0.007, -0.052, -0.012],
  [0.008, -0.03, -0.016],
  [0.013, -0.002, -0.012],
  [0.022, 0.02, -0.01],
  [0.03, 0.038, -0.01],
  [0.036, 0.048, -0.011],
];
const RELAY_FRONTAL: V3[] = [
  [0.028, 0.034, 0.056],
  [0.022, 0.022, 0.04],
  [0.015, 0.008, 0.02],
  [0.008, 0.001, -0.004],
];
const RELAY_PARIETAL: V3[] = [
  [0.036, 0.044, -0.03],
  [0.026, 0.024, -0.024],
  [0.014, 0.008, -0.016],
  [0.008, 0.002, -0.01],
];
const RELAY_TEMPORAL: V3[] = [
  [0.057, -0.028, 0.014],
  [0.042, -0.018, 0.004],
  [0.026, -0.008, -0.002],
  [0.011, -0.004, -0.006],
];
const RELAY_OCCIPITAL: V3[] = [
  [0.03, 0.012, -0.071],
  [0.024, 0.008, -0.052],
  [0.016, 0.004, -0.032],
  [0.01, 0.001, -0.016],
];
const CALLOSAL_ANTERIOR: V3[] = [
  [0.034, 0.032, 0.048],
  [0.022, 0.024, 0.04],
  [0.01, 0.014, 0.034],
  [0.003, 0.012, 0.0335],
];
const CALLOSAL_BODY: V3[] = [
  [0.036, 0.046, 0.002],
  [0.024, 0.032, 0.001],
  [0.012, 0.0215, 0.0],
  [0.003, 0.0178, 0.0],
];
const CALLOSAL_POSTERIOR: V3[] = [
  [0.034, 0.036, -0.036],
  [0.022, 0.026, -0.034],
  [0.01, 0.014, -0.034],
  [0.003, 0.0095, -0.0335],
];
const MESOLIMBIC: V3[] = [
  [0.004, -0.026, -0.01],
  [0.007, -0.016, 0.0],
  [0.009, -0.004, 0.012],
  [0.0115, 0.007, 0.026],
  [0.016, 0.016, 0.04],
  [0.022, 0.028, 0.056],
];
const AMYGDALA_HYPOTHALAMUS: V3[] = [
  [0.03, -0.026, 0.027],
  [0.024, -0.02, 0.022],
  [0.015, -0.014, 0.014],
  [0.0075, -0.0115, 0.006],
];
const FORNIX: V3[] = [
  [0.021, 0.008, -0.029],
  [0.017, 0.0105, -0.022],
  [0.012, 0.0105, -0.012],
  [0.006, 0.01, 0.004],
  [0.0045, 0.002, 0.008],
  [0.0045, -0.007, 0.006],
];
const PONTOCEREBELLAR: V3[] = [
  [0.03, -0.046, -0.052],
  [0.024, -0.046, -0.036],
  [0.014, -0.047, -0.018],
  [0.004, -0.0475, -0.004],
];
const RETICULAR: V3[] = [
  [0.0, -0.062, -0.02],
  [0.002, -0.045, -0.012],
  [0.003, -0.03, -0.012],
  [0.003, -0.012, -0.008],
  [0.0, -0.001, -0.004],
];
const STALK: V3[] = [
  [0, -0.0125, 0.005],
  [0, -0.0165, 0.0075],
  [0, -0.0215, 0.009],
  [0, -0.0255, 0.0095],
];

/**
 * One row per stream: which parts it joins (its density and rate follow the mean of their
 * activity), and whether it is a cortical tract (gated by consciousness). The array is
 * built once and only read per frame, so the animate loop allocates nothing.
 */
interface Stream {
  id: string;
  a: string;
  b: string;
  cortical: boolean;
}

const STREAMS: Stream[] = [
  { id: 'corticospinal_r', a: 'motor_cortex', b: 'medulla', cortical: true },
  { id: 'corticospinal_l', a: 'motor_cortex', b: 'medulla', cortical: true },
  { id: 'thalamocortical_frontal', a: 'thalamus', b: 'prefrontal_cortex', cortical: true },
  { id: 'thalamocortical_parietal', a: 'thalamus', b: 'parietal_lobe', cortical: true },
  { id: 'thalamocortical_temporal', a: 'thalamus', b: 'temporal_lobe', cortical: true },
  { id: 'thalamocortical_occipital', a: 'thalamus', b: 'occipital_lobe', cortical: true },
  { id: 'callosal_anterior', a: 'corpus_callosum', b: 'prefrontal_cortex', cortical: true },
  { id: 'callosal_body', a: 'corpus_callosum', b: 'motor_cortex', cortical: true },
  { id: 'callosal_posterior', a: 'corpus_callosum', b: 'parietal_lobe', cortical: true },
  { id: 'spinothalamic_r', a: 'medulla', b: 'somatosensory_cortex', cortical: true },
  { id: 'spinothalamic_l', a: 'medulla', b: 'somatosensory_cortex', cortical: true },
  { id: 'mesolimbic_r', a: 'midbrain', b: 'nucleus_accumbens', cortical: false },
  { id: 'mesolimbic_l', a: 'midbrain', b: 'nucleus_accumbens', cortical: false },
  { id: 'limbic_r', a: 'amygdala', b: 'hypothalamus', cortical: false },
  { id: 'limbic_l', a: 'amygdala', b: 'hypothalamus', cortical: false },
  { id: 'fornix_r', a: 'hippocampus', b: 'hypothalamus', cortical: false },
  { id: 'fornix_l', a: 'hippocampus', b: 'hypothalamus', cortical: false },
  { id: 'pontocerebellar', a: 'pons', b: 'cerebellum', cortical: false },
  { id: 'reticular', a: 'pons', b: 'thalamus', cortical: false },
  { id: 'hypothalamo_pituitary', a: 'hypothalamus', b: 'pituitary', cortical: false },
];

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (lo: number, hi: number, v: number): number => {
  const t = clamp01((v - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
};

/**
 * THE CORTEX IS DRAWN AS GLASS. The six lobes of the outer cortex wrap everything else in
 * the brain, and drawn solid they hid all of it: the thalamus, the hypothalamus and
 * pituitary, the hippocampus and amygdala, the basal ganglia, and every stream in this
 * file. So each lobe is a tinted pane whose opacity rises with its own activity: a resting
 * lobe is a faint wash of its colour over the deep structures, and a lobe that is busy (the
 * motor strip in exercise, the temporal lobe in a seizure) fills in and reads as lit. The
 * insula and the cingulate cortex are cortex too, but they are folded inside and hide
 * nothing, so they stay solid. The two numbers are drawing choices, not physiology.
 */
const GLASS_LOBES = [
  'prefrontal_cortex',
  'motor_cortex',
  'somatosensory_cortex',
  'parietal_lobe',
  'temporal_lobe',
  'occipital_lobe',
] as const;
const LOBE_OPACITY_QUIET = 0.08;
const LOBE_OPACITY_GAIN = 0.4;

/**
 * WALLS AND LUMENS, DRAWN AS GLASS (added with the finer structures). A cavity, a membrane or a vessel
 * that is drawn solid hides what lies inside or behind it, so these are panes: the ventricles (a
 * cavity), the three meninges (membranes round everything), the venous sinuses and the arteries
 * (lumens, so that the circle can be seen against the brainstem), and the three parts of the
 * brainstem, which would otherwise hide every nucleus and the reticular formation inside them. The
 * numbers are drawing choices, not physiology. The brainstem rises a little with its activity, like
 * the cortical lobes above.
 */
const GLASS_FIXED: readonly (readonly [string, number])[] = [
  ['ventricles', 0.3],
  ['lateral_ventricles', 0.34],
  ['third_ventricle', 0.34],
  ['fourth_ventricle', 0.34],
  ['cerebral_aqueduct', 0.34],
  ['interventricular_foramina', 0.34],
  ['meninges', 0.07],
  ['dura_mater', 0.1],
  ['arachnoid_mater', 0.08],
  ['pia_mater', 0.12],
  ['dural_venous_sinuses', 0.3],
  ['superior_sagittal_sinus', 0.5],
  ['inferior_sagittal_sinus', 0.5],
  ['straight_sinus', 0.5],
  ['transverse_sinuses', 0.5],
  ['sigmoid_sinuses', 0.5],
  ['cavernous_sinuses', 0.5],
  ['cerebral_arterial_circle', 0.3],
  ['internal_carotid_artery', 0.7],
  ['vertebral_arteries', 0.7],
  ['basilar_artery', 0.7],
  ['anterior_cerebral_arteries', 0.7],
  ['middle_cerebral_arteries', 0.7],
  ['posterior_cerebral_arteries', 0.7],
  ['communicating_arteries', 0.7],
];
const BRAINSTEM_GLASS = ['midbrain', 'pons', 'medulla'] as const;
const BRAINSTEM_OPACITY_QUIET = 0.14;
const BRAINSTEM_OPACITY_GAIN = 0.3;

function animate(ctx: DetailContext): void {
  for (let i = 0; i < GLASS_FIXED.length; i++) ctx.part(GLASS_FIXED[i][0])?.setOpacity(GLASS_FIXED[i][1]);
  for (let i = 0; i < BRAINSTEM_GLASS.length; i++) {
    const id = BRAINSTEM_GLASS[i];
    ctx.part(id)?.setOpacity(BRAINSTEM_OPACITY_QUIET + BRAINSTEM_OPACITY_GAIN * clamp01(ctx.activity(id)));
  }
  for (let i = 0; i < GLASS_LOBES.length; i++) {
    const id = GLASS_LOBES[i];
    ctx.part(id)?.setOpacity(LOBE_OPACITY_QUIET + LOBE_OPACITY_GAIN * clamp01(ctx.activity(id)));
  }

  // Consciousness gates the cortical streams: they are untouched while it is high and thin
  // out to nothing as it nears zero, so an anaesthetised or fainting brain visibly empties.
  const cons = ctx.lerp((s) => s.neuro.consciousness);
  const gate = smoothstep(0.05, 0.6, cons);
  for (let i = 0; i < STREAMS.length; i++) {
    const st = STREAMS[i];
    const f = ctx.flow(st.id);
    if (!f) continue;
    const mean = 0.5 * (ctx.activity(st.a) + ctx.activity(st.b));
    // Nearly empty when both ends are quiet, full when they are busy.
    const density = clamp01((mean - 0.08) * 1.8) * (st.cortical ? gate : 1);
    f.setDensity(density);
    // Reduced motion holds the particles still; the density (a colour-like quantity) stays live.
    f.setRate(ctx.reducedMotion ? 0 : 0.4 + 1.1 * mean);
  }
}

export const detail: OrganDetailSpec = {
  flows: (): FlowSpec[] => {
    const f = (id: string, path: V3[], count: number, color: number, speed = 0.05, spread = 0.0015): FlowSpec => ({
      id,
      path,
      count,
      size: 0.0012,
      color,
      speed,
      spread,
    });
    return [
      f('corticospinal_r', CORTICOSPINAL, 40, CYAN),
      f('corticospinal_l', mirror(CORTICOSPINAL, -1), 40, CYAN),
      f('thalamocortical_frontal', crossing(RELAY_FRONTAL), 50, PALE),
      f('thalamocortical_parietal', crossing(RELAY_PARIETAL), 40, PALE),
      f('thalamocortical_temporal', crossing(RELAY_TEMPORAL), 40, PALE),
      f('thalamocortical_occipital', crossing(RELAY_OCCIPITAL), 40, PALE),
      f('callosal_anterior', crossing(CALLOSAL_ANTERIOR), 30, WARM_WHITE),
      // The body runs the other way (left to right) so the callosum carries traffic both ways.
      f('callosal_body', mirror(CALLOSAL_BODY, -1).concat(mirror(CALLOSAL_BODY, 1).reverse()), 30, WARM_WHITE),
      f('callosal_posterior', crossing(CALLOSAL_POSTERIOR), 30, WARM_WHITE),
      f('spinothalamic_r', SPINOTHALAMIC, 36, CYAN),
      f('spinothalamic_l', mirror(SPINOTHALAMIC, -1), 36, CYAN),
      f('mesolimbic_r', MESOLIMBIC, 30, GOLD, 0.04),
      f('mesolimbic_l', mirror(MESOLIMBIC, -1), 30, GOLD, 0.04),
      f('limbic_r', AMYGDALA_HYPOTHALAMUS, 24, WARM_WHITE, 0.04, 0.001),
      f('limbic_l', mirror(AMYGDALA_HYPOTHALAMUS, -1), 24, WARM_WHITE, 0.04, 0.001),
      f('fornix_r', FORNIX, 24, PALE, 0.04, 0.001),
      f('fornix_l', mirror(FORNIX, -1), 24, PALE, 0.04, 0.001),
      f('pontocerebellar', crossing(PONTOCEREBELLAR), 40, CYAN),
      f('reticular', RETICULAR, 24, WARM_WHITE, 0.04, 0.003),
      f('hypothalamo_pituitary', STALK, 20, WARM_WHITE, 0.02, 0.0006),
    ];
  },
  animate,
};
