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
 *
 * THE ORAL DRUG BOLUS (added). Food is not the only thing swallowed: a tablet is too,
 * and a drug given by mouth spends its first minutes as a warm parcel travelling
 * mouth -> oesophagus -> stomach before it is absorbed and appears in the portal
 * blood. So when any drug carries a `gut_mg`, a small tinted capsule runs that path on
 * a loop for as long as the gut holds the drug — coloured the drug's own transport hue
 * where it has one, warm amber otherwise, so "swallowed" reads warm against the cool
 * "air in" of the airway cue. It shares this file because the swallowed path is exactly
 * the curve the food bolus already travels; only the reason for the parcel differs.
 */

const MAX_BOLUSES = 16;
/** How many tinted parcels trace the oral drug path at once. A couple reads as flow. */
const MAX_ORAL = 3;

export class GiBolus {
  readonly root = new THREE.Group();
  private curves = new Map<string, THREE.CatmullRomCurve3>();
  private pool: THREE.Mesh[] = [];
  private oralPool: THREE.Mesh[] = [];
  private oralCurve: THREE.CatmullRomCurve3 | null = null;
  private geometry: THREE.CapsuleGeometry;
  private material: THREE.MeshBasicMaterial;
  private tmp = new THREE.Vector3();
  private tangent = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private oralTint = new THREE.Color();

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

    // The swallowed path: mouth, oesophagus and the upper stomach, concatenated into
    // one smooth curve so a tablet can travel it end to end without teleporting between
    // segments. These are the same authored centrelines the food bolus uses.
    const oralPoints: THREE.Vector3[] = [];
    for (const seg of ['mouth', 'oesophagus', 'stomach']) {
      const line = giCentrelines().find((l) => l.segment === seg);
      if (line) for (const p of line.points) oralPoints.push(new THREE.Vector3(...p));
    }
    if (oralPoints.length >= 2) {
      this.oralCurve = new THREE.CatmullRomCurve3(oralPoints, false, 'catmullrom', 0.35);
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

    for (let i = 0; i < MAX_ORAL; i++) {
      const mesh = new THREE.Mesh(this.geometry, this.material.clone());
      mesh.visible = false;
      mesh.renderOrder = 33;
      mesh.scale.setScalar(0.7);
      this.oralPool.push(mesh);
      this.root.add(mesh);
    }
  }

  update(snapshot: SimSnapshot, peristalsisPhase: number): void {
    this.updateOralDrug(snapshot);

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

  /**
   * The swallowed drug parcel. Any drug with a `gut_mg` puts one or two tinted capsules
   * on the mouth->stomach curve, looping while the gut holds the drug so the intake
   * reads as continuous swallowing rather than a single frame. Colour comes from the
   * drug's transport marker where it has one, so the parcel and the blood that later
   * carries it are the same hue; a warm amber stands in when there is no marker yet.
   */
  private updateOralDrug(snapshot: SimSnapshot): void {
    let gutDrug: SimSnapshot['drugs'][number] | null = null;
    for (const d of snapshot.drugs) {
      if (d.gut_mg > 0.001 && (!gutDrug || d.gut_mg > gutDrug.gut_mg)) gutDrug = d;
    }

    if (!this.oralCurve || !gutDrug) {
      for (const mesh of this.oralPool) mesh.visible = false;
      return;
    }

    // Warm by default; the drug's own transport hue when the sim is already carrying it.
    this.oralTint.setHex(0xd98a3a);
    const marker = snapshot.transport.markers.find((m) => m.id === gutDrug!.drugId);
    if (marker) this.oralTint.setHex(marker.colour).lerp(new THREE.Color(0xd98a3a), 0.35);

    // A slow loop off simulated time so the parcels crawl down the tract deterministically.
    const base = snapshot.t * 0.16;
    for (let i = 0; i < this.oralPool.length; i++) {
      const mesh = this.oralPool[i];
      const t = ((base + i / this.oralPool.length) % 1 + 1) % 1;
      this.oralCurve.getPointAt(t, this.tmp);
      mesh.position.copy(this.tmp);
      this.oralCurve.getTangentAt(t, this.tangent);
      mesh.quaternion.setFromUnitVectors(this.up, this.tangent.normalize());
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.color.copy(this.oralTint);
      // Fade in at the mouth and out as it dissolves into the stomach, so parcels do
      // not pop into and out of existence at the curve's ends.
      material.opacity = 0.85 * Math.sin(t * Math.PI);
      mesh.visible = material.opacity > 0.02;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    for (const m of this.pool) (m.material as THREE.Material).dispose();
    for (const m of this.oralPool) (m.material as THREE.Material).dispose();
  }
}
