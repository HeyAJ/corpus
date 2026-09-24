import { describe, expect, it } from 'vitest';
import { ABSORPTION_FRAG } from '../../src/render/materials/OrganAbsorption';
import { RIM_FRAG } from '../../src/render/materials/OrganRim';
import { DITHER_FRAG } from '../../src/render/postfx/DitherPass';
import { absorptionTransmittance, rimContribution } from '../../src/render/materials/shaderMath';

/**
 * KEEPING THE GLSL AND ITS TYPESCRIPT MIRROR HONEST.
 *
 * The order-independence test rasterises on the CPU using a TypeScript mirror of
 * the fragment maths, because a headless GL context would be a native dependency
 * and the stack is fixed. That mirror is a duplicate of the shader, and a duplicate
 * that nobody checks is a lie waiting to happen: edit the shader, forget the
 * mirror, and the test keeps passing while the renderer does something else.
 *
 * So this test reads the shipping GLSL as text and asserts that the expressions the
 * mirror implements are still the expressions the GPU runs.
 */

describe('shader source matches the TypeScript mirror', () => {
  it('absorption keeps the Beer-Lambert form the mirror implements', () => {
    const glsl = ABSORPTION_FRAG.replace(/\s+/g, ' ');
    expect(glsl).toContain('float ndv = abs(dot(N, V))');
    expect(glsl).toContain('float path = 1.0 / max(ndv, 0.08)');
    expect(glsl).toContain('float edge = pow(1.0 - ndv, uEdgePower)');
    expect(glsl).toContain('float sigma = uDensity * (path + uEdgeGain * edge)');
    expect(glsl).toContain('vec3 absorption = vec3(1.0) - uTint');
    expect(glsl).toContain('vec3 T = exp(-sigma * absorption)');
  });

  it('rim keeps the fresnel form the mirror implements', () => {
    const glsl = RIM_FRAG.replace(/\s+/g, ' ');
    expect(glsl).toContain('float ndv = abs(dot(normalize(vNormalW), normalize(vViewDirW)))');
    expect(glsl).toContain('float f = pow(1.0 - ndv, uRimPower)');
    expect(glsl).toContain('uRimColor * f * uRimGain');
  });

  it('the mirror reproduces hand-computed values', () => {
    // Worked by hand from the formula above, so a change to either implementation
    // has to be a deliberate one.
    const u = { tint: [1, 0.5, 0.5] as [number, number, number], density: 0.4, edgeGain: 2, edgePower: 2 };
    // ndv = 1: path = 1, edge = 0, sigma = 0.4. absorption = (0, 0.5, 0.5).
    const head = absorptionTransmittance(u, 1);
    expect(head[0]).toBeCloseTo(1, 12);
    expect(head[1]).toBeCloseTo(Math.exp(-0.2), 12);

    // ndv = 0.5: path = 2, edge = 0.25, sigma = 0.4 * (2 + 0.5) = 1.0
    const oblique = absorptionTransmittance(u, 0.5);
    expect(oblique[1]).toBeCloseTo(Math.exp(-0.5), 12);

    // The path clamp: below ndv = 0.08 the PATH length stops growing. Isolate it by
    // zeroing the edge gain, since the edge term keeps varying all the way to zero.
    const pathOnly = { ...u, edgeGain: 0 };
    expect(absorptionTransmittance(pathOnly, 0.0)).toEqual(absorptionTransmittance(pathOnly, 0.04));
    // And with the edge term restored they differ, which is what gives the
    // silhouette its extra darkening.
    expect(absorptionTransmittance(u, 0.0)[1]).not.toBeCloseTo(absorptionTransmittance(u, 0.04)[1], 6);
  });

  it('the rim mirror reproduces hand-computed values', () => {
    const u = { color: [1, 1, 1] as [number, number, number], power: 2, gain: 0.5 };
    expect(rimContribution(u, 1)[0]).toBeCloseTo(0, 12);
    expect(rimContribution(u, 0.5)[0]).toBeCloseTo(0.25 * 0.5, 12);
    expect(rimContribution(u, 0)[0]).toBeCloseTo(0.5, 12);
  });

  it('absorption is symmetric in the sign of the normal', () => {
    // abs(dot(N,V)) is what makes front and back faces of a DoubleSide shell behave
    // alike, which is what lets one hollow mesh read as a solid volume.
    const u = { tint: [0.9, 0.6, 0.6] as [number, number, number], density: 0.3, edgeGain: 2, edgePower: 2 };
    expect(absorptionTransmittance(u, 0.7)).toEqual(absorptionTransmittance(u, -0.7));
  });
});

describe('the dither pass', () => {
  it('samples the Bayer grid in DEVICE pixels', () => {
    const glsl = DITHER_FRAG.replace(/\s+/g, ' ');
    // gl_FragCoord is in render-target pixels. Sampling the grid from vUv instead
    // would make the dot size depend on the window size, and the pattern would
    // crawl as the window resized.
    expect(glsl).toContain('vec2 cell = floor(gl_FragCoord.xy / uDotSize)');
  });

  it('applies the dither AFTER the tone map and the display transfer', () => {
    const src = DITHER_FRAG;
    // Find the CALL site, not the function definition above it.
    const shoulder = src.indexOf('color = softShoulder(color)');
    const gamma = src.indexOf('pow(color, vec3(1.0 / 2.2))');
    const dither = src.indexOf('bayer8(cell)');
    // The APPLICATION of the vignette, not its uniform declaration at the top.
    const vignette = src.indexOf('1.0 - uVignette * smoothstep');
    expect(shoulder).toBeGreaterThan(-1);
    expect(gamma).toBeGreaterThan(shoulder);
    expect(dither).toBeGreaterThan(gamma);
    expect(vignette).toBeGreaterThan(dither);
  });

  it('has a complete 8x8 Bayer matrix with every value 0..63 exactly once', () => {
    // Only the entries inside the if/else chain; the `float v = 0.0;` initialiser
    // above it is not part of the matrix.
    const body = DITHER_FRAG.slice(DITHER_FRAG.indexOf('float v = 0.0;') + 'float v = 0.0;'.length);
    const values = [...body.matchAll(/v = +(\d+)\.0;/g)].map((m) => Number(m[1]));
    expect(values.length).toBe(64);
    expect(new Set(values).size).toBe(64);
    expect(Math.min(...values)).toBe(0);
    expect(Math.max(...values)).toBe(63);
  });
});
