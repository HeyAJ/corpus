import * as THREE from 'three';
import type { SimSnapshot } from '../../bridge/types';
import { organDef, warpPoint } from '../anatomy/layout';

/**
 * THE HORMONE-TRAFFIC OVERLAY.
 *
 * Glands are soft beacons; coloured droplets leave a gland and travel a smooth arc to the
 * organs the hormone is taught to act on. Droplets come more often the further a hormone
 * is above its resting level, so a stress response visibly floods cortisol and adrenaline
 * and a meal visibly floods insulin.
 *
 * THE ARCS ARE A DIAGRAM OF SOURCE -> TARGET, NOT A ROUTE. Hormones really travel in the
 * blood, to every tissue, and act only where a cell carries the receptor. The arcs say
 * "this gland acts on that organ" and nothing about the path or the speed. The droplet
 * travel time, size, colours, the resting trickle and the log-compression below are
 * display constants; none is a physiological number.
 *
 * Source for the gland-to-target pairs: the endocrine chapters of Standring (ed.), Gray's
 * Anatomy, 42nd edition, and the usual textbook statements of each hormone's principal
 * target tissues. Where a target list is long in reality (cortisol and thyroid hormone
 * act almost everywhere) a few representative organs are drawn and the comment says so.
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
 * DRAW CALLS: one. Gland beacons and droplets share a single Points object, normal
 * (alpha) blending in the top bucket (renderOrder 22). Additive blending would vanish on
 * the pale page; ordinary blending of saturated dots does not. Nothing here is a multiply
 * object, so the order-independence argument for the organ shells is untouched.
 *
 * A hidden overlay does no per-frame work. A visible one writes the position, colour and
 * size of a fixed pool of droplets and allocates nothing.
 */

/* ------------------------------------------------------------------ display constants */

/** Droplet slots per hormone. */
const SLOTS = 34;
/** Seconds a droplet takes to fly its arc. */
const FLIGHT_S = 3.4;
/** Droplet radius and beacon radius in metres, for the point-size attribute. */
const DROP_R = 0.017;
const BEACON_R = 0.07;
/** Same scale factor the vessel particles use: pixels * distance per metre of radius. */
const SIZE_SCALE = 2600;
/** Fraction of slots in flight at resting level, and the log-compression slope. */
const REST_FRAC = 0.16;
const LOG_SLOPE = 0.42;
const MIN_FRAC = 0.03;
/** The legend only lists hormones outside these bounds. */
export const LEGEND_HIGH = 1.2;
export const LEGEND_LOW = 0.8;

/** Level ratio -> fraction of droplet slots in flight (and beacon brightness), clamped. */
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

const DEFS: HormoneDef[] = [
  // Cortisol acts nearly everywhere; liver (gluconeogenesis), heart, brain, muscle and kidney stand for it.
  { id: 'cortisol', short: 'Cortisol', colour: 0x2e8b57, glandLabel: 'adrenal cortex', src: () => ['adrenalR', 'adrenalL'], tgt: () => ['liver', 'heart', 'brain', ...MUSCLE, 'kidneyR'] },
  // Adrenal medulla output: heart, lungs and vessels (aorta and the thigh vessels).
  { id: 'adrenaline', short: 'Adrenaline', colour: 0xd6247a, glandLabel: 'adrenal medulla', src: () => ['adrenalR', 'adrenalL'], tgt: () => ['heart', 'lungR', 'lungL', 'aorta', 'thighVesselR', 'thighVesselL'] },
  { id: 'insulin', short: 'Insulin', colour: 0x1a73e8, glandLabel: 'pancreas', src: () => ['pancreas'], tgt: () => ['liver', ...MUSCLE] },
  { id: 'glucagon', short: 'Glucagon', colour: 0xf08a00, glandLabel: 'pancreas', src: () => ['pancreas'], tgt: () => ['liver'] },
  { id: 'adh', short: 'ADH', colour: 0x00a5b5, glandLabel: 'pituitary', src: () => ['pituitary'], tgt: () => ['kidneyR', 'kidneyL'] },
  { id: 'aldosterone', short: 'Aldosterone', colour: 0x8a6a35, glandLabel: 'adrenal cortex', src: () => ['adrenalR', 'adrenalL'], tgt: () => ['kidneyR', 'kidneyL'] },
  // Thyroid hormone: heart, liver, brain and muscle stand for "widely".
  { id: 'thyroxine', short: 'Thyroid hormone', colour: 0x5e35b1, glandLabel: 'thyroid', src: () => ['thyroid'], tgt: () => ['heart', 'liver', 'brain', ...MUSCLE] },
  { id: 'oxytocin', short: 'Oxytocin', colour: 0xff6fa5, glandLabel: 'pituitary', src: () => ['pituitary'], tgt: (f) => (f ? ['uterus', 'breastR', 'breastL'] : ['prostate']) },
  { id: 'prolactin', short: 'Prolactin', colour: 0xb05cc8, glandLabel: 'pituitary', src: () => ['pituitary'], tgt: () => ['breastR', 'breastL'] },
  { id: 'lh', short: 'LH', colour: 0x7cb342, glandLabel: 'pituitary', src: () => ['pituitary'], tgt: () => ['ovaryR', 'ovaryL'] },
  { id: 'fsh', short: 'FSH', colour: 0xb8b800, glandLabel: 'pituitary', src: () => ['pituitary'], tgt: () => ['ovaryR', 'ovaryL'] },
  { id: 'estradiol', short: 'Oestradiol', colour: 0xf06292, glandLabel: 'ovary / placenta', src: (_f, p) => (p ? ['uterus'] : ['ovaryR', 'ovaryL']), tgt: () => ['uterus', 'breastR', 'breastL', 'hypothalamus'] },
  { id: 'progesterone', short: 'Progesterone', colour: 0xab47bc, glandLabel: 'ovary / placenta', src: (_f, p) => (p ? ['uterus'] : ['ovaryR', 'ovaryL']), tgt: () => ['uterus', 'breastR', 'breastL', 'hypothalamus'] },
  { id: 'testosterone', short: 'Testosterone', colour: 0x1e5fa8, glandLabel: 'testes / ovary', src: (f, p) => (!f ? ['testisR', 'testisL'] : p ? ['uterus'] : ['ovaryR', 'ovaryL']), tgt: (f) => (f ? [...MUSCLE] : [...MUSCLE, 'prostate']) },
  { id: 'hcg', short: 'hCG', colour: 0x00897b, glandLabel: 'placenta', src: () => ['uterus'], tgt: () => ['ovaryR', 'ovaryL'] },
];

/** Gland keys that get a beacon, with the hormones whose level lights them. */
const BEACON_KEYS: Where[] = ['pituitary', 'thyroid', 'adrenalR', 'adrenalL', 'pancreas', 'ovaryR', 'ovaryL', 'testisR', 'testisL', 'uterus'];

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Rigid cranial group offset, metres (organs.json groupLayout.cranial). */
const CRANIAL_OFFSET_Y = 0.06;

interface Flight {
  hormone: number;
  /** Index into the hormone's source and target position lists. */
  src: number;
  tgt: number;
  u: number;
  speed: number;
  alive: boolean;
  bulge: number;
  rand: number;
}

export class HormoneTraffic {
  readonly root = new THREE.Group();

  private readonly points: THREE.Points;
  private readonly positionAttr: THREE.BufferAttribute;
  private readonly colourAttr: THREE.BufferAttribute;
  private readonly sizeAttr: THREE.BufferAttribute;

  /** Per-hormone live state, indexed like DEFS. */
  private readonly ratio: number[] = DEFS.map(() => 1);
  private readonly present: boolean[] = DEFS.map(() => false);
  private readonly level: number[] = DEFS.map(() => 0);
  private readonly unit: string[] = DEFS.map(() => '');
  private readonly refFirst = new Map<string, number>();
  private readonly flights: Flight[] = [];
  private readonly srcPos: Float32Array[] = [];
  private readonly tgtPos: Float32Array[] = [];
  private readonly beaconPos: Float32Array = new Float32Array(BEACON_KEYS.length * 3);
  private readonly beaconOn: boolean[] = BEACON_KEYS.map(() => false);
  private readonly beaconBright: number[] = BEACON_KEYS.map(() => 0);
  private readonly beaconHormone: number[] = BEACON_KEYS.map(() => -1);

  private bodyKey = '';
  private haveSnapshot = false;
  private gland = { adrenalMedulla: 1 };
  private readonly anchors = new Map<string, THREE.Vector3>();

  constructor() {
    this.root.visible = false;
    for (let h = 0; h < DEFS.length; h++) {
      for (let k = 0; k < SLOTS; k++) {
        const r = ((h * 7919 + k * 104729) % 1000) / 1000;
        this.flights.push({ hormone: h, src: 0, tgt: 0, u: r, speed: 0.8 + 0.4 * (((k * 2654435761) >>> 0) % 1000) / 1000, alive: false, bulge: k % 2 ? 1 : -1, rand: r });
      }
      this.srcPos.push(new Float32Array(0));
      this.tgtPos.push(new Float32Array(0));
    }
    const count = BEACON_KEYS.length + this.flights.length;
    const geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    this.colourAttr = new THREE.BufferAttribute(new Float32Array(count * 4), 4);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(count), 1);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.colourAttr.setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.positionAttr);
    geometry.setAttribute('aColour', this.colourAttr);
    geometry.setAttribute('aSize', this.sizeAttr);

    const material = new THREE.ShaderMaterial({
      name: 'HormoneTraffic',
      vertexShader: /* glsl */ `
        attribute vec4 aColour;
        attribute float aSize;
        varying vec4 vColour;
        void main() {
          vColour = aColour;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = max(aSize > 0.0 ? 6.0 : 0.0, aSize * (1.0 / -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec4 vColour;
        void main() {
          vec2 d = gl_PointCoord - vec2(0.5);
          float r2 = dot(d, d);
          if (r2 > 0.25) discard;
          // Soft glow in the middle, a slightly darker rim so a droplet reads on a pale
          // page as well as over a red organ.
          float core = 1.0 - smoothstep(0.0, 0.25, r2);
          float rim = smoothstep(0.12, 0.2, r2);
          vec3 c = mix(vColour.rgb, vColour.rgb * 0.55, rim);
          gl_FragColor = vec4(c, vColour.a * (0.35 + 0.65 * core));
        }
      `,
      blending: THREE.NormalBlending,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.renderOrder = 22;
    this.points.frustumCulled = false;
    this.root.add(this.points);
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
    void pregnant;

    for (let h = 0; h < DEFS.length; h++) {
      this.srcPos[h] = this.pack(DEFS[h].src(female, pregnant));
      this.tgtPos[h] = this.pack(DEFS[h].tgt(female, pregnant));
    }
    // Beacon positions.
    for (let i = 0; i < BEACON_KEYS.length; i++) {
      const p = a.get(BEACON_KEYS[i]);
      this.beaconOn[i] = !!p;
      if (p) {
        this.beaconPos[i * 3] = p.x;
        this.beaconPos[i * 3 + 1] = p.y;
        this.beaconPos[i * 3 + 2] = p.z;
      }
    }
    // Which hormone colours a beacon: the first hormone that has it as a source.
    for (let i = 0; i < BEACON_KEYS.length; i++) {
      this.beaconHormone[i] = DEFS.findIndex((d) => d.src(female, pregnant).includes(BEACON_KEYS[i]));
    }
    // Restart every flight so none points at a position that no longer exists.
    for (const f of this.flights) {
      f.alive = false;
      f.u = f.rand;
    }
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
    if (med !== undefined) {
      byId.set('adrenaline', { level: med, unit: 'x basal (gland output)', refHigh: 0 });
      this.gland.adrenalMedulla = med;
    }

    for (let h = 0; h < DEFS.length; h++) {
      const e = byId.get(DEFS[h].id);
      if (!e || !Number.isFinite(e.level)) {
        this.present[h] = false;
        continue;
      }
      this.present[h] = true;
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

    // Beacon brightness: the strongest ratio among hormones this gland makes.
    for (let i = 0; i < BEACON_KEYS.length; i++) {
      let best = 0;
      for (let h = 0; h < DEFS.length; h++) {
        if (!this.present[h]) continue;
        if (!DEFS[h].src(female, pregnant).includes(BEACON_KEYS[i])) continue;
        best = Math.max(best, compress(this.ratio[h]));
      }
      this.beaconBright[i] = best;
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

  update(dt: number): void {
    if (!this.root.visible || !this.haveSnapshot) return;
    const pos = this.positionAttr.array as Float32Array;
    const col = this.colourAttr.array as Float32Array;
    const size = this.sizeAttr.array as Float32Array;

    // Beacons first: soft, large, brightness from the gland's strongest ratio.
    for (let i = 0; i < BEACON_KEYS.length; i++) {
      const on = this.beaconOn[i] && this.beaconHormone[i] >= 0;
      pos[i * 3] = this.beaconPos[i * 3];
      pos[i * 3 + 1] = this.beaconPos[i * 3 + 1];
      pos[i * 3 + 2] = this.beaconPos[i * 3 + 2];
      if (!on) {
        size[i] = 0;
        continue;
      }
      this.tmp.setHex(DEFS[this.beaconHormone[i]].colour);
      col[i * 4] = this.tmp.r;
      col[i * 4 + 1] = this.tmp.g;
      col[i * 4 + 2] = this.tmp.b;
      const b = this.beaconBright[i];
      col[i * 4 + 3] = 0.22 + 0.55 * b;
      size[i] = BEACON_R * SIZE_SCALE * (0.8 + 0.5 * b);
    }

    const base = BEACON_KEYS.length;
    for (let n = 0; n < this.flights.length; n++) {
      const f = this.flights[n];
      const o = base + n;
      const h = f.hormone;
      const sp = this.srcPos[h];
      const tp = this.tgtPos[h];
      if (!this.present[h] || sp.length === 0 || tp.length === 0) {
        size[o] = 0;
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
          size[o] = 0;
          continue;
        }
      }
      f.u += (dt * f.speed) / FLIGHT_S;
      if (f.u >= 1) {
        f.alive = false;
        f.u = 0;
        size[o] = 0;
        continue;
      }
      const sx = sp[f.src * 3];
      const sy = sp[f.src * 3 + 1];
      const sz = sp[f.src * 3 + 2];
      const tx = tp[f.tgt * 3];
      const ty = tp[f.tgt * 3 + 1];
      const tz = tp[f.tgt * 3 + 2];
      const dx = tx - sx;
      const dy = ty - sy;
      const dz = tz - sz;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6;
      // Quadratic Bezier through a control point lifted sideways (x) and toward the
      // viewer (z) by a quarter of the span, so arcs fan out instead of overprinting.
      const cx = (sx + tx) / 2 + f.bulge * 0.18 * len;
      const cy = (sy + ty) / 2;
      const cz = (sz + tz) / 2 + 0.2 * len;
      const u = f.u;
      const a = (1 - u) * (1 - u);
      const b = 2 * (1 - u) * u;
      const c = u * u;
      pos[o * 3] = a * sx + b * cx + c * tx;
      pos[o * 3 + 1] = a * sy + b * cy + c * ty;
      pos[o * 3 + 2] = a * sz + b * cz + c * tz;
      this.tmp.setHex(DEFS[h].colour);
      col[o * 4] = this.tmp.r;
      col[o * 4 + 1] = this.tmp.g;
      col[o * 4 + 2] = this.tmp.b;
      col[o * 4 + 3] = Math.sin(Math.PI * u) * 0.95;
      size[o] = DROP_R * SIZE_SCALE;
    }
    this.time_ += dt;
    this.positionAttr.needsUpdate = true;
    this.colourAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }

  private time_ = 0;

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
