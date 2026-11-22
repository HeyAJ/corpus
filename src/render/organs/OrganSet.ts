import * as THREE from 'three';
import type { OrganDef, OrganId } from '../../data/types';
import { triangleCount } from './placeholder';
import { createOrganAbsorptionMaterial, assertOrderIndependent } from '../materials/OrganAbsorption';
import { createOrganRimMaterial, assertRimOrderIndependent } from '../materials/OrganRim';
import { createOrganSolidMaterial, createFluidMaterial } from '../materials/OrganSolid';
import { GeometryFactory } from '../anatomy/GeometryFactory';
import { GI_CENTRELINES, ORGAN_DEFS, groupOffset as layoutGroupOffset, organPosition } from '../anatomy/layout';
import { fetalFit, gravidBody, type FetalFit } from '../anatomy/models';
import { activityColour, activityColourBelow } from './activityRamp';
import { ALARM_HEX } from './alarmOrgans';
import { amnioticSacRadii } from '../anatomy/atlas/uterus.parts';
import { ANATOMY, atlasOf } from '../../data/anatomy';

/**
 * THE ORGAN SET.
 *
 * Each organ is TWO `THREE.Mesh` instances SHARING ONE `BufferGeometry` (spec 6.2).
 * Sharing the geometry means the second mesh costs no extra memory — it is a second
 * draw of the same buffers with a different material.
 *
 *   renderOrder 10  absorption shell   (bucket 1, multiply)
 *   renderOrder 20  fresnel rim        (bucket 2, additive)
 *   renderOrder 30  selected/interior  (bucket 3, normal alpha, manually sorted)
 *
 * Buckets 1 and 2 are order-independent by construction, so renderOrder between
 * organs within a bucket does not matter — only the bucket boundary does.
 *
 * FOUR THINGS THIS FILE DOES THAT THE FIRST VERSION DID NOT, and why each is here
 * rather than somewhere else:
 *
 *   1. GEOMETRY ARRIVES LATER. Organs are built in a worker (anatomy/GeometryFactory.ts)
 *      so the page is never frozen behind them. An organ therefore exists as a handle
 *      with an empty geometry from the first frame and is filled in, and faded in, when
 *      its buffers come back. Nothing may assume a handle has triangles.
 *
 *   2. NOT EVERY ORGAN BELONGS TO EVERY BODY. The reproductive organs depend on the
 *      body's sex and the fetus on whether it is pregnant. `setBody` is the one place
 *      that decides which organs are wanted; an unwanted organ is hidden, is not
 *      pickable and is not built until the day it is wanted.
 *
 *   3. ONE ORGAN CHANGES SHAPE. The uterus grows from a pear to something that fills
 *      the abdomen. Its geometry is rebuilt per gestational week (in the worker) and
 *      swapped in; everything else about the handle stays.
 *
 *   4. A RESTING ORGAN CAN STILL SAY IT IS WORKING. `setActivity` deepens an organ's
 *      own colour in proportion to how far above rest the engine says it is, so a body
 *      that is running, frightened or digesting shows that across the whole stack and
 *      not only in whichever organ happens to be selected.
 */

export type OrganState = 'dormant' | 'hovered' | 'selected';

/** Spec 6.4, measured in docs/VISUAL_AUDIT.md section 2.2. */
const STATE_STYLE: Record<OrganState, { density: number; rimGain: number }> = {
  // DENSITY, AND WHY IT CAME DOWN FROM 1.15.
  //
  // 1.15 was calibrated against the reference's overlap ratios with FIFTEEN fat
  // ellipsoids: one layer 204, two 171, four 120 against the reference's 196, 159 and
  // 121. Its own comment recorded the problem with it - "the rendered abdomen is still
  // visibly more saturated than the reference frames ... a GEOMETRY gap, not a material
  // one, and it closes when the placeholder meshes are replaced". They have now been
  // replaced, and the body also has twice as many structures in it: adrenals on the
  // kidneys, a diaphragm across the whole trunk, ureters, a cord, a gallbladder under
  // the liver. A ray through the upper abdomen now crosses many more walls than the
  // calibration assumed, and at 1.15 the trunk went to a uniform dark red in which no
  // organ could be told from its neighbour - the opposite of what adding anatomy is for.
  //
  // Multiplying every density by one factor preserves the overlap RATIOS exactly (the
  // product of transmittances scales as a power), so this keeps what the calibration
  // established and gives back the legibility. The rim is unchanged: it was set from the
  // headroom between tissue and background, and a lighter tissue has more of it.
  dormant: { density: 0.5, rimGain: 0.12 },
  hovered: { density: 0.8, rimGain: 0.3 },

  // THE SELECTED RIM GAIN WAS THE BUG, and it was a bad one.
  //
  // At 1.50 the bucket-2 additive rim alone nearly saturated the framebuffer, and the
  // bucket-3 solid then added its own white rim on top. The result was that picking an
  // organ turned it into a pale ghost — the exact opposite of what selection is for,
  // and nothing like the reference, where the selected organ is the DEEPEST, most
  // saturated thing on screen.
  //
  // Now the halo is a hint and the colour does the work.
  selected: { density: 0.0, rimGain: 0.3 },
};

/**
 * How far an organ's dormant tint is pulled from its own colour toward the shared pink.
 *
 * At rest an organ keeps about half of its own hue (see REST_TINT_MIX below), so the
 * organs can be told apart in a whole-body view while the look stays soft glass (the
 * reference lets only the SELECTED organ take its full colour). A working organ gives
 * more of it back: at full engagement it is drawn ACTIVE_TINT_MIX of the way toward pink,
 * plainly its own colour but still translucent tissue rather than the solid of a
 * selected organ.
 *
 * WHY THIS IS SAFE FOR THE ORDER-INDEPENDENCE GUARANTEE: the tint enters as
 * `exp(-sigma * (1 - tint))`, so a per-organ tint is still a per-organ transmittance,
 * and a product of transmittances is commutative whatever the individual values are.
 */
/*
 * REST_TINT_MIX WAS 0.84 AND THAT WAS WRONG (changed 2026-11-16). Mixing every organ's own
 * colour 84 % toward one shared pink left only 16 % of the organ's identity, so liver,
 * stomach, lungs and bowel all read as one pink mass in the whole-body view. Three
 * candidates were rendered (rest/active 0.6/0.3, 0.45/0.2, 0.3/0.1) and compared: 0.6 was
 * still close to pink, 0.3 began to go muddy and lilac (the lungs and brain turned
 * saturated), and 0.45 gives a brown liver, mauve lungs, salmon stomach and a pinker
 * bowel while staying soft glass. ACTIVE_TINT_MIX moves with it so an engaged organ is
 * still clearly richer than a resting one. Both are display choices.
 */
const REST_TINT_MIX = 0.45;
const ACTIVE_TINT_MIX = 0.2;
/** A fully engaged organ is also drawn this much denser. */
const ACTIVE_DENSITY_GAIN = 0.45;
const PINK = new THREE.Color(0xffd2cc);
const WHITE = new THREE.Color(0xffffff);

/**
 * WHILE AN ORGAN IS OPEN, ITS NEIGHBOURS RECEDE.
 *
 * Selecting an organ now shows its interior: chambers, lobes, nuclei, streams. But a heart
 * sits between two lungs and behind a sternum's worth of thymus, and a kidney sits behind
 * the bowel, so at the resting density the thing the user asked to see was looked at
 * through two or three other organs and read as a smear. While anything is selected every
 * OTHER organ's shell is therefore drawn at this fraction of its density and rim: still
 * there, so the selected organ keeps its place in the body, but thin enough to see through.
 * It is one factor on every unselected shell, so the overlap ratios and the
 * order-independence argument above are untouched. The numbers were set by eye on the
 * heart (the worst case) and are drawing choices.
 */
const RECEDE_DENSITY = 0.22;

/**
 * CLOSE LOOK. While a part with finer structures is focused (a valve and its cusps, a ventricle
 * and its papillary muscles) the receding neighbours are thinned further: their density is
 * multiplied by `1 - CLOSE_LOOK_RECEDE_CUT * closeLook`. At 0.22 the lungs, great vessels and
 * chest shells in front of a camera sitting 0.1 m from a mitral valve still laid a pink wash over
 * its cusps. A DISPLAY factor, not a physical one.
 */
const CLOSE_LOOK_RECEDE_CUT = 0.75;
const RECEDE_RIM = 0.4;
/** Time constant of the recede, ms. */
const RECEDE_TAU_MS = 160;

const TWEEN_MS = 250;
/** How long a newly built organ takes to fade in. */
const APPEAR_MS = 420;
/** Organ engagement is smoothed over about this long so a noisy index does not flicker. */
const ACTIVITY_TAU_MS = 350;

/**
 * ACTIVITY MODE DENSITY (display choices). In the mode a quiet organ is drawn at
 * ACTIVITY_QUIET_DENSITY of its normal density so it recedes toward the page, and a fully
 * engaged one at QUIET + SPAN (about 1.45x), so engagement reads as darker AND denser.
 */
const ACTIVITY_QUIET_DENSITY = 0.55;
const ACTIVITY_DENSITY_SPAN = 0.9;

/**
 * ALARM PULSE (display choices). The shells behind a warn or critical condition swing
 * toward the interface's alarm red (ALARM_HEX in alarmOrgans.ts) at about 1 Hz. That
 * rhythm is a DISPLAY rhythm, not the heart rate. Tint, not light, because additive glow
 * is almost invisible on the pale page. Under reduced motion the swing is replaced by a
 * steady emphasis at ALARM_STEADY of the full swing.
 */
const ALARM_PULSE_HZ = 1;
const ALARM_STEADY = 0.6;
const ALARM_TINT_MIX = 0.75;
const ALARM_DENSITY_GAIN = 0.6;
const ALARM_TAU_MS = 200;

/**
 * The order organs are asked for, so the body assembles the same way every load and
 * the things the eye goes to first are there first.
 */
const BUILD_ORDER: OrganId[] = [
  'heart', 'brain', 'lung_l', 'lung_r', 'liver', 'stomach', 'kidney_l', 'kidney_r',
  'intestine_large', 'intestine_small', 'trachea', 'oesophagus', 'spinal_cord', 'bladder',
  'pancreas', 'spleen', 'diaphragm', 'eyes', 'thyroid', 'thymus', 'adrenal_l', 'adrenal_r',
  'gallbladder', 'ureters',
];

export interface BodyKind {
  sex: 'male' | 'female';
  pregnant: boolean;
  /** Gestational age, weeks. Only read while `pregnant`. */
  gestationWeeks: number;
}

export interface OrganHandle {
  id: OrganId;
  def: OrganDef;
  geometry: THREE.BufferGeometry;
  absorption: THREE.Mesh;
  rim: THREE.Mesh;
  /** Bucket-3 mesh, only in the scene while selected. */
  solid: THREE.Mesh;
  /** Interior fluid mesh for stomach and bladder; null elsewhere. */
  fluid: THREE.Mesh | null;
  state: OrganState;
  /** Tween progress 0..1 between the style at the last state change and the current state's. */
  tween: number;
  fromDensity: number;
  fromRim: number;
  /**
   * The shell's own density and rim this frame, BEFORE the fade-in and the recede are
   * applied. A state change tweens from these, not from the uniforms: the uniforms carry
   * those two factors, and tweening from them applied each factor twice (a visible dip
   * when a receded organ was hovered).
   */
  ownDensity: number;
  ownRim: number;
  /** Tint at the moment the state last changed, so the cross-fade starts from it. */
  fromTint: THREE.Color;
  /** The organ's own colour and its resting tint, precomputed. */
  ownColor: THREE.Color;
  /**
   * Centre of the organ's bounding sphere in the BODY frame (+x = the patient's right),
   * before the renderer's mirror. Viewer converts it for the camera and the labels.
   */
  centroid: THREE.Vector3;
  boundingRadius: number;
  /** Where the organ's own origin sits in the body frame. */
  basePosition: THREE.Vector3;
  /** Uniform scale from the sim-driven pulse (heart, lungs), multiplied into `pose`. */
  pulse: number;
  /** Extra transform some organs carry: the diaphragm's descent, an organ that changes size. */
  offset: THREE.Vector3;
  poseScale: THREE.Vector3;
  poseRotationX: number;
  /** True once the worker has delivered this organ's geometry. */
  built: boolean;
  /** True while a build is in flight, so it is not asked for twice. */
  building: boolean;
  /** The organ belongs to the body as it currently is. */
  wanted: boolean;
  /** 0..1 fade-in after the geometry arrives. */
  appear: number;
  /** Smoothed engagement above rest, 0..1, and the value it is heading for. */
  activity: number;
  activityTarget: number;
  /** Smoothed suppression below rest, 0..1, and its target (the teal arm of Activity mode). */
  activityBelow: number;
  activityBelowTarget: number;
  /** 0..1 eased alarm emphasis and where it is heading (see setAlarmOrgans). */
  alarm: number;
  alarmTarget: number;
  /** The organ has interior parts, so it turns to glass when selected. */
  hasInterior: boolean;
  /** Which gestational week the current geometry was built for (the uterus only). */
  builtForWeek: number;
  /**
   * The fetus only: its size and place for the current week (see `fetalFit`), the week
   * that was computed for, and the bounding sphere of the UNSCALED term-size shell, from
   * which the centroid and radius that the camera and labels read are derived.
   */
  fit: FetalFit | null;
  fitWeek: number;
  rawCentre: THREE.Vector3;
  rawRadius: number;
}

export class OrganSet {
  readonly root = new THREE.Group();
  readonly absorptionGroup = new THREE.Group();
  readonly rimGroup = new THREE.Group();
  readonly solidGroup = new THREE.Group();
  readonly organs = new Map<OrganId, OrganHandle>();
  /** Raycast targets: only organs that are built and belong to the current body. */
  readonly pickTargets: THREE.Object3D[] = [];
  totalTriangles = 0;

  private body: BodyKind = { sex: 'male', pregnant: false, gestationWeeks: 0 };
  private readonly scratchColor = new THREE.Color();
  private readonly scratchFit = new THREE.Vector3();
  private readonly restTint = new THREE.Color();
  private readonly rampRgb = { r: 0, g: 0, b: 0 };
  private readonly rampColor = new THREE.Color();
  private readonly alarmColor = new THREE.Color(ALARM_HEX);
  /** Activity display mode (setActivityMode) and its eased 0..1 cross-fade. */
  private activityMode = false;
  private activityMix = 0;
  /** Display clock of the alarm pulse, ms, advanced only while something is alarming. */
  private alarmClockMs = 0;
  /** Under reduced motion the alarm is a steady emphasis, not a swing. */
  reducedMotion = false;
  /** 0..1, eased: 1 while some organ is selected. See RECEDE_DENSITY. */
  private focus = 0;
  /**
   * 0..1, already eased (instant under reduced motion) by the interior that owns the close-look
   * rule, set each frame by the Viewer. See CLOSE_LOOK_RECEDE_CUT.
   */
  closeLook = 0;
  private disposed = false;

  constructor(private readonly factory: GeometryFactory = new GeometryFactory()) {
    this.root.add(this.absorptionGroup, this.rimGroup, this.solidGroup);
    this.absorptionGroup.renderOrder = 10;
    this.rimGroup.renderOrder = 20;
    this.solidGroup.renderOrder = 30;

    for (const def of ORGAN_DEFS) {
      // An organ has an interior to show if its atlas lists any parts.
      const hasInterior = (ANATOMY[atlasOf(def)]?.parts.length ?? 0) > 0;
      this.organs.set(def.id, this.createHandle(def, hasInterior));
    }

    this.applyBody();
  }

  /** The geometry factory, shared with the interior detail so one worker serves both. */
  get geometryFactory(): GeometryFactory {
    return this.factory;
  }

  /** Organs wanted by the current body whose geometry has not arrived yet. */
  get pendingCount(): number {
    let n = 0;
    for (const h of this.organs.values()) if (h.wanted && !h.built) n++;
    return n;
  }

  private createHandle(def: OrganDef, hasInterior: boolean): OrganHandle {
    // An empty geometry draws nothing and intersects nothing, which is exactly what an
    // organ that has not been built yet should do.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(0), 3));

    const ownColor = new THREE.Color(def.selectedColor);
    const tint = ownColor.clone().lerp(PINK, REST_TINT_MIX);
    const absorptionMaterial = createOrganAbsorptionMaterial({ tint, density: 0 });
    const rimMaterial = createOrganRimMaterial({ gain: 0 });
    assertOrderIndependent(absorptionMaterial);
    assertRimOrderIndependent(rimMaterial);

    // ONE geometry, two meshes. This is the whole memory story.
    const absorption = new THREE.Mesh(geometry, absorptionMaterial);
    const rim = new THREE.Mesh(geometry, rimMaterial);
    const solidMaterial = createOrganSolidMaterial({ color: def.selectedColor });
    if (hasInterior) {
      // A glass shell must not hide what is inside it: no depth write, and the interior
      // (renderOrder 31 and up) is drawn over it.
      solidMaterial.depthWrite = false;
      solidMaterial.uniforms.uCore.value = 0.12;
    }
    const solid = new THREE.Mesh(geometry, solidMaterial);

    absorption.renderOrder = 10;
    rim.renderOrder = 20;
    solid.renderOrder = 30;
    solid.visible = false;

    const basePosition = organPosition(def);
    for (const mesh of [absorption, rim, solid]) {
      mesh.position.copy(basePosition);
      if (def.rotation) mesh.rotation.set(def.rotation[0], def.rotation[1], def.rotation[2]);
      mesh.userData.organId = def.id;
      // The bounding sphere of an empty geometry is degenerate; three would cull the
      // mesh on it for ever. Culling thirty meshes is not worth the trap.
      mesh.frustumCulled = false;
      mesh.visible = false;
    }

    this.absorptionGroup.add(absorption);
    this.rimGroup.add(rim);
    this.solidGroup.add(solid);

    let fluid: THREE.Mesh | null = null;
    if (def.id === 'stomach' || def.id === 'bladder') {
      // Interior fluid: the same shell scaled slightly inward, clipped by a
      // world-space Y plane in the fluid shader (spec 6.5).
      fluid = new THREE.Mesh(
        geometry,
        createFluidMaterial({
          color: def.id === 'stomach' ? 0x8e2a22 : 0x9a7a12,
          meniscusColor: def.id === 'stomach' ? 0xffd9cf : 0xfff0b8,
          opacity: 0.82,
          meniscus: 0.004,
        }),
      );
      fluid.position.copy(basePosition);
      if (def.rotation) fluid.rotation.set(def.rotation[0], def.rotation[1], def.rotation[2]);
      fluid.scale.setScalar(0.94);
      fluid.renderOrder = 34;
      fluid.visible = false;
      fluid.frustumCulled = false;
      this.solidGroup.add(fluid);
    }

    return {
      id: def.id,
      def,
      geometry,
      absorption,
      rim,
      solid,
      fluid,
      state: 'dormant',
      tween: 1,
      fromDensity: 0,
      fromRim: 0,
      ownDensity: 0,
      ownRim: 0,
      fromTint: tint.clone(),
      ownColor,
      centroid: basePosition.clone(),
      boundingRadius: 0.05,
      basePosition,
      pulse: 1,
      offset: new THREE.Vector3(),
      poseScale: new THREE.Vector3(1, 1, 1),
      poseRotationX: 0,
      built: false,
      building: false,
      wanted: false,
      appear: 0,
      activity: 0,
      activityTarget: 0,
      activityBelow: 0,
      activityBelowTarget: 0,
      alarm: 0,
      alarmTarget: 0,
      hasInterior,
      builtForWeek: -1,
      fit: null,
      fitWeek: -1,
      rawCentre: new THREE.Vector3(),
      rawRadius: 0.05,
    };
  }

  /* ------------------------------------------------------------- the body */

  /**
   * Tell the organ set what kind of body this is. Cheap to call every snapshot: it does
   * nothing unless the sex, the pregnancy or the gestational WEEK has changed.
   */
  setBody(body: BodyKind): void {
    const week = body.pregnant ? Math.max(0, Math.round(body.gestationWeeks)) : 0;
    const previousWeek = this.body.pregnant ? Math.max(0, Math.round(this.body.gestationWeeks)) : 0;
    const changed = body.sex !== this.body.sex || body.pregnant !== this.body.pregnant || week !== previousWeek;
    this.body = { ...body };
    if (changed) this.applyBody();
  }

  private wants(def: OrganDef): boolean {
    if (def.sex && def.sex !== this.body.sex) return false;
    if (def.pregnancyOnly) return this.body.pregnant && this.body.gestationWeeks >= 8;
    return true;
  }

  private applyBody(): void {
    const order = [...BUILD_ORDER, ...ORGAN_DEFS.map((d) => d.id).filter((id) => !BUILD_ORDER.includes(id))];
    for (const id of order) {
      const h = this.organs.get(id);
      if (!h) continue;
      const wanted = this.wants(h.def);
      if (wanted !== h.wanted) {
        h.wanted = wanted;
        if (!wanted) {
          // Gone at once: an organ this body does not have must not linger half-faded.
          h.appear = 0;
          this.setMeshVisibility(h);
          if (h.state !== 'dormant') this.setState(id, 'dormant');
        } else if (h.built) {
          h.appear = 0; // fade back in
        }
      }
      if (!wanted) continue;

      const week = id === 'uterus' && this.body.pregnant ? Math.max(0, Math.round(this.body.gestationWeeks)) : 0;
      if ((!h.built || h.builtForWeek !== week) && !h.building) this.build(h, week);
    }
    this.refreshPickTargets();
  }

  private build(h: OrganHandle, week: number): void {
    const recipe = h.def.placeholder;
    if (recipe.kind !== 'model') {
      throw new Error(`organ "${h.id}" uses a "${recipe.kind}" recipe; only "model" recipes are built here`);
    }
    h.building = true;
    void this.factory
      .model(recipe.model, { gestationWeeks: week })
      .then((geometry) => {
        h.building = false;
        if (this.disposed) {
          geometry.dispose();
          return;
        }
        this.adopt(h, geometry, week);
        // The body may have moved on while this was being built (a time-lapse advances a
        // week faster than a uterus builds). Ask again for whatever is current.
        if (h.wanted && h.id === 'uterus') {
          const now = this.body.pregnant ? Math.max(0, Math.round(this.body.gestationWeeks)) : 0;
          if (now !== h.builtForWeek) this.build(h, now);
        }
      })
      .catch((error: unknown) => {
        h.building = false;
        // Loud in the console, quiet on screen: one organ failing to build must not take
        // the body down with it.
        console.error(`[corpus] could not build organ "${h.id}"`, error);
      });
  }

  /** Swap a freshly built geometry into a handle. */
  private adopt(h: OrganHandle, geometry: THREE.BufferGeometry, week: number): void {
    const firstTime = !h.built;
    if (h.built) this.totalTriangles -= triangleCount(h.geometry);
    h.geometry.dispose();
    h.geometry = geometry;
    h.absorption.geometry = geometry;
    h.rim.geometry = geometry;
    h.solid.geometry = geometry;
    if (h.fluid) h.fluid.geometry = geometry;
    this.totalTriangles += triangleCount(geometry);

    const sphere = geometry.boundingSphere ?? new THREE.Sphere(new THREE.Vector3(), 0.05);
    h.centroid.copy(h.basePosition).add(sphere.center);
    h.boundingRadius = sphere.radius;
    h.rawCentre.copy(sphere.center);
    h.rawRadius = sphere.radius;
    h.fitWeek = -1; // a new shell: the fetal fit is recomputed against its vertices
    h.built = true;
    h.builtForWeek = week;
    if (firstTime) h.appear = 0;
    this.setMeshVisibility(h);
    this.refreshPickTargets();
  }

  private setMeshVisibility(h: OrganHandle): void {
    const on = h.built && h.wanted;
    h.absorption.visible = on;
    h.rim.visible = on;
    if (!on) {
      h.solid.visible = false;
      if (h.fluid) h.fluid.visible = false;
    }
  }

  private refreshPickTargets(): void {
    this.pickTargets.length = 0;
    for (const h of this.organs.values()) if (h.built && h.wanted) this.pickTargets.push(h.absorption);
  }

  /* --------------------------------------------------------------- states */

  setState(id: OrganId, state: OrganState): void {
    const h = this.organs.get(id);
    if (!h || h.state === state) return;
    const abs = h.absorption.material as THREE.ShaderMaterial;
    h.fromDensity = h.ownDensity;
    h.fromRim = h.ownRim;
    h.fromTint = (abs.uniforms.uTint.value as THREE.Color).clone();
    h.state = state;
    h.tween = 0;
  }

  clearStates(except?: OrganId): void {
    for (const [id, h] of this.organs) {
      if (id === except) continue;
      if (h.state !== 'dormant') this.setState(id, 'dormant');
    }
  }

  /**
   * How far above rest the engine says this organ is working, 0..1. Smoothed here, so
   * the caller can pass the raw index every snapshot.
   */
  setActivity(id: OrganId, activity: number): void {
    const h = this.organs.get(id);
    if (h) h.activityTarget = Number.isFinite(activity) ? Math.max(0, Math.min(1, activity)) : 0;
  }

  /**
   * How far BELOW rest the engine says this organ is, 0..1 (smoothed like `setActivity`).
   * Only Activity mode draws it, as the teal arm; the normal view ignores it.
   */
  setActivityBelow(id: OrganId, below: number): void {
    const h = this.organs.get(id);
    if (h) h.activityBelowTarget = Number.isFinite(below) ? Math.max(0, Math.min(1, below)) : 0;
  }

  /** Switch the Activity display mode: shell colour from the one sequential ramp. */
  setActivityMode(on: boolean): void {
    this.activityMode = on;
  }

  /** The organ ids to pulse toward alarm red; every other organ eases back to calm. */
  setAlarmOrgans(ids: readonly string[]): void {
    for (const h of this.organs.values()) h.alarmTarget = 0;
    for (let i = 0; i < ids.length; i++) {
      const h = this.organs.get(ids[i] as OrganId);
      if (h) h.alarmTarget = 1;
    }
  }

  /** Advance the state tweens, the fade-in and the activity tint. `dtMs` is real time. */
  update(dtMs: number): void {
    const activityBlend = 1 - Math.exp(-dtMs / ACTIVITY_TAU_MS);

    // See RECEDE_DENSITY: 1 while some organ is open, eased so nothing pops.
    let anySelected = false;
    for (const h of this.organs.values()) {
      if (h.built && h.wanted && h.state === 'selected') {
        anySelected = true;
        break;
      }
    }
    this.focus += ((anySelected ? 1 : 0) - this.focus) * (1 - Math.exp(-dtMs / RECEDE_TAU_MS));
    const recedeDensity = (1 - (1 - RECEDE_DENSITY) * this.focus) * (1 - CLOSE_LOOK_RECEDE_CUT * this.closeLook);
    const recedeRim = (1 - (1 - RECEDE_RIM) * this.focus) * (1 - CLOSE_LOOK_RECEDE_CUT * this.closeLook);

    // The Activity mode cross-fades over the same time as the activity smoothing, so
    // switching it never pops.
    this.activityMix += ((this.activityMode ? 1 : 0) - this.activityMix) * activityBlend;
    const mode = this.activityMix;

    // The alarm swing runs on its own display clock. ALARM_PULSE_HZ is a display rhythm,
    // not the heart rate; the clock advances only when real time does (dtMs).
    this.alarmClockMs += dtMs;
    const swing = this.reducedMotion
      ? ALARM_STEADY
      : 0.5 - 0.5 * Math.cos((this.alarmClockMs * ALARM_PULSE_HZ * 2 * Math.PI) / 1000);
    const alarmBlend = 1 - Math.exp(-dtMs / ALARM_TAU_MS);

    for (const h of this.organs.values()) {
      if (!h.built || !h.wanted) continue;

      h.alarm += (h.alarmTarget - h.alarm) * alarmBlend;
      h.activity += (h.activityTarget - h.activity) * activityBlend;
      h.activityBelow += (h.activityBelowTarget - h.activityBelow) * activityBlend;
      if (h.appear < 1) h.appear = Math.min(1, h.appear + dtMs / APPEAR_MS);
      if (h.tween < 1) h.tween = Math.min(1, h.tween + dtMs / TWEEN_MS);
      // Ease-out cubic: fast start, gentle settle. Matches the camera focus easing.
      const e = 1 - Math.pow(1 - h.tween, 3);
      const fade = h.appear * h.appear * (3 - 2 * h.appear);

      const target = STATE_STYLE[h.state];
      const abs = h.absorption.material as THREE.ShaderMaterial;
      const rim = h.rim.material as THREE.ShaderMaterial;
      const selected = h.state === 'selected';

      // Where this organ's shell is heading: its state's density, raised by how hard the
      // organ is working. A selected organ's shell goes to the multiply identity (white,
      // density 0) rather than being switched off, so there is no pop and no change in
      // draw order; bucket 3 owns its look.
      // In Activity mode the density gain is the ramp's own (quiet recedes, engaged is dense).
      // The organ shows its LARGER departure from rest, so a suppressed organ is as dense as an
      // engaged one of the same size of change (a departure is a departure, either way).
      const departure = Math.max(h.activity, h.activityBelow);
      const gain = (1 - mode) * (1 + ACTIVE_DENSITY_GAIN * h.activity)
        + mode * (ACTIVITY_QUIET_DENSITY + ACTIVITY_DENSITY_SPAN * departure);
      // An alarming organ is also denser at the top of its swing, so it reads on the pale page.
      const alarmAmount = h.alarm * swing;
      const activeGain = selected ? 0 : (gain + ALARM_DENSITY_GAIN * alarmAmount) * (h.def.shellDensity ?? 1);
      const density = h.fromDensity + (target.density * activeGain - h.fromDensity) * e;
      const rimGain = h.fromRim + (target.rimGain - h.fromRim) * e;
      h.ownDensity = density;
      h.ownRim = rimGain;
      // The fetus is the CONTENT of the uterus: while the uterus is open it is the thing the
      // glass is there to show, so it keeps its full density instead of receding with the
      // other neighbours. While the fetus itself is open the uterus recedes as usual.
      const exempt = h.id === 'fetus' && this.organs.get('uterus')?.state === 'selected';
      abs.uniforms.uDensity.value = density * fade * (selected || exempt ? 1 : recedeDensity);
      rim.uniforms.uRimGain.value = rimGain * fade * (selected || exempt ? 1 : recedeRim);

      this.restTint.copy(h.ownColor).lerp(PINK, REST_TINT_MIX + (ACTIVE_TINT_MIX - REST_TINT_MIX) * h.activity);
      if (mode > 0.001) {
        // The ramp replaces the organ's own colour. Authored in sRGB, so it is set with
        // the colour space named; the working space is linear.
        if (h.activityBelow > h.activity) activityColourBelow(h.activityBelow, this.rampRgb);
        else activityColour(h.activity, this.rampRgb);
        this.rampColor.setRGB(this.rampRgb.r, this.rampRgb.g, this.rampRgb.b, THREE.SRGBColorSpace);
        this.restTint.lerp(this.rampColor, mode);
      }
      if (alarmAmount > 0.001 && !selected) this.restTint.lerp(this.alarmColor, ALARM_TINT_MIX * alarmAmount);
      (abs.uniforms.uTint.value as THREE.Color).lerpColors(h.fromTint, selected ? WHITE : this.restTint, e);
      // Once the cross-fade is over the tint simply follows the activity.
      if (h.tween >= 1 && !selected) {
        h.fromTint.copy(this.restTint);
        h.fromDensity = target.density * activeGain;
        h.fromRim = target.rimGain;
      }

      h.solid.visible = selected && e > 0.05;
      (h.solid.material as THREE.ShaderMaterial).uniforms.uOpacity.value = selected ? 0.92 * e * fade : 0;
      if (h.fluid) h.fluid.visible = selected && e > 0.05;

      this.applyTransform(h);
    }
  }

  /* ----------------------------------------------------------- transforms */

  /** Uniform scale about the organ's own pivot — the sim-driven pulse (spec 6.7). */
  setScale(id: OrganId, scale: number): void {
    const h = this.organs.get(id);
    if (h) h.pulse = scale;
  }

  /** Displace an organ from its resting place (the diaphragm's descent on inspiration). */
  setOffset(id: OrganId, x: number, y: number, z: number): void {
    this.organs.get(id)?.offset.set(x, y, z);
  }

  /** Non-uniform scale and a pitch about the organ's own origin, on top of the pulse. */
  setPose(id: OrganId, scale: [number, number, number], rotationX = 0): void {
    const h = this.organs.get(id);
    if (!h) return;
    h.poseScale.set(scale[0], scale[1], scale[2]);
    h.poseRotationX = rotationX;
  }

  /**
   * THE FETUS'S SIZE AND PLACE. The shell is built once at term size about the external os
   * and is scaled and moved as a whole to the current week's amniotic sac (`fetalFit`,
   * models.ts, which has the rule and its source). Because OrganDetail copies this mesh's
   * live position, rotation and scale onto the interior group, the 14 parts and 11 streams
   * authored in the term frame follow without being re-authored. Before this the figure
   * was drawn term-sized at every week and hung out of the bottom of the uterus.
   */
  private fetalTransform(h: OrganHandle): void {
    const week = this.body.pregnant ? Math.max(0, Math.round(this.body.gestationWeeks)) : 0;
    if (h.fitWeek === week && h.fit) return;
    const position = h.geometry.getAttribute('position');
    if (!position || position.count === 0) return;
    h.fitWeek = week;
    h.fit = fetalFit(week, position.array, gravidBody(week).centre, amnioticSacRadii(week));
    // The camera and the labels read these: the scaled, moved shell's bounding sphere.
    const s = h.fit.scale;
    h.centroid.set(
      h.basePosition.x + h.fit.offset[0] + s * h.rawCentre.x,
      h.basePosition.y + h.fit.offset[1] + s * h.rawCentre.y,
      h.basePosition.z + h.fit.offset[2] + s * h.rawCentre.z,
    );
    h.boundingRadius = s * h.rawRadius;
  }

  private applyTransform(h: OrganHandle): void {
    if (h.id === 'fetus') this.fetalTransform(h);
    const fit = h.id === 'fetus' ? h.fit : null;
    const fs = fit ? fit.scale : 1;
    const rx = (h.def.rotation?.[0] ?? 0) + h.poseRotationX;
    const ry = h.def.rotation?.[1] ?? 0;
    const rz = h.def.rotation?.[2] ?? 0;
    for (const mesh of [h.absorption, h.rim, h.solid]) {
      mesh.position.copy(h.basePosition).add(h.offset);
      if (fit) mesh.position.add(this.scratchFit.set(fit.offset[0], fit.offset[1], fit.offset[2]));
      mesh.rotation.set(rx, ry, rz);
      mesh.scale.copy(h.poseScale).multiplyScalar(h.pulse * fs);
    }
    if (h.fluid) {
      h.fluid.position.copy(h.basePosition).add(h.offset);
      h.fluid.rotation.set(rx, ry, rz);
      h.fluid.scale.copy(h.poseScale).multiplyScalar(h.pulse * 0.94);
    }
  }

  /** World-space Y of the fluid surface, from a 0..1 fill fraction. */
  setFluidLevel(id: OrganId, fraction: number): void {
    const h = this.organs.get(id);
    if (!h?.fluid) return;
    const r = h.boundingRadius;
    const bottom = h.centroid.y - r;
    const level = bottom + 2 * r * Math.max(0, Math.min(1, fraction));
    (h.fluid.material as THREE.ShaderMaterial).uniforms.uLevelY.value = level;
  }

  /**
   * Manual back-to-front sort for bucket 3 (spec 6.2). At most a handful of objects, so
   * this is trivially correct and costs nothing.
   */
  sortSolidBucket(camera: THREE.Camera): void {
    // Interior fluid meshes sit above the sort: they are drawn last with depth off
    // so they show through the shell that contains them.
    const visible = this.solidGroup.children.filter((c) => c.visible && c.renderOrder < 34);
    if (visible.length < 2) return;
    const cam = camera.position;
    visible.sort((a, b) => b.position.distanceToSquared(cam) - a.position.distanceToSquared(cam));
    visible.forEach((o, i) => {
      o.renderOrder = 30 + Math.min(i, 3);
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const h of this.organs.values()) {
      h.geometry.dispose();
      (h.absorption.material as THREE.Material).dispose();
      (h.rim.material as THREE.Material).dispose();
      (h.solid.material as THREE.Material).dispose();
      if (h.fluid) (h.fluid.material as THREE.Material).dispose();
    }
    this.factory.dispose();
  }

  /** Scratch colour for callers that tint per frame without allocating. */
  get scratch(): THREE.Color {
    return this.scratchColor;
  }
}

export function organDefs(): OrganDef[] {
  return ORGAN_DEFS;
}

export function giCentrelines(): { segment: string; points: [number, number, number][] }[] {
  return GI_CENTRELINES;
}

export function groupOffset(group: OrganDef['group']): [number, number, number] {
  return layoutGroupOffset(group);
}
