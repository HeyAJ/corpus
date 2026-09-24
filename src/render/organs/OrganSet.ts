import * as THREE from 'three';
import organsFile from '../../data/organs.json';
import type { OrganDef, OrganId, OrgansFile } from '../../data/types';
import { buildPlaceholderGeometry, triangleCount } from './placeholder';
import { createOrganAbsorptionMaterial, assertOrderIndependent } from '../materials/OrganAbsorption';
import { createOrganRimMaterial, assertRimOrderIndependent } from '../materials/OrganRim';
import { createOrganSolidMaterial, createFluidMaterial } from '../materials/OrganSolid';

/**
 * THE ORGAN SET.
 *
 * Each organ is TWO `THREE.Mesh` instances SHARING ONE `BufferGeometry` (spec 6.2).
 * Sharing the geometry means the second mesh costs no extra memory — it is a second
 * draw of the same buffers with a different material. Fifteen organs therefore cost
 * thirty draw calls, which is irrelevant on any GPU made this decade.
 *
 *   renderOrder 10  absorption shell   (bucket 1, multiply)
 *   renderOrder 20  fresnel rim        (bucket 2, additive)
 *   renderOrder 30  selected/interior  (bucket 3, normal alpha, manually sorted)
 *
 * Buckets 1 and 2 are order-independent by construction, so renderOrder between
 * organs within a bucket does not matter — only the bucket boundary does.
 */

const FILE = organsFile as unknown as OrgansFile;

export type OrganState = 'dormant' | 'hovered' | 'selected';

/** Spec 6.4, measured in docs/VISUAL_AUDIT.md section 2.2. */
const STATE_STYLE: Record<OrganState, { density: number; rimGain: number; tint: number }> = {
  // Density is CALIBRATED against the overlap measurements in VISUAL_AUDIT 2.
  // With the tint's linear absorption coefficient of 0.453 in green and blue,
  // sigma = density x 2 walls gives, on the #F0F0F0 ground:
  //     1 layer  -> 204   (reference measured 196)
  //     2 layers -> 171   (reference measured 159)
  //     4 layers -> 120   (reference measured 121)
  // That match across three overlap depths is the evidence that the compositing
  // really is a product of transmittances rather than a sum of alphas.
  //
  // RAISED FROM 0.42. The calibration above is a match to the reference's OVERLAP
  // RATIOS, which it still is — multiplying the density scales every layer count
  // together and the ratios are preserved. What it was not was a match to the
  // reference's CONTRAST: at 0.42 a single unoverlapped organ sat ten levels off the
  // background and the abdomen read as one pink smudge rather than as distinguishable
  // loops of bowel. The reference's organs have legible edges, and legibility is the
  // thing worth matching.
  //
  // RIM GAINS LOWERED HARD. They were set to clear the bloom threshold at the
  // silhouette, and they did — but with the density raised, every organ acquired a
  // bright white outline and the abdomen turned into a tangle of glowing loops with
  // the organs themselves lost behind them. The reference has no glow at all: its
  // edges are soft and its brightness comes from tissue being translucent, not from
  // anything emitting. The rim is now a hint of separation where two organs touch.
  // LOWERED AGAIN, THIS TIME FROM THE ARITHMETIC RATHER THAN BY EYE. 0.42 was still
  // drawing a white scribble over the whole abdomen, and the reason is a one-line sum
  // that should have been done the first time.
  //
  // The rim is ADDITIVE near-white, so at the silhouette it adds roughly gain x 255
  // levels. A dormant organ body sits near 204 on a 240 background, which leaves 36
  // levels of headroom - about 0.14 in normalised units. At 0.42 the rim adds ~107,
  // saturates past white, and every ellipsoid in the model gets a glowing outline
  // BRIGHTER THAN THE BACKGROUND. With the placeholder geometry that is a tangle of
  // overlapping loops, and it is the single thing that made the anatomy look wrong.
  //
  // At 0.12 the edge lands just under the background: a soft lightening inside the
  // tissue rather than a line drawn on top of it, which is what the reference frames
  // actually show for a dormant organ. The near-white rim the audit measured at
  // #FFFDFB is on the SELECTED organ's silhouette, where it separates a deep saturated
  // body from the field - not on the pale pink field itself.
  //
  // DENSITY WAS TRIED AT 0.72 AND PUT BACK. The rendered abdomen is still visibly more
  // saturated than the reference frames, and the obvious move is to thin the tissue
  // until it matches. It is the wrong move, and the arithmetic above says why: at 1.15
  // a SINGLE layer renders 204 against the reference's measured 196, so one organ
  // already matches - it is very slightly too light, not too dark. The abdomen is dark
  // because the placeholder organs are fat ellipsoids that stack many more wall
  // crossings than the reference's thin anatomical shells do, and thinning every layer
  // to compensate would take an isolated organ (the bladder, say) further from the
  // reference in order to drag a pile of overlapping ones towards it. The residual
  // darkness is a GEOMETRY gap, not a material one, and it closes when the placeholder
  // meshes are replaced - not before.
  dormant: { density: 1.15, rimGain: 0.12, tint: 0xffc4c4 },
  hovered: { density: 1.55, rimGain: 0.3, tint: 0xffc4c4 },

  // THE SELECTED RIM GAIN WAS THE BUG, and it was a bad one.
  //
  // At 1.50 the bucket-2 additive rim alone nearly saturated the framebuffer, and the
  // bucket-3 solid then added its own white rim on top. The result was that picking an
  // organ turned it into a pale ghost — the exact opposite of what selection is for,
  // and nothing like the reference, where the selected organ is the DEEPEST, most
  // saturated thing on screen.
  //
  // Now the halo is a hint and the colour does the work.
  selected: { density: 0.0, rimGain: 0.30, tint: 0xffffff },
};

/**
 * THE DORMANT TINT OF ONE ORGAN.
 *
 * Every organ used to share a single pink, which meant the only thing separating the
 * liver from the stomach behind it was their outlines. The reference does better than
 * that: its organs are cohesively pink at a glance and subtly differentiated when you
 * look, so the abdomen reads as several organs rather than one mass.
 *
 * So each organ's dormant tint is its own selected colour, lightened most of the way
 * to white. A tint near white absorbs almost nothing, which keeps the stack light; the
 * fraction that survives is the organ's own hue, and it is what makes the violet of a
 * lung distinguishable from the warm brown of a liver without either becoming loud.
 *
 * WHY THIS IS SAFE FOR THE ORDER-INDEPENDENCE GUARANTEE: the tint enters as
 * `exp(-sigma * (1 - tint))`, so a per-organ tint is still a per-organ transmittance,
 * and a product of transmittances is commutative whatever the individual values are.
 * Different colours per organ changes what is multiplied, not that it is multiplied.
 */
function dormantTintFor(selectedColor: string): THREE.Color {
  // 0.84 toward a WARM PINK, not toward white: enough hue left to tell two adjacent
  // organs apart, not enough for any single organ to read as coloured rather than as
  // tissue.
  //
  // The reference keeps every dormant organ in one pink family and lets only the
  // SELECTED organ take its own colour — a brain that is violet at rest is not what
  // it shows. At 0.70 toward white the brain and lungs read as frankly purple, which
  // differentiated them but left the palette. Pulling further, and toward pink rather
  // than neutral, keeps the family while leaving just enough hue that a liver is
  // recognisably warmer than a lung when you look for it.
  return new THREE.Color(selectedColor).lerp(new THREE.Color(0xffd2cc), 0.84);
}

const TWEEN_MS = 250;

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
  group: THREE.Group;
  state: OrganState;
  /** Tween progress 0..1 between `fromStyle` and the current state's style. */
  tween: number;
  fromDensity: number;
  fromRim: number;
  /** Tint at the moment the state last changed, so the cross-fade starts from it. */
  fromTint: THREE.Color;
  centroid: THREE.Vector3;
  boundingRadius: number;
  /** Base scale, so pulse animation multiplies rather than overwrites. */
  baseScale: number;
}

export class OrganSet {
  readonly root = new THREE.Group();
  readonly absorptionGroup = new THREE.Group();
  readonly rimGroup = new THREE.Group();
  readonly solidGroup = new THREE.Group();
  readonly organs = new Map<OrganId, OrganHandle>();
  readonly pickTargets: THREE.Object3D[] = [];
  totalTriangles = 0;

  constructor() {
    this.root.add(this.absorptionGroup, this.rimGroup, this.solidGroup);
    this.absorptionGroup.renderOrder = 10;
    this.rimGroup.renderOrder = 20;
    this.solidGroup.renderOrder = 30;

    for (const def of FILE.organs) {
      this.organs.set(def.id, this.build(def));
    }
  }

  private build(def: OrganDef): OrganHandle {
    const geometry = buildPlaceholderGeometry(def.placeholder);
    geometry.computeBoundingSphere();
    this.totalTriangles += triangleCount(geometry);

    const style = STATE_STYLE.dormant;
    const dormantTint = dormantTintFor(def.selectedColor);
    const absorptionMaterial = createOrganAbsorptionMaterial({ tint: dormantTint, density: style.density });
    const rimMaterial = createOrganRimMaterial({ gain: style.rimGain });
    assertOrderIndependent(absorptionMaterial);
    assertRimOrderIndependent(rimMaterial);

    // ONE geometry, two meshes. This is the whole memory story.
    const absorption = new THREE.Mesh(geometry, absorptionMaterial);
    const rim = new THREE.Mesh(geometry, rimMaterial);
    const solid = new THREE.Mesh(geometry, createOrganSolidMaterial({ color: def.selectedColor }));

    absorption.renderOrder = 10;
    rim.renderOrder = 20;
    solid.renderOrder = 30;
    solid.visible = false;

    const group = FILE.groupLayout[def.group];
    const position = new THREE.Vector3(
      def.position[0] + def.layoutOffset[0] + group.offset[0],
      def.position[1] + def.layoutOffset[1] + group.offset[1],
      def.position[2] + def.layoutOffset[2] + group.offset[2],
    );

    for (const mesh of [absorption, rim, solid]) {
      mesh.position.copy(position);
      if (def.rotation) mesh.rotation.set(def.rotation[0], def.rotation[1], def.rotation[2]);
      mesh.userData.organId = def.id;
    }

    this.absorptionGroup.add(absorption);
    this.rimGroup.add(rim);
    this.solidGroup.add(solid);

    // Raycasting uses the absorption mesh, which has depthTest off — that does not
    // affect picking, which is pure geometry.
    this.pickTargets.push(absorption);

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
      fluid.position.copy(position);
      if (def.rotation) fluid.rotation.set(def.rotation[0], def.rotation[1], def.rotation[2]);
      fluid.scale.setScalar(0.94);
      fluid.renderOrder = 34;
      fluid.visible = false;
      this.solidGroup.add(fluid);
    }

    const sphere = geometry.boundingSphere ?? new THREE.Sphere(new THREE.Vector3(), 0.05);

    return {
      id: def.id,
      def,
      geometry,
      absorption,
      rim,
      solid,
      fluid,
      group: this.root,
      state: 'dormant',
      tween: 1,
      fromDensity: style.density,
      fromRim: style.rimGain,
      fromTint: dormantTint.clone(),
      centroid: position.clone().add(sphere.center),
      boundingRadius: sphere.radius,
      baseScale: 1,
    };
  }

  setState(id: OrganId, state: OrganState): void {
    const h = this.organs.get(id);
    if (!h || h.state === state) return;
    const abs = h.absorption.material as THREE.ShaderMaterial;
    const rim = h.rim.material as THREE.ShaderMaterial;
    h.fromDensity = abs.uniforms.uDensity.value as number;
    h.fromRim = rim.uniforms.uRimGain.value as number;
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

  /** Advance the 250 ms state tweens. `dtMs` is real elapsed time, not sim time. */
  update(dtMs: number): void {
    for (const h of this.organs.values()) {
      if (h.tween >= 1) continue;
      h.tween = Math.min(1, h.tween + dtMs / TWEEN_MS);
      // Ease-out cubic: fast start, gentle settle. Matches the camera focus easing.
      const e = 1 - Math.pow(1 - h.tween, 3);

      const target = STATE_STYLE[h.state];
      const abs = h.absorption.material as THREE.ShaderMaterial;
      const rim = h.rim.material as THREE.ShaderMaterial;

      abs.uniforms.uDensity.value = h.fromDensity + (target.density - h.fromDensity) * e;
      rim.uniforms.uRimGain.value = h.fromRim + (target.rimGain - h.fromRim) * e;

      const selected = h.state === 'selected';
      // The selected organ is drawn by bucket 3; its absorption shell fades to the
      // multiply identity (tint white, density 0) rather than being toggled off, so
      // there is no pop and no change in draw order.
      // Toward white while selected (the multiply identity, so bucket 1 contributes
      // nothing and bucket 3 owns the look), back to the organ's OWN dormant tint
      // otherwise — not to the shared pink, which is what erased the per-organ hue
      // the moment anything was hovered.
      const restTint = dormantTintFor(h.def.selectedColor);
      (abs.uniforms.uTint.value as THREE.Color).lerpColors(
        h.fromTint,
        h.state === 'selected' ? new THREE.Color(0xffffff) : restTint,
        e,
      );
      h.solid.visible = selected && e > 0.05;
      (h.solid.material as THREE.ShaderMaterial).uniforms.uOpacity.value = selected ? 0.92 * e : 0;

      if (h.fluid) h.fluid.visible = selected && e > 0.05;
    }
  }

  /** Uniform scale about the organ's own pivot — the sim-driven pulse (spec 6.7). */
  setScale(id: OrganId, scale: number): void {
    const h = this.organs.get(id);
    if (!h) return;
    const s = h.baseScale * scale;
    h.absorption.scale.setScalar(s);
    h.rim.scale.setScalar(s);
    h.solid.scale.setScalar(s);
    if (h.fluid) h.fluid.scale.setScalar(s * 0.94);
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
   * Manual back-to-front sort for bucket 3 (spec 6.2). At most five objects, so
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
      o.renderOrder = 30 + i;
    });
  }

  dispose(): void {
    for (const h of this.organs.values()) {
      h.geometry.dispose();
      (h.absorption.material as THREE.Material).dispose();
      (h.rim.material as THREE.Material).dispose();
      (h.solid.material as THREE.Material).dispose();
      if (h.fluid) (h.fluid.material as THREE.Material).dispose();
    }
  }
}

export function organDefs(): OrganDef[] {
  return FILE.organs;
}

export function giCentrelines(): { segment: string; points: [number, number, number][] }[] {
  return FILE.giCentrelines;
}

export function groupOffset(group: OrganDef['group']): [number, number, number] {
  return FILE.groupLayout[group].offset;
}
