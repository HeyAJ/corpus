import * as THREE from 'three';
import type { OrganId } from '../../../data/types';
import type { SimSnapshot } from '../../../bridge/types';
import { ANATOMY, atlasOf } from '../../../data/anatomy';
import type { OrganHandle } from '../../organs/OrganSet';
import type { GeometryFactory } from '../GeometryFactory';
import type { PartGeometry } from '../parts';
import { DETAIL_SPECS } from '../atlas/details';
import type { V3 } from '../sdf';
import { FlowField } from './FlowField';
import { createPartMaterial } from './PartMaterial';
import { patchForCut, setCut, sliceKeeps, type CutUniforms, type SlicePlane } from '../../materials/sliceCut';
import type { DetailContext, FlowSpec, OrganDetailSpec, PartHandle } from './types';

/**
 * THE INSIDE OF THE SELECTED ORGAN: MESHES, MATERIALS, PARTICLES AND THE FRAME LOOP.
 *
 * Who owns what. An atlas module (../atlas/<name>.detail.ts) owns only what is particular
 * to its organ: which streams run through it and what its parts do each frame. This class
 * owns everything that is the same for every organ: building the meshes from the parts the
 * geometry worker returns, colouring them from the atlas data, giving each a live glow
 * from the engine's activity index, fading an interior in and out, following the shell's
 * own beating and breathing, picking, labels. The seam between them is `./types.ts`.
 *
 * WHAT HAPPENS WHEN AN ORGAN IS SELECTED.
 *   1. `show()` asks the factory for the parts of the organ's atlas (a worker round trip,
 *      cached afterwards) and the atlas module for its flows. Until that resolves NOTHING
 *      is drawn, and if the user has selected something else by then the result is cached
 *      but not shown: a stale interior popping up over the wrong organ is worse than a
 *      short wait.
 *   2. The interior is a THREE.Group per organ instance (so the two kidneys each have
 *      one even though they share an atlas), kept after the first build. Reselecting an
 *      organ is therefore instant.
 *   3. Every frame the group copies the LIVE transform of the selected organ's shell
 *      (`handle.absorption`), which is where the heart's pulse and the lungs' inflation
 *      are applied, so the interior beats and breathes with the glass that holds it.
 *   4. Every frame the defaults are applied FIRST (each part in its data colour, glowing
 *      in proportion to its activity; each stream at rate 1) and the atlas module's
 *      `animate` second, so a module says only what is different about its organ. The call
 *      is wrapped: a module that throws is logged once per organ and skipped from then on,
 *      because one broken interior must not stop the frame loop for the whole body.
 *
 * NOTHING HERE WRITES TO THE SIMULATION.
 *
 * REDUCED MOTION. When the user asks for it, particles are held where they are (the streams
 * are stepped by zero seconds) while colours, glows and densities stay live. Whatever an
 * atlas module animates through `ctx.reducedMotion` is its own decision.
 *
 * THE DEBUG FALLBACK. While the per-organ part builders were being written, no organ had
 * any parts, and a framework that draws nothing cannot be seen working. When
 * `OrganDetail.debugFallback` is true (or `window.__corpusDetailDebug` is set before an
 * organ is selected) an atlas with NO parts is shown as three coloured spheres and one
 * looping stream inside the organ's bounding sphere. It is off by default, it never
 * applies to an atlas that has parts, and it carries no anatomy: it exists to prove the
 * pipeline, not to depict an organ.
 */

const PART_RENDER_ORDER = 31;
/**
 * GLASS PARTS. Many organs are a wall around something: the cortex around the thalamus,
 * a ventricle's muscle around its blood, a renal capsule around the pyramids. Drawn solid,
 * the wall is all anyone would ever see. So a part whose opacity an atlas module sets
 * below GLASS_BELOW is drawn as GLASS: it stops writing depth (so it cannot hide what is
 * behind it or inside it) and it is drawn AFTER the solid parts, which is the order that
 * makes it tint what lies behind it and be hidden by what lies in front of it. Its alpha
 * is also weighted towards its silhouette in the shader (see PartMaterial), so the middle
 * of a lobe is clear and its outline still reads. Two glass parts that overlap simply
 * blend; that is not order-independent, and at these opacities nobody can tell.
 *
 * This also removed a real artefact: neighbouring cortical slabs share a surface, and two
 * depth-writing meshes on one surface fight for every pixel in stripes.
 */
const GLASS_BELOW = 0.98;
const GLASS_RENDER_ORDER = 33;
const FLOW_RENDER_ORDER = 36;
const FADE_IN_S = 0.3;
const FADE_OUT_S = 0.2;
/** Parts other than the picked one are drawn at this fraction of their opacity. */
const DIMMED = 0.55;
/** Seconds for the highlight cue to settle. */
const HIGHLIGHT_TAU_S = 0.08;
/** The colour of a part whose id is not in the atlas data. */
const NEUTRAL = 0xc8b8aa;
/** Atlases whose interior changes with the gestational week. */
const WEEK_ATLASES = new Set(['uterus', 'fetus']);

interface DebugWindow {
  __corpusDetailDebug?: boolean;
}

/** One part: the mesh, its state for this frame, and the PartHandle an atlas module sees. */
class PartEntry implements PartHandle {
  readonly baseColor = new THREE.Color();
  readonly material: THREE.ShaderMaterial;
  readonly center = new THREE.Vector3();
  readonly color = new THREE.Color();
  glow = 0;
  opacity = 1;
  visible = true;
  readonly scale = new THREE.Vector3(1, 1, 1);
  readonly pivot = new THREE.Vector3();
  pivotGiven = false;
  readonly offset = new THREE.Vector3();
  /** Smoothed 0..1: 1 while this is the picked part. */
  hl = 0;
  /** Smoothed 0..1: 1 while another part is picked and this one is dimmed. */
  dim = 0;
  /** Whether the mesh is currently set up as glass (no depth write, drawn late). */
  glass = false;

  constructor(
    readonly id: string,
    readonly mesh: THREE.Mesh,
    colour: THREE.ColorRepresentation,
  ) {
    this.baseColor.set(colour);
    this.color.copy(this.baseColor);
    this.material = mesh.material as THREE.ShaderMaterial;
    this.material.uniforms.uColor.value = this.color;
    const geometry = mesh.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    geometry.boundingBox?.getCenter(this.center);
  }

  /** Back to what the atlas data says; the activity glow is set by the caller. */
  reset(): void {
    this.color.copy(this.baseColor);
    this.glow = 0;
    this.opacity = 1;
    this.visible = true;
    this.scale.set(1, 1, 1);
    this.pivotGiven = false;
    this.offset.set(0, 0, 0);
  }

  setColor(color: THREE.ColorRepresentation): void {
    this.color.set(color);
  }

  setGlow(glow: number): void {
    this.glow = Number.isFinite(glow) ? Math.max(0, Math.min(1, glow)) : 0;
  }

  setOpacity(opacity: number): void {
    this.opacity = Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
  }

  setScale(scale: number | V3, pivot?: V3): void {
    if (typeof scale === 'number') this.scale.set(scale, scale, scale);
    else this.scale.set(scale[0], scale[1], scale[2]);
    if (pivot) {
      this.pivot.set(pivot[0], pivot[1], pivot[2]);
      this.pivotGiven = true;
    } else {
      this.pivotGiven = false;
    }
  }

  setOffset(offset: V3): void {
    this.offset.set(offset[0], offset[1], offset[2]);
  }

  /**
   * Scaling a mesh scales about the ORIGIN of its geometry, which for an organ-frame part
   * is the organ's origin, far from the part. To scale about a pivot p, a vertex v goes
   * to p + s(v - p) = s v + (p - s p): scale the mesh by s and move it by (p - s p).
   */
  applyTransform(): void {
    const p = this.pivotGiven ? this.pivot : this.center;
    const s = this.scale;
    this.mesh.scale.copy(s);
    this.mesh.position.set(
      p.x - s.x * p.x + this.offset.x,
      p.y - s.y * p.y + this.offset.y,
      p.z - s.z * p.z + this.offset.z,
    );
  }
}

/** One organ's built interior. */
class Interior {
  readonly group = new THREE.Group();
  readonly parts = new Map<string, PartEntry>();
  readonly partList: PartEntry[] = [];
  readonly meshes: THREE.Mesh[] = [];
  flow: FlowField | null = null;
  readonly spec: OrganDetailSpec | undefined;
  /** 0..1 fade; the interior is detached when it reaches 0 while leaving. */
  fade = 0;
  fadeDirection = 1;
  /** Seconds since this interior was last shown from nothing. */
  time = 0;
  failedOnce = false;

  constructor(
    readonly organId: OrganId,
    readonly key: string,
    readonly handle: OrganHandle,
  ) {
    this.spec = DETAIL_SPECS[atlasOf(handle.def)];
  }

  dispose(): void {
    for (const p of this.partList) {
      p.mesh.geometry.dispose();
      p.material.dispose();
    }
    this.flow?.dispose();
    this.group.clear();
  }
}

type PartLabel = { id: string; x: number; y: number; visible: boolean };

export class OrganDetail {
  /** See the header. Off unless a developer turns it on. */
  static debugFallback = false;

  readonly root = new THREE.Group();

  private readonly cache = new Map<string, Interior>();
  private current: Interior | null = null;
  private readonly leaving = new Set<Interior>();
  private target: { id: OrganId; key: string } | null = null;
  private highlighted: string | null = null;
  /** The handle of the organ whose interior is wanted: its shell is cut with its parts. */
  private targetHandle: OrganHandle | null = null;
  /**
   * The slice plane in force (scene space), or null for the whole organ. The parts and the
   * streams read it every frame; the shell is updated when it changes (see setCut).
   */
  private cutPlane: SlicePlane | null = null;
  private cutEdge = 0;
  private viewport = { height: 900, fov: 40 };
  private readonly warned = new Set<string>();

  // The frame context, one object reused for every call of every module.
  private previousSnap: SimSnapshot | null = null;
  private currentSnap: SimSnapshot | null = null;
  private alpha = 0;
  private activeInterior: Interior | null = null;
  private readonly ctx: {
    organId: string;
    snapshot: SimSnapshot;
    dt: number;
    time: number;
    reducedMotion: boolean;
  } & Pick<DetailContext, 'activity' | 'lerp' | 'part' | 'flow'>;

  // Scratch for anchors() and pick().
  private readonly anchorOut: PartLabel[] = [];
  private readonly scratchV = new THREE.Vector3();

  constructor(private readonly factory: GeometryFactory) {
    this.root.name = 'OrganDetail';
    this.ctx = {
      organId: '',
      // Replaced before every call; a module is only invoked when a snapshot exists.
      snapshot: undefined as unknown as SimSnapshot,
      dt: 0,
      time: 0,
      reducedMotion: false,
      activity: (partId) => {
        const i = this.activeInterior;
        if (!i || !this.currentSnap) return 0;
        return this.currentSnap.anatomy.parts[`${i.organId}.${partId}`] ?? 0;
      },
      lerp: (pick) => {
        const cur = this.currentSnap;
        if (!cur) return 0;
        const prev = this.previousSnap;
        if (!prev) return pick(cur);
        const a = this.alpha;
        const p = pick(prev);
        return p + (pick(cur) - p) * a;
      },
      part: (id) => this.activeInterior?.parts.get(id),
      flow: (id) => this.activeInterior?.flow?.handle(id),
    };
    if (typeof window !== 'undefined' && (window as DebugWindow).__corpusDetailDebug) {
      OrganDetail.debugFallback = true;
    }
  }

  /** The organ whose interior is wanted (selected), whether or not it has been built yet. */
  get organId(): OrganId | null {
    return this.target?.id ?? null;
  }

  /** True once the wanted interior is built and attached (even if it has no parts). */
  get ready(): boolean {
    return this.current !== null && this.current.key === this.target?.key;
  }

  /* ----------------------------------------------------------------- show */

  /** Show the interior of this organ (builds and caches it the first time). */
  show(handle: OrganHandle, gestationWeeks: number): void {
    const atlas = atlasOf(handle.def);
    const week = Math.max(0, Math.round(Number.isFinite(gestationWeeks) ? gestationWeeks : 0));
    const key = WEEK_ATLASES.has(atlas) ? `${handle.id}:${week}` : handle.id;
    if (this.target && this.target.key === key) return;
    if (this.target?.id !== handle.id) this.highlighted = null;
    this.target = { id: handle.id, key };
    this.targetHandle = handle;

    // An interior of ANOTHER organ leaves at once; the same organ's previous week stays
    // until its replacement arrives, so the uterus does not blink at every week.
    if (this.current && this.current.organId !== handle.id) this.leave(this.current);

    const cached = this.cache.get(key);
    if (cached) {
      this.activate(cached);
      return;
    }

    const params = { organ: handle.id, gestationWeeks: week };
    void this.factory
      .parts(atlas, params)
      .then((parts) => {
        const interior = this.build(handle, key, atlas, parts);
        this.cache.set(key, interior);
        // Only if this is still what the user is looking at.
        if (this.target?.key === key) this.activate(interior);
        this.dropStale(handle.id, key);
      })
      .catch((error: unknown) => {
        console.error(`[corpus] could not build the interior of "${handle.id}"`, error);
      });
  }

  /** Fade the interior out and detach it. */
  hide(): void {
    this.target = null;
    this.targetHandle = null;
    this.highlighted = null;
    if (this.current) this.leave(this.current);
  }

  private activate(interior: Interior): void {
    if (this.current && this.current !== interior) this.leave(this.current);
    this.leaving.delete(interior);
    if (interior.fade <= 0) interior.time = 0;
    interior.fadeDirection = 1;
    if (interior.group.parent !== this.root) this.root.add(interior.group);
    interior.group.visible = true;
    this.current = interior;
  }

  private leave(interior: Interior): void {
    if (this.current === interior) this.current = null;
    interior.fadeDirection = -1;
    this.leaving.add(interior);
  }

  /** A week-keyed interior whose week has passed is not worth keeping. */
  private dropStale(organId: OrganId, keepKey: string): void {
    for (const [k, i] of this.cache) {
      if (i.organId !== organId || k === keepKey || !k.includes(':')) continue;
      if (i === this.current) continue;
      this.leaving.delete(i);
      this.root.remove(i.group);
      i.dispose();
      this.cache.delete(k);
    }
  }

  /* ---------------------------------------------------------------- build */

  private build(handle: OrganHandle, key: string, atlas: string, geometries: PartGeometry[]): Interior {
    const interior = new Interior(handle.id, key, handle);
    interior.group.name = `interior:${key}`;
    interior.group.visible = false;
    const data = ANATOMY[atlas]?.parts ?? [];

    let list: { id: string; geometry: THREE.BufferGeometry; colour: THREE.ColorRepresentation }[] = [];
    let flows: FlowSpec[] = [];

    if (geometries.length === 0 && this.debugEnabled()) {
      const fallback = this.debugFallbackFor(handle);
      list = fallback.parts;
      flows = fallback.flows;
    } else {
      list = geometries.map((g) => ({
        id: g.id,
        geometry: g.geometry,
        // A part the data does not know still draws, in a neutral colour.
        colour: data.find((d) => d.id === g.id)?.color ?? NEUTRAL,
      }));
      try {
        flows = interior.spec?.flows?.(handle.id) ?? [];
      } catch (error) {
        console.error(`[corpus] flows of "${handle.id}" failed`, error);
      }
    }

    // DEBUG ONLY: OrganSet turns a shell to glass when the atlas DATA lists parts. While the
    // data files are still empty that never happens and the opaque shell hides everything
    // drawn inside it, so with the debug hook on the shell is made glass here, exactly as
    // OrganSet does for an organ with parts. Without the hook this is never touched.
    if (this.debugEnabled() && list.length > 0) {
      const solid = handle.solid.material as THREE.ShaderMaterial;
      solid.depthWrite = false;
      solid.uniforms.uCore.value = 0.12;
    }

    for (const p of list) {
      const material = createPartMaterial({ color: p.colour });
      const mesh = new THREE.Mesh(p.geometry, material);
      mesh.renderOrder = PART_RENDER_ORDER;
      mesh.userData.partId = p.id;
      // Parts are moved and scaled per frame, and a stale bounding sphere would cull one
      // at the edge of the screen. There are few of them; culling is not worth the trap.
      mesh.frustumCulled = false;
      const entry = new PartEntry(p.id, mesh, p.colour);
      interior.parts.set(p.id, entry);
      interior.partList.push(entry);
      interior.meshes.push(mesh);
      interior.group.add(mesh);
    }

    if (flows.length > 0) {
      const field = new FlowField(flows);
      field.object.renderOrder = FLOW_RENDER_ORDER;
      field.setViewport(this.viewport.height, this.viewport.fov);
      interior.flow = field;
      interior.group.add(field.object);
    }
    return interior;
  }

  private debugEnabled(): boolean {
    if (OrganDetail.debugFallback) return true;
    return typeof window !== 'undefined' && (window as DebugWindow).__corpusDetailDebug === true;
  }

  /** Three spheres and one looping stream inside the organ's bounding sphere. */
  private debugFallbackFor(handle: OrganHandle): {
    parts: { id: string; geometry: THREE.BufferGeometry; colour: THREE.ColorRepresentation }[];
    flows: FlowSpec[];
  } {
    const sphere = handle.geometry.boundingSphere ?? new THREE.Sphere(new THREE.Vector3(), 0.05);
    const c = sphere.center;
    const r = Math.max(0.01, sphere.radius);
    const make = (dx: number, dy: number, dz: number): THREE.BufferGeometry => {
      const g = new THREE.SphereGeometry(r * 0.26, 24, 16);
      g.translate(c.x + dx * r, c.y + dy * r, c.z + dz * r);
      return g;
    };
    const ring: V3[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ring.push([c.x + Math.cos(a) * r * 0.55, c.y + Math.sin(a) * r * 0.55, c.z]);
    }
    return {
      parts: [
        { id: 'debug_a', geometry: make(-0.4, 0.25, 0), colour: 0x3a78c8 },
        { id: 'debug_b', geometry: make(0.4, 0.25, 0), colour: 0x3fae5a },
        { id: 'debug_c', geometry: make(0, -0.4, 0), colour: 0xd8a02a },
      ],
      flows: [{ id: 'debug_stream', path: ring, count: 120, size: r * 0.05, color: 0xc8323a, speed: r * 1.5, spread: r * 0.05, closed: true }],
    };
  }

  /* --------------------------------------------------------------- update */

  /** Per frame. Applies defaults, then the atlas module's animate(). */
  update(
    dtSeconds: number,
    current: SimSnapshot | null,
    previous: SimSnapshot | null,
    alpha: number,
    reducedMotion: boolean,
  ): void {
    const dt = Math.max(0, Math.min(0.1, Number.isFinite(dtSeconds) ? dtSeconds : 0));
    this.currentSnap = current;
    this.previousSnap = previous;
    this.alpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0;

    if (this.current) this.step(this.current, dt, reducedMotion, true);
    if (this.leaving.size > 0) {
      for (const i of this.leaving) {
        this.step(i, dt, reducedMotion, false);
        if (i.fade <= 0) {
          this.leaving.delete(i);
          this.root.remove(i.group);
          i.group.visible = false;
        }
      }
    }
  }

  private step(interior: Interior, dt: number, reducedMotion: boolean, animate: boolean): void {
    // FADE.
    if (interior.fadeDirection > 0) interior.fade = Math.min(1, interior.fade + dt / FADE_IN_S);
    else interior.fade = Math.max(0, interior.fade - dt / FADE_OUT_S);
    const fade = interior.fade * interior.fade * (3 - 2 * interior.fade);
    interior.time += dt;

    // FOLLOW THE SHELL: the organ's live transform, pulse and pose included.
    const abs = interior.handle.absorption;
    interior.group.position.copy(abs.position);
    interior.group.quaternion.copy(abs.quaternion);
    interior.group.scale.copy(abs.scale);

    // DEFAULTS.
    const parts = this.currentSnap?.anatomy.parts;
    for (const p of interior.partList) {
      p.reset();
      p.glow = parts ? (parts[`${interior.organId}.${p.id}`] ?? 0) : 0;
    }
    interior.flow?.resetDefaults();

    // THE ATLAS MODULE.
    const snap = this.currentSnap;
    const animateFn = interior.spec?.animate;
    if (animate && animateFn && snap && !interior.failedOnce) {
      const ctx = this.ctx;
      this.activeInterior = interior;
      ctx.organId = interior.organId;
      ctx.snapshot = snap;
      ctx.dt = dt;
      ctx.time = interior.time;
      ctx.reducedMotion = reducedMotion;
      try {
        animateFn(ctx);
      } catch (error) {
        interior.failedOnce = true;
        if (!this.warned.has(interior.organId)) {
          this.warned.add(interior.organId);
          console.error(`[corpus] the detail module of "${interior.organId}" threw and is disabled`, error);
        }
      }
      this.activeInterior = null;
    }

    // APPLY to the materials and meshes.
    const pick = this.highlighted;
    const blend = 1 - Math.exp(-dt / HIGHLIGHT_TAU_S);
    for (const p of interior.partList) {
      const hlTarget = pick !== null && p.id === pick ? 1 : 0;
      const dimTarget = pick !== null && p.id !== pick ? 1 : 0;
      p.hl += (hlTarget - p.hl) * blend;
      p.dim += (dimTarget - p.dim) * blend;
      const u = p.material.uniforms;
      u.uGlow.value = p.glow;
      u.uHighlight.value = p.hl;
      // The picked part is never glass: picking a lobe from the list should show the lobe.
      const own = p.opacity + (1 - p.opacity) * p.hl;
      const glass = own < GLASS_BELOW;
      if (glass !== p.glass) {
        p.glass = glass;
        p.material.depthWrite = !glass;
        p.mesh.renderOrder = glass ? GLASS_RENDER_ORDER : PART_RENDER_ORDER;
      }
      u.uGlass.value = glass ? 1 : 0;
      const opacity = own * fade * (1 - (1 - DIMMED) * p.dim);
      u.uOpacity.value = opacity;
      p.mesh.visible = p.visible && opacity > 0.003;
      p.applyTransform();
    }

    // THE CUT. Only the interior being shown is steered by the slice; one fading out keeps
    // the cut it had so it does not pop whole again while it leaves.
    if (animate) {
      const plane = this.cutPlane;
      for (const p of interior.partList) setCut(p.material.userData.cut as CutUniforms, plane, this.cutEdge);
      if (interior.flow) setCut(interior.flow.cut, plane);
    }

    if (interior.flow) {
      interior.flow.setFade(fade);
      interior.flow.object.visible = fade > 0.003;
      interior.flow.update(reducedMotion ? 0 : dt);
    }
  }

  setViewport(heightPx: number, fovDegrees: number): void {
    this.viewport.height = heightPx;
    this.viewport.fov = fovDegrees;
    for (const i of this.cache.values()) i.flow?.setViewport(heightPx, fovDegrees);
  }

  /* ----------------------------------------------------------------- slice */

  /**
   * Cut the selected organ with a plane, or restore it whole with null. The parts and the
   * streams follow the plane on their next frame; the organ's own shell (all four of its
   * materials: the absorption wall, the rim, the bucket-3 solid and the fluid of a stomach
   * or bladder) is cut here and now, because it belongs to OrganSet and is not stepped by
   * this class. The shell materials are spliced for the cut the first time a slice is
   * asked for (a one-off recompile; every shell of one kind shares a program) and are
   * switched off, not unspliced, when the slice ends. Nothing else in the body is touched.
   * The plane object is copied, so the caller may reuse its own.
   */
  setCut(plane: SlicePlane | null, edge = 0): void {
    this.cutEdge = edge;
    if (plane) {
      const own = this.cutPlane ?? { nx: 0, ny: 0, nz: 0, w: 0 };
      own.nx = plane.nx;
      own.ny = plane.ny;
      own.nz = plane.nz;
      own.w = plane.w;
      this.cutPlane = own;
    } else {
      this.cutPlane = null;
    }
    const h = this.targetHandle;
    if (!h) return;
    const mats = [h.absorption.material, h.rim.material, h.solid.material, h.fluid?.material];
    for (const m of mats) {
      if (!m) continue;
      const material = m as THREE.ShaderMaterial;
      if (!this.cutPlane && !material.userData.cut) continue;
      setCut(patchForCut(material), this.cutPlane, edge);
    }
  }

  /** The slice plane in force, or null. Picking uses it to ignore what was cut away. */
  get cut(): SlicePlane | null {
    return this.cutPlane;
  }

  /**
   * The bounding sphere of one part of the open organ, in the BODY frame (+x = the
   * patient's right): centre into `out`, radius returned, or -1 when there is no such part.
   * It goes through the part's own pose and the shell's live transform, as the labels do.
   */
  partSphere(partId: string, out: THREE.Vector3): number {
    const interior = this.current;
    const p = interior?.parts.get(partId);
    if (!interior || !p) return -1;
    const geometry = p.mesh.geometry;
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere;
    if (!sphere) return -1;
    interior.group.updateMatrix();
    p.mesh.updateMatrix();
    out.copy(sphere.center).applyMatrix4(p.mesh.matrix).applyMatrix4(interior.group.matrix);
    return sphere.radius * Math.max(p.mesh.scale.x, p.mesh.scale.y, p.mesh.scale.z) * interior.group.scale.x;
  }

  /* ----------------------------------------------------------- interaction */

  /** Nearest part under a ray already set on the raycaster, or null. */
  pick(raycaster: THREE.Raycaster, outPoint?: THREE.Vector3): string | null {
    const interior = this.current;
    if (!interior || interior.fade < 0.3) return null;
    // Raycaster does not look at `visible`, so a part an atlas module has hidden would
    // still be hit. A tap is rare; filtering here costs nothing that matters.
    const targets = interior.meshes.filter((m) => m.visible);
    if (targets.length === 0) return null;
    const allHits = raycaster.intersectObjects(targets, false);
    // WHAT THE SLICE REMOVED CANNOT BE TAPPED. The raycaster knows nothing of the shader's
    // discard, so a hit inside the removed half would pick a part the eye cannot see and
    // the tap would not go through to what is visible behind it. Drop those hits; the
    // back wall of a cut solid part lies in the kept half and is still found.
    const plane = this.cutPlane;
    const hits = plane
      ? allHits.filter((h) => sliceKeeps(plane, h.point.x, h.point.y, h.point.z))
      : allHits;
    if (hits.length === 0) return null;
    // A tap goes to what the user SEES as a thing: the nearest solid part under the finger,
    // through any glass in front of it. Only where there is nothing but glass does the tap
    // pick the glass, so the cortex is still pickable everywhere a nucleus is not behind it.
    for (const hit of hits) {
      const id = hit.object.userData.partId as string | undefined;
      if (id && interior.parts.get(id)?.glass === false) {
        outPoint?.copy(hit.point);
        return id;
      }
    }
    outPoint?.copy(hits[0].point);
    return (hits[0].object.userData.partId as string | undefined) ?? null;
  }

  /** Mark one part as picked (white rim), others dimmed slightly; null clears. */
  highlight(partId: string | null): void {
    this.highlighted = partId;
  }

  /** Screen anchors of the visible parts, for labels. Reuses its output array. */
  anchors(camera: THREE.Camera, widthPx: number, heightPx: number, mirrorX: number): PartLabel[] {
    const out = this.anchorOut;
    const interior = this.current;
    if (!interior || interior.fade < 0.3) {
      out.length = 0;
      return out;
    }
    interior.group.updateMatrix();
    let n = 0;
    for (const p of interior.partList) {
      if (!p.mesh.visible) continue;
      // Body frame: the part's centre through its own pose and the organ's live
      // transform, then the renderer's mirror, then the camera. Done by hand rather than
      // from matrixWorld because that is only refreshed at render time, a frame late.
      p.mesh.updateMatrix();
      const v = this.scratchV.copy(p.center).applyMatrix4(p.mesh.matrix).applyMatrix4(interior.group.matrix);
      v.x *= mirrorX;
      v.project(camera);
      const x = (v.x * 0.5 + 0.5) * widthPx;
      const y = (-v.y * 0.5 + 0.5) * heightPx;
      let slot = out[n];
      if (!slot) {
        slot = { id: '', x: 0, y: 0, visible: false };
        out[n] = slot;
      }
      slot.id = p.id;
      slot.x = x;
      slot.y = y;
      slot.visible = v.z < 1 && x > 0 && x < widthPx && y > 0 && y < heightPx;
      n++;
    }
    out.length = n;
    return out;
  }

  dispose(): void {
    for (const i of this.cache.values()) i.dispose();
    this.cache.clear();
    this.leaving.clear();
    this.current = null;
    this.target = null;
    this.root.clear();
  }
}
