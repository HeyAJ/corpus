import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

import { OrganSet, type OrganState } from '../organs/OrganSet';
import { OrbitRig } from '../camera/OrbitRig';
import { createDitherPass } from '../postfx/DitherPass';
import { GiBolus } from '../organs/GiBolus';
import { AirwayCue } from '../organs/AirwayCue';
import { VascularSystem } from '../vascular/VascularSystem';
import type { OrganId } from '../../data/types';
import type { SimSnapshot } from '../../bridge/types';

/**
 * LAYER B — the renderer.
 *
 * Reads snapshots. Never writes sim state. React never touches this canvas.
 *
 * INTERPOLATION (spec 3): snapshots arrive at 20 Hz and the renderer runs at 60+.
 * Every animated quantity is therefore interpolated between the last two snapshots
 * using the wall-clock time since the newer one. Without this you get 20 fps
 * visuals on a 60 fps render loop, and it looks exactly as bad as it sounds.
 *
 * POST CHAIN ORDER (spec 6.6):
 *   Scene -> UnrealBloom -> ACES + warm grade -> ORDERED DITHER -> vignette -> output
 * The dither is the last thing before output and runs at native device resolution.
 */

export type BackgroundMode = 'idle' | 'active' | 'arrest';

const BACKGROUNDS: Record<BackgroundMode, number> = {
  idle: 0xf0f0f0,
  active: 0xf6f4e4,
  arrest: 0xfbf3d0,
};

export interface ViewerCallbacks {
  onHover?: (id: OrganId | null) => void;
  onSelect?: (id: OrganId | null) => void;
  /** Screen-space label anchors, recomputed each frame (spec 6.4). */
  onLabels?: (labels: { id: OrganId; x: number; y: number; visible: boolean }[]) => void;
}

interface SnapshotPair {
  previous: SimSnapshot | null;
  current: SimSnapshot | null;
  receivedAt: number;
  intervalMs: number;
}

export class Viewer {
  readonly scene = new THREE.Scene();
  readonly rig: OrbitRig;
  readonly organs = new OrganSet();
  readonly renderer: THREE.WebGLRenderer;

  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private dither: ReturnType<typeof createDitherPass>;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerInside = false;
  private bolus: GiBolus;
  private airway: AirwayCue;
  private vascular: VascularSystem;

  /**
   * Touch gesture state. The Viewer owns touch directly on its own canvas so App.tsx
   * (which we must not edit) needs no changes; the one hazard is that a browser fires
   * BOTH a PointerEvent and a TouchEvent for the same finger, and App's PointerEvent
   * path would then orbit alongside this one. `touchActive` is the guard: while a
   * touch gesture is running, handlePointerMove leaves the orbit to the touch path.
   */
  private touchActive = false;
  private touchMode: 'none' | 'orbit' | 'pinch' = 'none';
  private lastTouchX = 0;
  private lastTouchY = 0;
  private lastTouchDist = 0;
  private boundTouchStart?: (e: TouchEvent) => void;
  private boundTouchMove?: (e: TouchEvent) => void;
  private boundTouchEnd?: (e: TouchEvent) => void;

  private snapshots: SnapshotPair = { previous: null, current: null, receivedAt: 0, intervalMs: 50 };
  private lastFrameTime = 0;
  private running = false;
  private rafId = 0;

  private hovered: OrganId | null = null;
  private selected: OrganId | null = null;
  private callbacks: ViewerCallbacks = {};
  private backgroundMode: BackgroundMode = 'idle';
  private backgroundColor = new THREE.Color(BACKGROUNDS.idle);
  private targetBackground = new THREE.Color(BACKGROUNDS.idle);

  private labelBuffer: { id: OrganId; x: number; y: number; visible: boolean }[] = [];
  private projected = new THREE.Vector3();

  /** Set from the store; freezes organ motion but leaves numbers live (spec 10.6). */
  reducedMotion = false;

  frameTimes: number[] = [];

  /*
   * ADAPTIVE RESOLUTION. The body renders through a composer (bloom, dither) at the
   * device pixel ratio, and on a phone at 2x or 3x that is several times the pixels of
   * the screen's CSS size for a picture whose whole look is soft translucent shells. So
   * a touch device starts at 1.5x rather than 2x, and every second the loop checks its
   * own frame times: sustained frames slower than ~24 ms step the ratio down by a
   * quarter (never below 1), and a device comfortably holding its refresh rate steps
   * back up. Smooth motion is worth more here than the last few percent of sharpness.
   */
  private maxDpr = Math.min(
    typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
    typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches ? 1.5 : 2,
  );
  private dpr = this.maxDpr;
  private framesSinceCheck = 0;
  private lastDprChange = 0;
  /** Rounded label positions last sent to React, so an unmoving body sends nothing. */
  private lastLabelKey = '';

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(canvas.clientWidth || 1, canvas.clientHeight || 1, false);
    // Tone mapping happens in the dither/grade pass, not here: the dither must be
    // applied after tone mapping or the pattern stops being uniform across the
    // tonal range.
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

    this.scene.background = this.backgroundColor;
    this.scene.add(this.organs.root);

    this.bolus = new GiBolus();
    this.scene.add(this.bolus.root);

    // The inhaled/nebulised route made visible: cool tinted air drawn down the airway
    // on inspiration. Additive bucket (renderOrder 22), the same bucket the vascular
    // particles use, so it commutes with them and the order-independence claim holds.
    this.airway = new AirwayCue();
    this.scene.add(this.airway.root);

    // Vessels in bucket 1 and flow particles in bucket 2, so the order-independence
    // guarantee is untouched: both land in buckets that already exist.
    this.vascular = new VascularSystem();
    this.scene.add(this.vascular.root);

    const aspect = (canvas.clientWidth || 1) / (canvas.clientHeight || 1);
    this.rig = new OrbitRig(aspect, 21);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.rig.camera));

    // THRESHOLD IS THE WHOLE TRICK HERE, and it is easy to get wrong.
    //
    // Bloom runs on the LINEAR scene buffer, where the cream background is already
    // 0.86. A threshold below that blooms the background itself and the entire
    // frame turns into white haze. The threshold must sit ABOVE the background so
    // that only pixels the additive rim has pushed past it bloom — which is exactly
    // the reference's behaviour: a halo around the organ outlines and nowhere else.
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(canvas.clientWidth || 1, canvas.clientHeight || 1),
      0.30, // strength
      0.35, // radius
      0.95, // threshold — above the 0.86 linear background, below background + rim
    );
    this.composer.addPass(this.bloom);

    // LAST PASS. The dither/grade pass does its own tone map and its own
    // linear-to-display conversion, and it is deliberately the final pass so the
    // grid lands on the composited image at native device resolution.
    //
    // There is NO OutputPass after it. OutputPass would apply a second sRGB
    // encode on top of ours, and the result is a washed-out image that looks like
    // the absorption material is broken when in fact the colour pipeline is.
    this.dither = createDitherPass({ dotSize: 3.0, strength: 0.12, vignette: 0.1 });
    this.composer.addPass(this.dither);

    this.resize();
    this.attachTouch();
  }

  /* --------------------------------------------------------------- touch */

  /**
   * Attach touch handlers to our own canvas so the body is fully movable by finger:
   * one finger orbits, two fingers pinch to zoom. App.tsx already routes PointerEvents
   * here for the mouse, and touch also produces PointerEvents, so the guard in
   * handlePointerMove stops the two from orbiting the same drag twice. We preventDefault
   * on the touch moves to stop the page itself panning or pinch-zooming underneath us.
   */
  attachTouch(): void {
    const canvas = this.renderer.domElement;

    const norm = (t: Touch): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((t.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        y: -(((t.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1),
      };
    };
    const dist = (a: Touch, b: Touch): number => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

    this.boundTouchStart = (e: TouchEvent) => {
      this.touchActive = true;
      if (e.touches.length >= 2) {
        this.touchMode = 'pinch';
        this.lastTouchDist = dist(e.touches[0], e.touches[1]);
      } else {
        this.touchMode = 'orbit';
        const n = norm(e.touches[0]);
        this.lastTouchX = n.x;
        this.lastTouchY = n.y;
      }
      e.preventDefault();
    };

    this.boundTouchMove = (e: TouchEvent) => {
      if (this.touchMode === 'pinch' && e.touches.length >= 2) {
        const d = dist(e.touches[0], e.touches[1]);
        if (this.lastTouchDist > 0) this.handlePinch(d / this.lastTouchDist);
        this.lastTouchDist = d;
      } else if (e.touches.length >= 1) {
        // Fall back to orbit if a finger was lifted from a pinch mid-gesture.
        if (this.touchMode !== 'orbit') {
          this.touchMode = 'orbit';
          const n0 = norm(e.touches[0]);
          this.lastTouchX = n0.x;
          this.lastTouchY = n0.y;
        }
        const n = norm(e.touches[0]);
        const dx = n.x - this.lastTouchX;
        const dy = n.y - this.lastTouchY;
        // Same sign convention as the mouse path in handlePointerMove.
        this.rig.orbit(-dx, -dy);
        this.lastTouchX = n.x;
        this.lastTouchY = n.y;
      }
      e.preventDefault();
    };

    this.boundTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        // Cleared before App's compatibility pointerup fires, so a tap still selects.
        this.touchActive = false;
        this.touchMode = 'none';
      } else if (e.touches.length === 1) {
        this.touchMode = 'orbit';
        const n = norm(e.touches[0]);
        this.lastTouchX = n.x;
        this.lastTouchY = n.y;
      }
    };

    canvas.addEventListener('touchstart', this.boundTouchStart, { passive: false });
    canvas.addEventListener('touchmove', this.boundTouchMove, { passive: false });
    canvas.addEventListener('touchend', this.boundTouchEnd);
    canvas.addEventListener('touchcancel', this.boundTouchEnd);
  }

  private detachTouch(): void {
    const canvas = this.renderer.domElement;
    if (this.boundTouchStart) canvas.removeEventListener('touchstart', this.boundTouchStart);
    if (this.boundTouchMove) canvas.removeEventListener('touchmove', this.boundTouchMove);
    if (this.boundTouchEnd) {
      canvas.removeEventListener('touchend', this.boundTouchEnd);
      canvas.removeEventListener('touchcancel', this.boundTouchEnd);
    }
  }

  setCallbacks(cb: ViewerCallbacks): void {
    this.callbacks = cb;
  }

  /* --------------------------------------------------------------- input */

  handlePointerMove(x: number, y: number, dragging: boolean, dx: number, dy: number): void {
    this.pointer.set(x, y);
    this.pointerInside = true;
    // While a touch gesture is running, the Viewer's own touch handler is already
    // orbiting; letting the PointerEvent that the same finger also generates orbit here
    // would double the drag. The mouse never sets touchActive, so it is unaffected.
    if (dragging && !this.touchActive) this.rig.orbit(-dx, -dy);
  }

  handlePointerLeave(): void {
    this.pointerInside = false;
    this.setHover(null);
  }

  handleWheel(delta: number): void {
    this.rig.dolly(delta);
  }

  handlePinch(scale: number): void {
    this.rig.zoomBy(scale);
  }

  handleTap(x: number, y: number): void {
    this.pointer.set(x, y);
    const hit = this.pick();
    this.select(hit);
  }

  select(id: OrganId | null): void {
    if (this.selected === id) return;
    this.selected = id;
    this.organs.clearStates(id ?? undefined);
    if (id) {
      const h = this.organs.organs.get(id);
      this.organs.setState(id, 'selected');
      if (h) this.rig.focus(h.centroid, h.boundingRadius);
    } else {
      this.rig.reset();
    }
    this.callbacks.onSelect?.(id);
  }

  private setHover(id: OrganId | null): void {
    if (this.hovered === id) return;
    if (this.hovered && this.hovered !== this.selected) this.organs.setState(this.hovered, 'dormant');
    this.hovered = id;
    if (id && id !== this.selected) this.organs.setState(id, 'hovered');
    this.callbacks.onHover?.(id);
  }

  private pick(): OrganId | null {
    this.raycaster.setFromCamera(this.pointer, this.rig.camera);
    const hits = this.raycaster.intersectObjects(this.organs.pickTargets, false);
    if (hits.length === 0) return null;
    // Nearest hit wins. Because the absorption meshes are DoubleSide, a ray through
    // a hollow shell hits both walls; taking the first is the front wall, which is
    // what the user is pointing at.
    return (hits[0].object.userData.organId as OrganId) ?? null;
  }

  /* ------------------------------------------------------------ snapshots */

  /** Show or hide the vascular overlay. Wired to the blood-drop tool button. */
  setVascularVisible(on: boolean): void {
    this.vascular.setVisible(on);
  }

  /** Triangles the vascular overlay adds, for the performance report. */
  get vascularTriangles(): number {
    return this.vascular.triangleCount;
  }

  pushSnapshot(s: SimSnapshot): void {
    const now = performance.now();
    this.vascular.pushSnapshot(s);
    if (this.snapshots.current) {
      this.snapshots.intervalMs = Math.max(8, Math.min(200, now - this.snapshots.receivedAt));
    }
    this.snapshots.previous = this.snapshots.current;
    this.snapshots.current = s;
    this.snapshots.receivedAt = now;
  }

  /** Interpolation factor for the current frame, 0..1 with a small extrapolation cap. */
  private alpha(now: number): number {
    const { receivedAt, intervalMs } = this.snapshots;
    return Math.max(0, Math.min(1.25, (now - receivedAt) / intervalMs));
  }

  private lerpSnapshot(pick: (s: SimSnapshot) => number, now: number): number {
    const { previous, current } = this.snapshots;
    if (!current) return 0;
    if (!previous) return pick(current);
    const a = Math.min(1, this.alpha(now));
    const p = pick(previous);
    const c = pick(current);
    return p + (c - p) * a;
  }

  setBackgroundMode(mode: BackgroundMode): void {
    if (this.backgroundMode === mode) return;
    this.backgroundMode = mode;
    this.targetBackground.setHex(BACKGROUNDS[mode]);
  }

  /* ---------------------------------------------------------------- loop */

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameTime = performance.now();
    const loop = () => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(loop);
      this.frame();
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private frame(): void {
    const now = performance.now();
    const dtMs = now - this.lastFrameTime;
    this.lastFrameTime = now;

    this.frameTimes.push(dtMs);
    if (this.frameTimes.length > 240) this.frameTimes.shift();
    this.adaptResolution(now);

    this.backgroundColor.lerp(this.targetBackground, Math.min(1, dtMs / 400));

    if (this.pointerInside && !this.selected) {
      this.setHover(this.pick());
    }

    this.organs.update(dtMs);
    this.vascular.update(dtMs / 1000);
    this.airway.update(dtMs / 1000, this.snapshots.current);
    this.rig.update(dtMs);
    this.applySnapshotToScene(now);
    this.organs.sortSolidBucket(this.rig.camera);
    this.emitLabels();

    this.composer.render();
  }

  /**
   * Everything animated in the body is driven from the snapshot. No CSS, no GSAP,
   * no keyframes anywhere near a physiological quantity (spec 6.7).
   */
  private applySnapshotToScene(now: number): void {
    const s = this.snapshots.current;
    if (!s) return;

    if (this.reducedMotion) {
      this.organs.setScale('heart', 1);
      this.organs.setScale('lung_l', 1);
      this.organs.setScale('lung_r', 1);
    } else {
      // HEART. Scale follows chamber volume, so systolic contraction is fast and
      // diastolic filling is slow — which is what makes it look alive. A symmetric
      // sine reads as fake immediately.
      const lv = this.lerpSnapshot((x) => x.cardio.lvVolume_mL, now);
      const rv = this.lerpSnapshot((x) => x.cardio.rvVolume_mL, now);
      const chamberVolume = lv + rv;
      // Volume scales as the cube of a linear dimension.
      const REFERENCE_CHAMBER_ML = 246;
      const linear = Math.cbrt(Math.max(0.15, chamberVolume / REFERENCE_CHAMBER_ML));
      this.organs.setScale('heart', 0.88 + 0.12 * linear * 1.0 + 0.06 * (linear - 1));

      // LUNGS. Scale on the respiratory tidal waveform.
      const inflation = this.lerpSnapshot((x) => x.resp.inflation, now);
      const lungScale = 1 + 0.055 * Math.max(0, Math.min(1.4, inflation));
      this.organs.setScale('lung_l', lungScale);
      this.organs.setScale('lung_r', lungScale);
    }

    // STOMACH and BLADDER fluid levels.
    this.organs.setFluidLevel('stomach', this.lerpSnapshot((x) => x.gi.gastricFillFraction, now));
    this.organs.setFluidLevel('bladder', this.lerpSnapshot((x) => x.renal.bladderFillFraction, now));

    // GI transit.
    this.bolus.update(s, this.reducedMotion ? 0 : s.gi.peristalsisPhase);
  }

  private emitLabels(): void {
    if (!this.callbacks.onLabels) return;
    this.labelBuffer.length = 0;
    const width = this.renderer.domElement.clientWidth;
    const height = this.renderer.domElement.clientHeight;

    for (const h of this.organs.organs.values()) {
      if (h.state === 'dormant') continue;
      this.projected.copy(h.centroid).project(this.rig.camera);
      const bias = h.def.labelBias ?? [0, 0];
      const x = (this.projected.x * 0.5 + 0.5) * width + bias[0] * 40;
      const y = (-this.projected.y * 0.5 + 0.5) * height + bias[1] * 40;
      this.labelBuffer.push({
        id: h.id,
        x,
        y,
        visible: this.projected.z < 1 && x > 0 && x < width && y > 0 && y < height,
      });
    }
    // ONLY WHEN SOMETHING MOVED. This ran every animation frame and handed React a new
    // label list sixty times a second, and every hand-off re-rendered the interface -
    // the largest single source of dropped frames on a phone. A still body now sends
    // nothing; a turning one sends positions rounded to whole pixels.
    let key = '';
    for (const l of this.labelBuffer) key += `${l.id}:${Math.round(l.x)},${Math.round(l.y)},${l.visible ? 1 : 0};`;
    if (key === this.lastLabelKey) return;
    this.lastLabelKey = key;
    this.callbacks.onLabels(this.labelBuffer.slice());
  }

  /** See `maxDpr`: step the render resolution to hold the frame rate. */
  private adaptResolution(now: number): void {
    if (++this.framesSinceCheck < 60) return;
    this.framesSinceCheck = 0;
    const recent = this.frameTimes.slice(-60);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    if (mean > 24 && this.dpr > 1 && now - this.lastDprChange > 2000) {
      this.dpr = Math.max(1, this.dpr - 0.25);
      this.lastDprChange = now;
      this.resize();
    } else if (mean < 18 && this.dpr < this.maxDpr && now - this.lastDprChange > 6000) {
      this.dpr = Math.min(this.maxDpr, this.dpr + 0.25);
      this.lastDprChange = now;
      this.resize();
    }
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    const dpr = this.dpr;

    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(width, height);
    this.bloom.setSize(width * dpr, height * dpr);
    this.rig.setAspect(width / height);

    // The dither samples gl_FragCoord, which is in render-target pixels, so the
    // resolution uniform must be the DEVICE size, not the CSS size.
    (this.dither.uniforms.uResolution.value as THREE.Vector2).set(width * dpr, height * dpr);
  }

  /** 95th-percentile frame time over the last ~4 s, for the perf readout. */
  frameTimeP95(): number {
    if (this.frameTimes.length < 10) return 0;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.95)];
  }

  setOrganState(id: OrganId, state: OrganState): void {
    this.organs.setState(id, state);
  }

  dispose(): void {
    this.stop();
    this.detachTouch();
    this.organs.dispose();
    this.bolus.dispose();
    this.airway.dispose();
    // Was leaking: VascularSystem builds sixty tube geometries and their shader
    // materials plus a large point cloud, and none of it was being freed on teardown.
    this.vascular.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
