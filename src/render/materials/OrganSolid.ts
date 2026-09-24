import * as THREE from 'three';

/**
 * BUCKET 3 — SELECTED ORGAN AND INTERIOR CONTENTS (spec 6.2, 6.5).
 *
 * At most five objects: the selected organ shell, the two heart chamber cavities,
 * and the gastric or bladder fluid. Normal alpha blending, depth write on, manually
 * sorted back-to-front each frame. Five objects sort trivially and correctly.
 *
 * This is also where the fluid level lives. A world-space Y plane is computed from
 * fillVolume/organVolume and passed as a uniform; fragments above it are discarded,
 * and a slightly brighter elliptical band is drawn at the cut plane. That band is
 * the meniscus, and it is clearly visible in the reference close-up of the stomach.
 */

export const SOLID_VERT = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vViewDirW;
varying vec3 vWorldPos;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPosition.xyz;
  vNormalW  = normalize(mat3(modelMatrix) * normal);
  vViewDirW = cameraPosition - worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const SOLID_FRAG = /* glsl */ `
uniform vec3  uColor;
uniform float uOpacity;
uniform float uRimGain;
uniform float uDepthGain;

varying vec3 vNormalW;
varying vec3 vViewDirW;

void main() {
  vec3  N = normalize(vNormalW);
  vec3  V = normalize(vViewDirW);
  float ndv = abs(dot(N, V));

  // Same absorption-thickness cue as bucket 1, so a selected organ still reads as
  // a volume rather than flipping to a flat silhouette the moment it is picked.
  //
  // DEEPENS AT THE EDGE, rather than brightening. A grazing ray crosses more tissue,
  // so the edge of a real translucent organ is DARKER and more saturated than its
  // centre — which is the opposite of what a Fresnel rim does. The reference shows
  // exactly this: the selected heart is deep crimson with its silhouette the densest
  // part of it, not a pale shape with a white halo.
  float thickness = 1.0 - ndv;
  vec3  body = uColor * (1.0 - uDepthGain * thickness);

  // A SPECULAR highlight, not an additive rim.
  //
  // The previous version added a flat white rim, at a gain that reached 1.5
  // on the silhouette. Stacked with the bucket-2 rim the selected organ was pushed
  // past white and read as a pale ghost, which is why picking an organ made it
  // LESS visible instead of more. A highlight belongs where the surface faces the
  // viewer, is small, and is tinted by the body it sits on.
  float spec = pow(ndv, 8.0) * uRimGain;
  vec3 highlight = mix(uColor, vec3(1.0), 0.55) * spec;

  gl_FragColor = vec4(body + highlight, uOpacity);
}
`;

export const FLUID_FRAG = /* glsl */ `
uniform vec3  uColor;
uniform float uOpacity;
uniform float uLevelY;        // world-space cut plane
uniform float uMeniscus;      // band half-width, world units
uniform vec3  uMeniscusColor;

varying vec3 vNormalW;
varying vec3 vViewDirW;
varying vec3 vWorldPos;

void main() {
  // Everything above the surface is air.
  if (vWorldPos.y > uLevelY) discard;

  vec3  N = normalize(vNormalW);
  vec3  V = normalize(vViewDirW);
  float ndv = abs(dot(N, V));
  float thickness = 1.0 - ndv;

  vec3 body = uColor * (1.0 - 0.35 * thickness);

  // Brighter elliptical band where the fluid meets the wall: the meniscus.
  float d = abs(vWorldPos.y - uLevelY);
  float band = 1.0 - smoothstep(0.0, uMeniscus, d);
  vec3 lit = mix(body, uMeniscusColor, band * 0.8);

  gl_FragColor = vec4(lit + vec3(pow(thickness, 3.0) * 0.35), uOpacity);
}
`;

export interface SolidOptions {
  color?: THREE.ColorRepresentation;
  opacity?: number;
  rimGain?: number;
  depthGain?: number;
}

export function createOrganSolidMaterial(options: SolidOptions = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'OrganSolid',
    uniforms: {
      uColor: { value: new THREE.Color(options.color ?? 0xb0232a) },
      // Near-opaque. The reference's selected organ is a solid object you are looking
      // AT, not through — the translucency belongs to everything around it.
      uOpacity: { value: options.opacity ?? 0.97 },
      uRimGain: { value: options.rimGain ?? 0.42 },
      // Raised: the edge deepening is most of what gives the selected organ its
      // volume, and at 0.45 it was too subtle to separate the shape from its own
      // silhouette.
      uDepthGain: { value: options.depthGain ?? 0.62 },
    },
    vertexShader: SOLID_VERT,
    fragmentShader: SOLID_FRAG,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: true,
    depthTest: true,
  });
}

export interface FluidOptions {
  color?: THREE.ColorRepresentation;
  meniscusColor?: THREE.ColorRepresentation;
  opacity?: number;
  levelY?: number;
  meniscus?: number;
}

export function createFluidMaterial(options: FluidOptions = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'OrganFluid',
    uniforms: {
      uColor: { value: new THREE.Color(options.color ?? 0xc8433a) },
      uMeniscusColor: { value: new THREE.Color(options.meniscusColor ?? 0xffd9cf) },
      uOpacity: { value: options.opacity ?? 0.9 },
      uLevelY: { value: options.levelY ?? 0 },
      uMeniscus: { value: options.meniscus ?? 0.0035 },
    },
    vertexShader: SOLID_VERT,
    fragmentShader: FLUID_FRAG,
    transparent: true,
    side: THREE.DoubleSide,
    // The whole point of this feature is seeing INSIDE the organ, so the fluid must
    // not be occluded by the shell that contains it. Depth-testing it against a
    // selected shell drawn at 0.92 alpha hides it completely — the stomach looked
    // empty however much was in it. Drawn after the shell with depth off, it reads
    // as fluid seen through a translucent wall, which is what the reference shows.
    depthWrite: false,
    depthTest: false,
  });
}
