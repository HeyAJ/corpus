import * as THREE from 'three';
import type { SimSnapshot } from '../../bridge/types';
import type { GeometryFactory } from '../anatomy/GeometryFactory';
import { BODY_MIRROR_X } from '../anatomy/layout';
import { SCAN_STOPS, thermalColor } from '../anatomy/detail/thermal';

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
 * LOOK: A GLASS BRAIN. The six cortical lobes and the cerebellum are translucent shells
 * blended with a MAXIMUM, not a sum: a glass brain is a maximum-intensity projection, and
 * a maximum cannot saturate, whereas additive shells stacked along one line of sight wash
 * the map to white. They have no depth write and no depth test, so they can never hide
 * what is inside them. Their opacity is a fresnel term, about 0.05
 * where the surface faces the eye and rising to about 0.5 at the silhouette, which is
 * what makes the outline read as a brain from every angle. The shells are drawn first and
 * the solids after them, so a deep structure is never tinted by the glass in front of it. Every other region (thalamus,
 * hippocampus, amygdala, brainstem...) is solid and bright, depth-tested against the other
 * solids only, with a darker rim so two neighbours of similar colour stay separable. Each
 * piece is tinted by its own activity colour. The opacities are display constants.
 * The one exception to "depth-tested": a deep structure driven well above rest (see HOT_FROM)
 * is also drawn see-through, because a glass brain is a projection and the amygdala would
 * otherwise be hidden behind its neighbours exactly when it matters.
 * A faint horizontal line sweeps top to bottom every few seconds and brightens whatever it
 * crosses. THAT LINE IS DECORATIVE: it is not an acquisition, it encodes nothing, and it
 * exists only so the picture reads as a live scan and not a model on a stand.
 *
 * WHY THE SCAN HAS ITS OWN COLOUR STOPS. The 3D organ ramp puts the whole resting range of
 * the activity index (measured 0.15 to 0.40) between cyan and green, which made a resting
 * brain one colour. `SCAN_STOPS` (thermal.ts) spreads rest over blue, cyan and green, so a
 * quiet brain looks cool, and keeps yellow, orange, red and white for regions driven above
 * rest, so activation is what turns warm. The scan, the legend bar and
 * the legend ticks all use that one ramp, so the legend is true.
 *
 * MOTION. One turn in about 30 s about the vertical axis, while the whole brain nods
 * through a few degrees either side of a slight downward look so both the top and the base
 * show during a turn. With `reducedMotion` the rotation, the nod and the sweep are held and
 * the brain stays in a three-quarter view; the colours remain live because they are the
 * data. Activity is smoothed with a time constant of about 0.4 s so the 20 Hz snapshots do
 * not flicker.
 *
 * COST. The loop is capped at about 30 frames per second and the pixel ratio at 2. When
 * `setRunning(false)` the animation-frame loop is cancelled and nothing is drawn. Nothing
 * is allocated per frame: colours and uniforms are preallocated and mutated in place.
 * Geometry is the region meshes alone (the lobes already make the outline, so there is no
 * separate outer shell to draw).
 *
 * MIRRORING. The brain's own frame has +x on the patient's right; the main view mirrors
 * x by BODY_MIRROR_X, so the same is done here once, on the group, and left and right
 * agree with the main view.
 */

const BACKGROUND = 0x070b12;
const SMOOTHING_S = 0.4;
const TURN_S = 30;
const SWEEP_S = 4;
const MAX_FPS = 30;
/** Mean downward look and the nod either side of it, in degrees: display constants. */
const TILT_MEAN_RAD = (8 * Math.PI) / 180;
const TILT_NOD_RAD = (20 * Math.PI) / 180;
const NOD_S = 22;
const THREE_QUARTER_RAD = 0.75;
const HELD_TILT_RAD = (14 * Math.PI) / 180;
const FOV_DEG = 32;
const RETRY_MS = 4000;
const RETRY_LIMIT = 30;

/**
 * Stops for the UI's legend bar. `t` is the activity index fed to the scan ramp; no units.
 * "resting" sits where the measured resting regions cluster (0.15..0.40, median ~0.28).
 */
export const SCAN_LEGEND: { label: string; t: number }[] = [
  { label: 'quiet', t: 0.08 },
  { label: 'resting', t: 0.28 },
  { label: 'active', t: 0.58 },
  { label: 'intense', t: 0.9 },
];

/**
 * The regions drawn as translucent shells. These are the cortical lobes and the cerebellum:
 * the surface of the brain. Everything else in the atlas lies inside them.
 */
const GHOST_IDS: ReadonlySet<string> = new Set([
  'prefrontal_cortex',
  'motor_cortex',
  'somatosensory_cortex',
  'parietal_lobe',
  'temporal_lobe',
  'occipital_lobe',
  'cerebellum',
]);

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

/**
 * Glass shell: alpha is a fresnel term, ~0.05 face-on rising to ~0.5 at the silhouette
 * (display constants). The colour is pre-multiplied by it because the blend is MAX with
 * One/One factors, which keeps the larger of shell and ground per channel.
 */
const GHOST_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uScan;
  uniform float uScanOn;
  varying vec3 vN;
  varying vec3 vV;
  varying float vNdcY;
  void main() {
    float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    float a = 0.05 + 0.45 * pow(f, 3.2);
    float d = (vNdcY - uScan) / 0.07;
    a *= 1.0 + 0.8 * uScanOn * exp(-d * d);
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <colorspace_fragment>
  }
`;

/** Solid deep structure: headlight shading and a darkened rim so neighbours stay apart. */
const SOLID_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uScan;
  uniform float uScanOn;
  varying vec3 vN;
  varying vec3 vV;
  varying float vNdcY;
  void main() {
    float ndv = abs(dot(normalize(vN), normalize(vV)));
    float rim = smoothstep(0.0, 0.3, ndv);
    vec3 c = uColor * (0.6 + 0.4 * ndv) * mix(0.2, 1.0, rim);
    float d = (vNdcY - uScan) / 0.07;
    c *= 1.0 + 0.8 * uScanOn * exp(-d * d);
    gl_FragColor = vec4(c, 1.0);
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

function makeMaterial(ghost: boolean): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color() },
      uScan: { value: 2 },
      uScanOn: { value: 1 },
    },
    vertexShader: VERTEX,
    fragmentShader: ghost ? GHOST_FRAGMENT : SOLID_FRAGMENT,
    blending: ghost ? THREE.CustomBlending : THREE.NoBlending,
    // Not flagged transparent on purpose: three draws every opaque-list object before any
    // transparent one whatever its renderOrder, and the shells must come FIRST so the solid
    // structures overwrite them. Custom blending still applies to an opaque-list material.
    transparent: false,
    depthTest: !ghost,
    depthWrite: !ghost,
    side: THREE.FrontSide,
  });
  if (ghost) {
    // Maximum, not sum: see the header. With MaxEquation the factors are ignored by GL but
    // set to One so the intent is explicit.
    m.blendEquation = THREE.MaxEquation;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneFactor;
  }
  return m;
}

/**
 * See-through overlay for a strongly driven deep structure. The amygdala is about a
 * centimetre across and sits low and forward behind the insula and hippocampus, so from most
 * angles the solid pass hides the one region the picture exists to show when a person is
 * frightened. A glass brain is a projection: a hot region should show through. The overlay
 * is the same mesh drawn again with no depth test and ordinary alpha, only while the region
 * is above HOT_FROM (just over the resting ceiling of 0.40), fading in to HOT_FULL. At rest
 * nothing is drawn, so the resting picture is unchanged. Display constants.
 */
const HOT_FROM = 0.45;
const HOT_FULL = 0.62;
const HOT_ALPHA = 0.7;
const HOT_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying vec3 vN;
  varying vec3 vV;
  varying float vNdcY;
  void main() {
    float ndv = abs(dot(normalize(vN), normalize(vV)));
    gl_FragColor = vec4(uColor * (0.7 + 0.3 * ndv), uAlpha);
    #include <colorspace_fragment>
  }
`;

interface Region {
  key: string;
  mesh: THREE.Mesh;
  /** Present on deep structures only: the see-through overlay (see HOT_FROM). */
  hot: THREE.Mesh | null;
  material: THREE.ShaderMaterial;
  color: THREE.Color;
  target: number;
  value: number;
  /** False until the first snapshot lands: the first value is taken whole, not eased up from 0. */
  seen: boolean;
}

export class BrainScan {
  /** Hold the rotation (and the sweep) still, in a three-quarter view. Colours stay live. */
  reducedMotion = false;

  /** The legend stops (see SCAN_LEGEND). */
  readonly legend = SCAN_LEGEND;

  private readonly factory: GeometryFactory;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.01, 2);
  private readonly pitch = new THREE.Group();
  private readonly spin = new THREE.Group();
  private readonly mirror = new THREE.Group();
  private readonly regions: Region[] = [];
  private readonly scanMesh: THREE.Mesh;
  private readonly scanMaterial: THREE.ShaderMaterial;
  private readonly sphere = new THREE.Sphere();
  private haveSphere = false;

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
    this.pitch.add(this.spin);
    this.scene.add(this.pitch);

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
      // Easing the first value up from 0 would flash the whole brain deep blue on opening.
      if (!r.seen && v !== undefined) {
        r.value = r.target;
        r.seen = true;
      }
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
      if (r.hot) (r.hot.material as THREE.ShaderMaterial).dispose();
    }
    this.regions.length = 0;
    this.scanMesh.geometry.dispose();
    this.scanMaterial.dispose();
    this.renderer.dispose();
  }

  /* ------------------------------------------------------------- loading */

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
      const ghost = GHOST_IDS.has(p.id);
      const material = makeMaterial(ghost);
      const mesh = new THREE.Mesh(p.geometry, material);
      mesh.frustumCulled = false;
      // Glass first, solids over it, then the scan line. A solid overwrites the pixels it
      // covers, so a deep structure's colour is never tinted by a shell in front of it
      // (a max against the shell would brighten it); the shells still make the outline.
      mesh.renderOrder = ghost ? 1 : 2;
      const region: Region = { key: 'brain.' + p.id, mesh, hot: null, material, color: new THREE.Color(), target: 0, value: 0, seen: false };
      material.uniforms.uColor.value = region.color;
      if (!ghost) {
        const hotMaterial = new THREE.ShaderMaterial({
          uniforms: { uColor: { value: region.color }, uAlpha: { value: 0 } },
          vertexShader: VERTEX,
          fragmentShader: HOT_FRAGMENT,
          transparent: true,
          depthTest: false,
          depthWrite: false,
          side: THREE.FrontSide,
        });
        const hot = new THREE.Mesh(p.geometry, hotMaterial);
        hot.frustumCulled = false;
        hot.visible = false;
        hot.renderOrder = 3;
        region.hot = hot;
        this.mirror.add(hot);
      }
      this.regions.push(region);
      this.mirror.add(mesh);
    }
    if (!box.isEmpty()) {
      // A sphere hugging the box corners would leave the brain small in its window (a brain
      // fills an ellipsoid, not its box), so take half the longest side with a little slack.
      const size = box.getSize(new THREE.Vector3());
      box.getCenter(this.sphere.center);
      this.sphere.radius = 0.55 * Math.max(size.x, size.y, size.z);
      this.haveSphere = true;
      this.placeBrain();
    }
    if (this.latest) this.pushSnapshot(this.latest);
    if (!this.running) this.draw(0);
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
    this.camera.position.set(0, 0, d);
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
      thermalColor(r.value, r.color, SCAN_STOPS);
      if (r.hot) {
        const h = (r.value - HOT_FROM) / (HOT_FULL - HOT_FROM);
        const a = h <= 0 ? 0 : (h > 1 ? 1 : h) * HOT_ALPHA;
        r.hot.visible = a > 0;
        (r.hot.material as THREE.ShaderMaterial).uniforms.uAlpha.value = a;
      }
    }

    const held = this.reducedMotion;
    this.spin.rotation.y = held ? THREE_QUARTER_RAD : (this.clock / TURN_S) * Math.PI * 2;
    this.pitch.rotation.x = held ? HELD_TILT_RAD : TILT_MEAN_RAD + TILT_NOD_RAD * Math.sin((this.clock / NOD_S) * Math.PI * 2);
    const sweep = held ? 2 : 1 - 2 * ((this.clock / SWEEP_S) % 1);
    const on = held ? 0 : 1;
    for (let i = 0; i < this.regions.length; i++) {
      const u = this.regions[i].material.uniforms;
      u.uScan.value = sweep;
      u.uScanOn.value = on;
    }
    this.scanMaterial.uniforms.uY.value = sweep;
    this.scanMesh.visible = !held;

    this.renderer.render(this.scene, this.camera);
  }
}
