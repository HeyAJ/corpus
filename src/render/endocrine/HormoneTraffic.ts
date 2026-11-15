import * as THREE from 'three';
import type { SimSnapshot } from '../../bridge/types';
import { organDef, warpPoint } from '../anatomy/layout';

/**
 * THE HORMONE-TRAFFIC OVERLAY.
 *
 * Every gland wears a coloured ring, one ring per hormone it makes. From each gland a thin
 * line in the hormone's colour runs to each organ the hormone is taught to act on, and
 * coloured droplets with a short tail travel along those lines. Droplets come more often
 * the further a hormone is above its resting level, so a stress response visibly floods
 * cortisol and adrenaline and a meal visibly floods insulin.
 *
 * THE ARCS ARE A DIAGRAM OF SOURCE -> TARGET, NOT A ROUTE. Hormones really travel in the
 * blood, to every tissue, and act only where a cell carries the receptor. The arcs say
 * "this gland acts on that organ" and nothing about the path or the speed. Every size,
 * rate, travel time, colour, the resting trickle and the log-compression below is a
 * DISPLAY constant; none is a physiological number.
 *
 * Source for the gland-to-target pairs: the endocrine chapters of Standring (ed.), Gray's
 * Anatomy, 42nd edition, and the usual textbook statements of each hormone's principal
 * target tissues. Where a target list is long in reality (cortisol and thyroid hormone
 * act almost everywhere) a few representative organs are drawn and the comment says so.
 *
 * WHY IT IS DRAWN THIS WAY (what went wrong the first time). The first version drew soft
 * grey-ish beacons and a handful of small faint dots, and a tester saw nothing. The page
 * is cream and the organs are translucent red glass, so a pale, soft, small mark has no
 * contrast against either. The rules now: marks are SATURATED MID-DARK hues with a darker
 * rim (legible on cream and over red), they are drawn with ordinary alpha blending above
 * the organs with the depth test off (a diagram layer: a gland behind the body still shows
 * its ring), the wiring is always drawn as lines whether or not anything is flowing, and a
 * droplet has a floor of a few pixels so it cannot shrink below legibility when the camera
 * pulls back for a phone.
 *
 * WHERE EACH LEVEL COMES FROM.
 *   snapshot.endocrine.hormones[]   cortisol, aldosterone, adh, thyroxine, glucagon, epo,
 *                                   oxytocin; testosterone (male); lh, fsh, estradiol,
 *                                   progesterone (non-pregnant female); hcg, progesterone,
 *                                   estradiol, prolactin, testosterone (pregnant). The ids
 *                                   are runtime data, so state is keyed by id and tolerates
 *                                   ids appearing and disappearing. EPO has no organ target
 *                                   (bone marrow is not drawn) and is not animated.
 *   snapshot.metabolic.insulin_uU_per_mL   insulin: it is not in the list above.
 *   snapshot.anatomy.glands.adrenal_medulla   ADRENALINE. The engine has no adrenaline or
 *                                   noradrenaline plasma level; this is the gland's OUTPUT
 *                                   as a multiple of basal (1 = basal). It is not a
 *                                   concentration and the legend says "x basal".
 *
 * THE RESTING REFERENCE IS THE FIRST LEVEL SEEN. The engine boots settled at rest, so the
 * first snapshot this overlay receives IS the resting body, and every ratio is the level
 * relative to it. The reference of an id is dropped and re-learned when the body's sex or
 * pregnancy changes, because the same id (estradiol) then means a different curve.
 * A hormone whose first level is zero has no ratio to take; the display rule is
 * ratio = 1 + level / refHigh (its own reference-range top from the snapshot), or 2 if no
 * range is given and the level is above zero.
 *
 * DRAW CALLS: two. The wiring is one LineSegments, the rings and droplets share one Points
 * object. Both use normal (alpha) blending in the top bucket (renderOrder 22). Additive
 * blending would vanish on the pale page; ordinary blending of saturated marks does not.
 * Nothing here is a multiply object, so the order-independence argument for the organ
 * shells is untouched.
 *
 * A hidden overlay does no per-frame work. A visible one writes the position, colour and
 * size of a fixed pool of droplets and allocates nothing.
 */

/* ------------------------------------------------------------------ display constants */

/** Droplet slots per hormone. */
const SLOTS = 34;
/** Trailing points behind each droplet (the short tail), and their spacing along the arc. */
const TAIL = 3;
const TAIL_STEP_U = 0.022;
/** Seconds a droplet takes to fly its arc. */
const FLIGHT_S = 3.4;
/** Droplet radius and ring radius in metres, for the point-size attribute. */
const DROP_R = 0.0105;
const RING_R = 0.03;
/** Same scale factor the vessel particles use: pixels * distance per metre of radius. */
const SIZE_SCALE = 2600;
/** Pixel floors and ceilings (point diameter), so a mark never vanishes or balloons. */
const DROP_MIN_PX = 7;
const DROP_MAX_PX = 16;
const TAIL_MIN_PX = 3;
const RING_MIN_PX = 20;
const RING_MAX_PX = 56;
/** Fraction of slots in flight at resting level, and the log-compression slope. */
const REST_FRAC = 0.2;
const LOG_SLOPE = 0.42;
const MIN_FRAC = 0.05;
/** Segments per drawn wiring arc, and the line opacity. */
const ARC_SEGS = 16;
const ARC_ALPHA = 0.9;
/** Ring slots: more than the number of (gland, hormone) pairs of any body. */
const MAX_RINGS = 48;
/** Offset, metres, that separates the rings of several hormones sharing one gland. */
const RING_SPREAD = 0.016;
/** The legend only marks hormones outside these bounds. */
export const LEGEND_HIGH = 1.2;
export const LEGEND_LOW = 0.8;

/** Level ratio -> fraction of droplet slots in flight (and ring brightness), clamped. */
function compress(ratio: number): number {
  const r = Math.max(0.05, ratio);
  return Math.max(MIN_FRAC, Math.min(1, REST_FRAC + LOG_SLOPE * Math.log2(r)));
}

export interface HormoneLegendEntry {
  id: string;
  label: string;
  colour: string;
  gland: string;
  level: number;
  unit: string;
  ratio: number;
}

type Where = string;

interface HormoneDef {
  id: string;
  short: string;
  colour: number;
  /** Gland anchor keys; resolved per body. */
  src: (female: boolean, pregnant: boolean) => Where[];
  tgt: (female: boolean, pregnant: boolean) => Where[];
  glandLabel: string;
}

const MUSCLE: Where[] = ['muscleR', 'muscleL'];

/*
 * THE PALETTE. Saturated, mid-dark, spread round the hue wheel, with lightness varied
 * where two hues are near (navy testosterone against bright-blue insulin; both reach the
 * muscle). The pairs that share a gland or a target are the ones that matter, and each
 * was checked by eye in a render: breast (oxytocin pink, prolactin purple, oestradiol
 * coral, progesterone teal), pituitary (ADH cyan, oxytocin pink, prolactin purple, LH
 * lime, FSH gold), adrenal (cortisol green, adrenaline magenta, aldosterone brown),
 * pancreas (insulin blue, glucagon orange). Red is avoided as a base hue because the
 * organs are red; the dark rim does the rest.
 */
const DEFS: HormoneDef[] = [
  // Cortisol acts nearly everywhere; liver (gluconeogenesis), heart, brain, muscle and kidney stand for it.
  { id: 'cortisol', short: 'Cortisol', colour: 0x2e9e4f, glandLabel: 'adrenal cortex', src: () => ['adrenalR', 'adrenalL'], tgt: () => ['liver', 'heart', 'brain', ...MUSCLE, 'kidneyR'] },
  // Adrenal medulla output: heart, lungs and vessels (aorta and the thigh vessels).
  { id: 'adrenaline', short: 'Adrenaline', colour: 0xe6007e, glandLabel: 'adrenal medulla', src: () => ['adrenalR', 'adrenalL'], tgt: () => ['heart', 'lungR', 'lungL', 'aorta', 'thighVesselR', 'thighVesselL'] },
  { id: 'insulin', short: 'Insulin', colour: 0x1565ff, glandLabel: 'pancreas', src: () => ['pancreas'], tgt: () => ['liver', ...MUSCLE] },
  { id: 'glucagon', short: 'Glucagon', colour: 0xff8c00, glandLabel: 'pancreas', src: () => ['pancreas'], tgt: () => ['liver'] },
  { id: 'adh', short: 'ADH', colour: 0x00bcd4, glandLabel: 'pituitary', src: () => ['pituitary'], tgt: () => ['kidneyR', 'kidneyL'] },
  { id: 'aldosterone', short: 'Aldosterone', colour: 0x7b4a12, glandLabel: 'adrenal cortex', src: () => ['adrenalR', 'adrenalL'], tgt: () => ['kidneyR', 'kidneyL'] },
  // Thyroid hormone: heart, liver, brain and muscle stand for "widely".
  { id: 'thyroxine', short: 'Thyroid hormone', colour: 0x4527a0, glandLabel: 'thyroid', src: () => ['thyroid'], tgt: () => ['heart', 'liver', 'brain', ...MUSCLE] },
  { id: 'oxytocin', short: 'Oxytocin', colour: 0xff6fb5, glandLabel: 'pituitary', src: () => ['pituitary'], tgt: (f) => (f ? ['uterus', 'breastR', 'breastL'] : ['prostate']) },
  { id: 'prolactin', short: 'Prolactin', colour: 0x9c27b0, glandLabel: 'pituitary', src: () => ['pituitary'], tgt: () => ['breastR', 'breastL'] },
  { id: 'lh', short: 'LH', colour: 0x8bc400, glandLabel: 'pituitary', src: () => ['pituitary'], tgt: () => ['ovaryR', 'ovaryL'] },
  { id: 'fsh', short: 'FSH', colour: 0xd4a800, glandLabel: 'pituitary', src: () => ['pituitary'], tgt: () => ['ovaryR', 'ovaryL'] },
  { id: 'estradiol', short: 'Oestradiol', colour: 0xe8603c, glandLabel: 'ovary / placenta', src: (_f, p) => (p ? ['uterus'] : ['ovaryR', 'ovaryL']), tgt: () => ['uterus', 'breastR', 'breastL', 'hypothalamus'] },
  { id: 'progesterone', short: 'Progesterone', colour: 0x00897b, glandLabel: 'ovary / placenta', src: (_f, p) => (p ? ['uterus'] : ['ovaryR', 'ovaryL']), tgt: () => ['uterus', 'breastR', 'breastL', 'hypothalamus'] },
  { id: 'testosterone', short: 'Testosterone', colour: 0x0d2f73, glandLabel: 'testes / ovary', src: (f, p) => (!f ? ['testisR', 'testisL'] : p ? ['uterus'] : ['ovaryR', 'ovaryL']), tgt: (f) => (f ? [...MUSCLE] : [...MUSCLE, 'prostate']) },
  { id: 'hcg', short: 'hCG', colour: 0x37474f, glandLabel: 'placenta', src: () => ['uterus'], tgt: () => ['ovaryR', 'ovaryL'] },
];

/** Every gland key that can source a hormone; rings are built from (gland, hormone) pairs. */
const GLAND_KEYS: Where[] = ['pituitary', 'thyroid', 'adrenalR', 'adrenalL', 'pancreas', 'ovaryR', 'ovaryL', 'testisR', 'testisL', 'uterus'];

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Rigid cranial group offset, metres (organs.json groupLayout.cranial). */
const CRANIAL_OFFSET_Y = 0.06;

/** Curvature of one hormone's arcs, as a fraction of the span: each hormone bends a
 *  little differently so LH and FSH (same gland, same targets) do not overprint. */
const curveOf = (h: number) => 0.1 + 0.035 * (h % 6);
/** Which side an arc bows to: alternates by source/target pair so a fan opens out. */
const sideOf = (s: number, t: number) => ((s + t) & 1 ? 1 : -1);

/** Point at parameter u on the quadratic arc from (sx..) to (tx..), written into out[o..o+2]. */
function arcPoint(out: Float32Array, o: number, sp: Float32Array, si: number, tp: Float32Array, ti: number, curve: number, side: number, u: number): void {
  const sx = sp[si * 3];
  const sy = sp[si * 3 + 1];
  const sz = sp[si * 3 + 2];
  const tx = tp[ti * 3];
  const ty = tp[ti * 3 + 1];
  const tz = tp[ti * 3 + 2];
  const dx = tx - sx;
  const dy = ty - sy;
  const dz = tz - sz;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6;
  // Control point lifted sideways (x) and toward the viewer (z) so arcs fan out.
  const cx = (sx + tx) / 2 + side * curve * len;
  const cy = (sy + ty) / 2;
  const cz = (sz + tz) / 2 + 0.2 * len;
  const a = (1 - u) * (1 - u);
  const b = 2 * (1 - u) * u;
  const c = u * u;
  out[o] = a * sx + b * cx + c * tx;
  out[o + 1] = a * sy + b * cy + c * ty;
  out[o + 2] = a * sz + b * cz + c * tz;
}

interface Flight {
  hormone: number;
  /** Index into the hormone's source and target position lists. */
  src: number;
  tgt: number;
  u: number;
  speed: number;
  alive: boolean;
  rand: number;
}

export class HormoneTraffic {
  readonly root = new THREE.Group();

  private readonly points: THREE.Points;
  private readonly positionAttr: THREE.BufferAttribute;
  private readonly colourAttr: THREE.BufferAttribute;
  private readonly sizeAttr: THREE.BufferAttribute;
  private readonly kindAttr: THREE.BufferAttribute;

  private readonly lines: THREE.LineSegments;
  private lineGeometry: THREE.BufferGeometry;
  private lineHormone: number[] = [];
  private linesDirty = true;

  /** Per-hormone live state, indexed like DEFS. */
  private readonly ratio: number[] = DEFS.map(() => 1);
  private readonly present: boolean[] = DEFS.map(() => false);
  private readonly level: number[] = DEFS.map(() => 0);
  private readonly unit: string[] = DEFS.map(() => '');
  private readonly refFirst = new Map<string, number>();
  private readonly flights: Flight[] = [];
  private readonly srcPos: Float32Array[] = [];
  private readonly tgtPos: Float32Array[] = [];

  /** One ring per (gland, hormone) pair for the current body. */
  private ringPos: Float32Array = new Float32Array(MAX_RINGS * 3);
  private ringHormone: number[] = [];

  private bodyKey = '';
  private haveSnapshot = false;
  private readonly anchors = new Map<string, THREE.Vector3>();

  constructor() {
    this.root.visible = false;
    for (let h = 0; h < DEFS.length; h++) {
      for (let k = 0; k < SLOTS; k++) {
        const r = ((h * 7919 + k * 104729) % 1000) / 1000;
        this.flights.push({ hormone: h, src: 0, tgt: 0, u: r, speed: 0.8 + 0.4 * (((k * 2654435761) >>> 0) % 1000) / 1000, alive: false, rand: r });
      }
      this.srcPos.push(new Float32Array(0));
      this.tgtPos.push(new Float32Array(0));
    }
    const count = MAX_RINGS + this.flights.length * (1 + TAIL);
    const geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    this.colourAttr = new THREE.BufferAttribute(new Float32Array(count * 4), 4);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(count), 1);
    // Kind: 0 droplet head, 1 gland ring, 2 tail dot. Picks the pixel floor and the sprite.
    this.kindAttr = new THREE.BufferAttribute(new Float32Array(count), 1);
    for (let i = 0; i < MAX_RINGS; i++) this.kindAttr.array[i] = 1;
    for (let n = 0; n < this.flights.length; n++) {
      for (let j = 0; j <= TAIL; j++) this.kindAttr.array[MAX_RINGS + n * (1 + TAIL) + j] = j === 0 ? 0 : 2;
    }
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.colourAttr.setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.positionAttr);
    geometry.setAttribute('aColour', this.colourAttr);
    geometry.setAttribute('aSize', this.sizeAttr);
    geometry.setAttribute('aKind', this.kindAttr);

    const material = new THREE.ShaderMaterial({
      name: 'HormoneTraffic',
      uniforms: {
        uDropMin: { value: DROP_MIN_PX },
        uDropMax: { value: DROP_MAX_PX },
        uTailMin: { value: TAIL_MIN_PX },
        uRingMin: { value: RING_MIN_PX },
        uRingMax: { value: RING_MAX_PX },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aColour;
        attribute float aSize;
        attribute float aKind;
        uniform float uDropMin, uDropMax, uTailMin, uRingMin, uRingMax;
        varying vec4 vColour;
        varying float vKind;
        void main() {
          vColour = aColour;
          vKind = aKind;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float px = aSize / -mv.z;
          float lo = aKind > 1.5 ? uTailMin : (aKind > 0.5 ? uRingMin : uDropMin);
          float hi = aKind > 0.5 && aKind < 1.5 ? uRingMax : uDropMax;
          gl_PointSize = aSize > 0.0 ? clamp(px, lo, hi) : 0.0;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec4 vColour;
        varying float vKind;
        void main() {
          vec2 d = gl_PointCoord - vec2(0.5);
          float r = length(d) * 2.0;
          if (r > 1.0) discard;
          vec3 dark = vColour.rgb * 0.55;
          if (vKind > 0.5 && vKind < 1.5) {
            // Gland ring: a solid saturated band with a dark outer edge and a faint tinted
            // fill, so it reads as a halo on cream and over a red organ alike.
            float band = smoothstep(0.46, 0.54, r) * (1.0 - smoothstep(0.9, 0.97, r));
            float edge = smoothstep(0.88, 0.95, r);
            float fill = 0.2 * (1.0 - smoothstep(0.0, 0.62, r));
            vec3 c = mix(vColour.rgb, dark, edge);
            float a = max(band, fill) * vColour.a;
            if (a < 0.01) discard;
            gl_FragColor = vec4(c, a);
          } else {
            // Droplet: a solid disc with a darker rim. Tail dots are the same sprite, smaller.
            float rim = smoothstep(0.55, 0.9, r);
            vec3 c = mix(vColour.rgb, dark, rim);
            float edge = 1.0 - smoothstep(0.85, 1.0, r);
            gl_FragColor = vec4(c, vColour.a * edge);
          }
        }
      `,
      blending: THREE.NormalBlending,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.renderOrder = 23;
    this.points.frustumCulled = false;
    this.root.add(this.points);

    this.lineGeometry = new THREE.BufferGeometry();
    const lineMaterial = new THREE.ShaderMaterial({
      name: 'HormoneWiring',
      vertexShader: /* glsl */ `
        attribute vec4 aColour;
        varying vec4 vColour;
        void main() {
          vColour = aColour;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec4 vColour;
        void main() { gl_FragColor = vColour; }
      `,
      blending: THREE.NormalBlending,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    this.lines = new THREE.LineSegments(this.lineGeometry, lineMaterial);
    this.lines.renderOrder = 22;
    this.lines.frustumCulled = false;
    this.root.add(this.lines);
  }

  /* -------------------------------------------------------------------------- anchors */

  private rebuildAnchors(female: boolean, pregnant: boolean): void {
    const a = this.anchors;
    a.clear();
    const raw = (id: string, ox = 0, oy = 0, oz = 0) => {
      const d = organDef(id);
      const w = warpPoint([d.position[0] + d.layoutOffset[0] + ox, d.position[1] + d.layoutOffset[1] + oy, d.position[2] + d.layoutOffset[2] + oz]);
      return v3(w[0], w[1], w[2]);
    };
    const head = (ox: number, oy: number, oz: number) => {
      const d = organDef('brain');
      return v3(d.position[0] + ox, d.position[1] + CRANIAL_OFFSET_Y + oy, d.position[2] + oz);
    };
    a.set('pituitary', head(0, -0.034, 0.012));
    a.set('hypothalamus', head(0, -0.022, 0.012));
    a.set('brain', head(0, 0.0, 0.0));
    a.set('thyroid', raw('thyroid'));
    a.set('adrenalR', raw('adrenal_r'));
    a.set('adrenalL', raw('adrenal_l'));
    // The pancreas lies along the splenic artery behind the stomach; organs.json gives it
    // no origin of its own, so it is placed from that landmark (the artery starts at
    // (-0.04, 0.066, -0.01)).
    const pw = warpPoint([-0.022, 0.056, -0.014]);
    a.set('pancreas', v3(pw[0], pw[1], pw[2]));
    a.set('liver', raw('liver'));
    a.set('heart', raw('heart'));
    a.set('lungR', raw('lung_r'));
    a.set('lungL', raw('lung_l'));
    a.set('kidneyR', raw('kidney_r'));
    a.set('kidneyL', raw('kidney_l'));
    const wp = (x: number, y: number, z: number) => {
      const w = warpPoint([x, y, z]);
      return v3(w[0], w[1], w[2]);
    };
    // Muscle: the thighs. Vessels: the thoracic aorta and the femoral arteries.
    a.set('muscleR', wp(0.05, -0.19, -0.01));
    a.set('muscleL', wp(-0.056, -0.19, -0.01));
    a.set('aorta', wp(-0.026, 0.18, -0.02));
    a.set('thighVesselR', wp(0.047, -0.2, -0.002));
    a.set('thighVesselL', wp(-0.054, -0.2, -0.002));
    if (female) {
      a.set('ovaryR', raw('ovaries', 0.04, 0, 0));
      a.set('ovaryL', raw('ovaries', -0.04, 0, 0));
      a.set('uterus', raw('uterus'));
      a.set('breastR', raw('breasts', 0.055, 0, 0));
      a.set('breastL', raw('breasts', -0.055, 0, 0));
    } else {
      a.set('testisR', raw('testes', 0.022, 0, 0));
      a.set('testisL', raw('testes', -0.022, 0, 0));
      a.set('prostate', raw('prostate'));
    }

    for (let h = 0; h < DEFS.length; h++) {
      this.srcPos[h] = this.pack(DEFS[h].src(female, pregnant));
      this.tgtPos[h] = this.pack(DEFS[h].tgt(female, pregnant));
    }

    // Rings: one per (gland, hormone) pair. Several hormones on one gland (the pituitary
    // makes five) are spread on a small circle round the gland so each keeps its own ring.
    this.ringHormone = [];
    let n = 0;
    for (const key of GLAND_KEYS) {
      const p = a.get(key);
      if (!p) continue;
      const here: number[] = [];
      for (let h = 0; h < DEFS.length; h++) if (DEFS[h].src(female, pregnant).includes(key)) here.push(h);
      here.forEach((h, i) => {
        if (n >= MAX_RINGS) return;
        const ang = (i / here.length) * Math.PI * 2 + 0.6;
        const off = here.length > 1 ? RING_SPREAD : 0;
        this.ringPos[n * 3] = p.x + Math.cos(ang) * off;
        this.ringPos[n * 3 + 1] = p.y + Math.sin(ang) * off;
        this.ringPos[n * 3 + 2] = p.z + 0.02;
        this.ringHormone[n] = h;
        n++;
      });
    }
    this.ringHormone.length = n;

    this.buildLines();
    // Restart every flight so none points at a position that no longer exists.
    for (const f of this.flights) {
      f.alive = false;
      f.u = f.rand;
    }
  }

  /** The always-on wiring: every source -> target arc of every hormone, as a polyline. */
  private buildLines(): void {
    let arcs = 0;
    for (let h = 0; h < DEFS.length; h++) arcs += (this.srcPos[h].length / 3) * (this.tgtPos[h].length / 3);
    const pos = new Float32Array(arcs * ARC_SEGS * 2 * 3);
    this.lineHormone = [];
    let o = 0;
    for (let h = 0; h < DEFS.length; h++) {
      const sp = this.srcPos[h];
      const tp = this.tgtPos[h];
      for (let s = 0; s < sp.length / 3; s++) {
        for (let t = 0; t < tp.length / 3; t++) {
          for (let i = 0; i < ARC_SEGS; i++) {
            arcPoint(pos, o, sp, s, tp, t, curveOf(h), sideOf(s, t), i / ARC_SEGS);
            arcPoint(pos, o + 3, sp, s, tp, t, curveOf(h), sideOf(s, t), (i + 1) / ARC_SEGS);
            o += 6;
            this.lineHormone.push(h, h);
          }
        }
      }
    }
    this.lineGeometry.dispose();
    this.lineGeometry = new THREE.BufferGeometry();
    this.lineGeometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const col = new THREE.BufferAttribute(new Float32Array((pos.length / 3) * 4), 4);
    col.setUsage(THREE.DynamicDrawUsage);
    this.lineGeometry.setAttribute('aColour', col);
    this.lines.geometry = this.lineGeometry;
    this.linesDirty = true;
  }

  private refreshLineColours(): void {
    const col = this.lineGeometry.getAttribute('aColour') as THREE.BufferAttribute;
    const arr = col.array as Float32Array;
    for (let i = 0; i < this.lineHormone.length; i++) {
      const h = this.lineHormone[i];
      if (!this.present[h]) {
        arr[i * 4 + 3] = 0;
        continue;
      }
      this.tmp.setHex(DEFS[h].colour);
      arr[i * 4] = this.tmp.r;
      arr[i * 4 + 1] = this.tmp.g;
      arr[i * 4 + 2] = this.tmp.b;
      arr[i * 4 + 3] = ARC_ALPHA;
    }
    col.needsUpdate = true;
    this.linesDirty = false;
  }

  private pack(keys: Where[]): Float32Array {
    const list = keys.map((k) => this.anchors.get(k)).filter((p): p is THREE.Vector3 => !!p);
    const out = new Float32Array(list.length * 3);
    list.forEach((p, i) => {
      out[i * 3] = p.x;
      out[i * 3 + 1] = p.y;
      out[i * 3 + 2] = p.z;
    });
    return out;
  }

  /* ----------------------------------------------------------------------- snapshots */

  setVisible(on: boolean): void {
    this.root.visible = on;
  }

  pushSnapshot(s: SimSnapshot): void {
    const female = s.reproductive.sex === 'female';
    const pregnant = female && s.reproductive.pregnancy.pregnant;
    const key = `${female ? 'f' : 'm'}${pregnant ? 'p' : ''}`;
    if (key !== this.bodyKey) {
      this.bodyKey = key;
      this.refFirst.clear();
      this.rebuildAnchors(female, pregnant);
    }

    const byId = new Map<string, { level: number; unit: string; refHigh: number }>();
    for (const h of s.endocrine.hormones) byId.set(h.id, { level: h.level, unit: h.unit, refHigh: h.refHigh });
    byId.set('insulin', { level: s.metabolic.insulin_uU_per_mL, unit: 'uU/mL', refHigh: 0 });
    // Adrenaline: gland output as a multiple of basal, NOT a plasma level (header).
    const med = s.anatomy?.glands?.adrenal_medulla;
    if (med !== undefined) byId.set('adrenaline', { level: med, unit: 'x basal (gland output)', refHigh: 0 });

    for (let h = 0; h < DEFS.length; h++) {
      const e = byId.get(DEFS[h].id);
      const was = this.present[h];
      if (!e || !Number.isFinite(e.level)) {
        this.present[h] = false;
        if (was) this.linesDirty = true;
        continue;
      }
      this.present[h] = true;
      if (!was) this.linesDirty = true;
      this.level[h] = e.level;
      this.unit[h] = e.unit;
      if (!this.refFirst.has(DEFS[h].id)) this.refFirst.set(DEFS[h].id, e.level);
      const ref = this.refFirst.get(DEFS[h].id) ?? 0;
      let ratio: number;
      if (DEFS[h].id === 'adrenaline') ratio = e.level; // already relative to basal
      else if (ref > 0) ratio = e.level / ref;
      else ratio = e.refHigh > 0 ? 1 + e.level / e.refHigh : e.level > 0 ? 2 : 1;
      this.ratio[h] = ratio;
    }
    this.haveSnapshot = true;
  }

  /** Every hormone currently live, with its ratio to the resting reference. */
  legend(): HormoneLegendEntry[] {
    const out: HormoneLegendEntry[] = [];
    if (!this.haveSnapshot) return out;
    for (let h = 0; h < DEFS.length; h++) {
      if (!this.present[h]) continue;
      out.push({
        id: DEFS[h].id,
        label: DEFS[h].short,
        colour: `#${DEFS[h].colour.toString(16).padStart(6, '0')}`,
        gland: DEFS[h].glandLabel,
        level: this.level[h],
        unit: this.unit[h],
        ratio: this.ratio[h],
      });
    }
    return out;
  }

  /* ------------------------------------------------------------------------ per frame */

  private readonly tmp = new THREE.Color();
  private time_ = 0;

  update(dt: number): void {
    if (!this.root.visible || !this.haveSnapshot) return;
    if (this.linesDirty) this.refreshLineColours();
    const pos = this.positionAttr.array as Float32Array;
    const col = this.colourAttr.array as Float32Array;
    const size = this.sizeAttr.array as Float32Array;

    // Rings first: brightness from the hormone's own ratio, size nudged up when it is high.
    for (let i = 0; i < MAX_RINGS; i++) {
      const h = i < this.ringHormone.length ? this.ringHormone[i] : -1;
      if (h < 0 || !this.present[h]) {
        size[i] = 0;
        continue;
      }
      pos[i * 3] = this.ringPos[i * 3];
      pos[i * 3 + 1] = this.ringPos[i * 3 + 1];
      pos[i * 3 + 2] = this.ringPos[i * 3 + 2];
      this.tmp.setHex(DEFS[h].colour);
      col[i * 4] = this.tmp.r;
      col[i * 4 + 1] = this.tmp.g;
      col[i * 4 + 2] = this.tmp.b;
      const b = compress(this.ratio[h]);
      col[i * 4 + 3] = 0.75 + 0.25 * b;
      size[i] = RING_R * SIZE_SCALE * (0.85 + 0.4 * b);
    }

    const base = MAX_RINGS;
    for (let n = 0; n < this.flights.length; n++) {
      const f = this.flights[n];
      const o = base + n * (1 + TAIL);
      const h = f.hormone;
      const sp = this.srcPos[h];
      const tp = this.tgtPos[h];
      const hide = () => {
        for (let j = 0; j <= TAIL; j++) size[o + j] = 0;
      };
      if (!this.present[h] || sp.length === 0 || tp.length === 0) {
        hide();
        f.alive = false;
        continue;
      }
      if (!f.alive) {
        // Wait here until the level asks for this slot; a slot starts a flight only at
        // the beginning of one, so a falling level never makes a droplet vanish mid-arc.
        const k = n % SLOTS;
        if ((k + 0.5) / SLOTS < compress(this.ratio[h])) {
          f.alive = true;
          f.u = 0;
          f.src = (k + Math.floor(f.rand * 7)) % (sp.length / 3);
          f.tgt = (k + Math.floor(this.time_ * 0.37)) % (tp.length / 3);
        } else {
          hide();
          continue;
        }
      }
      f.u += (dt * f.speed) / FLIGHT_S;
      if (f.u >= 1) {
        f.alive = false;
        f.u = 0;
        hide();
        continue;
      }
      const curve = curveOf(h);
      const side = sideOf(f.src, f.tgt);
      this.tmp.setHex(DEFS[h].colour);
      // Plateau opacity: full for most of the flight, a quick fade at each end.
      const fade = Math.min(1, f.u * 10, (1 - f.u) * 10);
      for (let j = 0; j <= TAIL; j++) {
        const uj = f.u - j * TAIL_STEP_U;
        const q = o + j;
        if (uj < 0) {
          size[q] = 0;
          continue;
        }
        arcPoint(pos, q * 3, sp, f.src, tp, f.tgt, curve, side, uj);
        col[q * 4] = this.tmp.r;
        col[q * 4 + 1] = this.tmp.g;
        col[q * 4 + 2] = this.tmp.b;
        col[q * 4 + 3] = fade * (j === 0 ? 1 : 0.6 / j);
        size[q] = DROP_R * SIZE_SCALE * (j === 0 ? 1 : 1 - 0.22 * j);
      }
    }
    this.time_ += dt;
    this.positionAttr.needsUpdate = true;
    this.colourAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    this.lineGeometry.dispose();
    (this.lines.material as THREE.Material).dispose();
  }
}
