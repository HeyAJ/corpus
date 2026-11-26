import * as THREE from 'three';
import type { DetailContext, FlowSpec, OrganDetailSpec } from '../detail/types';
import { HEART_PATHS, HEART_STREAMS, HIS_STRANDS } from './heart.parts';
import type { V3 } from '../sdf';
import type { SimSnapshot } from '../../../bridge/types';
import { DEOXYGENATED, OXYGENATED, bloodColour } from '../detail/blood';

/**
 * THE HEART'S INTERIOR IN MOTION.
 *
 * Everything that moves here is read from the snapshot through `ctx.lerp`, so the picture
 * is the engine's own cardiac cycle and not an animation laid over it:
 *
 *   - `cardio.cyclePhase` runs 0..1 over one beat and 0 is the ONSET OF VENTRICULAR SYSTOLE;
 *   - `cardio.activation` is the ventricular elastance activation, high in systole and about
 *     0 in diastole, and is how this file decides which half of the cycle it is in;
 *   - `cardio.{lv,rv,la,ra}Volume_mL` are the live chamber volumes: the cavities swell and
 *     shrink with exactly the filling and ejection the engine computes;
 *   - `transport.aorticFlow_mL_per_s` gates the aortic valve and sets the ejection rate;
 *   - `transport.arterialSat` / `venousSat` set the colour of the left and right heart
 *     (through the one ramp every interior shares, ../detail/blood.ts).
 *
 * THE CIRCULATION, IN ORDER. Blood enters the right atrium from the venae cavae, passes
 * the tricuspid valve into the right ventricle, leaves through the pulmonary valve up the
 * pulmonary trunk (all venous colour); returns from the lungs through the four pulmonary
 * veins into the left atrium, passes the mitral valve into the left ventricle and leaves
 * through the aortic valve into the ascending aorta (all arterial colour). The two
 * coronary arteries, which leave the aortic root, run beside them. Each stream's centreline
 * is the one heart.parts.ts exports and passes through the real orifice it names.
 *
 * GATING. A closed valve holds blood back: the atrioventricular streams run in diastole
 * only (rate 0 in systole, and their particle window is cut at the valve so the blood
 * visibly waits on the atrial side), the outflow streams in systole only. Venous return
 * and pulmonary-vein return go on all the time and run a little faster while the
 * ventricle is contracting, because that is when the atria fill (GH14 ch. 9). The left
 * coronary stream is mostly diastolic: ventricular contraction squeezes its vessels shut
 * (GH14 ch. 21). A heart that is not pumping (ventricular fibrillation, asystole, PEA)
 * moves no blood, so every stream stops.
 *
 * REFERENCE SIZES. The volumes 85, 90, 50 and 52 mL (LV, RV, LA, RA) are the SHAPES'
 * reference sizes for the drawing: the cavity is drawn at its authored size when the engine
 * reports that volume. They are not physiological constants and are used nowhere else.
 *
 * THE DISPLAY TIMINGS (0.2 s SA lead, 0.08 s AV pause, 0.1 s sweep) are drawing choices that
 * keep the order of events legible; the order itself (sinoatrial node, atria, AV node,
 * His-Purkinje, ventricles) is textbook (GH14 ch. 10). The 0.2 s lead is the figure the
 * task brief gives for the SA node firing ahead of ventricular systole.
 *
 * WHEN TO STOP ANIMATING. Under `reducedMotion` nothing pulses: chambers stay at scale 1,
 * valves rest half open, no impulse flashes; streams carry on at a steady rate while the
 * heart is pumping, colours stay live. Above a time scale of about 8 a beat lasts a few
 * frames and drawing it honestly is impossible (it would strobe), so the walls and valves
 * are held still and the streams run at a steady capped rate in the same way.
 */

const IMPULSE = 0xfff1a0;

/** Authored reference sizes for the drawing, NOT physiological constants. */
const REF_LV = 85;
const REF_RV = 90;
const REF_LA = 50;
const REF_RA = 52;

/** Time scale above which the beat is too fast to draw. */
const TIME_SCALE_STILL = 8;

const SYSTOLE_ON = 0.08;
const SYSTOLE_FULL = 0.16;
const SA_LEAD_S = 0.2;
const SA_FLASH_S = 0.05;
const AV_START_S = 0.08;
const SWEEP_S = 0.1;
const KICK_S = 0.12;
const REST_CO = 5;
/** Authored particle counts represent a little more than resting output; density rescales. */
const DENSITY_AT_REST = 0.7;

const tmp = new THREE.Color();
const scratchRight = new THREE.Color();
const scratchLeft = new THREE.Color();

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function smooth(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function joined(a: V3[], b: V3[]): V3[] {
  return [...a, ...b.slice(1)];
}

/** Chamber id, its live volume, its drawing reference size, and whether it is on the right (venous) side. */
const CHAMBERS: readonly (readonly [string, (s: SimSnapshot) => number, number, boolean])[] = [
  ['right_atrium', (s) => s.cardio.raVolume_mL, REF_RA, true],
  ['right_ventricle', (s) => s.cardio.rvVolume_mL, REF_RV, true],
  ['left_atrium', (s) => s.cardio.laVolume_mL, REF_LA, false],
  ['left_ventricle', (s) => s.cardio.lvVolume_mL, REF_LV, false],
];

const IMPULSE_FLOWS = ['impulse_his', 'impulse_lbb', 'impulse_lbb2', 'impulse_rbb'] as const;

const FLOW_COLOURS = { venous: DEOXYGENATED, arterial: OXYGENATED };

/**
 * THE CHAMBERS AND THE GREAT VESSELS ARE DRAWN AS GLASS. Each of them is a container of
 * blood, and the blood is the point: drawn solid, a ventricle was an opaque lump and every
 * stream inside it was hidden behind its own wall. So the four chambers, the venae cavae,
 * the pulmonary trunk and veins, the aorta and the coronary arteries are tinted panes (see
 * `setOpacity` in ../detail/types.ts) through which the particles show. A ventricle's pane
 * thickens a little as it contracts, which is also what its wall does. The septum, the
 * valves and the conducting system stay solid: they are the hard parts, and nothing is
 * inside them. These numbers are drawing choices: high enough that the venous (dusky) and
 * arterial (red) sides of the heart are plainly different colours, which they were not at
 * half these values, and the streams are drawn on top of glass whatever its opacity.
 */
const CHAMBER_GLASS = 0.42;
const CHAMBER_GLASS_SYSTOLE = 0.2;
const VESSEL_GLASS = 0.5;
const CORONARY_GLASS = 0.8;
const VESSELS = ['venae_cavae', 'pulmonary_trunk', 'pulmonary_veins', 'aorta'] as const;

/**
 * THE FINER STRUCTURES (level-2 parts, see ../detail/reveal.ts). A child rides its parent's pose
 * on its own (OrganDetail), so the papillary muscles swell with the ventricle and the cusps fold
 * with the valve; what each module still says is what is particular to the heart:
 *   - the cusps fade and shrink with their valve (opacity is not inherited);
 *   - the coronary arteries are the arterial colour and the coronary sinus, a vein, the venous one;
 *   - the layers of the pericardium are drawn as glass, the faintest outermost, so a heart seen
 *     through its sac is still a heart. These opacities are drawing choices.
 * The three children of the conduction system flash with the impulse like their parent.
 */
const VALVE_CUSPS: Readonly<Record<string, readonly string[]>> = {
  tricuspid_valve: ['anterior_tricuspid_cusp', 'posterior_tricuspid_cusp', 'septal_tricuspid_cusp'],
  mitral_valve: ['anterior_mitral_cusp', 'posterior_mitral_cusp'],
  pulmonary_valve: ['anterior_pulmonary_cusp', 'left_pulmonary_cusp', 'right_pulmonary_cusp'],
  aortic_valve: ['right_aortic_cusp', 'left_aortic_cusp', 'non_coronary_cusp'],
};
const CORONARY_ARTERIES = [
  'left_main_coronary',
  'left_anterior_descending',
  'circumflex_artery',
  'right_coronary_artery',
  'posterior_descending_artery',
] as const;
const PERICARDIUM_GLASS: Readonly<Record<string, number>> = {
  pericardium: 0.05,
  fibrous_pericardium: 0.12,
  parietal_pericardium: 0.1,
  epicardium: 0.16,
};
const CONDUCTION_CHILDREN = ['bundle_of_his', 'left_bundle_branch', 'right_bundle_branch', 'purkinje_fibres'] as const;

export const detail: OrganDetailSpec = {
  flows: (): FlowSpec[] => {
    const flows: FlowSpec[] = [
      { id: 'svc_in', path: HEART_STREAMS.svcIn, count: 46, size: 0.0016, color: FLOW_COLOURS.venous, speed: 0.07, spread: 0.0025 },
      { id: 'ivc_in', path: HEART_STREAMS.ivcIn, count: 38, size: 0.0016, color: FLOW_COLOURS.venous, speed: 0.07, spread: 0.0028 },
      { id: 'ra_to_rv', path: HEART_STREAMS.raToRv, count: 70, size: 0.0017, color: FLOW_COLOURS.venous, speed: 0.1, spread: 0.0035 },
      { id: 'rv_to_pulm', path: HEART_STREAMS.rvToPulm, count: 80, size: 0.0017, color: FLOW_COLOURS.venous, speed: 0.16, spread: 0.0035 },
      { id: 'la_to_lv', path: HEART_STREAMS.laToLv, count: 70, size: 0.0017, color: FLOW_COLOURS.arterial, speed: 0.1, spread: 0.0032 },
      { id: 'lv_to_aorta', path: HEART_STREAMS.lvToAorta, count: 90, size: 0.0017, color: FLOW_COLOURS.arterial, speed: 0.2, spread: 0.0035 },
      { id: 'coronary_lad', path: joined(HEART_PATHS.leftMain, HEART_PATHS.lad), count: 30, size: 0.0011, color: FLOW_COLOURS.arterial, speed: 0.05 },
      { id: 'coronary_cx', path: joined(HEART_PATHS.leftMain, HEART_PATHS.circumflex), count: 26, size: 0.0011, color: FLOW_COLOURS.arterial, speed: 0.05 },
      { id: 'coronary_rca', path: HEART_PATHS.rca, count: 28, size: 0.0011, color: FLOW_COLOURS.arterial, speed: 0.05 },
      // The electrical impulse: bright particles that are only drawn inside a travelling window.
      { id: 'impulse_his', path: HIS_STRANDS[0], count: 24, size: 0.0014, color: 0xfff1a0, speed: 0.12 },
      { id: 'impulse_lbb', path: joined(HIS_STRANDS[1], HIS_STRANDS[2]), count: 40, size: 0.0012, color: 0xfff1a0, speed: 0.12 },
      { id: 'impulse_lbb2', path: joined(HIS_STRANDS[1], HIS_STRANDS[3]), count: 40, size: 0.0012, color: 0xfff1a0, speed: 0.12 },
      { id: 'impulse_rbb', path: joined(HIS_STRANDS[5], HIS_STRANDS[6]), count: 40, size: 0.0012, color: 0xfff1a0, speed: 0.12 },
    ];
    HEART_PATHS.pulmonaryVeins.forEach((p, i) => {
      flows.push({ id: `pv_in_${i}`, path: p, count: 22, size: 0.0015, color: FLOW_COLOURS.arterial, speed: 0.06, spread: 0.002 });
    });
    return flows;
  },

  animate: (ctx: DetailContext): void => {
    const rhythm = ctx.snapshot.cardio.rhythm;
    const hr = ctx.lerp((s) => s.cardio.heartRate_bpm);
    const act = ctx.lerp((s) => s.cardio.activation);
    const phase = ctx.lerp((s) => s.cardio.cyclePhase);
    const aorticFlow = ctx.lerp((s) => s.transport.aorticFlow_mL_per_s);
    const co = ctx.lerp((s) => s.cardio.cardiacOutput_L_per_min);
    const satArt = ctx.lerp((s) => s.transport.arterialSat);
    const satVen = ctx.lerp((s) => s.transport.venousSat);

    const pumping = hr > 0 && rhythm !== 'vfib' && rhythm !== 'asystole' && rhythm !== 'pea';
    const still = ctx.reducedMotion || ctx.snapshot.timeScale > TIME_SCALE_STILL;

    bloodColour(scratchRight, satVen);
    bloodColour(scratchLeft, satArt);

    /* ---------------------------------------------------------------- chambers */
    for (const [id, pick, ref, right] of CHAMBERS) {
      const part = ctx.part(id);
      if (!part) continue;
      part.setColor(right ? scratchRight : scratchLeft);
      const vol = ctx.lerp(pick);
      // Cube root: volume scales with the cube of linear size.
      part.setScale(still ? 1 : clamp(Math.cbrt(Math.max(vol, 0) / ref), 0.6, 1.25));
      const ventricle = id === 'right_ventricle' || id === 'left_ventricle';
      part.setOpacity(CHAMBER_GLASS + (ventricle && !still ? CHAMBER_GLASS_SYSTOLE * act : 0));
      if (!still && ventricle) {
        // A brief systolic brightening so the beat reads even at a glance.
        part.setGlow(Math.min(1, ctx.activity(id) + 0.45 * act));
      }
    }
    ctx.part('venae_cavae')?.setColor(scratchRight);
    ctx.part('pulmonary_trunk')?.setColor(scratchRight);
    ctx.part('pulmonary_veins')?.setColor(scratchLeft);
    ctx.part('aorta')?.setColor(scratchLeft);
    for (const id of VESSELS) ctx.part(id)?.setOpacity(VESSEL_GLASS);
    const coronaries = ctx.part('coronary_arteries');
    coronaries?.setColor(scratchLeft);
    coronaries?.setOpacity(CORONARY_GLASS);
    for (const id of CORONARY_ARTERIES) {
      const a = ctx.part(id);
      a?.setColor(scratchLeft);
      a?.setOpacity(CORONARY_GLASS);
    }
    const sinus = ctx.part('coronary_sinus');
    sinus?.setColor(scratchRight);
    sinus?.setOpacity(VESSEL_GLASS);
    for (const [id, opacity] of Object.entries(PERICARDIUM_GLASS)) ctx.part(id)?.setOpacity(opacity);

    /* ------------------------------------------------------------------ valves */
    const sys = smooth(SYSTOLE_ON, SYSTOLE_FULL, act);
    const avOpen = still ? 0.5 : 1 - sys;
    const pulmOpen = still ? 0.5 : pumping ? sys : 0;
    const aorticOpen = still ? 0.5 : pumping ? clamp(aorticFlow / 40, 0, 1) : 0;
    const setValve = (id: string, open: number): void => {
      const v = ctx.part(id);
      if (!v) return;
      // Open: faded and shrunk towards its ring. Closed: restored.
      v.setOpacity(1 - 0.88 * open);
      v.setScale(1 - 0.65 * open);
      // The cusps ride the valve's scale (OrganDetail) but not its opacity.
      for (const cusp of VALVE_CUSPS[id] ?? []) ctx.part(cusp)?.setOpacity(1 - 0.88 * open);
    };
    setValve('tricuspid_valve', avOpen);
    setValve('mitral_valve', avOpen);
    setValve('pulmonary_valve', pulmOpen);
    setValve('aortic_valve', aorticOpen);

    /* ------------------------------------------------------------------ streams */
    const density = clamp((DENSITY_AT_REST * co) / REST_CO, 0.15, 1);
    const systole = sys > 0.5;
    const cycleS = hr > 0 ? 60 / hr : 1;
    const sinceBeatS = phase * cycleS;
    const kicking = rhythm !== 'afib' && sinceBeatS > cycleS - KICK_S;
    const steady = pumping ? 0.8 : 0;

    const setFlow = (id: string, rate: number, colour: THREE.Color, from = 0, to = 1): void => {
      const f = ctx.flow(id);
      if (!f) return;
      f.setRate(rate);
      f.setDensity(density);
      f.setColor(colour);
      f.setWindow(from, to);
    };

    if (still) {
      for (const id of ['svc_in', 'ivc_in', 'ra_to_rv', 'rv_to_pulm']) setFlow(id, steady, scratchRight);
      for (const id of ['la_to_lv', 'lv_to_aorta', 'coronary_lad', 'coronary_cx', 'coronary_rca', 'pv_in_0', 'pv_in_1', 'pv_in_2', 'pv_in_3'])
        setFlow(id, steady, scratchLeft);
    } else {
      const venous = pumping ? 0.6 + 0.5 * sys : 0;
      setFlow('svc_in', venous, scratchRight);
      setFlow('ivc_in', venous, scratchRight);
      for (let i = 0; i < 4; i++) setFlow(`pv_in_${i}`, venous, scratchLeft);

      const fill = pumping ? (1 - sys) * (0.7 + (kicking ? 0.9 : 0)) : 0;
      // Closed valve: hold the blood on the atrial side (the valve is about half way along).
      setFlow('ra_to_rv', fill, scratchRight, 0, systole ? 0.45 : 1);
      setFlow('la_to_lv', fill, scratchLeft, 0, systole ? 0.45 : 1);

      const eject = clamp(aorticFlow / 300, 0, 1.6);
      setFlow('lv_to_aorta', pumping ? eject : 0, scratchLeft, systole ? 0 : 0, systole ? 1 : 0.45);
      setFlow('rv_to_pulm', pumping ? sys * Math.max(0.25, eject) : 0, scratchRight, 0, systole ? 1 : 0.45);

      const coronary = pumping ? 0.25 + 0.75 * (1 - sys) : 0;
      setFlow('coronary_lad', coronary, scratchLeft);
      setFlow('coronary_cx', coronary, scratchLeft);
      setFlow('coronary_rca', coronary, scratchLeft);
    }

    /* -------------------------------------------------------------- conduction */
    const sa = ctx.part('sa_node');
    const av = ctx.part('av_node');
    const his = ctx.part('his_purkinje');
    const impulse = IMPULSE_FLOWS;
    const hideImpulse = (): void => {
      for (const id of impulse) ctx.flow(id)?.setVisible(false);
    };
    const organised = hr > 0 && rhythm !== 'vfib' && rhythm !== 'asystole';
    if (still || !organised) {
      hideImpulse();
      if (!still && rhythm === 'vfib' && his) {
        // No organised sweep: a faint chaotic shimmer.
        his.setGlow(0.25 + 0.15 * Math.sin(ctx.time * 41) * Math.sin(ctx.time * 27));
      }
      return;
    }

    const lead = Math.min(SA_LEAD_S, 0.6 * cycleS);
    // Seconds since the SA node last fired: it fires `lead` before the next ventricular systole.
    const tau = (sinceBeatS + lead) % cycleS;

    if (sa) {
      if (rhythm === 'afib') {
        sa.setGlow(0.2 + 0.1 * Math.sin(ctx.time * 37) * Math.sin(ctx.time * 23));
      } else {
        const peak = rhythm === 'vt' ? 0.4 : 1;
        sa.setGlow(Math.max(ctx.activity('sa_node'), peak * (1 - smooth(0, 2 * SA_FLASH_S, tau))));
      }
    }
    if (av) {
      // Glows from the end of atrial spread until the impulse leaves it.
      const g = smooth(AV_START_S, lead - 0.02, tau) * (1 - smooth(lead, lead + 0.03, tau));
      av.setGlow(Math.max(ctx.activity('av_node'), g));
    }
    const p = (tau - lead) / SWEEP_S;
    const sweeping = p >= 0 && p <= 1.25;
    if (his) his.setGlow(sweeping ? 1 : ctx.activity('his_purkinje'));
    for (const id of CONDUCTION_CHILDREN) if (sweeping) ctx.part(id)?.setGlow(1);
    for (const id of impulse) {
      const f = ctx.flow(id);
      if (!f) continue;
      f.setVisible(sweeping);
      if (sweeping) {
        f.setRate(1);
        f.setDensity(1);
        f.setColor(tmp.set(IMPULSE));
        f.setWindow(clamp(p - 0.25, 0, 1), clamp(p, 0, 1));
      }
    }
  },
};
