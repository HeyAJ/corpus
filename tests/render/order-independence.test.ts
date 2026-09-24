import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import organsFile from '../../src/data/organs.json';
import type { OrgansFile } from '../../src/data/types';
import { buildPlaceholderGeometry } from '../../src/render/organs/placeholder';
import {
  composite,
  compositeInterleaved,
  quantise8,
  type Fragment,
  type AbsorptionUniforms,
  type RimUniforms,
} from '../../src/render/materials/shaderMath';
import { createOrganAbsorptionMaterial, assertOrderIndependent } from '../../src/render/materials/OrganAbsorption';
import { createOrganRimMaterial, assertRimOrderIndependent } from '../../src/render/materials/OrganRim';
import { Rng } from '../../src/sim/core/rng';

/**
 * THE ORDER-INDEPENDENCE TEST (spec 6.2).
 *
 * "Render the organ set, shuffle the draw order with a seeded PRNG, render again,
 *  assert the two framebuffers are bit-identical. This test is cheap and it will
 *  catch the single class of bug that destroys this look."
 *
 * HOW THIS RUNS WITHOUT A GPU. A headless WebGL context is a native dependency and
 * the stack is fixed (spec 2), so instead the test rasterises on the CPU: it casts
 * a ray per pixel through the REAL organ geometry with three's Raycaster — which
 * needs no GL context — collects every wall the ray passes through, evaluates the
 * same fragment maths the shaders use, and composites the result. The geometry is
 * real, the fragment maths is real, and the blend equations are real. What is
 * simulated is the rasteriser, and a rasteriser cannot make a commutative blend
 * non-commutative.
 *
 * WHAT "BIT-IDENTICAL" MEANS HERE, PRECISELY. Floating-point multiplication is
 * commutative but NOT associative, so reordering a product can move the result by
 * an ULP in float64. A real framebuffer stores 8 bits per channel and rounds that
 * difference away, which is why the GPU version of this test passes. So the test
 * asserts both:
 *   - bit-identity at 8 bits per channel, which is what the framebuffer holds, and
 *   - agreement to 1e-12 in float64, which is the strongest true statement.
 * Asserting exact float64 equality would be asserting something that is not true of
 * floating-point arithmetic, and it would fail for a reason that has nothing to do
 * with the rendering architecture.
 */

const FILE = organsFile as unknown as OrgansFile;

const ABSORPTION: AbsorptionUniforms = {
  // Linear-space tint, as THREE.Color converts it before it reaches the shader.
  tint: srgbToLinear(0xffc4c4),
  density: 0.42,
  edgeGain: 1.9,
  edgePower: 2.0,
};

const RIM: RimUniforms = {
  color: srgbToLinear(0xfffdfb),
  power: 2.2,
  gain: 0.95,
};

const BACKGROUND: [number, number, number] = srgbToLinear(0xf0f0f0);

function srgbToLinear(hex: number): [number, number, number] {
  const c = new THREE.Color();
  c.setHex(hex, THREE.SRGBColorSpace);
  return [c.r, c.g, c.b];
}

interface OrganMesh {
  id: string;
  mesh: THREE.Mesh;
}

function buildScene(): OrganMesh[] {
  const out: OrganMesh[] = [];
  for (const def of FILE.organs) {
    const geometry = buildPlaceholderGeometry(def.placeholder);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const group = FILE.groupLayout[def.group];
    mesh.position.set(
      def.position[0] + def.layoutOffset[0] + group.offset[0],
      def.position[1] + def.layoutOffset[1] + group.offset[1],
      def.position[2] + def.layoutOffset[2] + group.offset[2],
    );
    if (def.rotation) mesh.rotation.set(def.rotation[0], def.rotation[1], def.rotation[2]);
    mesh.updateMatrixWorld(true);
    out.push({ id: def.id, mesh });
  }
  return out;
}

/**
 * Cast one ray and return every fragment it produces, in the order the organs were
 * given. Each wall crossing contributes one absorption fragment and one rim
 * fragment, exactly as the two meshes per organ do on the GPU.
 */
function fragmentsForRay(
  organs: OrganMesh[],
  raycaster: THREE.Raycaster,
  normalMatrices: Map<string, THREE.Matrix3>,
): Fragment[] {
  const fragments: Fragment[] = [];
  const worldNormal = new THREE.Vector3();

  for (const organ of organs) {
    const hits = raycaster.intersectObject(organ.mesh, false);
    for (const hit of hits) {
      if (!hit.face) continue;
      worldNormal.copy(hit.face.normal).applyMatrix3(normalMatrices.get(organ.id)!).normalize();
      const ndv = Math.abs(worldNormal.dot(raycaster.ray.direction));
      fragments.push({ kind: 'absorb', uniforms: ABSORPTION, ndv });
      fragments.push({ kind: 'rim', uniforms: RIM, ndv });
    }
  }
  return fragments;
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

interface Framebuffer {
  rgba8: Uint8Array;
  float: Float64Array;
  hitPixels: number;
}

function render(organs: OrganMesh[], width: number, height: number): Framebuffer {
  const camera = new THREE.PerspectiveCamera(21, width / height, 0.05, 50);
  camera.position.set(0, 0.16, 2.63);
  camera.lookAt(0, 0.16, 0);
  camera.updateMatrixWorld(true);

  const normalMatrices = new Map<string, THREE.Matrix3>();
  for (const o of organs) normalMatrices.set(o.id, new THREE.Matrix3().getNormalMatrix(o.mesh.matrixWorld));

  const raycaster = new THREE.Raycaster();
  const rgba8 = new Uint8Array(width * height * 3);
  const float = new Float64Array(width * height * 3);
  const ndc = new THREE.Vector2();
  let hitPixels = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      ndc.set(((x + 0.5) / width) * 2 - 1, -(((y + 0.5) / height) * 2 - 1));
      raycaster.setFromCamera(ndc, camera);
      const fragments = fragmentsForRay(organs, raycaster, normalMatrices);
      if (fragments.length > 0) hitPixels++;
      const c = composite(BACKGROUND, fragments);
      const q = quantise8(c);
      const i = (y * width + x) * 3;
      rgba8[i] = q[0];
      rgba8[i + 1] = q[1];
      rgba8[i + 2] = q[2];
      float[i] = c[0];
      float[i + 1] = c[1];
      float[i + 2] = c[2];
    }
  }
  return { rgba8, float, hitPixels };
}

describe('render order independence (spec 6.2)', () => {
  const organs = buildScene();
  const WIDTH = 64;
  const HEIGHT = 96;

  it('the ray cast actually hits the body, so the test is not vacuously true', () => {
    const fb = render(organs, WIDTH, HEIGHT);
    // A blank framebuffer would pass every equality assertion below, so prove the
    // scene is really being sampled before trusting any of them.
    expect(fb.hitPixels).toBeGreaterThan(WIDTH * HEIGHT * 0.15);
  });

  it('is bit-identical at framebuffer precision under every shuffled draw order', () => {
    const reference = render(organs, WIDTH, HEIGHT);
    const rng = new Rng(0xc0d3);

    for (let trial = 0; trial < 8; trial++) {
      const shuffled = render(shuffle(organs, rng), WIDTH, HEIGHT);
      expect(shuffled.rgba8).toEqual(reference.rgba8);
    }
  });

  it('agrees to 1e-12 in float64 under every shuffled draw order', () => {
    const reference = render(organs, WIDTH, HEIGHT);
    const rng = new Rng(0xbeef);

    for (let trial = 0; trial < 4; trial++) {
      const shuffled = render(shuffle(organs, rng), WIDTH, HEIGHT);
      let worst = 0;
      for (let i = 0; i < reference.float.length; i++) {
        worst = Math.max(worst, Math.abs(reference.float[i] - shuffled.float[i]));
      }
      expect(worst).toBeLessThan(1e-12);
    }
  });

  it('keeps the material configuration that makes the guarantee hold', () => {
    // If any of these flip, the guarantee is gone and the pixel tests above would
    // still pass, because they model the blend rather than reading it off the GPU.
    // This is the part that actually protects the architecture.
    expect(() => assertOrderIndependent(createOrganAbsorptionMaterial())).not.toThrow();
    expect(() => assertRimOrderIndependent(createOrganRimMaterial())).not.toThrow();

    const bad = createOrganAbsorptionMaterial();
    bad.depthWrite = true;
    expect(() => assertOrderIndependent(bad)).toThrow(/depthWrite/);

    const bad2 = createOrganAbsorptionMaterial();
    bad2.blending = THREE.NormalBlending;
    expect(() => assertOrderIndependent(bad2)).toThrow(/blending/);
  });

  it('accumulates Beer-Lambert through the stack: T1*T2 == exp(-(s1+s2))', () => {
    // The architectural claim is not merely "order does not matter"; it is that the
    // product of transmittances IS the Beer-Lambert law integrated through every
    // layer. Verify that directly.
    const a: Fragment = { kind: 'absorb', uniforms: ABSORPTION, ndv: 0.8 };
    const b: Fragment = { kind: 'absorb', uniforms: ABSORPTION, ndv: 0.35 };

    const product = composite([1, 1, 1], [a, b]);

    const sigmaOf = (ndv: number) => {
      const path = 1 / Math.max(ndv, 0.08);
      const edge = Math.pow(1 - ndv, ABSORPTION.edgePower);
      return ABSORPTION.density * (path + ABSORPTION.edgeGain * edge);
    };
    const summed = sigmaOf(0.8) + sigmaOf(0.35);
    const expected = [
      Math.exp(-summed * (1 - ABSORPTION.tint[0])),
      Math.exp(-summed * (1 - ABSORPTION.tint[1])),
      Math.exp(-summed * (1 - ABSORPTION.tint[2])),
    ];

    for (let i = 0; i < 3; i++) expect(product[i]).toBeCloseTo(expected[i], 12);
  });

  it('demonstrates that the BUCKET BOUNDARY is the one order that matters', () => {
    // Multiplication does not commute with addition. Interleaving an absorption and
    // a rim fragment gives a different answer from bucketing them, which is why the
    // renderer pins every shell to renderOrder 10 and every rim to renderOrder 20.
    // If this assertion ever starts passing, the two blend modes have become
    // interchangeable and something is wrong with the materials.
    const fragments: Fragment[] = [
      { kind: 'absorb', uniforms: ABSORPTION, ndv: 0.7 },
      { kind: 'rim', uniforms: RIM, ndv: 0.7 },
      { kind: 'absorb', uniforms: ABSORPTION, ndv: 0.2 },
      { kind: 'rim', uniforms: RIM, ndv: 0.2 },
    ];
    const bucketed = composite(BACKGROUND, fragments);
    const interleaved = compositeInterleaved(BACKGROUND, fragments);
    // Compare across all three channels, not just red: the tint's red absorption
    // coefficient is deliberately zero (that is what keeps the tissue a saturated
    // pink rather than a desaturated grey), so red alone is transparent to this
    // difference and checking it would make the assertion vacuous.
    const worst = Math.max(
      Math.abs(bucketed[0] - interleaved[0]),
      Math.abs(bucketed[1] - interleaved[1]),
      Math.abs(bucketed[2] - interleaved[2]),
    );
    expect(worst).toBeGreaterThan(1e-6);
  });

  it('a white tint is the exact identity for multiply blending', () => {
    // This is why an organ can fade out with a density tween and never pop or
    // change its place in the draw order.
    const identity: AbsorptionUniforms = { ...ABSORPTION, tint: [1, 1, 1] };
    const result = composite(BACKGROUND, [
      { kind: 'absorb', uniforms: identity, ndv: 0.15 },
      { kind: 'absorb', uniforms: identity, ndv: 0.9 },
    ]);
    expect(result).toEqual(BACKGROUND);
  });
});
