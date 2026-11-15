import * as THREE from 'three';
import type { PartBuilder } from '../parts';
import { ellipsoid, mergeParts, polygonise, smoothUnion, tubeAlong, type V3 } from '../sdf';
import { mulberry32 } from '../noise';

/**
 * INTERIOR OF THE THYMUS. The shell in models.ts is two lobes (centres x = +-11 mm, y +2 mm
 * on the right and -2 mm on the left, radii 13 x 30 x 6.5 mm) lying in the front of the
 * upper chest. Every part is a smaller copy of those lobes, nested like an onion: capsule,
 * lobe, cortex, medulla.
 *
 * AN ADULT THYMUS IS LARGELY INVOLUTED. The gland is at its largest in childhood; after
 * puberty most of its lymphoid tissue is gradually replaced by fat, though some functioning
 * tissue persists. This atlas draws the organ in its textbook, active form, as an anatomy
 * plate does, and its words say so; the simulator does not model involution.
 *
 * SEPTA ARE DRAWN AS CORDS. Real septa are fibrous partitions that run in from the capsule
 * and divide the cortex into lobules. Thin plates would cost thousands of triangles on a
 * grid this coarse, so each is a short spoke from the capsule inwards to the edge of the
 * medulla, in a fixed pattern. Glass: capsule, lobes, cortex, vessels. Solid: medulla,
 * corpuscles, septa. No physiological numbers are involved.
 */

const LOBE = (s: number): V3 => [s * 0.011, s > 0 ? 0.002 : -0.002, 0];
const R: V3 = [0.013, 0.03, 0.0065];

/** Artery and vein centrelines for one lobe (s = +1 patient's right). Exported for the flows. */
export function thymusPaths(s: number): { artery: V3[]; vein: V3[] } {
  const c = LOBE(s);
  const at = (dx: number, dy: number, dz: number): V3 => [c[0] + s * dx, c[1] + dy, dz];
  return {
    artery: [at(0.009, -0.014, -0.002), at(0.003, -0.01, -0.0025), at(0, -0.003, -0.0015), at(-0.001, 0.006, 0)],
    vein: [at(0, 0.006, 0), at(0, 0.016, -0.001), at(-0.002, 0.025, -0.002)],
  };
}

function bead(c: V3, r: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, 6, 4);
  g.translate(c[0], c[1], c[2]);
  return g;
}

export const parts: PartBuilder = () => {
  const cell = 0.0017;
  const lobeBox = (s: number): [V3, V3] => {
    const c = LOBE(s);
    return [[c[0] - 0.015, c[1] - 0.032, -0.008], [c[0] + 0.015, c[1] + 0.032, 0.008]];
  };
  const lobeAt = (s: number, f: V3) => ellipsoid(LOBE(s), [R[0] * f[0], R[1] * f[1], R[2] * f[2]]);
  const perLobe = (f: V3, cl: number) => mergeParts([1, -1].map((s) => {
    const [mn, mx] = lobeBox(s);
    return polygonise(lobeAt(s, f), mn, mx, { cell: cl });
  }));

  const capsuleField = smoothUnion(0.006, lobeAt(1, [0.94, 0.975, 0.88]), lobeAt(-1, [0.94, 0.975, 0.88]));

  const rnd = mulberry32(0x7a55a1);
  const corpuscles: THREE.BufferGeometry[] = [];
  const septa: THREE.BufferGeometry[] = [];
  const vessels: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    const c = LOBE(s);
    // Hassall's corpuscles: scattered through the medulla.
    for (let i = 0; i < 18; i++) {
      let x = 0, y = 0, z = 0;
      for (let g = 0; g < 40; g++) {
        x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1;
        if (x * x + y * y + z * z <= 1) break;
      }
      corpuscles.push(bead([c[0] + x * 0.0055 * 0.6, c[1] + y * 0.024 * 0.75, z * 0.0022 * 0.55], 0.0006 + 0.0003 * rnd()));
    }
    // Septa: spokes at five levels up the lobe, lateral, front and back, capsule to medulla edge.
    for (const yf of [-0.6, -0.3, 0, 0.3, 0.6]) {
      const ring = Math.sqrt(1 - yf * yf);
      for (const a of [0, Math.PI / 2, (3 * Math.PI) / 2]) {
        const p = (n: number): V3 => [c[0] + s * R[0] * n * ring * Math.cos(a), c[1] + R[1] * yf, R[2] * n * ring * Math.sin(a)];
        septa.push(tubeAlong([p(0.85), p(0.55)], () => 0.0004, { tubular: 4, radial: 4 }));
      }
    }
    const v = thymusPaths(s);
    vessels.push(tubeAlong(v.artery, () => 0.0007, { tubular: 14, radial: 6 }), tubeAlong(v.vein, () => 0.0008, { tubular: 12, radial: 6 }));
  }

  const [bmin, bmax]: [V3, V3] = [[-0.028, -0.036, -0.008], [0.028, 0.036, 0.008]];
  return [
    { id: 'right_lobe', geometry: polygonise(lobeAt(1, [0.87, 0.93, 0.75]), ...lobeBox(1), { cell }) },
    { id: 'left_lobe', geometry: polygonise(lobeAt(-1, [0.87, 0.93, 0.75]), ...lobeBox(-1), { cell }) },
    { id: 'capsule', geometry: polygonise(capsuleField, bmin, bmax, { cell }) },
    { id: 'cortex', geometry: perLobe([0.75, 0.86, 0.55], cell) },
    { id: 'medulla', geometry: perLobe([0.42, 0.8, 0.34], 0.0013) },
    { id: 'thymic_corpuscles', geometry: mergeParts(corpuscles) },
    { id: 'septa', geometry: mergeParts(septa) },
    { id: 'vessels', geometry: mergeParts(vessels) },
  ];
};
