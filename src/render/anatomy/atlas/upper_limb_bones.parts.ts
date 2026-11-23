import * as THREE from 'three';
import type { PartBuilder, PartGeometry } from '../parts';
import { capsule, ellipsoid, mergeParts, torus, tubeAlong, type Sdf, type V3 } from '../sdf';
import {
  CLAVICLE_PTS, GLENOID_CENTRE, HEAD, HEAD_R, SHAFT_PTS, SOCKET_DIR, SOCKET_R, SCAPULA_MAX, SCAPULA_MIN,
  HUMERUS_MAX, HUMERUS_MIN, SCAPULA_THICK, acromionField, clavicleGeometry, coracoidField, deltoidField, extractBoth,
  frameFromNormal, glenoidField, greaterTubercleField, headField, humeralShaftField, humerusField, inFrame3,
  lesserTubercleField, local, mirrorPts, scapulaField, scapulaZ, spineField,
} from '../shells/upper_limb_bones';

/**
 * INTERIOR OF THE SHOULDER AND ARM BONES, in the organ's own frame (origin organs.json [0, 0.2, 0]).
 *
 * The bones are the SAME fields the shell uses (shells/upper_limb_bones.ts), extracted at a finer
 * cell, so the interior lies on the shell's silhouette. A child part is a piece of its parent cut
 * out by region (the head of the humerus, the spine of the scapula) or a marker laid on the
 * parent's surface (a border, a fossa, a groove, a neck): each is a part of the bone, drawn in a
 * slightly different ivory so it can be told apart, and each lies inside the parent's volume.
 *
 * ILLUSTRATIVE, and stated so in the part texts: the joint markers, the capsule, the synovial
 * membrane, the labrum and the cartilage are drawn as thin shapes on the places where the bones
 * meet, not as measured tissue; the fossae are shallow patches on the scapular plate (the plate
 * itself is a smooth curved sheet, with no real hollow); the red marrow is a core drawn inside the
 * proximal humerus, not a measured volume. Both sides of every pair share one geometry.
 */

const SIDES = [1, -1];

/** A scaled sphere. */
function blob(c: V3, r: V3, w = 10, h = 7): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, w, h);
  g.deleteAttribute('uv');
  g.scale(r[0], r[1], r[2]);
  g.translate(c[0], c[1], c[2]);
  return g;
}
const rod = (pts: V3[], r: number, tubular = 12, radial = 5): THREE.BufferGeometry => tubeAlong(pts, () => r, { tubular, radial });
const both = (make: (side: number) => THREE.BufferGeometry): THREE.BufferGeometry => mergeParts(SIDES.map(make));

/** A flat patch lying on the scapular plate's surface (shifted off it), warped to follow the plate's curve. */
function surfacePatch(cx: number, cy: number, ax: number, ay: number, shift: number, thick: number, side: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 16, 8);
  g.deleteAttribute('uv');
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = cx + ax * p.getX(i);
    const y = cy + ay * p.getY(i);
    const z = scapulaZ(x, y) + shift + thick * p.getZ(i);
    p.setXYZ(i, side * x, y - 0.2, z);
  }
  g.computeVertexNormals();
  return g;
}

/** Points on the plate's surface along an edge of the outline, for a border rod. */
function onPlate(pts: [number, number][], side: number): V3[] {
  return pts.map(([x, y]): V3 => local([side * x, y, scapulaZ(x, y)]));
}

/** A thin shell of a sphere, clipped to the side facing `dir` (a cap), for articular cartilage. */
function cap(centre: V3, radius: number, dir: V3, cut: number, thick: number): Sdf {
  const s = (x: number, y: number, z: number): number => Math.abs(Math.hypot(x - centre[0], y - centre[1], z - centre[2]) - radius) - thick / 2;
  return (x, y, z) => {
    const q = (x - centre[0]) * dir[0] + (y - centre[1]) * dir[1] + (z - centre[2]) * dir[2];
    return Math.max(s(x, y, z), cut - q);
  };
}

export const parts: PartBuilder = () => {
  const out: PartGeometry[] = [];
  const add = (id: string, geometry: THREE.BufferGeometry): void => {
    out.push({ id, geometry });
  };
  const cellS = 0.0042;
  const cellH = 0.0034;
  const sb = (f: Sdf, cell = cellS): THREE.BufferGeometry => extractBoth(f, SCAPULA_MIN, SCAPULA_MAX, cell);
  const hb = (f: Sdf, cell = cellH): THREE.BufferGeometry => extractBoth(f, HUMERUS_MIN, HUMERUS_MAX, cell);

  /* ---------------------------------------------------------------- clavicles */
  add('clavicles', both((s) => clavicleGeometry(s, 28, 8)));
  const c0 = CLAVICLE_PTS[0];
  const cN = CLAVICLE_PTS[CLAVICLE_PTS.length - 1];
  add('sternal_end', both((s) => mergeParts([clavicleGeometry(s, 8, 8, 0, 0.14), blob(local([s * c0[0], c0[1], c0[2]]), [0.0072, 0.0062, 0.0056])])));
  add('acromial_end', both((s) => mergeParts([clavicleGeometry(s, 8, 8, 0.88, 1), blob(local([s * cN[0], cN[1], cN[2]]), [0.0064, 0.0034, 0.0056])])));
  add('clavicle_shaft', both((s) => clavicleGeometry(s, 24, 8, 0.12, 0.9)));

  /* ----------------------------------------------------------------- scapulae */
  add('scapulae', sb(scapulaField()));
  add('scapular_spine', sb(spineField(), 0.0032));
  add('acromion', sb(acromionField(), 0.0032));
  add('coracoid_process', sb(coracoidField(), 0.0032));
  add('glenoid_cavity', sb(glenoidField(), 0.003));
  // Fossae: shallow patches on the plate, behind the spine above and below, and in front (subscapular).
  add('supraspinous_fossa', both((s) => surfacePatch(0.092, 0.2565, 0.034, 0.0062, -SCAPULA_THICK / 2 - 0.0004, 0.0012, s)));
  add('infraspinous_fossa', both((s) => surfacePatch(0.092, 0.2, 0.036, 0.04, -SCAPULA_THICK / 2 - 0.0004, 0.0012, s)));
  add('subscapular_fossa', both((s) => surfacePatch(0.092, 0.215, 0.036, 0.046, SCAPULA_THICK / 2 + 0.0004, 0.0012, s)));
  add(
    'medial_border',
    both((s) => rod(onPlate([[0.052, 0.263], [0.049, 0.235], [0.05, 0.2], [0.054, 0.168], [0.062, 0.158]], s), 0.0027, 16, 5)),
  );
  add('lateral_border', both((s) => rod(onPlate([[0.128, 0.222], [0.112, 0.198], [0.094, 0.175], [0.076, 0.16]], s), 0.0027, 14, 5)));
  add('inferior_angle', both((s) => surfacePatch(0.067, 0.1635, 0.0075, 0.0062, 0, 0.0034, s)));

  /* ------------------------------------------------------------------ humeri */
  add('humeri', hb(humerusField()));
  add('humeral_head', hb(headField(), 0.0032));
  // The anatomical neck is the ring where the head meets the shaft end; the surgical neck is the
  // narrowing just below the tubercles. Both are drawn as rings on the bone (markers).
  const ha = new THREE.Vector3(...SHAFT_PTS[0]).sub(new THREE.Vector3(...HEAD)).normalize();
  const anat = frameFromNormal([HEAD[0] + 0.0104 * ha.x, HEAD[1] + 0.0104 * ha.y, HEAD[2] + 0.0104 * ha.z], [ha.x, ha.y, ha.z]);
  add('anatomical_neck', hb(inFrame3(torus([0, 0, 0], 0.0102, 0.0019, 2), anat), 0.0022));
  const sn = SHAFT_PTS[0];
  const sax = new THREE.Vector3(...SHAFT_PTS[1]).sub(new THREE.Vector3(...SHAFT_PTS[0])).normalize();
  const surg = frameFromNormal([sn[0] + sax.x * -0.0065, sn[1] + sax.y * -0.0065, sn[2] + sax.z * -0.0065], [sax.x, sax.y, sax.z]);
  add('surgical_neck', hb(inFrame3(torus([0, 0, 0], 0.0094, 0.0019, 2), surg), 0.0022));
  add('greater_tubercle', hb(greaterTubercleField(), 0.003));
  add('lesser_tubercle', hb(lesserTubercleField(), 0.003));
  add('intertubercular_sulcus', hb(capsule([0.1685, 0.2465, 0.0092], [0.1695, 0.2145, 0.0082], 0.0018), 0.0022));
  add('deltoid_tuberosity', hb(deltoidField(), 0.003));
  add('humeral_shaft', hb(humeralShaftField(), 0.0034));

  /* ------------------------------------------------------------------ joints */
  add('sternoclavicular_joints', both((s) => blob(local([s * 0.0185, 0.2755, 0.0488]), [0.0072, 0.0034, 0.0052])));
  add('acromioclavicular_joints', both((s) => blob(local([s * 0.1505, 0.2785, -0.0075]), [0.0046, 0.0026, 0.0056])));
  // The joint itself: a thin disc where the head meets the glenoid, in the socket's plane (a marker, not tissue).
  const gf = frameFromNormal(GLENOID_CENTRE, SOCKET_DIR);
  add('glenohumeral_joints', extractBoth(inFrame3(ellipsoid([0, 0, 0], [0.0092, 0.0132, 0.0022]), gf), [0.128, 0.232, -0.03], [0.17, 0.27, 0.02], 0.0022));
  // Labrum: a rim of fibrocartilage round the glenoid's edge, a ring in the socket's plane.
  add('glenoid_labrum', sb(inFrame3(torus([0, 0, 0], 0.0092, 0.0021, 2), gf), 0.0024));
  // Capsule and synovial lining: two open glass sleeves from the glenoid neck to the anatomical neck of the humerus.
  const capsulePath: V3[] = [
    [GLENOID_CENTRE[0] - 0.004, GLENOID_CENTRE[1], GLENOID_CENTRE[2] - 0.003],
    [(GLENOID_CENTRE[0] + HEAD[0]) / 2, HEAD[1], (GLENOID_CENTRE[2] + HEAD[2]) / 2],
    [HEAD[0] + 0.007, HEAD[1] - 0.0045, HEAD[2] + 0.0015],
  ];
  add('joint_capsule', both((s) => tubeAlong(mirrorPts(capsulePath, s).map(local), (t) => 0.0158 - 0.0012 * t, { tubular: 12, radial: 12 })));
  add('synovial_membrane', both((s) => tubeAlong(mirrorPts(capsulePath, s).map(local), (t) => 0.0143 - 0.0012 * t, { tubular: 12, radial: 12 })));
  // Cartilage on the head (the side that faces the glenoid) and on the glenoid's dished face.
  const away: V3 = [-SOCKET_DIR[0], -SOCKET_DIR[1], -SOCKET_DIR[2]];
  const headCap = cap(HEAD, HEAD_R + 0.0004, away, -0.003, 0.0012);
  const socketCap = cap(HEAD, SOCKET_R + 0.0004, away, 0.006, 0.0012);
  add(
    'glenohumeral_articular_cartilage',
    extractBoth(
      (x, y, z) => Math.min(headCap(x, y, z), socketCap(x, y, z)),
      [0.128, 0.232, -0.03], [0.176, 0.27, 0.02],
      0.0024,
    ),
  );

  /* ------------------------------------------------------------- red marrow */
  // A core inside the proximal humerus: the cited text names the proximal humerus among the places that keep red marrow.
  add('red_bone_marrow', both((s) => blob(local([s * 0.1635, 0.2345, -0.0035]), [0.0052, 0.0155, 0.0052], 10, 8)));
  return out;
};
