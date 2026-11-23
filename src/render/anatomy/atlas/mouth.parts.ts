import * as THREE from 'three';
import type { PartBuilder, PartGeometry } from '../parts';
import { ellipsoid, mergeParts, polygonise, smoothUnion, tubeAlong, type Sdf, type V3 } from '../sdf';
import { mulberry32 } from '../noise';
import { bead, beads, cord, ribbon as sheet } from './gland_shared';
import { blob, blobAlong, cone, stick } from './gi_shared';

/**
 * THE INSIDE OF THE MOUTH: lips, vestibule, gums, teeth, palate, tongue, floor, mucosa and
 * two magnified diagrams (a taste bud and a molar).
 *
 * FRAME. The organ's own, origin organs.json [0, 0.32, 0.042]: +x the patient's right, +y
 * cranial, +z anterior, metres. The shell (shells/mouth.ts) is an oral cavity of radii
 * 0.027 / 0.012 / 0.027 with the lips on its front, so every number below was chosen to fit
 * inside that ellipsoid; where a first guess poked through it (the hyoid end of hyoglossus,
 * the first glossopharyngeal start) the point was pulled in rather than the shell enlarged,
 * because the glass head is fitted to this shell.
 *
 * WHAT IS AND IS NOT ANATOMY. The textbook ARRANGEMENT is followed: which structure lies
 * above, below, in front of or beside which. Every SIZE, COUNT AND SPACING is a drawing
 * choice. The dental arch is smaller than a real one and the teeth are drawn at about two
 * thirds of their real width so that thirty-two of them fit round it with the layout Gray's
 * gives (two incisors, a canine, two premolars and three molars in each quarter). The
 * papillae are fewer and larger than real, and the taste bud and the molar are MAGNIFIED
 * diagrams floating in the free space above the tongue: they are not at true size or at a
 * true place, and their summaries say so.
 *
 * THE BACK OF THE MOUTH. The first drawing ended at z -0.021 and left 2 cm of nothing between
 * it and the pharynx. The shell now carries the cavity back through a doorway (the isthmus of
 * the fauces, shells/mouth.ts) to z -0.030, which is where the pharynx's front wall is, and
 * everything behind the terminal sulcus was moved back to fill it: the root of the tongue forms
 * the doorway's floor and the throat's front wall, the soft palate runs back to its roof, and
 * the palatoglossal folds are its side walls. The oral two-thirds and the pharyngeal third of
 * the tongue are therefore drawn in about that proportion, with the terminal sulcus between.
 *
 * HISTORY. Everything here replaces a four-primitive stub (a lip blob, a palate blob, a
 * tongue blob and one rod for all the teeth). The first draft of the arch put the molars'
 * roots outside the shell at the corners of the mouth; the arch is now laid out as a U with
 * straight sides so the back teeth stay inside the cavity.
 */

/* ------------------------------------------------------------------ helpers */

const merge = (g: THREE.BufferGeometry[]): THREE.BufferGeometry => mergeParts(g);
const line = (a: V3, b: V3, r: number): THREE.BufferGeometry => stick(a, b, r, 4);
const torusAt = (c: V3, major: number, minor: number, radial = 3, tubular = 10): THREE.BufferGeometry => {
  const g = new THREE.TorusGeometry(major, minor, radial, tubular);
  g.rotateX(Math.PI / 2);
  g.translate(c[0], c[1], c[2]);
  return g;
};

/** A closed ellipse in a plane of constant z, as a tube: the lips and their muscle. */
function ellipseRing(hx: number, hy: number, z: number, r: number, n = 20): THREE.BufferGeometry {
  const pts: V3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([hx * Math.cos(a), hy * Math.sin(a), z]);
  }
  return tubeAlong(pts, () => r, { tubular: n * 2, radial: 5, closed: true });
}

/* --------------------------------------------------------------- the arch */

/**
 * The right half of the dental arch in plan, from the midline at the front round to the back
 * of the row. A U with straight sides, a drawing choice (see the HISTORY note).
 */
const ARCH_RIGHT = new THREE.CatmullRomCurve3(
  ([
    [0, 0, 0.019],
    [0.004, 0, 0.0185],
    [0.0085, 0, 0.0165],
    [0.0125, 0, 0.013],
    [0.0155, 0, 0.008],
    [0.017, 0, 0.002],
    [0.0175, 0, -0.004],
    [0.0173, 0, -0.0095],
  ] as V3[]).map((p) => new THREE.Vector3(p[0], p[1], p[2])),
);
const ARCH_LEN = ARCH_RIGHT.getLength();

/** A point on the arch at arc length `s` from the midline, on `side` (+1 right, -1 left), pushed `out` metres outward. */
function archAt(s: number, side: number, y: number, out = 0): { p: V3; t: THREE.Vector3; n: THREE.Vector3 } {
  const u = Math.max(0, Math.min(1, s / ARCH_LEN));
  const c = ARCH_RIGHT.getPointAt(u);
  const t = ARCH_RIGHT.getTangentAt(u);
  // Outward normal in plan: the tangent turned a quarter turn away from the arch's inside.
  const n = new THREE.Vector3(-t.z, 0, t.x).normalize();
  return { p: [side * (c.x + n.x * out), y, c.z + n.z * out], t: new THREE.Vector3(side * t.x, 0, t.z), n: new THREE.Vector3(side * n.x, 0, n.z) };
}

/** The whole arch as one polyline from the back of the left side, round the front, to the back of the right. */
function archPath(y: number, out = 0, n = 9): V3[] {
  const pts: V3[] = [];
  for (let i = n; i >= 1; i--) pts.push(archAt((i / n) * ARCH_LEN, -1, y, out).p);
  for (let i = 0; i <= n; i++) pts.push(archAt((i / n) * ARCH_LEN, 1, y, out).p);
  return pts;
}

/* ------------------------------------------------------------------- teeth */

type Kind = 'incisor' | 'canine' | 'premolar' | 'molar';
interface Row { kind: Kind; w: number; hc: number; th: number; root: number }
/** One quarter of the jaw, midline outward: Gray's gives 2 incisors, 1 canine, 2 premolars, 3 molars. Sizes are display choices. */
const QUARTER: Row[] = [
  { kind: 'incisor', w: 0.0036, hc: 0.0036, th: 0.0022, root: 0.003 },
  { kind: 'incisor', w: 0.0032, hc: 0.0034, th: 0.0022, root: 0.003 },
  { kind: 'canine', w: 0.0038, hc: 0.0038, th: 0.003, root: 0.0032 },
  { kind: 'premolar', w: 0.004, hc: 0.0034, th: 0.0036, root: 0.0028 },
  { kind: 'premolar', w: 0.004, hc: 0.0034, th: 0.0036, root: 0.0028 },
  { kind: 'molar', w: 0.0052, hc: 0.003, th: 0.0044, root: 0.0026 },
  { kind: 'molar', w: 0.005, hc: 0.003, th: 0.0044, root: 0.0026 },
  { kind: 'molar', w: 0.0046, hc: 0.0028, th: 0.0042, root: 0.0024 },
];
/** Height of the biting surface above (upper) or below (lower) the mid-plane. A thin gap keeps the jaws from fusing. */
const BITE = 0.0004;

function teeth(kinds: readonly Kind[], grow = 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [1, -1]) {
    for (const up of [1, -1]) {
      let s = 0.0003;
      for (const row of QUARTER) {
        const mid = s + row.w / 2;
        s += row.w + 0.0001;
        if (!kinds.includes(row.kind)) continue;
        const { p, t, n } = archAt(mid, side, 0);
        const yc = up * (BITE + row.hc / 2);
        const g = new THREE.SphereGeometry(1, 7, 5);
        g.deleteAttribute('uv');
        g.scale((row.w / 2) * grow, (row.hc / 2) * grow, (row.th / 2) * grow);
        const tt = t.clone();
        const up3 = new THREE.Vector3(0, 1, 0);
        // makeBasis must stay right-handed or the faces turn inside out: flip the tangent if not.
        if (tt.dot(new THREE.Vector3().crossVectors(up3, n)) < 0) tt.negate();
        const m = new THREE.Matrix4().makeBasis(tt, up3, n);
        m.setPosition(p[0], yc, p[2]);
        g.applyMatrix4(m);
        parts.push(g);
        const baseY = up * (BITE + row.hc);
        const tipY = baseY + up * row.root;
        const rr = (row.kind === 'molar' ? 0.0009 : row.kind === 'premolar' ? 0.0010 : 0.0008) * grow;
        if (row.kind === 'molar') {
          for (const k of [-1, 1]) {
            const o = k * row.w * 0.22;
            parts.push(cone([p[0] + tt.x * o, baseY, p[2] + tt.z * o], [p[0] + tt.x * o * 1.5, tipY, p[2] + tt.z * o * 1.5], rr, 5));
          }
        } else {
          parts.push(cone([p[0], baseY, p[2]], [p[0], tipY, p[2]], rr, 5));
        }
      }
    }
  }
  return merge(parts);
}

/* ------------------------------------------------------------------ tongue */

const TONGUE: Sdf = smoothUnion(
  0.003,
  ellipsoid([0, -0.002, 0.003], [0.0125, 0.0043, 0.0125]), // the oral part
  ellipsoid([0, -0.002, -0.019], [0.0105, 0.005, 0.01]), // the pharyngeal part: its root forms the front wall of the throat
);

/** Height of the tongue's upper surface at (x, z), or NaN where there is no tongue. */
function topY(x: number, z: number): number {
  for (let y = 0.006; y > -0.01; y -= 0.0001) if (TONGUE(x, y, z) < 0) return y;
  return NaN;
}
/** Where the tongue's side surface is at height y and depth z, walking outward from the midline. */
function sideX(y: number, z: number): number {
  for (let x = 0; x < 0.02; x += 0.0001) if (TONGUE(x, y, z) > 0) return x;
  return NaN;
}
const onTop = (x: number, z: number, lift = 0): V3 => [x, topY(x, z) + lift, z];

/* ------------------------------------------------------------------ palate */

/** Half-width of the space inside the upper arch at depth z (the arch's inside edge, by eye). */
const HALF: readonly [number, number][] = [[-0.0045, 0.015], [0.002, 0.0147], [0.008, 0.013], [0.013, 0.01], [0.0165, 0.006], [0.0185, 0.0015]];
function halfWidth(z: number): number {
  if (z <= HALF[0][0]) return HALF[0][1];
  for (let i = 1; i < HALF.length; i++) {
    if (z <= HALF[i][0]) {
      const f = (z - HALF[i - 1][0]) / (HALF[i][0] - HALF[i - 1][0]);
      return HALF[i - 1][1] + f * (HALF[i][1] - HALF[i - 1][1]);
    }
  }
  return HALF[HALF.length - 1][1];
}
/**
 * The vault of the hard palate: low at the arch, high in the midline, but never higher than
 * the shell's own roof at that depth (the cavity ellipsoid closes down towards the front, and
 * the first draft's flat-topped vault poked through it by a quarter at the incisors).
 */
const vault = (x: number, z: number): number => {
  const roof = 0.0122 * Math.sqrt(Math.max(0, 1 - (z / 0.0275) ** 2)) - 0.0012;
  const top = Math.min(0.0108, roof);
  const edge = Math.min(0.0068, top - 0.001);
  return edge + (top - edge) * (1 - Math.min(1, (x / 0.015) ** 2));
};
/** Droop of the soft palate below the vault, s = 0 at its joint with the hard palate and 1 at its free edge. */
const SOFT_Z0 = -0.0035;
const SOFT_Z1 = -0.0255;
const droop = (s: number): number => 0.003 * s ** 1.5;

function hardPalate(): THREE.BufferGeometry {
  const rows: V3[][] = [];
  for (let i = 0; i <= 18; i++) {
    const z = SOFT_Z0 + ((0.018 - SOFT_Z0) * i) / 18;
    const w = halfWidth(z);
    const r: V3[] = [];
    for (let j = 0; j <= 12; j++) {
      const x = -w + (2 * w * j) / 12;
      r.push([x, vault(x, z), z]);
    }
    rows.push(r);
  }
  return sheet(rows, 0.0008);
}
function softPalate(): THREE.BufferGeometry {
  const rows: V3[][] = [];
  for (let i = 0; i <= 10; i++) {
    const s = i / 10;
    const z = SOFT_Z0 + (SOFT_Z1 - SOFT_Z0) * s;
    const w = 0.015 - 0.0065 * s;
    const r: V3[] = [];
    for (let j = 0; j <= 12; j++) {
      const x = -w + (2 * w * j) / 12;
      r.push([x, vault(x * (0.015 / w), SOFT_Z0) - droop(s), z]);
    }
    rows.push(r);
  }
  return sheet(rows, 0.0012);
}

/** A sheet across the floor: y(x) is a shallow trough, deeper in the midline. */
const floorY = (x: number): number => -0.0082 + 0.0035 * (x / 0.0165) ** 2;
function floorSheet(z0: number, z1: number, drop: number, thick: number, widen: number): THREE.BufferGeometry {
  const rows: V3[][] = [];
  for (let i = 0; i <= 14; i++) {
    const z = z0 + ((z1 - z0) * i) / 14;
    const w = Math.min(0.0165, halfWidth(z) + widen);
    const r: V3[] = [];
    for (let j = 0; j <= 10; j++) {
      const x = -w + (2 * w * j) / 10;
      r.push([x, floorY(x) - drop, z]);
    }
    rows.push(r);
  }
  return sheet(rows, thick);
}

/* ------------------------------------------------------------- tongue detail */

function filiform(): THREE.BufferGeometry {
  const rnd = mulberry32(11);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 170; i++) {
    const x = (rnd() * 2 - 1) * 0.0112;
    const z = -0.009 + rnd() * 0.024;
    const y = topY(x, z);
    if (!Number.isFinite(y)) continue;
    parts.push(cone([x, y - 0.0001, z], [x, y + 0.0007, z], 0.00022, 3));
  }
  return merge(parts);
}
function fungiform(): THREE.BufferGeometry {
  const rnd = mulberry32(23);
  const c: V3[] = [];
  for (let i = 0; i < 400 && c.length < 30; i++) {
    const x = (rnd() * 2 - 1) * 0.0112;
    const z = -0.008 + rnd() * 0.0235;
    // The tip and the margins carry most of them.
    if (!(z > 0.008 || Math.abs(x) > 0.0075)) continue;
    const y = topY(x, z);
    if (Number.isFinite(y)) c.push([x, y - 0.0001, z]);
  }
  return beads(c, 0.00042, 6, 4);
}
/** Apex of the terminal sulcus, where the oral two-thirds ends. */
const SULCUS_Z = -0.0095;
const VALLATE: V3[] = [];
for (const side of [1, -1]) {
  for (const ax of [0.003, 0.0058, 0.0082]) {
    const z = SULCUS_Z + (ax / 0.0085) * 0.0045 + 0.0014;
    VALLATE.push(onTop(side * ax, z));
  }
}
function vallate(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const c of VALLATE) {
    parts.push(blob([c[0], c[1] + 0.0001, c[2]], [0.0009, 0.0005, 0.0009], 8, 5));
    parts.push(torusAt([c[0], c[1] - 0.0001, c[2]], 0.0012, 0.00018, 3, 12));
  }
  return merge(parts);
}
function vallateBuds(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const c of VALLATE) {
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      parts.push(bead([c[0] + 0.00098 * Math.cos(a), c[1] - 0.0002, c[2] + 0.00098 * Math.sin(a)], 0.00017, 4, 3));
    }
  }
  return merge(parts);
}
function foliate(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [1, -1]) {
    for (let k = 0; k < 4; k++) {
      const z = -0.0195 + 0.0011 * k;
      const pts: V3[] = [];
      for (const y of [0.0, -0.0015, -0.003]) {
        const x = sideX(y, z);
        if (Number.isFinite(x)) pts.push([side * (x - 0.0001), y, z]);
      }
      if (pts.length >= 2) parts.push(cord(pts, 0.00035, 6, 4));
    }
  }
  return merge(parts);
}
const sulcusPts = (side: number): V3[] => [[0, SULCUS_Z - 0.0001], [0.0045, SULCUS_Z + 0.002], [0.0085, SULCUS_Z + 0.0045]].map(([x, z]) => onTop(side * x, z, 0.0001));
function terminalSulcus(): THREE.BufferGeometry {
  return merge([1, -1].map((s) => cord(sulcusPts(s), 0.0003, 8, 4)));
}
function medianSulcus(): THREE.BufferGeometry {
  const pts: V3[] = [];
  for (let i = 0; i <= 8; i++) pts.push(onTop(0, -0.0085 + (0.0233 * i) / 8, 0.0001));
  return cord(pts, 0.00022, 16, 4);
}
function frenulum(): THREE.BufferGeometry {
  const top: V3[] = [];
  const bot: V3[] = [];
  for (let i = 0; i < 6; i++) {
    const z = 0.005 + (0.005 * i) / 5;
    top.push([0, -0.0062, z]);
    bot.push([0, floorY(0), z]);
  }
  return sheet([top, bot], 0.0004);
}
function intrinsic(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Superior longitudinal: just under the upper surface. Inferior: just above the underside.
  for (const x of [-0.005, 0, 0.005]) {
    const up: V3[] = [];
    for (let i = 0; i <= 6; i++) {
      const z = 0.014 - (0.0215 * i) / 6;
      up.push([x, topY(x, z) - 0.001, z]);
    }
    parts.push(cord(up, 0.00028, 12, 4));
  }
  for (const x of [-0.003, 0.003]) parts.push(cord([[x, -0.0052, 0.014], [x, -0.0052, 0.006], [x, -0.0054, -0.0075]], 0.00028, 10, 4));
  // Transverse: sheets of fibres from the midline septum to the sides.
  for (const z of [0.011, 0.007, 0.003, -0.001, -0.007, -0.013]) parts.push(cord([[-0.0095, -0.0012, z], [0, -0.0004, z], [0.0095, -0.0012, z]], 0.00026, 10, 4));
  // Vertical: from the upper to the lower surface at the sides.
  for (const x of [-0.0075, 0.0075]) for (const z of [0.01, 0.006, 0.002]) parts.push(line([x, 0.0005, z], [x, -0.0045, z], 0.00026));
  return merge(parts);
}

const R = (v: readonly number[], side: number): V3 => [side * v[0], v[1], v[2]];
/** The palatoglossal fold, front pillar of the isthmus: the doorway's side wall, from the soft palate down to the tongue. */
const ARCH_FOLD: V3[] = [[0.0082, 0.0058, -0.025], [0.0088, 0.0018, -0.0235], [0.0092, -0.0022, -0.0215]];
function genioglossus(): THREE.BufferGeometry {
  const origin: V3 = [0, -0.0062, 0.015];
  const ends: V3[] = [[0, 0.001, 0.012], [0, 0.0015, 0.005], [0, 0.001, -0.002], [0, -0.0005, -0.012], [0, -0.0045, -0.0255]];
  return merge([-1, 1].flatMap((k) => ends.map((e) => line([k * 0.0009, origin[1], origin[2]], [k * 0.0009, e[1], e[2]], 0.0004))));
}
function hyoglossus(): THREE.BufferGeometry {
  const hyoid: V3 = [0.0045, -0.0065, -0.022];
  const ends: V3[] = [[0.01, -0.003, -0.011], [0.0105, -0.003, -0.002], [0.0098, -0.0035, -0.019]];
  return merge([1, -1].flatMap((s) => ends.map((e) => line(R(hyoid, s), R(e, s), 0.0004))));
}
function styloglossus(): THREE.BufferGeometry {
  const path: V3[] = [[0.0108, 0.002, -0.0245], [0.0118, -0.001, -0.016], [0.0114, -0.002, -0.005], [0.0095, -0.0035, 0.0095]];
  return merge([1, -1].map((s) => cord(path.map((p) => R(p, s)), 0.0004, 12, 4)));
}
function palatoglossus(): THREE.BufferGeometry {
  const path: V3[] = [[0.0092, 0.0056, -0.0252], [0.0099, 0.0016, -0.0236], [0.0102, -0.0022, -0.0216]];
  return merge([1, -1].map((s) => cord(path.map((p) => R(p, s)), 0.0004, 8, 4)));
}
const NERVE: Record<string, V3[]> = {
  hypoglossal: [[0.0075, -0.005, -0.025], [0.0085, -0.0062, -0.017], [0.005, -0.0056, 0.003], [0.003, -0.005, 0.01]],
  lingual: [[0.0082, -0.004, -0.025], [0.0108, -0.005, -0.009], [0.0075, -0.0035, 0.006], [0.0035, -0.003, 0.013]],
  chorda: [[0.0083, 0.001, -0.025], [0.011, -0.003, -0.015], [0.0105, -0.005, -0.009]],
  glosso: [[0.0083, 0, -0.027], [0.0095, 0.0005, -0.019], [0.006, 0.001, -0.0085]],
};
const nerve = (k: string): THREE.BufferGeometry => merge([1, -1].map((s) => cord(NERVE[k].map((p) => R(p, s)), 0.00032, 14, 4)));

/* --------------------------------------------------- the two magnified diagrams */

/** TASTE BUD (illustrative, magnified): an onion-shaped flask standing above the right side of the tongue. */
const TB: V3 = [0.007, 0.0058, 0.004];
const tbAt = (dx: number, dy: number, dz: number): V3 => [TB[0] + dx, TB[1] + dy, TB[2] + dz];
function spindles(n: number, ring: number, dy: number, along: number, across: number, phase = 0): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < n; k++) {
    const a = phase + (k / n) * Math.PI * 2;
    parts.push(blobAlong(tbAt(ring * Math.cos(a), dy, ring * Math.sin(a)), [0, 1, 0], along, across, 6, 4));
  }
  return merge(parts);
}

/** MOLAR (illustrative, magnified): standing above the left side of the tongue, crown up. */
const TH: V3 = [-0.007, 0, 0.004];
const NECK_Y = 0.0058;
const CROWN_C: V3 = [TH[0], 0.0074, TH[2]];
const rootBase = (k: number): V3 => [TH[0] + k * 0.0007, NECK_Y, TH[2]];
const rootTip = (k: number): V3 => [TH[0] + k * 0.0011, 0.0034, TH[2]];
const roots = (r: number, extend = 0): THREE.BufferGeometry =>
  merge([-1, 1].map((k) => cone(rootBase(k), [rootTip(k)[0], rootTip(k)[1] - extend, rootTip(k)[2]], r, 6)));
const crown = (k: number): THREE.BufferGeometry => blob(CROWN_C, [0.0019 * k, 0.0016 * k, 0.0017 * k], 10, 7);

/* ------------------------------------------------------------------- build */

export const parts: PartBuilder = () => {
  const out: PartGeometry[] = [];
  const add = (id: string, geometry: THREE.BufferGeometry): void => {
    out.push({ id, geometry });
  };

  // Lips: a ring of muscle round the mouth, two bodies, a red margin.
  add('lips', ellipseRing(0.0135, 0.0038, 0.0245, 0.003));
  add('upper_lip', blob([0, 0.003, 0.0245], [0.0135, 0.0026, 0.0036], 12, 7));
  add('lower_lip', blob([0, -0.0035, 0.0245], [0.012, 0.0028, 0.004], 12, 7));
  add('orbicularis_oris', ellipseRing(0.012, 0.0034, 0.023, 0.0014));
  {
    const up: V3[] = [];
    const lo: V3[] = [];
    for (let i = 0; i <= 10; i++) {
      const x = -0.0128 + (0.0256 * i) / 10;
      const k = 1 - (x / 0.0128) ** 2;
      up.push([x, 0.0008 + 0.0012 * k, 0.027]);
      lo.push([x, -0.0008 - 0.0014 * k, 0.027]);
    }
    add('vermilion_border', merge([cord(up, 0.0003, 12, 4), cord(lo, 0.0003, 12, 4)]));
  }

  add('oral_vestibule', tubeAlong(archPath(-0.0002, 0.0034, 9), () => 0.0016, { tubular: 40, radial: 6 }));
  add('gingivae', merge([tubeAlong(archPath(0.0052, 0, 9), () => 0.0016, { tubular: 40, radial: 5 }), tubeAlong(archPath(-0.0052, 0, 9), () => 0.0016, { tubular: 40, radial: 5 })]));

  // Palate: the hard palate, its ridges and papilla; the soft palate and uvula.
  add('palate', hardPalate());
  {
    const ridges: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 4; k++) {
      const z = 0.007 + 0.002 * k;
      const xe = Math.min(0.0105, halfWidth(z) - 0.0015);
      for (const s of [1, -1]) {
        const pts: V3[] = [];
        for (let i = 0; i <= 4; i++) {
          const x = 0.003 + ((xe - 0.003) * i) / 4;
          pts.push([s * x, vault(x, z) - 0.0005, z]);
        }
        ridges.push(cord(pts, 0.00035, 8, 4));
      }
    }
    add('palatine_rugae', merge(ridges));
  }
  add('incisive_papilla', blob([0, vault(0, 0.0152) - 0.0005, 0.0152], [0.0007, 0.0006, 0.0009], 8, 5));
  add('median_palatine_raphe', cord([-0.003, 0.005, 0.0148].map((z): V3 => [0, vault(0, z) - 0.0004, z]), 0.0003, 10, 4));
  add('soft_palate', softPalate());
  add('uvula', cone([0, vault(0, SOFT_Z0) - 0.0033, -0.0255], [0, 0.0034, -0.0257], 0.0018, 8));
  add('palatoglossal_arch', merge([1, -1].map((s) => cord(ARCH_FOLD.map((p) => R(p, s)), 0.0012, 10, 5))));

  add('oral_cavity_proper', blob([0, 0.002, 0.003], [0.015, 0.008, 0.015], 14, 10));
  add('floor_of_mouth', floorSheet(-0.005, 0.015, 0, 0.0008, 0));
  add('mylohyoid', floorSheet(-0.011, 0.012, 0.001, 0.0006, 0.001));
  {
    const folds: THREE.BufferGeometry[] = [];
    for (const s of [1, -1]) folds.push(cord([[0.0035, floorY(0.0035) + 0.0003, 0.0098], [0.0062, floorY(0.0062) + 0.0003, 0.0045], [0.0085, floorY(0.0085) + 0.0003, -0.001]].map((p) => R(p, s)), 0.0007, 10, 5));
    add('sublingual_folds', merge(folds));
  }
  add('sublingual_caruncles', beads([[0.002, -0.008, 0.01], [-0.002, -0.008, 0.01]], 0.0007, 8, 5));

  // Tongue.
  add('tongue', polygonise(TONGUE, [-0.0145, -0.0105, -0.0315], [0.0145, 0.0045, 0.017], { cell: 0.0007, maxCells: 110000 }));
  add('oral_part', blob([0, -0.002, 0.003], [0.013, 0.0048, 0.0129], 14, 9));
  add('pharyngeal_part', blob([0, -0.002, -0.019], [0.0111, 0.0054, 0.0105], 14, 9));
  add('terminal_sulcus', terminalSulcus());
  add('foramen_caecum', bead(onTop(0, SULCUS_Z - 0.0001, -0.0001), 0.0004, 8, 5));
  add('median_sulcus', medianSulcus());
  add('lingual_frenulum', frenulum());
  add('filiform_papillae', filiform());
  add('fungiform_papillae', fungiform());
  add('foliate_papillae', foliate());
  add('vallate_papillae', vallate());
  add('vallate_taste_buds', vallateBuds());
  add('intrinsic_muscles', intrinsic());
  const gg = genioglossus();
  const hg = hyoglossus();
  const sg = styloglossus();
  const pg = palatoglossus();
  add('extrinsic_muscles', merge([gg.clone(), hg.clone(), sg.clone(), pg.clone()]));
  add('genioglossus', gg);
  add('hyoglossus', hg);
  add('styloglossus', sg);
  add('palatoglossus', pg);
  add('tongue_nerves', merge([nerve('hypoglossal'), nerve('lingual'), nerve('chorda'), nerve('glosso')]));
  add('hypoglossal_nerve', nerve('hypoglossal'));
  add('lingual_nerve', nerve('lingual'));
  add('chorda_tympani', nerve('chorda'));
  add('glossopharyngeal_nerve', nerve('glosso'));

  // Teeth: the parent draws all thirty-two; each child draws its own kind a touch larger so the two do not share a surface.
  add('teeth', teeth(['incisor', 'canine', 'premolar', 'molar']));
  add('incisors', teeth(['incisor'], 1.06));
  add('canines', teeth(['canine'], 1.06));
  add('premolars', teeth(['premolar'], 1.06));
  add('molars', teeth(['molar'], 1.06));

  // Mucosa.
  add('oral_mucosa', blob([0, 0, 0], [0.0262, 0.0114, 0.0262], 16, 12));
  add('buccal_mucosa', merge([1, -1].map((s) => blob([s * 0.0238, 0, 0], [0.0012, 0.006, 0.012], 8, 6))));
  add('parotid_papilla', beads([[0.0232, 0.002, 0], [-0.0232, 0.002, 0]], 0.0008, 8, 5));

  // Taste bud.
  add('taste_bud', blob(TB, [0.0012, 0.0022, 0.0012], 12, 8));
  add('gustatory_receptor_cells', spindles(5, 0.0003, 0.0002, 0.0016, 0.00022));
  add('supporting_cells', spindles(6, 0.00075, 0.0001, 0.0017, 0.0003, 0.3));
  add('basal_cells', beads([0, 1, 2].map((k): V3 => tbAt(0.0006 * Math.cos(k * 2.1), -0.0016, 0.0006 * Math.sin(k * 2.1))), 0.00035, 6, 4));
  add('taste_pore', torusAt(tbAt(0, 0.0021, 0), 0.00028, 0.00011, 4, 10));
  add('gustatory_nerve_fibres', merge([0, 1, 2].map((k) => cord([tbAt(0.0003 * Math.cos(k * 2.1), -0.0016, 0.0003 * Math.sin(k * 2.1)), tbAt(0.0006 * Math.cos(k * 2.1), -0.0024, 0.0006 * Math.sin(k * 2.1)), tbAt(0.0008 * Math.cos(k * 2.1), -0.003, 0.0008 * Math.sin(k * 2.1))], 0.00018, 6, 4))));

  // Molar.
  add('tooth', merge([crown(1), roots(0.0009)]));
  add('tooth_crown', crown(1.03));
  add('tooth_neck', torusAt([TH[0], NECK_Y, TH[2]], 0.001, 0.0003, 4, 12));
  add('tooth_root', roots(0.00093, 0));
  add('enamel', crown(1.1));
  add('dentine', merge([crown(0.8), roots(0.0006)]));
  add('pulp_cavity', blob([TH[0], 0.007, TH[2]], 0.0008, 8, 6));
  add('gingival_sulcus', torusAt([TH[0], NECK_Y, TH[2]], 0.0013, 0.00018, 3, 12));
  add('root_canal', merge([-1, 1].map((k) => cord([[TH[0], 0.0066, TH[2]], [TH[0] + k * 0.0006, 0.005, TH[2]], [TH[0] + k * 0.0010, 0.0036, TH[2]]], 0.00022, 8, 4))));
  add('apical_foramen', beads([-1, 1].map((k): V3 => [TH[0] + k * 0.0011, 0.0034, TH[2]]), 0.00028, 6, 4));
  add('cementum', roots(0.00112, 0));
  add('periodontal_ligament', roots(0.00155, 0.0001));
  add('alveolar_bone', blob([TH[0], 0.0042, TH[2]], [0.0024, 0.002, 0.0022], 10, 7));
  return out;
};
