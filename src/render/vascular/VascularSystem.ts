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
 * to hold unchanged.
 *
 * WHAT THE PARTICLES ACTUALLY SHOW.
 *
 * Each particle's colour comes from `snapshot.transport.markers`, which the sim
 * derives and normalises. Give a drug intravenously and its marker appears; particles
 * carrying it are tinted its colour, in proportion to how much of the blood it
 * represents. Speed comes from real aortic flow and pulses with the real cardiac
 * phase, so the surge you see in systole is the surge the Windkessel computed.
 *
 * COLOUR BY SATURATION, NOT BY NAME. A vessel's colour comes from the oxygen
 * saturation of the blood in it, so the pulmonary artery is drawn dark and the
 * pulmonary veins bright — the opposite of every "arteries are red" diagram, and the
 * correct way round. Desaturate the body and the whole arterial tree darkens.
 */

/** Particles per metre of vessel. Tuned so the aorta reads as a stream, not a queue. */
const PARTICLE_DENSITY = 700;
const MAX_PARTICLES = 2200;

/** Aortic flow that corresponds to one body-unit per second of particle travel. */
const FLOW_REFERENCE_mL_per_s = 90;

const OXY_COLOUR = new THREE.Color(0xc8323a);
const DEOXY_COLOUR = new THREE.Color(0x6a4a7a);

interface Particle {
  line: number;
  s: number;
  speedJitter: number;
  colour: THREE.Color;
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
  private readonly wallSides: ReturnType<typeof saturationFor> extends never ? never[] : string[] = [];

  private flowSpeed = 1;
  private pulse = 1;
  private arterialSat = 0.97;
  private venousSat = 0.72;
  private markerColours: THREE.Color[] = [];
  private markerWeights: number[] = [];

  private readonly scratch = new THREE.Vector3();

  constructor() {
    this.lines = buildCentrelines();
    this.root.visible = false;
    this.root.add(this.wallGroup);

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
      // Radial segments kept low: there are thirty vessels and the silhouette at this
      // scale is a few pixels across. tests/perf/budget.test.ts is the constraint.
      const geometry = new THREE.TubeGeometry(path, 20, 1, 6, false);

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
      (this.wallSides as string[]).push(line.side);
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

    // Rebuild the colour mix. A particle is tinted by one marker, chosen in
    // proportion to that marker's level, so a drug at 30 % of its scale tints roughly
    // 30 % of the particles — density as the visual variable rather than brightness,
    // which stays readable when several substances are present at once.
    this.markerColours = [];
    this.markerWeights = [];
    for (const m of t.markers) {
      if (m.level <= 0.001) continue;
      // Oxygen and CO2 are carried by the blood itself, not floating in it; they
      // colour the VESSEL, not the particles, so they are skipped here.
      if (m.id === 'oxygen' || m.id === 'co2') continue;
      this.markerColours.push(new THREE.Color(m.colour));
      this.markerWeights.push(m.level);
    }

    this.assignColours();
    this.updateWallColours();
  }

  private assignColours(): void {
    const total = this.markerWeights.reduce((a, b) => a + b, 0);

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const side = this.lines[p.line].side;
      const sat = saturationFor(side, this.arterialSat, this.venousSat);

      // Base colour: the blood itself, by saturation.
      p.colour.copy(DEOXY_COLOUR).lerp(OXY_COLOUR, Math.max(0, Math.min(1, (sat - 0.5) / 0.5)));

      if (total > 0.001) {
        // Deterministic per-particle draw against the weights, so the same particle
        // keeps carrying the same substance from frame to frame and the stream does
        // not shimmer.
        const r = ((i * 2654435761) % 10000) / 10000 * Math.max(1, total);
        let acc = 0;
        for (let m = 0; m < this.markerColours.length; m++) {
          acc += this.markerWeights[m];
          if (r < acc) {
            p.colour.copy(this.markerColours[m]);
            break;
          }
        }
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
