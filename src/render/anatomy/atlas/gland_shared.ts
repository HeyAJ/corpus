import * as THREE from 'three';
import { mergeParts, tubeAlong, type Sdf, type V3 } from '../sdf';
import { mulberry32 } from '../noise';

/**
 * SMALL DRAWING HELPERS SHARED BY THE ADRENAL, THYROID, THYMUS AND SPLEEN ATLASES.
 *
 * These four organs each gained a layer of finer structures (cell cords, follicles, cell
 * clusters, pulp meshwork) and every one of them needed the same few operations: scatter
 * points inside a region, put a bead or a thin cord there, and (for the spleen's
 * peritoneal ligaments) stretch a thin sheet between two lines. They live here so the four
 * atlases do not each carry a private copy that would drift.
 *
 * WHAT THIS FILE IS NOT. Nothing here knows an anatomical size. Every radius, spacing and
 * count is passed in by the caller and is a DRAWING choice: the cells in these atlases are
 * microscopic and are drawn magnified, as schematic clusters that say "cells of this kind
 * live here" and do not count or size them. Everything is deterministic (seeded PRNG), so
 * the geometry is identical on every build.
 *
 * HISTORY. The first sampler took points from the vertices of a polygonised surface. That
 * clustered them on the coarse grid's corners and put every "cell" on the same few rings,
 * so the sampler is a plain rejection sampler against the organ's own field instead.
 */

/** A solid bead (low-poly sphere) at `c`. Indexed with normals, like polygonise output. */
export function bead(c: V3, r: number, w = 6, h = 4): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, w, h);
  g.translate(c[0], c[1], c[2]);
  return g;
}

/** Many beads of one radius merged into one geometry. At least one centre is required. */
export function beads(centres: readonly V3[], r: number, w = 6, h = 4): THREE.BufferGeometry {
  return mergeParts(centres.map((c) => bead(c, r, w, h)));
}

/** A thin cord (straight or curved) of constant radius, kept coarse because it is tiny. */
export function cord(path: readonly V3[], r: number, tubular = 4, radial = 4): THREE.BufferGeometry {
  return tubeAlong(path, () => r, { tubular, radial });
}

/**
 * Deterministic rejection sampling. Draws points uniformly in the box until `n` have been
 * accepted by `accept` and are at least `minSep` from every earlier point, or until the
 * attempt budget runs out (the result may then hold fewer than `n`, which callers must
 * tolerate: a thin region simply gets fewer cells).
 */
export function sample(
  accept: (x: number, y: number, z: number) => boolean,
  min: V3,
  max: V3,
  n: number,
  seed: number,
  minSep = 0,
  tries = 4000,
): V3[] {
  const rnd = mulberry32(seed);
  const out: V3[] = [];
  const sep2 = minSep * minSep;
  for (let i = 0; i < tries && out.length < n; i++) {
    const x = min[0] + rnd() * (max[0] - min[0]);
    const y = min[1] + rnd() * (max[1] - min[1]);
    const z = min[2] + rnd() * (max[2] - min[2]);
    if (!accept(x, y, z)) continue;
    let clear = true;
    for (const q of out) {
      const dx = q[0] - x;
      const dy = q[1] - y;
      const dz = q[2] - z;
      if (dx * dx + dy * dy + dz * dz < sep2) {
        clear = false;
        break;
      }
    }
    if (clear) out.push([x, y, z]);
  }
  return out;
}

/** Unit outward normal of a field at a point, by central differences. */
export function gradient(f: Sdf, p: V3, e = 0.0004): V3 {
  const gx = f(p[0] + e, p[1], p[2]) - f(p[0] - e, p[1], p[2]);
  const gy = f(p[0], p[1] + e, p[2]) - f(p[0], p[1] - e, p[2]);
  const gz = f(p[0], p[1], p[2] + e) - f(p[0], p[1], p[2] - e);
  const n = Math.hypot(gx, gy, gz) || 1;
  return [gx / n, gy / n, gz / n];
}

export const add = (a: V3, b: V3, k = 1): V3 => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]];
export const unit = (a: V3): V3 => {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** Any unit vector perpendicular to `d`, chosen deterministically. */
export function perpendicular(d: V3): V3 {
  const ref: V3 = Math.abs(d[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
  return unit(cross(d, ref));
}

/** `n` roughly even directions on a sphere (Fibonacci lattice): where a ring of cells sits round a follicle. */
export function fibonacciSphere(n: number): V3[] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const out: V3[] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    out.push([Math.cos(golden * i) * r, y, Math.sin(golden * i) * r]);
  }
  return out;
}

/**
 * A thin sheet through several parallel polylines (`rows`, all of equal length, at least
 * two rows of two points): the peritoneal ligaments of the spleen. The sheet is built as two
 * faces `thickness` apart, each with its own normals, so it reads from either side under the
 * renderer's single-sided glass material. The rim is left open (a sliver of the thickness),
 * which cannot be seen from any distance the camera is allowed to reach.
 */
export function ribbon(rows: readonly (readonly V3[])[], thickness: number): THREE.BufferGeometry {
  const nr = rows.length;
  const nc = rows[0].length;
  const pos: number[] = [];
  const idx: number[] = [];
  const at = (i: number, j: number): THREE.Vector3 => new THREE.Vector3(rows[i][j][0], rows[i][j][1], rows[i][j][2]);
  const nrm = (i: number, j: number): THREE.Vector3 => {
    const di = at(Math.min(nr - 1, i + 1), j).sub(at(Math.max(0, i - 1), j));
    const dj = at(i, Math.min(nc - 1, j + 1)).sub(at(i, Math.max(0, j - 1)));
    return di.cross(dj).normalize();
  };
  for (const side of [1, -1]) {
    for (let i = 0; i < nr; i++) {
      for (let j = 0; j < nc; j++) {
        const p = at(i, j).addScaledVector(nrm(i, j), (side * thickness) / 2);
        pos.push(p.x, p.y, p.z);
      }
    }
  }
  const face = (base: number, flip: boolean) => {
    for (let i = 0; i < nr - 1; i++) {
      for (let j = 0; j < nc - 1; j++) {
        const a = base + i * nc + j;
        const b = a + 1;
        const c = a + nc;
        const d = c + 1;
        if (flip) idx.push(a, b, c, b, d, c);
        else idx.push(a, c, b, b, c, d);
      }
    }
  };
  face(0, false);
  face(nr * nc, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
