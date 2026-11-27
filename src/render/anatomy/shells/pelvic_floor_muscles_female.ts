import * as THREE from 'three';
import { capsule, chain, ellipsoid, mergeParts, smoothUnion, sphere, tubeAlong, type Sdf, type V3 } from '../sdf';
import { INFERIOR_RAMUS, ISCHIAL_RAMUS } from './lower_limb_bones';
import { belly, declip, mirrorGeo, orient, sheet } from './back_muscles';
import { hipThighBoneSd } from './hip_thigh_muscles';
import { ORIGIN, pelvicFloorLeaves, rimPoints } from './pelvic_floor_muscles';

/**
 * PELVIC FLOOR MUSCLES, FEMALE SHELL: THE LEVATOR ANI, COCCYGEUS AND THE MUSCLES OF THE PERINEUM OF A FEMALE BODY.
 * A LAYER organ of the muscles layer (`pelvic_floor_muscles_female`, `sex: "female"` in organs.json), drawn only in a female body.
 *
 * WHY A SECOND ORGAN. The first pelvic floor (shells/pelvic_floor_muscles.ts) is one geometry for both bodies and it was wrong for a
 * female one in three ways: its external urethral sphincter ring sat at the male membranous-urethra position (round no urethra in
 * a female body), its hiatus was sized for a rectum and a prostate rather than for a vagina, and its perineal membrane was two wings
 * with the midline open, so nothing was pierced. A layer organ never reaches OrganSet's body rule and the part builders are told no sex, so the
 * smallest honest mechanism was the one the reproductive organs already use: a separate organ with `sex` in organs.json, here with
 * its own atlas (src/data/anatomy/pelvic_floor_muscles_female.json). The male organ is untouched and keeps `sex: "male"`.
 *
 * FRAME. The same as the male shell: the hip bone's own body coordinates, origin organs.json [0, -0.2, 0], the pelvic group lowered 0.045
 * by the exploded stack. The vagina, the bladder and the urethra are authored in the same pelvic frame (organs.json position plus
 * their own local points), and the large intestine's anal canal is in the pelvic band of the continuous warp, so it lands in the same
 * frame too (a scene y of -0.2338 to -0.1982 for the canal, measured). Nothing here is fitted to a picture: every landmark below is read from
 * the neighbouring organ's own shell or atlas, and the check that measures them lives with the report of the round that wrote this file.
 *
 * WHAT IS PLACED ON WHAT.
 *  - THE URETHRA. The bladder atlas draws only the first 11 mm of the urethra (to y -0.2315, radius 0.0032) and the vagina atlas draws the
 *    external urethral orifice at (0, -0.2905, 0.0258). Nobody draws the course between them, so this file takes it to be the straight
 *    line from the one to the other, 59 mm of centreline (a female urethra is nearer 40 mm in the textbook; the model's vagina opens lower than its bladder neck
 *    suggests, and the line is stated, not corrected). It runs in FRONT of the vagina and diverges from it upward: at the level of the
 *    sphincter the two walls are 4.6 mm apart.
 *  - THE HIATUS. The urogenital hiatus of the levator ani transmits the urethra and the vagina, and the anorectal canal passes through the
 *    same opening behind them (Gray's). It is one ellipse here, centred 5 mm behind the origin and long enough in z to take the anal canal
 *    (back wall -0.0412) behind the vagina (x +-0.0092) and the urethra (front at 0.0183 at the level of the floor). The male hiatus is a rounder 0.022 by 0.030.
 *  - THE SLINGS. The puborectalis is the innermost ring, from the pubic body round BEHIND the anorectal junction; the pubococcygeus is
 *    the next sector, whose inner front fibres are the pubovaginal fibres that sling round the vagina (drawn as that sector's inner part, not as
 *    a separate muscle, because the bowl is one surface). The sectors are sheets on one surface, as in the male shell.
 *  - THE SPHINCTERS. The external urethral sphincter is a stack of three rings round the MIDDLE third of the urethra, each ring perpendicular to the
 *    urethral axis and concentric with it (the centre offset is measured and reported, not assumed). The compressor urethrae is an arch over the
 *    FRONT of the urethra from the ischiopubic ramus on each side, and the sphincter urethrovaginalis a band from the perineal body that
 *    passes along each side of the vagina and in front of the urethra, so it encircles both.
 *  - THE PERINEAL MEMBRANE is a sheet slung from the ischiopubic rami and perforated: the urethra passes through one opening and the vagina through the
 *    other, and the two merge into one slot where they are closest. The sheet is a hammock because the model's rami stand 8 cm above its urethra and vagina
 *    (see below), so a flat sheet at the rami would cut the bladder; the same stand-off is why the levator bowl hangs below its rim in the male shell.
 *
 * WHAT WENT WRONG BEFORE, AND IS STILL TRUE. The model's pelvic organs hang LOWER than its pelvic bones, so the bony outlet lies above the organs it should
 * support. The membrane therefore sags from the rami to the level of the introitus instead of stretching across the pubic arch at the level of the
 * rami; this is the organs' placement, not a claim about how far the membrane drops. The anal canal ends 14 mm above the levator hiatus plane, so the
 * puborectalis sling passes behind the hiatus and not round the canal itself.
 *
 * NOT DRAWN, CROSS-REFERENCED. The perineal body belongs to the vagina atlas, the external anal sphincter to the large intestine atlas and the bulbospongiosus
 * and ischiocavernosus (the vestibular bulbs' muscles) are not drawn; the fasciae, the ischioanal fossa and the anococcygeal raphe are not drawn. All thicknesses
 * and outlines are DRAWING CHOICES.
 */

/** The female urethra's drawn course, pelvic frame, metres: the bladder atlas's own end of its first part to the vagina atlas's own orifice. Radius from the bladder atlas. */
export const URETHRA_TOP: V3 = [0, -0.2315, 0.008];
export const URETHRA_ORIFICE: V3 = [0, -0.2905, 0.0258];
export const URETHRA_RADIUS = 0.0032;
/** Point of the urethra's axis at fraction f from the bladder neck (0) to the orifice (1). */
export const urethraAt = (f: number): V3 => [0, URETHRA_TOP[1] + f * (URETHRA_ORIFICE[1] - URETHRA_TOP[1]), URETHRA_TOP[2] + f * (URETHRA_ORIFICE[2] - URETHRA_TOP[2])];

/** z of the urethra's axis at height y. */
export const urethraZAt = (y: number): number => URETHRA_TOP[2] + ((y - URETHRA_TOP[1]) / (URETHRA_ORIFICE[1] - URETHRA_TOP[1])) * (URETHRA_ORIFICE[2] - URETHRA_TOP[2]);

/** The urethra as a field, for the clearances. */
export const urethraSd: Sdf = capsule(URETHRA_TOP, URETHRA_ORIFICE, URETHRA_RADIUS);

/**
 * The vagina's shell as a field in this frame: the same canal (a chain of capsules flattened about its leaning axis) and the same vulval
 * structures (the two vestibular bulbs, the clitoris, its body and its crura) that models.ts `vagina()` unions, placed at the organ's
 * position (0, -0.218, -0.016). Kept as a copy because the shell's own field is private to models.ts; change the two together.
 * The first version of this file left the bulbs and the clitoris out and the membrane, the compressor and the sphincter urethrovaginalis then
 * cut 2 to 3 mm into them: they lie just BELOW the perineal membrane, at its level on the midline, which is why the membrane now sits above them.
 */
const VAGINA_AT: V3 = [0, -0.218, -0.016];
const canal = chain([[0, -0.002, 0], [0, -0.04, 0.012], [0, -0.072, 0.036]], [0.0095, 0.009, 0.008]);
const flattenedCanal: Sdf = (x, ly, lz) => {
  const axisZ = ly > -0.04 ? ((-0.002 - ly) / 0.038) * 0.012 : 0.012 + ((-0.04 - ly) / 0.032) * 0.024;
  return canal(x, ly, axisZ + (lz - axisZ) / 0.62);
};
const vaginaField: Sdf = smoothUnion(
  0.003,
  flattenedCanal,
  ellipsoid([0.0095, -0.078, 0.04], [0.004, 0.012, 0.006]),
  ellipsoid([-0.0095, -0.078, 0.04], [0.004, 0.012, 0.006]),
  sphere([0, -0.064, 0.058], 0.004),
  capsule([0, -0.062, 0.056], [0, -0.058, 0.046], 0.003),
  capsule([0, -0.058, 0.046], [0.017, -0.07, 0.03], 0.003, 0.0022),
  capsule([0, -0.058, 0.046], [-0.017, -0.07, 0.03], 0.003, 0.0022),
);
export const vaginaSd: Sdf = (x, y, z) => vaginaField(x - VAGINA_AT[0], y - VAGINA_AT[1], z - VAGINA_AT[2]);

/** The bladder's field (its body and its neck), as in models.ts `bladder()`, placed at (0, -0.188, 0.012). */
const BLADDER_AT: V3 = [0, -0.188, 0.012];
const bladderField = smoothUnion(
  0.006,
  ellipsoid([0, 0, 0], [0.036, 0.03, 0.033]),
  capsule([0, 0.022, 0.02], [0, 0.036, 0.03], 0.006, 0.002),
  capsule([0, -0.026, -0.004], [0, -0.04, -0.004], 0.008, 0.005),
);
export const bladderSd: Sdf = (x, y, z) => bladderField(x - BLADDER_AT[0], y - BLADDER_AT[1], z - BLADDER_AT[2]);

/** Gap kept between a muscle and a neighbouring organ's surface, metres. A drawing choice. */
const CLEAR = 0.0007;

/** Everything a female pelvic muscle must keep out of: vagina, urethra, bladder. The anal canal is cleared by the hiatus, and measured. */
const keepOut: Sdf = (x, y, z) => Math.min(vaginaSd(x, y, z), urethraSd(x, y, z), bladderSd(x, y, z));

/* ------------------------------------------------------------------ the bowl */

/** How far the hiatus plane hangs below the rim: the male shell's value, so the two floors sit at the same height. A drawing choice (see the male shell). */
const BOWL_DROP = 0.093;
/** Centre (z) and half-axes (x across, z front to back) of the hiatus, metres. Wide enough for the vagina and urethra in front and the anal canal behind. A drawing choice. */
const HIATUS_CZ = -0.003;
const HIATUS: [number, number] = [0.018, 0.031];

const rimCurve = (): THREE.CatmullRomCurve3 => new THREE.CatmullRomCurve3(rimPoints().map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', 0.5);
const local = (p: V3): V3 => [p[0], p[1] - ORIGIN[1], p[2]];
const toLocal = (g: THREE.BufferGeometry): THREE.BufferGeometry => g.translate(0, -ORIGIN[1], 0);
const pair = (g: THREE.BufferGeometry): THREE.BufferGeometry[] => [g, mirrorGeo(g)];

/** A point of the bowl: u 0..1 front to back round the rim, v 0 at the hiatus to 1 at the rim. Right half. */
function bowl(rim: THREE.CatmullRomCurve3, u: number, v: number): V3 {
  const q = rim.getPointAt(u);
  const dx = q.x;
  const dz = q.z - HIATUS_CZ;
  const h = Math.min(0.8, 1 / Math.sqrt((dx / HIATUS[0]) ** 2 + (dz / HIATUS[1]) ** 2));
  const r = h + (1 - h) * v;
  const y = q.y - (BOWL_DROP * (1 - r * r)) / (1 - h * h);
  return [dx * r, y, HIATUS_CZ + dz * r];
}

function sector(u0: number, u1: number, v0: number, v1: number, thick: number, nu: number, nv = 6): THREE.BufferGeometry {
  const rim = rimCurve();
  const rails: V3[][] = [];
  for (let i = 0; i <= nu; i++) {
    const u = u0 + ((u1 - u0) * i) / nu;
    const rail: V3[] = [];
    for (let j = 0; j <= nv; j++) rail.push(local(bowl(rim, u, v0 + ((v1 - v0) * j) / nv)));
    rails.push(rail);
  }
  return sheet(rails, 1, thick, local([0, -0.1, 0]));
}

/* ------------------------------------------------------------ the membrane */

/** The membrane's plan edge: the ischiopubic rami's own points, (z, x) from the back to the pubic arch, taken 3 mm inside the bone. */
const RAMUS_EDGE: [number, number, number][] = [
  [ISCHIAL_RAMUS[0][2], ISCHIAL_RAMUS[0][0] - 0.003, ISCHIAL_RAMUS[0][1]],
  [ISCHIAL_RAMUS[1][2], ISCHIAL_RAMUS[1][0] - 0.003, ISCHIAL_RAMUS[1][1]],
  [ISCHIAL_RAMUS[2][2], ISCHIAL_RAMUS[2][0] - 0.003, ISCHIAL_RAMUS[2][1]],
  [ISCHIAL_RAMUS[3][2], ISCHIAL_RAMUS[3][0] - 0.003, ISCHIAL_RAMUS[3][1]],
  [INFERIOR_RAMUS[1][2], INFERIOR_RAMUS[1][0] - 0.003, INFERIOR_RAMUS[1][1]],
  [INFERIOR_RAMUS[2][2], INFERIOR_RAMUS[2][0] - 0.003, INFERIOR_RAMUS[2][1]],
  [INFERIOR_RAMUS[3][2], INFERIOR_RAMUS[3][0] - 0.003, INFERIOR_RAMUS[3][1]],
];
/** Back edge of the membrane: the line between the ischial tuberosities, in front of the anal canal. */
const MEMBRANE_BACK_Z = -0.02;
/** Height of the membrane where the urethra and vagina pass through it: above the vestibular bulbs (top -0.284), the clitoral crura (top about -0.276) and the glans (-0.278), which all lie BELOW it. A drawing choice (see above). */
const MEMBRANE_Y = -0.272;
const MEMBRANE_THICK = 0.0018;
/** The z at which the membrane starts to climb toward the pubic symphysis, 1.5 mm in front of the urethra at the membrane's height (z 0.0202 plus its 3.2 mm radius). */
const CLIMB_FROM_Z = 0.0245;

function ramusAt(z: number): { x: number; y: number } {
  const t = RAMUS_EDGE;
  if (z <= t[0][0]) return { x: t[0][1], y: t[0][2] };
  for (let i = 0; i < t.length - 1; i++) {
    if (z <= t[i + 1][0]) {
      const f = (z - t[i][0]) / (t[i + 1][0] - t[i][0]);
      return { x: t[i][1] + f * (t[i + 1][1] - t[i][1]), y: t[i][2] + f * (t[i + 1][2] - t[i][2]) };
    }
  }
  const e = t[t.length - 1];
  return { x: e[1], y: e[2] };
}

/** Height of the membrane at plan point (x, z): the introitus level on the midline, climbing parabolically to the ramus, and forward to the symphysis. */
export function membraneY(x: number, z: number): number {
  const r = ramusAt(z);
  const lateral = Math.min(1, Math.abs(x) / Math.max(r.x, 1e-6));
  const forward = Math.min(1, Math.max(0, (z - CLIMB_FROM_Z) / (RAMUS_EDGE[RAMUS_EDGE.length - 1][0] - CLIMB_FROM_Z)));
  const s = Math.max(lateral, forward);
  return MEMBRANE_Y + (r.y - MEMBRANE_Y) * s * s;
}
const inPlan = (x: number, z: number): boolean => z >= MEMBRANE_BACK_Z && z <= RAMUS_EDGE[RAMUS_EDGE.length - 1][0] && Math.abs(x) <= ramusAt(z).x;

/** The two openings, one field: the urethra and the vagina at the membrane's height, enlarged by `m` metres. */
function holeSd(x: number, y: number, z: number): number {
  return Math.min(vaginaSd(x, y, z), urethraSd(x, y, z));
}

/**
 * The perforated membrane: a solid slab on the hammock surface, cut into square cells, with every cell that touches an opening (enlarged by
 * HOLE_MARGIN) left out, so the sheet is pierced by the urethra and the vagina and bridges neither. Walls close every cut edge.
 */
function perforatedMembrane(): THREE.BufferGeometry {
  const cell = 0.0026;
  const HOLE_MARGIN = 0.0012;
  const x0 = -0.085;
  const z0 = MEMBRANE_BACK_Z;
  const nx = Math.round(0.17 / cell);
  const nz = Math.round((RAMUS_EDGE[RAMUS_EDGE.length - 1][0] - z0) / cell) + 1;
  const keep: boolean[][] = [];
  const node = (i: number, j: number): V3 => {
    const x = x0 + i * cell;
    const z = z0 + j * cell;
    return [x, membraneY(x, z), z];
  };
  const nodeOk = (i: number, j: number): boolean => {
    const [x, y, z] = node(i, j);
    if (!inPlan(x, z)) return false;
    // The slab is MEMBRANE_THICK/2 each side of the surface; an opening is tested on the surface and on both faces.
    const h = MEMBRANE_THICK / 2;
    return holeSd(x, y, z) > HOLE_MARGIN && holeSd(x, y + h, z) > HOLE_MARGIN && holeSd(x, y - h, z) > HOLE_MARGIN;
  };
  const ok: boolean[][] = [];
  for (let i = 0; i <= nx; i++) {
    ok.push([]);
    for (let j = 0; j <= nz; j++) ok[i].push(nodeOk(i, j));
  }
  for (let i = 0; i < nx; i++) {
    keep.push([]);
    for (let j = 0; j < nz; j++) {
      const [cx, , cz] = node(i, j);
      const mx = cx + cell / 2;
      const mz = cz + cell / 2;
      const centreOk = holeSd(mx, membraneY(mx, mz), mz) > HOLE_MARGIN;
      keep[i].push(ok[i][j] && ok[i + 1][j] && ok[i][j + 1] && ok[i + 1][j + 1] && centreOk);
    }
  }
  const pos: number[] = [];
  const idx: number[] = [];
  const vid = new Map<string, number>();
  const h = MEMBRANE_THICK / 2;
  const vert = (i: number, j: number, side: 1 | -1): number => {
    const key = `${i},${j},${side}`;
    const got = vid.get(key);
    if (got !== undefined) return got;
    const [x, y, z] = node(i, j);
    const id = pos.length / 3;
    pos.push(x, y + side * h, z);
    vid.set(key, id);
    return id;
  };
  const quad = (a: number, b: number, c: number, d: number): void => {
    idx.push(a, b, c, a, c, d);
  };
  const kept = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < nx && j < nz && keep[i][j];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      if (!keep[i][j]) continue;
      quad(vert(i, j, 1), vert(i + 1, j, 1), vert(i + 1, j + 1, 1), vert(i, j + 1, 1));
      quad(vert(i, j, -1), vert(i, j + 1, -1), vert(i + 1, j + 1, -1), vert(i + 1, j, -1));
      if (!kept(i - 1, j)) quad(vert(i, j, -1), vert(i, j, 1), vert(i, j + 1, 1), vert(i, j + 1, -1));
      if (!kept(i + 1, j)) quad(vert(i + 1, j, -1), vert(i + 1, j + 1, -1), vert(i + 1, j + 1, 1), vert(i + 1, j, 1));
      if (!kept(i, j - 1)) quad(vert(i, j, -1), vert(i + 1, j, -1), vert(i + 1, j, 1), vert(i, j, 1));
      if (!kept(i, j + 1)) quad(vert(i, j + 1, -1), vert(i, j + 1, 1), vert(i + 1, j + 1, 1), vert(i + 1, j + 1, -1));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  orient(g);
  g.computeVertexNormals();
  return toLocal(g);
}

/* ------------------------------------------------------------------ the leaves */

/** The pieces of each LEAF muscle, keyed by the leaf's part id in src/data/anatomy/pelvic_floor_muscles_female.json. */
export function pelvicFloorFemaleLeaves(): Record<string, THREE.BufferGeometry[]> {
  const out: Record<string, THREE.BufferGeometry[]> = {};
  const T = 0.004;
  // The levator ani: the same three sectors as the male bowl, round the female hiatus.
  out.puborectalis = pair(sector(0.0, 1.0, 0.0, 0.3, T, 20));
  out.pubococcygeus = pair(sector(0.0, 0.45, 0.3, 1.0, T, 8));
  out.iliococcygeus = pair(sector(0.45, 1.0, 0.3, 1.0, T, 10));

  // The coccygeus and the tendinous arch have nothing to do with the sex of the body: they are the male shell's own, unchanged.
  const male = pelvicFloorLeaves();
  out.coccygeus = male.coccygeus;
  out.tendinous_arch_of_levator_ani = male.tendinous_arch_of_levator_ani;

  out.perineal_membrane = [perforatedMembrane()];

  // Deep transverse perineal: a flat band on the membrane, from the ischiopubic ramus in toward the vagina's side.
  const dt: V3[] = [[0.06, 0.004], [0.046, 0.002], [0.034, 0.0], [0.024, -0.002], [0.0165, -0.002]].map(([x, z]): V3 => [x, membraneY(x, z) + 0.0034, z]);
  out.deep_transverse_perineal = pair(toLocal(belly(dt, () => 0.0042, () => 0.0015, () => new THREE.Vector3(0, -1, 0), 10, 6)));

  // Superficial transverse perineal: a slim slip along the back edge of the membrane to the perineal body, under the membrane.
  const stz = MEMBRANE_BACK_Z + 0.004;
  const st: V3[] = [[0.074, stz], [0.05, stz + 0.001], [0.03, stz + 0.004], [0.016, 0.0], [0.0075, 0.0045]].map(([x, z]): V3 => [x, membraneY(x, z) - 0.0034, z]);
  out.superficial_transverse_perineal = pair(toLocal(belly(st, () => 0.0028, () => 0.0013, () => new THREE.Vector3(0, -1, 0), 10, 6)));

  // External urethral sphincter: three rings round the middle third of the urethra, each perpendicular to the urethral axis and concentric with it.
  const axis = new THREE.Vector3(...URETHRA_ORIFICE).sub(new THREE.Vector3(...URETHRA_TOP)).normalize();
  const e1 = new THREE.Vector3(1, 0, 0);
  const e2 = new THREE.Vector3().crossVectors(axis, e1).normalize();
  const RING_R = 0.0066;
  const rings = [0.38, 0.45, 0.52].map((f) => {
    const c = urethraAt(f);
    const pts: V3[] = Array.from({ length: 17 }, (_, i): V3 => {
      const a = (2 * Math.PI * i) / 16;
      const p = new THREE.Vector3(c[0], c[1], c[2]).addScaledVector(e1, RING_R * Math.cos(a)).addScaledVector(e2, RING_R * Math.sin(a));
      return [p.x, p.y, p.z];
    });
    return toLocal(tubeAlong(pts, () => 0.0017, { tubular: 24, radial: 6, closed: false }));
  });
  out.external_urethral_sphincter = rings;

  // Compressor urethrae: an arch over the front of the urethra, from the inferior pubic ramus on each side, on top of the membrane.
  const cz = urethraZAt(MEMBRANE_Y + 0.0062) + URETHRA_RADIUS + 0.0052;
  const cu: V3[] = [[0.0, cz], [0.008, cz + 0.0015], [0.018, cz + 0.005], [0.028, cz + 0.0095], [0.037, cz + 0.0145]].map(([x, z]): V3 => [x, membraneY(x, z) + 0.0062, z]);
  out.compressor_urethrae = pair(toLocal(belly(cu, () => 0.0042, () => 0.0013, () => new THREE.Vector3(0, -1, 0), 10, 6)));

  // Sphincter urethrovaginalis: a band from the perineal body along each side of the vagina and in front of the urethra, so it encircles both.
  const su: V3[] = [[0.0045, 0.0045], [0.0128, 0.0075], [0.0132, 0.0150], [0.0085, 0.0210], [0.0, 0.0232]].map(([x, z]): V3 => [x, membraneY(x, z) + 0.0028, z]);
  out.sphincter_urethrovaginalis = pair(toLocal(belly(su, () => 0.0017, () => 0.0011, () => new THREE.Vector3(0, -1, 0), 14, 6)));

  // Every vertex clear of the pelvic bones, and of the vagina, urethra and bladder (a tube or a sheet between two guide points can still cut a corner).
  for (const [id, gs] of Object.entries(out)) {
    if (id === 'coccygeus' || id === 'tendinous_arch_of_levator_ani') continue;
    for (const g of gs) {
      declip(g, hipThighBoneSd(), 0.0002, ORIGIN[1]);
      if (id !== 'perineal_membrane') declip(g, keepOut, CLEAR, ORIGIN[1]);
    }
  }
  return out;
}

export const PELVIC_FEMALE_PARENT: Readonly<Record<string, string>> = {
  puborectalis: 'levator_ani', pubococcygeus: 'levator_ani', iliococcygeus: 'levator_ani',
  perineal_membrane: 'perineal_muscles', deep_transverse_perineal: 'perineal_muscles',
  superficial_transverse_perineal: 'perineal_muscles', external_urethral_sphincter: 'perineal_muscles',
  compressor_urethrae: 'perineal_muscles', sphincter_urethrovaginalis: 'perineal_muscles',
};

export function pelvicFloorFemaleMap(): Record<string, THREE.BufferGeometry[]> {
  const out = pelvicFloorFemaleLeaves();
  out.levator_ani = ['puborectalis', 'pubococcygeus', 'iliococcygeus'].flatMap((c) => out[c]);
  out.perineal_muscles = [
    'perineal_membrane', 'deep_transverse_perineal', 'superficial_transverse_perineal', 'external_urethral_sphincter', 'compressor_urethrae', 'sphincter_urethrovaginalis',
  ].flatMap((c) => out[c]);
  return out;
}
export function pelvicFloorFemaleGroups(): Record<string, THREE.BufferGeometry[]> {
  const all = pelvicFloorFemaleMap();
  return Object.fromEntries(['levator_ani', 'coccygeus', 'tendinous_arch_of_levator_ani', 'perineal_muscles'].map((id) => [id, all[id]]));
}
export function pelvicFloorMusclesFemale(): THREE.BufferGeometry {
  return mergeParts(Object.values(pelvicFloorFemaleGroups()).flat());
}
