import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import organsFile from '../../src/data/organs.json';
import vasculatureFile from '../../src/data/vasculature.json';
import type { OrganDef, OrgansFile } from '../../src/data/types';
import { BODY_MIRROR_X, giSegment, organPosition } from '../../src/render/anatomy/layout';
import { buildModel } from '../../src/render/anatomy/models';

/**
 * LATERALITY: WHICH SIDE OF THE BODY THINGS ARE ON.
 *
 * Until 2026-11 this simulator drew a body with complete situs inversus - liver on the
 * viewer's right, stomach and spleen on the left - in every frame, and nothing noticed,
 * because a mirror image of a body is still a plausible-looking body and every test
 * that looked at geometry looked at one organ at a time. The data was right (+x is the
 * patient's right, as an anatomist would write it); the renderer simply never mirrored
 * it for a camera that stands in front of the patient.
 *
 * This file is what would have caught it, and what stops it coming back by either
 * route: someone removing the mirror, or someone "fixing" a left-sided organ by moving
 * it to +x because that is where it looks right on an unmirrored screen.
 *
 * Three layers, deliberately:
 *   1. the DATA puts each organ on its anatomical side in the body frame;
 *   2. the PROJECTION puts the patient's right on the viewer's left, for a camera where
 *      the app's camera starts;
 *   3. the VIEWER actually applies the mirror to the group everything anatomical hangs
 *      from (asserted on its source, as tests/render/shader-mirror.test.ts does for the
 *      GLSL, because a WebGL context is not available here).
 */

const FILE = organsFile as unknown as OrgansFile;
const ROOT = join(import.meta.dirname ?? process.cwd(), '..', '..');

function organ(id: string): OrganDef {
  const def = FILE.organs.find((o) => o.id === id);
  if (!def) throw new Error(`no organ ${id}`);
  return def;
}

/** Normalised-device x of a body-frame point, for a camera in front of the patient. */
function screenX(bodyPoint: THREE.Vector3): number {
  const camera = new THREE.PerspectiveCamera(21, 1, 0.05, 50);
  camera.position.set(0, 0.08, 3);
  camera.lookAt(0, 0.08, 0);
  camera.updateMatrixWorld(true);
  const scenePoint = new THREE.Vector3(bodyPoint.x * BODY_MIRROR_X, bodyPoint.y, bodyPoint.z);
  return scenePoint.project(camera).x;
}

const RIGHT_SIDED = ['liver', 'gallbladder', 'kidney_r', 'adrenal_r', 'lung_r'];
const LEFT_SIDED = ['stomach', 'spleen', 'kidney_l', 'adrenal_l', 'lung_l', 'heart'];

describe('the body frame: +x is the patient\'s right', () => {
  it('puts every lateralised organ on its anatomical side', () => {
    for (const id of RIGHT_SIDED) expect(organPosition(organ(id)).x, `${id} should be at +x`).toBeGreaterThan(0);
    for (const id of LEFT_SIDED) expect(organPosition(organ(id)).x, `${id} should be at -x`).toBeLessThan(0);
  });

  it('sits the right kidney lower than the left, under the liver', () => {
    expect(organPosition(organ('kidney_r')).y).toBeLessThan(organPosition(organ('kidney_l')).y);
  });

  it('points the cardiac apex down, forward and to the patient\'s left', () => {
    const geometry = buildModel('heart');
    const pos = geometry.getAttribute('position');
    // The apex is the lowest point of the ventricular mass. The inferior vena cava stub
    // also hangs below the heart on the RIGHT, so take the lowest vertex on the left half.
    let apex = new THREE.Vector3(0, Infinity, 0);
    for (let i = 0; i < pos.count; i++) {
      if (pos.getX(i) < -0.01 && pos.getY(i) < apex.y) apex = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    }
    expect(apex.y).toBeLessThan(-0.045);
    expect(apex.x, 'apex should be to the patient\'s left').toBeLessThan(-0.03);
    expect(apex.z, 'apex should be anterior').toBeGreaterThan(0);
    geometry.dispose();
  });

  it('runs the gut the right way round', () => {
    const last = (segment: string) => giSegment(segment)[giSegment(segment).length - 1];
    const first = (segment: string) => giSegment(segment)[0];
    // The oesophagus passes through the diaphragm to the LEFT of the midline.
    expect(last('oesophagus')[0]).toBeLessThan(0);
    // The stomach lies to the left and empties through a pylorus to the RIGHT of it.
    expect(Math.min(...giSegment('stomach').map((p) => p[0]))).toBeLessThan(-0.05);
    expect(last('stomach')[0]).toBeGreaterThan(0);
    // The duodenum makes its C to the right, and ends (the flexure) back on the left.
    expect(Math.max(...giSegment('duodenum').map((p) => p[0]))).toBeGreaterThan(0.03);
    expect(last('duodenum')[0]).toBeLessThan(0);
    // Caecum and ascending colon on the right, descending colon on the left.
    expect(first('colon_ascending')[0]).toBeGreaterThan(0.05);
    expect(first('colon_descending')[0]).toBeLessThan(-0.05);
    // The splenic flexure is higher than the hepatic flexure.
    expect(first('colon_descending')[1]).toBeGreaterThan(last('colon_ascending')[1]);
  });

  it('keeps the great vessels on their sides: vena cava right, descending aorta left', () => {
    const segments = (vasculatureFile as { segments: { id: string; points: number[][] }[] }).segments;
    const meanX = (id: string) => {
      const seg = segments.find((s) => s.id === id);
      if (!seg) throw new Error(`no vessel ${id}`);
      return seg.points.reduce((a, p) => a + p[0], 0) / seg.points.length;
    };
    expect(meanX('ivc')).toBeGreaterThan(0);
    expect(meanX('svc')).toBeGreaterThan(0);
    expect(meanX('aorta_thoracic')).toBeLessThan(0);
    expect(meanX('aorta_abdominal')).toBeLessThan(0);
  });
});

describe('the view: the patient\'s right is on the viewer\'s left', () => {
  it('mirrors x exactly once', () => {
    expect(BODY_MIRROR_X).toBe(-1);
  });

  it('projects right-sided organs to the left of the screen and left-sided to the right', () => {
    for (const id of RIGHT_SIDED) expect(screenX(organPosition(organ(id))), `${id} on screen`).toBeLessThan(0);
    for (const id of LEFT_SIDED) expect(screenX(organPosition(organ(id))), `${id} on screen`).toBeGreaterThan(0);
  });

  it('is applied by the viewer to the group all anatomy hangs from', () => {
    const source = readFileSync(join(ROOT, 'src', 'render', 'scene', 'Viewer.ts'), 'utf8');
    expect(source).toContain('this.body.scale.x = BODY_MIRROR_X');
    expect(source).toContain('this.scene.add(this.body)');
    // Everything anatomical is a child of the mirrored group...
    for (const child of ['this.organs.root', 'this.bolus.root', 'this.airway.root', 'this.vascular.root']) {
      expect(source, `${child} must hang from the body group`).toContain(`this.body.add(${child})`);
      // ...and nothing anatomical is added to the scene directly, where it would be unmirrored.
      expect(source, `${child} must not be added to the scene directly`).not.toContain(`this.scene.add(${child})`);
    }
  });
});
