import * as THREE from 'three';
import { tubeAlong, type V3 } from '../sdf';

/**
 * SHARED HELPERS FOR THE FIRST-PASS (STUB) INTERIORS of the head-and-neck organs and the
 * skeleton.
 *
 * Each of those organs was scaffolded with one honest, simple primitive per named part, so
 * that the organ lists, searches, selects and shows its parts before anyone has drawn them
 * properly. Those primitives are all scaled spheres and swept tubes, and they all come from
 * here so that the ten stub files stay a few lines each. A content agent who draws an organ
 * properly deletes its import of this file; once the last stub is gone this file can go too.
 * Nothing here is anatomy: the sizes and places are chosen by the files that call it.
 */

/** A scaled sphere with an index and normals, like `polygonise` output. */
export function blob(c: V3, r: V3, w = 12, h = 8): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, w, h);
  g.deleteAttribute('uv');
  g.scale(r[0], r[1], r[2]);
  g.translate(c[0], c[1], c[2]);
  return g;
}

/** A tube of constant radius along a smooth path. */
export function rod(points: readonly V3[], radius: number, tubular = 12, radial = 6): THREE.BufferGeometry {
  return tubeAlong(points, () => radius, { tubular, radial });
}

/** A closed loop (an ellipse seen from above) of constant radius, in the plane y = `y`. */
export function ringAt(y: number, halfX: number, halfZ: number, radius: number): THREE.BufferGeometry {
  const pts: V3[] = [];
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([halfX * Math.cos(a), y, halfZ * Math.sin(a)]);
  }
  return tubeAlong(pts, () => radius, { tubular: 28, radial: 4, closed: true });
}

/** Both sides of a pair: `make(+1)` and `make(-1)` merged into one geometry. */
export function bothSides(make: (side: number) => THREE.BufferGeometry[]): THREE.BufferGeometry[] {
  return [...make(1), ...make(-1)];
}
