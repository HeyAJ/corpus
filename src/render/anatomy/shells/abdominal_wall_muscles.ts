import * as THREE from 'three';
import { mergeParts, type Sdf, type V3 } from '../sdf';
import { warpOffsetY } from '../layout';
import { cageRing, cartilagePointsBody, ribPointsBody, sternumZ, xiphoidField } from './thoracic_cage';
import { COLUMN_LEVELS, placement, vertebraParts, sacrumField, SACRAL_SHIFT } from './vertebral_column';
import { LESSER, PUBIC_TUBERCLE, SUPERIOR_RAMUS, femurField, hipBoneField, wingPoint } from './lower_limb_bones';
import {
  type BG,
  type MuscleSpec,
  belly,
  groupsOf,
  levelOne,
  onSide,
  polySdf,
  routed,
  ruled,
  seat,
  tendon,
} from './head_neck_muscles';

/**
 * ABDOMINAL WALL MUSCLES, SHELL AND PART GEOMETRY. A LAYER organ of the muscles layer, in the
 * abdominal group.
 *
 * FRAME. Origin organs.json [0, -0.017, 0], DERIVED from the two bones the wall hangs between and
 * not guessed: the top of the rectus is the costal margin at the xiphoid process (scene y 0.1165,
 * the thoracic cage's xiphoid origin 0.127 less its half-length 0.0105, thoracic group offset 0)
 * and the bottom is the pubic tubercle (body y -0.155, which the pelvic group's -0.045 puts at
 * scene -0.200). Their midpoint is scene y -0.042; the abdominal group is lowered 0.025, so the
 * origin is -0.042 + 0.025 = -0.017.
 *
 * THE EXPLODED STACK, AND WHY THE WALL IS MAPPED TWICE. The wall joins the thoracic group (offset
 * 0), the abdominal group (-0.025) and the pelvic group (-0.045: the hip bones and the pubis),
 * which the exploded stack has pulled apart. A point of the wall at body height y is therefore
 * placed by `W`: above y 0.03 by the stack's continuous warp (the same function the cord, the
 * oesophagus and the vessels use), and below y -0.03 by the pelvic group's rigid offset, with a
 * smooth blend between. WHAT WENT WRONG BEFORE: the first-pass stub put every point of the wall
 * through the warp alone, and the warp reaches the pelvic offset only below y -0.165, so the lower
 * rectus and the obliques ended up to 2 cm above the iliac crest and the pubis they must attach
 * to. With `W` a muscle that attaches to a hip bone meets it, and the two cm of stretch lands in
 * the flank between y 0.03 and -0.03, where no bone is.
 *
 * THE SURFACE. The wall follows the trunk's own cross-section: the rib cage's ellipse above y 0,
 * and below it the half-width of the cage's lowest ring with the two depths tapering to the
 * pelvis, ending at the front where the pubic symphysis is. The two taper fractions are DRAWING
 * choices chosen to meet the pubis, not a measurement of a waist (they are the first-pass
 * stub's, kept so the wall still joins the pubis). The front near the midline is limited to the
 * sternum-and-cartilage ramp (`chestFront` in chest_wall_muscles.ts).
 *
 * LAYERS, outermost first, each a slab on that surface at a stated DEPTH (a drawing choice; the
 * ORDER is Gray's): external oblique with the anterior layer of the sheath over the rectus,
 * the rectus, internal oblique, the posterior layer of the sheath, transversus. The muscle of
 * each flat muscle ends at the lateral border of the rectus (the semilunar line) and its
 * aponeurosis carries on to the midline, in front of the rectus for the external oblique and
 * (above the arcuate line) in two layers round it for the internal oblique. Gray's: below the
 * arcuate line every aponeurosis passes in front of the rectus; here that is shown by the
 * posterior layer of the sheath ending at the arcuate line.
 *
 * THE POSTERIOR WALL (psoas major and minor, iliacus, quadratus lumborum) is drawn from the bones:
 * psoas from the sides of the lumbar bodies over the pelvic brim to the lesser trochanter, iliacus
 * from the inner face of the iliac plate (the fossa) to the same tendon, quadratus lumborum from
 * the iliac crest to the twelfth rib, all beside the lumbar vertebrae and behind the kidneys.
 *
 * NOT DRAWN: the cremaster (the testes atlas), the external anal sphincter (the large intestine),
 * the bulbospongiosus and ischiocavernosus (the penis), the perineal body (the vagina), the
 * diaphragm (its own organ). The fibre direction of each layer is not drawn. The inguinal
 * canal is a SCHEMATIC glass channel: no spermatic cord or round ligament is drawn in it.
 */

/** The organ's origin, organs.json. */
export const ORIGIN: V3 = [0, -0.017, 0];
/** The abdominal group's offset in the exploded stack. */
export const GROUP_Y = -0.025;
/** Scene to this frame, on y. */
const TO_LOCAL_Y = -(ORIGIN[1] + GROUP_Y);

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The wall's own mapping from an unexploded body point to this frame; see the header. */
export function W(p: readonly number[]): V3 {
  const s = smooth(0.03, -0.03, p[1]);
  const off = warpOffsetY(p[1]) * (1 - s) - 0.045 * s;
  return [p[0], p[1] + off + TO_LOCAL_Y, p[2]];
}
/** A point already in the scene (the exploded body), in this frame. */
const S = (p: readonly number[]): V3 => [p[0], p[1] + TO_LOCAL_Y, p[2]];
/** A point of a hip bone or the femur, drawn rigidly in the pelvic group (-0.045), in this frame. */
const P = (p: readonly number[]): V3 => [p[0], p[1] - 0.045 + TO_LOCAL_Y, p[2]];

/* ------------------------------------------------------------------ the trunk's surface */

const PELVIS_Y = -0.15;
const FRONT_TAPER = 0.2;
const BACK_TAPER = 0.085;
const STERNUM_FRONT_HALF = 0.004;
const RAMP_LOW = 0.03;
const RAMP_HIGH = 0.32;

/** Half-width and the two depths of the trunk's ellipse at height y (below the cage they taper to the pelvis). */
function trunkAxes(y: number): { A: number; front: number; back: number } {
  if (y >= 0) return { A: cageRing(y, Math.PI / 2)[0], front: cageRing(y, Math.PI)[1], back: -cageRing(y, 0)[1] };
  const t = Math.min(1, -y / -PELVIS_Y);
  return { A: cageRing(0, Math.PI / 2)[0], front: cageRing(0, Math.PI)[1] * (1 - FRONT_TAPER * t), back: -cageRing(0, 0)[1] * (1 - BACK_TAPER * t) };
}

/** x and z of the trunk ellipse at height y and angle a (0 back midline, pi/2 right side, pi front midline), the front limited to the sternum ramp. */
function trunkRing(y: number, a: number): [number, number] {
  const { A, front, back } = trunkAxes(y);
  const c = Math.cos(a);
  const x = A * Math.sin(a);
  const z = -c * (c > 0 ? back : front);
  if (z <= 0) return [x, z];
  const yy = Math.max(y, 0);
  const t = Math.max(0, Math.min(1, (yy - 0.12) / 0.1));
  const slope = RAMP_LOW + (RAMP_HIGH - RAMP_LOW) * t * t * (3 - 2 * t);
  return [x, Math.min(z, sternumZ(yy) + STERNUM_FRONT_HALF + slope * Math.abs(x))];
}

/** A point `off` outward of the trunk's surface (negative: inside it), right side positive x, body (unexploded) coordinates. */
function trunkPoint(y: number, a: number, off: number): V3 {
  const [x, z] = trunkRing(y, a);
  const { A, front, back } = trunkAxes(y);
  const D = Math.cos(a) > 0 ? back : front;
  const nx = x / (A * A);
  const nz = z / (D * D);
  const n = Math.hypot(nx, nz) || 1;
  return [x + (off * nx) / n, y, z + (off * nz) / n];
}

/** The angle of the trunk ellipse whose x is `x` on the front half (a in 0..pi), at height y. */
function frontAngle(y: number, x: number): number {
  const { A } = trunkAxes(y);
  return Math.PI - Math.asin(Math.min(0.999, Math.max(-0.999, x / A)));
}

/** The lateral border of the rectus (the semilunar line) at height y: 6.6 cm from the midline at the costal margin, narrowing to the pubis (3.4 cm). DRAWING choices. */
const rectusHalfWidth = (y: number): number => 0.034 + (0.066 - 0.034) * smooth(-0.155, 0.1, y);
const MIDLINE_HALF = 0.0035;

/* Depths of the layers below the trunk surface, metres: [inner face outward offset, thickness]. Drawing choices; the order is Gray's. */
const LAYER = {
  // `lift` is how much further OUT the layer stands where the ribs or cartilages are: the external oblique lies on the OUTER surfaces of the ribs (from y 0 up) and the rectus and its sheath on the outer surfaces of the costal cartilages (from y 0.085 up), so there they are carried out past the cage's centre-line ellipse by a rib's radius and a clearance; the deeper layers stay inside the costal margin. The layers are thin (2 to 5 mm) so that all of them fit between the trunk's ellipse and the bowel, which reaches 13 mm inside it at the flank.
  externalOblique: { off: -0.0045, t: 0.003, lift: 0.0087, from: 0, to: 0.05 },
  anteriorSheath: { off: -0.0026, t: 0.001, lift: 0.0096, from: 0.085, to: 0.115 },
  rectus: { off: -0.0072, t: 0.0046, lift: 0.0104, from: 0.085, to: 0.115 },
  internalOblique: { off: -0.0072, t: 0.0025, lift: 0, from: 0, to: 0.05 },
  posteriorSheath: { off: -0.0082, t: 0.001, lift: 0, from: 0, to: 0.05 },
  transversus: { off: -0.0096, t: 0.0022, lift: 0, from: 0, to: 0.05 },
} as const;
type LayerName = keyof typeof LAYER;

/* ------------------------------------------------------------------ the bones and the viscera to keep clear of */

const mirrorPts = (pts: readonly V3[], side: number): V3[] => pts.map((p): V3 => [side * p[0], p[1], p[2]]);

function vertebraScene(id: string): Sdf {
  const l = COLUMN_LEVELS.find((v) => v.id === id) ?? COLUMN_LEVELS[0];
  const inv = placement(l).clone().invert();
  const whole = vertebraParts(l).whole;
  const v = new THREE.Vector3();
  return (x, y, z) => {
    v.set(x, y, z).applyMatrix4(inv);
    return whole(v.x, v.y, v.z);
  };
}

let boneCache: Sdf | null = null;
/** Every bone the abdominal wall can meet (ribs 6 to 12 and their cartilages, the xiphoid, the lumbar column, sacrum, hip bones and femurs), one field in THIS frame. */
function wallBones(): Sdf {
  if (boneCache) return boneCache;
  const fields: { f: Sdf; y0: number; y1: number }[] = [];
  const add = (f: Sdf, y0: number, y1: number): void => {
    fields.push({ f, y0, y1 });
  };
  for (const side of [1, -1]) {
    for (let n = 6; n <= 12; n++) add(polySdf(mirrorPts(ribPointsBody(n), side), 0.0036), -0.1, 0.2);
    for (let n = 6; n <= 10; n++) add(polySdf(mirrorPts(cartilagePointsBody(n), side), 0.0032), 0.0, 0.2);
    const hip = hipBoneField();
    const fem = femurField();
    // The pelvic group is rigid at -0.045, so the hip bone and femur fields are asked at the body height.
    add((x, y, z) => hip(side * x, y + 0.045, z), -0.32, 0.05);
    add((x, y, z) => fem(side * x, y + 0.045, z), -0.45, -0.05);
  }
  add(xiphoidField(), 0.1, 0.15);
  const sac = sacrumField();
  add((x, y, z) => sac(x, y - SACRAL_SHIFT, z), -0.3, 0.0);
  const verts = COLUMN_LEVELS.filter((l) => l.kind === 'lumbar' || l.id === 't12' || l.id === 't11').map((l) => ({ y: l.y + warpOffsetY(l.y), f: vertebraScene(l.id) }));
  boneCache = (x, y, z) => {
    const sy = y - TO_LOCAL_Y;
    let d = Infinity;
    for (const f of fields) if (sy >= f.y0 && sy <= f.y1) d = Math.min(d, f.f(x, sy, z));
    for (const v of verts) if (Math.abs(sy - v.y) < 0.03) d = Math.min(d, v.f(x, sy, z));
    return d;
  };
  return boneCache;
}
const bones: Sdf = (x, y, z) => wallBones()(x, y, z);

/** Keep row points off the bones: a point nearer than `r` is moved out along the field's gradient. */
function clearRows(rows: readonly (readonly V3[])[], r: number): V3[][] {
  return rows.map((row) => row.map((p): V3 => (bones(p[0], p[1], p[2]) < r ? seat(bones, p, r + 0.0002) : p)));
}

/** A tube of the wall, routed round the bones. */
function wallBelly(pts: readonly V3[], rMax: number, k: number, o: Parameters<typeof belly>[3] = {}): BG {
  return belly(routed(bones, pts, rMax * k + 0.0008, 8), rMax, k, o);
}

/* ------------------------------------------------------------------ slabs on the wall */

/**
 * A sheet on the trunk surface: `rowsAt(v)` returns the polyline of one row. Rows are given as
 * lists of (y, a) pairs; the sheet passes through them at the layer's depth.
 */
type RowPoint = readonly [number, number] | V3;
function layerSheet(side: number, name: LayerName, rows: readonly (readonly RowPoint[])[], nu: number, nv: number, k: number, extra = 0): BG {
  const L = LAYER[name];
  const pts = rows.map((r) =>
    r.map((q): V3 => {
      // A point of 3 numbers is already in this frame (a bone landmark, right side); a (y, angle) pair is a place on the trunk surface at this layer's depth.
      if (q.length === 3) return onSide(q, side);
      const [y, a] = q as readonly [number, number];
      return onSide(W(trunkPoint(y, a, L.off - extra + L.lift * smooth(L.from, L.to, y))), side);
    }),
  );
  const first = pts[0][0];
  const mid = (first[1] + pts[0][pts[0].length - 1][1]) / 2;
  return ruled(clearRows(pts, 0.0012), L.t + extra, nu, nv, onSide([0, mid, 0], side), k);
}

const range = (a: number, b: number, n: number): number[] => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));

/** The angle of the semilunar line at height y, right side. */
const slAngle = (y: number): number => frontAngle(y, rectusHalfWidth(y));
const midAngle = (y: number): number => frontAngle(y, MIDLINE_HALF);

const spec: Record<string, MuscleSpec> = {};

/* ---- rectus abdominis and its sheath ---- */

const rectusRows = (xLat: (y: number) => number, xMed: (y: number) => number): [number, number][][] => {
  const n = 11;
  const ys = range(0.1165, -0.152, n);
  return [ys.map((y): [number, number] => [y, frontAngle(y, xLat(y))]), ys.map((y): [number, number] => [y, frontAngle(y, (xLat(y) + xMed(y)) / 2)]), ys.map((y): [number, number] => [y, frontAngle(y, xMed(y))])];
};

// RECTUS ABDOMINIS: from the xiphoid process and the fifth to seventh costal cartilages (the top
// of the sheet is at the costal margin) down to the pubic crest and symphysis, in the sheath, lateral to the linea alba.
spec.rectus_abdominis = {
  make: (k, s) => [layerSheet(s, 'rectus', rectusRows(rectusHalfWidth, () => MIDLINE_HALF + 0.001), 10, 2, k)],
};
// TENDINOUS INTERSECTIONS: fibrous bands across the muscle that fix it to the front of the sheath; Gray's: usually three (the xiphoid level, the umbilicus, midway). Drawn at three heights, a little thicker than the muscle.
spec.tendinous_intersections = {
  parent: 'rectus_abdominis',
  make: (k, s) =>
    [0.1, 0.045, -0.012].map((y) => {
      const w = rectusHalfWidth(y);
      const xs = [w, (w + MIDLINE_HALF + 0.001) / 2, MIDLINE_HALF + 0.001];
      const rows = xs.map((x): [number, number][] => [[y + 0.003, frontAngle(y + 0.003, x)], [y - 0.003, frontAngle(y - 0.003, x)]]);
      return layerSheet(s, 'rectus', rows, 2, 2, k, 0.0006);
    }),
};

// RECTUS SHEATH: the anterior layer in front of the muscle for its whole length; the posterior layer behind it down to the arcuate line.
const ARCUATE_Y = -0.052;
spec.rectus_sheath_anterior_layer = {
  parent: 'rectus_sheath',
  make: (k, s) => [layerSheet(s, 'anteriorSheath', rectusRows((y) => rectusHalfWidth(y) + 0.003, () => MIDLINE_HALF), 10, 2, k)],
};
const sheathPosteriorRows = (y0: number, y1: number): [number, number][][] => {
  const ys = range(y0, y1, 7);
  const lat = (y: number): number => rectusHalfWidth(y) + 0.002;
  return [ys.map((y): [number, number] => [y, frontAngle(y, lat(y))]), ys.map((y): [number, number] => [y, frontAngle(y, (lat(y) + MIDLINE_HALF) / 2)]), ys.map((y): [number, number] => [y, frontAngle(y, MIDLINE_HALF)])];
};
spec.rectus_sheath_posterior_layer = {
  parent: 'rectus_sheath',
  make: (k, s) => [layerSheet(s, 'posteriorSheath', sheathPosteriorRows(0.1165, ARCUATE_Y), 8, 2, k)],
};
// ARCUATE LINE: the lower, free, crescentic edge of the posterior layer, a thin band across the back of the rectus.
spec.arcuate_line = {
  parent: 'rectus_sheath',
  make: (k, s) => [layerSheet(s, 'posteriorSheath', sheathPosteriorRows(ARCUATE_Y + 0.003, ARCUATE_Y - 0.001), 4, 2, k, 0.0006)],
};
spec.rectus_sheath = { kids: ['rectus_sheath_anterior_layer', 'rectus_sheath_posterior_layer', 'arcuate_line'] };

// LINEA ALBA: the midline raphe of the three aponeuroses, from the xiphoid process to the pubic symphysis, as a single band through the depth of the wall.
spec.linea_alba = {
  make: (k, s) => {
    if (s < 0) return [];
    const ys = range(0.1165, -0.152, 9);
    const rows = [-MIDLINE_HALF, 0, MIDLINE_HALF].map((x) => ys.map((y): [number, number] => [y, frontAngle(y, x)]));
    return [layerSheet(1, 'rectus', rows, 8, 2, k, 0.0036)];
  },
};

/* ---- the three flat muscles and their aponeuroses ---- */

/** The posterior limit of the flank layers (the lateral border of the erector spinae and latissimus: Gray's gives the posterior attachment as the thoracolumbar fascia); an angle, a drawing choice. */
const A_BACK = 1.0;

/** The anterior superior iliac spine and the pubic tubercle, right side, on the bone, in this frame. */
const asis = (): V3 => P(wingPoint(0.14, -0.064, 0.0058));
const pubicTubercle = (): V3 => P([PUBIC_TUBERCLE[0], PUBIC_TUBERCLE[1] + 0.0036, PUBIC_TUBERCLE[2] + 0.002]);

/** The top edge of the iliac plate (the iliac crest), (s along the plate, y), read off `WING_OUTLINE` in shells/lower_limb_bones.ts. */
const CREST: readonly (readonly [number, number])[] = [[0.0, -0.052], [0.02, -0.04], [0.05, -0.03], [0.085, -0.032], [0.115, -0.045], [0.14, -0.058]];
const crestY = (sv: number): number => {
  for (let i = 0; i < CREST.length - 1; i++) {
    const a = CREST[i];
    const b = CREST[i + 1];
    if (sv >= a[0] && sv <= b[0]) return a[1] + ((b[1] - a[1]) * (sv - a[0])) / (b[0] - a[0]);
  }
  return CREST[CREST.length - 1][1];
};
/** A point on the iliac crest at plate position `sv`, on its outer lip (+), middle or inner lip (-), right side, in this frame. */
const crestPoint = (sv: number, lip: number): V3 => P(wingPoint(sv, crestY(sv) + 0.0032, lip));

/**
 * Rows of a flank layer: the muscle runs from the posterior limit to the semilunar line; the top is
 * at height y0 on the trunk surface and the bottom of every row is a point on the iliac crest (the
 * outer lip for the external oblique, the middle for the internal, the inner lip for the transversus),
 * which is where Gray's has all three attach. `lip` picks the lip.
 */
const muscleRows = (y0: number, lip: number, aBack: number): (readonly RowPoint[])[] =>
  [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const a = aBack + (slAngle(0) - aBack) * f;
    const ys = [y0, (y0 - 0.012) / 2, -0.012];
    return [...ys.map((y): [number, number] => [y, a]), crestPoint(0.02 + 0.12 * f, lip)];
  });
/** Rows of an aponeurosis: from the semilunar line to the linea alba, ending below on the inguinal ligament (lateral) and the pubic tubercle (medial). */
const aponeurosisRows = (y0: number): (readonly RowPoint[])[] =>
  [0, 0.5, 1].map((f) => {
    const ys = range(y0, -0.02, 4);
    const a = asis();
    const b = pubicTubercle();
    const low: V3 = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    return [...ys.map((y): [number, number] => [y, slAngle(y) + (midAngle(y) - slAngle(y)) * f]), low];
  });

// EXTERNAL OBLIQUE: from the outer surfaces of the lower eight ribs, down and in; its muscle ends at the semilunar line and its aponeurosis crosses in front of the rectus to the linea alba and down to the inguinal ligament.
spec.external_oblique_muscle = {
  parent: 'external_oblique',
  make: (k, s) => [layerSheet(s, 'externalOblique', muscleRows(0.105, 0.0042, A_BACK), 5, 4, k)],
};
spec.external_oblique_aponeurosis = {
  parent: 'external_oblique',
  make: (k, s) => [layerSheet(s, 'externalOblique', aponeurosisRows(0.1), 5, 5, k, 0)],
};
spec.external_oblique = { kids: ['external_oblique_muscle', 'external_oblique_aponeurosis'] };

// INTERNAL OBLIQUE: from the thoracolumbar fascia, the iliac crest and the inguinal ligament, up and forward to the lower ribs and the sheath.
spec.internal_oblique = {
  make: (k, s) => [layerSheet(s, 'internalOblique', muscleRows(0.07, 0, A_BACK - 0.05), 5, 4, k), layerSheet(s, 'internalOblique', aponeurosisRows(0.07), 5, 5, k, 0)],
};
// TRANSVERSUS ABDOMINIS: the deepest layer, from the inner surfaces of the lower six costal cartilages, the thoracolumbar fascia, the iliac crest and the inguinal ligament, passing transversely to the linea alba.
spec.transversus_abdominis = {
  make: (k, s) => [layerSheet(s, 'transversus', muscleRows(0.06, -0.0042, A_BACK - 0.1), 5, 4, k), layerSheet(s, 'transversus', aponeurosisRows(0.06), 5, 5, k, 0)],
};

// PYRAMIDALIS: a small triangular muscle in the sheath in front of the lower rectus, from the pubic crest to the linea alba.
spec.pyramidalis = {
  make: (k, s) => {
    const rows: [number, number][][] = [0, 1, 2].map((f) => [
      [-0.13, frontAngle(-0.13, 0.026 - f * 0.011)],
      [-0.1, frontAngle(-0.1, 0.0045 + 0.0035 * f)],
    ]);
    return [layerSheet(s, 'anteriorSheath', rows, 2, 2, k, 0.0018)];
  },
};

/* ---- the inguinal ligament and canal ---- */

// INGUINAL LIGAMENT: the rolled-under lower border of the external oblique aponeurosis, from the anterior superior iliac spine to the pubic tubercle.
spec.inguinal_ligament = {
  make: (k, s) => {
    const a = asis();
    const b = pubicTubercle();
    const m: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.min(trunkRing(-0.11, Math.PI - 0.5)[1], (a[2] + b[2]) / 2 + 0.002)];
    return [tendon(routed(bones, [a, m, b].map((p) => onSide(p, s)), 0.0042, 12), 0.0021, k, 16)];
  },
};

/** The deep ring (in the transversalis fascia, half way along the ligament, above it) and the superficial ring (in the external oblique aponeurosis, above the pubic crest). */
const deepRing = (): V3 => {
  const a = asis();
  const b = pubicTubercle();
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.011, (a[2] + b[2]) / 2 - 0.004];
};
const superficialRing = (): V3 => [pubicTubercle()[0] + 0.0065, pubicTubercle()[1] + 0.0125, pubicTubercle()[2] + 0.0045];
const ringGeometry = (c: V3, r: number): BG => {
  const g = new THREE.TorusGeometry(r, 0.0011, 5, 14);
  g.rotateX(Math.PI / 2);
  g.translate(c[0], c[1], c[2]);
  g.deleteAttribute('uv');
  return g;
};
spec.deep_inguinal_ring = { parent: 'inguinal_canal', make: (k, s) => [ringGeometry(onSide(deepRing(), s), 0.0042 * k)] };
spec.superficial_inguinal_ring = { parent: 'inguinal_canal', make: (k, s) => [ringGeometry(onSide(superficialRing(), s), 0.0042 * k)] };
// INGUINAL CANAL: an oblique channel above the inguinal ligament from the deep ring down and medially to the superficial ring. A schematic glass tube: no cord or ligament is drawn in it.
spec.inguinal_canal = {
  make: (k, s) => [tendon([deepRing(), [(deepRing()[0] + superficialRing()[0]) / 2, (deepRing()[1] + superficialRing()[1]) / 2, (deepRing()[2] + superficialRing()[2]) / 2 + 0.002], superficialRing()].map((p) => onSide(p, s)), 0.0036, k, 10)],
};

/* ---- the posterior wall ---- */

const lumbarSide = (id: string, side: number, dz = 0): V3 => {
  const l = COLUMN_LEVELS.find((v) => v.id === id) ?? COLUMN_LEVELS[0];
  const v = new THREE.Vector3(side * 0.0185, 0, 0.0235 + dz).applyMatrix4(placement(l));
  return S(seat(vertebraScene(id), [v.x, v.y, v.z], 0.0042));
};
const lesserTrochanter = (): V3 => P([LESSER[0] - 0.003, LESSER[1] + 0.0015, LESSER[2] + 0.006]);

// PSOAS MAJOR: from the sides of the bodies of T12 to L5 (and the discs between), down over the pelvic brim, joined by the iliacus, to the lesser trochanter.
spec.psoas_major = {
  parent: 'posterior_abdominal_wall',
  make: (k, s) => {
    // Gray's: psoas major arises thin from the sides of T12 and L1 and thickens downward to its widest in the lower lumbar region, so the belly's thickest point is carried towards the pelvis (skew) and its top starts slim, and its upper origin is kept on the side of the body behind the plane of the pancreas, which lies in front of the upper lumbar column (dz).
    const top = lumbarSide('t12', s, -0.007);
    const mid = lumbarSide('l3', s, -0.004);
    const low = lumbarSide('l5', s);
    const brim = P(wingPoint(0.012, -0.093, -0.0088));
    return [wallBelly([top, mid, low, onSide(brim, s), onSide(lesserTrochanter(), s)], 0.0085, k, { ends: 0.2, skew: 0.75, shape: 0.5, tubular: 16, radial: 7 })];
  },
};
// PSOAS MINOR: a slender muscle in front of the psoas major, from the sides of T12 and L1 to the pectineal line and iliopubic eminence (not always present).
spec.psoas_minor = {
  parent: 'posterior_abdominal_wall',
  make: (k, s) => {
    // Gray's: psoas minor lies on the front of the psoas major; it is drawn level with it, not in front, because the pancreas occupies the space in front of the upper lumbar column in this model.
    const a = lumbarSide('t12', s, -0.003);
    const iliopubic = SUPERIOR_RAMUS[1]; // the iliopubic eminence, lateral on the superior ramus, where Gray's has the minor end; the bowel hangs into the pelvis medial to it
    const b = P([iliopubic[0], iliopubic[1] + 0.0075, iliopubic[2] - 0.004]);
    return [wallBelly([a, lumbarSide('l3', s, -0.001), onSide(b, s)], 0.0022, k, { ends: 0.3, shape: 0.5, tubular: 12, radial: 5 })];
  },
};
// ILIACUS: from the iliac fossa (the smooth inner face of the plate) to the tendon of the psoas major and the lesser trochanter.
spec.iliacus = {
  parent: 'posterior_abdominal_wall',
  make: (k, s) => {
    // Rows follow the plate itself (one row per height, each across three positions along the fossa), so the fan hugs the bowed bone instead of cutting a chord across it.
    const ys = [-0.04, -0.056, -0.072, -0.088, -0.104];
    const target = onSide(lesserTrochanter(), s);
    const rowsY = ys.map((y) => [0.09, 0.07, 0.05].map((sv): V3 => onSide(P(wingPoint(sv, y, -0.0062)), s)));
    const T: V3[] = [0, 1, 2].map((i): V3 => [target[0] + (i - 1) * 0.0015, target[1] + 0.0015, target[2] + (i - 1) * 0.0025]);
    // Gray's: the iliacus is a flat fan that lines the iliac fossa; the caecum and the sigmoid colon rest on it, so it must lie between bone and bowel. Its inner face is the fossa (0.7 mm clear of the bone) and it is thin, standing medially from the bone: `away` is a point beyond the plate's outer face so the thickness is on the bowel side.
    return [ruled(clearRows([...rowsY, T], 0.0006), 0.0018, 3, 6, onSide(P(wingPoint(0.07, -0.07, 0.05)), s), k)];
  },
};
// QUADRATUS LUMBORUM: from the iliac crest (and the iliolumbar ligament) up to the lower border of the twelfth rib and the tips of the transverse processes of the upper four lumbar vertebrae, behind the kidney. Its path is carried back past the kidney's posterior face (scene z -0.071 at its back wall) so it lies behind the organ and not through it.
spec.quadratus_lumborum = {
  parent: 'posterior_abdominal_wall',
  make: (k, s) => {
    const rib = ribPointsBody(12)[3];
    const top = S([rib[0] + 0.001, rib[1] - 0.0066, rib[2] - 0.0005]);
    const crest = P(wingPoint(0.032, crestY(0.032) + 0.0034, -0.002));
    return [wallBelly([onSide(crest, s), onSide(S([0.062, -0.06, -0.088]), s), onSide(S([0.06, -0.005, -0.093]), s), onSide(top, s)], 0.0085, k, { ends: 0.35, shape: 0.5, tubular: 12, radial: 6 })];
  },
};
spec.posterior_abdominal_wall = { kids: ['psoas_major', 'psoas_minor', 'iliacus', 'quadratus_lumborum'] };

/** The geometry of each part, keyed by the part's id in src/data/anatomy/abdominal_wall_muscles.json. */
export function abdominalWallMuscleGroups(): Record<string, BG[]> {
  return groupsOf(spec);
}

/** The parent of each part (absent for a level-1 part): the atlas data must say the same. */
export const ABDOMINAL_WALL_PARENTS: Record<string, string | undefined> = Object.fromEntries(Object.entries(spec).map(([id, s]) => [id, s.parent]));

/** The shell is the level-1 parts only: a child is the same muscle drawn finer. */
export function abdominalWallMuscles(): THREE.BufferGeometry {
  const all = abdominalWallMuscleGroups();
  return mergeParts(levelOne(spec).flatMap((id) => all[id]));
}
