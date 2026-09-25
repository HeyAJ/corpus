import * as THREE from 'three';
import type { SimSnapshot } from '../../bridge/types';
import {
  buildCentrelines,
  radiusAt,
  sampleAt,
  saturationFor,
  type Centreline,
} from './centrelines';

/**
 * THE VASCULAR OVERLAY.
 *
 * Arteries and veins as geometry, with blood visibly moving through them carrying
 * whatever the simulation says is in it.
 *
 * WHICH BUCKETS, AND WHY IT MATTERS.
 *
 *   vessel walls  -> BUCKET 1, multiply, renderOrder 12
 *   flow particles -> BUCKET 2, additive, renderOrder 22
 *
 * That is not an arbitrary choice. The project's central rendering claim is that the
 * organ stack is EXACTLY order-independent because absorption is multiplication and
 * multiplication commutes. Multiply does not commute with add, so the two buckets
 * must stay separated — but WITHIN each bucket any number of new objects can be added
 * without touching the guarantee. Vessels are tinted tissue, so they are absorption;
 * particles are something glowing as it moves, so they are additive. Both land in a
 * bucket that already exists, and `tests/render/order-independence.test.ts` continues
 * to hold unchanged. The tree grew from 32 to 60 segments and everything that follows
 * still lives in exactly those two buckets, so nothing about the guarantee moved.
 *
 * WHAT THE PARTICLES ACTUALLY SHOW.
 *
 * Each particle's colour comes from `snapshot.transport.markers`, which the sim
 * derives and normalises. Give a drug intravenously and its marker appears; particles
 * carrying it are tinted its colour, in proportion to how much of the blood it
 * represents. Speed comes from real aortic flow and pulses with the real cardiac
 * phase, so the surge you see in systole is the surge the Windkessel computed.
 *
 * THE DRUG DOES NOT APPEAR EVERYWHERE AT ONCE. A bolus takes time to circulate, so a
 * marker's colour is gated behind a TRAVELLING FRONT: a value that grows from 0 to 1
 * and only tints a vessel once the front has reached that vessel's distance from the
 * heart. The result is a coloured wave that spreads out of the central vessels into
 * the periphery over a few seconds — which is the thing a student is told about
 * (arm-to-brain circulation time) and almost never sees. The front is pure per-frame
 * colour bookkeeping in the additive bucket; it changes what the particles are tinted,
 * never how they are blended, so the order-independence guarantee is untouched.
 *
 * COLOUR BY SATURATION, NOT BY NAME. A vessel's colour comes from the oxygen
 * saturation of the blood in it, so the pulmonary artery is drawn dark and the
 * pulmonary veins bright — the opposite of every "arteries are red" diagram, and the
 * correct way round. Desaturate the body and the whole arterial tree darkens.
 */

/** Particles per metre of vessel. Tuned so the aorta reads as a stream, not a queue. */
const PARTICLE_DENSITY = 620;
/**
 * Raised from 2200 for the denser 60-vessel tree, but kept well under the ~6000
 * ceiling the perf note asks for: at this density the whole tree lands near 5.3 k
 * particles, each of which is one point sprite, so the cost is a single draw call and
 * one Float32 write per particle per frame.
 */
const MAX_PARTICLES = 5600;

/** Aortic flow that corresponds to one body-unit per second of particle travel. */
const FLOW_REFERENCE_mL_per_s = 90;

/**
 * How fast an injected marker's front crosses the whole tree, in units of normalised
 * heart-distance per second at reference flow. 0.28 puts a full sweep at roughly three
 * to four seconds, which reads as "watch it spread" rather than as a switch flipping.
 */
const FRONT_RATE = 0.28;

/** Soft width of the front, in normalised heart-distance, so the edge is a gradient. */
const FRONT_BAND = 0.16;

/** The heart's own origin in body-local space; the front spreads outward from here. */
const HEART_ORIGIN = new THREE.Vector3(-0.016, 0.168, 0.016);

/** Markers that are steady-state properties of the blood rather than injected boluses. */
const STEADY_MARKERS = new Set(['glucose', 'lactate']);

const OXY_COLOUR = new THREE.Color(0xc8323a);
const DEOXY_COLOUR = new THREE.Color(0x6a4a7a);

interface Particle {
  line: number;
  s: number;
  speedJitter: number;
  colour: THREE.Color;
  /** Blood colour by saturation, recomputed each snapshot; the base the front tints. */
  base: THREE.Color;
  /** Index into `activeMarkers`, or -1 when this particle carries only blood. */
  marker: number;
  /** This particle's distance from the heart, normalised 0..1: when the front reaches it. */
  depth: number;
}

interface ActiveMarker {
  id: string;
  colour: THREE.Color;
  weight: number;
  /** A bolus sweeps out from the heart; a steady-state marker fills the tree at once. */
  sweeps: boolean;
}

export class VascularSystem {
  readonly root = new THREE.Group();

  private readonly lines: Centreline[];
  private readonly wallGroup = new THREE.Group();
  private readonly particles: Particle[] = [];

  private readonly points: THREE.Points;
  private readonly positionAttr: THREE.BufferAttribute;
  private readonly colourAttr: THREE.BufferAttribute;
  private readonly sizeAttr: THREE.BufferAttribute;

  private readonly wallMaterials: THREE.ShaderMaterial[] = [];
  private readonly wallSides: string[] = [];

  /** Per-line normalised distance of the line's midpoint from the heart, 0..1. */
  private readonly lineDepth: number[] = [];

  private flowSpeed = 1;
  private pulse = 1;
  private arterialSat = 0.97;
  private venousSat = 0.72;

  private activeMarkers: ActiveMarker[] = [];
  /** Per-marker travelling front, 0..1, advanced every frame. Keyed by marker id. */
  private readonly fronts = new Map<string, number>();
  private animating = false;

  private readonly scratch = new THREE.Vector3();

  constructor() {
    this.lines = buildCentrelines();
    this.root.visible = false;
    this.root.add(this.wallGroup);

    // Heart-distance per line, then normalised against the deepest vessel, so the
    // front's 0..1 spans the whole tree from the aortic root to the toes.
    const mid = new THREE.Vector3();
    const raw: number[] = [];
    let maxD = 1e-6;
    for (const line of this.lines) {
      mid.copy(line.positions[Math.floor(line.positions.length / 2)]);
      const d = mid.distanceTo(HEART_ORIGIN);
      raw.push(d);
      if (d > maxD) maxD = d;
    }
    for (const d of raw) this.lineDepth.push(d / maxD);

    this.buildWalls();

    /* ----------------------------------------------------------- particles */
    let budget = 0;
    for (let i = 0; i < this.lines.length && budget < MAX_PARTICLES; i++) {
      const n = Math.max(3, Math.round(this.lines[i].length * PARTICLE_DENSITY));
      for (let j = 0; j < n && budget < MAX_PARTICLES; j++) {
        this.particles.push({
          line: i,
          // Spread evenly rather than randomly: a random start clumps visibly at this
          // count, and an even one reads as continuous flow immediately.
          s: (j / n) * this.lines[i].length,
          // A little variation so the stream does not look like a conveyor belt.
          speedJitter: 0.82 + 0.36 * ((j * 2654435761) % 1000) / 1000,
          colour: new THREE.Color(),
          base: new THREE.Color(),
          marker: -1,
          depth: this.lineDepth[i],
        });
        budget++;
      }
    }

    const count = this.particles.length;
    const geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    this.colourAttr = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(count), 1);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.colourAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.positionAttr);
    geometry.setAttribute('aColour', this.colourAttr);
    geometry.setAttribute('aSize', this.sizeAttr);

    for (let i = 0; i < count; i++) {
      const p = this.particles[i];
      // Size from the vessel's own radius, so the aorta carries visibly fatter
      // particles than a renal artery. That is the only cue that conveys calibre.
      this.sizeAttr.setX(i, radiusAt(this.lines[p.line], p.s) * 2600);
    }

    const material = new THREE.ShaderMaterial({
      name: 'VascularFlow',
      uniforms: { uOpacity: { value: 0.85 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColour;
        attribute float aSize;
        varying vec3 vColour;
        void main() {
          vColour = aColour;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // Floored: a renal artery is a fifth the radius of the aorta, and without a
          // floor its particles land under one pixel and simply vanish, which reads as
          // "no blood goes to the kidney" rather than "this vessel is narrow".
          gl_PointSize = max(2.2, aSize * (1.0 / -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying vec3 vColour;
        void main() {
          // Round, soft-edged point. A square particle reads as a glitch.
          vec2 d = gl_PointCoord - vec2(0.5);
          float r = dot(d, d);
          if (r > 0.25) discard;
          float falloff = 1.0 - smoothstep(0.0, 0.25, r);
          gl_FragColor = vec4(vColour * falloff * uOpacity, 1.0);
        }
      `,
      // BUCKET 2. Additive, depth-test on so vessels behind organs stay behind them,
      // depth-write off so particles never occlude each other.
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      transparent: true,
    });

    this.points = new THREE.Points(geometry, material);
    this.points.renderOrder = 22;
    this.points.frustumCulled = false;
    this.root.add(this.points);
  }

  /** Tapered tubes, one per segment, in the absorption bucket. */
  private buildWalls(): void {
    for (const line of this.lines) {
      const path = new THREE.CatmullRomCurve3(line.positions, false, 'catmullrom', 0.5);

      // Resolution scaled to the vessel's calibre. A wide vessel earns a rounder tube;
      // the many new small branches are a few pixels across at body framing, so they
      // draw with a pentagonal cross-section that is invisible at that size and keeps
      // the whole tree — sixty tubes now — well under the ~40 k-triangle budget.
      const maxRadius = Math.max(...line.radii);
      const radial = maxRadius > 0.006 ? 8 : maxRadius > 0.0018 ? 6 : 5;
      const tubular = maxRadius > 0.006 ? 22 : 16;
      const geometry = new THREE.TubeGeometry(path, tubular, 1, radial, false);

      // TubeGeometry takes a constant radius, so the taper is applied afterwards by
      // scaling each ring's offset from its centre. Cheaper and more controllable
      // than a custom extrusion, and it is a one-off cost at construction.
      taperTube(geometry, line);

      const material = new THREE.ShaderMaterial({
        name: 'VesselAbsorption',
        uniforms: {
          uTint: { value: new THREE.Color(0xc8323a) },
          uDensity: { value: 0.16 },
        },
        vertexShader: /* glsl */ `
          varying vec3 vNormalW;
          varying vec3 vViewDirW;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vNormalW = normalize(mat3(modelMatrix) * normal);
            vViewDirW = cameraPosition - wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uTint;
          uniform float uDensity;
          varying vec3 vNormalW;
          varying vec3 vViewDirW;
          void main() {
            vec3 N = normalize(vNormalW);
            vec3 V = normalize(vViewDirW);
            float ndv = abs(dot(N, V));
            // Same Beer-Lambert path-length reasoning as the organ shells: a grazing
            // ray crosses more wall, so it absorbs more.
            // Capped harder than the organ shells. A tube seen edge-on presents a
            // near-infinite path through a wall that is a millimetre thick, and
            // without the cap every vessel silhouette turned into an opaque brown
            // outline that read as plumbing rather than as something blood is in.
            float path = 1.0 / max(ndv, 0.34);
            vec3 T = exp(-uDensity * path * (1.0 - uTint));
            gl_FragColor = vec4(T, 1.0);
          }
        `,
        // BUCKET 1. Multiply, and therefore order-independent with the organ shells.
        blending: THREE.CustomBlending,
        blendSrc: THREE.DstColorFactor,
        blendDst: THREE.ZeroFactor,
        depthWrite: false,
        depthTest: true,
        transparent: true,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 12;
      mesh.frustumCulled = false;
      this.wallGroup.add(mesh);
      this.wallMaterials.push(material);
      this.wallSides.push(line.side);
    }
  }

  setVisible(on: boolean): void {
    this.root.visible = on;
  }

  get visible(): boolean {
    return this.root.visible;
  }

  /** Called at snapshot rate (20 Hz), not per frame. */
  pushSnapshot(s: SimSnapshot): void {
    const t = s.transport;
    this.arterialSat = t.arterialSat;
    this.venousSat = t.venousSat;

    // Flow speed from real aortic flow. Floored rather than allowed to reach zero:
    // in an arrest the flow IS zero, and particles frozen mid-vessel is exactly the
    // right picture, but a hard zero also freezes the pulse and the view looks broken
    // rather than arrested. The floor is small enough to read as "barely moving".
    this.flowSpeed = Math.max(0.02, t.aorticFlow_mL_per_s / FLOW_REFERENCE_mL_per_s);

    // Pulsatility: flow surges in systole. pulsePhase is 0..1 within the cycle and
    // systole occupies roughly its first third.
    this.pulse = t.pulsePhase < 0.33 ? 1.0 + 1.6 * Math.sin((t.pulsePhase / 0.33) * Math.PI) : 0.55;

    // Rebuild the active-marker set. A particle is tinted by one marker, chosen in
    // proportion to that marker's level, so a drug at 30 % of its scale tints roughly
    // 30 % of the particles — density as the visual variable rather than brightness,
    // which stays readable when several substances are present at once.
    this.activeMarkers = [];
    for (const m of t.markers) {
      if (m.level <= 0.001) continue;
      // Oxygen and CO2 are carried by the blood itself, not floating in it; they
      // colour the VESSEL, not the particles, so they are skipped here.
      if (m.id === 'oxygen' || m.id === 'co2') continue;
      this.activeMarkers.push({
        id: m.id,
        colour: new THREE.Color(m.colour),
        weight: m.level,
        // A steady-state marker (glucose, lactate) is everywhere already; only an
        // injected substance travels, and gets a front that starts at the heart.
        sweeps: !STEADY_MARKERS.has(m.id),
      });
    }

    // Retire fronts whose marker is no longer present, and seed a new sweeping marker
    // just above zero so its first frame lights the central vessels rather than nothing.
    const activeIds = new Set(this.activeMarkers.map((m) => m.id));
    for (const id of [...this.fronts.keys()]) if (!activeIds.has(id)) this.fronts.delete(id);
    for (const m of this.activeMarkers) {
      if (!m.sweeps) this.fronts.set(m.id, 1);
      else if (!this.fronts.has(m.id)) this.fronts.set(m.id, 0.04);
    }

    this.assignBaseColours();
    this.assignMarkers();
    this.refreshColours();
    this.updateWallColours();

    this.animating = this.activeMarkers.some((m) => m.sweeps && (this.fronts.get(m.id) ?? 1) < 0.999);
  }

  /** Blood colour by saturation for every particle; the base the marker front tints over. */
  private assignBaseColours(): void {
    for (const p of this.particles) {
      const side = this.lines[p.line].side;
      const sat = saturationFor(side, this.arterialSat, this.venousSat);
      p.base.copy(DEOXY_COLOUR).lerp(OXY_COLOUR, Math.max(0, Math.min(1, (sat - 0.5) / 0.5)));
    }
  }

  /**
   * Assign each particle at most one marker by a deterministic weighted draw, so the
   * same particle keeps carrying the same substance from frame to frame and the stream
   * does not shimmer. The FRONT decides whether that assignment is yet visible; this
   * only decides which colour it would be.
   */
  private assignMarkers(): void {
    const total = this.activeMarkers.reduce((a, m) => a + m.weight, 0);
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (total <= 0.001) {
        p.marker = -1;
        continue;
      }
      const r = ((i * 2654435761) % 10000) / 10000 * Math.max(1, total);
      let acc = 0;
      p.marker = -1;
      for (let m = 0; m < this.activeMarkers.length; m++) {
        acc += this.activeMarkers[m].weight;
        if (r < acc) {
          p.marker = m;
          break;
        }
      }
    }
  }

  /** Blend each particle from blood toward its marker colour, gated by the front. */
  private refreshColours(): void {
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.marker < 0) {
        p.colour.copy(p.base);
      } else {
        const m = this.activeMarkers[p.marker];
        const front = this.fronts.get(m.id) ?? 1;
        // How far the front has swept past this particle's distance from the heart,
        // softened over FRONT_BAND so the leading edge is a gradient, not a hard line.
        const reach = m.sweeps
          ? Math.max(0, Math.min(1, (front - p.depth) / FRONT_BAND + 0.5))
          : 1;
        p.colour.copy(p.base).lerp(m.colour, reach);
      }
      this.colourAttr.setXYZ(i, p.colour.r, p.colour.g, p.colour.b);
    }
    this.colourAttr.needsUpdate = true;
  }

  private updateWallColours(): void {
    for (let i = 0; i < this.wallMaterials.length; i++) {
      const sat = saturationFor(
        this.wallSides[i] as Parameters<typeof saturationFor>[0],
        this.arterialSat,
        this.venousSat,
      );
      const tint = this.wallMaterials[i].uniforms.uTint.value as THREE.Color;
      tint.copy(DEOXY_COLOUR).lerp(OXY_COLOUR, Math.max(0, Math.min(1, (sat - 0.5) / 0.5)));
    }
  }

  /** Per-frame advection. dt in seconds. */
  update(dt: number): void {
    if (!this.root.visible) return;

    const speed = this.flowSpeed * this.pulse;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const line = this.lines[p.line];

      p.s += speed * p.speedJitter * dt * 0.055;
      // Wrap rather than reassign. A particle leaving the aorta should reappear at
      // its start, because what this draws is a CIRCULATION — the alternative, moving
      // it to the next vessel downstream, would need a connectivity graph this file
      // does not have and would claim a continuity the lumped haemodynamics do not
      // actually model.
      if (p.s > line.length) p.s -= line.length;

      sampleAt(line, p.s, this.scratch);
      this.positionAttr.setXYZ(i, this.scratch.x, this.scratch.y, this.scratch.z);
    }
    this.positionAttr.needsUpdate = true;

    // Advance every sweeping marker's front and recolour, so the drug is SEEN to move
    // out of the central vessels. This is the one part of the flow that runs off wall
    // time rather than snapshot time, because a front creeping forward at 20 Hz reads
    // as stepping and at 60 Hz reads as flowing.
    if (this.animating) {
      let stillMoving = false;
      for (const m of this.activeMarkers) {
        if (!m.sweeps) continue;
        const next = Math.min(1, (this.fronts.get(m.id) ?? 0) + dt * this.flowSpeed * FRONT_RATE);
        this.fronts.set(m.id, next);
        if (next < 0.999) stillMoving = true;
      }
      this.refreshColours();
      // Keep refreshing for one settled frame after the front lands, then stop the
      // per-frame recolour so a body sitting with a steady drug level costs nothing.
      this.animating = stillMoving;
    }
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    for (const m of this.wallGroup.children) {
      const mesh = m as THREE.Mesh;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }

  /** Total triangles, for the perf budget report. */
  get triangleCount(): number {
    let n = 0;
    for (const child of this.wallGroup.children) {
      const g = (child as THREE.Mesh).geometry;
      const index = g.getIndex();
      n += index ? index.count / 3 : g.getAttribute('position').count / 3;
    }
    return n;
  }

  /** Live particle count, for the perf budget report. */
  get particleCount(): number {
    return this.particles.length;
  }
}

/**
 * TubeGeometry builds a constant-radius tube. Real vessels taper — the aorta halves
 * its radius between the arch and the bifurcation — so each ring is scaled about its
 * own centre by the ratio of the desired radius to the unit radius it was built with.
 */
function taperTube(geometry: THREE.TubeGeometry, line: Centreline): void {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const params = geometry.parameters;
  const tubular = params.tubularSegments;
  const radial = params.radialSegments;

  const centre = new THREE.Vector3();
  const v = new THREE.Vector3();
  const path = params.path;

  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    path.getPoint(t, centre);
    const f = Math.max(0, Math.min(1, t));
    const idx = Math.min(line.radii.length - 1, Math.round(f * (line.radii.length - 1)));
    const radius = line.radii[idx];

    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, k).sub(centre).multiplyScalar(radius).add(centre);
      pos.setXYZ(k, v.x, v.y, v.z);
    }
  }

  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}
