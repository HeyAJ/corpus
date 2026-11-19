import * as THREE from 'three';
import type { GeometryFactory } from '../anatomy/GeometryFactory';
import type { OrganSet } from '../organs/OrganSet';
import { createBodyGlassMaterial, createContactShadowMaterial } from '../materials/BodyGlass';
import { organSamples } from './organSamples';
import type { OutlineBody } from './outlineModel';

/**
 * THE GLASS FIGURE IN THE SCENE: owns the mesh, the floor shadow, and the decision of
 * when to rebuild either. See outlineModel.ts for what the shape is and is not, and
 * materials/BodyGlass.ts for how it is drawn.
 *
 * WHEN IT REBUILDS. The figure is fitted to the organs this body actually has, so it is
 * rebuilt when (a) the sex or the gestational week changes, or (b) the set of organ
 * shells changes, which happens a dozen times in the first second as the worker
 * delivers them and again when the sex is switched. Both are folded into one cheap
 * signature checked four times a second; a rebuild is then started at most every
 * REBUILD_INTERVAL_MS and never while another is in flight, so a pregnancy time-lapse
 * (which changes the week many times a second) asks the worker for two figures a second
 * at most and the figure follows a little behind the uterus rather than queueing work.
 *
 * It does not allocate per frame: `update` is arithmetic on a few numbers.
 *
 * WHAT DRAWS WHEN. The group is renderOrder 5, before the organ buckets (10, 20, 30), so
 * the organs sit inside it by order alone: nothing here writes or tests depth. It is not
 * in the organ set's pick list, and its raycast is disabled besides, so a tap on the
 * chest selects the organ under it.
 */

/** Longest rate at which the figure is rebuilt, milliseconds. The brief's "twice a second". */
export const REBUILD_INTERVAL_MS = 500;
/** How often the organ signature is looked at, milliseconds. A cost choice. */
const SIGNATURE_INTERVAL_MS = 250;
/** Opacity of the figure while an organ is open, as a fraction of its resting opacity. A DISPLAY choice ("about a third"). */
export const FOCUS_OPACITY = 0.33;
/** Rate at which the figure fades between its two opacities, per second. A DISPLAY choice. */
const FADE_RATE_PER_S = 6;
/** The shadow quad's extent as a multiple of the figure's, in x and in z. A DISPLAY choice. */
const SHADOW_SPREAD_X = 1.25;
const SHADOW_SPREAD_Z = 2.2;
/** How far under the figure's lowest point the floor is implied, metres. A DISPLAY choice. */
const FLOOR_GAP_M = 0.012;

export class BodyOutline {
  readonly root = new THREE.Group();
  private readonly glass = createBodyGlassMaterial();
  private readonly shadowMaterial = createContactShadowMaterial(0.08);
  private readonly mesh: THREE.Mesh;
  private readonly shadow: THREE.Mesh;

  private switchedOn = true;
  private focused = false;
  private level = 0;
  private hasMesh = false;

  private body: OutlineBody = { sex: 'male', weeks: 0 };
  private dirty = true;
  private inFlight = false;
  private sequence = 0;
  private lastBuildAt = -Infinity;
  private lastCheckAt = -Infinity;
  private lastSignature = NaN;
  private readonly cache = new Map<number, Float32Array>();

  /** What the last build produced, for the performance report. */
  triangles = 0;
  buildMs = 0;

  constructor(
    private readonly factory: GeometryFactory,
    private readonly organs: OrganSet,
  ) {
    this.root.renderOrder = 5;
    this.root.visible = false;

    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.glass);
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
    // Not pickable, by belt and braces: it is not in OrganSet.pickTargets either.
    this.mesh.raycast = () => undefined;

    const quad = new THREE.PlaneGeometry(1, 1);
    quad.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(quad, this.shadowMaterial);
    this.shadow.renderOrder = 0;
    this.shadow.frustumCulled = false;
    this.shadow.raycast = () => undefined;
    this.shadow.visible = false;

    this.root.add(this.shadow, this.mesh);
  }

  get visible(): boolean {
    return this.switchedOn;
  }

  setVisible(on: boolean): void {
    this.switchedOn = on;
  }

  /** Fade to a third while an organ is open, so the open organ owns the picture. */
  setFocus(on: boolean): void {
    this.focused = on;
  }

  /** The body's sex and gestational week (0 when not pregnant). Cheap to call every snapshot. */
  setBody(sex: 'male' | 'female', weeks: number): void {
    const w = Number.isFinite(weeks) ? Math.max(0, Math.round(weeks)) : 0;
    if (sex === this.body.sex && w === this.body.weeks) return;
    this.body = { sex, weeks: w };
    this.dirty = true;
  }

  /** The organ shells' identity folded into one number; changes when any shell arrives or is replaced. */
  private signature(): number {
    let sig = this.body.weeks * 7 + (this.body.sex === 'male' ? 1 : 2);
    let i = 1;
    for (const h of this.organs.organs.values()) {
      i++;
      if (h.built && h.wanted) sig += h.geometry.id * i;
    }
    return sig;
  }

  /** Concatenate the points of every organ this body has. Runs only when a rebuild starts. */
  private collect(): Float32Array {
    const parts: Float32Array[] = [];
    const seen = new Set<number>();
    let total = 0;
    for (const h of this.organs.organs.values()) {
      if (!h.built || !h.wanted) continue;
      // The fetus lies inside the uterus by construction. A gravid uterus is rebuilt per
      // week in the worker and its mesh may lag the week, so the model draws its own
      // from `gravidBody(weeks)`, the rule that builds the mesh, and the mesh is left out.
      if (h.id === 'fetus') continue;
      if (h.id === 'uterus' && this.body.weeks >= 6) continue;
      const id = h.geometry.id;
      seen.add(id);
      let s = this.cache.get(id);
      if (!s) {
        s = organSamples(h.def, h.geometry);
        this.cache.set(id, s);
      }
      parts.push(s);
      total += s.length;
    }
    for (const key of this.cache.keys()) if (!seen.has(key)) this.cache.delete(key);
    const out = new Float32Array(total);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }

  private rebuild(nowMs: number): void {
    this.inFlight = true;
    this.dirty = false;
    this.lastBuildAt = nowMs;
    const seq = ++this.sequence;
    const body = this.body;
    const samples = this.collect();
    const started = performance.now();
    this.factory
      .outline(samples, body)
      .then(({ geometry, info }) => {
        this.inFlight = false;
        if (seq !== this.sequence) {
          geometry.dispose();
          return;
        }
        this.mesh.geometry.dispose();
        this.mesh.geometry = geometry;
        this.hasMesh = true;
        this.triangles = info.triangles;
        this.buildMs = performance.now() - started;

        // The floor shadow sits just under the lowest point of the figure and is sized
        // from the figure's own footprint.
        const box = geometry.boundingBox;
        const cz = box ? (box.min.z + box.max.z) / 2 : 0;
        this.shadow.position.set(0, info.floorY - FLOOR_GAP_M, cz);
        this.shadow.scale.set(info.halfX * 2 * SHADOW_SPREAD_X, 1, info.halfZ * 2 * SHADOW_SPREAD_Z);
        this.shadow.visible = true;
      })
      .catch(() => {
        // A failed build leaves the previous figure (or none); try again on the next change.
        this.inFlight = false;
        this.dirty = true;
      });
  }

  update(dtSeconds: number, nowMs: number, reducedMotion: boolean): void {
    if (nowMs - this.lastCheckAt >= SIGNATURE_INTERVAL_MS) {
      this.lastCheckAt = nowMs;
      const sig = this.signature();
      if (sig !== this.lastSignature) {
        this.lastSignature = sig;
        this.dirty = true;
      }
    }
    if (this.dirty && !this.inFlight && nowMs - this.lastBuildAt >= REBUILD_INTERVAL_MS) {
      this.rebuild(nowMs);
    }

    const target = this.switchedOn && this.hasMesh ? (this.focused ? FOCUS_OPACITY : 1) : 0;
    if (reducedMotion) this.level = target;
    else this.level += (target - this.level) * (1 - Math.exp(-dtSeconds * FADE_RATE_PER_S));
    if (Math.abs(this.level - target) < 0.002) this.level = target;
    this.glass.uniforms.uOpacity.value = this.level;
    this.shadowMaterial.uniforms.uStrength.value = 0.08 * this.level;
    this.root.visible = this.level > 0;
  }

  dispose(): void {
    this.sequence++;
    this.mesh.geometry.dispose();
    this.shadow.geometry.dispose();
    this.glass.dispose();
    this.shadowMaterial.dispose();
  }
}
