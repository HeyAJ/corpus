import * as THREE from 'three';

/**
 * BUCKET 1 — ORGAN ABSORPTION SHELL (spec 6.2).
 *
 * Fifteen nested translucent organs is normally the hardest problem in a project
 * like this. It is not a problem here, because of what the reference aesthetic
 * actually is: the background is light, the tissue is *darker* than the background,
 * and overlapping organs get *more* saturated. That is not emissive glass. It is
 * absorption — tinted glass on a bright backdrop.
 *
 * Absorption means multiplication, and multiplication is commutative, so
 *
 *     MULTIPLY BLENDING IS EXACTLY ORDER-INDEPENDENT. Not approximately.
 *
 * Better still, per-channel transmittance T = exp(-sigma*d) composited by
 * multiplication gives T1*T2*...*Tn = exp(-sum(sigma_i*d_i)), so the product of
 * transmittances IS Beer-Lambert accumulated through the whole stack. Physically
 * correct optical absorption, in any draw order, with zero render targets, zero
 * composite passes, zero sorting, and WebGL1 compatibility.
 *
 * Do not replace this with weighted-blended OIT. OIT is an approximation that goes
 * milky and flat with many low-alpha layers; this is exact and costs nothing.
 */

export const ABSORPTION_VERT = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vViewDirW;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vNormalW  = normalize(mat3(modelMatrix) * normal);
  vViewDirW = cameraPosition - worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const ABSORPTION_FRAG = /* glsl */ `
uniform vec3  uTint;
uniform float uDensity;
uniform float uEdgeGain;
uniform float uEdgePower;
varying vec3  vNormalW;
varying vec3  vViewDirW;

void main() {
  vec3  N   = normalize(vNormalW);
  vec3  V   = normalize(vViewDirW);
  float ndv = abs(dot(N, V));              // abs() => front and back faces behave alike

  // Grazing rays travel further through the shell wall.
  float path = 1.0 / max(ndv, 0.08);
  float edge = pow(1.0 - ndv, uEdgePower);
  float sigma = uDensity * (path + uEdgeGain * edge);

  // Per-channel absorption coefficient. uTint = white => no absorption => identity.
  vec3 absorption = vec3(1.0) - uTint;
  vec3 T = exp(-sigma * absorption);

  gl_FragColor = vec4(T, 1.0);             // multiply blend consumes .rgb only
}
`;

export interface AbsorptionOptions {
  tint?: THREE.ColorRepresentation;
  density?: number;
  edgeGain?: number;
  edgePower?: number;
}

export function createOrganAbsorptionMaterial(options: AbsorptionOptions = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'OrganAbsorption',
    uniforms: {
      uTint: { value: new THREE.Color(options.tint ?? 0xf2c4c4) },
      uDensity: { value: options.density ?? 0.12 },
      uEdgeGain: { value: options.edgeGain ?? 1.9 },
      uEdgePower: { value: options.edgePower ?? 2.0 },
    },
    vertexShader: ABSORPTION_VERT,
    fragmentShader: ABSORPTION_FRAG,

    // Front AND back wall both absorb — physically right, and it is what makes a
    // hollow shell read as a solid volume without any thickness geometry.
    side: THREE.DoubleSide,
    transparent: true,

    // Organs never occlude each other: no depth write, no depth test.
    depthWrite: false,
    depthTest: false,

    // result = srcColor * dstColor
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.DstColorFactor,
    blendDst: THREE.ZeroFactor,
  });
}

/**
 * Assert that a material still has the configuration the order-independence claim
 * depends on. Called by the render tests, and cheap enough to call at boot in dev.
 */
export function assertOrderIndependent(material: THREE.ShaderMaterial): void {
  const problems: string[] = [];
  if (material.depthWrite) problems.push('depthWrite must be false');
  if (material.depthTest) problems.push('depthTest must be false');
  if (material.blending !== THREE.CustomBlending) problems.push('blending must be CustomBlending');
  if (material.blendEquation !== THREE.AddEquation) problems.push('blendEquation must be AddEquation');
  if (material.blendSrc !== THREE.DstColorFactor) problems.push('blendSrc must be DstColorFactor');
  if (material.blendDst !== THREE.ZeroFactor) problems.push('blendDst must be ZeroFactor');
  if (material.side !== THREE.DoubleSide) problems.push('side must be DoubleSide');
  if (problems.length > 0) {
    throw new Error(
      `OrganAbsorption material is no longer order-independent:\n  - ${problems.join('\n  - ')}\n` +
        'See docs/DECISIONS.md ADR-002 before changing any of these.',
    );
  }
}
