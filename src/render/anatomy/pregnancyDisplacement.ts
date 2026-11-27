/**
 * PREGNANCY DISPLACEMENT: how the organs around the uterus make room for it. Pure, no three.js.
 *
 * WHAT WAS WRONG. The gravid uterus was drawn on top of the abdomen as if nothing else were
 * there. Measured on the model's own meshes (auditor aur, 2026-11): at 28 and 40 weeks it
 * reached 40 and 43 mm into the small intestine, 55 and 56 mm into the large, 25 and 42 mm into
 * the gallbladder, 8 and 21 mm into the stomach, 49 mm into the diaphragm and 29 mm into the
 * liver at term, and 62 and 87 mm through the muscles of the abdominal wall.
 *
 * WHAT THE FIELD IS. A smooth displacement of every vertex of a listed organ, as a function of the
 * gestational week alone. It is applied ON TOP of each organ's own base geometry (OrganSet keeps
 * the base positions and rewrites the live ones), so the organs' shape files are untouched and a
 * non-pregnant body is bit-for-bit what it was.
 *
 * THE RULE, in the uterus's own ellipsoid coordinates q = (p - centre) / radii, rho = |q|. The
 * gravid body is the ellipsoid `gravidShape(weeks)`. A point is moved along a direction n by
 *
 *     t = A * Rn * (1 - smootherstep((rho - rhoS) / (rhoE - rhoS)))        rho > rhoS
 *     t = A * Rn                                                          rho <= rhoS
 *
 * where Rn is the ellipsoid's radius along n, A = rho0 - rhoS and rho0 puts the inflated surface
 * (the uterus plus `DISPLAY_MARGIN_M`) at 1. Two properties make it safe. (1) CLEARANCE: every
 * point that was at rho >= rhoS ends outside the inflated ellipsoid along a radial direction,
 * because it moves by at least the gap between rhoS and rho0 in rho; nothing in a displaced organ
 * lies deeper than rhoS (the deepest organ vertex measured was rho 0.62), so rhoS = 0.3 is
 * unreachable by data and is only the floor of the formula. (2) NO FOLDING: the radial map
 * rho -> rho + s(rho) has slope 1 + s'(rho) >= 1 - A * 1.875 / (rhoE - rhoS), and rhoE is chosen as
 * rhoS + 2.2 A, so the slope never falls below 0.15: the map is a diffeomorphism and a shell cannot
 * tear or turn inside out. The deep part is a SHIFT, not a squash, so an organ keeps its thickness
 * and its shape, and the push dies out smoothly with distance, so a displaced organ stays joined to
 * the part of the body that did not move. The unit test checks both on a grid (Jacobian > 0).
 *
 * DIRECTIONS (what the obstetric texts describe). The bowel, stomach, liver, gallbladder and
 * diaphragm are moved up and out: below the centre of the uterus a point is moved sideways and
 * forward, never down (the pelvic floor is there), and never backward into the spine. The
 * abdominal wall is carried forward, and sideways at the flanks, over the uterus. The bladder is
 * carried up and forward (Williams Obstetrics 25e, ch. 4: the bladder is displaced upward and
 * anteriorly as the uterus rises out of the pelvis). The appendix is part of the large-intestine
 * shell here, so it is carried up and laterally with the caecum, which is what Baer, JAMA 1932
 * 98:1359 describes (the appendix rises and rotates as the uterus enlarges).
 *
 * WHAT IS CITED AND WHAT IS NOT. The SIZE of every push comes from the model's own uterus
 * (the push-out-of-the-uterus rule), not from a textbook number: no source was found that gives a
 * displacement in millimetres for each organ, and none was invented. The one literature magnitude
 * that exists is for the diaphragm, a cross-check and not an input: the resting diaphragm ends
 * pregnancy displaced upward by 1.5 to 4 cm (LoMauro et al., J Appl Physiol 2019, summarising
 * early chest radiographs) or about 5 cm (LoMauro and Aliverti, Breathe 2015;11:297). The rule
 * pushes the model's diaphragm by whatever its uterus needs (a few cm at term; see the DOCS NOTE
 * for the measured value), which is the same order, and it is not tuned to either figure. The
 * Williams Obstetrics statement of the diaphragm's rise was not retrieved and is not quoted.
 * `DISPLAY_MARGIN_M`, `RHO_FLOOR` and `FALLOFF` are DISPLAY choices.
 */

type V3 = readonly [number, number, number];

/** The ellipsoid the uterus occupies, in the same frame as the points passed in (the world). */
export interface UterusBody {
  centre: V3;
  radii: V3;
}

/** Which family of organs a point belongs to. It chooses the direction of the push, nothing else. */
export type DisplacedKind = 'bowel' | 'stomach' | 'liver' | 'gallbladder' | 'diaphragm' | 'bladder' | 'wall';

/** The organs this module moves, by organ id. The appendix and caecum travel with the large intestine. */
export const DISPLACED_ORGANS: Readonly<Record<string, DisplacedKind>> = {
  intestine_small: 'bowel',
  intestine_large: 'bowel',
  stomach: 'stomach',
  liver: 'liver',
  gallbladder: 'gallbladder',
  diaphragm: 'diaphragm',
  bladder: 'bladder',
  abdominal_wall_muscles: 'wall',
};

/** Gap left between a displaced organ and the uterus, metres. A DISPLAY choice. */
export const DISPLAY_MARGIN_M = 0.004;
/** Normalised radius inside which the push is its full size. A DISPLAY choice (see the header: no organ reaches it). */
export const RHO_FLOOR = 0.3;
/** The push has died out at RHO_FLOOR + FALLOFF * A. A DISPLAY choice; 2.2 keeps the radial map's slope above 0.15. */
export const FALLOFF = 2.2;
/** The uterus leaves the true pelvis, and so starts to push, between these weeks. */
export const PUSH_FROM_WEEK = 6;
export const PUSH_FULL_WEEK = 10;

function smoother(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * c * (c * (c * 6 - 15) + 10);
}

/** How much of the push is applied at a week: 0 before the uterus is a gravid body, 1 once it is. */
export function pushFraction(weeks: number): number {
  const c = Math.max(0, Math.min(1, (weeks - PUSH_FROM_WEEK) / (PUSH_FULL_WEEK - PUSH_FROM_WEEK)));
  return c * c * (3 - 2 * c);
}

/**
 * The displacement of the point (x, y, z) of an organ of `kind`, written to `out`.
 * Zero outside the uterus's reach and before the uterus is a gravid body.
 */
export function pregnancyDisplacement(weeks: number, body: UterusBody, kind: DisplacedKind, x: number, y: number, z: number, out: [number, number, number]): void {
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  const fraction = pushFraction(weeks);
  if (fraction <= 0) return;
  const [cx, cy, cz] = body.centre;
  const [rx, ry, rz] = body.radii;
  const qx = (x - cx) / rx;
  const qy = (y - cy) / ry;
  const qz = (z - cz) / rz;
  const rho = Math.hypot(qx, qy, qz);

  // The direction, as an ellipsoid-gradient-like vector g (normalised below).
  let gx: number;
  let gy: number;
  let gz: number;
  switch (kind) {
    case 'wall':
      // Forward over the uterus; sideways at the flanks; a little up at the top. Never back.
      gx = qx / rx;
      gy = (0.25 * qy) / ry;
      gz = (Math.max(qz, 0) + 0.35 * rho) / rz;
      break;
    case 'bladder':
      // Up and forward, whatever side of the uterus's centre the bladder is on.
      gx = 0;
      gy = 1 / ry;
      gz = 0.6 / rz;
      break;
    default:
      // Up and out: never down, never back.
      gx = qx / rx;
      gy = Math.max(qy, 0) / ry;
      gz = Math.max(qz, 0) / rz;
  }
  let gl = Math.hypot(gx, gy, gz);
  if (gl < 1e-9) {
    gx = 0;
    gy = 1 / ry;
    gz = 0;
    gl = gy;
  }
  const nx = gx / gl;
  const ny = gy / gl;
  const nz = gz / gl;
  const rn = 1 / Math.sqrt((nx / rx) ** 2 + (ny / ry) ** 2 + (nz / rz) ** 2);

  const rho0 = 1 + DISPLAY_MARGIN_M / rn;
  const a = rho0 - RHO_FLOOR;
  const rhoE = RHO_FLOOR + FALLOFF * a;
  if (rho >= rhoE) return;
  const s = rho <= RHO_FLOOR ? a : a * (1 - smoother((rho - RHO_FLOOR) / (rhoE - RHO_FLOOR)));
  const t = fraction * s * rn;
  out[0] = nx * t;
  out[1] = ny * t;
  out[2] = nz * t;
}
