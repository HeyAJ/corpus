import * as THREE from 'three';
import { mergeParts, type Sdf, type V3 } from '../sdf';
import { warpOffsetY } from '../layout';
import { cageHalfWidth, cageRing, cartilagePointsBody, ribPointsBody, sternalBodyField, sternumZ, xiphoidField } from './thoracic_cage';
import { COLUMN_LEVELS, placement, shapeOf, vertebraParts } from './vertebral_column';
import { CLAVICLE_PTS, coracoidField, humerusField, scapulaField, scapulaZ } from './upper_limb_bones';
import {
  type BG,
  type MuscleSpec,
  belly,
  groupsOf,
  levelOne,
  localFrame,
  onSide,
  polySdf,
  routed,
  ruled,
  seat,
} from './head_neck_muscles';

/**
 * CHEST WALL MUSCLES, SHELL AND PART GEOMETRY. A LAYER organ of the muscles layer, in the thoracic
 * group.
 *
 * FRAME. Origin organs.json [0, 0.2, 0], the rib cage's own origin, and the thoracic group has no
 * exploded-stack offset, so body coordinates are scene coordinates and a muscle is written in the
 * numbers of the bone it meets (`ribPointsBody`, `cartilagePointsBody`, `sternumZ`, the clavicle,
 * the coracoid, the humerus, the scapula, a vertebra's placement). Nothing here is placed by eye:
 * every end is SEATED on the bone it attaches to (`seat`, shells/head_neck_muscles.ts), one
 * end-radius off its surface, and the belly between is routed round the bones it must not enter.
 *
 * THE TREE. Existing ids are kept (`intercostal_muscles`, `pectoralis_major`, `pectoralis_minor`,
 * `serratus_anterior`), so the intercostals are one level-1 group holding the three layers
 * (external, internal, innermost) and each of the first two holds one strip per intercostal space,
 * which is the deepest level allowed. A parent is drawn at full radius and a child slimmer inside
 * it (`CHILD_SLIM`).
 *
 * THE INTERCOSTALS ARE DRAWN FROM THE RIBS. The strip of space n is a ruled sheet between the
 * centre lines of rib n and rib n+1 (`ribPointsBody`), each pulled in by a rib's radius and a
 * clearance so the strip fills the space and does not enter either rib. The three layers are three
 * thin shells through the rib's thickness: external outermost, internal beneath it, innermost
 * deepest. External runs from the tubercle to the costochondral junction; internal from the angle
 * and on, for the upper six spaces, between the costal cartilages to the sternum. The counts of
 * layers and spaces are Gray's; the thickness of each layer is a DRAWING choice, and the strip
 * per space is SCHEMATIC (the direction of the fibres, which differs between the layers in life,
 * is not drawn).
 *
 * THE BROAD MUSCLES. Pectoralis major, pectoralis minor and serratus anterior are ruled sheets
 * from an origin line on the bone (the clavicle, the sternum and cartilages, the ribs) to an
 * insertion line on the humerus, the coracoid or the medial border of the scapula, through a
 * middle row lifted off the cage so the sheet clears the ribs it covers.
 *
 * NOT DRAWN: the serratus posterior muscles (the back muscles' organ), the breast (the breast
 * organ lies over the pectoralis major), and the fibre direction of every layer.
 */

/** The organ's origin, organs.json (the rib cage's). */
export const ORIGIN: V3 = [0, 0.2, 0];
const F = localFrame(ORIGIN, 0);
/** A body point (thoracic group offset 0) in this organ's frame. */
const L = (p: readonly number[]): V3 => F.rigid([p[0], p[1], p[2]], 0);

/* ------------------------------------------------------------------ the cage's surface */

/**
 * A point `off` outward of a point on the cage's cross-section ellipse (the ellipse the ribs are
 * drawn on): the ellipse's own outward normal, by the gradient of x^2/A^2 + z^2/D^2, A the half
 * width at that height and D the depth in front (z > 0) or behind.
 */
export function outward(p: readonly number[], off: number): V3 {
  const y = p[1];
  const A = cageHalfWidth(y);
  const D = p[2] >= 0 ? cageRing(y, Math.PI)[1] : -cageRing(y, 0)[1];
  const nx = p[0] / (A * A);
  const nz = p[2] / (D * D);
  const n = Math.hypot(nx, nz) || 1;
  return [p[0] + (off * nx) / n, y, p[2] + (off * nz) / n];
}

/** The cage ellipse's point at height y and angle a (0 back midline, pi/2 side, pi front midline), body coordinates, right side positive x. */
export function cagePoint(y: number, a: number, off = 0): V3 {
  const [x, z] = cageRing(y, a);
  return outward([x, y, z], off);
}

/**
 * The front of the chest at height y and distance x from the midline. Near the midline the front is
 * the sternum and the costal cartilages, which lie well behind the cage ellipse (the sternum's
 * front at y 0.2 is z 0.075 against the ellipse's 0.10), so the front is the ellipse limited to a
 * ramp that starts at the sternum's front and rises with x until it meets the ribs' own front ends.
 * The two slopes (low on the chest wall, where the cartilages run nearly straight out; high at the
 * top, where the sternum leans back) are DRAWING choices fitted to the ends of ribs 2 and 5 to 7
 * (the first-pass stub's values, which met those ends).
 */
const STERNUM_FRONT_HALF = 0.004;
const RAMP_LOW = 0.03;
const RAMP_HIGH = 0.32;
export function chestFront(y: number, x: number, off = 0): V3 {
  const A = cageHalfWidth(y);
  const D = cageRing(y, Math.PI)[1];
  const r = Math.min(0.999, Math.abs(x) / A);
  const ell = D * Math.sqrt(1 - r * r);
  const t = Math.max(0, Math.min(1, (Math.max(y, 0) - 0.12) / 0.1));
  const slope = RAMP_LOW + (RAMP_HIGH - RAMP_LOW) * t * t * (3 - 2 * t);
  const z = Math.min(ell, sternumZ(Math.max(y, 0)) + STERNUM_FRONT_HALF + slope * Math.abs(x));
  return outward([x, y, z], off);
}

/* ------------------------------------------------------------------ the bones to keep clear of */

const mirrorPts = (pts: readonly V3[], side: number): V3[] => pts.map((p): V3 => [side * p[0], p[1], p[2]]);
const ribField = (n: number, side: number): Sdf => polySdf(mirrorPts(ribPointsBody(n), side), 0.0036);
const cartField = (n: number, side: number): Sdf => polySdf(mirrorPts(cartilagePointsBody(n), side), 0.0032);

/** A vertebra's whole field in scene coordinates (its placement undone). */
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
/** Every bone a chest-wall muscle can meet, as one field in THIS frame: ribs, cartilages, sternum, clavicle, scapula, upper humerus, thoracic vertebrae. */
function chestBones(): Sdf {
  if (boneCache) return boneCache;
  const fields: Sdf[] = [];
  for (const side of [1, -1]) {
    for (let n = 1; n <= 12; n++) fields.push(ribField(n, side));
    for (let n = 1; n <= 10; n++) fields.push(cartField(n, side));
    fields.push(polySdf(mirrorPts(CLAVICLE_PTS, side), 0.0045));
    const sc = scapulaField();
    const hu = humerusField();
    fields.push((x, y, z) => sc(side * x, y, z));
    fields.push((x, y, z) => hu(side * x, y, z));
  }
  fields.push(sternalBodyField(), xiphoidField());
  const verts = COLUMN_LEVELS.filter((l) => l.kind === 'thoracic' || l.id === 'c7').map((l) => ({ y: l.y + warpOffsetY(l.y), f: vertebraScene(l.id) }));
  boneCache = (x, y, z) => {
    const by = y + ORIGIN[1];
    let d = Infinity;
    for (const f of fields) d = Math.min(d, f(x, by, z));
    for (const v of verts) if (Math.abs(by - v.y) < 0.03) d = Math.min(d, v.f(x, by, z));
    return d;
  };
  return boneCache;
}
/** The chest's bones in this organ's own frame, for `routed`. */
const localBones: Sdf = (x, y, z) => chestBones()(x, y, z);

/** A body point seated on a body-frame field, then brought to this frame. */
const seatBody = (f: Sdf, p: readonly number[], clear: number): V3 => L(seat(f, [p[0], p[1], p[2]], clear));

/**
 * Keep every row point of a sheet clear of the bones: a point nearer than `r` is moved out along
 * the field's gradient. The two ends of a row are attachments seated further off than `r`, so they
 * are not moved; the points between them are the ones a straight chord pulls into a rib.
 */
function clearRows(rows: readonly (readonly V3[])[], r: number): V3[][] {
  return rows.map((row) => row.map((p): V3 => (localBones(p[0], p[1], p[2]) < r ? seat(localBones, p, r + 0.0002) : p)));
}

/** A tube of the chest wall, routed round the bones. */
function chestBelly(pts: readonly V3[], rMax: number, k: number, o: Parameters<typeof belly>[3] = {}): BG {
  return belly(routed(localBones, pts, rMax * k + 0.0003, 4), rMax, k, o);
}

/* ------------------------------------------------------------------ the intercostal strips */

const LAYERS = {
  // base surface offset outward of the rib centre line, and thickness; the three shells fill the 7 mm of a rib's thickness. Drawing choices.
  external: { off: 0.0007, thick: 0.0028 },
  internal: { off: -0.0021, thick: 0.0028 },
  innermost: { off: -0.0036, thick: 0.0015 },
} as const;
type Layer = keyof typeof LAYERS;

/** The strip of one intercostal space of one layer, for the patient's right (+1) or left (-1). */
function intercostalStrip(n: number, layer: Layer, side: number, k: number): BG {
  const first = layer === 'external' ? 3 : layer === 'internal' ? 5 : 4;
  let a = ribPointsBody(n).slice(first);
  let b = ribPointsBody(n + 1).slice(first);
  // The internal layer carries on between the costal cartilages of the upper six spaces, as far as the middle of the cartilage (the last part, to the sternum, is left out: it meets the sternal edge at an angle that would cut the bone).
  if (layer === 'internal' && n <= 6) {
    a = [...a, cartilagePointsBody(n)[1]];
    b = [...b, cartilagePointsBody(n + 1)[1]];
  }
  const inset = 0.0036 + 0.0006;
  const cfg = LAYERS[layer];
  const rows = [a, b].map((r, which) =>
    r.map((p, i): V3 => {
      const q = which === 0 ? b[Math.min(i, b.length - 1)] : a[Math.min(i, a.length - 1)];
      const d = new THREE.Vector3(q[0] - p[0], q[1] - p[1], q[2] - p[2]).normalize().multiplyScalar(inset);
      return L(onSide(outward([p[0] + d.x, p[1] + d.y, p[2] + d.z], cfg.off), side));
    }),
  );
  const y = (a[0][1] + b[0][1]) / 2;
  return ruled(clearRows(rows, 0.0006), cfg.thick, Math.max(4, Math.ceil(a.length / 2)), 1, L(onSide([0, y, 0], side)), k);
}

const spec: Record<string, MuscleSpec> = {};

for (const layer of ['external', 'internal', 'innermost'] as const) {
  const id = `${layer}_intercostals`;
  if (layer === 'innermost') {
    // The innermost layer is one sheet per side here: it is not drawn space by space (Gray's: it is the deepest and least separable layer).
    spec[id] = {
      parent: 'intercostal_muscles',
      make: (k, s) => {
        const out: BG[] = [];
        for (let n = 2; n <= 10; n++) out.push(intercostalStrip(n, 'innermost', s, k));
        return out;
      },
    };
    continue;
  }
  const kids: string[] = [];
  for (let n = 1; n <= 11; n++) {
    const kid = `${layer}_intercostal_space_${String(n).padStart(2, '0')}`;
    kids.push(kid);
    spec[kid] = { parent: id, make: (k, s) => [intercostalStrip(n, layer, s, k)] };
  }
  spec[id] = { parent: 'intercostal_muscles', kids };
}
spec.intercostal_muscles = { kids: ['external_intercostals', 'internal_intercostals', 'innermost_intercostals'] };

/* ------------------------------------------------------------------ the deep muscles */

// SUBCOSTALES: thin bands on the inner surface of the lower ribs near their angles, each crossing one or two ribs. Three bands drawn.
spec.subcostales = {
  make: (k, s) =>
    [8, 9, 10].map((n) => {
      const a = ribPointsBody(n)[5];
      const b = ribPointsBody(n + 2)[5];
      const m = ribPointsBody(n + 1)[5];
      const pts = [a, m, b].map((p) => L(onSide(outward(p, -0.0066), s)));
      return chestBelly(pts, 0.0017, k, { ends: 0.5, shape: 0.4, tubular: 8, radial: 5 });
    }),
};

// TRANSVERSUS THORACIS: from the back of the lower sternum and xiphoid process, fanning up and out to the inner surfaces of the costal cartilages 2 to 6.
spec.transversus_thoracis = {
  make: (k, s) =>
    [6, 5, 4, 3, 2].map((n, i) => {
      const y = 0.128 + 0.0125 * i;
      const a = seatBody(sternalBodyField(), [0.006, y, sternumZ(y) - 0.0075], 0.0019);
      const c = cartilagePointsBody(n);
      const m = outward(c[1], -0.0052);
      const b = seatBody((x, yy, z) => cartField(n, 1)(x, yy, z), [m[0], m[1], m[2]], 0.0019);
      return chestBelly([a, b].map((p) => onSide(p, s)), 0.0019, k, { ends: 0.5, shape: 0.4, tubular: 6, radial: 5 });
    }),
};

// LEVATORES COSTARUM: twelve pairs, from the tips of the transverse processes of C7 and T1 to T11 down and out to the outer surface of the rib below, near its tubercle.
const tpTip = (id: string, side: number, clear: number): V3 => {
  const l = COLUMN_LEVELS.find((v) => v.id === id) ?? COLUMN_LEVELS[0];
  const sh = shapeOf(l);
  const a = sh.canalR + sh.archR + 0.0006;
  const v = new THREE.Vector3(side * (a + sh.transLen), 0, l.kind === 'thoracic' ? -0.004 : 0.002).applyMatrix4(placement(l));
  // Start above and behind the tip: on a thoracic vertebra the tip's articular face meets the rib below's tubercle, so the whole bone set is used to keep the origin off the rib as well as the process.
  return seat(localBones, L([v.x, v.y + 0.004, v.z - 0.004]), clear);
};
spec.levatores_costarum = {
  make: (k, s) => {
    const ids = ['c7', ...Array.from({ length: 11 }, (_, i) => `t${i + 1}`)];
    return ids.map((id, j) => {
      const a = tpTip(id, s, 0.0026);
      const rib = ribPointsBody(j + 1)[2];
      // start a little off the rib's centre line: the field has no usable gradient on its axis.
      const out = outward(rib, 0.004);
      const b = seatBody(ribField(j + 1, s), [s * out[0], out[1], out[2]], 0.0028);
      return chestBelly([a, b], 0.0023, k, { ends: 0.45, shape: 0.5, tubular: 4, radial: 4 });
    });
  },
};

/* ------------------------------------------------------------------ pectoralis major */

/** The lateral lip of the intertubercular sulcus of the humerus, between y 0.213 and 0.247, seated on the bone: where pectoralis major inserts. */
const humerusCrest = (y: number, side: number): V3 => L(onSide(seat(humerusField(), [0.1735, y, 0.0125], 0.0026), side));

/** A broad sheet from origin points, through a middle row lifted off the chest, to insertion points. */
function fan(origin: readonly V3[], insertion: readonly V3[], lift: number, thick: number, side: number, k: number, front: boolean): BG {
  const A = origin.map((p) => onSide(p, side));
  const B = insertion.map((p) => onSide(p, side));
  // Two middle rows stand on the cage, a third and two thirds of the way from the origin to the insertion, lifted `lift` off the front (or the side) of the chest.
  const mid = (f: number): V3[] =>
    origin.map((p, i): V3 => {
      const x = p[0] + (insertion[i][0] - p[0]) * f;
      const y = p[1] + (insertion[i][1] - p[1]) * f + ORIGIN[1];
      return onSide(L(front ? chestFront(y, x, lift) : cagePoint(y, Math.PI / 2 + 0.2 + 0.4 * f, lift)), side);
    });
  return ruled(clearRows([A, mid(0.33), mid(0.67), B], 0.0006), thick, Math.max(3, origin.length * 2), 6, onSide([0, (A[0][1] + B[0][1]) / 2, 0], side), k);
}

spec.pectoralis_major_clavicular_part = {
  parent: 'pectoralis_major',
  make: (k, s) => {
    const A = [0, 1, 2].map((i) => {
      const c = CLAVICLE_PTS[i];
      return seatBody(polySdf([CLAVICLE_PTS[0], CLAVICLE_PTS[1], CLAVICLE_PTS[2], CLAVICLE_PTS[3]], 0.0045), [c[0], c[1] - 0.004, c[2] + 0.004], 0.0036);
    });
    const B = [0.2305, 0.2355, 0.2405].map((y) => humerusCrest(y, 1));
    return [fan(A, B, 0.0066, 0.0034, s, k, true)];
  },
};
spec.pectoralis_major_sternocostal_part = {
  parent: 'pectoralis_major',
  make: (k, s) => {
    const ys = [0.232, 0.21, 0.19, 0.17, 0.15, 0.13];
    const A = ys.map((y) => seatBody(sternalBodyField(), [0.012, y, sternumZ(y) + 0.005], 0.0036));
    const B = ys.map((_, i) => humerusCrest(0.2215 + 0.0035 * i, 1));
    return [fan(A, B, 0.0066, 0.0034, s, k, true)];
  },
};
spec.pectoralis_major_abdominal_part = {
  parent: 'pectoralis_major',
  make: (k, s) => {
    const A: V3[] = [
      [0.046, 0.108],
      [0.064, 0.101],
      [0.082, 0.094],
    ].map(([x, y]) => L(chestFront(y, x, 0.0042)));
    const B = [0.2215, 0.2245, 0.2275].map((y) => humerusCrest(y, 1));
    return [fan(A, B, 0.0066, 0.0034, s, k, true)];
  },
};
spec.pectoralis_major = { kids: ['pectoralis_major_clavicular_part', 'pectoralis_major_sternocostal_part', 'pectoralis_major_abdominal_part'] };

// PECTORALIS MINOR: from the outer surfaces of ribs 3 to 5, near their cartilages, up and out to the medial border and upper surface of the coracoid process, deep to pectoralis major.
spec.pectoralis_minor = {
  make: (k, s) => {
    const A = [3, 4, 5].map((n) => seatBody(ribField(n, 1), outward(ribPointsBody(n)[10], 0.003), 0.0036));
    const B = [0.2625, 0.261, 0.2595].map((y, i) => seatBody(coracoidField(), [0.1415 + 0.0006 * i, y, 0.011 + 0.003 * i], 0.0026));
    return [fan(A, B, 0.0036, 0.0028, s, k, false)];
  },
};

// SUBCLAVIUS: from the junction of the first rib and its cartilage, up and out to the groove on the underside of the clavicle.
spec.subclavius = {
  make: (k, s) => {
    const rib1 = ribPointsBody(1);
    const a = seatBody(ribField(1, 1), [rib1[rib1.length - 1][0], rib1[rib1.length - 1][1] + 0.002, rib1[rib1.length - 1][2] + 0.003], 0.0038);
    const c = CLAVICLE_PTS[2];
    const b = seatBody(polySdf(CLAVICLE_PTS, 0.0045), [c[0], c[1] - 0.006, c[2] + 0.001], 0.0038);
    return [chestBelly([a, b].map((p) => onSide(p, s)), 0.0034, k, { ends: 0.4 })];
  },
};

/* ------------------------------------------------------------------ serratus anterior */

/**
 * The medial border of the scapula plate, (y, x) from the superior angle down to the inferior angle,
 * read off `SCAPULA_OUTLINE` (its medial edge: 0.052, 0.263 to 0.062, 0.158).
 */
const MEDIAL_BORDER: readonly (readonly [number, number])[] = [
  [0.263, 0.052],
  [0.235, 0.049],
  [0.2, 0.05],
  [0.168, 0.054],
  [0.158, 0.062],
];
const borderX = (y: number): number => {
  for (let i = 0; i < MEDIAL_BORDER.length - 1; i++) {
    const a = MEDIAL_BORDER[i];
    const b = MEDIAL_BORDER[i + 1];
    if (y <= a[0] && y >= b[0]) return a[1] + ((b[1] - a[1]) * (a[0] - y)) / (a[0] - b[0]);
  }
  return y > 0.263 ? 0.052 : 0.062;
};

/** A point on the front of the medial border of the scapula plate (the face that looks at the ribs), seated on the bone, in this frame. */
const scapulaBorder = (y: number, side: number, clear: number): V3 => L(onSide(seat(scapulaField(), [borderX(y) + 0.004, y, scapulaZ(borderX(y), y) + 0.008], clear), side));

function serratusPart(ribs: number[], ys: number[], k: number, s: number): BG {
  const A = ribs.map((n) => {
    const p = ribPointsBody(n)[8];
    return L(seat(ribField(n, 1), outward(p, 0.004), 0.0038));
  });
  const B = ys.map((y) => scapulaBorder(y, 1, 0.0026));
  // Three middle rows walk the sheet round the cage (side, back-side, back) so its chord cannot cut in towards the ribs.
  const mid = (alpha: number): V3[] => A.map((a, i): V3 => L(cagePoint((a[1] + B[i][1]) / 2 + ORIGIN[1], alpha, 0.0058)));
  return ruled(clearRows([A, mid(1.2), mid(0.95), mid(0.7), B].map((r) => r.map((p) => onSide(p, s))), 0.0006), 0.0026, Math.max(3, ribs.length * 2), 8, onSide([0, (A[0][1] + B[0][1]) / 2, 0], s), k);
}
spec.serratus_anterior_superior_part = { parent: 'serratus_anterior', make: (k, s) => [serratusPart([1, 2], [0.2585, 0.255], k, s)] };
spec.serratus_anterior_intermediate_part = { parent: 'serratus_anterior', make: (k, s) => [serratusPart([2, 3], [0.238, 0.215], k, s)] };
spec.serratus_anterior_inferior_part = { parent: 'serratus_anterior', make: (k, s) => [serratusPart([4, 5, 6, 7, 8], [0.195, 0.18, 0.17, 0.164, 0.16], k, s)] };
spec.serratus_anterior = { kids: ['serratus_anterior_superior_part', 'serratus_anterior_intermediate_part', 'serratus_anterior_inferior_part'] };

/** The geometry of each part, keyed by the part's id in src/data/anatomy/chest_wall_muscles.json. */
export function chestWallMuscleGroups(): Record<string, BG[]> {
  return groupsOf(spec);
}

/** The parent of each part (absent for a level-1 part): the atlas data must say the same. */
export const CHEST_WALL_PARENTS: Record<string, string | undefined> = Object.fromEntries(Object.entries(spec).map(([id, s]) => [id, s.parent]));

/** The shell is the level-1 parts only: a child is the same muscle drawn finer. */
export function chestWallMuscles(): THREE.BufferGeometry {
  const all = chestWallMuscleGroups();
  return mergeParts(levelOne(spec).flatMap((id) => all[id]));
}
