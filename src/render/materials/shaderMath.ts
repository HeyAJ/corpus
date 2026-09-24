/**
 * TYPESCRIPT MIRROR OF THE ORGAN FRAGMENT MATH.
 *
 * The GLSL in OrganAbsorption.ts and OrganRim.ts is the shipping implementation.
 * These functions reproduce it exactly, line for line, so that
 * `tests/render/order-independence.test.ts` can rasterise the real organ geometry on
 * the CPU — using three's Raycaster, which needs no GL context — composite the
 * fragments in a shuffled order, and prove the framebuffer is unchanged.
 *
 * There is no way to share one source between GLSL and TypeScript without a
 * transpiler, so the mirror is a duplicate and is kept honest by
 * `tests/render/shader-mirror.test.ts`, which asserts the GLSL source text still
 * contains the expressions this file implements. If someone edits the shader and
 * not the mirror, that test fails.
 */

export interface AbsorptionUniforms {
  tint: [number, number, number];
  density: number;
  edgeGain: number;
  edgePower: number;
}

export interface RimUniforms {
  color: [number, number, number];
  power: number;
  gain: number;
}

/**
 * Per-channel transmittance through one shell wall.
 *
 *   path  = 1 / max(ndv, 0.08)          grazing rays travel further through the wall
 *   edge  = pow(1 - ndv, edgePower)     extra darkening at the silhouette
 *   sigma = density * (path + edgeGain * edge)
 *   T     = exp(-sigma * (1 - tint))    Beer-Lambert, per channel
 *
 * `tint = white` makes the absorption coefficient zero, so T = 1, which is the
 * identity element for multiply blending. That is why an organ fading out is a
 * clean `density -> 0` tween with no popping and no change in sort order.
 */
export function absorptionTransmittance(u: AbsorptionUniforms, ndv: number): [number, number, number] {
  const n = Math.abs(ndv);
  const path = 1 / Math.max(n, 0.08);
  const edge = Math.pow(1 - n, u.edgePower);
  const sigma = u.density * (path + u.edgeGain * edge);
  return [
    Math.exp(-sigma * (1 - u.tint[0])),
    Math.exp(-sigma * (1 - u.tint[1])),
    Math.exp(-sigma * (1 - u.tint[2])),
  ];
}

/** Additive fresnel rim. Also commutative under compositing. */
export function rimContribution(u: RimUniforms, ndv: number): [number, number, number] {
  const n = Math.abs(ndv);
  const f = Math.pow(1 - n, u.power);
  return [u.color[0] * f * u.gain, u.color[1] * f * u.gain, u.color[2] * f * u.gain];
}

export type Fragment =
  | { kind: 'absorb'; uniforms: AbsorptionUniforms; ndv: number }
  | { kind: 'rim'; uniforms: RimUniforms; ndv: number };

/**
 * Composite a set of fragments onto a background, in BUCKET ORDER.
 *
 *   bucket 1 (absorption): dst = dst * T        multiplication, commutative
 *   bucket 2 (rim):        dst = dst + rim      addition, commutative
 *
 * ORDER INDEPENDENCE IS PER BUCKET, AND THAT DISTINCTION IS THE WHOLE POINT.
 * Multiplication commutes with multiplication and addition commutes with addition,
 * but multiplication does NOT commute with addition: (bg*T1 + r1)*T2 + r2 is not
 * (bg*T2 + r2)*T1 + r1. So the sequence within each bucket may be anything, and
 * the boundary between the buckets may not move.
 *
 * That is exactly what the renderer guarantees: every absorption shell is drawn at
 * renderOrder 10 and every rim at renderOrder 20, so the GPU always finishes bucket
 * 1 before starting bucket 2, whatever order the organs themselves are submitted
 * in. This function partitions rather than trusting its input order, so that it
 * models the renderer and not the caller.
 *
 * (Found by tests/render/order-independence.test.ts, which failed with a 0.42
 * discrepancy when the fragments were interleaved per hit instead of bucketed.)
 */
export function composite(background: [number, number, number], fragments: readonly Fragment[]): [number, number, number] {
  let r = background[0];
  let g = background[1];
  let b = background[2];

  // Bucket 1: absorption, multiplicative.
  for (const f of fragments) {
    if (f.kind !== 'absorb') continue;
    const t = absorptionTransmittance(f.uniforms, f.ndv);
    r *= t[0];
    g *= t[1];
    b *= t[2];
  }

  // Bucket 2: rim, additive.
  for (const f of fragments) {
    if (f.kind !== 'rim') continue;
    const c = rimContribution(f.uniforms, f.ndv);
    r += c[0];
    g += c[1];
    b += c[2];
  }

  return [r, g, b];
}

/**
 * Composite strictly in the given sequence, ignoring buckets. Only used to
 * demonstrate, in the test, that the bucket boundary genuinely matters — which is
 * what stops "order-independent" from being read as "order never matters".
 */
export function compositeInterleaved(
  background: [number, number, number],
  fragments: readonly Fragment[],
): [number, number, number] {
  let r = background[0];
  let g = background[1];
  let b = background[2];
  for (const f of fragments) {
    if (f.kind === 'absorb') {
      const t = absorptionTransmittance(f.uniforms, f.ndv);
      r *= t[0];
      g *= t[1];
      b *= t[2];
    } else {
      const c = rimContribution(f.uniforms, f.ndv);
      r += c[0];
      g += c[1];
      b += c[2];
    }
  }
  return [r, g, b];
}

/**
 * Quantise to the 8 bits per channel that an ordinary framebuffer actually stores.
 *
 * This matters for the order-independence claim. Floating-point multiplication is
 * commutative but NOT associative, so reordering a product can move the result by
 * an ULP in float64. On the GPU that difference is invisible because the value is
 * rounded to 8 bits on write. The test therefore asserts bit-identity at the
 * precision the framebuffer has, and separately asserts agreement to 1e-12 in
 * float64 — which is the precise, true statement.
 */
export function quantise8(c: [number, number, number]): [number, number, number] {
  const q = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return [q(c[0]), q(c[1]), q(c[2])];
}
