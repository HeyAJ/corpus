import * as THREE from 'three';
import type { SimSnapshot } from '../../bridge/types';
import type { GeometryFactory } from '../anatomy/GeometryFactory';
import { BODY_MIRROR_X } from '../anatomy/layout';
import { thermalColor } from '../anatomy/detail/thermal';

/**
 * THE BRAIN SCAN INSET: a small, live, slowly turning picture of the brain in the corner
 * of the screen, each region coloured by how active the simulation says it is.
 *
 * WHAT THE COLOURS ARE. They are the engine's ACTIVITY INDEX for each brain region
 * (`snapshot.anatomy.parts['brain.<id>']`, 0..1; see src/data/anatomy-types.ts), drawn
 * through a cold-to-hot palette because that is how a viewer already reads a scan. They
 * are not a temperature, not an MRI or BOLD signal, not a blood flow and not a metabolic
 * rate, and nothing here is ever labelled in degrees. The palette is a way of making
 * "how hard are this region's drivers pushing" legible at a glance, and nothing more.
 *
 * WHY ITS OWN RENDERER. The main viewer's renderer carries a post-processing chain
 * calibrated for the absorption look of the whole body; sharing it would mean a second
 * scene, a second camera and a scissor inside that chain. A second small WebGLRenderer on
 * the inset's own canvas touches none of it, and costs a few hundred kilobytes.
 *
 * LOOK. The brain's outer shell is a ghost (additive fresnel rim only, so the folds read
 * as a faint outline); every region is drawn additively with its own fresnel term so
 * overlapping regions glow through one another, as a scan shows structure through
 * structure. A faint band sweeps top to bottom every few seconds, brightening whatever it
 * crosses, so the picture reads as a scanner and not a model on a stand.
 *
 * MOTION. One turn in about 14 s about the vertical axis, tilted a few degrees so the top
 * surface shows. With `reducedMotion` the rotation and the sweep are held and the brain
 * stays in a three-quarter view; the colours remain live because they are the data.
 * Activity is smoothed with a time constant of about 0.4 s so the 20 Hz snapshots do not
 * flicker.
 *
 * COST. The loop is capped at about 30 frames per second and the pixel ratio at 2. When
 * `setRunning(false)` the animation-frame loop is cancelled and nothing is drawn. Nothing
 * is allocated per frame: colours and uniforms are preallocated and mutated in place.
 * Geometry is held to about 25,000 triangles in all: if the outer shell would overshoot
 * that on top of the regions, the shell is left out rather than the regions.
 *
 * MIRRORING. The brain's own frame has +x on the patient's right; the main view mirrors
 * x by BODY_MIRROR_X, so the same is done here once, on the group, and left and right
 * agree with the main view.
 */

const BACKGROUND = 0x070b12;
const SMOOTHING_S = 0.4;
const TURN_S = 14;
const SWEEP_S = 3;
const MAX_FPS = 30;
const TRIANGLE_BUDGET = 25000;
const TILT_RAD = (12 * Math.PI) / 180;
const THREE_QUARTER_RAD = 0.75;
const FOV_DEG = 32;
const RETRY_MS = 4000;
const RETRY_LIMIT = 30;

const VERTEX = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying float vNdcY;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = -mv.xyz;
    gl_Position = projectionMatrix * mv;
    vNdcY = gl_Position.y / gl_Position.w;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uBase;
  uniform float uRim;
  uniform float uPower;
  uniform float uIntensity;
  uniform float uScan;
  uniform float uScanOn;
  varying vec3 vN;
  varying vec3 vV;
  varying float vNdcY;
  void main() {
    float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    float a = uBase + uRim * pow(f, uPower);
    float d = (vNdcY - uScan) / 0.07;
    a *= 1.0 + 1.6 * uScanOn * exp(-d * d);
    gl_FragColor = vec4(uColor * a * uIntensity, 1.0);
    #include <colorspace_fragment>
  }
`;

const SCAN_VERTEX = /* glsl */ `
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const SCAN_FRAGMENT = /* glsl */ `
  uniform float uY;
  uniform float uResY;
  void main() {
    float ndc = gl_FragCoord.y / uResY * 2.0 - 1.0;
    float d = (ndc - uY) / 0.012;
    float a = 0.16 * exp(-d * d);
    gl_FragColor = vec4(vec3(0.35, 0.7, 1.0) * a, 1.0);
    #include <colorspace_fragment>
  }
`;

function makeMaterial(base: number, rim: number, power: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color() },
      uBase: { value: base },
      uRim: { value: rim },
      uPower: { value: power },
      uIntensity: { value: 1 },
      uScan: { value: 2 },
      uScanOn: { value: 1 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.FrontSide,
  });
}

function triangles(g: THREE.BufferGeometry): number {
  return (g.index ? g.index.count : g.getAttribute('position').count) / 3;
}

interface Region {
  key: string;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  color: THREE.Color;
  target: number;
  value: number;
}

export class BrainScan {
  /** Hold the rotation (and the sweep) still, in a three-quarter view. Colours stay live. */
  reducedMotion = false;

  /** Stops for the UI's colour bar. `t` is the activity index fed to the palette; no units. */
  readonly legend: { label: string; t: number }[] = [
    { label: 'quiet', t: 0.05 },
    { label: 'resting', t: 0.3 },
    { label: 'active', t: 0.6 },
    { label: 'intense', t: 0.9 },
  ];

  private readonly factory: GeometryFactory;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.01, 2);
  private readonly spin = new THREE.Group();
  private readonly mirror = new THREE.Group();
  private readonly regions: Region[] = [];
  private readonly regionIndex = new Map<string, Region>();
  private shellMesh: THREE.Mesh | null = null;
  private shellMaterial: THREE.ShaderMaterial | null = null;
  private readonly scanMesh: THREE.Mesh;
  private readonly scanMaterial: THREE.ShaderMaterial;
  private readonly sphere = new THREE.Sphere();
  private haveSphere = false;
  private triangleCount = 0;

  private raf = 0;
  private running = false;
  private disposed = false;
  private lastFrame = 0;
  private clock = 0;
  private cssW = 1;
  private cssH = 1;
  private loadTimer: ReturnType<typeof setTimeout> | null = null;
  private loadAttempts = 0;
  private partsLoaded = false;
  private latest: SimSnapshot | null = null;

  constructor(canvas: HTMLCanvasElement, factory: GeometryFactory) {
    this.factory = factory;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 2));
    this.renderer.setClearColor(BACKGROUND, 1);
    this.renderer.autoClear = true;
    this.scene.background = new THREE.Color(BACKGROUND);

    this.mirror.scale.x = BODY_MIRROR_X;
    this.spin.add(this.mirror);
    this.scene.add(this.spin);

    // The scanner line: a full-screen quad in clip space, drawn last and additively.
    const quad = new THREE.BufferGeometry();
    quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    this.scanMaterial = new THREE.ShaderMaterial({
      uniforms: { uY: { value: 2 }, uResY: { value: 1 } },
      vertexShader: SCAN_VERTEX,
      fragmentShader: SCAN_FRAGMENT,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.scanMesh = new THREE.Mesh(quad, this.scanMaterial);
    this.scanMesh.frustumCulled = false;
    this.scanMesh.renderOrder = 100;
    this.scene.add(this.scanMesh);

    this.camera.position.set(0, 0, 1);
    this.setSize(canvas.clientWidth || 160, canvas.clientHeight || 160);
    void this.loadShell();
    void this.loadParts();
  }

  /** Called with each snapshot, at up to 20 Hz. Only records targets; drawing smooths them. */
  pushSnapshot(s: SimSnapshot): void {
    this.latest = s;
    const parts = s.anatomy?.parts;
    if (!parts) return;
    for (let i = 0; i < this.regions.length; i++) {
      const r = this.regions[i];
      const v = parts[r.key];
      r.target = v === undefined || v !== v ? 0 : v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }

  setSize(cssWidth: number, cssHeight: number): void {
    if (this.disposed) return;
    this.cssW = Math.max(1, Math.floor(cssWidth));
    this.cssH = Math.max(1, Math.floor(cssHeight));
    this.renderer.setSize(this.cssW, this.cssH, false);
    this.camera.aspect = this.cssW / this.cssH;
    this.frameCamera();
    this.scanMaterial.uniforms.uResY.value = this.cssH * this.renderer.getPixelRatio();
    if (!this.running) this.draw(0);
  }

  setRunning(on: boolean): void {
    if (this.disposed || on === this.running) return;
    this.running = on;
    if (on) {
      this.lastFrame = 0;
      this.raf = requestAnimationFrame(this.frame);
    } else {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    if (this.loadTimer !== null) clearTimeout(this.loadTimer);
    this.loadTimer = null;
    for (const r of this.regions) {
      r.mesh.geometry.dispose();
      r.material.dispose();
    }
    this.regions.length = 0;
    this.regionIndex.clear();
    this.shellMesh?.geometry.dispose();
    this.shellMaterial?.dispose();
    this.shellMesh = null;
    this.scanMesh.geometry.dispose();
    this.scanMaterial.dispose();
    this.renderer.dispose();
  }

  /* ------------------------------------------------------------- loading */

  private async loadShell(): Promise<void> {
    try {
      const g = await this.factory.model('brain');
      if (this.disposed) {
        g.dispose();
        return;
      }
      this.adoptShell(g);
    } catch {
      /* no outline: the regions still draw */
    }
  }

  private adoptShell(g: THREE.BufferGeometry): void {
    g.computeBoundingSphere();
    if (g.boundingSphere) {
      this.sphere.copy(g.boundingSphere);
      this.haveSphere = true;
      this.placeBrain();
    }
    this.shellMaterial = makeMaterial(0, 0.55, 2.4);
    this.shellMaterial.uniforms.uColor.value.setRGB(0.32, 0.45, 0.62);
    this.shellMesh = new THREE.Mesh(g, this.shellMaterial);
    this.shellMesh.renderOrder = 1;
    this.shellMesh.frustumCulled = false;
    this.triangleCount += triangles(g);
    this.enforceBudget();
    this.mirror.add(this.shellMesh);
  }

  private async loadParts(): Promise<void> {
    if (this.disposed || this.partsLoaded) return;
    let list: { id: string; geometry: THREE.BufferGeometry }[] = [];
    try {
      list = await this.factory.parts('brain', { organ: 'brain' });
    } catch {
      list = [];
    }
    if (this.disposed) {
      for (const p of list) p.geometry.dispose();
      return;
    }
    if (list.length === 0) {
      // The atlas may not be ready the first time it is asked: ask again, a bounded number of times.
      if (++this.loadAttempts <= RETRY_LIMIT) {
        this.loadTimer = setTimeout(() => void this.loadParts(), RETRY_MS);
      }
      return;
    }
    this.partsLoaded = true;
    const box = new THREE.Box3();
    for (const p of list) {
      p.geometry.computeBoundingBox();
      if (p.geometry.boundingBox) box.union(p.geometry.boundingBox);
      const material = makeMaterial(0.25, 1.1, 2.0);
      const mesh = new THREE.Mesh(p.geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      const region: Region = { key: 'brain.' + p.id, mesh, material, color: new THREE.Color(), target: 0, value: 0 };
      material.uniforms.uColor.value = region.color;
      this.regions.push(region);
      this.regionIndex.set(p.id, region);
      this.triangleCount += triangles(p.geometry);
      this.mirror.add(mesh);
    }
    if (!this.haveSphere && !box.isEmpty()) {
      box.getBoundingSphere(this.sphere);
      this.haveSphere = true;
      this.placeBrain();
    }
    this.enforceBudget();
    if (this.latest) this.pushSnapshot(this.latest);
    if (!this.running) this.draw(0);
  }

  /** Over budget: drop the ghost outline, never the regions. */
  private enforceBudget(): void {
    if (this.triangleCount <= TRIANGLE_BUDGET || !this.shellMesh) return;
    this.triangleCount -= triangles(this.shellMesh.geometry);
    this.mirror.remove(this.shellMesh);
    this.shellMesh.geometry.dispose();
    this.shellMaterial?.dispose();
    this.shellMesh = null;
    this.shellMaterial = null;
  }

  /* -------------------------------------------------------------- camera */

  /** Put the brain's centre on the spin axis (after the x mirror) and pull the camera back to fit it. */
  private placeBrain(): void {
    const c = this.sphere.center;
    this.mirror.position.set(-BODY_MIRROR_X * c.x, -c.y, -c.z);
    this.frameCamera();
  }

  private frameCamera(): void {
    const r = this.haveSphere ? this.sphere.radius : 0.08;
    const vHalf = (FOV_DEG * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    const half = Math.min(vHalf, hHalf);
    const d = (r * 1.08) / Math.sin(half);
    this.camera.position.set(0, d * Math.sin(TILT_RAD), d * Math.cos(TILT_RAD));
    this.camera.near = Math.max(0.001, d - r * 1.5);
    this.camera.far = d + r * 1.5;
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
  }

  /* ---------------------------------------------------------------- loop */

  private readonly frame = (now: number): void => {
    if (!this.running || this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    if (this.lastFrame !== 0 && now - this.lastFrame < 1000 / MAX_FPS - 2) return;
    let dt = this.lastFrame === 0 ? 0 : (now - this.lastFrame) / 1000;
    if (dt > 0.1) dt = 0.1;
    this.lastFrame = now;
    this.draw(dt);
  };

  private draw(dt: number): void {
    if (this.disposed) return;
    this.clock += dt;

    const k = dt > 0 ? 1 - Math.exp(-dt / SMOOTHING_S) : 1;
    for (let i = 0; i < this.regions.length; i++) {
      const r = this.regions[i];
      r.value += (r.target - r.value) * k;
      thermalColor(r.value, r.color);
      // Quiet regions stay visible as a dim outline; active ones glow harder.
      r.material.uniforms.uIntensity.value = 0.45 + 0.85 * r.value;
    }

    const held = this.reducedMotion;
    this.spin.rotation.y = held ? THREE_QUARTER_RAD : (this.clock / TURN_S) * Math.PI * 2;
    const sweep = held ? 2 : 1 - 2 * ((this.clock / SWEEP_S) % 1);
    const on = held ? 0 : 1;
    for (let i = 0; i < this.regions.length; i++) {
      const u = this.regions[i].material.uniforms;
      u.uScan.value = sweep;
      u.uScanOn.value = on;
    }
    if (this.shellMaterial) {
      this.shellMaterial.uniforms.uScan.value = sweep;
      this.shellMaterial.uniforms.uScanOn.value = on;
    }
    this.scanMaterial.uniforms.uY.value = sweep;
    this.scanMesh.visible = !held;

    this.renderer.render(this.scene, this.camera);
  }
}
