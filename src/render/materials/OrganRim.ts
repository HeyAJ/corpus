import * as THREE from 'three';

/**
 * BUCKET 2 — FRESNEL RIM (spec 6.2).
 *
 * Additive blending: dst += src * srcAlpha. Also commutative, so bucket 2 is
 * order-independent for the same reason bucket 1 is.
 *
 * This produces the bright near-white organ outlines visible in every reference
 * frame. Bloom (postfx/composer.ts) then blooms the rim and not the body, which is
 * exactly the soft halo the reference has — and the reason to bloom after this pass
 * rather than before it.
 *
 * Note what is NOT here: no diffuse term, no specular term, no light. Form reads
 * entirely from absorption thickness plus fresnel. That is deliberate and it is the
 * second reason the design works: with no surface shading, surface detail is
 * invisible, so a 6k-triangle smoothed organ and a 200k-triangle scan render
 * identically (spec 7.1).
 */

export const RIM_VERT = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vViewDirW;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vNormalW  = normalize(mat3(modelMatrix) * normal);
  vViewDirW = cameraPosition - worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const RIM_FRAG = /* glsl */ `
uniform vec3  uRimColor;
uniform float uRimPower;
uniform float uRimGain;
varying vec3  vNormalW;
varying vec3  vViewDirW;

void main() {
  float ndv = abs(dot(normalize(vNormalW), normalize(vViewDirW)));
  float f = pow(1.0 - ndv, uRimPower);
  gl_FragColor = vec4(uRimColor * f * uRimGain, 1.0);
}
`;

export interface RimOptions {
  color?: THREE.ColorRepresentation;
  power?: number;
  gain?: number;
}

export function createOrganRimMaterial(options: RimOptions = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'OrganRim',
    uniforms: {
      // Near-white with a slight warm bias, so the halo reads warm against the cream.
      uRimColor: { value: new THREE.Color(options.color ?? 0xfffdfb) },
      // 3.0 makes the band sub-pixel on a smooth shell at body framing; 2.2 gives
      // the 1.5-3 px outline the reference has.
      uRimPower: { value: options.power ?? 2.2 },
      uRimGain: { value: options.gain ?? 0.55 },
    },
    vertexShader: RIM_VERT,
    fragmentShader: RIM_FRAG,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
    transparent: true,
  });
}

export function assertRimOrderIndependent(material: THREE.ShaderMaterial): void {
  const problems: string[] = [];
  if (material.depthWrite) problems.push('depthWrite must be false');
  if (material.depthTest) problems.push('depthTest must be false');
  if (material.blending !== THREE.AdditiveBlending) problems.push('blending must be AdditiveBlending');
  if (material.side !== THREE.DoubleSide) problems.push('side must be DoubleSide');
  if (problems.length > 0) {
    throw new Error(`OrganRim material is no longer order-independent:\n  - ${problems.join('\n  - ')}`);
  }
}
