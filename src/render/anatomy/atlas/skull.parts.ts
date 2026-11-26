import * as THREE from 'three';
import type { PartBuilder, PartGeometry } from '../parts';
import {
  SKULL_BOUNDS,
  SKULL_LANDMARKS,
  cranialCavity,
  hyoidField,
  mandibleField,
  maxillarySinus,
  orbitCavity,
  outerEnvelope,
  skullBone,
} from '../shells/skull';
import {
  capsule,
  ellipsoid,
  intersect,
  mergeParts,
  mirroredX,
  offset,
  polygonise,
  roundBox,
  subtract,
  torus,
  tubeAlong,
  type Sdf,
  type V3,
} from '../sdf';

/**
 * INTERIOR PARTS OF THE SKULL (atlas `skull`), in the BRAIN's frame (origin organs.json
 * [0, 0.42, 0]), the frame of the shell in shells/skull.ts.
 *
 * HOW THE BONES ARE CUT. The skull is ONE hollow bone field (`skullBone`), and each bone is a
 * territory of it. A territory is the set of points nearer to that bone's SEEDS (a few
 * segments laid where the bone's body is) than to any other bone's: a Voronoi cell with
 * weights. The cut between two bones is then the bisecting surface of their seeds, which is
 * where a suture runs, and the bones tile the skull exactly with no gap and no overlap, so
 * there is no way for two bones to claim the same bone. `territory(...)` builds the field
 * of one cell; a bone is `skullBone` intersected with it. Tiny bones (a lacrimal) also carry a
 * REACH: they cannot extend further than that from their seeds, or the cell would swell to
 * the size of the cheek. Seeds are drawing choices placed after the usual textbook
 * outline of each bone (frontal above the orbits, parietals either side of the sagittal
 * suture, and so on); they are not measurements and the sutures are therefore not exactly
 * where a real skull has them.
 *
 * CHILDREN. A finer structure is either a sub-territory (the petrous, tympanic, mastoid and
 * squamous parts of a temporal bone are four cells inside the temporal's own) or a mask
 * (a box or ball) cut out of its parent, and is drawn 0.4 mm proud of the parent so the
 * parent's glass does not fight it. The skull's red marrow is not drawn and not claimed:
 * the cited textbook does not name the skull among the red-cell sites, which is not a claim
 * that it holds none.
 *
 * COST. Each part is polygonised in a box that fits it (found from a coarse scan of where the
 * bone is, done once), so the whole atlas is a few seconds of worker time at first open and
 * about 40k triangles. The cell is coarser than the vault's thickness; the bones are solid
 * shells 6.5 mm thick, so every wall is at least two cells.
 *
 * WHAT THIS DOES NOT DO. No marrow, no diploe, no sinuses other than the maxillary one's wall
 * (the nasal-cavity atlas owns the sinuses as air), no nerve foramina other than the
 * foramen magnum and the mental foramen. The brain shell and the ears atlas overlap the bone
 * by a few millimetres (see the shell's header); that is theirs, not drawn around here.
 */

const CELL = 0.0062;
const GROW = 0.0004; // a child stands this far proud of its parent so the two surfaces do not fight

type Seg = readonly [V3, V3];

/** Mirror a right-hand segment across the sagittal plane. */
function flip(s: Seg): Seg {
  return [
    [-s[0][0], s[0][1], s[0][2]],
    [-s[1][0], s[1][1], s[1][2]],
  ];
}

/** A right-hand seed and its mirror image, for a bone that is one part on both sides. */
function pair(...segs: Seg[]): Seg[] {
  return segs.flatMap((s) => [s, flip(s)]);
}

function seg(a: V3, b: V3 = a): Seg {
  return [a, b];
}

/** Distance from a point to a segment. */
function segDist(x: number, y: number, z: number, s: Seg): number {
  const [a, b] = s;
  const bx = b[0] - a[0];
  const by = b[1] - a[1];
  const bz = b[2] - a[2];
  const px = x - a[0];
  const py = y - a[1];
  const pz = z - a[2];
  const len2 = bx * bx + by * by + bz * bz;
  let t = len2 > 1e-12 ? (px * bx + py * by + pz * bz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - bx * t, py - by * t, pz - bz * t);
}

interface Cell {
  id: string;
  seeds: readonly Seg[];
  /** Extra metres of territory (positive) or fewer (negative) against the other cells. */
  bias?: number;
  /** The cell may not extend further than this from its seeds. */
  reach?: number;
}

/** The territory field of each cell: negative where the cell's seeds are the nearest of all. */
function partition(cells: readonly Cell[]): Record<string, Sdf> {
  const dist = (c: Cell, x: number, y: number, z: number): number => {
    let m = Infinity;
    for (const s of c.seeds) {
      const d = segDist(x, y, z, s);
      if (d < m) m = d;
    }
    return m - (c.bias ?? 0);
  };
  const out: Record<string, Sdf> = {};
  for (const c of cells) {
    out[c.id] = (x, y, z) => {
      const own = dist(c, x, y, z);
      let other = Infinity;
      for (const o of cells) {
        if (o === c) continue;
        const d = dist(o, x, y, z);
        if (d < other) other = d;
      }
      const t = own - other;
      return c.reach === undefined ? t : Math.max(t, own - c.reach);
    };
  }
  return out;
}

/** The main bones' seeds. Right side given, mirrored where the bone is paired. */
const TOP = 0.058;
function mainCells(): Cell[] {
  const [gx] = SKULL_LANDMARKS.globe;
  return [
    {
      id: 'frontal',
      seeds: [
        seg([0, TOP - 0.004, 0.034], [0, 0.012, 0.088]),
        ...pair(seg([0.028, -0.014, 0.06], [0.041, -0.022, 0.07])),
        seg([0, -0.036, 0.082]),
        // the lateral part of the forehead, down to the pterion, or the sphenoid's wing claims it
        ...pair(seg([0.054, 0.012, 0.046], [0.047, 0.04, 0.04])),
      ],
    },
    {
      id: 'parietal_r',
      seeds: [seg([0.03, TOP, -0.04], [0.058, 0.012, -0.015]), seg([0.05, 0.0, -0.045], [0.04, 0.03, -0.062])],
    },
    {
      id: 'parietal_l',
      seeds: [flip(seg([0.03, TOP, -0.04], [0.058, 0.012, -0.015])), flip(seg([0.05, 0.0, -0.045], [0.04, 0.03, -0.062]))],
    },
    {
      id: 'occipital',
      seeds: [
        seg([0, 0.02, -0.092], [0, -0.07, -0.062]),
        seg([0, -0.078, -0.03], [0, -0.07, -0.026]),
        ...pair(seg([0.027, 0.0, -0.088], [0.042, -0.045, -0.07]), seg([0.012, -0.085, -0.024])),
      ],
    },
    {
      id: 'temporal_r',
      seeds: [
        seg([0.063, -0.012, 0.0], [0.0675, -0.036, -0.02]),
        seg([0.05, -0.048, -0.02], [0.034, -0.052, -0.004]),
        seg([0.06, -0.058, -0.03]),
        seg([0.0665, -0.041, 0.012], [0.0645, -0.0405, -0.012]),
      ],
    },
    {
      id: 'temporal_l',
      seeds: [
        flip(seg([0.063, -0.012, 0.0], [0.0675, -0.036, -0.02])),
        flip(seg([0.05, -0.048, -0.02], [0.034, -0.052, -0.004])),
        flip(seg([0.06, -0.058, -0.03])),
        flip(seg([0.0665, -0.041, 0.012], [0.0645, -0.0405, -0.012])),
      ],
    },
    {
      id: 'sphenoid',
      seeds: [
        seg([0, -0.046, 0.012], [0, -0.044, 0.022]),
        ...pair(
          seg([0.056, -0.025, 0.034], [0.052, -0.045, 0.018]), // greater wings
          seg([0.02, -0.038, 0.036], [0.03, -0.036, 0.042]), // lesser wings
          seg([0.017, -0.062, 0.022], [0.019, -0.086, 0.029]), // pterygoid processes
          seg([0.014, -0.03, 0.03]), // the orbital apex
        ),
      ],
      bias: 0.002,
    },
    {
      id: 'ethmoid',
      // Raised 2 cm from the first draft: the cribriform plate is the floor of the cranial cavity
      // directly under the brain atlas's olfactory bulbs (bulb centres at x +-0.011, y about
      // -0.019, z 0.066), not the nasal cavity's roof.
      seeds: [
        seg([0, -0.036, 0.058]),
        seg([0, -0.048, 0.046], [0, -0.072, 0.04]),
        ...pair(seg([0.013, -0.04, 0.053], [0.012, -0.03, 0.06]), seg([0.011, -0.03, 0.064]), seg([0.0125, -0.058, 0.052], [0.0125, -0.05, 0.057])),
      ],
      bias: 0.003,
    },
    { id: 'nasal', seeds: pair(seg([0.0045, -0.046, 0.077], [0.006, -0.062, 0.085])), reach: 0.0075 },
    {
      id: 'maxilla',
      seeds: pair(seg([0.022, -0.068, 0.048], [0.02, -0.088, 0.045]), seg([0.012, -0.052, 0.07]), seg([0.01, -0.085, 0.04])),
    },
    {
      id: 'zygomatic',
      seeds: pair(seg([gx + 0.016, -0.048, 0.055], [0.06, -0.044, 0.04])),
    },
    { id: 'lacrimal', seeds: pair(seg([0.0105, -0.0365, 0.07])), reach: 0.0058 },
    { id: 'palatine', seeds: pair(seg([0.012, -0.0885, 0.024])), reach: 0.0105 },
    { id: 'vomer', seeds: [seg([0, -0.078, 0.036], [0, -0.084, 0.026])], reach: 0.0105 },
  ];
}

/** Where on a path through the bone does the coarse scan look? A list of points near the bone, made once. */
function scanPoints(): V3[] {
  const bone = skullBone();
  const man = mandibleField();
  const hy = hyoidField();
  const pts: V3[] = [];
  const step = 0.0045;
  for (let x = SKULL_BOUNDS.min[0]; x <= SKULL_BOUNDS.max[0]; x += step) {
    for (let y = SKULL_BOUNDS.min[1]; y <= SKULL_BOUNDS.max[1]; y += step) {
      for (let z = SKULL_BOUNDS.min[2]; z <= SKULL_BOUNDS.max[2]; z += step) {
        if (bone(x, y, z) < 0.004 || man(x, y, z) < 0.004 || hy(x, y, z) < 0.003) pts.push([x, y, z]);
      }
    }
  }
  return pts;
}

let SCAN: V3[] | null = null;
let SCAN_BONE: Float32Array | null = null;
/** The scan point being tested and its precomputed bone value: `skullBone` is by far the dearest field, and it is asked about the same points by every part. */
const cursor = { x: NaN, y: NaN, z: NaN, bone: 0 };

/** Polygonise `field` in the box that fits it. `scan` limits where to look; undefined falls back to the whole skull. */
function build(field: Sdf, cell = CELL, box?: { min: V3; max: V3 }): THREE.BufferGeometry | null {
  let min: [number, number, number] = [Infinity, Infinity, Infinity];
  let max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  if (box) {
    min = [...box.min];
    max = [...box.max];
  } else {
    if (!SCAN) {
      SCAN = scanPoints();
      const bone = skullBone();
      SCAN_BONE = new Float32Array(SCAN.length);
      SCAN.forEach(([x, y, z], i) => (SCAN_BONE![i] = bone(x, y, z)));
    }
    for (let i = 0; i < SCAN.length; i++) {
      const [x, y, z] = SCAN[i];
      cursor.x = x;
      cursor.y = y;
      cursor.z = z;
      cursor.bone = SCAN_BONE![i];
      if (field(x, y, z) >= 0.0005) continue;
      if (x < min[0]) min[0] = x;
      if (y < min[1]) min[1] = y;
      if (z < min[2]) min[2] = z;
      if (x > max[0]) max[0] = x;
      if (y > max[1]) max[1] = y;
      if (z > max[2]) max[2] = z;
    }
    cursor.x = NaN;
    if (min[0] === Infinity) return null;
    for (let i = 0; i < 3; i++) {
      min[i] -= 0.006;
      max[i] += 0.006;
    }
  }
  const g = polygonise(field, min, max, { cell });
  if (!g.index || g.index.count === 0) {
    g.dispose();
    return null;
  }
  return g;
}

/** A visible placeholder where a part's field came out empty: a tiny sphere, and a warning for the probe. */
function fallback(id: string, at: V3): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.0015, 6, 4);
  g.deleteAttribute('uv');
  g.translate(at[0], at[1], at[2]);
  (g as THREE.BufferGeometry & { userData: { empty?: string } }).userData.empty = id;
  return g;
}

/** Height of the cranial floor at (x, z): where the cavity's field changes sign going up from below. */
function floorY(x: number, z: number): number {
  const c = cranialCavity();
  let lo = -0.07;
  let hi = 0.0;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (c(x, mid, z) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Every part the builder returns, in order. */
const out: PartGeometry[] = [];

function add(id: string, field: Sdf, at: V3, cell = CELL, box?: { min: V3; max: V3 }): void {
  out.push({ id, geometry: build(field, cell, box) ?? fallback(id, at) });
}

/** The mirror image of a geometry across the sagittal plane (x -> -x), with its winding turned back outwards. */
function mirrored(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const m = g.clone();
  m.scale(-1, 1, 1);
  const index = m.index;
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const b = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, b);
    }
  }
  return m;
}

/**
 * A part that is one on each side: build the right-hand half in a box that fits it and add
 * its mirror image. Much cheaper than polygonising a box that spans the empty middle of the
 * face, and exactly symmetrical. Only for parts that do not touch the midline (a join there
 * would leave a wall).
 */
function addPair(id: string, right: Sdf, at: V3, cell = CELL, bx?: { min: V3; max: V3 }): void {
  const g = build(right, cell, bx);
  if (!g) {
    out.push({ id, geometry: fallback(id, at) });
    return;
  }
  out.push({ id, geometry: mergeParts([g, mirrored(g)]) });
}

/** A tube of constant radius along a path (open ended, a lining). */
function tube(points: readonly V3[], radius: number, tubular = 10, radial = 8): THREE.BufferGeometry {
  return tubeAlong(points, () => radius, { tubular, radial });
}

function box(c: V3, h: V3): { min: V3; max: V3 } {
  return { min: [c[0] - h[0], c[1] - h[1], c[2] - h[2]], max: [c[0] + h[0], c[1] + h[1], c[2] + h[2]] };
}

export const parts: PartBuilder = () => {
  out.length = 0;
  SCAN = null;
  const rawBone = skullBone();
  // During the scan the answer is already known; everywhere else compute it.
  const bone: Sdf = (x, y, z) => (x === cursor.x && y === cursor.y && z === cursor.z ? cursor.bone : rawBone(x, y, z));
  const cavity = cranialCavity();
  const cells = partition(mainCells());
  const own = (id: string): Sdf => intersect(bone, cells[id]);
  const proud = (f: Sdf): Sdf => offset(f, GROW);
  const SM = 0.0047; // the cell for thin or small pieces

  /* ---- the cranial bones, then the face --------------------------------------------- */
  add('frontal_bone', own('frontal'), [0, 0.03, 0.07]);
  add('parietal_bone_right', own('parietal_r'), [0.04, 0.03, -0.02]);
  add('parietal_bone_left', own('parietal_l'), [-0.04, 0.03, -0.02]);
  add('temporal_bone_right', own('temporal_r'), [0.06, -0.04, -0.01]);
  add('temporal_bone_left', own('temporal_l'), [-0.06, -0.04, -0.01]);
  add('occipital_bone', own('occipital'), [0, -0.03, -0.085]);
  add('sphenoid_bone', own('sphenoid'), [0, -0.045, 0.02]);
  add('ethmoid_bone', own('ethmoid'), [0, -0.05, 0.055], SM);
  add('nasal_bones', own('nasal'), [0, -0.05, 0.08], SM);
  add('maxillae', own('maxilla'), [0.02, -0.07, 0.045]);
  add('zygomatic_bones', own('zygomatic'), [0.05, -0.048, 0.05], SM);
  add('lacrimal_bones', own('lacrimal'), [0.011, -0.036, 0.07], 0.0022, box([0, -0.0365, 0.07], [0.02, 0.01, 0.01]));
  add('palatine_bones', own('palatine'), [0.012, -0.0885, 0.024], SM);
  add('vomer', own('vomer'), [0, -0.08, 0.03], SM);

  /* ---- inferior nasal conchae: a scroll of thin plate on each outer wall of the nose ----- */
  {
    const scroll = subtract(
      subtract(ellipsoid([0.0172, -0.0775, 0.053], [0.0042, 0.0042, 0.0165]), ellipsoid([0.0148, -0.0795, 0.053], [0.0035, 0.0038, 0.0175])),
      ellipsoid([0.0125, -0.083, 0.053], [0.006, 0.003, 0.02]),
    );
    addPair('inferior_nasal_conchae', scroll, [0.0165, -0.0775, 0.053], 0.0019, box([0.0155, -0.0775, 0.053], [0.0075, 0.007, 0.02]));
  }

  /* ---- the lower jaw and the hyoid ------------------------------------------------------ */
  const mand = mandibleField();
  add('mandible', mand, [0, -0.115, 0.06], SM);
  add('hyoid', hyoidField(), [0, -0.1155, 0.0225], 0.0019, box([0, -0.1135, 0.0112], [0.027, 0.008, 0.016]));

  /* ---- sutures: a thin raised ribbon where two bones' territories meet on the outside ----- */
  {
    const env = outerEnvelope();
    const group = (ids: string[]): Sdf => (x, y, z) => {
      let best = Infinity;
      // territory fields are d_i - min_others, so the smallest of them is the nearest bone's
      for (const id of ids) best = Math.min(best, cells[id](x, y, z));
      return best;
    };
    const ribbon = (a: string[], b: string[], half = 0.0012): Sdf => {
      const ta = group(a);
      const tb = group(b);
      return (x, y, z) => {
        const e = env(x, y, z);
        // Only within a millimetre of the outside of the bone, and only where there is bone.
        const slab = Math.abs(e - 0.0004) - 0.0007;
        if (slab > 0.002) return slab;
        const onBone = bone(x, y, z) - 0.0009;
        return Math.max(Math.abs(ta(x, y, z) - tb(x, y, z)) * 0.5 - half, onBone, slab);
      };
    };
    const SUT = 0.0021;
    add('coronal_suture', ribbon(['frontal'], ['parietal_r', 'parietal_l']), [0, 0.056, 0.016], SUT, box([0, 0.015, 0.025], [0.08, 0.055, 0.02]));
    add('sagittal_suture', ribbon(['parietal_r'], ['parietal_l']), [0, 0.065, -0.03], SUT, box([0, 0.05, -0.03], [0.008, 0.02, 0.06]));
    add('lambdoid_suture', ribbon(['occipital'], ['parietal_r', 'parietal_l']), [0, 0.03, -0.075], SUT, box([0, 0.0, -0.07], [0.08, 0.07, 0.03]));
    add('squamous_sutures', ribbon(['temporal_r', 'temporal_l'], ['parietal_r', 'parietal_l']), [0.065, 0.0, -0.01], SUT, box([0, 0.0, -0.015], [0.08, 0.03, 0.05]));
  }

  /* ---- spaces of the skull: orbits, the three cranial fossae, the foramen magnum, the ear canals ----- */
  {
    // Each orbit: the cone itself, a closed glass-like volume from the rim to the optic canal.
    const o = orbitCavity(0.0007);
    const rim = SKULL_LANDMARKS.orbitRim[2] + 0.004;
    const cone: Sdf = (x, y, z) => Math.max(o(x, y, z), z - rim);
    addPair('orbits', (x, y, z) => cone(Math.abs(x), y, z), [0.031, -0.034, 0.06], 0.0048, box([0.031, -0.034, 0.055], [0.024, 0.022, 0.038]));

    // The cranial floor in three steps. Each is the inner layer of the bone, a little proud of
    // the cavity, cut by the plane that separates the fossae (the sphenoid's lesser wings in
    // front, the petrous ridges and the dorsum sellae behind).
    const layer: Sdf = (x, y, z) => Math.max(cavity(x, y, z) - 0.0042, -(cavity(x, y, z) + 0.0004), y + 0.018);
    const floorOnly = (zMin: number, zMax: number): Sdf => (x, y, z) => Math.max(layer(x, y, z), zMin - z, z - zMax);
    const FC = 0.006;
    add('anterior_cranial_fossa', floorOnly(0.03, 0.1), [0, -0.04, 0.055], FC, box([0, -0.03, 0.065], [0.078, 0.03, 0.04]));
    add('middle_cranial_fossa', floorOnly(-0.017, 0.03), [0.04, -0.045, 0.01], FC, box([0, -0.045, 0.006], [0.078, 0.03, 0.03]));
    add('posterior_cranial_fossa', floorOnly(-0.1, -0.017), [0, -0.07, -0.05], FC, box([0, -0.065, -0.058], [0.078, 0.04, 0.045]));

    const [fx, fy, fz] = SKULL_LANDMARKS.foramenMagnum;
    add('foramen_magnum', torus([fx, fy + 0.0035, fz], 0.0135, 0.0017, 1), [fx, fy, fz], 0.0019, box([fx, fy + 0.0035, fz], [0.0165, 0.004, 0.0165]));

    const m = SKULL_LANDMARKS;
    const canal = (s: number): THREE.BufferGeometry =>
      tube(
        [
          [s * m.meatusOuter[0], m.meatusOuter[1], m.meatusOuter[2]],
          [s * 0.0775, m.meatusOuter[1], m.meatusOuter[2]],
          [s * m.meatusInner[0], m.meatusInner[1], m.meatusInner[2]],
        ],
        0.0048,
        6,
        10,
      );
    out.push({ id: 'external_acoustic_meatus', geometry: mergeParts([canal(1), canal(-1)]) });
  }

  /* ---- the mastoid process: the bony bulge behind each ear canal ------------------------ */
  addPair(
    'mastoid_process',
    intersect(bone, ellipsoid([0.06, -0.058, -0.03], [0.0115, 0.0165, 0.013])),
    [0.06, -0.058, -0.03],
    SM,
    box([0.06, -0.058, -0.03], [0.016, 0.02, 0.016]),
  );

  /* ---- the jaw joint: both sides, a glass capsule round condyle, disc and fossa --------- */
  {
    const [cx, cy, cz] = SKULL_LANDMARKS.fossa;
    const b = box([cx, -0.0545, cz], [0.012, 0.012, 0.014]);
    const ell = (c: V3, r: V3): Sdf => ellipsoid(c, r);
    addPair('temporomandibular_joint', ell([cx, -0.0545, cz], [0.0088, 0.0072, 0.0088]), [cx, -0.0545, cz], 0.0026, b);
    addPair('articular_disc', ell([cx, -0.0553, cz + 0.0015], [0.0058, 0.0011, 0.0056]), [cx, -0.0553, cz], 0.0012, b);
    // The fossa: a shallow bowl of bone, only the lower half of an ellipsoid shell.
    const bowl = ell([cx, cy - 0.0005, cz], [0.0072, 0.0034, 0.0072]);
    addPair('mandibular_fossa', (x, y, z) => Math.max(Math.abs(bowl(x, y, z)) - 0.0009, y - (cy - 0.0004)), [cx, cy, cz], 0.0016, b);
    addPair('articular_eminence', capsule([0.0545, cy + 0.0004, cz + 0.0095], [0.0665, cy + 0.0004, cz + 0.0095], 0.0026), [cx, cy, cz + 0.0095], 0.0016, box([cx, cy, cz + 0.0095], [0.012, 0.007, 0.007]));
    const shell = ell([cx, -0.0545, cz], [0.0102, 0.0094, 0.0102]);
    addPair('joint_capsule', (x, y, z) => Math.abs(shell(x, y, z)) - 0.0005, [cx, -0.0545, cz], 0.003, b);
  }

  /* ---- the mandible's parts, cut from the mandible field ------------------------------------------- */
  {
    const mc = partition([
      { id: 'body', seeds: pair(seg([0, -0.1155, 0.0645], [0.0215, -0.1155, 0.019]), seg([0.0295, -0.1148, 0.004])) },
      { id: 'ramus', seeds: pair(seg([0.0545, -0.098, -0.016], [0.0545, -0.06, -0.013])) },
      { id: 'angle', seeds: pair(seg([0.05, -0.1135, -0.021])), reach: 0.0105 },
      { id: 'condyle', seeds: pair(seg([0.0565, -0.07, -0.0165], SKULL_LANDMARKS.condyle)) },
      { id: 'coronoid', seeds: pair(seg([0.0525, -0.0715, 0.0035], [0.0525, -0.0575, 0.0035])) },
    ]);
    const m = proud(mand);
    // Everything but the body is away from the midline: build the right half and mirror it.
    const rightOnly = (f: Sdf): Sdf => (x, y, z) => f(Math.abs(x), y, z);
    add('mandibular_body', intersect(m, mc.body), [0, -0.115, 0.06], SM);
    addPair('mandibular_ramus', rightOnly(intersect(m, mc.ramus)), [0.054, -0.083, -0.0155], SM, box([0.054, -0.083, -0.0155], [0.011, 0.034, 0.024]));
    addPair('mandibular_angle', rightOnly(intersect(m, mc.angle)), [0.05, -0.1135, -0.021], SM, box([0.05, -0.1135, -0.021], [0.014, 0.014, 0.014]));
    addPair('condylar_process', rightOnly(intersect(m, mc.condyle)), SKULL_LANDMARKS.condyle, 0.0026, box([0.059, -0.063, -0.016], [0.011, 0.014, 0.012]));
    addPair('coronoid_process', rightOnly(intersect(m, mc.coronoid)), [0.0525, -0.0675, 0.0035], 0.0026, box([0.0525, -0.0665, 0.0035], [0.01, 0.016, 0.012]));
    // The alveolar part: the top of the body, where the lower tooth sockets are carved.
    add('mandibular_alveolar_part', intersect(intersect(m, (_x, y) => y + 0.1115), mc.body), [0, -0.109, 0.06], 0.0036);
    // The mental foramen: the opening on the outside of the body below the second premolar, a small ring.
    const mf: THREE.BufferGeometry[] = [1, -1].map((s) => {
      const t = new THREE.TorusGeometry(0.0021, 0.0007, 6, 12);
      t.deleteAttribute('uv');
      t.rotateY(Math.PI / 2);
      t.translate(s * 0.0292, -0.1167, 0.0468);
      return t;
    });
    out.push({ id: 'mental_foramen', geometry: mergeParts(mf) });
  }

  /* ---- sphenoid, temporal, occipital, ethmoid and maxilla: their parts ----------------------------- */
  {
    const sp = proud(own('sphenoid'));
    const sphenoid = partition([
      { id: 'greater', seeds: pair(seg([0.056, -0.025, 0.034], [0.052, -0.045, 0.018])) },
      { id: 'lesser', seeds: pair(seg([0.02, -0.038, 0.036], [0.03, -0.036, 0.042])) },
      { id: 'pterygoid', seeds: pair(seg([0.017, -0.062, 0.022], [0.019, -0.086, 0.029])) },
      { id: 'body', seeds: [seg([0, -0.046, 0.012], [0, -0.044, 0.022])] },
    ]);
    add('greater_wings', intersect(sp, sphenoid.greater), [0.052, -0.035, 0.026], SM);
    add('lesser_wings', intersect(sp, sphenoid.lesser), [0.025, -0.037, 0.039], SM);
    add('pterygoid_processes', intersect(sp, sphenoid.pterygoid), [0.018, -0.074, 0.026], SM);
    // The sella turcica: the bowl under the pituitary, the lower half of a thin ellipsoid shell.
    const [sx, sy, sz] = SKULL_LANDMARKS.sella;
    const bowl: Sdf = (x, y, z) => Math.max(Math.abs(ellipsoid([sx, sy, sz], [0.0082, 0.0078, 0.0082])(x, y, z)) - 0.001, y - (sy - 0.001));
    add('sella_turcica', bowl, [sx, sy, sz], 0.0016, box([sx, sy - 0.003, sz], [0.011, 0.007, 0.011]));

    for (const side of ['right', 'left'] as const) {
      const r = side === 'right';
      const f = (s: Seg): Seg => (r ? s : flip(s));
      const tp = proud(own(r ? 'temporal_r' : 'temporal_l'));
      const tc = partition([
        { id: 'squamous', seeds: [f(seg([0.063, -0.012, 0.0], [0.0675, -0.032, -0.012]))] },
        { id: 'petrous', seeds: [f(seg([0.05, -0.05, -0.02], [0.034, -0.053, -0.004]))] },
        { id: 'tympanic', seeds: [f(seg([0.0685, -0.038, -0.011], [0.0715, -0.036, -0.011]))], bias: 0.0006 },
        { id: 'mastoid', seeds: [f(seg([0.06, -0.058, -0.03]))] },
        { id: 'styloid', seeds: [f(seg([0.049, -0.06, -0.0125], [0.044, -0.084, 0.001]))], reach: 0.006 },
        { id: 'zygomatic', seeds: [f(seg([0.0665, -0.041, 0.012], [0.0645, -0.0405, -0.012]))] },
      ]);
      const sgn = r ? 1 : -1;
      add(`temporal_squamous_part_${side}`, intersect(tp, tc.squamous), [sgn * 0.066, -0.012, 0.0], SM);
      add(`petrous_part_${side}`, intersect(tp, tc.petrous), [sgn * 0.04, -0.052, -0.01], SM);
      add(`tympanic_part_${side}`, intersect(tp, tc.tympanic), [sgn * 0.07, -0.037, -0.011], 0.0026);
      add(`temporal_mastoid_part_${side}`, intersect(tp, tc.mastoid), [sgn * 0.06, -0.058, -0.03], SM);
      add(`styloid_process_${side}`, intersect(tp, tc.styloid), [sgn * 0.046, -0.072, -0.006], 0.0021);
      add(`temporal_zygomatic_process_${side}`, intersect(tp, tc.zygomatic), [sgn * 0.0655, -0.041, 0.0], SM);
    }

    const oc = proud(own('occipital'));
    add('occipital_condyles', intersect(oc, mirroredX(ellipsoid([0.0105, -0.0845, -0.0245], [0.0125, 0.0085, 0.0155]))), [0.0105, -0.0845, -0.0245], 0.0026);
    add('external_occipital_protuberance', intersect(oc, ellipsoid([0, -0.068, -0.0825], [0.012, 0.0105, 0.0105])), [0, -0.068, -0.0825], 0.0026);

    const et = proud(own('ethmoid'));
    // The cribriform plate is the inner layer of the cranial floor under the olfactory bulbs.
    const floorLayer: Sdf = (x, y, z) => Math.max(cavity(x, y, z) - 0.0042, -(cavity(x, y, z) + 0.0004));
    const plateBox = roundBox([0, -0.03, 0.0605], [0.0165, 0.02, 0.0125], 0.001);
    const fy = floorY(0, 0.0575);
    add('cribriform_plate', intersect(intersect(et, floorLayer), plateBox), [0, fy, 0.0605], 0.0024);
    // The crista galli: a small blade of bone standing up from the cribriform plate in the midline.
    add('crista_galli', roundBox([0, fy + 0.0035, 0.0575], [0.0011, 0.0055, 0.0052], 0.0009), [0, fy + 0.0035, 0.0575], 0.0013, box([0, fy + 0.0035, 0.0575], [0.005, 0.009, 0.009]));
    add('perpendicular_plate', intersect(et, roundBox([0, -0.061, 0.0445], [0.0048, 0.0125, 0.016], 0.001)), [0, -0.061, 0.0445], 0.0024);
    add('ethmoidal_labyrinth', intersect(et, mirroredX(roundBox([0.0165, -0.0555, 0.0525], [0.0125, 0.0105, 0.0135], 0.003))), [0.0165, -0.0555, 0.0525], 0.0034);

    const mx = proud(own('maxilla'));
    // The alveolar process: the arch that carries the teeth, with the eight sockets a side cut in it.
    add('maxillary_alveolar_process', intersect(mx, (_x, y) => y + 0.0815), [0, -0.088, 0.045], 0.004);
    const palate = roundBox([0, -0.091, 0.04], [0.0185, 0.0075, 0.0255], 0.004);
    add('maxillary_palatine_process', intersect(mx, palate), [0, -0.0915, 0.04], 0.0034);
    // The wall of each maxillary sinus: a thin shell round the air space the nasal atlas draws.
    const sinus = maxillarySinus();
    addPair('maxillary_sinus_walls', (x, y, z) => Math.abs(offset(sinus, 0.0008)(Math.abs(x), y, z)) - 0.0008, [0.028, -0.08, 0.048], 0.0036, box([0.028, -0.08, 0.048], [0.015, 0.015, 0.02]));
  }



  return out.map((p) => ({ id: p.id, geometry: p.geometry }));
};
