import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  SLICE_MARGIN,
  patchForCut,
  setCut,
  sliceKeeps,
  slicePlane,
  type SliceAxis,
} from '../../src/render/materials/sliceCut';
import { createPartMaterial } from '../../src/render/anatomy/detail/PartMaterial';
import { Rng } from '../../src/sim/core/rng';

/**
 * THE SLICE PLANE, AS ARITHMETIC. The shader's discard is the same inequality as
 * `sliceKeeps`, so what is checked here is what the GPU will do, minus the rasteriser.
 * Points are sampled on the organ's bounding sphere, which is the sphere the depth is
 * measured across: depth 0 must leave every one on the kept side, depth 1 none, and depth
 * 0.5 must pass through the centre.
 */

const AXES: SliceAxis[] = ['front', 'side', 'top'];
const CENTRE = { x: -0.07, y: 0.21, z: 0.03 };
const RADIUS = 0.058;

function spherePoints(n: number): THREE.Vector3[] {
  const rng = new Rng(0x51ce);
  const out: THREE.Vector3[] = [];
  // The six poles are on the list on purpose: they are the points depth 0 and 1 graze.
  for (const [x, y, z] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    out.push(new THREE.Vector3(CENTRE.x + x * RADIUS, CENTRE.y + y * RADIUS, CENTRE.z + z * RADIUS));
  }
  while (out.length < n) {
    const v = new THREE.Vector3(rng.next() - 0.5, rng.next() - 0.5, rng.next() - 0.5);
    if (v.lengthSq() < 1e-6) continue;
    v.normalize().multiplyScalar(RADIUS).add(new THREE.Vector3(CENTRE.x, CENTRE.y, CENTRE.z));
    out.push(v);
  }
  return out;
}

describe('slice plane', () => {
  for (const axis of AXES) {
    it(`${axis}: depth 0 keeps the whole sphere and depth 1 keeps none`, () => {
      const points = spherePoints(500);
      const none = slicePlane(axis, 0, CENTRE, RADIUS);
      const all = slicePlane(axis, 1, CENTRE, RADIUS);
      for (const p of points) {
        expect(sliceKeeps(none, p.x, p.y, p.z)).toBe(true);
        expect(sliceKeeps(all, p.x, p.y, p.z)).toBe(false);
      }
    });

    it(`${axis}: depth 0.5 passes through the centre`, () => {
      const half = slicePlane(axis, 0.5, CENTRE, RADIUS);
      const dot = half.nx * CENTRE.x + half.ny * CENTRE.y + half.nz * CENTRE.z;
      expect(half.w).toBeCloseTo(dot, 12);
      // The centre sits ON the plane, and the plane splits the sphere about evenly.
      expect(sliceKeeps(half, CENTRE.x, CENTRE.y, CENTRE.z)).toBe(true);
      const points = spherePoints(2000);
      const kept = points.filter((p) => sliceKeeps(half, p.x, p.y, p.z)).length;
      expect(kept / points.length).toBeGreaterThan(0.4);
      expect(kept / points.length).toBeLessThan(0.6);
    });

    it(`${axis}: the kept share falls monotonically with depth`, () => {
      const points = spherePoints(600);
      let previous = points.length + 1;
      for (let i = 0; i <= 10; i++) {
        const plane = slicePlane(axis, i / 10, CENTRE, RADIUS);
        const kept = points.filter((p) => sliceKeeps(plane, p.x, p.y, p.z)).length;
        expect(kept).toBeLessThanOrEqual(previous);
        previous = kept;
      }
    });
  }

  it('removes the front first for front, the patient\'s left (scene +x) for side, the top for top', () => {
    const quarter = (axis: SliceAxis) => slicePlane(axis, 0.75, CENTRE, RADIUS);
    const front = quarter('front');
    expect(sliceKeeps(front, CENTRE.x, CENTRE.y, CENTRE.z + RADIUS * 0.9)).toBe(false);
    expect(sliceKeeps(front, CENTRE.x, CENTRE.y, CENTRE.z - RADIUS * 0.9)).toBe(true);
    const side = quarter('side');
    expect(sliceKeeps(side, CENTRE.x + RADIUS * 0.9, CENTRE.y, CENTRE.z)).toBe(false);
    expect(sliceKeeps(side, CENTRE.x - RADIUS * 0.9, CENTRE.y, CENTRE.z)).toBe(true);
    const top = quarter('top');
    expect(sliceKeeps(top, CENTRE.x, CENTRE.y + RADIUS * 0.9, CENTRE.z)).toBe(false);
    expect(sliceKeeps(top, CENTRE.x, CENTRE.y - RADIUS * 0.9, CENTRE.z)).toBe(true);
  });

  it('clamps a depth outside 0..1 or not finite', () => {
    const a = slicePlane('top', -3, CENTRE, RADIUS);
    const b = slicePlane('top', 0, CENTRE, RADIUS);
    expect(a.w).toBe(b.w);
    const c = slicePlane('top', 7, CENTRE, RADIUS);
    const d = slicePlane('top', 1, CENTRE, RADIUS);
    expect(c.w).toBe(d.w);
    expect(slicePlane('top', Number.NaN, CENTRE, RADIUS).w).toBe(b.w);
    expect(SLICE_MARGIN).toBeGreaterThan(1);
  });
});

describe('cut material', () => {
  it('splices the discard in once, owns its uniforms, and is off until asked', () => {
    const m = createPartMaterial({ color: 0xff0000 });
    const cut = m.userData.cut;
    expect(cut).toBeDefined();
    expect(patchForCut(m)).toBe(cut);
    expect(m.fragmentShader.match(/discard/g)?.length).toBe(1);
    expect(m.uniforms.uCutOn.value).toBe(0);
    const other = createPartMaterial();
    expect(other.userData.cut).not.toBe(cut);
    setCut(cut, { nx: 0, ny: 0, nz: 1, w: 0.2 });
    expect(m.uniforms.uCutOn.value).toBe(1);
    expect(other.uniforms.uCutOn.value).toBe(0);
    setCut(cut, null);
    expect(m.uniforms.uCutOn.value).toBe(0);
  });
});
