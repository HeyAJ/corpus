import * as THREE from 'three';
import { SOLID_VERT } from '../../materials/OrganSolid';

/**
 * THE MATERIAL OF AN ORGAN'S INTERIOR PARTS.
 *
 * A part is a chamber, a lobe, a nucleus, a pyramid: a solid thing seen INSIDE a glass
 * shell. It has three jobs and this material is the whole of the first two.
 *
 *   1. READ AS A FORM. There are deliberately no scene lights here. The renderer's look
 *      is a flat, soft, absorption-style picture (docs/VISUAL_AUDIT.md), and a Lambert or
 *      Phong term would add a light direction that exists nowhere else in the scene, so a
 *      part would look lit from a direction the shell and the vessels are not. Instead the
 *      body of the colour is modulated by how squarely the surface faces the eye
 *      (`ndv`): full colour where it faces you, 62 % where it turns away. That is enough
 *      to separate overlapping parts without inventing a sun, and it reads as clay.
 *
 *   2. SAY HOW HARD IT IS WORKING. `uGlow` (0..1) lifts and warms the colour and adds a
 *      rim. The glow is the engine's own activity index for that part, shown, not
 *      computed here; this file never decides what a hypothalamus is doing.
 *
 *   3. SHOW WHICH PART THE USER PICKED. `uHighlight` adds a white rim. The part list in
 *      the UI and a tap on the body both drive it, so the same cue answers both.
 *
 * It uses normal alpha blending with the depth buffer ON, unlike the additive rim and
 * the multiply shell. That is a choice: parts must occlude each other (a ventricle in
 * front of an atrium hides it) or the interior turns into an undifferentiated smear, and
 * there are only a handful of them per organ, so the sorting problems that made the shell
 * buckets order-independent do not arise. The cost is that two semi-transparent parts
 * (during a fade) can blend in the wrong order for a few hundred milliseconds; nobody
 * will see it.
 *
 * COLOUR SPACE. The output is written in the same LINEAR space as OrganSolid and the
 * absorption materials. The post chain (ACES, grade, dither) tone-maps and encodes; an
 * sRGB encode here would be applied twice and wash every part out. The vertex shader is
 * OrganSolid's own, so the varyings match and nothing here depends on the model matrix
 * being anything in particular (the interior group is mirrored with the body).
 */

export const PART_FRAG = /* glsl */ `
uniform vec3  uColor;
uniform float uGlow;
uniform float uOpacity;
uniform float uHighlight;

varying vec3 vNormalW;
varying vec3 vViewDirW;

void main() {
  vec3  N = normalize(vNormalW);
  vec3  V = normalize(vViewDirW);
  // abs(): the material is double-sided, so a back face has its normal pointing away from
  // the eye and must shade like the front face of the same surface, not go black.
  float ndv = abs(dot(N, V));

  vec3 body = uColor * (0.62 + 0.38 * ndv);
  body += vec3(pow(ndv, 10.0) * 0.18);

  // Glow lifts and WARMS: an active tissue gets brighter and a little redder, which is
  // how a flushed, perfused organ looks, and it keeps a blue part from simply bleaching.
  vec3 lit = mix(body, body * 1.35 + vec3(0.10, 0.05, 0.02), uGlow);
  lit += vec3(pow(1.0 - ndv, 2.0) * 0.55 * uGlow);

  lit += vec3(pow(1.0 - ndv, 1.5) * 0.9 * uHighlight);

  gl_FragColor = vec4(lit, uOpacity);
}
`;

export interface PartMaterialOptions {
  color?: THREE.ColorRepresentation;
}

export function createPartMaterial(options: PartMaterialOptions = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'OrganPart',
    uniforms: {
      uColor: { value: new THREE.Color(options.color ?? 0xc8b8aa) },
      uGlow: { value: 0 },
      uOpacity: { value: 1 },
      uHighlight: { value: 0 },
    },
    vertexShader: SOLID_VERT,
    fragmentShader: PART_FRAG,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: true,
    depthTest: true,
  });
}
