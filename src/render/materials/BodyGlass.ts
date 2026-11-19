import * as THREE from 'three';

/**
 * THE GLASS FIGURE'S TWO MATERIALS: the faint body outline and its contact shadow.
 *
 * THE LOOK. A figure that only says "there is a person here" and then gets out of the
 * way. It is NOT drawn with the organs' additive rim: the page is pale (#f0f0f0), and
 * additive light on a pale ground is nearly invisible (the same fact that made the
 * vessels need a multiply bucket). So the figure is ordinary alpha-blended ink, a cool
 * neutral grey-blue, whose opacity rises toward grazing angles by a Fresnel term:
 * almost nothing face-on, a quiet edge line at the silhouette, and a breath of tone
 * (`uBase`) across the interior so the body reads as a volume and not as a drawn line.
 * Both walls of the closed surface are drawn (DoubleSide), so the far wall adds to the
 * near one at the silhouette and the edge reads as one line.
 *
 * WHAT IT MUST NOT DO, each enforced below:
 *  - write depth or test it: it never hides or is hidden by an organ, so the organs
 *    "sit inside" it purely by draw order (the group is drawn at renderOrder 5, before
 *    the absorption bucket at 10);
 *  - be pickable: it is simply never in `OrganSet.pickTargets`, the only list the
 *    Viewer raycasts;
 *  - be recoloured by Activity mode: it has its own material that nothing else touches.
 *
 * Every opacity and the ink colour below are DISPLAY choices, tuned by eye against the
 * pale page; none is a physiological quantity.
 */

export const GLASS_VERT = /* glsl */ `
attribute float fade;
varying vec3 vNormalW;
varying vec3 vViewDirW;
varying float vFade;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vNormalW  = normalize(mat3(modelMatrix) * normal);
  vViewDirW = cameraPosition - worldPosition.xyz;
  vFade = fade;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const GLASS_FRAG = /* glsl */ `
uniform vec3  uInk;
uniform float uBase;
uniform float uEdge;
uniform float uPower;
uniform float uOpacity;
varying vec3  vNormalW;
varying vec3  vViewDirW;
varying float vFade;

void main() {
  float ndv = abs(dot(normalize(vNormalW), normalize(vViewDirW)));
  float f = pow(1.0 - ndv, uPower);
  float a = (uBase + uEdge * f) * vFade * uOpacity;
  gl_FragColor = vec4(uInk, a);
}
`;

export interface GlassOptions {
  ink?: THREE.ColorRepresentation;
  base?: number;
  edge?: number;
  power?: number;
}

export function createBodyGlassMaterial(options: GlassOptions = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'BodyGlass',
    uniforms: {
      // A cool neutral ink; a DISPLAY choice that reads against the cream page and the
      // warm organs without competing with either.
      uInk: { value: new THREE.Color(options.ink ?? 0x56677d) },
      // The breath of tone face-on, and the extra at grazing angles. DISPLAY choices.
      uBase: { value: options.base ?? 0.04 },
      uEdge: { value: options.edge ?? 0.5 },
      uPower: { value: options.power ?? 2.4 },
      // Overall opacity multiplier: 1 at rest, about a third while an organ is open
      // (BodyOutline eases it), 0 while the figure is switched off or not built yet.
      uOpacity: { value: 0 },
    },
    vertexShader: GLASS_VERT,
    fragmentShader: GLASS_FRAG,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
    blending: THREE.NormalBlending,
  });
}

export const SHADOW_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const SHADOW_FRAG = /* glsl */ `
uniform float uStrength;
varying vec2 vUv;
void main() {
  // Radial falloff from the centre of the quad to its edge: smooth, zero at the rim, so
  // the quad's own border is never seen.
  float r = clamp(length(vUv - 0.5) * 2.0, 0.0, 1.0);
  float f = 1.0 - smoothstep(0.0, 1.0, r);
  f *= f;
  gl_FragColor = vec4(vec3(1.0 - uStrength * f), 1.0);
}
`;

/**
 * The contact shadow: multiply-blended, so it can only darken the page, and by at most
 * `strength` (8 % by default, a DISPLAY choice) at its centre.
 */
export function createContactShadowMaterial(strength = 0.08): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'BodyContactShadow',
    uniforms: { uStrength: { value: strength } },
    vertexShader: SHADOW_VERT,
    fragmentShader: SHADOW_FRAG,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    // result = srcColor * dstColor, the same blend as the absorption bucket.
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.DstColorFactor,
    blendDst: THREE.ZeroFactor,
  });
}
