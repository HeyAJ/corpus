import * as THREE from 'three';
import { triTable } from 'three/examples/jsm/objects/MarchingCubes.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * SIGNED-DISTANCE MODELLING FOR ORGANS.
 *
 * WHY THIS EXISTS. The first generation of organ geometry (`organs/placeholder.ts`) was
 * a deformed icosphere per organ: push the vertices of a ball around until its outline
 * suggests a liver. That is exactly as good as its header says - "correct in position,
 * scale, pivot and bounding sphere, wrong in every detail" - and it runs out the moment
 * a shape is not a ball. A heart is four chambers and five great vessels FUSED; a brain
 * is two hemispheres, a cerebellum and a stem; a stomach is a J; a kidney is a bean
 * with a notch cut out of it. You cannot get any of those by displacing one sphere, and
 * you cannot get them by overlapping several either, because overlapping meshes show
 * their intersections as hard internal walls through a translucent material.
 *
 * A signed-distance field solves both at once. Each shape is a function that returns
 * the distance from a point to its surface (negative inside). Combining shapes is
 * arithmetic on those numbers: the minimum of two fields is their union, and a SMOOTH
 * minimum is their union with the crease between them filleted, which is what tissue
 * looks like where two masses meet. Subtraction cuts a hilum out of a kidney. The
 * surface is then extracted once, at load, by marching cubes, into an ordinary indexed
 * triangle mesh that the existing materials draw without knowing where it came from.
 *
 * WHAT IT IS NOT. It is not a scan and it is not a traced atlas. Every shape below is
 * authored from the proportions the anatomy texts give (CREDITS.md lists them), by a
 * person choosing where an ellipsoid goes. `docs/MODEL_LIMITATIONS.md` says so. What it
 * buys is anatomy that is recognisable - lobes, fissures, chambers, a vermis - while
 * the repository keeps its rule of building from a clean checkout with no binary
 * assets and no third-party mesh licence to honour.
 *
 * DETERMINISM. A field is a pure function of position, the grid is fixed by the
 * bounds and the cell size, and marching cubes visits cells in a fixed order, so the
 * same recipe produces byte-identical buffers on every load. The render tests rely on
 * that.
 */

/** A signed distance field: metres to the surface, negative inside. */
export type Sdf = (x: number, y: number, z: number) => number;
export type V3 = readonly [number, number, number];

/* ------------------------------------------------------------- primitives */

export function sphere(c: V3, r: number): Sdf {
  const [cx, cy, cz] = c;
  return (x, y, z) => Math.hypot(x - cx, y - cy, z - cz) - r;
}

/**
 * Ellipsoid. There is no closed-form exact distance to an ellipsoid; this is Quilez's
 * bound, `k0 (k0 - 1) / k1`, which is exact on the surface and a good first-order
 * estimate near it - and "near the surface" is the only place marching cubes ever
 * looks, because it only interpolates across cells the surface passes through.
 */
export function ellipsoid(c: V3, r: V3): Sdf {
  const [cx, cy, cz] = c;
  const [rx, ry, rz] = r;
  const irx = 1 / rx;
  const iry = 1 / ry;
  const irz = 1 / rz;
  const minR = Math.min(rx, ry, rz);
  return (x, y, z) => {
    const px = (x - cx) * irx;
    const py = (y - cy) * iry;
    const pz = (z - cz) * irz;
    const k0 = Math.hypot(px, py, pz);
    // At the exact centre both k0 and k1 vanish; the point is as deep inside as it gets.
    if (k0 < 1e-9) return -minR;
    const k1 = Math.hypot(px * irx, py * iry, pz * irz);
    return (k0 * (k0 - 1)) / k1;
  };
}

/**
 * A rounded segment whose radius runs linearly from `ra` at `a` to `rb` at `b`.
 *
 * Strictly this is not the exact field of a round cone (the exact one accounts for the
 * tangent between the two end spheres); it is the field of a segment minus an
 * interpolated radius. The two differ only where the taper is steep, and every use here
 * is a vessel, a duct, a stem or a nerve - long things that taper gently.
 */
export function capsule(a: V3, b: V3, ra: number, rb = ra): Sdf {
  const [ax, ay, az] = a;
  const bax = b[0] - ax;
  const bay = b[1] - ay;
  const baz = b[2] - az;
  const len2 = bax * bax + bay * bay + baz * baz || 1e-12;
  return (x, y, z) => {
    const pax = x - ax;
    const pay = y - ay;
    const paz = z - az;
    let t = (pax * bax + pay * bay + paz * baz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(pax - bax * t, pay - bay * t, paz - baz * t) - (ra + (rb - ra) * t);
  };
}

/**
 * A chain of tapered capsules through a list of points: a duct, a bowel loop, a nerve.
 * `radii` is either one radius for the whole chain or one per point.
 */
export function chain(points: readonly V3[], radii: number | readonly number[]): Sdf {
  const segments: Sdf[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const ra = typeof radii === 'number' ? radii : radii[Math.min(i, radii.length - 1)];
    const rb = typeof radii === 'number' ? radii : radii[Math.min(i + 1, radii.length - 1)];
    segments.push(capsule(points[i], points[i + 1], ra, rb));
  }
  return union(...segments);
}

/** Torus in the plane whose normal is `axis` (0 = x, 1 = y, 2 = z). */
export function torus(c: V3, major: number, minor: number, axis: 0 | 1 | 2 = 1): Sdf {
  const [cx, cy, cz] = c;
  return (x, y, z) => {
    const px = x - cx;
    const py = y - cy;
    const pz = z - cz;
    const along = axis === 0 ? px : axis === 1 ? py : pz;
    const radial = axis === 0 ? Math.hypot(py, pz) : axis === 1 ? Math.hypot(px, pz) : Math.hypot(px, py);
    return Math.hypot(radial - major, along) - minor;
  };
}

/** A box with rounded edges, half-extents `h`, corner radius `round`. */
export function roundBox(c: V3, h: V3, round: number): Sdf {
  const [cx, cy, cz] = c;
  return (x, y, z) => {
    const qx = Math.abs(x - cx) - h[0] + round;
    const qy = Math.abs(y - cy) - h[1] + round;
    const qz = Math.abs(z - cz) - h[2] + round;
    const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
    return outside + Math.min(Math.max(qx, qy, qz), 0) - round;
  };
}

/** The half-space on the far side of a plane through `point` with unit-ish `normal`. */
export function halfSpace(point: V3, normal: V3): Sdf {
  const len = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  const nx = normal[0] / len;
  const ny = normal[1] / len;
  const nz = normal[2] / len;
  const d = point[0] * nx + point[1] * ny + point[2] * nz;
  // Negative (inside) where the point lies in the direction the normal points.
  return (x, y, z) => d - (x * nx + y * ny + z * nz);
}

/** A flat slab of the given half-thickness about a plane: what a fissure is cut with. */
export function slab(point: V3, normal: V3, halfThickness: number): Sdf {
  const len = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  const nx = normal[0] / len;
  const ny = normal[1] / len;
  const nz = normal[2] / len;
  const d = point[0] * nx + point[1] * ny + point[2] * nz;
  return (x, y, z) => Math.abs(x * nx + y * ny + z * nz - d) - halfThickness;
}

/* -------------------------------------------------------------- operators */

export function union(...fields: Sdf[]): Sdf {
  if (fields.length === 1) return fields[0];
  return (x, y, z) => {
    let d = Infinity;
    for (let i = 0; i < fields.length; i++) {
      const v = fields[i](x, y, z);
      if (v < d) d = v;
    }
    return d;
  };
}

/**
 * Union with the crease filleted over a blend radius of about `k` metres.
 *
 * The polynomial smooth minimum. Where two fields are further apart than `k` it is the
 * plain minimum; inside that band it dips below both, which is what rounds the join.
 * This is the single operator that makes a heart out of four ellipsoids and five tubes
 * instead of four ellipsoids and five tubes.
 */
export function smoothUnion(k: number, ...fields: Sdf[]): Sdf {
  if (fields.length === 1) return fields[0];
  const ik = 1 / k;
  return (x, y, z) => {
    let d = fields[0](x, y, z);
    for (let i = 1; i < fields.length; i++) {
      const v = fields[i](x, y, z);
      const h = Math.max(k - Math.abs(d - v), 0) * ik;
      d = Math.min(d, v) - h * h * k * 0.25;
    }
    return d;
  };
}

/** `a` with `b` cut out of it. */
export function subtract(a: Sdf, b: Sdf): Sdf {
  return (x, y, z) => Math.max(a(x, y, z), -b(x, y, z));
}

/** `a` with `b` cut out of it, the cut edge rounded over about `k` metres. */
export function smoothSubtract(k: number, a: Sdf, b: Sdf): Sdf {
  const ik = 1 / k;
  return (x, y, z) => {
    const da = a(x, y, z);
    const db = -b(x, y, z);
    const h = Math.max(k - Math.abs(da - db), 0) * ik;
    return Math.max(da, db) + h * h * k * 0.25;
  };
}

export function intersect(a: Sdf, b: Sdf): Sdf {
  return (x, y, z) => Math.max(a(x, y, z), b(x, y, z));
}

/** Grow (positive) or shrink (negative) a shape by a constant offset. */
export function offset(a: Sdf, amount: number): Sdf {
  return (x, y, z) => a(x, y, z) - amount;
}

/** A hollow shell of the given wall thickness, centred on the original surface. */
export function shell(a: Sdf, thickness: number): Sdf {
  return (x, y, z) => Math.abs(a(x, y, z)) - thickness * 0.5;
}

/** Add a displacement field to a shape: gyri, haustra, lobules. */
export function displaced(a: Sdf, displacement: Sdf): Sdf {
  return (x, y, z) => a(x, y, z) + displacement(x, y, z);
}

/**
 * As `displaced`, but the displacement is evaluated only within `band` metres of the
 * undisplaced surface.
 *
 * Surface texture - sulci, lobules - is the expensive part of a field (it is noise, and
 * noise is a dozen hashes a sample) and it only matters where the surface is. Away
 * from it the sign of the base field is already the answer. `band` must exceed the
 * largest displacement plus about two grid cells, or a cell that straddles the surface
 * could see the textured field on one corner and the bare one on another.
 */
export function displacedNear(a: Sdf, displacement: Sdf, band: number): Sdf {
  return (x, y, z) => {
    const d = a(x, y, z);
    return d > band || d < -band ? d : d + displacement(x, y, z);
  };
}

/** Evaluate `a` in a frame translated by `t`. */
export function translated(a: Sdf, t: V3): Sdf {
  return (x, y, z) => a(x - t[0], y - t[1], z - t[2]);
}

/**
 * Evaluate `a` in a frame rotated by intrinsic XYZ Euler angles (the same convention
 * three.js uses for `Object3D.rotation`), so a shape authored upright can be tilted the
 * way the organ lies in the body without re-deriving every control point.
 */
export function rotated(a: Sdf, euler: V3): Sdf {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(euler[0], euler[1], euler[2], 'XYZ'));
  // The inverse of a rotation is its transpose; evaluating the field at R^-1 p rotates it by R.
  const e = m.elements;
  const r00 = e[0], r01 = e[1], r02 = e[2];
  const r10 = e[4], r11 = e[5], r12 = e[6];
  const r20 = e[8], r21 = e[9], r22 = e[10];
  return (x, y, z) => a(r00 * x + r01 * y + r02 * z, r10 * x + r11 * y + r12 * z, r20 * x + r21 * y + r22 * z);
}

/** Mirror a shape authored for x >= 0 across the sagittal plane: both of a paired organ. */
export function mirroredX(a: Sdf): Sdf {
  return (x, y, z) => a(Math.abs(x), y, z);
}

/* ------------------------------------------------------- surface extraction */

export interface PolygoniseOptions {
  /** Grid cell edge, metres. The smallest feature that survives is about two cells. */
  cell: number;
  /** Extra margin added round the bounds, in cells, so the surface never touches the grid edge. */
  pad?: number;
  /** Refuse to build a grid larger than this many cells; the cell size is raised to fit. */
  maxCells?: number;
}

const TRI = triTable as unknown as Int32Array;

/** The two corner indices each of a cube's twelve edges joins (Bourke's numbering). */
const EDGE_CORNERS: readonly [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

/** Corner offsets in (i, j, k), in Bourke's corner order. */
const CORNER: readonly [number, number, number][] = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];

/**
 * Each cube edge as a GRID edge: the grid vertex it starts from (as an offset from the
 * cell's own corner) and the axis it runs along. Two cells that share an edge compute
 * the same (vertex, axis) pair for it, which is what lets the vertex be created once
 * and shared - an indexed, watertight mesh instead of a soup of triangles.
 */
const EDGE_GRID: readonly [number, number, number, number][] = [
  [0, 0, 0, 0], [1, 0, 0, 1], [0, 1, 0, 0], [0, 0, 0, 1],
  [0, 0, 1, 0], [1, 0, 1, 1], [0, 1, 1, 0], [0, 0, 1, 1],
  [0, 0, 0, 2], [1, 0, 0, 2], [1, 1, 0, 2], [0, 1, 0, 2],
];

/**
 * Extract the zero surface of a field as an indexed mesh with smooth normals.
 *
 * MARCHING CUBES, WELDED. The field is sampled once at every grid vertex; each cell
 * whose corners straddle zero contributes up to five triangles from the standard
 * 256-case table; each triangle corner sits on a cell edge at the linear zero crossing.
 * Vertices are welded per grid edge, so adjacent triangles share them.
 *
 * NORMALS COME FROM THE FIELD, NOT FROM THE TRIANGLES. The gradient of a distance field
 * is its surface normal, exactly, at any point - so each vertex gets the normal of the
 * true surface rather than an average of the facets around it. The absorption material
 * reads form entirely from `N.V` at the silhouette (materials/OrganAbsorption.ts), so a
 * faceted normal shows as banding at exactly the place the eye is looking; a field
 * normal does not, even on a coarse grid. That is what lets these grids stay small.
 */
export function polygonise(field: Sdf, min: V3, max: V3, options: PolygoniseOptions): THREE.BufferGeometry {
  const pad = options.pad ?? 2;
  let cell = options.cell;
  const maxCells = options.maxCells ?? 420000;

  // Raise the cell size until the grid fits the budget. A shape authored at a bad scale
  // should come out coarse rather than freeze the page for ten seconds.
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let guard = 0; guard < 24; guard++) {
    nx = Math.max(2, Math.ceil((max[0] - min[0]) / cell) + pad * 2);
    ny = Math.max(2, Math.ceil((max[1] - min[1]) / cell) + pad * 2);
    nz = Math.max(2, Math.ceil((max[2] - min[2]) / cell) + pad * 2);
    if (nx * ny * nz <= maxCells) break;
    cell *= 1.12;
  }

  const ox = min[0] - pad * cell;
  const oy = min[1] - pad * cell;
  const oz = min[2] - pad * cell;

  const vx = nx + 1;
  const vy = ny + 1;
  const vz = nz + 1;
  const stride = vx * vy;

  // --- sample --------------------------------------------------------------
  const values = new Float32Array(vx * vy * vz);
  for (let k = 0; k < vz; k++) {
    const z = oz + k * cell;
    for (let j = 0; j < vy; j++) {
      const y = oy + j * cell;
      const row = k * stride + j * vx;
      for (let i = 0; i < vx; i++) {
        values[row + i] = field(ox + i * cell, y, z);
      }
    }
  }

  // --- march ---------------------------------------------------------------
  // One slot per (grid vertex, axis): the index of the mesh vertex on that grid edge.
  const edgeVertex = new Int32Array(values.length * 3).fill(-1);
  const positions: number[] = [];
  const indices: number[] = [];
  const cornerValue = new Float64Array(8);
  const cellEdge = new Int32Array(12);

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        let cubeIndex = 0;
        for (let c = 0; c < 8; c++) {
          const o = CORNER[c];
          const v = values[(k + o[2]) * stride + (j + o[1]) * vx + (i + o[0])];
          cornerValue[c] = v;
          if (v < 0) cubeIndex |= 1 << c;
        }
        if (cubeIndex === 0 || cubeIndex === 255) continue;

        const row = cubeIndex * 16;
        for (let t = 0; t < 16 && TRI[row + t] !== -1; t++) {
          const e = TRI[row + t];
          const g = EDGE_GRID[e];
          const gridVertex = (k + g[2]) * stride + (j + g[1]) * vx + (i + g[0]);
          const slot = gridVertex * 3 + g[3];
          let index = edgeVertex[slot];
          if (index === -1) {
            const [a, b] = EDGE_CORNERS[e];
            const va = cornerValue[a];
            const vb = cornerValue[b];
            // Linear zero crossing along the edge. The two values have opposite signs,
            // so the denominator cannot vanish unless both are exactly zero.
            const denom = va - vb;
            const f = Math.abs(denom) > 1e-12 ? va / denom : 0.5;
            const ca = CORNER[a];
            const cb = CORNER[b];
            positions.push(
              ox + (i + ca[0] + (cb[0] - ca[0]) * f) * cell,
              oy + (j + ca[1] + (cb[1] - ca[1]) * f) * cell,
              oz + (k + ca[2] + (cb[2] - ca[2]) * f) * cell,
            );
            index = positions.length / 3 - 1;
            edgeVertex[slot] = index;
          }
          cellEdge[t % 3] = index;
          if (t % 3 === 2) indices.push(cellEdge[0], cellEdge[1], cellEdge[2]);
        }
      }
    }
  }

  // --- normals from the field gradient -------------------------------------
  const count = positions.length / 3;
  const normals = new Float32Array(count * 3);
  const eps = cell * 0.5;
  for (let v = 0; v < count; v++) {
    const x = positions[v * 3];
    const y = positions[v * 3 + 1];
    const z = positions[v * 3 + 2];
    let gx = field(x + eps, y, z) - field(x - eps, y, z);
    let gy = field(x, y + eps, z) - field(x, y - eps, z);
    let gz = field(x, y, z + eps) - field(x, y, z - eps);
    const len = Math.hypot(gx, gy, gz);
    if (len > 1e-12) {
      gx /= len;
      gy /= len;
      gz /= len;
    } else {
      gx = 0;
      gy = 1;
      gz = 0;
    }
    normals[v * 3] = gx;
    normals[v * 3 + 1] = gy;
    normals[v * 3 + 2] = gz;
  }

  // --- winding -------------------------------------------------------------
  // The case table's winding depends on which side of zero is called "inside", and the
  // convention is easy to get backwards. Rather than trust it, compare one triangle's
  // geometric normal with the field's and flip everything if they disagree. The
  // materials are double-sided so the picture would be right either way; what this
  // protects is anything that later culls back faces.
  if (indices.length >= 3) {
    let agree = 0;
    const samples = Math.min(64, indices.length / 3);
    const step = Math.max(1, Math.floor(indices.length / 3 / samples));
    for (let s = 0; s < samples; s++) {
      const t = s * step * 3;
      const a = indices[t] * 3;
      const b = indices[t + 1] * 3;
      const c = indices[t + 2] * 3;
      const ux = positions[b] - positions[a];
      const uy = positions[b + 1] - positions[a + 1];
      const uz = positions[b + 2] - positions[a + 2];
      const wx = positions[c] - positions[a];
      const wy = positions[c + 1] - positions[a + 1];
      const wz = positions[c + 2] - positions[a + 2];
      const fx = uy * wz - uz * wy;
      const fy = uz * wx - ux * wz;
      const fz = ux * wy - uy * wx;
      agree += fx * normals[a] + fy * normals[a + 1] + fz * normals[a + 2] > 0 ? 1 : -1;
    }
    if (agree < 0) {
      for (let t = 0; t < indices.length; t += 3) {
        const tmp = indices[t + 1];
        indices[t + 1] = indices[t + 2];
        indices[t + 2] = tmp;
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(count > 65535 ? new THREE.BufferAttribute(new Uint32Array(indices), 1) : new THREE.BufferAttribute(new Uint16Array(indices), 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

/* ------------------------------------------------------------------ tubes */

/**
 * A tube along a smooth curve through `points`, with a radius that varies along it.
 *
 * For anything long and thin - a bronchus, a ureter, a nerve, a loop of bowel - a swept
 * tube is both cheaper and cleaner than polygonising a chain of capsules: the grid a
 * 1.5 mm duct would need is hundreds of cells on a side. `radius` is a function of the
 * fraction along the curve (and of the point there, for a calibre that depends on where
 * in the body it is), so one call makes a tapering airway or a haustrated colon.
 */
export function tubeAlong(
  points: readonly V3[],
  radius: (t: number, point: THREE.Vector3) => number,
  options: { tubular?: number; radial?: number; tension?: number; closed?: boolean } = {},
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
    options.closed ?? false,
    'catmullrom',
    options.tension ?? 0.5,
  );
  const tubular = options.tubular ?? Math.max(16, points.length * 10);
  const radial = options.radial ?? 10;
  const geometry = new THREE.TubeGeometry(curve, tubular, 1, radial, options.closed ?? false);

  // TubeGeometry builds a unit-radius tube; scale each ring about its own centre.
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const centre = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    curve.getPointAt(Math.min(1, t), centre);
    const r = Math.max(1e-5, radius(t, centre));
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, idx).sub(centre).multiplyScalar(r).add(centre);
      pos.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  pos.needsUpdate = true;
  geometry.deleteAttribute('uv');
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Bounds of a list of points, padded: the box to polygonise a chain or a cluster in. */
export function boundsOf(points: readonly V3[], padding: number): { min: V3; max: V3 } {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity;
  let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const p of points) {
    if (p[0] < x0) x0 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[2] < z0) z0 = p[2];
    if (p[0] > x1) x1 = p[0];
    if (p[1] > y1) y1 = p[1];
    if (p[2] > z1) z1 = p[2];
  }
  return { min: [x0 - padding, y0 - padding, z0 - padding], max: [x1 + padding, y1 + padding, z1 + padding] };
}

/**
 * Join several geometries (extracted surfaces, tubes) into one mesh's worth of buffers,
 * disposing of the inputs. Everything this toolkit produces carries positions, normals
 * and an index; the tubes also arrive with texture coordinates nothing here uses, which
 * are dropped so the parts agree on their attributes.
 */
export function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (parts.length === 0) throw new Error('anatomy: nothing to merge');
  for (const g of parts) if (g.getAttribute('uv')) g.deleteAttribute('uv');
  const merged = parts.length === 1 ? parts[0].clone() : mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  if (!merged) throw new Error('anatomy: could not merge geometries');
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
}
