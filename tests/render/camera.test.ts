import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  BODY_CENTRE_Y,
  DOUBLE_TAP_ZOOM,
  HOME_AZIMUTH,
  HOME_POLAR,
  OrbitRig,
  PAN_HALF_EXTENTS,
  PAN_MARGIN,
  clampToPanBounds,
  doubleTapDistance,
} from '../../src/render/camera/OrbitRig';
import { Rng } from '../../src/sim/core/rng';

/**
 * THE CAMERA RIG'S NEW CONTROLS, WITHOUT A GL CONTEXT. OrbitRig is plain three.js maths
 * (a PerspectiveCamera and some vectors), so pan, reset and the double-tap distance can be
 * driven directly. The rendered gestures (mouse, touch) are checked in a browser; what is
 * checked here is the arithmetic those gestures end in.
 */

function inBounds(v: THREE.Vector3): boolean {
  const e = 1e-9;
  return (
    Math.abs(v.x) <= PAN_HALF_EXTENTS.x + PAN_MARGIN + e &&
    Math.abs(v.y - BODY_CENTRE_Y) <= PAN_HALF_EXTENTS.y + PAN_MARGIN + e &&
    Math.abs(v.z) <= PAN_HALF_EXTENTS.z + PAN_MARGIN + e
  );
}

describe('pan', () => {
  it('keeps the target inside the body bounds plus the margin for any drag', () => {
    const rng = new Rng(0xc4a3);
    const rig = new OrbitRig(1.6);
    for (let i = 0; i < 400; i++) {
      // Drags far larger than the canvas, from any viewing angle and distance.
      rig.orbit((rng.next() - 0.5) * 0.6, (rng.next() - 0.5) * 0.6);
      rig.update(16);
      rig.pan((rng.next() - 0.5) * 40, (rng.next() - 0.5) * 40);
      expect(inBounds(rig.target)).toBe(true);
    }
  });

  it('moves the target in the camera plane, content following the finger', () => {
    const rig = new OrbitRig(1);
    rig.update(16);
    const before = rig.target.clone();
    rig.pan(0.1, 0);
    // Dragging right moves the content right, so the target moves left of the camera: -x here.
    expect(rig.target.x).toBeLessThan(before.x);
    expect(rig.target.y).toBeCloseTo(before.y, 9);
    expect(rig.target.z).toBeCloseTo(before.z, 9);
  });

  it('ignores a non-finite drag', () => {
    const rig = new OrbitRig(1);
    const before = rig.target.clone();
    rig.pan(Number.NaN, 1);
    expect(rig.target.equals(before)).toBe(true);
  });

  it('clampToPanBounds is the identity inside the box', () => {
    const v = new THREE.Vector3(0.1, BODY_CENTRE_Y + 0.2, -0.1);
    expect(clampToPanBounds(v.clone()).equals(v)).toBe(true);
  });
});

describe('resetView', () => {
  it('returns exactly the home pose and clears the pan, from any state', () => {
    const rng = new Rng(77);
    const rig = new OrbitRig(1.2);
    rig.update(16);
    const homeDistance = rig.currentDistance;
    for (let i = 0; i < 20; i++) {
      rig.orbit((rng.next() - 0.5) * 2, (rng.next() - 0.5) * 2);
      rig.zoomBy(0.5 + rng.next());
      rig.pan((rng.next() - 0.5) * 4, (rng.next() - 0.5) * 4);
      rig.update(16);
      expect(rig.viewAtHome).toBe(false);
      // An instant cut (reduced motion) and an animated flight must land on the same pose.
      const animated = i % 2 === 0;
      rig.reset(animated ? 600 : 0, true);
      if (animated) for (let k = 0; k < 60; k++) rig.update(16);
      else rig.update(16);
      expect(rig.viewAtHome).toBe(true);
      expect(rig.target.x).toBeCloseTo(0, 9);
      expect(rig.target.y).toBeCloseTo(BODY_CENTRE_Y, 9);
      expect(rig.target.z).toBeCloseTo(0, 9);
      expect(rig.currentDistance).toBeCloseTo(homeDistance, 9);
      expect(rig.currentAzimuth).toBeCloseTo(HOME_AZIMUTH, 9);
      expect(rig.currentPolar).toBeCloseTo(HOME_POLAR, 9);
    }
  });

  it('reports a flip of viewAtHome exactly once per change', () => {
    const rig = new OrbitRig(1);
    const seen: boolean[] = [];
    rig.onHomeChanged = (h) => seen.push(h);
    rig.update(16);
    expect(seen).toEqual([]);
    rig.orbit(0.1, 0);
    rig.update(16);
    rig.update(16);
    rig.pan(0.1, 0.1);
    rig.update(16);
    expect(seen).toEqual([false]);
    rig.reset(0, true);
    rig.update(16);
    expect(seen).toEqual([false, true]);
  });
});

describe('double-tap zoom', () => {
  it('closes to 55 % of the distance and never goes under minDistance', () => {
    expect(doubleTapDistance(2, 0.07)).toBeCloseTo(2 * DOUBLE_TAP_ZOOM, 12);
    for (const d of [0.01, 0.07, 0.08, 0.1, 0.127, 0.5, 3.6]) {
      expect(doubleTapDistance(d, 0.07)).toBeGreaterThanOrEqual(0.07);
    }
    const rig = new OrbitRig(1.5);
    for (let i = 0; i < 30; i++) {
      rig.flyTo(new THREE.Vector3(0, BODY_CENTRE_Y, 0), rig.doubleTapTarget, 0, 0);
      rig.update(16);
      expect(rig.currentDistance).toBeGreaterThanOrEqual(rig.limits.minDistance - 1e-12);
    }
    expect(rig.currentDistance).toBeCloseTo(rig.limits.minDistance, 9);
  });

  it('clamps the point it flies to', () => {
    const rig = new OrbitRig(1);
    rig.flyTo(new THREE.Vector3(9, 9, 9), 1, 0, 0);
    expect(inBounds(rig.target)).toBe(true);
  });
});
