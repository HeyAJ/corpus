import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ORGAN_DEFS, organPosition, warpPoint } from '../../src/render/anatomy/layout';
import { buildModel } from '../../src/render/anatomy/models';
import { buildCentrelines } from '../../src/render/vascular/centrelines';
import { organSamples } from '../../src/render/body/organSamples';
import { outlineModel, SAMPLE_STRIDE, type OutlineBody } from '../../src/render/body/outlineModel';
import { buildOutline, OUTLINE_MAX_TRIANGLES } from '../../src/render/body/outlineMesh';
import type { OrganDef } from '../../src/data/types';

/**
 * THE GLASS FIGURE ENCLOSES THE BODY IT IS DRAWN AROUND.
 *
 * A body outline through which an organ pokes is the one bug anyone would see at once,
 * so this test states the contract in the field itself, with no GL: for a male body, a
 * non-pregnant female body and a pregnant one at 12, 28 and 40 weeks, the signed field
 * is negative (inside) at every organ's centre, at every vertex of every organ shell the
 * body has, and at every vessel centreline point; at 40 weeks it encloses every vertex of
 * the gravid uterus; and it is a pure function (two calls, identical values).
 *
 * The samples handed to the model are built exactly as the Viewer builds them: the
 * fetus is left out always, and the uterus is left out while the body is pregnant at
 * six weeks or more (the model draws its own gravid uterus from `gravidBody`). So the
 * assertions on the uterus's real mesh are the check that the model's own uterus is as
 * big as the one on screen.
 */

const BODIES: { name: string; body: OutlineBody }[] = [
  { name: 'male', body: { sex: 'male', weeks: 0 } },
  { name: 'female', body: { sex: 'female', weeks: 0 } },
  { name: 'female, 12 weeks', body: { sex: 'female', weeks: 12 } },
  { name: 'female, 28 weeks', body: { sex: 'female', weeks: 28 } },
  { name: 'female, 40 weeks', body: { sex: 'female', weeks: 40 } },
];

const shellCache = new Map<string, THREE.BufferGeometry>();
function shell(def: OrganDef, weeks: number): THREE.BufferGeometry {
  const key = `${def.id}@${def.id === 'uterus' || def.id === 'fetus' ? weeks : 0}`;
  let g = shellCache.get(key);
  if (!g) {
    g = buildModel(def.id, { gestationWeeks: def.id === 'uterus' || def.id === 'fetus' ? weeks : 0 });
    shellCache.set(key, g);
  }
  return g;
}

function organsOf(body: OutlineBody): OrganDef[] {
  return ORGAN_DEFS.filter((d) => {
    if (d.sex && d.sex !== body.sex) return false;
    if (d.pregnancyOnly) return body.weeks >= 8;
    return true;
  });
}

function samplesOf(body: OutlineBody): Float32Array {
  const parts: Float32Array[] = [];
  for (const def of organsOf(body)) {
    if (def.id === 'fetus') continue;
    if (def.id === 'uterus' && body.weeks >= 6) continue;
    parts.push(organSamples(def, shell(def, body.weeks)));
  }
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Every vertex of an organ's shell, in the body frame (rotation applied as OrganSet applies it). */
function worldVertices(def: OrganDef, g: THREE.BufferGeometry): THREE.Vector3[] {
  const pos = g.getAttribute('position');
  const origin = organPosition(def);
  const m = new THREE.Matrix4();
  if (def.rotation) m.makeRotationFromEuler(new THREE.Euler(def.rotation[0], def.rotation[1], def.rotation[2], 'XYZ'));
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    if (def.rotation) v.applyMatrix4(m);
    out.push(v.add(origin));
  }
  return out;
}

describe('glass body outline', () => {
  for (const { name, body } of BODIES) {
    it(`encloses every organ and every vessel: ${name}`, { timeout: 60000 }, () => {
      const model = outlineModel(samplesOf(body), body);

      for (const def of organsOf(body)) {
        const g = shell(def, body.weeks);
        g.computeBoundingBox();
        const centre = g.boundingBox!.getCenter(new THREE.Vector3());
        if (def.rotation) {
          centre.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(def.rotation[0], def.rotation[1], def.rotation[2], 'XYZ')));
        }
        centre.add(organPosition(def));
        expect(model.field(centre.x, centre.y, centre.z), `${def.id} centre`).toBeLessThan(0);
        // The organ's own origin too (the position data files give), which for the
        // gravid uterus is the cervix, the lowest and narrowest part of the whole shape.
        const o = organPosition(def);
        expect(model.field(o.x, o.y, o.z), `${def.id} origin`).toBeLessThan(0);
        // And every vertex of its shell. The fetus is fitted inside the uterus at draw
        // time, so its raw model (which lies outside the sac before fitting) is skipped.
        if (def.id === 'fetus') continue;
        let worst = -Infinity;
        for (const v of worldVertices(def, g)) worst = Math.max(worst, model.field(v.x, v.y, v.z));
        expect(worst, `${def.id} shell`).toBeLessThan(0);
      }

      for (const c of buildCentrelines()) {
        for (const p of c.positions) {
          const w = warpPoint([p.x, p.y, p.z]);
          expect(model.field(w[0], w[1], w[2]), `vessel ${c.id}`).toBeLessThan(0);
        }
      }
    });
  }

  it('at week 40 the figure encloses the whole gravid uterus', { timeout: 60000 }, () => {
    const body: OutlineBody = { sex: 'female', weeks: 40 };
    const model = outlineModel(samplesOf(body), body);
    const uterus = ORGAN_DEFS.find((d) => d.id === 'uterus')!;
    const box = new THREE.Box3();
    for (const v of worldVertices(uterus, shell(uterus, 40))) {
      expect(model.field(v.x, v.y, v.z)).toBeLessThan(0);
      box.expandByPoint(v);
    }
    // Sanity: that really is the big uterus (fundus well above the non-pregnant one).
    expect(box.max.y - box.min.y).toBeGreaterThan(0.3);
  });

  it('the belly grows with the week: the figure is deeper at the abdomen at 40 weeks than at 12', { timeout: 60000 }, () => {
    const at = (weeks: number): number => {
      const body: OutlineBody = { sex: 'female', weeks };
      const model = outlineModel(samplesOf(body), body);
      // Furthest forward (+z) surface point at the height of the fundus's middle.
      const y = organPosition(ORGAN_DEFS.find((d) => d.id === 'uterus')!).y + 0.1;
      let z = 0;
      while (z < 0.4 && model.field(0, y, z) < 0) z += 0.002;
      return z;
    };
    expect(at(40)).toBeGreaterThan(at(12) + 0.03);
  });

  it('is a pure function: identical values and identical buffers on every call', { timeout: 60000 }, () => {
    const body: OutlineBody = { sex: 'female', weeks: 28 };
    const samples = samplesOf(body);
    const a = outlineModel(samples, body);
    const b = outlineModel(samples, body);
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 300; i++) {
      const x = (rnd() - 0.5) * 0.5;
      const y = -0.45 + rnd() * 1.1;
      const z = (rnd() - 0.5) * 0.3;
      expect(a.field(x, y, z)).toBe(b.field(x, y, z));
    }
    const m1 = buildOutline(samples, body);
    const m2 = buildOutline(samples, body);
    expect(Array.from(m1.geometry.getAttribute('position').array)).toEqual(Array.from(m2.geometry.getAttribute('position').array));
  });

  it('stays within the triangle budget for every body', { timeout: 60000 }, () => {
    for (const { body } of BODIES) {
      const built = buildOutline(samplesOf(body), body);
      expect(built.triangles).toBeGreaterThan(1000);
      expect(built.triangles).toBeLessThanOrEqual(OUTLINE_MAX_TRIANGLES);
      expect(built.geometry.getAttribute('fade').count).toBe(built.geometry.getAttribute('position').count);
    }
  });

  it('samples are laid out x, y, z, radius', () => {
    expect(SAMPLE_STRIDE).toBe(4);
  });
});
