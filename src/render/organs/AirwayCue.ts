import * as THREE from 'three';
import type { SimSnapshot } from '../../bridge/types';

/**
 * THE AIRWAY CUE — inhaled and nebulised routes made visible.
 *
 * "Oral or air-inhaling should be shown properly with proper colours." The GI side is
 * the GiBolus; this is the air side: a thin stream of tinted air drawn in through the
 * mouth, down the trachea, past the carina and into both lung hila, moving on INSPIRATION
 * and fading on expiration so it breathes with the body.
 *
 * WHAT DRIVES IT. Two things out of the snapshot:
 *   - the breath itself — resp.cyclePhase says where in the breath we are, and
 *     resp.inflation how deep it is, so a faint cool wisp is pulled in on every
 *     inhale even in room air;
 *   - an inhaled drug — a nebuliser running, or a depot delivered by the INHALED or
 *     NEBULISED route, brightens the stream and tints it the drug's own transport
 *     colour, so a salbutamol nebuliser reads as coloured air going into the lungs.
 *
 * WHICH BUCKET. Additive, renderOrder 22 — the SAME bucket as the vascular flow
 * particles. It is glowing stuff moving through space, so it is additive, and additive
 * commutes with additive: dropping it into the existing additive bucket cannot disturb
 * the order-independence guarantee, exactly as the vessel particles do not.
 *
 * Colours read as AIR, not blood: a cool pale blue at rest, shifting to the drug's hue
 * when one is being inhaled. Warm belongs to the swallowed path (GiBolus); cool belongs
 * here, so the two routes are told apart at a glance.
 */

/** A generous stream, but small: this is a garnish on the breath, not a firework. */
const PARTICLES = 150;

/** Pale, cool "air" colour when nothing is being inhaled but the body is breathing. */
const AIR_COLOUR = new THREE.Color(0x9fd6f2);

/** Inspiration occupies roughly the first 40 % of the breath at a normal I:E of ~1:2. */
const INSPIRATORY_FRACTION = 0.42;

/** Routes that put a drug into the airway rather than the bloodstream directly. */
const AIRWAY_ROUTES = new Set(['INHALED', 'NEBULISED']);

export class AirwayCue {
  readonly root = new THREE.Group();

  private readonly curves: THREE.CatmullRomCurve3[] = [];
  private readonly particles: { curve: number; s: number; jitter: number }[] = [];

  private readonly positionAttr: THREE.BufferAttribute;
  private readonly colourAttr: THREE.BufferAttribute;
  private readonly material: THREE.ShaderMaterial;
  private readonly geometry: THREE.BufferGeometry;

  private readonly scratch = new THREE.Vector3();
  private readonly tint = new THREE.Color();

  constructor() {
    this.root.renderOrder = 22;

    // Two airway paths, mouth -> trachea -> carina -> each lung hilum. Authored in the
    // direction air travels on inspiration, so a particle always advances INWARD. The
    // control points follow the trachea from src/data/organs.json and end at the lung
    // centres from the same file, so the stream lands where the lungs actually are.
    const MOUTH: [number, number, number] = [0, 0.386, 0.01];
    const TRACHEA: [number, number, number][] = [
      [0, 0.352, 0.0],
      [0, 0.32, 0.002],
      [0, 0.285, 0.004],
      [0, 0.256, 0.004],
    ];
    const CARINA: [number, number, number] = [0, 0.246, 0.002];
    const LEFT_HILUM: [number, number, number][] = [
      [-0.03, 0.232, 0.0],
      [-0.05, 0.216, 0.0],
      [-0.066, 0.204, 0.0],
    ];
    const RIGHT_HILUM: [number, number, number][] = [
      [0.03, 0.234, 0.0],
      [0.052, 0.218, 0.0],
      [0.07, 0.208, 0.0],
    ];

    const toV = (p: [number, number, number]) => new THREE.Vector3(p[0], p[1], p[2]);
    this.curves.push(
      new THREE.CatmullRomCurve3([MOUTH, ...TRACHEA, CARINA, ...LEFT_HILUM].map(toV), false, 'catmullrom', 0.4),
    );
    this.curves.push(
      new THREE.CatmullRomCurve3([MOUTH, ...TRACHEA, CARINA, ...RIGHT_HILUM].map(toV), false, 'catmullrom', 0.4),
    );

    for (let i = 0; i < PARTICLES; i++) {
      this.particles.push({
        curve: i % 2,
        // Even spread so the stream reads as continuous rather than as a clump.
        s: (i / PARTICLES) % 1,
        jitter: 0.7 + 0.6 * (((i * 2654435761) >>> 0) % 1000) / 1000,
      });
    }

    this.geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(new Float32Array(PARTICLES * 3), 3);
    this.colourAttr = new THREE.BufferAttribute(new Float32Array(PARTICLES * 3), 3);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.colourAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.positionAttr);
    this.geometry.setAttribute('aColour', this.colourAttr);

    this.material = new THREE.ShaderMaterial({
      name: 'AirwayFlow',
      uniforms: { uOpacity: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColour;
        varying vec3 vColour;
        void main() {
          vColour = aColour;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = max(2.6, 9.0 * (1.0 / -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying vec3 vColour;
        void main() {
          vec2 d = gl_PointCoord - vec2(0.5);
          float r = dot(d, d);
          if (r > 0.25) discard;
          float falloff = 1.0 - smoothstep(0.0, 0.25, r);
          gl_FragColor = vec4(vColour * falloff * uOpacity, 1.0);
        }
      `,
      // Additive bucket, exactly like the vascular particles: commutes with them, so
      // it cannot perturb the order-independence guarantee. Depth-test so it hides
      // behind organs in front of it, depth-write off so it never occludes anything.
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      transparent: true,
    });

    const points = new THREE.Points(this.geometry, this.material);
    points.renderOrder = 22;
    points.frustumCulled = false;
    this.root.add(points);
  }

  /**
   * @param dt seconds since the last frame, for advection.
   * @param s the latest snapshot, or null before the first one arrives.
   */
  update(dt: number, s: SimSnapshot | null): void {
    if (!s) return;

    // Is a drug being delivered into the airway right now? A running nebuliser, or a
    // depot whose route is inhaled/nebulised and still releasing.
    let inhaledDrug: string | null = null;
    for (const d of s.drugs) {
      if (d.nebulising || d.depots.some((dep) => AIRWAY_ROUTES.has(dep.route) && dep.releasing)) {
        inhaledDrug = d.drugId;
        break;
      }
    }

    // Colour: the drug's own transport hue if one is being inhaled, else cool air.
    this.tint.copy(AIR_COLOUR);
    if (inhaledDrug) {
      const marker = s.transport.markers.find((m) => m.id === inhaledDrug);
      if (marker) this.tint.setHex(marker.colour);
    }

    // Inspiratory envelope: a smooth rise and fall across the inhale, zero on the
    // exhale, scaled by how deep the breath is. A faint floor keeps a wisp of plain
    // air visible on every breath; a drug lifts it to a clearly-coloured stream.
    const phase = s.resp.cyclePhase;
    const inspiring = phase < INSPIRATORY_FRACTION && !s.resp.apnoeic;
    const envelope = inspiring ? Math.sin((phase / INSPIRATORY_FRACTION) * Math.PI) : 0;
    const depth = Math.max(0, Math.min(1.2, s.resp.inflation));
    const baseIntensity = 0.07; // plain breathing, barely there
    const drugIntensity = inhaledDrug ? 0.55 : 0;
    const opacity = envelope * (0.4 + 0.6 * depth) * (baseIntensity + drugIntensity);
    this.material.uniforms.uOpacity.value = opacity;

    // Nothing to draw and nothing to move: skip the whole advection.
    if (opacity <= 0.001 && !inspiring) {
      return;
    }

    // Air is drawn IN on inspiration, so the particles crawl down the airway only while
    // inspiring; on the exhale they hold position and fade with the envelope, which
    // reads as breath rather than as a loop running regardless of the lungs.
    const speed = inspiring ? 0.55 : 0.0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.s += speed * p.jitter * dt;
      if (p.s > 1) p.s -= 1;
      this.curves[p.curve].getPointAt(Math.max(0, Math.min(1, p.s)), this.scratch);
      this.positionAttr.setXYZ(i, this.scratch.x, this.scratch.y, this.scratch.z);
      // A little front-to-back brightening so the leading edge of the inhaled bolus
      // reads as the freshest air; cheap and it stops the stream looking uniform.
      const lead = 0.7 + 0.3 * (1 - p.s);
      this.colourAttr.setXYZ(i, this.tint.r * lead, this.tint.g * lead, this.tint.b * lead);
    }
    this.positionAttr.needsUpdate = true;
    this.colourAttr.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
