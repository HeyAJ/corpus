import * as THREE from 'three';
import type { FlowHandle, FlowSpec } from './types';

/**
 * EVERY STREAM OF ONE ORGAN INTERIOR, IN ONE DRAW CALL.
 *
 * A heart has blood in four chambers, a kidney has blood and urine, a brain has nerve
 * impulses. Each is a FlowSpec: a path, a count, a size, a speed. Drawing each as its own
 * Points object would be a draw call per stream and a separate buffer upload per stream;
 * here they share one `THREE.Points` and one set of attributes, and a stream is just a
 * contiguous range of particles inside it.
 *
 * HOW A PARTICLE MOVES. Each stream is a Catmull-Rom curve through the spec's control
 * points, sampled ONCE at construction into 64 equal-arc-length segments with a frame
 * (tangent, normal, binormal) at every sample. A particle owns three fixed numbers: a
 * phase (where it starts along the stream, spread evenly so the stream reads as
 * continuous rather than clumped), and a lateral offset in the plane perpendicular to
 * the tangent, picked by an integer hash so a stream has width and so two runs draw the
 * identical picture. Per frame the stream's progress advances by `rate * speed * dt /
 * length`, and each particle's position is the sample interpolation at `phase +
 * progress`, plus its offset along the interpolated frame. Nothing is allocated and
 * nothing is evaluated on the curve per frame: the curve is only a table.
 *
 * WHY A FRAME PER SAMPLE, AND WHY PARALLEL-TRANSPORTED. Offsetting along a fixed "up"
 * vector degenerates where the path runs along it, and a Frenet normal flips wherever
 * the curvature changes sign; either makes particles jump sideways. Rotation-minimising
 * (parallel-transport) frames never flip. On a closed loop the transported frame comes
 * back to the start rotated by some angle, which would make the particles that wrap
 * round jump by that angle at the seam, so the leftover twist is spread evenly along the
 * loop instead.
 *
 * WHY THINNING USES A VAN DER CORPUT RANK. `density` draws a fraction of the particles.
 * If that were "the first n", lowering it would delete one whole segment of the stream
 * and leave the rest crowded; ranking particles by the bit-reversal of their index makes
 * every fraction an even thinning of the whole.
 *
 * WHAT A "WINDOW" IS. `setWindow(from, to)` draws only particles whose position along the
 * path lies in [from, to] (wrapping if from > to). It is a gate: the way a closed valve
 * is shown to hold blood back is by not drawing the blood on the far side of it.
 *
 * SIZE. The `size` of a spec is a diameter in WORLD metres, so a particle is the same
 * physical size at any zoom. The vertex shader converts it to pixels with the camera's
 * projection (`scale = drawing-buffer height / (2 tan(fov/2))`, set by `setViewport`)
 * and floors it at 2 px so a distant stream does not vanish. A particle of size 0 is
 * moved off the clip volume rather than drawn at the floor, which is how density and
 * windows hide particles.
 *
 * BLENDING. Ordinary alpha blending, depth-tested, no depth write, so a stream is hidden by
 * a solid part in front of it and never hides anything itself. It was ADDITIVE at first,
 * the contract the vascular particles use, and that was wrong here: the vessels' particles
 * sit on vessel walls the multiply pass has already darkened, but an organ's interior is
 * drawn on a pale page and inside pale glass, and light added to a pale surface is a paler
 * surface. Venous blood, which should be the darkest thing in the heart, drew as faint
 * pink specks, and nothing could be darker than what it was drawn on. With alpha blending
 * a particle is its own colour whatever is behind it: oxygenated blood is red, deoxygenated
 * blood is dusky, a nerve impulse is bright. Each has a small pale core so that it reads as
 * a wet droplet rather than a flat disc. Particles are not sorted; they are small, nearly
 * opaque and the same colour within a stream, so their order cannot be seen.
 */

/** Segments each stream's curve is tabulated into. */
const SAMPLES = 64;
const STRIDE = (SAMPLES + 1) * 3;

/** Integer hash to [0, 1). Deterministic everywhere, unlike a sine trick. */
function hash01(x: number): number {
  let h = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Bit-reversal radical inverse in base 2 of a small non-negative integer, in [0, 1). */
function vanDerCorput(n: number): number {
  let x = 0;
  let f = 0.5;
  let k = n;
  while (k > 0) {
    if (k & 1) x += f;
    k >>= 1;
    f *= 0.5;
  }
  return x;
}

interface Track {
  id: string;
  /** First particle of this stream in the shared arrays, and how many. */
  start: number;
  count: number;
  /** Offset of this stream's table in the sample arrays. */
  base: number;
  length: number;
  speed: number;
  /** Fraction of the stream travelled so far, in [0, 1): added to every phase. */
  progress: number;
  rate: number;
  density: number;
  from: number;
  to: number;
  visible: boolean;
  r: number;
  g: number;
  b: number;
  /** The spec's own colour, restored by `resetDefaults`. */
  baseR: number;
  baseG: number;
  baseB: number;
}

export class FlowField {
  readonly object: THREE.Points;

  private readonly tracks: Track[] = [];
  private readonly byId = new Map<string, FlowHandle>();
  private readonly total: number;

  // Per particle, fixed at construction.
  private readonly phase: Float32Array;
  private readonly rank: Float32Array;
  private readonly lateralN: Float32Array;
  private readonly lateralB: Float32Array;
  // Per stream, the tabulated curve and its frames.
  private readonly samplePos: Float32Array;
  private readonly sampleN: Float32Array;
  private readonly sampleB: Float32Array;

  private readonly positionAttr: THREE.BufferAttribute;
  private readonly colourAttr: THREE.BufferAttribute;
  private readonly sizeAttr: THREE.BufferAttribute;
  private readonly sizes: Float32Array;
  private readonly material: THREE.ShaderMaterial;
  private readonly scratchColor = new THREE.Color();

  constructor(specs: readonly FlowSpec[]) {
    let total = 0;
    for (const s of specs) total += Math.max(0, Math.floor(s.count));
    this.total = total;

    this.phase = new Float32Array(total);
    this.rank = new Float32Array(total);
    this.lateralN = new Float32Array(total);
    this.lateralB = new Float32Array(total);
    this.samplePos = new Float32Array(specs.length * STRIDE);
    this.sampleN = new Float32Array(specs.length * STRIDE);
    this.sampleB = new Float32Array(specs.length * STRIDE);

    let next = 0;
    specs.forEach((spec, si) => {
      const count = Math.max(0, Math.floor(spec.count));
      const base = si * STRIDE;
      const length = this.tabulate(spec, base);

      const col = new THREE.Color(spec.color);
      const track: Track = {
        id: spec.id,
        start: next,
        count,
        base,
        length: Math.max(1e-9, length),
        speed: spec.speed,
        progress: 0,
        rate: 1,
        density: 1,
        from: 0,
        to: 1,
        visible: true,
        r: col.r,
        g: col.g,
        b: col.b,
        baseR: col.r,
        baseG: col.g,
        baseB: col.b,
      };
      this.tracks.push(track);

      const spread = spec.spread ?? 0;
      for (let j = 0; j < count; j++) {
        const p = next + j;
        this.phase[p] = j / Math.max(1, count);
        this.rank[p] = vanDerCorput(j);
        // Uniform over a disc: the square root keeps the density even in area.
        const a = hash01(si * 100003 + j * 2 + 1) * Math.PI * 2;
        const r = Math.sqrt(hash01(si * 100003 + j * 2 + 2)) * spread;
        this.lateralN[p] = Math.cos(a) * r;
        this.lateralB[p] = Math.sin(a) * r;
      }
      next += count;

      this.byId.set(spec.id, this.makeHandle(track));
    });

    const geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(new Float32Array(total * 3), 3);
    this.colourAttr = new THREE.BufferAttribute(new Float32Array(total * 3), 3);
    this.sizes = new Float32Array(total);
    this.sizeAttr = new THREE.BufferAttribute(this.sizes, 1);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.colourAttr.setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.positionAttr);
    geometry.setAttribute('aColor', this.colourAttr);
    geometry.setAttribute('aSize', this.sizeAttr);

    // Per-stream particle size, written once: a size is the spec's, and only a hidden
    // particle overrides it (with 0) in `update`.
    this.specSize = new Float32Array(total);
    specs.forEach((spec, si) => {
      const t = this.tracks[si];
      for (let j = 0; j < t.count; j++) this.specSize[t.start + j] = Math.max(0, spec.size);
    });

    this.material = new THREE.ShaderMaterial({
      name: 'OrganFlow',
      uniforms: {
        // Pixels per (metre at one metre of depth): see the header. Overwritten by
        // setViewport; this default is a 900 px tall viewport at a 40 degree lens.
        uScale: { value: 900 / (2 * Math.tan((40 * Math.PI) / 360)) },
        uOpacity: { value: 0.9 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        uniform float uScale;
        varying vec3 vColor;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          if (aSize <= 0.0) {
            // Hidden: outside the clip volume, so it costs no fragments. A point size of
            // 0 is not portable (some drivers draw one pixel), moving it is.
            gl_PointSize = 0.0;
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
          }
          gl_PointSize = max(2.0, aSize * uScale / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying vec3 vColor;
        void main() {
          // Round and soft-edged: a square sprite reads as a rendering fault.
          vec2 d = gl_PointCoord - vec2(0.5);
          float r = dot(d, d);
          if (r > 0.25) discard;
          // A disc with a soft edge and a pale core (see BLENDING in the header).
          float edge = 1.0 - smoothstep(0.12, 0.25, r);
          float core = 1.0 - smoothstep(0.0, 0.06, r);
          vec3 colour = mix(vColor, vec3(1.0), core * 0.35);
          gl_FragColor = vec4(colour, edge * uOpacity);
        }
      `,
      blending: THREE.NormalBlending,
      depthWrite: false,
      depthTest: true,
      transparent: true,
    });

    this.object = new THREE.Points(geometry, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = 36;

    // Fill the arrays once so the first frame is valid before any update.
    this.update(0);
  }

  private readonly specSize: Float32Array;

  /**
   * Tabulate one stream: SAMPLES+1 equal-arc-length points with parallel-transported
   * frames. Returns the curve's length in metres. Runs once, so it may allocate.
   */
  private tabulate(spec: FlowSpec, base: number): number {
    const pts = spec.path.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    // A curve needs two points; a degenerate spec becomes a short stub, not an exception.
    if (pts.length < 2) pts.push((pts[0] ?? new THREE.Vector3()).clone().add(new THREE.Vector3(1e-4, 0, 0)));
    const curve = new THREE.CatmullRomCurve3(pts, spec.closed ?? false, 'centripetal');
    const length = curve.getLength();

    const t = new THREE.Vector3();
    const n = new THREE.Vector3();
    const b = new THREE.Vector3();
    const p = new THREE.Vector3();
    const tangents: THREE.Vector3[] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const u = i / SAMPLES;
      curve.getPointAt(u, p);
      curve.getTangentAt(u, t);
      tangents.push(t.clone());
      this.samplePos[base + i * 3] = p.x;
      this.samplePos[base + i * 3 + 1] = p.y;
      this.samplePos[base + i * 3 + 2] = p.z;
    }

    // Parallel transport. Start from the world axis least aligned with the tangent.
    const t0 = tangents[0];
    const ax = Math.abs(t0.x);
    const ay = Math.abs(t0.y);
    const az = Math.abs(t0.z);
    const ref = ax <= ay && ax <= az ? new THREE.Vector3(1, 0, 0) : ay <= az ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    n.copy(ref).addScaledVector(t0, -ref.dot(t0)).normalize();
    const normals: THREE.Vector3[] = [n.clone()];
    for (let i = 1; i <= SAMPLES; i++) {
      n.addScaledVector(tangents[i], -n.dot(tangents[i]));
      if (n.lengthSq() < 1e-12) n.copy(ref).addScaledVector(tangents[i], -ref.dot(tangents[i]));
      n.normalize();
      normals.push(n.clone());
    }

    // Closed loop: remove the twist the transport accumulated, spread evenly.
    let twist = 0;
    if (spec.closed) {
      const b0 = new THREE.Vector3().crossVectors(tangents[0], normals[0]);
      twist = Math.atan2(normals[SAMPLES].dot(b0), normals[SAMPLES].dot(normals[0]));
    }

    for (let i = 0; i <= SAMPLES; i++) {
      const ni = normals[i];
      b.crossVectors(tangents[i], ni);
      const a = -twist * (i / SAMPLES);
      const c = Math.cos(a);
      const s = Math.sin(a);
      const o = base + i * 3;
      this.sampleN[o] = ni.x * c + b.x * s;
      this.sampleN[o + 1] = ni.y * c + b.y * s;
      this.sampleN[o + 2] = ni.z * c + b.z * s;
      this.sampleB[o] = -ni.x * s + b.x * c;
      this.sampleB[o + 1] = -ni.y * s + b.y * c;
      this.sampleB[o + 2] = -ni.z * s + b.z * c;
    }
    return length;
  }

  private makeHandle(track: Track): FlowHandle {
    const scratch = this.scratchColor;
    return {
      id: track.id,
      setRate: (rate) => {
        track.rate = Number.isFinite(rate) ? rate : 0;
      },
      setDensity: (fraction) => {
        track.density = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
      },
      setColor: (color) => {
        scratch.set(color);
        track.r = scratch.r;
        track.g = scratch.g;
        track.b = scratch.b;
      },
      setVisible: (visible) => {
        track.visible = visible;
      },
      setWindow: (from, to) => {
        track.from = Number.isFinite(from) ? from : 0;
        track.to = Number.isFinite(to) ? to : 1;
      },
    };
  }

  handle(id: string): FlowHandle | undefined {
    return this.byId.get(id);
  }

  /** Rate 1, full density, whole window, visible, the spec's own colour. */
  resetDefaults(): void {
    for (const t of this.tracks) {
      t.rate = 1;
      t.density = 1;
      t.from = 0;
      t.to = 1;
      t.visible = true;
      t.r = t.baseR;
      t.g = t.baseG;
      t.b = t.baseB;
    }
  }

  /** Pixels per world metre at unit depth, from the drawing-buffer height and the lens. */
  setViewport(heightPx: number, fovDegrees: number): void {
    const h = Math.max(1, heightPx);
    const f = Math.min(170, Math.max(1, fovDegrees));
    this.material.uniforms.uScale.value = h / (2 * Math.tan((f * Math.PI) / 360));
  }

  /** Overall opacity, for fading an interior in and out. */
  setFade(fade: number): void {
    this.material.uniforms.uOpacity.value = 0.9 * Math.max(0, Math.min(1, fade));
  }

  /** Advance every stream by `dtSeconds` and rewrite the particle attributes. */
  update(dtSeconds: number): void {
    const pos = this.positionAttr.array as Float32Array;
    const col = this.colourAttr.array as Float32Array;
    const sizes = this.sizes;

    for (const t of this.tracks) {
      if (t.rate !== 0 && dtSeconds !== 0) {
        t.progress += (t.rate * t.speed * dtSeconds) / t.length;
        t.progress -= Math.floor(t.progress);
      }
      const gated = t.from > t.to; // a window that wraps past the end of the path
      for (let j = 0; j < t.count; j++) {
        const p = t.start + j;
        let u = this.phase[p] + t.progress;
        u -= Math.floor(u);

        const f = u * SAMPLES;
        let i = Math.floor(f);
        if (i >= SAMPLES) i = SAMPLES - 1;
        const w = f - i;
        const o = t.base + i * 3;
        const o2 = o + 3;
        const ln = this.lateralN[p];
        const lb = this.lateralB[p];
        const sn = this.sampleN;
        const sb = this.sampleB;
        const sp = this.samplePos;
        const k = p * 3;
        for (let c = 0; c < 3; c++) {
          const nx = sn[o + c] + (sn[o2 + c] - sn[o + c]) * w;
          const bx = sb[o + c] + (sb[o2 + c] - sb[o + c]) * w;
          pos[k + c] = sp[o + c] + (sp[o2 + c] - sp[o + c]) * w + nx * ln + bx * lb;
        }
        col[k] = t.r;
        col[k + 1] = t.g;
        col[k + 2] = t.b;

        const inWindow = gated ? u >= t.from || u <= t.to : u >= t.from && u <= t.to;
        sizes[p] = t.visible && this.rank[p] < t.density && inWindow ? this.specSize[p] : 0;
      }
    }

    this.positionAttr.needsUpdate = true;
    this.colourAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }

  /** Number of particles across all streams. */
  get particleCount(): number {
    return this.total;
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.material.dispose();
  }
}
