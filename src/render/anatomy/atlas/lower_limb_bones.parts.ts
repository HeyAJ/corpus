import * as THREE from 'three';
import type { PartBuilder, PartGeometry } from '../parts';
import { mulberry32 } from '../noise';
import { intersect, mergeParts, sphere, subtract, torus, tubeAlong, union, type Sdf, type V3 } from '../sdf';
import {
  CONDYLE_L, CONDYLE_M, CONDYLE_R, F, FEMUR_MAX, FEMUR_MIN, FOVEA, GREATER, HEAD_R, HIP_MAX, HIP_MIN, NECK_END, NOTCH,
  PUBIC_BODY, SHAFT, SOCKET_OPENS, SOCKET_R, SPINE_TIP, WING_THICK, acetabulumField, extractBoth,
  extractSide, femurField, frameFromNormal, greaterField, headField, hipBoneField, inFrame3, inferiorRamusField, ischialRamusField,
  ischialSpineField, ischiumField, lesserField, local, mirrorPts, neckField, pubicBodyField, pubicTubercleField, pubisField,
  shaftAxisAt, shaftField, shaftRadiusAt, superiorRamusField, tuberosityField, wing, wingPoint,
} from '../shells/lower_limb_bones';

/**
 * INTERIOR OF THE HIP AND THIGH BONES, in the organ's own frame (origin organs.json [0, -0.2, 0]).
 *
 * The bones are the SAME fields the shell uses (shells/lower_limb_bones.ts) at a finer cell, so
 * the interior lies on the shell's silhouette. A child is a piece of its parent cut out by region
 * (the ischium out of the hip bone, the greater trochanter out of the femur) or a marker laid on
 * its surface (a crest, a notch, a line, a ridge). Both sides of every pair share one geometry.
 *
 * BONE TISSUE IS A MAGNIFIED SCHEMATIC AND IS ILLUSTRATIVE. The compact bone, osteon, canals,
 * lamellae, cells, spongy lattice and marrow spaces are drawn INSIDE THE RIGHT FEMUR only, at a
 * scale far larger than their real size (an osteon is a fraction of a millimetre across; here it
 * is a few millimetres so that its parts can be seen), and as one example each: the number of
 * lamellae, lacunae and trabeculae is chosen to be seen and is not a count from the textbook. The
 * cortex is drawn thicker than a femur's relative to its width for the same reason. The joint
 * capsule, ligaments, labrum, synovial lining and cartilages are thin schematic shapes on the
 * places where the bones meet. Nothing here is simulated: bone remodelling and calcium handling
 * are not modelled; only the red marrow follows erythropoietin.
 */

const SIDES = [1, -1];

function blob(c: V3, r: V3, w = 10, h = 7): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, w, h);
  g.deleteAttribute('uv');
  g.scale(r[0], r[1], r[2]);
  g.translate(c[0], c[1], c[2]);
  return g;
}
const rod = (pts: V3[], r: number, tubular = 10, radial = 5): THREE.BufferGeometry => tubeAlong(pts, () => r, { tubular, radial });
const both = (make: (side: number) => THREE.BufferGeometry): THREE.BufferGeometry => mergeParts(SIDES.map(make));
const L = (p: V3): V3 => local(p);
const bothRod = (pts: V3[], r: number, tubular = 10, radial = 5): THREE.BufferGeometry => both((s) => rod(mirrorPts(pts, s).map(L), r, tubular, radial));
const bothBlob = (c: V3, r: V3, w = 10, h = 7): THREE.BufferGeometry => both((s) => blob(L([s * c[0], c[1], c[2]]), r, w, h));

const hb = (f: Sdf, cell = 0.0048): THREE.BufferGeometry => extractBoth(f, HIP_MIN, HIP_MAX, cell);
const fb = (f: Sdf, cell = 0.0042): THREE.BufferGeometry => extractBoth(f, FEMUR_MIN, FEMUR_MAX, cell);
/** One right femur only, for the bone tissue drawn inside it (bounds around the mid-shaft). */
const rightOnly = (f: Sdf, min: V3, max: V3, cell: number): THREE.BufferGeometry => extractSide(f, min, max, cell, 1);


/** Reflect a right-side geometry into the left: negate x and turn the triangles round so they still face outwards. */
function reflected(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setX(i, -p.getX(i));
  const idx = g.getIndex();
  if (idx) for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i + 1);
    idx.setX(i + 1, idx.getX(i + 2));
    idx.setX(i + 2, a);
  }
  g.computeVertexNormals();
  return g;
}
const bothSides = (right: () => THREE.BufferGeometry): THREE.BufferGeometry => mergeParts([right(), reflected(right())]);

/** A flat oval (a thin ellipsoid) lying in the plane with normal n, as a marker; body coordinates, right side. */
function flatOval(c: V3, n: V3, rx: number, ry: number, rz: number): THREE.BufferGeometry {
  const f = frameFromNormal(c, n);
  const g = new THREE.SphereGeometry(1, 16, 8);
  g.deleteAttribute('uv');
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) * rx;
    const y = p.getY(i) * ry;
    const z = p.getZ(i) * rz;
    p.setXYZ(
      i,
      c[0] + f.u[0] * x + f.v[0] * y + f.w[0] * z,
      c[1] + f.u[1] * x + f.v[1] * y + f.w[1] * z - ORIGIN_Y_LOCAL + 0,
      c[2] + f.u[2] * x + f.v[2] * y + f.w[2] * z,
    );
  }
  g.computeVertexNormals();
  return g;
}
const ORIGIN_Y_LOCAL = -0.2;

/** A patch lying ON the iliac plate: an oval in (s, y) of the plate, `off` metres off its mid-surface, `thick` deep. */
function wingPatch(s0: number, y0: number, rs: number, ry: number, off: number, thick: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 18, 10);
  g.deleteAttribute('uv');
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const q = wingPoint(s0 + rs * p.getX(i), y0 + ry * p.getY(i), off + thick * p.getZ(i));
    p.setXYZ(i, q[0], q[1] - ORIGIN_Y_LOCAL, q[2]);
  }
  g.computeVertexNormals();
  return g;
}

/** A spherical cap (an open surface) of an ellipsoid, opening about `dir`, half-angle in radians; a thin cartilage skin. */
function sphereCap(c: V3, r: V3, dir: V3, half: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, half);
  g.deleteAttribute('uv');
  g.scale(r[0], r[1], r[2]);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir).normalize()));
  g.translate(c[0], c[1] - ORIGIN_Y_LOCAL, c[2]);
  g.computeVertexNormals();
  return g;
}

const v3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export const parts: PartBuilder = () => {
  const out: PartGeometry[] = [];
  const add = (id: string, geometry: THREE.BufferGeometry): void => {
    out.push({ id, geometry });
  };

  /* ================================================================= hip bone */
  add('hip_bones', hb(hipBoneField(), 0.0062));
  add('ilium', hb(wing(), 0.0062));
  const crest: V3[] = [[0.0, -0.052], [0.02, -0.04], [0.05, -0.03], [0.085, -0.032], [0.115, -0.045], [0.14, -0.058]].map(([s, y]) => wingPoint(s, y));
  add('iliac_crest', bothRod(crest, 0.0034, 16, 6));
  add('anterior_superior_iliac_spine', bothBlob(wingPoint(0.14, -0.058), [0.0055, 0.0055, 0.0055]));
  add('anterior_inferior_iliac_spine', bothBlob(wingPoint(0.144, -0.09), [0.0048, 0.0048, 0.0048]));
  add('posterior_superior_iliac_spine', bothBlob(wingPoint(0.0, -0.052), [0.0052, 0.0052, 0.0052]));
  // The fossa on the inside of the wing: a shallow patch on the inner (medial) face.
  add('iliac_fossa', bothSides(() => wingPatch(0.075, -0.07, 0.03, 0.024, -WING_THICK / 2 - 0.0005, 0.0012)));
  const arcuate: V3[] = [[0.03, -0.103], [0.06, -0.122], [0.095, -0.134], [0.118, -0.128]].map(([s, y]) => wingPoint(s, y, -WING_THICK / 2 - 0.0008));
  add('arcuate_line', bothRod(arcuate, 0.0022, 14, 5));
  add('auricular_surface', bothSides(() => wingPatch(0.014, -0.082, 0.0085, 0.0155, -WING_THICK / 2 - 0.0005, 0.001)));

  add('ischium', hb(ischiumField(), 0.0046));
  add('ischial_tuberosity', hb(tuberosityField(), 0.0042));
  add('ischial_spine', hb(ischialSpineField(), 0.0026));
  add('ischial_ramus', hb(ischialRamusField(), 0.0042));

  add('pubis', hb(pubisField(), 0.0046));
  add('pubic_body', hb(pubicBodyField(), 0.0032));
  add('superior_pubic_ramus', hb(superiorRamusField(), 0.0044));
  add('inferior_pubic_ramus', hb(inferiorRamusField(), 0.0044));
  add('pubic_tubercle', hb(pubicTubercleField(), 0.0024));

  /* ================================================ acetabulum, foramen, notches */
  add('acetabulum', hb(acetabulumField(), 0.0046));
  // The obturator foramen is the opening framed by the pubic rami and the ischium; it is drawn as a
  // thin pane (the membrane that closes it) with a ring, so that the hole can be seen and named.
  const forCentre: V3 = [0.0505, -0.1785, 0.029];
  add('obturator_foramen', bothSides(() => flatOval(forCentre, [0.72, 0, 0.69], 0.028, 0.026, 0.0013)));
  const greater: V3[] = [[0.018, -0.092], [0.036, -0.098], [0.048, -0.108], [0.06, -0.122]].map(([s, y]) => wingPoint(s, y));
  greater.push(SPINE_TIP);
  add('greater_sciatic_notches', bothRod(greater, 0.0026, 16, 5));
  add('lesser_sciatic_notches', bothRod([SPINE_TIP, [0.081, -0.168, -0.032], [0.0795, -0.19, -0.031]], 0.0026, 10, 5));
  // The symphysis: a disc of fibrocartilage between the two pubic bodies at the midline.
  add('pubic_symphysis', blob(L([0, PUBIC_BODY[1], PUBIC_BODY[2]]), [0.0042, 0.0165, 0.0064], 10, 8));
  add('sacroiliac_joints', bothSides(() => wingPatch(0.006, -0.084, 0.012, 0.0215, -WING_THICK / 2 - 0.003, 0.0035)));
  // Red marrow of the ilium: a thin core in the plate.
  add('red_bone_marrow', bothSides(() => wingPatch(0.075, -0.09, 0.058, 0.04, 0, 0.0028)));

  /* ===================================================================== femur */
  add('femora', fb(femurField(), 0.005));
  add('femoral_head', fb(subtract(headField(), sphere(FOVEA, 0.0026)), 0.004));
  add('fovea_of_head', both((s) => blob(L([s * FOVEA[0], FOVEA[1], FOVEA[2]]), [0.0031, 0.0031, 0.0031], 8, 6)));
  add('femoral_neck', fb(neckField(), 0.004));
  add('greater_trochanter', fb(greaterField(), 0.0032));
  add('lesser_trochanter', fb(lesserField(), 0.0028));
  const iline: V3[] = [[GREATER[0] - 0.0025, -0.1555, 0.0035], [GREATER[0] - 0.0085, -0.173, 0.0045], [0.0995, -0.1905, 0.0015]];
  add('intertrochanteric_line', bothRod(iline, 0.0017, 10, 5));
  const icrest: V3[] = [[GREATER[0] - 0.0005, -0.1545, -0.0225], [GREATER[0] - 0.0085, -0.172, -0.0235], [0.0985, -0.1905, -0.0215]];
  add('intertrochanteric_crest', bothRod(icrest, 0.002, 10, 5));
  const linea: V3[] = [-0.2, -0.235, -0.27, -0.292].map((y) => {
    const a = shaftAxisAt(y);
    return [a[0], y, a[2] - shaftRadiusAt(y) - 0.0004] as V3;
  });
  add('linea_aspera', bothRod(linea, 0.0017, 14, 5));
  add('femoral_shaft', fb(shaftField(), 0.0046));

  /* ==================================================================== joint */
  add('hip_joints', bothSides(() => flatOval(F, SOCKET_OPENS, 0.0215, 0.0215, 0.0025)));
  const ring = frameFromNormal(
    [F[0] + 0.0085 * SOCKET_OPENS[0], F[1] + 0.0085 * SOCKET_OPENS[1], F[2] + 0.0085 * SOCKET_OPENS[2]],
    SOCKET_OPENS,
  );
  add('acetabular_labrum', hb(inFrame3(torus([0, 0, 0], 0.0138, 0.0026, 2), ring), 0.0028));
  add('ligament_of_head_of_femur', bothRod([FOVEA, [0.0945, -0.1625, -0.0075], [NOTCH[0] - 0.0005, NOTCH[1] + 0.0015, NOTCH[2] - 0.001]], 0.0014, 8, 5));
  const capPath: V3[] = [[0.101, -0.1505, -0.004], [0.1055, -0.1605, -0.0065], [0.1085, -0.1695, -0.0085]];
  add('hip_joint_capsule', both((s) => tubeAlong(mirrorPts(capPath, s).map(L), (t) => 0.0225 - 0.0045 * t, { tubular: 12, radial: 14 })));
  add('hip_synovial_membrane', both((s) => tubeAlong(mirrorPts(capPath, s).map(L), (t) => 0.0203 - 0.0045 * t, { tubular: 12, radial: 14 })));
  const iliofem1: V3[] = [[0.098, -0.092, 0.049], [0.106, -0.125, 0.0235], [0.1135, -0.1535, 0.0155], [0.1145, -0.1585, 0.0035]];
  const iliofem2: V3[] = [[0.106, -0.125, 0.0235], [0.109, -0.1645, 0.0155], [0.103, -0.19, 0.003]];
  add('iliofemoral_ligament', both((s) => mergeParts([rod(mirrorPts(iliofem1, s).map(L), 0.0023, 12, 5), rod(mirrorPts(iliofem2, s).map(L), 0.0023, 10, 5)])));
  add('pubofemoral_ligament', bothRod([[0.078, -0.145, 0.034], [0.094, -0.162, 0.0185], [0.1015, -0.186, 0.0065]], 0.002, 10, 5));
  add('ischiofemoral_ligament', bothRod([[0.09, -0.16, -0.03], [0.1035, -0.153, -0.0275], [0.1165, -0.1585, -0.0185]], 0.002, 10, 5));
  // Cartilage on the lunate surface of the socket (the horseshoe round the notch).
  const toSocket: V3 = [-SOCKET_OPENS[0], -SOCKET_OPENS[1], -SOCKET_OPENS[2]];
  add('hip_articular_cartilage', bothSides(() => sphereCap(F, [SOCKET_R + 0.0005, SOCKET_R + 0.0005, SOCKET_R + 0.0005], toSocket, 1.3)));

  /* ======================================================== bone tissue (right femur) */
  // Heights of the mid-shaft window in which the tissue is drawn, and the thickness of the cortex there.
  const Y0 = -0.285;
  const Y1 = -0.2;
  const CORTEX = 0.0040;
  const shaftOuter = shaftField();
  const slab: Sdf = (_x, y) => Math.abs(y - (Y0 + Y1) / 2) - (Y1 - Y0) / 2;
  const boxMin: V3 = [0.062, Y0 - 0.002, -0.026];
  const boxMax: V3 = [0.112, Y1 + 0.002, 0.014];
  const cortex = intersect(
    (x, y, z) => Math.max(shaftOuter(x, y, z) + 0.0004, -(shaftOuter(x, y, z) + 0.0004 + CORTEX)),
    slab,
  );
  add('compact_bone', rightOnly(cortex, boxMin, boxMax, 0.003));
  const ys = [Y1, -0.2175, -0.235, -0.2525, -0.27, Y0];
  const sleeve = (dr: number, from = 0, to = ys.length, radial = 14): THREE.BufferGeometry => {
    const pts = ys.slice(from, to).map((y) => L(shaftAxisAt(y)));
    const rs = ys.slice(from, to).map((y) => shaftRadiusAt(y) + dr);
    return tubeAlong(pts, (t) => {
      const f = t * (rs.length - 1);
      const i = Math.min(rs.length - 2, Math.floor(f));
      return rs[i] + (rs[i + 1] - rs[i]) * (f - i);
    }, { tubular: 10, radial });
  };
  add('periosteum', sleeve(0.0007));
  add('endosteum', sleeve(-CORTEX + 0.0003));
  add('circumferential_lamellae', mergeParts([sleeve(-0.0008), sleeve(-0.0016), sleeve(-CORTEX + 0.0010)]));
  add('medullary_cavity', sleeve(-CORTEX - 0.0003, 0, ys.length, 12));
  add('yellow_marrow', sleeve(-CORTEX - 0.0011, 0, ys.length, 10));

  // ----- an osteon, magnified, lying in the cortex on the outer side of the shaft
  const yO = -0.2425;
  const axisO = shaftAxisAt(yO);
  const dir = new THREE.Vector3(...shaftAxisAt(yO - 0.02)).sub(new THREE.Vector3(...shaftAxisAt(yO + 0.02))).normalize();
  const e1 = new THREE.Vector3(1, 0, 0).sub(dir.clone().multiplyScalar(dir.x)).normalize();
  const e2 = new THREE.Vector3().crossVectors(dir, e1).normalize();
  const rMid = shaftRadiusAt(yO) - CORTEX / 2 - 0.0004;
  const centre = new THREE.Vector3(...axisO).add(e1.clone().multiplyScalar(rMid));
  const at = (t: number, ang: number, r: number): V3 => {
    const p = centre
      .clone()
      .add(dir.clone().multiplyScalar(-t))
      .add(e1.clone().multiplyScalar(Math.cos(ang) * r))
      .add(e2.clone().multiplyScalar(Math.sin(ang) * r));
    return L([p.x, p.y, p.z]);
  };
  const lenO = 0.0135;
  const axisTube = (r: number, half = lenO, radial = 12): THREE.BufferGeometry =>
    tubeAlong([at(-half, 0, 0), at(0, 0, 0), at(half, 0, 0)], () => r, { tubular: 4, radial });
  const ORAD = [0.0007, 0.0011, 0.0015];
  add('osteon', axisTube(0.0018, lenO + 0.0004, 14));
  add('central_canal', axisTube(0.00036, lenO + 0.0016, 8));
  add('concentric_lamellae', mergeParts(ORAD.map((r) => axisTube(r, lenO - 0.0005, 14))));
  const lac: THREE.BufferGeometry[] = [];
  const lrand = mulberry32(7);
  ORAD.forEach((r, ring) => {
    for (let k = 0; k < 6; k++) {
      const ang = ((k + ring * 0.37) / 6) * Math.PI * 2;
      const t = (lrand() * 2 - 1) * (lenO - 0.002);
      lac.push(blob(at(t, ang, r - 0.00018), [0.0005, 0.0003, 0.0003], 6, 4));
    }
  });
  add('lacunae_osteocytes', mergeParts(lac));
  const can: THREE.BufferGeometry[] = [];
  for (const t of [-0.006, 0.004]) {
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2 + (t > 0 ? 0.2 : 0);
      can.push(rod([at(t, ang, 0.0003), at(t, ang, 0.00165)], 0.00013, 1, 3));
    }
  }
  add('canaliculi', mergeParts(can));
  // Perforating (Volkmann) canals: short channels across the cortex, from the outer surface to the cavity, the lowest one joining the osteon.
  const vk: THREE.BufferGeometry[] = [];
  const vkAt = (y: number, ang: number): THREE.BufferGeometry => {
    const a = shaftAxisAt(y);
    const R = shaftRadiusAt(y);
    const d = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
    const p = (r: number): V3 => L([a[0] + d.x * r, y - 0.0 + r * 0.25, a[2] + d.z * r]);
    return rod([p(R + 0.0004), p(R - CORTEX / 2), p(R - CORTEX - 0.0005)], 0.0007, 4, 5);
  };
  vk.push(vkAt(-0.2165, 2.4), vkAt(-0.2655, 3.6), vkAt(-0.2705, 0.9));
  vk.push(rod([at(lenO, 0, 0.0), at(lenO + 0.001, 0, 0.0024), at(lenO + 0.001, 0, rMid + 0.0036 - 0.0)], 0.0007, 4, 5));
  add('perforating_canals', mergeParts(vk));
  // Interstitial lamellae: arcs of old lamellae left between osteons.
  const arcs: THREE.BufferGeometry[] = [];
  const arand = mulberry32(11);
  for (let k = 0; k < 6; k++) {
    const y = Y1 - 0.01 - arand() * 0.07;
    const a0 = 1.4 + arand() * 4.6;
    const R = shaftRadiusAt(y) - CORTEX * (0.45 + arand() * 0.3);
    const ax = shaftAxisAt(y);
    const pts: V3[] = [];
    for (let j = 0; j <= 5; j++) {
      const ang = a0 + (j / 5) * 1.3;
      pts.push(L([ax[0] + Math.cos(ang) * R, y, ax[2] + Math.sin(ang) * R]));
    }
    arcs.push(rod(pts, 0.0004, 10, 4));
  }
  add('interstitial_lamellae', mergeParts(arcs));

  // ----- spongy bone in the head, neck, greater trochanter and condyles
  const regions: { inside: (p: V3) => boolean; sample: (r: () => number) => V3 }[] = [];
  const sphereRegion = (c: V3, r: V3): (typeof regions)[number] => ({
    inside: (p) => ((p[0] - c[0]) / r[0]) ** 2 + ((p[1] - c[1]) / r[1]) ** 2 + ((p[2] - c[2]) / r[2]) ** 2 <= 1,
    sample: (rnd) => {
      for (let i = 0; i < 40; i++) {
        const p: V3 = [c[0] + (rnd() * 2 - 1) * r[0], c[1] + (rnd() * 2 - 1) * r[1], c[2] + (rnd() * 2 - 1) * r[2]];
        if (((p[0] - c[0]) / r[0]) ** 2 + ((p[1] - c[1]) / r[1]) ** 2 + ((p[2] - c[2]) / r[2]) ** 2 <= 1) return p;
      }
      return c;
    },
  });
  regions.push(sphereRegion(F, [HEAD_R - 0.0028, HEAD_R - 0.0028, HEAD_R - 0.0028]));
  regions.push(sphereRegion(v3(F, NECK_END, 0.75), [0.0072, 0.0075, 0.0072]));
  regions.push(sphereRegion(GREATER, [0.0068, 0.0095, 0.0078]));
  regions.push(sphereRegion(CONDYLE_L, [CONDYLE_R[0] * 0.75, CONDYLE_R[1] * 0.72, CONDYLE_R[2] * 0.75]));
  regions.push(sphereRegion(CONDYLE_M, [CONDYLE_R[0] * 0.75, CONDYLE_R[1] * 0.72, CONDYLE_R[2] * 0.75]));
  const srand = mulberry32(23);
  const trab: THREE.BufferGeometry[] = [];
  const spaces: THREE.BufferGeometry[] = [];
  for (const rg of regions) {
    const pts: V3[] = [];
    for (let i = 0; i < 13; i++) pts.push(rg.sample(srand));
    for (let i = 0; i < pts.length; i++) {
      const near = pts
        .map((q, j) => ({ j, d: Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1], q[2] - pts[i][2]) }))
        .filter((e) => e.j !== i)
        .sort((a, b) => a.d - b.d)
        .slice(0, 2);
      for (const n of near) if (n.j > i || !near.length) trab.push(rod([L(pts[i]), L(pts[n.j])], 0.0006, 1, 4));
    }
    for (let i = 0; i < 5; i++) spaces.push(blob(L(rg.sample(srand)), [0.0012, 0.0012, 0.0012], 6, 4));
  }
  add('trabeculae', mergeParts(trab));
  add('red_marrow_spaces', mergeParts(spaces));
  const envelope: THREE.BufferGeometry[] = [
    blob(L(F), [HEAD_R - 0.0022, HEAD_R - 0.0022, HEAD_R - 0.0022], 14, 10),
    rod([L(F), L(NECK_END)], 0.0078, 8, 8),
    blob(L(GREATER), [0.0072, 0.01, 0.0082], 10, 8),
    blob(L(CONDYLE_L), [CONDYLE_R[0] * 0.8, CONDYLE_R[1] * 0.78, CONDYLE_R[2] * 0.8], 10, 8),
    blob(L(CONDYLE_M), [CONDYLE_R[0] * 0.8, CONDYLE_R[1] * 0.78, CONDYLE_R[2] * 0.8], 10, 8),
  ];
  add('spongy_bone', mergeParts(envelope));

  // ----- cells, magnified: an osteoblast row on the inner lining, osteocytes in the cortex, an osteoclast in a pit
  const cells: { ob: THREE.BufferGeometry[]; oc: THREE.BufferGeometry[]; cl: THREE.BufferGeometry[] } = { ob: [], oc: [], cl: [] };
  {
    const y = -0.2575;
    const a = shaftAxisAt(y);
    const R = shaftRadiusAt(y) - CORTEX;
    for (let k = 0; k < 9; k++) {
      const ang = 3.6 + k * 0.17;
      cells.ob.push(blob(L([a[0] + Math.cos(ang) * (R + 0.0005), y, a[2] + Math.sin(ang) * (R + 0.0005)]), [0.0013, 0.0016, 0.0013], 6, 5));
    }
    // Osteoclast: a large cell with several nuclei, resting in a shallow pit on the same lining, further along.
    const yc = -0.2245;
    const ac = shaftAxisAt(yc);
    const Rc = shaftRadiusAt(yc) - CORTEX;
    const ang = 5.2;
    const cc: V3 = [ac[0] + Math.cos(ang) * (Rc + 0.001), yc, ac[2] + Math.sin(ang) * (Rc + 0.001)];
    cells.cl.push(blob(L(cc), [0.0034, 0.0028, 0.0034], 10, 8));
    for (let k = 0; k < 4; k++) {
      const q = (k / 4) * Math.PI * 2;
      cells.cl.push(blob(L([cc[0] + Math.cos(q) * 0.0012, cc[1] + Math.sin(q) * 0.0012, cc[2] - 0.0006]), [0.00085, 0.00085, 0.00085], 6, 4));
    }
    // Osteocytes: star-shaped cells with processes, in the cortex between the osteon and the surface.
    for (const [yy, ang2] of [[-0.231, 0.4], [-0.2535, -0.5], [-0.2665, 0.2]]) {
      const ax = shaftAxisAt(yy);
      const Rr = shaftRadiusAt(yy) - CORTEX * 0.55;
      const c0: V3 = [ax[0] + Math.cos(ang2) * Rr, yy, ax[2] + Math.sin(ang2) * Rr];
      cells.oc.push(blob(L(c0), [0.0009, 0.0006, 0.0006], 8, 5));
      for (let k = 0; k < 5; k++) {
        const q = (k / 5) * Math.PI * 2;
        cells.oc.push(rod([L(c0), L([c0[0] + Math.cos(q) * 0.0017, c0[1] + Math.sin(q) * 0.0017, c0[2] + Math.cos(q * 2) * 0.0007])], 0.00018, 1, 3));
      }
    }
  }
  add('osteoblasts', mergeParts(cells.ob));
  add('osteocytes', mergeParts(cells.oc));
  add('osteoclasts', mergeParts(cells.cl));
  add('bone_cells', mergeParts([...cells.ob, ...cells.oc, ...cells.cl]));

  // ----- epiphyseal line and the cartilage on the femur's joint surfaces
  const nk = new THREE.Vector3(...NECK_END).sub(new THREE.Vector3(...F)).normalize();
  const epi = frameFromNormal([F[0] + nk.x * 0.0118, F[1] + nk.y * 0.0118, F[2] + nk.z * 0.0118], [nk.x, nk.y, nk.z]);
  const epiProx = inFrame3(torus([0, 0, 0], 0.0108, 0.0013, 2), epi);
  const sd = new THREE.Vector3(...SHAFT[3]).sub(new THREE.Vector3(...SHAFT[2])).normalize();
  const epiDist = inFrame3(torus([0, 0, 0], 0.0118, 0.0013, 2), frameFromNormal([0.0795, -0.2895, -0.0105], [sd.x, sd.y, sd.z]));
  add('epiphyseal_line', fb(union(epiProx, epiDist), 0.0024));
  // Cartilage on the femur: the cap of the head (the side that faces the socket) and the lower faces of the two condyles.
  const cr: V3 = [CONDYLE_R[0] + 0.0006, CONDYLE_R[1] + 0.0006, CONDYLE_R[2] + 0.0006];
  add(
    'femoral_articular_cartilage',
    bothSides(() =>
      mergeParts([
        sphereCap(F, [HEAD_R + 0.0005, HEAD_R + 0.0005, HEAD_R + 0.0005], toSocket, 1.25),
        sphereCap(CONDYLE_L, cr, [0, -1, 0], 1.25),
        sphereCap(CONDYLE_M, cr, [0, -1, 0], 1.25),
      ]),
    ),
  );
  return out;
};
