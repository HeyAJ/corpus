/**
 * DETERMINISTIC NOISE FOR PROCEDURAL ANATOMY.
 *
 * Every organ in this project is generated, not loaded, and it has to come out the same
 * on every machine and every load: the render tests cast rays through the real
 * geometry and compare framebuffers, and a tree of nerves that grew differently on a
 * phone than on a desktop would make every screenshot in a bug report unreproducible.
 * So nothing here keeps state and nothing here calls Math.random. The value at a point
 * is a pure function of that point.
 *
 * This is the same positional hash `organs/placeholder.ts` has always used, lifted out
 * so the signed-distance modeller and the nerve and gland generators can share it. It
 * is value noise rather than gradient (Perlin) noise because the only thing it is ever
 * asked to do is make a silhouette less geometric - gyri on a brain, lobules on a
 * pancreas - and at that job the two are indistinguishable while this one is a third
 * of the code.
 */

/** Hash of an integer lattice point to [-1, 1). */
export function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(Math.round(x * 8191) ^ 0x2545f491, 0x27d4eb2d);
  h = Math.imul(h ^ Math.round(y * 8191), 0x85ebca6b);
  h = Math.imul(h ^ Math.round(z * 8191), 0xc2b2ae35);
  h ^= h >>> 15;
  return ((h >>> 0) / 4294967296) * 2 - 1;
}

/** One octave of trilinearly-interpolated value noise at the given spatial frequency. */
export function valueNoise(x: number, y: number, z: number, frequency: number): number {
  const px = x * frequency;
  const py = y * frequency;
  const pz = z * frequency;
  const xi = Math.floor(px);
  const yi = Math.floor(py);
  const zi = Math.floor(pz);
  const fx = px - xi;
  const fy = py - yi;
  const fz = pz - zi;
  // Smoothstep the interpolant: without it the lattice shows through as creases.
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);

  const c000 = hash3(xi, yi, zi);
  const c100 = hash3(xi + 1, yi, zi);
  const c010 = hash3(xi, yi + 1, zi);
  const c110 = hash3(xi + 1, yi + 1, zi);
  const c001 = hash3(xi, yi, zi + 1);
  const c101 = hash3(xi + 1, yi, zi + 1);
  const c011 = hash3(xi, yi + 1, zi + 1);
  const c111 = hash3(xi + 1, yi + 1, zi + 1);

  const x00 = c000 + (c100 - c000) * sx;
  const x10 = c010 + (c110 - c010) * sx;
  const x01 = c001 + (c101 - c001) * sx;
  const x11 = c011 + (c111 - c011) * sx;
  const y0 = x00 + (x10 - x00) * sy;
  const y1 = x01 + (x11 - x01) * sy;
  return y0 + (y1 - y0) * sz;
}

/** Fractal value noise: `octaves` octaves, each at 2.1x the frequency and half the gain. */
export function fbm(x: number, y: number, z: number, frequency: number, octaves = 3): number {
  let sum = 0;
  let amp = 1;
  let f = frequency;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x, y, z, f) * amp;
    amp *= 0.5;
    f *= 2.1;
  }
  return sum;
}

/**
 * Ridged noise in [0, 1]: 1 along the ridge lines, falling away either side.
 *
 * `1 - |noise|` folds the zero crossings of the field into creases, which is the
 * standard way to get a network of grooves out of a smooth field - and a network of
 * grooves is what a cortex is. Used for sulci, and for nothing else.
 */
export function ridged(x: number, y: number, z: number, frequency: number): number {
  return 1 - Math.min(1, Math.abs(valueNoise(x, y, z, frequency)) * 2.2);
}

/** Small fast deterministic PRNG (mulberry32), for generators that need a sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
