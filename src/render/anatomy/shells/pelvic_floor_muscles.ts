import * as THREE from 'three';
import { capsule, chain, ellipsoid, mergeParts, smoothUnion, translated, tubeAlong, union, type Sdf, type V3 } from '../sdf';
import { INFERIOR_RAMUS, ISCHIAL_RAMUS, SPINE_TIP, TUBEROSITY } from './lower_limb_bones';
import { belly, declip, mirrorGeo, sheet } from './back_muscles';
import { hipThighBoneSd, snap } from './hip_thigh_muscles';

/**
 * PELVIC FLOOR MUSCLES, SHELL: THE LEVATOR ANI, COCCYGEUS AND THE MUSCLES OF THE PERINEUM AT TEXTBOOK DEPTH.
 * A LAYER organ of the muscles layer, in the pelvic group; the same organ for a male and a female body.
 *
 * FRAME. Origin organs.json [0, -0.2, 0], the hip bone's own origin; the pelvic group is lowered 0.045 by the exploded stack,
 * which the renderer adds back. Every point is authored in the hip bone's BODY coordinates (the numbers of
 * shells/lower_limb_bones.ts, the bones being rigid in the pelvic group) and moved to the organ's frame in `local`.
 *
 * THE BOWL. The levator ani is a bowl (Gray's: a funnel-shaped sheet) hung from a RIM and open at the middle for the urethra,
 * the vagina and the anorectum. The rim is a curve through the bones' own landmarks: the back of the pubic body, the line
 * of the tendinous arch (the thickening of the obturator internus fascia) across the side wall to the ischial spine, and on
 * to the front of the coccyx. The three parts of the levator are sectors of that one bowl: the PUBORECTALIS the innermost
 * ring, in a sling from the pubis round behind the anorectal junction; the PUBOCOCCYGEUS the front half of the rest, from the
 * pubis; the ILIOCOCCYGEUS the back half, from the tendinous arch to the coccyx. They are sheets a few millimetres thick on
 * one surface, which is a drawing choice (the three are described as overlapping fibres, and no fibre is drawn).
 *
 * WHAT WENT WRONG BEFORE, AND IS STILL TRUE. The model's pelvic organs hang LOWER than its pelvic bones: the prostate's lowest
 * point is scene y -0.286 and the bladder's -0.278 while the ischial tuberosity is at scene -0.2485, so the outlet of the bony
 * pelvis lies ABOVE the organs it should support. The bowl therefore hangs `BOWL_DROP` below its rim, to scene about -0.30, under
 * both; that is the organs' placement, not a claim about the floor's depth. The same fact decides the perineal membrane: the
 * prostate and the vagina pass through the level of the ischiopubic rami, so the membrane is drawn as two lateral wings that
 * stop `MEMBRANE_GAP` short of the midline and leave the passage open. The external urethral sphincter is drawn round the male
 * membranous urethra (just below the prostate's apex); a female urethra lies further forward, so in a female body the one
 * ring is not round the urethra. It is one geometry for both bodies, because the organ has no sex.
 *
 * NOT DRAWN, CROSS-REFERENCED. The external anal sphincter (the large intestine's atlas), the bulbospongiosus and ischiocavernosus
 * (the penis atlas) and the perineal body (the vagina atlas) are drawn by those atlases and not repeated here. The fasciae, the
 * ischioanal fossa and the anococcygeal raphe are not drawn. All thicknesses and outlines are DRAWING CHOICES.
 */

export const ORIGIN: V3 = [0, -0.2, 0];

/**
 * THE MALE ORGANS THE FLOOR MUST NOT ENTER (gx3, 2026-11-27). The penis and the prostate are authored in models.ts in their own
 * frames (organs.json positions [0, -0.25, 0.022] and [0, -0.226, 0.004], both in the pelvic group like this organ, so a
 * point's body coordinates minus the position is its coordinates in their frame). This file may not import models.ts (models.ts
 * imports this file, and the cycle between a shell and the registry has broken the build before), so the two fields are repeated
 * here, and MUST BE KEPT EQUAL BY HAND to `penis()` (the stem chain, the glans, the bulb and the two crura) and to the first
 * ellipsoid of `prostate()` (the gland itself; the vesicles and ampullae lie well above the floor). The audit of 2026-11-27 found
 * the external urethral sphincter ring entirely inside the penis's bulb (8.73 mm) and the puborectalis sling 4.4 mm inside the stem
 * root; Gray's has the bulbospongiosus and the crura's muscles wrap them from OUTSIDE, and the levator ani and sphincter lie
 * above and round them, never through.
 */
function maleOrganSd(): Sdf {
  const penis = smoothUnion(
    0.004,
    chain([[0, 0, 0], [0, -0.012, 0.022], [0, -0.04, 0.036], [0, -0.066, 0.04]], [0.011, 0.0115, 0.011, 0.0105]),
    ellipsoid([0, -0.076, 0.041], [0.0125, 0.012, 0.0125]),
    ellipsoid([0, 0.004, -0.012], [0.012, 0.01, 0.014]),
    capsule([0.004, 0.006, -0.014], [0.024, 0.018, -0.03], 0.005, 0.004),
    capsule([-0.004, 0.006, -0.014], [-0.024, 0.018, -0.03], 0.005, 0.004),
  );
  const prostate = ellipsoid([0, 0, 0], [0.02, 0.015, 0.014]);
  return union(translated(penis, [0, -0.25, 0.022]), translated(prostate, [0, -0.226, 0.004]));
}

/** Clear space kept between the floor's muscles and the penis or prostate, metres: a display choice. */
const MALE_ORGAN_GAP = 0.003;
export const GROUP_Y = -0.045;
const local = (p: V3): V3 => [p[0], p[1] - ORIGIN[1], p[2]];

/** How far the centre of the bowl hangs below the rim: chosen to clear the prostate and bladder (see above). A drawing choice. */
const BOWL_DROP = 0.093;
/** Half-axes of the hiatus (x across, z front to back) in metres, wide enough for the vagina (x +-0.019) and the rectum. A drawing choice. */
const HIATUS: [number, number] = [0.022, 0.03];
/** Radius, body y and body z of the external urethral sphincter ring (see `pelvicFloorLeaves`). Drawing choices. */
const SPHINCTER_RING_R = 0.0135;
const SPHINCTER_RING_Y = -0.2385;
const SPHINCTER_RING_Z = 0.007;
/** Gap between the medial edge of each perineal membrane wing and the midline, metres. A drawing choice (see above). */
const MEMBRANE_GAP = 0.04;

/** The rim of the right half of the bowl, front to back, body frame: pubic body, along the tendinous arch, ischial spine, coccyx. */
export function rimPoints(): V3[] {
  const spineMedial: V3 = [SPINE_TIP[0] - 0.004, SPINE_TIP[1] - 0.001, SPINE_TIP[2] + 0.003];
  return [
    snap([0.012, -0.162, 0.054], 0.0006),
    [0.04, -0.158, 0.041],
    [0.064, -0.157, 0.02],
    [0.0715, -0.155, -0.01],
    spineMedial,
    [0.04, -0.168, -0.056],
    [0.003, -0.178, -0.062],
  ];
}
const rimCurve = (): THREE.CatmullRomCurve3 => new THREE.CatmullRomCurve3(rimPoints().map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', 0.5);

/** A point of the bowl: u 0..1 front to back round the rim, v 0 at the hiatus to 1 at the rim. Right half. */
function bowl(rim: THREE.CatmullRomCurve3, u: number, v: number): V3 {
  const q = rim.getPointAt(u);
  const cx = 0;
  const cz = 0.0;
  const dx = q.x - cx;
  const dz = q.z - cz;
  // The hiatus's edge along this direction, as a fraction of the way to the rim.
  const h = Math.min(0.8, 1 / Math.sqrt((dx / HIATUS[0]) ** 2 + (dz / HIATUS[1]) ** 2));
  const r = h + (1 - h) * v;
  // Height: the rim's own at v = 1, hanging BOWL_DROP below it at the middle.
  const y = q.y - (BOWL_DROP * (1 - r * r)) / (1 - h * h);
  return [cx + dx * r, y, cz + dz * r];
}

/** A sector of the bowl as a sheet: u from u0 to u1, v from v0 to v1 (right half; the left is its mirror). */
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

const pair = (g: THREE.BufferGeometry): THREE.BufferGeometry[] => [g, mirrorGeo(g)];
const toLocal = (g: THREE.BufferGeometry): THREE.BufferGeometry => g.translate(0, -ORIGIN[1], 0);

/** The pieces of each LEAF muscle, keyed by the leaf's part id in src/data/anatomy/pelvic_floor_muscles.json. */
export function pelvicFloorLeaves(): Record<string, THREE.BufferGeometry[]> {
  const out: Record<string, THREE.BufferGeometry[]> = {};
  const T = 0.004;
  // Puborectalis: the innermost ring, in a sling from the pubis round behind the anorectal junction.
  out.puborectalis = pair(sector(0.0, 1.0, 0.0, 0.3, T, 16));
  // Pubococcygeus: the front half of the outer bowl, from the pubis.
  out.pubococcygeus = pair(sector(0.0, 0.45, 0.3, 1.0, T, 8));
  // Iliococcygeus: the back half, from the tendinous arch to the coccyx.
  out.iliococcygeus = pair(sector(0.45, 1.0, 0.3, 1.0, T, 10));

  // Coccygeus: from the ischial spine to the side of the coccyx, along the back edge of the bowl.
  const spine = snap([SPINE_TIP[0] - 0.001, SPINE_TIP[1] - 0.003, SPINE_TIP[2] - 0.003], 0.0003);
  const coccyx = snap([0.011, -0.172, -0.06], 0.0003);
  out.coccygeus = pair(
    toLocal(belly([spine, [0.045, -0.172, -0.058], coccyx], (u) => 0.007 * (0.4 + 0.6 * Math.sin(Math.PI * u) ** 0.5), (u) => 0.0028 * (0.4 + 0.6 * Math.sin(Math.PI * u) ** 0.5), () => new THREE.Vector3(0, -1, 0), 8, 6)),
  );

  // Tendinous arch of the levator ani: the thickened line of fascia from the pubic body to the ischial spine, along the rim.
  const rim = rimCurve();
  const arch: V3[] = [0, 0.18, 0.36, 0.54, 0.7].map((u) => {
    const q = rim.getPointAt(u);
    return [q.x, q.y + 0.0012, q.z];
  });
  out.tendinous_arch_of_levator_ani = pair(toLocal(tubeAlong(arch, () => 0.0013, { tubular: 14, radial: 5 })));

  // Perineal membrane: a thin triangular sheet across the pubic arch, in two wings that stop short of the midline.
  const ramus = [INFERIOR_RAMUS[2], INFERIOR_RAMUS[1], ISCHIAL_RAMUS[2], ISCHIAL_RAMUS[1], [TUBEROSITY[0] - 0.003, TUBEROSITY[1] - 0.004, TUBEROSITY[2] + 0.004]] as V3[];
  const wingRails = ramus.map((p) => {
    const lateral = snap([p[0] - 0.003, p[1] - 0.004, p[2]], 0.0004);
    const medial: V3 = [Math.min(MEMBRANE_GAP, lateral[0] - 0.004), lateral[1], lateral[2]];
    return [lateral, [(lateral[0] + medial[0]) / 2, lateral[1], lateral[2]] as V3, medial].map(local);
  });
  out.perineal_membrane = pair(sheet(wingRails, 1, 0.0018, local([0, -0.1, 0.02])));

  // Deep transverse perineal: a flat band across the deep pouch, above the membrane, from the ischiopubic ramus inward.
  const dtLat = snap([ISCHIAL_RAMUS[2][0] - 0.005, ISCHIAL_RAMUS[2][1] + 0.004, ISCHIAL_RAMUS[2][2] - 0.001], 0.0004);
  out.deep_transverse_perineal = pair(toLocal(belly([dtLat, [dtLat[0] - 0.012, dtLat[1] + 0.001, dtLat[2] - 0.001], [MEMBRANE_GAP + 0.004, dtLat[1] + 0.001, dtLat[2] - 0.002]], () => 0.005, () => 0.0018, () => new THREE.Vector3(0, -1, 0), 6, 6)));

  // Superficial transverse perineal: a slim slip along the back edge of the membrane, to the perineal body.
  const stLat = snap([TUBEROSITY[0] - 0.004, TUBEROSITY[1] - 0.008, TUBEROSITY[2] + 0.004], 0.0004);
  out.superficial_transverse_perineal = pair(toLocal(belly([stLat, [stLat[0] - 0.02, stLat[1] - 0.002, stLat[2] + 0.002], [0.012, stLat[1] - 0.003, stLat[2] + 0.004]], () => 0.0032, () => 0.0016, () => new THREE.Vector3(0, -1, 0), 6, 6)));

  // External urethral sphincter: a ring of muscle round the membranous urethra, between the prostate's apex and the bulb of
  // the penis (the male position). It was a 4.2 mm ring at body y -0.2495, which is the CENTRE of the penis's bulb (the bulb's
  // ellipsoid is at scene y -0.291 and the ring at -0.2945): the whole ring, 133 of its 133 vertices, lay inside the penis, 8.73 mm
  // deep, where MODEL_LIMITATIONS 21 had said 1.9 mm. Gray's puts the sphincter in the deep perineal pouch ABOVE the bulb, around
  // the membranous urethra, with the bulb below the perineal membrane; this model's bulb reaches up to scene y -0.281 and the
  // prostate's apex down to -0.286, so there is no gap between them for a small ring. The ring is therefore drawn at the waist
  // where the two ellipsoids meet (body y -0.2385, scene -0.2835) and wide enough to go AROUND the prostate's apex and the bulb's
  // neck instead of through them: SPHINCTER_RING_R 13.5 mm. A drawing choice, and an enlarged one: the real sphincter is a
  // sleeve closely applied to the urethra. Changed 2026-11-27 (agent gx3); the male pelvic floor's earlier byte-identity is gone.
  const ring: V3[] = Array.from({ length: 13 }, (_, i): V3 => {
    const a = (2 * Math.PI * i) / 12;
    return [SPHINCTER_RING_R * Math.cos(a), SPHINCTER_RING_Y, SPHINCTER_RING_Z + SPHINCTER_RING_R * Math.sin(a)];
  });
  const sph = toLocal(tubeAlong(ring, () => 0.0022, { tubular: 18, radial: 6, closed: false }));
  out.external_urethral_sphincter = [sph];
  // Every vertex clear of the pelvic bones (see `declip`), the field read in the hip bone's body frame (this organ's frame is 0.2 higher).
  for (const gs of Object.values(out)) for (const g of gs) declip(g, hipThighBoneSd(), 0.0002, ORIGIN[1]);
  // Then out of the penis and the prostate. Only the leaves the MALE body draws: the female shell borrows the coccygeus and the
  // tendinous arch from here and nothing else, and those lie nowhere near either organ, so a female body is unchanged.
  const male = maleOrganSd();
  for (const [id, gs] of Object.entries(out)) {
    if (id === 'coccygeus' || id === 'tendinous_arch_of_levator_ani') continue;
    for (const g of gs) declip(g, male, MALE_ORGAN_GAP, ORIGIN[1]);
  }
  return out;
}

export const PELVIC_PARENT: Readonly<Record<string, string>> = {
  puborectalis: 'levator_ani', pubococcygeus: 'levator_ani', iliococcygeus: 'levator_ani',
  perineal_membrane: 'perineal_muscles', deep_transverse_perineal: 'perineal_muscles',
  superficial_transverse_perineal: 'perineal_muscles', external_urethral_sphincter: 'perineal_muscles',
};

export function pelvicFloorMuscleMap(): Record<string, THREE.BufferGeometry[]> {
  const out = pelvicFloorLeaves();
  out.levator_ani = ['puborectalis', 'pubococcygeus', 'iliococcygeus'].flatMap((c) => out[c]);
  out.perineal_muscles = ['perineal_membrane', 'deep_transverse_perineal', 'superficial_transverse_perineal', 'external_urethral_sphincter'].flatMap((c) => out[c]);
  return out;
}
export function pelvicFloorMuscleGroups(): Record<string, THREE.BufferGeometry[]> {
  const all = pelvicFloorMuscleMap();
  return Object.fromEntries(['levator_ani', 'coccygeus', 'tendinous_arch_of_levator_ani', 'perineal_muscles'].map((id) => [id, all[id]]));
}
export function pelvicFloorMuscles(): THREE.BufferGeometry {
  return mergeParts(Object.values(pelvicFloorMuscleGroups()).flat());
}
