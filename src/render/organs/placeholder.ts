import * as THREE from 'three';
import type { PlaceholderRecipe } from '../../data/types';

/**
 * PLACEHOLDER ORGAN GEOMETRY (spec 7.2).
 *
 * "Procedural approximations — lathed profiles, metaballs, capsules — correct in
 *  position, scale, pivot, and bounding sphere, wrong in every detail."
 *
 * Every shader, interaction, camera move and layout is developed against these, so
 * asset acquisition never blocks engineering. The generator is committed so the app
 * builds from a clean checkout with no binary assets at all.
 *
 * And the reason this works rather than being a compromise: the material in
 * materials/OrganAbsorption.ts has no diffuse or specular term, so surface detail is
 * invisible. A smoothed placeholder and a 200k-triangle segmentation render
 * identically through it. Mesh detail is about 3 % of the look (spec 7.1).
 *
 * Determinism: the vertex noise uses a positional hash, not Math.random, so two
 * runs produce byte-identical geometry and the order-independence test can rely on
 * a stable mesh.
 */

/** Deterministic value noise from a 3D position. No RNG state, no ordering issues. */
function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(Math.round(x * 8191) ^ 0x2545f491, 0x27d4eb2d);
  h = Math.imul(h ^ Math.round(y * 8191), 0x85ebca6b);
  h = Math.imul(h ^ Math.round(z * 8191), 0xc2b2ae35);
  h ^= h >>> 15;
  return ((h >>> 0) / 4294967296) * 2 - 1;
}

function smoothNoise(x: number, y: number, z: number, frequency: number): number {
  // Three octaves of positional hash, low-pass filtered by averaging neighbours.
  let sum = 0;
  let amp = 1;
  let f = frequency;
  for (let o = 0; o < 3; o++) {
    const xi = Math.floor(x * f);
    const yi = Math.floor(y * f);
    const zi = Math.floor(z * f);
    const fx = x * f - xi;
    const fy = y * f - yi;
    const fz = z * f - zi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const sz = fz * fz * (3 - 2 * fz);
    let v = 0;
    for (let dz = 0; dz <= 1; dz++) {
      for (let dy = 0; dy <= 1; dy++) {
        for (let dx = 0; dx <= 1; dx++) {
          const w =
            (dx ? sx : 1 - sx) * (dy ? sy : 1 - sy) * (dz ? sz : 1 - sz);
          v += w * hash3(xi + dx, yi + dy, zi + dz);
        }
      }
    }
    sum += v * amp;
    amp *= 0.5;
    f *= 2.1;
  }
  return sum;
}

function displace(geometry: THREE.BufferGeometry, amount: number, frequency = 6): void {
  if (amount <= 0) return;
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = smoothNoise(x, y, z, frequency);
    const len = Math.sqrt(x * x + y * y + z * z) || 1;
    const scale = 1 + n * amount;
    pos.setXYZ(i, (x / len) * len * scale, (y / len) * len * scale, (z / len) * len * scale);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

function ellipsoid(radii: [number, number, number], detail: number, noise: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  g.scale(radii[0], radii[1], radii[2]);
  displace(g, noise, 9);
  return g;
}

function lathe(profile: [number, number][], segments: number, noise: number): THREE.BufferGeometry {
  const points = profile.map(([r, y]) => new THREE.Vector2(Math.max(1e-4, r), y));
  const g = new THREE.LatheGeometry(points, segments);
  displace(g, noise, 14);
  g.computeVertexNormals();
  return g;
}

function tube(path: [number, number, number][], radius: number, radial = 16): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(path.map((p) => new THREE.Vector3(...p)), false, 'catmullrom', 0.4);
  const segments = Math.max(24, path.length * 12);
  return new THREE.TubeGeometry(curve, segments, radius, radial, false);
}

/**
 * The GI tract. A single tube along a Catmull-Rom curve reads as bowel far better
 * than a chain of separate capsules, and it gives the bolus animation a curve to
 * travel along for free.
 */
function capsuleChain(points: [number, number, number][], radius: number): THREE.BufferGeometry {
  const g = tube(points, radius, 14);
  // Gentle haustral ripple so the silhouette is not a perfectly smooth pipe.
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ripple = Math.sin(y * 260) * 0.12 + smoothNoise(x, y, z, 30) * 0.18;
    pos.setXYZ(
      i,
      x + nrm.getX(i) * ripple * radius,
      y + nrm.getY(i) * ripple * radius,
      z + nrm.getZ(i) * ripple * radius,
    );
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/**
 * Heart. Correct in bounding sphere, pivot and the broad-base/apex-down silhouette;
 * wrong in every anatomical detail, which the material cannot show anyway.
 */
function heartShell(): THREE.BufferGeometry {
  // Detail 10 is 2420 triangles, well inside the 15 k budget. Silhouette is the
  // ONLY thing this material renders, so subdivision buys smooth outlines at close
  // focus even though it buys no surface detail at all.
  const g = new THREE.IcosahedronGeometry(1, 10);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    // Taper to an apex at -Y, broaden at the base.
    const t = (y + 1) / 2;
    const taper = 0.32 + 0.68 * Math.pow(t, 0.62);

    // The interventricular groove: a shallow crease down the anterior face.
    const groove = 1 - 0.13 * Math.exp(-Math.pow(x / 0.22, 2)) * Math.max(0, z);

    // Two ventricular bulges, left larger than right.
    const lv = 1 + 0.10 * Math.exp(-(Math.pow((x + 0.38) / 0.5, 2) + Math.pow((y + 0.1) / 0.7, 2)));
    const rv = 1 + 0.05 * Math.exp(-(Math.pow((x - 0.42) / 0.45, 2) + Math.pow((y + 0.05) / 0.6, 2)));

    const s = taper * groove * lv * rv;
    // Half-extents: 4.5 cm wide, 6.5 cm tall, 4 cm deep — a 12 cm heart.
    pos.setXYZ(i, x * s * 0.045, y * s * 0.065, z * s * 0.040);
  }
  pos.needsUpdate = true;
  displace(g, 0.035, 26);
  g.computeVertexNormals();
  return g;
}

/** Brain: two hemispheres with a longitudinal fissure and a brainstem stub. */
function brainShell(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 10);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const fissure = 1 - 0.14 * Math.exp(-Math.pow(x / 0.1, 2)) * Math.max(0, y);
    // Flatten the base, where the brain sits on the skull floor.
    const base = y < -0.45 ? 1 - (Math.abs(y) - 0.45) * 0.55 : 1;
    // Brainstem: a short stub descending from the midline base, which is what makes
    // the silhouette read as a brain rather than as a walnut.
    const stem = 1 + 0.30 * Math.exp(-(Math.pow(x / 0.16, 2) + Math.pow((z + 0.1) / 0.24, 2))) * Math.max(0, -y - 0.55);
    const s = fissure * base * stem;
    // Half-extents: 6.8 cm wide, 6.4 cm tall, 8.0 cm deep (front to back).
    pos.setXYZ(i, x * s * 0.068, y * s * 0.064, z * s * 0.080);
  }
  pos.needsUpdate = true;
  // Gyri: high-frequency, low-amplitude. Invisible through the material but it keeps
  // the silhouette from reading as a perfect ovoid.
  displace(g, 0.055, 38);
  g.computeVertexNormals();
  return g;
}

/** Lung: three lobes on the right, two on the left, with the cardiac notch. */
function lobedLung(side: -1 | 1): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 10);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    // Conical: narrow apex, broad base.
    const t = (y + 1) / 2;
    const taper = 0.42 + 0.58 * Math.pow(1 - t, 0.5) * 1.15;

    // Mediastinal surface is concave — flatten the side facing the midline.
    const medial = x * side < 0 ? 1 - 0.30 * Math.exp(-Math.pow(x / 0.55, 2)) : 1;

    // Cardiac notch, left lung only.
    const notch =
      side < 0 ? 1 - 0.26 * Math.exp(-(Math.pow((x + 0.45) / 0.4, 2) + Math.pow((y + 0.25) / 0.45, 2))) : 1;

    // Oblique fissure.
    const fissure = 1 - 0.05 * Math.exp(-Math.pow((y - z * 0.5) / 0.08, 2));

    const s = taper * medial * notch * fissure;
    // Half-extents: 6.2 cm wide, 11.5 cm tall, 7 cm deep — a 23 cm lung.
    pos.setXYZ(i, x * s * 0.062, y * s * 0.115, z * s * 0.070);
  }
  pos.needsUpdate = true;
  displace(g, 0.03, 20);
  g.computeVertexNormals();
  return g;
}

export function buildPlaceholderGeometry(recipe: PlaceholderRecipe): THREE.BufferGeometry {
  switch (recipe.kind) {
    case 'ellipsoid':
      return ellipsoid(recipe.radii, recipe.detail ?? 3, recipe.noise ?? 0);
    case 'lathe':
      return lathe(recipe.profile, recipe.segments ?? 32, recipe.noise ?? 0);
    case 'capsuleChain':
      return capsuleChain(recipe.points, recipe.radius);
    case 'tube':
      return tube(recipe.path, recipe.radius);
    case 'lobedLung':
      return lobedLung(recipe.side);
    case 'heartShell':
      return heartShell();
    case 'brainShell':
      return brainShell();
  }
}

/** Triangle count, for the budget report in tools/placeholder-organs.ts. */
export function triangleCount(g: THREE.BufferGeometry): number {
  const index = g.getIndex();
  return index ? index.count / 3 : (g.attributes.position as THREE.BufferAttribute).count / 3;
}
