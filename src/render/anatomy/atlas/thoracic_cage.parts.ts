import * as THREE from 'three';
import type { PartBuilder, PartGeometry } from '../parts';
import { ellipsoid, mergeParts, tubeAlong, type V3 } from '../sdf';
import {
  RIB_COUNT, SBODY, SBODY_HALF, MANUBRIUM, MANUBRIUM_HALF, cartilageGeometry, cartilagePointsBody, extract,
  inFrame, local, ribCurve, ribGeometry, ribPointsBody, sternumGeometry, sternumZ,
} from '../shells/thoracic_cage';

/**
 * INTERIOR OF THE RIB CAGE, in the organ's own frame (origin organs.json [0, 0.2, 0]).
 *
 * The ribs, cartilages and sternum are the SAME builders the shell uses (shells/thoracic_cage.ts)
 * at a finer setting, so the interior lies exactly on the shell's silhouette and the cage reads
 * as one object whichever way it is drawn. What is added here are the things a textbook marks on
 * it: the three segments of the sternum and its landmarks, the features of a rib, the joints, the
 * spaces between the ribs, the red marrow inside the bones.
 *
 * ILLUSTRATIVE, and stated so in the part texts: the typical rib is rib 6 of the right side
 * DRAWN THICKER than the real rib so that its head, neck, tubercle, angle and groove can be told
 * apart; the joints are small markers on the places where the bones meet, not a drawn capsule;
 * the intercostal spaces are thin panes between the ribs standing in for the muscles and
 * membranes that fill them; the marrow is a core drawn inside the bone, not a measured volume.
 *
 * Both sides of every pair are in one geometry (a part is a name, not a side).
 */

const SIDES = [1, -1];
const mirrored = (p: V3, side: number): V3 => [side * p[0], p[1], p[2]];

/** A small scaled sphere, with normals and an index. */
function blob(c: V3, r: V3, w = 8, h = 6): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, w, h);
  g.deleteAttribute('uv');
  g.scale(r[0], r[1], r[2]);
  g.translate(c[0], c[1], c[2]);
  return g;
}

const rod = (pts: V3[], r: number, tubular = 10, radial = 5): THREE.BufferGeometry => tubeAlong(pts, () => r, { tubular, radial });

/** A thin double-faced pane between two curves, `thick` metres apart front to back. */
function pane(a: V3[], b: V3[], thick: number): THREE.BufferGeometry {
  const n = a.length;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = new THREE.Vector3(...(a[Math.min(n - 1, i + 1)] as V3)).sub(new THREE.Vector3(...(a[Math.max(0, i - 1)] as V3)));
    const across = new THREE.Vector3(b[i][0] - a[i][0], b[i][1] - a[i][1], b[i][2] - a[i][2]);
    const nrm = new THREE.Vector3().crossVectors(t, across).normalize().multiplyScalar(thick / 2);
    for (const q of [a[i], b[i]]) {
      pos.push(q[0] + nrm.x, q[1] + nrm.y, q[2] + nrm.z);
      pos.push(q[0] - nrm.x, q[1] - nrm.y, q[2] - nrm.z);
    }
  }
  // Vertex layout per column: [a+, a-, b+, b-]
  for (let i = 0; i < n - 1; i++) {
    const c = i * 4;
    const d = (i + 1) * 4;
    // front face (+) a->b, back face (-) reversed, and the two long edges closed.
    idx.push(c, d, c + 2, d, d + 2, c + 2);
    idx.push(c + 1, c + 3, d + 1, d + 1, c + 3, d + 3);
    idx.push(c, c + 1, d, d, c + 1, d + 1);
    idx.push(c + 2, d + 2, c + 3, d + 2, d + 3, c + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A right-hand rib's curve points between two fractions, as control points for a tube. */
function along(curve: THREE.CatmullRomCurve3, t0: number, t1: number, n: number): V3[] {
  const out: V3[] = [];
  for (let k = 0; k <= n; k++) {
    const p = curve.getPointAt(t0 + ((t1 - t0) * k) / n);
    out.push([p.x, p.y, p.z]);
  }
  return out;
}

const ribsOf = (from: number, to: number, o: { tubular: number; radial: number }): THREE.BufferGeometry =>
  mergeParts(SIDES.flatMap((s) => Array.from({ length: to - from + 1 }, (_, k) => ribGeometry(from + k, s, o))));

const cartilagesOf = (from: number, to: number): THREE.BufferGeometry =>
  mergeParts(SIDES.flatMap((s) => Array.from({ length: to - from + 1 }, (_, k) => cartilageGeometry(from + k, s, 8, 5))));

/** The typical rib: right rib 6, drawn thicker (illustrative). */
const TYPICAL = 6;
const TYPICAL_SCALE = 1.8;

export const parts: PartBuilder = () => {
  const out: PartGeometry[] = [];
  const add = (id: string, geometry: THREE.BufferGeometry): void => {
    out.push({ id, geometry });
  };
  const ribFine = { tubular: 40, radial: 6 };

  /* ----------------------------------------------------------------- sternum */
  add('sternum', sternumGeometry('all', 0.0028));
  add('manubrium', sternumGeometry('manubrium', 0.0028));
  add('sternal_body', sternumGeometry('body', 0.0028));
  add('xiphoid_process', sternumGeometry('xiphoid', 0.0022));
  // Landmarks: small markers laid on the places a textbook names (a notch is a dip, an angle a ridge).
  add('jugular_notch', blob(local([0, 0.2715, sternumZ(0.2715) + 0.001]), [0.0075, 0.0028, 0.0028]));
  add('sternal_angle', rod(([[-0.0165, 0.2265, 0.069], [0, 0.2265, 0.07], [0.0165, 0.2265, 0.069]] as V3[]).map(local), 0.0023, 8, 5));
  add(
    'clavicular_notches',
    mergeParts(SIDES.map((s) => blob(local([s * 0.0185, 0.2685, sternumZ(0.2685) + 0.001]), [0.0045, 0.0045, 0.0036]))),
  );

  /* -------------------------------------------------------------------- ribs */
  add('true_ribs', ribsOf(1, 7, ribFine));
  add('false_and_floating_ribs', ribsOf(8, 12, ribFine));
  add('false_ribs', ribsOf(8, 10, ribFine));
  add('floating_ribs', ribsOf(11, 12, ribFine));

  // The typical rib, in parts, along one curve (illustrative thickness).
  const curve = ribCurve(TYPICAL, 1);
  const th = TYPICAL_SCALE;
  const shaftR = 0.0036 * th;
  const at = (t: number): V3 => {
    const p = curve.getPointAt(t);
    return [p.x, p.y, p.z];
  };
  add('typical_rib', ribGeometry(TYPICAL, 1, { tubular: 40, radial: 8, scale: th }));
  add('rib_head', blob(at(0.0), [0.0085, 0.0075, 0.0085], 10, 8));
  add('rib_neck', tubeAlong(along(curve, 0.015, 0.12, 6), () => 0.0028 * th, { tubular: 10, radial: 8 }));
  const tub = at(0.13);
  add('rib_tubercle', blob([tub[0] + 0.0025, tub[1] + 0.001, tub[2] - 0.0045], [0.0052, 0.0048, 0.0052], 10, 8));
  add('rib_angle', tubeAlong(along(curve, 0.2, 0.34, 6), () => shaftR * 1.12, { tubular: 12, radial: 8 }));
  add('rib_shaft', tubeAlong(along(curve, 0.34, 1.0, 14), (t) => shaftR * (1 - 0.1 * t), { tubular: 30, radial: 8 }));
  // The costal groove runs along the lower inner border; offset from the rib's axis inwards and down.
  const groove = along(curve, 0.22, 0.88, 14).map((p): V3 => {
    const inward = new THREE.Vector3(-p[0], 0, -(p[2] - 0.0)).normalize().multiplyScalar(0.0046);
    return [p[0] + inward.x, p[1] - 0.0036, p[2] + inward.z];
  });
  add('costal_groove', rod(groove, 0.0012, 16, 5));

  /* ------------------------------------------------- cartilages and the margin */
  add('costal_cartilages', cartilagesOf(1, 10));
  // The costal margin: the lower edge of the cartilages of ribs 7 to 10, drawn as a line along their ends.
  add(
    'costal_margin',
    mergeParts(
      SIDES.map((s) =>
        rod([7, 8, 9, 10].map((n) => local(mirrored(cartilagePointsBody(n)[0], s))).map((p): V3 => [p[0], p[1] - 0.0045, p[2]]), 0.0017, 14, 5),
      ),
    ),
  );

  /* ---------------------------------------------------------- intercostal spaces */
  const panes: THREE.BufferGeometry[] = [];
  for (const s of SIDES) {
    for (let n = 1; n < RIB_COUNT; n++) {
      const ca = ribCurve(n, s);
      const cb = ribCurve(n + 1, s);
      // Between the ribs' lower and upper borders, over the part of the shaft where both exist.
      const a = along(ca, 0.14, 0.95, 12).map((p): V3 => [p[0], p[1] - 0.004, p[2]]);
      const b = along(cb, 0.14, 0.95, 12).map((p): V3 => [p[0], p[1] + 0.004, p[2]]);
      panes.push(pane(a, b, 0.0012));
    }
  }
  add('intercostal_spaces', mergeParts(panes));

  /* ------------------------------------------------------------------- joints */
  const sternocostal: THREE.BufferGeometry[] = [];
  for (const s of SIDES) {
    for (let n = 1; n <= 7; n++) {
      const pts = cartilagePointsBody(n);
      sternocostal.push(blob(local(mirrored(pts[2], s)), [0.0036, 0.0032, 0.0036]));
    }
  }
  add('sternocostal_joints', mergeParts(sternocostal));
  const cv: THREE.BufferGeometry[] = [];
  const ct: THREE.BufferGeometry[] = [];
  for (const s of SIDES) {
    for (let n = 1; n <= RIB_COUNT; n++) {
      const p = ribPointsBody(n);
      // Costovertebral: the head on the side of its vertebral body; costotransverse: the tubercle on the transverse process behind.
      cv.push(blob(local(mirrored([p[0][0] - 0.0035, p[0][1], p[0][2]], s)), [0.0042, 0.0046, 0.0042]));
      if (n <= 10) ct.push(blob(local(mirrored([p[2][0] + 0.0035, p[2][1], p[2][2] - 0.004], s)), [0.0038, 0.0038, 0.0038]));
    }
  }
  add('costovertebral_joints', mergeParts(cv));
  add('costotransverse_joints', mergeParts(ct));

  /* -------------------------------------------------------------- red marrow */
  // A core drawn inside the sternum and the ribs the cited text names; not a measured volume.
  const marrow: THREE.BufferGeometry[] = [];
  const manu = extract(inFrame(ellipsoid([0, 0, 0], [MANUBRIUM_HALF[0] * 0.55, MANUBRIUM_HALF[1] * 0.75, MANUBRIUM_HALF[2] * 0.45]), MANUBRIUM), [-0.015, 0.23, 0.045], [0.015, 0.27, 0.065], 0.0022);
  const body = extract(inFrame(ellipsoid([0, 0, 0], [SBODY_HALF[0] * 0.55, SBODY_HALF[1] * 0.85, SBODY_HALF[2] * 0.45]), SBODY), [-0.012, 0.14, 0.065], [0.012, 0.225, 0.095], 0.0022);
  marrow.push(manu, body);
  for (const s of SIDES) {
    for (let n = 2; n <= 10; n++) {
      const c = ribCurve(n, s);
      marrow.push(tubeAlong(along(c, 0.2, 0.9, 8), () => 0.0016, { tubular: 14, radial: 4 }));
    }
  }
  add('red_bone_marrow', mergeParts(marrow));

  return out;
};
