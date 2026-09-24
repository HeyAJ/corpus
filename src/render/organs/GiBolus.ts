import * as THREE from 'three';
import { giCentrelines, groupOffset } from './OrganSet';
import type { SimSnapshot } from '../../bridge/types';

/**
 * THE BOLUS (spec 6.5).
 *
 * "Watch the meal traverse the tract, turning from a bolus into chyme."
 *
 * A small capsule translated along a `CatmullRomCurve3` that traces the GI
 * centreline. `t` is the digesta object's fractional position within its segment,
 * which the sim already tracks, so the renderer does no physics: it looks up the
 * curve for the segment and evaluates it.
 *
 * Colour and scale come from `solidFraction`, so the parcel visibly changes as
 * water is absorbed along the small bowel and the colon.
 */

const MAX_BOLUSES = 16;

export class GiBolus {
  readonly root = new THREE.Group();
  private curves = new Map<string, THREE.CatmullRomCurve3>();
  private pool: THREE.Mesh[] = [];
  private geometry: THREE.CapsuleGeometry;
  private material: THREE.MeshBasicMaterial;
  private tmp = new THREE.Vector3();
  private tangent = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor() {
    // Abdominal organs carry a group offset; the centrelines are authored in the
    // same un-offset space, so apply it to the whole bolus group once.
    const offset = groupOffset('abdominal');
    this.root.position.set(offset[0], offset[1], offset[2]);
    this.root.renderOrder = 32;

    for (const line of giCentrelines()) {
      this.curves.set(
        line.segment,
        new THREE.CatmullRomCurve3(
          line.points.map((p) => new THREE.Vector3(...p)),
          false,
          'catmullrom',
          0.35,
        ),
      );
    }

    this.geometry = new THREE.CapsuleGeometry(0.006, 0.012, 4, 10);
    this.material = new THREE.MeshBasicMaterial({
      color: 0x9a3b2c,
      transparent: true,
      opacity: 0.95,
      depthWrite: true,
      depthTest: true,
    });

    for (let i = 0; i < MAX_BOLUSES; i++) {
      const mesh = new THREE.Mesh(this.geometry, this.material.clone());
      mesh.visible = false;
      mesh.renderOrder = 32;
      this.pool.push(mesh);
      this.root.add(mesh);
    }
  }

  update(snapshot: SimSnapshot, peristalsisPhase: number): void {
    const digesta = snapshot.gi.digesta;
    const n = Math.min(digesta.length, MAX_BOLUSES);

    for (let i = 0; i < MAX_BOLUSES; i++) {
      const mesh = this.pool[i];
      if (i >= n) {
        mesh.visible = false;
        continue;
      }
      const d = digesta[i];
      const curve = this.curves.get(d.segment);
      if (!curve) {
        mesh.visible = false;
        continue;
      }

      const t = Math.max(0, Math.min(1, d.s));
      curve.getPointAt(t, this.tmp);

      // Peristalsis: a travelling sine displacement along the curve parameter.
      // Amplitude is small; it is a wobble, not a bounce.
      if (peristalsisPhase > 0) {
        const wave = Math.sin((t * 9 - peristalsisPhase * 2 * Math.PI) * Math.PI) * 0.0022;
        this.tmp.x += wave;
        this.tmp.z += wave * 0.6;
      }

      mesh.position.copy(this.tmp);

      // Orient the capsule along the tract so it reads as travelling, not tumbling.
      curve.getTangentAt(t, this.tangent);
      mesh.quaternion.setFromUnitVectors(this.up, this.tangent.normalize());

      // Volume -> linear size. Solid fraction -> colour: pale chyme becomes dark
      // stool as water is absorbed.
      const size = Math.cbrt(Math.max(4, Math.min(600, d.volume_mL)) / 120);
      mesh.scale.setScalar(THREE.MathUtils.clamp(size, 0.45, 2.2));

      const material = mesh.material as THREE.MeshBasicMaterial;
      material.color.setHSL(
        THREE.MathUtils.lerp(0.09, 0.055, d.solidFraction),
        THREE.MathUtils.lerp(0.55, 0.42, d.solidFraction),
        THREE.MathUtils.lerp(0.44, 0.2, d.solidFraction),
      );
      material.opacity = 0.55 + 0.4 * d.solidFraction;

      mesh.visible = true;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    for (const m of this.pool) (m.material as THREE.Material).dispose();
  }
}
